'use strict';
/*
 * dom.test.js — behavioural regression guard for the single-file app.
 *
 * logic.test.js covers the pure BirdLogic functions and parse.test.js catches
 * syntax slips, but every bug that actually reached the phone in this project
 * was a DOM/wiring bug those two can't see: a section rendering nothing, a
 * button never wired, a map container that exists but is never drawn into.
 * This boots www/index.html in jsdom and drives it like a user, so that class
 * of regression fails in CI instead of on a sideloaded build.
 *
 * Network is stubbed with a promise that never settles: loaders start (so we
 * can assert they were triggered and count their requests) but never paint
 * results, which keeps the tests offline and deterministic.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const WWW = path.join(__dirname, '..', 'www');
const HTML = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
// The two card families live in their own files so they can be tweaked by
// looking at the source. Guards that read card CSS must read it from THERE —
// pointing them back at index.html is how a second definition creeps in.
const CARDS_SPECIES = fs.readFileSync(path.join(WWW, 'cards-species.js'), 'utf8');
const CARDS_HOTSPOT = fs.readFileSync(path.join(WWW, 'cards-hotspot.js'), 'utf8');
const CONTRACT = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'report-contract.json'), 'utf8'));
// The native permission that makes "📍 Here" work cannot be committed — ios/ is
// regenerated every build — so the workflow and the manifest are the only two
// places that can prove it will be there.
const IOS_WF = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'ios-build.yml'), 'utf8');
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const BL = require(path.join(WWW, 'logic.js'));

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

// Arrays built inside jsdom have jsdom's Array prototype, and assert/strict's
// deepEqual compares prototypes — so a same-valued array from the app fails
// against a literal written here. Map through the Node-realm Array first.
const arr = (x, f) => Array.from(x || [], f);

// Serve www/ off the virtual origin so <script src>/<link href> resolve to the
// real vendored Leaflet and logic.js rather than hitting the network.
const localFiles = requestInterceptor((request) => {
  try {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\//, '');
    const file = path.join(WWW, rel);
    if (file.startsWith(WWW) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return new Response(fs.readFileSync(file), {
        headers: { 'Content-Type': MIME[path.extname(file)] || 'text/plain' },
      });
    }
  } catch (e) { /* fall through: let the request proceed and fail offline */ }
  return undefined;
});

/** Boot the app in jsdom with a seeded key/home. Resolves once scripts ran. */
// isSpeciesSeen reads getReportSeen(), which prefers the BUNDLED per-report
// codes over any imported set — the same set the LISTS are built from. A
// fixture therefore has to drive that set, not localStorage, or it is pinning
// a path the app does not take. (That gap is the bug this comment exists
// because of: a card headed "3 unseen" whose rows disagreed with the heading.)
function seedSeen(app, codes, names) {
  const rep = app.window.__SEED_BIRDLIST__.seenByReport[app.window.__app.getReportSlug()];
  rep.codes = codes.slice();
  rep.watchHeld = [];
  // The NAME fallback is scoped to this report's own year list too, so a
  // fixture that relies on it (subspecies forms resolving by base name) has to
  // supply it here rather than through the cross-region localStorage pools.
  if (names) rep.names = names.slice();
  app.window.localStorage.setItem('ebird_seen_field', 'speciesCode');
}

function boot(opts = {}) {
  const state = { fetches: [], errors: [] };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    // jsdom has no layout engine, so scrollTo/resizeTo are expected no-ops.
    if (!/Not implemented/.test(e.message)) state.errors.push(e.message);
  });
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    resources: { interceptors: [localFiles] },
    url: 'https://localhost/',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      if (opts.key !== null) window.localStorage.setItem('ebird_api_key', opts.key || 'TESTKEY');
      window.localStorage.setItem('ebird_home_lat', '47.75');
      window.localStorage.setItem('ebird_home_lng', '-122.16');
      window.localStorage.setItem('ebird_report', opts.report || 'wa');
      Object.entries(opts.storage || {}).forEach(([k, v]) => window.localStorage.setItem(k, v));
      window.fetch = function (url) {
        state.fetches.push(String(url));
        // Bundled assets are part of the app, not the network: a relative path
        // that exists in www/ is served from disk so offline-by-default tests
        // still exercise the real file the phone would read.
        try {
          const rel = decodeURIComponent(new URL(String(url), 'https://localhost/').pathname).replace(/^\//, '');
          const file = path.join(WWW, rel);
          if (rel && file.startsWith(WWW) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            const body = fs.readFileSync(file, 'utf8');
            return Promise.resolve({
              ok: true, status: 200,
              text: () => Promise.resolve(body),
              json: () => Promise.resolve(JSON.parse(body)),
            });
          }
        } catch (e) { /* not a bundled file: fall through to the stub */ }
        // Tests that need a response supply opts.fetch(url) -> html string|null.
        if (opts.fetch) {
          const body = opts.fetch(String(url));
          // A test that needs a FAILURE returns { __status, __headers }. Without
          // this every stubbed response is a 200 and no retry path — the one
          // that matters most, because it only runs when things go wrong — is
          // unreachable from a test.
          if (body != null && typeof body === 'object' && body.__status) {
            const hdrs = body.__headers || {};
            return Promise.resolve({
              ok: body.__status >= 200 && body.__status < 300,
              status: body.__status,
              headers: { get: (k) => hdrs[k] ?? hdrs[String(k).toLowerCase()] ?? null },
              text: () => Promise.resolve(JSON.stringify(body.__body ?? {})),
              json: () => Promise.resolve(body.__body ?? {}),
            });
          }
          if (body != null) {
            return Promise.resolve({
              ok: true, status: 200,
              headers: { get: () => null },
              text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
              json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
            });
          }
        }
        return new Promise(() => {});   // never settles: offline + deterministic
      };
      window.onerror = (msg) => { state.errors.push(String(msg)); };
    },
  });
  return new Promise((resolve) => {
    dom.window.addEventListener('load', () => setTimeout(() => {
      const window = dom.window;
      resolve({
        dom, window,
        document: window.document,
        state,
        $: (id) => window.document.getElementById(id),
        links: () => [...window.document.querySelectorAll('.toclink')],
        click(el) { el.dispatchEvent(new window.Event('click', { bubbles: true })); },
        open(labelRe) {
          const a = [...window.document.querySelectorAll('.toclink')]
            .find((x) => labelRe.test(x.textContent));
          assert.ok(a, 'no Contents entry matching ' + labelRe);
          this.click(a);
        },
      });
    }, 50));
  });
}

test('app boots: Leaflet loads and the Contents menu is built', async () => {
  const app = await boot();
  assert.equal(typeof app.window.L, 'object', 'Leaflet global is present');
  assert.equal(typeof app.window.L.map, 'function', 'Leaflet is usable');
  assert.equal(app.links().length, CONTRACT.menu.length,
    'one Contents link per contract section');
  assert.ok(app.$('menuPanel') && !app.$('menuPanel').hidden, 'menu visible at start');
  assert.equal(app.$('navbar').hidden, true, 'navbar hidden at start');
  const visible = [...app.document.querySelectorAll('main section')].filter((s) => !s.hidden);
  assert.equal(visible.length, 0, 'no section is open until one is picked');
  assert.deepEqual(app.state.errors, [], 'no uncaught errors while booting');
  app.window.close();
});

test('no two menu tiles wear the same icon, and 🔍 means one thing', () => {
  // Reported from the device: "species lookup and needs verification both have
  // similar icons". They were 🔎 and 🔍 — one glyph apart by TILT — and it was
  // worse than a near-miss, because 🔍 is ALSO the app-wide unseen marker
  // (`needflag`) and was ALSO the Quick-outing "Find…" chip. One glyph, three
  // meanings, two of them in the same menu.
  //
  // A tile's icon is the only part of it visible at a glance, so it has to be
  // the part that is unique. This asserts the property rather than the current
  // assignment, so the next section added cannot quietly re-collide.
  const icons = CONTRACT.menu.map((m) => [...m.label][0]);
  const seen = new Map();
  icons.forEach((ic, i) => {
    const prev = seen.get(ic);
    assert.ok(prev === undefined,
      `two menu tiles share the icon ${ic}: "${CONTRACT.menu[prev || 0].label}" `
      + `and "${CONTRACT.menu[i].label}" — the glyph is the only part of a tile `
      + 'read at a glance, so it must be the unique part');
    seen.set(ic, i);
  });

  // 🔍 (U+1F50D) is the unseen marker and NOTHING else. A section titled with
  // it competes with every row in the app that uses it to mean "you still need
  // this bird".
  //
  // Species lookup is 🔎 (U+1F50E) — a DIFFERENT codepoint, deliberately. The
  // section really is a magnifying glass and asking for one is reasonable; what
  // it must not be is the same glyph the rows use, because a colour-blind
  // reader has only the glyph to go on. The two are checked apart here rather
  // than trusted to look different.
  const magnifier = CONTRACT.menu.filter((m) => m.label.includes('\u{1F50D}'));
  assert.deepEqual(magnifier, [],
    'no menu tile may use 🔍 (U+1F50D) — it is the unseen marker. 🔎 (U+1F50E) '
    + 'is the one for a lookup, and a colour-blind reader has only the glyph');
  assert.match(HTML, /class="needflag">\u{1F50D}/u,
    'and the unseen marker really is that glyph, so this guard tracks it');
  // ...and the row-level "look this bird up" button stays 📖 on purpose: it
  // sits inline beside the needflag, where a second magnifier would be the very
  // collision the rule above exists to prevent.
  assert.match(HTML, /aria-label="Look up ' \+ esc\(s\.name\) \+ '">\u{1F4D6}</u,
    'the per-row lookup button is still the book, not a second magnifier');
});

test('Contents menu matches the report section contract (labels + order)', async () => {
  const app = await boot();
  // Tiles split the label into a glyph span and a text span, so textContent
  // loses the space between them. The accessible name is the label a
  // screen-reader user actually hears, so that is what the contract pins.
  const rendered = app.links().map((a) => (a.getAttribute('aria-label') || a.textContent).trim());
  const contract = CONTRACT.menu.map((m) => m.label);

  // MEMBERSHIP is pinned exactly: every section the report emits has a tile,
  // and no tile exists that the report does not.
  assert.deepEqual(JSON.stringify(rendered.slice().sort()),
    JSON.stringify(contract.slice().sort()),
    'menu labels drifted from tests/fixtures/report-contract.json — update '
    + 'both the app and the contract (and report.py if the report changed)');

  // ORDER is pinned WITHIN A GROUP, not across the whole menu. The menu is
  // laid out by what you are trying to do — "eBird Rankings" sits with My year
  // even though the report prints it third — so the report's order is kept
  // where it still means something: among the sections of one group.
  // The ARRAY order in index.html is untouched and is what
  // tests/parity/test_report_toc.py compares to the report.
  const groupOf = {};
  for (const m of HTML.matchAll(/\{ at: '([A-Za-z0-9_]+)',\s*label: '([^']+)'[^\n]*group: '([^']+)'/g)) {
    groupOf[m[2].replace(/\\u2019/g, '\u2019')] = m[3];
  }
  const rank = {};
  contract.forEach((l, i) => { rank[l] = i; });
  const lastSeen = {};
  for (const label of rendered) {
    const g = groupOf[label];
    if (!g) continue;
    if (lastSeen[g] != null) {
      assert.ok(rank[label] > lastSeen[g],
        '"' + label + '" is out of report order within its group "' + g + '"');
    }
    lastSeen[g] = rank[label];
  }
  const tiles = app.links();
  assert.ok(tiles.every((a) => a.tagName === 'BUTTON'),
    'Contents entries are real buttons (tiles), not bare anchors');
  assert.ok(tiles.every((a) => a.querySelector('.tilelabel')),
    'every tile carries its label in its own element, separate from the glyph');
  assert.equal(tiles.filter((a) => a.querySelector('.tileicon')).length, tiles.length,
    'every tile shows a glyph - that is what makes the grid scannable');
  app.window.close();
});

test('every section the report maps has a map container, wired to a renderer', async () => {
  const app = await boot();
  // Containers are drawn either by renderMap() directly or by a helper that
  // delegates to it; verify the helpers really do delegate before trusting them.
  const RENDERERS = ['renderMap', 'renderDestinations', 'renderRoute'];
  const lines = HTML.split(/\r?\n/);
  for (const helper of RENDERERS.filter((f) => f !== 'renderMap')) {
    const start = HTML.indexOf('function ' + helper + '(');
    assert.ok(start > -1, `${helper}() should exist`);
    const body = HTML.slice(start, HTML.indexOf('\n      function ', start + 1));
    assert.match(body, /renderMap\(/, `${helper}() must draw via renderMap()`);
  }

  const mapped = CONTRACT.menu.filter((m) => m.map);
  assert.ok(mapped.length >= 6, 'contract lists the report-mapped sections');
  for (const m of mapped) {
    const el = app.$(m.map);
    assert.ok(el, `#${m.map} container missing for "${m.label}"`);
    const sec = app.$(m.at).closest('section');
    assert.ok(sec && sec.contains(el),
      `#${m.map} must live inside the "${m.label}" section`);
    // A container nobody draws into is the bug that shipped in v1.0.5: Hot,
    // Cold and Birdiest rendered lists with no map even though the report maps
    // them. Require the container to be handed to a map renderer.
    const wired = lines.some((ln) =>
      ln.includes("$('" + m.map + "')") && RENDERERS.some((f) => ln.includes(f + '(')));
    assert.ok(wired, `#${m.map} exists but is never passed to a map renderer`);
  }
  // Sections the report does NOT map must not sprout stray map containers.
  for (const m of CONTRACT.menu.filter((x) => !x.map)) {
    const sec = app.$(m.at) && app.$(m.at).closest('section');
    if (sec) {
      assert.equal(sec.querySelector('[id$="Map"]'), null,
        `"${m.label}" has a map container but the report renders no map there`);
    }
  }
  app.window.close();
});

test('navigation opens exactly one section and the back button returns', async () => {
  const app = await boot();
  app.open(/Settings/);
  const sections = [...app.document.querySelectorAll('main section')];
  assert.equal(sections.filter((s) => !s.hidden).length, 1, 'exactly one section visible');
  assert.equal(app.$('settingsPanel').hidden, false, 'the chosen section is the visible one');
  assert.equal(app.$('menuPanel').hidden, true, 'menu hides while in a section');
  assert.equal(app.$('navbar').hidden, false, 'navbar shows while in a section');
  assert.match(app.$('navTitle').textContent, /Settings/, 'navbar titles the section');

  app.click(app.$('navBack'));
  assert.equal(app.$('menuPanel').hidden, false, 'back returns to the menu');
  assert.equal(app.$('navbar').hidden, true, 'navbar hides on the menu');
  assert.equal(sections.filter((s) => !s.hidden).length, 0, 'no section left open');
  assert.deepEqual(app.state.errors, [], 'no uncaught errors while navigating');
  app.window.close();
});

test('opening a section auto-loads its content (no button tap)', async () => {
  const app = await boot();
  app.open(/Today.s patches/);
  assert.match(app.$('destStatus').textContent, /Ranking hotspots/,
    'the section loader ran on first open');
  app.window.close();
});

test('hot and cold hotspots render from ONE shared scan', async () => {
  const app = await boot();
  app.open(/Producing patches/);
  const afterHot = app.state.fetches.length;
  assert.ok(afterHot > 0, 'opening Producing patches starts a scan');

  app.open(/Under-birded patches/);
  assert.equal(app.state.fetches.length, afterHot,
    'opening Under-birded patches must reuse the in-flight scan, not refetch');
  assert.match(app.$('coldStatus').textContent, /Scanning|overlooked/,
    'the cold section reports the shared scan');
  // Let the in-flight scan settle before tearing the window down. The
  // foreground lane defers behind a token now, so closing immediately leaves
  // work pointing at a document that no longer exists.
  await new Promise((r) => setTimeout(r, 30));
  app.window.close();
});

/* --- swipe-back gesture ---------------------------------------------------
 * The gesture has to coexist with vertical page scrolling, horizontally
 * scrollable tables and Leaflet drag, so these cases pin both directions:
 * a clean rightward swipe navigates, and every guarded situation does not.
 */
function swipe(app, from, dx, dy, opts) {
  const w = app.window;
  const o = opts || {};
  const x0 = 40, y0 = 300;
  const mk = (type, x, y, key) => {
    const e = new w.Event(type, { bubbles: true });
    const pt = [{ clientX: x, clientY: y }];
    Object.defineProperty(e, key, { value: o.multi ? pt.concat(pt) : pt });
    return e;
  };
  from.dispatchEvent(mk('touchstart', x0, y0, 'touches'));
  from.dispatchEvent(mk('touchend', x0 + dx, y0 + dy, 'changedTouches'));
}

test('swiping right in a section returns to the Contents menu', async () => {
  const app = await boot();
  app.open(/Today.s patches/);
  assert.equal(app.$('menuPanel').hidden, true, 'section is open');

  swipe(app, app.$('destStatus'), 140, 10);
  assert.equal(app.$('menuPanel').hidden, false, 'swipe right reopened Contents');
  assert.equal(app.$('navbar').hidden, true, 'navbar hidden back on the menu');
  const visible = [...app.document.querySelectorAll('main section')].filter((s) => !s.hidden);
  assert.equal(visible.length, 0, 'no section left open');
  app.window.close();
});

test('swipe-back ignores gestures it must not steal', async () => {
  const app = await boot();
  const open = () => { app.open(/Today.s patches/); return app.$('destStatus'); };

  let el = open();
  swipe(app, el, -140, 0);
  assert.equal(app.$('menuPanel').hidden, true, 'leftward swipe does not navigate');

  swipe(app, el, 30, 0);
  assert.equal(app.$('menuPanel').hidden, true, 'short drag does not navigate');

  swipe(app, el, 140, 200);
  assert.equal(app.$('menuPanel').hidden, true, 'diagonal/vertical scroll does not navigate');

  swipe(app, el, 140, 0, { multi: true });
  assert.equal(app.$('menuPanel').hidden, true, 'two-finger pinch does not navigate');

  // A table already scrolled right must keep its own horizontal scroll.
  const scroller = app.document.createElement('div');
  Object.defineProperty(scroller, 'scrollWidth', { value: 900 });
  Object.defineProperty(scroller, 'clientWidth', { value: 300 });
  scroller.scrollLeft = 120;
  app.$('destStatus').appendChild(scroller);
  swipe(app, scroller, 140, 0);
  assert.equal(app.$('menuPanel').hidden, true,
    'swipe inside a horizontally scrolled table is left to the table');

  // Same container back at its left edge: the gesture is free again.
  scroller.scrollLeft = 0;
  swipe(app, scroller, 140, 0);
  assert.equal(app.$('menuPanel').hidden, false,
    'at the left edge the swipe navigates');
  app.window.close();
});

test('swiping right on the Contents menu is a no-op', async () => {
  const app = await boot();
  assert.equal(app.$('menuPanel').hidden, false, 'menu is showing');
  swipe(app, app.$('menuPanel'), 160, 0);
  assert.equal(app.$('menuPanel').hidden, false, 'still on the menu');
  assert.deepEqual(app.state.errors, [], 'no errors from a menu swipe');
  app.window.close();
});

/* The surge section exists because ~20 birders saw a Tufted Puffin at the
 * Edmonds waterfront and neither the report nor the app said a word until the
 * next day. logic.test.js and tests/parity/test_surge.py already prove the
 * detector fires on that event in BOTH languages — but a correct detector
 * nobody wired up is exactly the v1.0.14 bug (notableToday was a proven port
 * that refresh() simply never called, and the golden could not see it). This
 * guards the wiring: the loader runs, drives all three lanes, and the results
 * reach the DOM.
 */
test('Happening now is wired and renders every lane it detects', async () => {
  const app = await boot();
  app.open(/Happening now/);
  assert.equal(app.$('surgeResults').closest('section').hidden, false,
    'the section is the one on screen');

  const A = app.window.__app;
  const BL = app.window.BirdLogic;
  const now = new Date(2026, 6, 27, 18, 0).getTime();
  const at = (n, hh) => {
    const d = new Date(2026, 6, 27 - n, hh == null ? 9 : hh);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:00`;
  };
  const events = [];
  for (let i = 0; i < 20; i++) {
    events.push({
      code: 'tufpuf', name: 'Tufted Puffin', kind: 'Rarity', dateStr: at(0, 7 + i % 10),
      observer: 'birder' + i, subId: 'S' + i, locId: 'L1', loc: 'Edmonds Waterfront',
      lat: 47.811, lon: -122.394,
    });
  }
  const detected = BL.surgeEvents(events, { now });
  assert.equal(detected.length, 1, 'the fixture really is a surge');

  A.renderSurge(detected,
    BL.tickCascades([
      { name: 'Brian Pendleton', rank: 3, recent: 'Terek Sandpiper (Jul 19, 2026)' },
      { name: 'Liam Hutcheson', rank: 4, recent: 'Terek Sandpiper (Jul 18, 2026)' },
      { name: 'Bruce LaBar', rank: 8, recent: 'Terek Sandpiper (Jul 19, 2026)' },
    ], A.parseRecentTick),
    [{ locId: 'L2', loc: 'Stanwood STP', observers: 9, baseline: 1, ratio: 9 }]);

  const txt = app.$('surgeResults').textContent;
  assert.match(txt, /Tufted Puffin/, 'lane 1: the species drawing the crowd');
  assert.match(txt, /20 birders/, 'lane 1: observers, which is the whole signal');
  assert.match(txt, /Terek Sandpiper/, 'lane 2: the leaderboard cascade');
  assert.match(txt, /Stanwood STP/, 'lane 3: the species-blind hotspot convergence');
  assert.ok(/ebird\.org\/hotspot\/L1/.test(app.$('surgeResults').innerHTML),
    'the place is a link you can act on, not just a name');
  assert.deepEqual(app.state.errors, [], 'no uncaught errors');
  app.window.close();
});

/* A zero baseline means the ratio is UNDEFINED, not infinite. The two repos
 * disagreed on exactly this — JS called Infinity >= MIN_RATIO a "crowd" while
 * Python called it "novel" — and the cross-language parity test caught it. A
 * rendered "Infinity×" or "NaN×" is the visible symptom, so guard the render
 * too and not just the detector.
 */
test('a surge with no baseline reads as "new here", never as an infinite ratio', async () => {
  const app = await boot();
  app.open(/Happening now/);
  const A = app.window.__app;
  A.renderSurge([{
    code: 'tersan', name: 'Terek Sandpiper', locId: 'L9', loc: 'Stanwood STP',
    lat: 48.24, lon: -122.37, observers: 2, checklists: 2, baseline: 0,
    ratio: null, novel: true, reason: 'novel', rarity: true, seen: false,
    perHour: 1, latest: '2026-07-27 11:00', distMi: 31.2, subId: 'S123',
  }], [], []);
  const txt = app.$('surgeResults').textContent;
  assert.match(txt, /new here/, 'says there is no norm to compare against');
  assert.doesNotMatch(txt, /Infinity|NaN/, 'and never invents a number');
  assert.match(txt, /🆕/, 'flags the "drop everything" case');
  app.window.close();
});

test('Latest ticks section is wired and auto-loads from the leaderboard', async () => {
  const app = await boot();
  app.open(/Latest ticks/);
  assert.equal(app.$('lastNewResults').closest('section').hidden, false,
    'the section is the one on screen');
  assert.match(app.$('lastNewStatus').textContent, /leaderboard/i,
    'the loader ran and reported progress');
  assert.ok(app.state.fetches.some((u) => /top100/.test(u)),
    'it reads ebird.org/top100, the same source rankings.py scrapes');
  assert.deepEqual(app.state.errors, [], 'no uncaught errors');
  app.window.close();
});

/* The leaderboard prints each birder's newest species as
 * "Pectoral Sandpiper (Jul 25, 2026)". report.py::_LAST_NEW_RE and the app's
 * LAST_NEW_RE must agree on that shape or the two sections group differently.
 * This pulls the literal straight out of index.html so an edit there is what
 * gets tested, not a copy that can silently drift.
 */
test("the app's LAST_NEW_RE parses the leaderboard newest-species column", () => {
  const m = /var LAST_NEW_RE = (\/.+\/);/.exec(HTML);
  assert.ok(m, 'LAST_NEW_RE is still declared in index.html');
  const RE = eval(m[1]);          // eslint-disable-line no-eval

  const hit = RE.exec('Pectoral Sandpiper (Jul 25, 2026)');
  assert.ok(hit, 'the eBird "Species (Mon D, YYYY)" form parses');
  assert.equal(hit[1], 'Pectoral Sandpiper');
  assert.equal(hit[2], 'Jul 25, 2026');

  assert.equal(RE.exec('Gray-crowned Rosy-Finch (Jul 21, 2026)')[1],
    'Gray-crowned Rosy-Finch', 'hyphenated names survive');
  assert.equal(RE.exec("Swainson's Thrush (Sep 3, 2026)")[1],
    "Swainson's Thrush", 'apostrophes survive');
  assert.equal(RE.exec('White Wagtail (Black-backed) (Jul 3, 2026)')[1],
    'White Wagtail (Black-backed)', 'subspecies parentheses are not eaten');
  assert.equal(RE.exec('no parenthetical here'), null, 'junk is rejected');
});

test('Closest spots never lists a place the report would not go', async () => {
  const app = await boot();
  const A = app.window.__app;
  const anchors = [{ name: 'home', lat: 47.75, lng: -122.15 },
                   { name: 'here', lat: 47.67, lng: -122.12 }];
  // The exact row that shipped: a private "nearby yard" holding ONE Great
  // Horned Owl on ONE checklist. It is 1.5 mi from the second anchor, so it
  // sorts to #1 —
  // but report._is_reachable drops a private location unless it hosts a
  // stakeout (>=3 checklists), and the report never printed it.
  const cv = {
    stakeout: { L_STAKE: 1 },
    near: [
      { code: 'grhowl', name: 'Great Horned Owl', lat: 47.68, lon: -122.13,
        loc: 'nearby yard', locId: 'L_YARD', location_private: true,
        dateStr: '2026-07-27 21:00', subId: 'S377221269', count: 1 },
      { code: 'tufpuf', name: 'Tufted Puffin', lat: 47.81, lon: -122.39,
        loc: 'Edmonds waterfront', locId: 'L_STAKE',
        location_private: true, dateStr: '2026-07-28 09:00', subId: 'S2' },
      { code: 'manshe', name: 'Manx Shearwater', lat: 47.80, lon: -122.50,
        loc: 'Edmonds-Kingston Ferry', locId: 'L_FERRY',
        dateStr: '2026-07-28 08:00', subId: 'S3' },
      { code: 'comloo', name: 'Common Loon', lat: 47.90, lon: -122.30,
        loc: 'Far Park', locId: 'L_FAR', dateStr: '2026-07-28 07:00', subId: 'S4' },
      { code: 'comloo', name: 'Common Loon', lat: 47.755, lon: -122.16,
        loc: 'Near Park', locId: 'L_NEAR', dateStr: '2026-07-26 07:00', subId: 'S5' },
    ],
  };
  const rows = A.buildClosestSpots(cv, anchors);
  const names = rows.map(r => r.locName);
  assert.ok(!names.includes('nearby yard'),
    'a private location on a single checklist is not a place you can go');
  assert.ok(!names.includes('Edmonds-Kingston Ferry'),
    'a bird off a moving ferry belongs to Excursions, not a quick outing');
  assert.ok(names.some(n => n === 'Edmonds waterfront'),
    'but a private location hosting a stakeout stays - that is the rule that ' +
    'kept the Rose-breasted Grosbeak chaseable');
  const loon = rows.filter(r => r.speciesCode === 'comloo');
  assert.equal(loon.length, 1, 'one row per species');
  assert.equal(loon[0].locName, 'Near Park',
    'and it is the NEAREST report of that species, not whichever the feed listed first');
  const dists = Array.from(rows, r => r.distMi);
  assert.deepEqual(dists, Array.from(dists).sort((a, b) => a - b), 'closest first');
  app.window.close();
});

// --- Rarity cards -----------------------------------------------------------

test('a rarity card leads with a big photo, a headline name and the evidence', async () => {
  const app = await boot();
  const A = app.window.__app;
  const li = A.birdCard({
    code: 'tersan', name: 'Terek Sandpiper', badges: '<span class="needflag">X</span>',
    sub: 'ABA Code 3+', stats: A.rarityStats([
      { userDisplayName: 'a', obsDt: '2026-07-28 09:00', locId: 'L1' },
      { userDisplayName: 'b', obsDt: '2026-07-28 10:00', locId: 'L1' },
      { userDisplayName: 'b', obsDt: '2026-07-29 10:00', locId: 'L2' },
    ], 'reports in Washington', [
      { subnational1Code: 'US-WA' }, { subnational1Code: 'US-WA' }, { subnational1Code: 'US-OR' },
    ]),
    where: '<div class="meta">somewhere</div>',
  });
  // The photo has to be a HERO slot, not the 46px list thumb: the whole point
  // of the card is that you can identify a bird you have never seen.
  const hero = li.querySelector('.bchero[data-hero]');
  assert.ok(hero, 'the card carries a hero photo slot');
  assert.equal(hero.getAttribute('data-code'), 'tersan',
    'and it is keyed by species code, so the bundled seed can back it up');
  assert.ok(li.querySelector('.bcname'), 'the name is a headline, not a row label');
  assert.match(li.querySelector('.bcname').textContent, /Terek Sandpiper/);
  const stats = [...li.querySelectorAll('.bcstat')].map(
    (s) => s.querySelector('b').textContent + ' ' + s.querySelector('small').textContent);
  // "How rare" is the reason this section exists, so it is counted, not adjectival.
  assert.deepEqual(stats, [
    '3 reports in Washington',
    '2 observers',
    '2 locations',
    '2 days seen',
    '3 locations ABA-wide',
    '2 states/provinces',
  ]);
  assert.ok(li.querySelector('.bcextract'), 'and a card back to fill with the blurb');
  app.window.close();
});

// Wikimedia's thumbnail widths are a WHITELIST, not a resizer: anything off the
// ladder answers HTTP 400. Measured by HEAD against three files with different
// originals (1200/2280/3849px) — all three returned 200 on exactly
// [250, 330, 500, 960, 1280, 1920] and 400 on every other width tried.
//
// This is the bug that made card photos blurry for three releases and survived a
// "fix": HERO_PX was 1024, which is off the ladder, so every hero request 400'd,
// the <img> error handler fired, and the card fell back to the 60px bundled seed
// stretched across a full-width frame. It filled the panel and showed the right
// bird, so it read as a bad PHOTO rather than a failed REQUEST — and raising the
// constant 640 -> 1024 moved it from one off-ladder value to another.
//
// So the guard is not "HERO_PX equals N". It is that no width can ever leave the
// app without being snapped onto a rung.
test('every Wikimedia width the app asks for is on the served ladder', async () => {
  const app = await boot();
  const A = app.window.__app;
  const src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/320px-X.jpg';
  assert.ok(A.WIKI_THUMB_LADDER.includes(A.HERO_PX),
    'HERO_PX must be a width Wikimedia actually serves — off-ladder 400s silently');
  // Snapping UP is what makes a future tweak safe: an arbitrary constant lands
  // on a rung that exists instead of 400ing.
  assert.equal(A.ladderWidth(1024), 1280, 'an off-ladder request snaps up to the next rung');
  assert.equal(A.ladderWidth(640), 960, 'including the value this shipped with before');
  assert.equal(A.ladderWidth(250), 250, 'a width already on the ladder is left alone');
  assert.equal(A.ladderWidth(99999), 1920, 'and nothing can ask past the top rung');
  // widenThumb is the only caller, so it must route through the snap rather than
  // pasting the raw number into the URL.
  assert.equal(A.widenThumb(src, 1024),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/1280px-X.jpg',
    'widenThumb rewrites through ladderWidth, not with the caller’s number');
  assert.equal(A.widenThumb(src, A.HERO_PX),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/' + A.HERO_PX + 'px-X.jpg');
  // A URL with no width segment is a full-size original; rewriting it would
  // produce a 404, so it has to pass through untouched.
  const plain = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg';
  assert.equal(A.widenThumb(plain, 640), plain);
  app.window.close();
});

// These two sections answer DIFFERENT questions and now use different templates
// on purpose, which is a change from when they shared birdCard().
//   Today's rarities = the DAY'S LIST, one row per checklist. SMALL card, so a
//                      long day scans as evenly spaced lines; every field the
//                      markdown table prints is kept, labelled, below the row.
//   The ABA alert    = read about ONE continental rarity. Large card.
// Rendering the day's list as 13 full-screen baseball cards buried the next
// report under evidence nobody asked for. What must NOT drift is that the ABA
// card keeps its evidence, and that today's list keeps the same columns the
// markdown table prints.
test("today's rarities lists checklists; the ABA alert profiles one bird", () => {
  const today = HTML.slice(HTML.indexOf('function refresh()'),
    HTML.indexOf('function buildClosestSpots('));
  const aba = HTML.slice(HTML.indexOf('function renderAbaAlert('),
    HTML.indexOf('function birdcastSeason('));
  assert.match(aba, /birdCard\(\{/, 'the ABA alert builds large cards');
  assert.match(aba, /rarityStats\(/, 'and shows the rarity evidence');
  // Hydration is LAZY now: the profiles are a sub-page, hidden until one is
  // opened, and history/blurb/finder are a network call each — a dozen birds
  // nobody has opened is a dozen calls nobody asked for.
  const open = HTML.slice(HTML.indexOf('function abaOpenBird('),
    HTML.indexOf('function abaCloseBird('));
  assert.match(open, /hydrateCards\(card\)/, 'and the opened ABA card gets its blurb');
  assert.match(open, /card\.dataset\.hydrated/, 'once, not on every open');

  assert.doesNotMatch(today, /birdCard\(\{/,
    "today's rarities is a list, not 13 profiles — the large card is the wrong template");
  assert.doesNotMatch(today, /rarityStats\(/,
    'how rare each species is across the snapshot is what Last 7-Days answers');
  // It must use the shared MEDIUM card rather than hand-rolling a row.
  assert.match(today, /SpeciesCards\.medium\(\{/, 'the row is the shared medium card');
  assert.match(HTML, /<ul id="results" class="obs big xl">/,
    'and the list opts into the medium size');
  // The columns of the markdown table it mirrors: species, distance+place,
  // observer, time, checklist. Losing any of them makes the row undecidable,
  // and the whole point of the small card here was that NOTHING is dropped.
  assert.match(today, /photoSlot\(/, 'the row is illustrated');
  assert.match(today, /speciesLink\(/, 'the species name is the header, and it links');
  assert.match(today, /distMi/, 'how far away it is');
  assert.match(today, /recLocLink\(/, 'where');
  assert.match(today, /r\.observer/, 'who saw it');
  assert.match(today, /fmtDateTime\(/, 'and at what time — a bare date decides nothing');
  assert.match(today, /checklistLink\(/, 'with the checklist to cite');
  assert.match(today, /needTag\(/, 'unseen-this-year flag');
  assert.match(today, /stakeflag/, 'and the stakeout day count');
  // The overflow fields used to be LABELLED rows beneath the card — "OBSERVER
  // Neil Pankey" and "LATEST Aug 3 10:25 AM · S379634242". Two labelled rows
  // for two short facts spent three lines of a phone screen on values whose
  // LABELS were longer than the values, and pushed the next bird off screen.
  // They are now one sub-line. The DATE LEADS — "show the date first in the
  // sentence" — because place names are long and variable ("Charles Richey Sr.
  // Viewpoint"), so a trailing date landed wherever the name happened to end
  // and often wrapped. The date is the thing that decides whether a rarity is
  // still worth chasing, so it is the thing you must be able to scan down.
  assert.doesNotMatch(today, /class="lbl">(Observer|Latest)</,
    'no labelled Observer/Latest rows — they are one line under the name now');
  assert.match(today, /sub: speciesMetaRow\(\{/,
    'date, place and observer are ONE sub-line — built by the SHARED row, so '
    + 'this section and Last 7-Days cannot drift apart again');
  assert.match(HTML, /function speciesMetaRow[\s\S]{0,2400}class="rarewhere"/,
    'and that row really is the one-line sub-header');
  // Order, pinned: the when-span is emitted BEFORE the loc-span.
  {
    const row = HTML.slice(HTML.indexOf('function speciesMetaRow'));
    const body = row.slice(0, row.indexOf('class="rarewhere"'));
    assert.ok(body.indexOf('o.when') < body.indexOf('o.loc'),
      'the date is pushed before the place, not after it');
  }
  assert.match(today, /checklistLink\(r\.subId, when\)/,
    'the time is the checklist link, so the submission id is not printed too');
  assert.doesNotMatch(today, /checklistLink\(r\.subId, r\.subId\)/,
    'the raw submission id is eleven characters of noise on a phone row');
  // Drawn separators, so a report with no observer, no count and no
  // stakeout cannot strand a "·" — the flags are optional now too.
  assert.match(HTML, /\.rarewhere > span \+ span::before/,
    'the separators are drawn by CSS, not typed into the string');
  // The NAME row carries the name alone. 🔍, ×count and 📍 Day N are facts
  // about the sighting, so they sit with the rest of them on the sub-line.
  assert.match(today, /tags: ''/, 'the header is the bird, and nothing else');
  assert.match(today, /flags: flags/, 'the flags moved to the sub-line');
  // The ORDER now lives in one function instead of at each call site, so it is
  // asserted there — and it holds for every section that uses the row, not
  // just this one.
  const row = HTML.slice(HTML.indexOf('function speciesMetaRow('),
    HTML.indexOf('function speciesMetaRow(') + 2400);
  const flagIdx = row.indexOf('class="rareflags"');
  const locIdx = row.indexOf('class="rareloc"');
  const whenIdx = row.indexOf('class="when"');
  const cntIdx = row.indexOf('class="rarecount"');
  // WHEN NOW PRECEDES WHERE. It used to be place-then-date, which put the one
  // fact that decides whether a rarity is still worth chasing behind a place
  // name of unpredictable length — so it landed in a different column on every
  // row, and usually wrapped. Flags stay first (do I need it, how many, has it
  // stuck around, is there proof) and the people counts stay last.
  assert.ok(flagIdx > -1 && whenIdx > flagIdx && locIdx > whenIdx && cntIdx > locIdx,
    'and read in the order the questions are asked: do I need it, how many, '
    + 'has it stuck around, is there proof — then WHEN, where, how many people');
});

// Reported from the device: the place name and its 🗺 link broke across two
// lines, leaving a lone ")" stranded underneath "Edmonds Waterfront ( 🗺".
test('the map link that trails a place name is one unbreakable token', () => {
  const src = HTML.slice(HTML.indexOf('function locLink('),
    HTML.indexOf('function recLocLink('));
  assert.match(src, /class="mapwrap"/, 'the parens and the glyph are wrapped together');
  assert.match(src, /\\u00a0\(/,
    'and glued to the last word of the name with a non-breaking space');
  assert.match(HTML, /\.mapwrap \{ white-space: nowrap; \}/,
    'the wrapper actually forbids the break — the class alone changes nothing');
});

// MEASURED, not assumed. Two separate live measurements, and the second one
// corrects the first:
//   1. The ABA alert page returns EXACTLY 500 observations, with no pagination,
//      no stated total and no truncation notice. Terek Sandpiper's slice read
//      26, 34, 34, 29, 36, 37 on consecutive days while the bird sat in one
//      place, so a stat built from alert row counts measured the cap.
//   2. The species-scoped region endpoint that replaced it returns exactly ONE
//      observation PER LOCATION -- max 1 row at any single location for every
//      species tested, where recent/notable returned 78 rows at one location
//      over the same window. So its length is a LOCATION count. Shipping it as
//      "reports ABA-wide" swapped a number that was too big for one that is too
//      small, which is worse: confidently precise and wrong.
// The label must therefore say locations, and this guard exists so it cannot
// drift back into claiming reports.
test('the ABA-wide stat counts locations, and says so', () => {
  const aba = HTML.slice(HTML.indexOf('function renderAbaAlert('),
    HTML.indexOf('function birdcastSeason('));
  assert.doesNotMatch(aba, /wideByCode/,
    'counting rows of a 500-capped alert reports the cap, not the bird');
  assert.match(aba, /rarityStats\([\s\S]{0,160}_abaWide\[/,
    'the ABA-wide stat must come from the species-scoped country feed');

  const stats = HTML.slice(HTML.indexOf('function rarityStats('),
    HTML.indexOf('function firstReport('));
  assert.match(stats, /label: 'locations ABA-wide'/,
    'the species endpoint returns one row per LOCATION — calling that a report count is wrong');
  assert.doesNotMatch(stats, /reports ABA-wide/,
    'a continent-wide REPORT count is not cheaply obtainable, so it must not be claimed');
  assert.match(stats, /label: 'states\/provinces'/,
    'subnational1Code across every location is accurate and worth stating');

  const wide = HTML.slice(HTML.indexOf('function abaWideHistory('),
    HTML.indexOf('function refresh()'));
  assert.match(wide, /ABA_WIDE_COUNTRIES/, 'it queries whole countries, not the alert');
  assert.match(wide, /data\/obs\/'\s*\+\s*c\s*\+\s*'\/recent\//,
    'a species-scoped region feed is the only ABA-wide source with no row cap');
  assert.match(wide, /detail=full/,
    'detail=simple drops userDisplayName and sciName, which the card needs');
  // Keyed by LOCATION so the number and its label cannot drift apart.
  assert.match(wide, /var k = r\.locId \|\|/,
    'dedupe by location, matching what the feed returns and what the stat claims');
  assert.doesNotMatch(wide, /abaArchiveKey\(r\)/,
    'a checklist key would let one location count twice and quietly restore a report count');
  // A country that failed to answer is not a country with no birds.
  assert.match(wide, /r == null; \}\)\) return null/,
    'a partial continent must stand the stat down rather than publish a floor as a total');
  const countries = /var ABA_WIDE_COUNTRIES = (\[[^\]]*\])/.exec(HTML);
  assert.ok(countries, 'the ABA area must name the countries it covers');
  assert.deepEqual(JSON.parse(countries[1].replace(/'/g, '"')), ['US', 'CA'],
    'the ABA area is the US and Canada — one country alone is not "ABA-wide"');
});

// The ABA alert caps at 500 observations continent-wide and says nothing about
// it — no total, no pagination, no notice. Three measured facts drive this:
//
//   1. The cap is hit EVERY day: a live parse returns exactly 500 rows.
//   2. That was invisible because the counts everyone looked at were taken
//      AFTER the region filter. Live: 500 parsed, 3 US-UM records dropped by
//      the ABA-area filter, 497 stored — and "never above 497" was read as
//      headroom for weeks. So truncation MUST be measured on the raw list,
//      before scoping to a state, or a 6-row Washington slice silently reports
//      a healthy feed.
//   3. The loss is directional. The page is grouped by species in taxonomic
//      order (49 species, exactly 49 contiguous runs, Taiga Bean-Goose through
//      Morelet's Seedeater), so the cut always takes the tail and whole species
//      vanish rather than each shedding a few rows.
//
// The failure mode is silence: a confident list of 6 birds out of an unknown
// number. These guards pin that the app detects the cap before filtering, says
// what kind of thing was lost, and stays quiet when the feed was complete.
test('a capped ABA alert is stated, and measured before the state filter', () => {
  const cap = /var ABA_ALERT_MAX_ROWS = (\d+)/.exec(HTML);
  assert.ok(cap, 'the app must name the cap it is checking against');
  assert.equal(cap[1], '500',
    'measured live against the alert page — it must match aba_rba.ALERT_MAX_ROWS');

  const load = HTML.slice(HTML.indexOf('function loadAbaAlert('),
    HTML.indexOf('function renderAbaAlert('));
  // The load order is the whole guard: the flag has to be taken off `list`
  // (unscoped) and it has to happen before `rows` narrows it.
  const iFlag = load.indexOf('_abaTruncated =');
  const iScope = load.indexOf('var rows = scoped');
  assert.ok(iFlag > -1, 'the app must detect truncation at all');
  assert.ok(iScope > -1, 'the state filter must still exist');
  assert.ok(iFlag < iScope,
    'truncation is measured on the raw feed — filtering first is exactly what hid it');
  assert.match(load, /_abaTruncated = list\.length >= ABA_ALERT_MAX_ROWS/,
    'it must count the unscoped list, not the state-scoped rows');
  assert.doesNotMatch(load, /_abaTruncated = rows\./,
    'counting the filtered rows would read a capped feed as healthy');

  const warn = HTML.slice(HTML.indexOf('function abaAlertWarning('),
    HTML.indexOf('function renderAbaAlert('));
  // Assert against the TRUNCATION branch specifically. Both branches mention
  // taxonomic order, so a whole-function match would stay green while the
  // truncation notice lost the only sentence that says what kind of thing went
  // missing — which is the difference between a warning and a shrug.
  const iEmpty = warn.indexOf('if (!rowCount)');
  assert.ok(iEmpty > -1,
    'an empty list cannot assert the state has no rarities — the cap may have eaten them');
  const truncBranch = warn.slice(0, iEmpty);
  assert.match(truncBranch, /taxonomic order/,
    'the warning must say WHICH species are lost, not merely that some are');
  assert.match(truncBranch, /falls on the tail/,
    'the loss is directional — a reader who thinks it is a random sample will trust the counts');
  assert.match(truncBranch, /ABA_ALERT_MAX_ROWS/,
    'the warning names the cap so the reader can check it');
  assert.match(warn.slice(iEmpty), /taxonomic order/,
    'the empty-state hedge must explain why absence is weak evidence');
  assert.match(warn, /return '';/,
    'a complete feed must raise no alarm, or the warning becomes noise');

  // The notice needs its own element: #abaResults is a <ul> whose class flips
  // to `cards` (a grid), so a warning appended there would be laid out as a card.
  // It ships `hidden`: a full-height warning above the results pushed the cards
  // off the first screen every single day, since the alert is capped every day.
  assert.match(HTML, /<div id="abaCapWarn" hidden><\/div>/,
    'the warning needs a container outside the results list, collapsed by default');
  const render = HTML.slice(HTML.indexOf('function renderAbaAlert('),
    HTML.indexOf('function birdcastSeason('));
  assert.match(render, /setAbaWarn\(abaAlertWarning\(/,
    'every repaint must refresh the warning, including the deepening pass');
  const setWarn = HTML.slice(HTML.indexOf('function setAbaWarn('),
    HTML.indexOf('function hydrateFinders('));
  assert.match(setWarn, /\$\('abaCapWarn'\)/, 'and it must write into that container');
  // The icon's PRESENCE is the signal. An always-visible ⚠ that is sometimes
  // inert is worse than none, so an empty warning must remove the button.
  assert.match(setWarn, /if \(!html\)[\s\S]{0,200}removeChild\(btn\)/,
    'nothing to warn about means no warning icon at all');
  assert.match(setWarn, /'warnbtn'/, 'the notice collapses behind a ⚠ button');
  assert.match(setWarn, /aria-expanded/, 'and the button states whether it is open');
});

// --- Favorite hotspots ------------------------------------------------------
test('favorites can be searched for, reordered and removed', async () => {
  const app = await boot();
  const A = app.window.__app;
  A.setFavs([]);
  ['A Park', 'B Marsh', 'C Point'].forEach((n, i) => {
    A.addFav({ locId: 'L' + i, locName: n, lat: 47 + i, lng: -122 });
  });
  assert.equal(A.addFav({ locId: 'L0', locName: 'A Park', lat: 47, lng: -122 }), false,
    'the same hotspot cannot be pinned twice');
  const names = () => arr(A.getFavs(), (f) => f.locName);
  assert.deepEqual(names(), ['A Park', 'B Marsh', 'C Point']);
  A.moveFav(2, -1);
  assert.deepEqual(names(), ['A Park', 'C Point', 'B Marsh'], 'up moves it up');
  A.moveFav(0, 1);
  assert.deepEqual(names(), ['C Point', 'A Park', 'B Marsh'], 'down moves it down');
  // A stale index from a list that re-rendered underneath must be a no-op, not
  // a silent rotation of the list.
  A.moveFav(0, -1); A.moveFav(2, 1); A.moveFav(99, -1);
  assert.deepEqual(names(), ['C Point', 'A Park', 'B Marsh'], 'out-of-range moves do nothing');
  A.removeFavAt(1);
  assert.deepEqual(names(), ['C Point', 'B Marsh'], 'delete removes exactly one');
  A.removeFavAt(9);
  assert.deepEqual(names(), ['C Point', 'B Marsh'], 'and an out-of-range delete removes none');
  app.window.close();
});

test('every saved hotspot carries its own move and delete controls', async () => {
  const app = await boot();
  const A = app.window.__app;
  A.setFavs([]);
  ['A Park', 'B Marsh', 'C Point'].forEach((n, i) => {
    A.addFav({ locId: 'L' + i, locName: n, lat: 47 + i, lng: -122 });
  });
  A.renderFavs();
  const rows = [...app.$('favResults').querySelectorAll('li')];
  assert.equal(rows.length, 3);
  rows.forEach((li, i) => {
    for (const cls of ['favup', 'favdown', 'favdel']) {
      const b = li.querySelector('.' + cls);
      assert.ok(b, 'row ' + i + ' has a .' + cls);
      // The control has to say which hotspot it acts on: three identical "▲"
      // buttons are unusable with a screen reader.
      assert.match(b.getAttribute('aria-label') || '', /A Park|B Marsh|C Point/);
    }
  });
  assert.ok(rows[0].querySelector('.favup').disabled, 'the first row cannot move up');
  assert.ok(rows[2].querySelector('.favdown').disabled, 'the last row cannot move down');
  assert.ok(!rows[1].querySelector('.favup').disabled);
  // Clicking is the path the user actually takes, so drive it through the DOM.
  app.click(rows[2].querySelector('.favup'));
  assert.deepEqual(arr(A.getFavs(), (f) => f.locName), ['A Park', 'C Point', 'B Marsh']);
  app.click(app.$('favResults').querySelectorAll('li')[0].querySelector('.favdel'));
  assert.deepEqual(arr(A.getFavs(), (f) => f.locName), ['C Point', 'B Marsh']);
  app.window.close();
});

test('hotspot search matches on word starts and ranks by species count', async () => {
  const app = await boot();
  const A = app.window.__app;
  const rows = [
    { locId: 'L1', locName: 'Edmonds Marina Beach Park', n: 210 },
    { locId: 'L2', locName: 'Edmonds Waterfront', n: 260 },
    { locId: 'L3', locName: 'Redmonds Ridge', n: 90 },
    { locId: 'L4', locName: 'Marymoor Park', n: 300 },
  ];
  const hit = (q) => arr(A.searchHotspots(rows, q), (h) => h.locName);
  // Substring matching would drag "Redmonds Ridge" in on "edm", which is how a
  // lookup field stops being trusted.
  assert.deepEqual(hit('edm'), ['Edmonds Waterfront', 'Edmonds Marina Beach Park']);
  assert.deepEqual(hit('edmonds marina'), ['Edmonds Marina Beach Park'],
    'multiple words all have to match, in any order');
  assert.deepEqual(hit('marina edmonds'), ['Edmonds Marina Beach Park']);
  assert.deepEqual(hit('e'), [], 'one letter is not a search');
  assert.deepEqual(hit('  '), []);
  app.window.close();
});

test('the hotspot list is fetched once per region per day, then searched offline', async () => {
  const rows = [{ locId: 'L1', locName: 'Edmonds Waterfront', lat: 47.8, lng: -122.4, numSpeciesAllTime: 260 }];
  const app = await boot({
    fetch: (url) => (/ref\/hotspot\//.test(url) ? rows : null),
  });
  const A = app.window.__app;
  app.$('favSearch').value = 'edmonds';
  A.runFavSearch();
  await new Promise((r) => setTimeout(r, 30));
  const calls = () => app.state.fetches.filter((u) => /ref\/hotspot\//.test(u));
  assert.equal(calls().length, 1, 'one region read');
  assert.match(calls()[0], /ref\/hotspot\/US-WA\?fmt=json/, 'scoped to the active report');
  const found = [...app.$('favFound').querySelectorAll('li')];
  assert.equal(found.length, 1);
  assert.match(found[0].textContent, /Edmonds Waterfront/);
  // Typing is not a network activity: a second search must hit the cache.
  app.$('favSearch').value = 'waterfront';
  A.runFavSearch();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls().length, 1, 'the second search reuses the cached region');
  // And the add button pins it.
  app.click(app.$('favFound').querySelector('.favadd'));
  assert.deepEqual(arr(A.getFavs(), (f) => f.locId), ['L1']);
  app.window.close();
});

// --- Bird icons -------------------------------------------------------------

// A `.thumb` is `float: left` by default. A float overhangs whatever follows it,
// and `.cklrows li` is a GRID, which refuses to overlap floats — so a row whose
// name+meta is SHORTER than the 46px thumbnail had its detail grid shoved and
// clipped by the overhang. It showed up as "Stanwood Water" sliced through by
// the divider above it, and only on the short rows ("1 report"), which is why
// it read as random. `.obs.big` sets `float: none` and lays the row out with
// flex, which removes the overhang entirely. jsdom cannot lay out, so this
// guards the STRUCTURAL precondition instead of the pixels.
test('rarity/tick lists that render a .cklrows grid must clear the thumb float', () => {
  for (const id of ['activeResults', 'lastNewResults']) {
    const m = new RegExp(`<ul id="${id}" class="([^"]*)"`).exec(HTML);
    assert.ok(m, `${id} must exist as a class-carrying list`);
    assert.ok(m[1].split(/\s+/).includes('big'),
      `${id} renders .cklrows under a .thumb, so it needs the float-clearing `
      + `"big" layout; it has class="${m[1]}"`);
  }
  assert.match(CARDS_SPECIES, /\.obs\.big \.thumb \{[^}]*float:\s*none/,
    '.obs.big is the float-clearing layout — if it stops clearing, the guard above means nothing');
  // Today's rarities renders .cklrows under a .thumb too. It is a MEDIUM card
  // now, so it relies on .obs.big clearing the float — pinned just above.
  const today = /<ul id="results" class="([^"]*)"/.exec(HTML);
  assert.ok(today && today[1].split(/\s+/).includes('big'),
    "today's rarities must carry a size that clears the float");
  // Baseline alignment on a grid row whose cell wraps to 3 lines is the other
  // half of the clipping; `start` grows the row downward predictably. This
  // applies to the labelled variant too — its value cell is a place name.
  assert.doesNotMatch(HTML, /\.cklrows li \{[^}]*align-items:\s*baseline/,
    '.cklrows rows must not be baseline-aligned — a wrapped place name overflows the row');
  assert.doesNotMatch(HTML, /\.cklrows li\.lblrow \{[^}]*align-items:\s*baseline/,
    'nor may the labelled variant — same wrapped place name, same overflow');
});

// The bird photo is the answer to "what IS that", so the rarity list sizes it to
// be identified. The name and its badges must stay in ONE grid cell, or a long
// name wraps into the sub-header's row and the two rows collide.
test('Last 7-Days rarity rows use the shared medium card, not a lookalike', () => {
  assert.match(HTML, /<ul id="activeResults" class="[^"]*\bxl\b/,
    'the rarity list opts into the enlarged treatment');
  assert.match(CARDS_SPECIES, /\.obs\.xl > li > \.name > \.thumb \{ width: calc\(70px \* var\(--s\)\)/,
    'the rarity thumbnail is larger than the 46px seed-sized default, and scales with the text-size setting');
  // It used to hand-roll .name/.ntext/.meta — a second copy of the medium card
  // that could drift from the real one, which is exactly what happened to Easy
  // misses before it was unified.
  const fn = HTML.slice(HTML.indexOf('function loadActiveRarities('));
  const row = fn.slice(0, fn.indexOf('hydratePhotos(el)'));
  assert.match(row, /SpeciesCards\.medium\(\{/,
    'the row is built from the shared template, not rebuilt inline');
  assert.ok(!/'<div class="name">'/.test(row),
    'and does not hand-roll the card markup alongside it');
  assert.match(row, /distMi: r\.distMi/,
    'the drive is a real column now, not a token inside the sub-header');
});

// The seed exists so an arbitrary region's report is mostly illustrated with no
// network at all. That guarantee is a property of the FILES on disk, not of the
// rendering code, so it gets its own check: a silently-missed copy step would
// otherwise only show up as blank thumbnails on a sideloaded device.
test('the bundled icon seed is present, well-named, and attributed', () => {
  const dir = path.join(WWW, 'assets', 'birds');
  assert.ok(fs.existsSync(dir), 'www/assets/birds must ship with the app');
  const files = fs.readdirSync(dir).filter((f) => /\.(jpg|png)$/i.test(f));
  assert.ok(files.length > 500,
    `seed too small (${files.length}) — did the copy from birding/assets/birds run?`);
  // Tier 1 resolves <speciesCode>.<ext> by convention, so a stray filename is
  // simply invisible to the app.
  for (const f of files) {
    assert.match(f, /^[a-z0-9]+\.(jpg|png)$/, `unreachable icon filename: ${f}`);
  }
  // Wikimedia's CC licences permit shipping these copies only WITH credit.
  assert.ok(fs.existsSync(path.join(dir, 'CREDITS.md')),
    'CREDITS.md is a licence requirement, not documentation');
});

test('bird icons: a seeded species renders from the bundle with no network', async () => {
  const app = await boot();
  const w = app.window;
  const before = app.state.fetches.length;
  const host = w.document.createElement('div');
  host.innerHTML = w.BirdIcons.photoSlot('Gray Catbird', 'grycat');
  w.document.body.appendChild(host);
  const slot = host.querySelector('.thumb');
  assert.equal(slot.getAttribute('data-code'), 'grycat',
    'the species code must reach the slot — it is what makes tier 1 hit');
  w.BirdIcons.hydratePhotos(host);
  const img = host.querySelector('img.birdpic');
  assert.ok(img, 'a seeded species must render an <img>');
  assert.match(img.getAttribute('src'), /^assets\/birds\/grycat\.(jpg|png)$/,
    'must load the bundled file, not a remote URL');
  assert.equal(app.state.fetches.length, before,
    'a bundled icon must cost zero network requests');
});

test('bird icons: a slot with no species code falls back to the lookup path', async () => {
  const app = await boot();
  const w = app.window;
  const host = w.document.createElement('div');
  host.innerHTML = w.BirdIcons.photoSlot('Some Unbundled Bird', '');
  w.document.body.appendChild(host);
  assert.equal(host.querySelector('.thumb').hasAttribute('data-code'), false);
  w.BirdIcons.hydratePhotos(host);
  // No bundled path to try, so nothing may render synchronously; the slot is
  // handed to the queue/observer instead.
  assert.equal(host.querySelector('img.birdpic'), null,
    'an uncoded slot must not invent a bundled path');
});

test('bird icons: a species with no photo gets the generic silhouette', async () => {
  const app = await boot();
  const w = app.window;
  const host = w.document.createElement('div');
  host.innerHTML = w.BirdIcons.photoSlot('Mystery Bird', '');
  w.document.body.appendChild(host);
  const slot = host.querySelector('.thumb');
  w.BirdIcons.showFallback(slot);
  const img = slot.querySelector('img.birdpic');
  assert.ok(img, 'a bird with no photo must still occupy the slot');
  assert.equal(img.getAttribute('src'), 'assets/birds/' + w.BirdIcons.fallback);
  assert.equal(slot.classList.contains('nopic'), false,
    'the slot must not collapse — a ragged column is the thing icons fix');
  // A real photo must always win: the fallback is a floor, not an overwrite.
  const host2 = w.document.createElement('div');
  host2.innerHTML = w.BirdIcons.photoSlot('Gray Catbird', 'grycat');
  w.document.body.appendChild(host2);
  w.BirdIcons.hydratePhotos(host2);
  w.BirdIcons.showFallback(host2.querySelector('.thumb'));
  assert.equal(host2.querySelectorAll('img.birdpic').length, 1,
    'fallback must not stack on top of a resolved icon');
  assert.match(host2.querySelector('img.birdpic').getAttribute('src'), /grycat/);
});

test('the fallback icon ships with the app', () => {
  const p = path.join(WWW, 'assets', 'birds', 'fallback.svg');
  assert.ok(fs.existsSync(p), 'fallback.svg must ship — it is the floor for every miss');
  const svg = fs.readFileSync(p, 'utf8');
  assert.match(svg, /<svg[^>]*viewBox/, 'must be a real SVG');
  assert.ok(svg.length < 4096, 'fallback should stay tiny');
});


test('rankings: the board is scoped to the active report and includes the Top 100', async () => {
  // Two shipped bugs live here. v1.0.10: the scope control had no change
  // listener, so a stale board sat under the wrong heading. v1.0.12 removed the
  // control entirely — rankings and the board are one section scoped to the
  // region you picked — so the guard is now "the board follows the report".
  const app = await boot();
  app.open(/eBird Rankings/);
  await new Promise((r) => setTimeout(r, 40));
  const top100 = app.state.fetches.filter((u) => /top100/.test(u));
  assert.ok(top100.length, 'opening the section loads a leaderboard');
  assert.ok(top100.every((u) => /US-WA/.test(u)),
    'a Washington report must load ONLY the Washington board');
  assert.match(app.$('rankRegionLabel').textContent, /Washington/,
    'the heading names the region, not the raw region code');
  assert.ok(!app.$('rankScope'), 'the scope selector is gone — region comes from the report');
  const src = HTML.slice(HTML.indexOf('function renderRankings('),
    HTML.indexOf('function loadLastNew('));
  assert.match(src, /Top ' \+ TOP_BOARD_N \+ ' eBirders/,
    'the merged section labels its board from the shared board size');
  assert.match(src, /slice\(0, TOP_BOARD_N\)/,
    'the board is capped at TOP_BOARD_N, like rankings.TOP_BOARD_N in the report');
  assert.match(HTML, /var TOP_BOARD_N = 100;/, 'and that size is eBird\'s published top 100');
  app.window.close();
});

test('rankings follow the region: a Lower 48 report loads the Lower 48 board', async () => {
  const app = await boot({ report: 'lower48' });
  app.open(/eBird Rankings/);
  await new Promise((r) => setTimeout(r, 40));
  const top100 = app.state.fetches.filter((u) => /top100/.test(u));
  assert.ok(top100.length, 'the rarity tracker still has a leaderboard');
  assert.ok(top100.every((u) => /lower48/.test(u)),
    'switching the report re-scopes the board — no US-WA rows under a Lower 48 title');
  assert.match(app.$('rankRegionLabel').textContent, /Lower 48/);
  app.window.close();
});

test('region nav: switching region rewrites the menu, the home and the storage', async () => {
  const app = await boot();
  const sel = app.$('menuRegion');
  assert.ok(sel, 'the Contents header carries a region picker');
  assert.ok(app.$('navRegion'), 'so does the section navbar, so you can switch without going back');
  assert.equal(sel.value, 'wa', 'the picker opens on the remembered report');
  const waLinks = app.links().length;
  const waHome = app.window.localStorage.getItem('ebird_home_lat:wa');
  assert.equal(waHome, '47.75', 'a home saved before per-region homes migrates to the active region');

  sel.value = 'lower48';
  sel.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(app.window.localStorage.getItem('ebird_report'), 'lower48',
    'the choice is persisted, so the app reopens on it');
  assert.equal(app.$('navRegion').value, 'lower48', 'both pickers stay in sync');
  assert.ok(app.links().length < waLinks,
    'a rarity tracker has no counties and no home: its report emits fewer sections, ' +
    'so the menu must shrink instead of listing dead ends');
  assert.ok(!app.links().some((a) => /Birder convoys|BirdCast|Migration outlook/.test(a.textContent)),
    'county-only sections disappear for a report that has no counties');
  assert.ok(app.links().some((a) => /eBird Rankings/.test(a.textContent)),
    'sections the rarity report does emit stay');
  assert.deepEqual(app.state.errors, [], 'no uncaught errors while switching region');
  app.window.close();
});

test('each region keeps its own home location', async () => {
  const app = await boot();
  const A = app.window.__app;
  const wa = A.getHome();
  assert.equal(wa.lat, 47.75, 'WA uses the saved home');
  assert.equal(wa.lng, -122.16);
  app.window.localStorage.setItem('ebird_report', 'waikoloa');
  const hi = A.getHome();
  assert.notEqual(hi.lat, 47.75,
    'a home saved for Washington must not be used to chase birds on the Big Island');
  assert.ok(hi.lat > 15 && hi.lat < 25,
    'the trip report falls back to its own regions.py home');
  assert.equal(A.homeKey('lat'), 'ebird_home_lat:waikoloa', 'storage is keyed per report');
  app.window.close();
});

test('birder convoys list checklists per stop and never name the members', async () => {
  const app = await boot();
  const src = HTML.slice(HTML.indexOf('function renderConvoys('),
    HTML.indexOf('function loadConvoySpecies('));
  assert.ok(!/members\.join/.test(src),
    'convoy rows must not print member names — the checklist links show who filed');
  assert.match(src, /r\.members\.length/, 'the group is described by a birder count');
  assert.match(src, /s\._subs/, 'every member checklist at a stop gets a link, not just the first');
  app.window.close();
});

/*
 * The rankings section shipped broken TWICE: the heading said Washington while
 * the rows were the Lower 48 board. Every label derives from the active report,
 * so the labels were right and only the DATA was wrong - which means no test
 * that checks the UI can catch it. The fix is to make the parser read the
 * region eBird itself declares on the page and refuse anything else, so these
 * tests drive that check directly.
 */
const FIX = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

test('parseRankingsHTML reports which board eBird actually served', async () => {
  const app = await boot();
  const A = app.window.__app;
  const wa = A.parseRankingsHTML(FIX('top100-wa.html'), 'Birder Wyatt');
  assert.equal(wa.region, 'US-WA', 'the WA page identifies itself as US-WA');
  assert.equal(wa.rows[0].name, 'sally frandsen', 'rows still parse');
  assert.equal(wa.me.rank, 211, 'and so does your own standing');
  const l48 = A.parseRankingsHTML(FIX('top100-lower48.html'), 'Birder Wyatt');
  assert.equal(l48.region, 'lower48',
    'the two boards are the same markup with a different region - telling them ' +
    'apart is the ONLY defence against rendering one under the other\'s heading');
  app.window.close();
});

test('fetchRank rejects a leaderboard for the wrong region', async () => {
  // Ask for Washington, have every URL form answer with the Lower 48 board:
  // exactly the bug the user reported, reproduced offline.
  const app = await boot({ fetch: (u) => (/top100/.test(u) ? FIX('top100-lower48.html') : null) });
  const A = app.window.__app;
  let err = null;
  await A.fetchRank({ key: 'wa', region: 'US-WA', max: 500 }, 2026, 'Birder Wyatt')
    .then(() => {}, (e) => { err = e; });
  assert.ok(err, 'a Lower 48 board must never satisfy a request for Washington');
  assert.match(String(err.message), /Lower 48/,
    'the error names the board eBird returned, so the failure is diagnosable on device');
  const tried = app.state.fetches.filter((u) => /top100/.test(u));
  assert.ok(tried.length > 1, 'the alternate URL forms are tried before giving up');
  app.window.close();
});

test('fetchRank accepts the right board and caches it by region', async () => {
  const app = await boot({ fetch: (u) => (/top100/.test(u) ? FIX('top100-wa.html') : null) });
  const A = app.window.__app;
  const d = await A.fetchRank({ key: 'wa', region: 'US-WA', max: 500 }, 2026, 'Birder Wyatt');
  assert.equal(d.me.rank, 211);
  assert.equal(d.region, 'US-WA');
  const n = app.state.fetches.filter((u) => /top100/.test(u)).length;
  assert.equal(n, 1, 'the first URL form matched, so no fallback was needed');
  await A.fetchRank({ key: 'wa', region: 'US-WA', max: 500 }, 2026, 'Birder Wyatt');
  assert.equal(app.state.fetches.filter((u) => /top100/.test(u)).length, n,
    'a second read comes from the day cache');
  app.window.close();
});

test('a cached board from the wrong region is treated as a miss', async () => {
  // The phone had a poisoned cache entry that survived every reload; keying by
  // URL alone made it undetectable. The entry must now prove what it holds.
  const app = await boot({ fetch: (u) => (/top100/.test(u) ? FIX('top100-wa.html') : null) });
  const A = app.window.__app;
  A.rankCachePut('US-WA|2026|500|Birder Wyatt',
    { rows: [{ rank: 1, name: 'David McQuade' }], me: { rank: 1 }, region: 'lower48' });
  const d = await A.fetchRank({ key: 'wa', region: 'US-WA', max: 500 }, 2026, 'Birder Wyatt');
  assert.equal(d.region, 'US-WA', 'the stale Lower 48 entry was discarded');
  assert.equal(d.rows[0].name, 'sally frandsen', 'and refetched from eBird');
  app.window.close();
});

test('Latest ticks reads ONE leaderboard: the active report\'s', async () => {
  // It used to union this region + Lower 48, so a Washington chase board
  // listed European Goldfinch, Yellow-headed Amazon and Palila - and, when
  // both fetches returned the same board, every birder twice.
  const app = await boot({ fetch: (u) => (/top100/.test(u) ? FIX('top100-wa.html') : null) });
  const A = app.window.__app;
  const src = HTML.slice(HTML.indexOf('function loadLastNew('),
    HTML.indexOf('function lastNewChecklists('));
  assert.ok(!/lower48/.test(src),
    'the section must not reach for the Lower 48 board: a shared newest tick ' +
    'only means "go get it" if those birders are birding where you are');
  assert.match(src, /rankPrimaryRegion\(\)/,
    'it follows the same one-report-one-board rule as the rankings section');

  app.open(/Latest ticks/);
  await new Promise((r) => setTimeout(r, 120));
  const boards = app.state.fetches.filter((u) => /top100/.test(u));
  assert.equal(boards.length, 1, 'exactly one leaderboard is fetched');
  assert.match(boards[0], /US-WA/, 'and it is the active report\'s region');
  app.window.close();
});


test('rankings: your standing is painted ONCE, above an aligned board', async () => {
  // Through v1.0.13 the section rendered the same four numbers twice - a
  // summary list AND a big-number header - then a run-on "198 species / 337
  // checklists / recent: ..." line per birder. That duplication is the
  // readability bug, so the guard is structural rather than cosmetic.
  // The identity must be set explicitly now. getDisplayName() no longer defaults
  // to any name, because that default was the author's and it is what the
  // leaderboard lookup keys on — a fresh install used to show his rank as yours.
  // Setting it here is what a configured user actually does.
  const app = await boot({
    storage: { ebird_display_name: 'Birder Wyatt' },
    fetch: (u) => (/top100/.test(u) ? FIX('top100-wa.html') : null),
  });
  app.open(/eBird Rankings/);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(app.document.querySelectorAll('.rankcard').length, 1,
    'exactly one standing card - your rank is not printed twice');
  const bigs = [...app.document.querySelectorAll('.rankbig, .bignum')]
    .map((e) => e.textContent).filter((t) => /#/.test(t));
  assert.deepEqual(bigs, ['#211'], 'your rank appears once, as one big number');
  assert.equal(app.document.querySelectorAll('.rankcard .rankstats > div').length, 2,
    'species and checklists are labelled stats, not a run-on sentence');

  const rows = [...app.document.querySelectorAll('.ranktable .rankrow:not(.rankhdr)')];
  assert.ok(rows.length && rows.length <= 100,
    'the board renders and is capped at the Top 100 the report prints');
  assert.equal(rows[0].querySelector('.rk').textContent.trim(), '1');
  assert.match(rows[0].querySelector('.who').textContent, /sally frandsen/);
  assert.deepEqual([...rows[0].querySelectorAll('.n')].map((e) => e.textContent.trim()),
    ['337'],
    'rank/birder/species only — checklists is effort, not standing, and cost a ' +
    'quarter of the width on a phone');
  assert.ok(app.document.querySelector('.rankhdr'),
    'the column is headed, so the number is not ambiguous');
  const named = rows[0].querySelector('.who a');
  assert.ok(named && /#sally/.test(named.getAttribute('data-href')),
    'each birder deep-links to their own row on the board, as the report does');
  app.window.close();
});


test('rankings: each board read is recorded, because eBird cannot re-serve a past standing', async () => {
  // ebird.org/top100 has no "as of date" endpoint - ?year= is year-to-date - so
  // a rank you did not record is gone. The Markdown report archives a dated
  // board per run; the app has no GitHub access by design, so it keeps its own
  // forward-only history and can never backfill.
  const app = await boot({
    storage: { ebird_display_name: 'Birder Wyatt' },
    fetch: (u) => (/top100/.test(u) ? FIX('top100-wa.html') : null),
  });
  app.open(/eBird Rankings/);
  await new Promise((r) => setTimeout(r, 150));
  const raw = app.window.localStorage.getItem('ebird_rankhist:US-WA');
  assert.ok(raw, 'reading the board writes a history entry for the region');
  const hist = JSON.parse(raw);
  assert.equal(hist.length, 1, 'one entry per day, not one per render');
  assert.equal(hist[0].rank, 211, 'and it records the rank actually shown');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(hist[0].d), 'stamped with the day it was read');

  // A second read on the same day must overwrite, not append: the report caches
  // its board daily too, so two opens in one afternoon are one data point.
  app.window.__app.renderRankings(
    { rows: [], me: { name: 'Birder Wyatt', rank: 208, species: 199 } }, 'US-WA', '', 'Birder Wyatt');
  const after = JSON.parse(app.window.localStorage.getItem('ebird_rankhist:US-WA'));
  assert.equal(after.length, 1, 'still one entry for today');
  assert.equal(after[0].rank, 208, 'and it is the latest read of the day');
  assert.ok(app.document.querySelector('.ranktrend'),
    'the standing card shows the trend that history feeds');
  app.window.close();
});

test('rankings: your own row on the board is highlighted', async () => {
  const app = await boot({ fetch: (u) => (/top100/.test(u) ? FIX('top100-wa.html') : null) });
  const A = app.window.__app;
  A.renderRankings(A.parseRankingsHTML(FIX('top100-wa.html'), 'sally frandsen'),
    'US-WA', 'https://ebird.org/top100', 'sally frandsen');
  const me = app.document.querySelectorAll('.ranktable .rankme');
  assert.equal(me.length, 1, 'the birder you are gets exactly one highlighted row');
  assert.match(me[0].textContent, /sally frandsen/);
  assert.equal(me[0].querySelector('.rk').textContent.trim(), '1');
  app.window.close();
});

test("Today's rarities render the report's section, not a raw notable feed", () => {
  // The app read /recent/notable directly, which is eBird's 14-DAY window, so
  // it listed birds the report never printed. BirdLogic.notableToday IS
  // report.py::section_today and is covered by the cross-repo golden.
  const src = HTML.slice(HTML.indexOf('function refresh()'),
    HTML.indexOf('function loadTargets('));
  assert.match(src, /cv\.notableToday/,
    'the section must come from the parity-tested view, not its own fetch');
  assert.ok(!/recent\/notable/.test(src),
    'no raw notable read: that window is 14 days, the section is today only');
  assert.ok(!/dedupeObs/.test(src),
    'dedupe by checklist, as the report does - not by species+location');
});

test('convoys render one block per convoy: title, map, birds, checklists', () => {
  const src = HTML.slice(HTML.indexOf('function renderConvoys('),
    HTML.indexOf('function hydrateConvoySpecies('));
  // The title comes from the SHARED helper, not a local string: two groups out
  // on the same day both rendered as "Jul 28 Convoy of 2", so the second read
  // as a duplicate of the first and the section looked like it had lost a
  // route. report._convoy_title is the other half of this pair.
  assert.match(src, /BL\.convoyTitle\(/,
    'the heading is built by the shared helper the report also uses');
  assert.equal(
    BL.convoyTitle('Jul 28', 2, 3, 16, 1) === BL.convoyTitle('Jul 28', 2, 2, 6, 0),
    false,
    'two same-day, same-size convoys do not collapse into one title');
  assert.match(BL.convoyTitle('Jul 28', 2, 3, 16, 1), /3 stops · 16 species · 🔍 1 unseen/,
    'the title says stops, species and how many birds you still need');
  assert.ok(BL.convoyTitle('Jul 28', 2, 3, 0, 0).indexOf('species') < 0,
    'no loaded detail omits the species clause rather than printing 0');
  assert.match(src, /convoyMap/, 'and carries its own map of that convoy\'s hotspots');
  assert.ok(!/<details|<summary/.test(src),
    'nothing in the section collapses - the user asked for plain lists');
  const spp = HTML.slice(HTML.indexOf('function loadConvoySpecies('),
    HTML.indexOf('function loadConvoys('));
  assert.ok(spp.indexOf('Unseen') > -1 && spp.indexOf('Already seen') > -1,
    'species are split into an unseen list and a seen list');
  assert.ok(spp.indexOf('Unseen') < spp.indexOf('Already seen'),
    'unseen birds come first - they are the reason to chase the route');
  assert.match(spp, /<ul class="convoysppl">/,
    'both are plain lists, not collapsed toggles');
  // "Nothing here for you" is the whole answer for a convoy, so it is sized
  // like an answer instead of a dim aside the eye slides past.
  assert.match(spp, /class="allseen"/,
    'a route with no unseen birds says so in a full-size label');
  assert.match(spp, /retitleConvoy\(/,
    'and the species counts are folded back into the heading once loaded');
});

// ---------------------------------------------------------------------------
// v1.0.15: seven "the app is not the report" follow-ups.
// ---------------------------------------------------------------------------

test('tides: one row per WINDOW, rising windows highlighted', async () => {
  // The old table had one row per turning point ("High 3:11 am · Falling to
  // 10:20 am"), which buried the only thing that decides whether to go out:
  // when the tide is coming IN. weather.py::summarize now emits windows.
  const app = await boot({ fetch: () => null });
  const rows = app.window.__app.buildTideRows([
    { t: '2026-07-27 03:11', v: '9.464', type: 'H' },
    { t: '2026-07-27 10:20', v: '-1.021', type: 'L' },
    { t: '2026-07-27 18:26', v: '11.223', type: 'H' },
    { t: '2026-07-27 23:47', v: '7.401', type: 'L' },
  ]);
  assert.equal(rows.length, 4, 'three windows between four points, plus overnight');
  assert.equal(rows[0].rising, false);
  assert.equal(rows[1].rising, true, 'low -> high is the rising window');
  assert.match(rows[1].window, /10:20 am .* 6:26 pm/, 'a window names both ends');
  assert.equal(rows[1].span, '8h 6m', 'and how long it lasts');
  assert.match(rows[3].window, /overnight/,
    'the last turning point starts a window that runs past midnight');
  assert.equal(rows[3].rising, true,
    'and dropping it would hide an overnight incoming tide entirely');
  app.window.close();
});

test('tides: the rising rows are visually marked, not just labelled', async () => {
  const app = await boot({ fetch: () => null });
  // Dated today so the table has something current to show — the section now
  // drops windows that have already finished, because a window you cannot
  // stand in is only in the way of one you can.
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const at = (h, m) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(h)}:${p(m)}`;
  app.window.__app.renderTides([
    { t: at(3, 11), v: '9.4', type: 'H' },
    { t: at(10, 20), v: '-1.0', type: 'L' },
    { t: at(18, 26), v: '11.2', type: 'H' },
    { t: at(23, 47), v: '7.4', type: 'L' },
  ], 'Seattle');
  const shown = [].slice.call(app.document.querySelectorAll('#wxTides tbody tr'));
  const marked = shown.filter((tr) => tr.classList.contains('tiderise'));
  assert.ok(marked.length >= 1, 'an incoming tide is still on the table');
  // The rule is "every rising window is highlighted", not "exactly N are" —
  // which rows survive depends on the wall clock, but the mapping never does.
  shown.forEach((tr) => {
    const rising = /Rising/.test(tr.textContent);
    assert.equal(tr.classList.contains('tiderise'), rising,
      'the highlight marks exactly the rising windows');
    if (rising) {
      assert.match(tr.textContent, /\u{1F986}|\u{1F440}/u,
        'and each carries a marker saying whether it is prime daylight or after dark');
    }
  });
  app.window.close();
});

// Reported with a screenshot: a Quick outing card headed "3 unseen 🔍" whose
// three rows showed the marker on exactly one of them. All three unmarked birds
// — Short-billed Dowitcher, Western Sandpiper, Peregrine Falcon — are on the
// WATCHLIST.
//
// The list membership came from getReportSeen(), which subtracts the watchlist,
// so the heading was right. The row marker came from isSpeciesSeen(), which read
// a set that does not — and then, one level down, matched the bird by NAME
// against a pool unioned across every region. Two sources of truth for the one
// question the whole app is built on, disagreeing on the same card.
// "add the icon everywhere a rare species appears. if its a rare bird it should
// be in the 7 day rare bird list."
//
// That is an invariant about two sections agreeing, so it is pinned at the
// SOURCE they agree through rather than by comparing two rendered lists: both
// the hotspot species index and the Last 7-Days builder read `kind === 'Rarity'`
// off the same cv.merged records. If either ever grows its own idea of rare,
// this fails.
// "the here, home, find menu in the quick outings - id like these same options
// for top destinations, top excursions, and closest spot with unseen birds. all
// four of these go birding menus can have one common template shared across all
// four. the difference is the algorithm."
// F27, item 1. product/checklist/view is 66% of every eBird call the report
// makes (206 of 310, measured), and the app reads it from four places for the
// same checklists on the same day. It was memoised in memory for 30 minutes, so
// every relaunch bought them all again at 0.37 calls/second.
//
// The test that matters is the RELAUNCH, because that is the case the old cache
// could not serve: same localStorage, brand new window.
// "do 10 but prioritize unseen birds by how common the species appears" —
// clarified as: rank the GBIF CALLS.
//
// Due back soon wants an arrival window per unseen species, which is one GBIF
// request each, and there are ~40 unseen species on a normal day. The budget is
// therefore spent in rank order rather than on whoever sorts first.
// F29. "with rare birds, often people make checklists from custom checklist
// locations. these tiny pins are visible on the ebird map."
//
// They were already in the feeds (23 of 189 King County notable rows over 14
// days) and were being FILTERED OUT: isReachable drops a private location
// unless it is a stakeout, which kept 5 and dropped 18.
//
// *** THE CAVEATS BELOW ARE KEPT DELIBERATELY, FOR REVIEW AFTER ITERATION 1 ***
test('a personal pin beside a public hotspot becomes chaseable', async () => {
  const app = await boot();
  const BL = app.window.BirdLogic;
  const hotspots = [{ lat: 47.6570, lng: -122.2900, name: 'Union Bay Natural Area' }];
  const recs = [
    // Measured cases, at their real distances from the nearest hotspot.
    { locId: 'L1', loc: 'Union Bay Natural Area', lat: 47.6579, lon: -122.2900,
      location_private: true },                                    // ~100 m
    { locId: 'L2', loc: 'Ravenna apartment', lat: 47.6617, lon: -122.2900,
      location_private: true },                                    // ~520 m
    { locId: 'L3', loc: 'Sandel Lookout', lat: 47.6578, lon: -122.2900,
      location_private: true },                                    // ~90 m
    { locId: 'L4', loc: 'Big Park', lat: 47.6570, lon: -122.2900 }, // a hotspot
  ];
  const pub = BL.publicPersonalLocids(recs, hotspots);
  assert.ok(pub.L1, 'a pin inside a hotspot is a public place');
  assert.ok(pub.L3, 'and so is one 90 m away');
  assert.ok(!pub.L2, 'somebody\u2019s apartment is not, even at the same distance');
  assert.ok(!pub.L4, 'a public hotspot is not a personal pin and is not listed here');

  // CAVEAT 1 — DISTANCE IS NOT THE SAFETY NET. "Ravenna apartment" is 516 m
  // from Ravenna Park: it fails by SIXTEEN METRES. A home 400 m from a park
  // would pass on distance alone, so the NAME test is what actually protects a
  // private address. This asserts the name test stands on its own.
  const closeApartment = [{ locId: 'L9', loc: 'Ravenna apartment',
    lat: 47.6572, lon: -122.2900, location_private: true }];       // ~20 m
  assert.ok(!BL.publicPersonalLocids(closeApartment, hotspots).L9,
    'a home 20 m from a hotspot is STILL not published — the name decides, '
    + 'not the distance');

  // CAVEAT 2 — NAME SIMILARITY WOULD GET THIS BACKWARDS. "Ravenna apartment"
  // and "Ravenna Park" share a word, so any match against the hotspot's name
  // would publish exactly the case that must not be. The test is a DENYLIST.
  assert.equal(BL.looksResidential('Ravenna apartment'), true);
  assert.equal(BL.looksResidential('Sandel Lookout'), false);
  assert.equal(BL.looksResidential('1234 NE 8th St'), true, 'a bare address is a home');
  assert.equal(BL.looksResidential('my yard'), true);
  assert.equal(BL.looksResidential(''), true, 'and an unnamed pin is never published');
  app.window.close();
});

// THE REAL CASE, cached. Reported with a screenshot 2026-08-08: an Eastern
// Kingbird at Meadowbrook Farm that is not at the hotspot pin — it is at a
// cluster of personal locations by the Three Forks off-leash dog park, "all
// walking distance".
//
// Every coordinate is MEASURED FROM THE API AND FROZEN HERE. eBird can delete a
// personal location, rename it, or let a checklist age out of a feed, at which
// point a test that re-fetched them would pass for the wrong reason or fail for
// a reason unrelated to this code. The numbers are the evidence.
test('the Meadowbrook kingbird cluster is rescued', async () => {
  const app = await boot();
  const BL = app.window.BirdLogic;
  const hotspots = [
    // The nearest hotspot is Centennial Fields Park, NOT Meadowbrook (390-475 m).
    { locId: 'L3394586', lat: 47.5216668, lng: -121.8092769, name: 'Centennial Fields Park' },
    { locId: 'L6819955', lat: 47.5198295, lng: -121.8088592, name: 'Meadowbrook Farm' },
    { locId: 'L735303', lat: 47.523852, lng: -121.7963326, name: 'Three Forks Park' },
    { locId: 'L461493', lat: 47.6721788, lng: -122.3064566, name: 'Ravenna Park / Cowen Park' },
  ];
  const pins = [
    // S249215207 — 319 m from Centennial Fields Park
    { locId: 'L47366737', loc: '3 Forks Dog Park',
      lat: 47.5226349, lon: -121.8052727, location_private: true },
    // S143661718 — 383 m
    { locId: 'L3958031', loc: 'Three Forks Dog Park',
      lat: 47.5229536, lon: -121.8045509, location_private: true },
    // S71126999 — 279 m. Auto-named by eBird, coordinates and all: it must not
    // be read as a street address.
    { locId: 'L11830067',
      loc: 'Three Forks Natural Area Snoqualmie, Snoqualmie US-WA 47.52270, -121.80589',
      lat: 47.522704, lon: -121.805891, location_private: true },
    // S117296561 — 445 m from Three Forks Park, the furthest of the four and
    // the one that cleared the OLD 500 m radius by only 55 m.
    { locId: 'L20623016',
      loc: 'Snoqualmie Valley Trail, North Bend, Washington, US (47.524, -121.802)',
      lat: 47.523530, lon: -121.802237, location_private: true },
  ];
  const got = BL.publicPersonalLocids(pins, hotspots);
  for (const p of pins) {
    assert.ok(got[p.locId],
      p.loc.slice(0, 34) + ' is rescued — the kingbird is HERE, not at the hotspot pin');
  }

  // The measured negative, at its real coordinates: 516 m from Ravenna Park.
  // The OLD radius excluded it by 16 m; the new one does not exclude it at all,
  // and it is still rejected — by NAME. That is why walking distance was safe.
  const apartment = [{ locId: 'L31750674', loc: 'Ravenna apartment',
    lat: 47.6721517, lon: -122.2995618, location_private: true }];
  assert.ok(!BL.publicPersonalLocids(apartment, hotspots).L31750674,
    'the apartment is still excluded at 1000 m, where distance no longer helps '
    + 'at all — the name is carrying it');
  assert.equal(BL.PERSONAL_NEAR_HOTSPOT_M, 1000,
    'walking distance: a pin you could walk to from the hotspot is part of the '
    + 'same birding site');
  app.window.close();
});

test('the personal-location rule costs no eBird call', async () => {
  const seen = [];
  const app = await boot({ fetch(url) { seen.push(String(url)); return null; } });
  const A = app.window.__app;
  // Reads the PERSISTED reference cache only. Cold cache -> [] and the rule
  // does not fire, which is the old behaviour rather than a broken one.
  const before = seen.length;
  const hs = A.cachedHotspots({ counties: [{ code: 'US-WA-033' }, { code: 'US-WA-061' }] });
  assert.ok(Array.isArray(hs), 'it always returns a list');
  assert.equal(seen.length, before, 'and never fetches — the chase wave must not grow a call');
  app.window.close();
});

test('a personal location is marked with the tiny pin', async () => {
  const app = await boot();
  const A = app.window.__app;
  const priv = A.locLink('Ravenna apartment', 47.66, -122.29, 'L9', true);
  const hot = A.locLink('Union Bay Natural Area', 47.65, -122.29, 'L1', false);
  assert.match(priv, /perspin/, 'a personal pin is marked');
  assert.ok(!/perspin/.test(hot), 'a public hotspot is not');
  // 📍 is already the stakeout Day-N flag and the Closest-spots tile. A third
  // meaning is the defect this app keeps removing, so this is drawn, not typed.
  assert.ok(!/\u{1F4CD}/u.test(A.personalPin()),
    'the marker is an inline SVG, not the pin emoji that already means two '
    + 'other things');
  assert.match(A.personalPin(), /aria-label=/, 'and it is announced, not just drawn');
  app.window.close();
});

test('the GBIF budget is spent on the commonest unseen birds first', async () => {
  const app = await boot();
  const A = app.window.__app;

  // computeEasyMisses already measures this: distinct DAY+PLACE pairs, not raw
  // report count, because eight reports from one feeder is one lucky yard.
  const rows = [
    { code: 'rare1', name: 'Rare One', siteDays: 1, freq: 0.05 },
    { code: 'commo', name: 'Common One', siteDays: 40, freq: 0.9 },
    { code: 'mid01', name: 'Middling', siteDays: 12, freq: 0.5 },
    { code: 'onefe', name: 'One Feeder', siteDays: 2, freq: 0.8 },
  ];
  const order = A.gbifScanOrder(rows, 3).map((r) => r.code);
  assert.deepEqual(order, ['commo', 'mid01', 'onefe'],
    'ranked by site-days, and the rarest is the one that misses out');
  assert.equal(A.gbifScanOrder(rows, 3).length, 3, 'the budget is a hard cap');
  assert.ok(A.GBIF_SCAN_MAX > 0 && A.GBIF_SCAN_MAX <= 20,
    'and the default cap is small — this runs UNASKED against a courtesy API');

  // A bird ranked below a one-feeder bird would be the wrong trade: frequency
  // breaks ties, but spread wins, which is the whole point of site-days.
  const tie = A.gbifScanOrder([
    { code: 'a', name: 'A', siteDays: 5, freq: 0.1 },
    { code: 'b', name: 'B', siteDays: 5, freq: 0.9 },
  ], 2).map((r) => r.code);
  assert.deepEqual(tie, ['b', 'a'], 'frequency breaks a site-days tie');
  app.window.close();
});

// A bird due back on 5 January is 20 days away on 16 December, not -345 — and
// this section exists to catch exactly that bird.
test('an arrival window wraps the year boundary', async () => {
  const app = await boot();
  const A = app.window.__app;
  const d = A.daysUntilMonthDay;
  const today = new Date();
  const mm = String(today.getMonth() + 1), dd = String(today.getDate());
  assert.equal(d(mm + '-' + dd), 0, 'today is zero days away');
  assert.equal(d('bogus'), null, 'and a value that is not a date is not a date');
  for (const s of ['1-5', '12-25', '6-15', '3-1']) {
    const n = d(s);
    assert.ok(n >= -180 && n <= 185,
      s + ' resolves to a nearby offset (' + n + '), never most of a year');
  }
  app.window.close();
});

test('a checklist is bought once a day, not once a launch', async () => {
  const calls = [];
  const view = {
    userDisplayName: 'A Birder',
    obs: [{ speciesCode: 'larspa', mediaCounts: { P: 2 }, comments: 'by the helipad' },
          { speciesCode: 'amerob' }],
    // Fields nothing reads, to prove they are not carried into storage.
    protocolId: 'P22', effortDistanceKm: 1.4, subAux: [{ a: 1 }],
  };
  const fetch = (url) => {
    if (/product\/checklist\/view\//.test(url)) { calls.push(String(url)); return view; }
    return null;
  };

  const a = await boot({ fetch });
  const got = await a.window.__app.checklistView('S1');
  assert.equal(calls.length, 1, 'the first read costs a call');
  assert.equal(got.userDisplayName, 'A Birder', 'and returns what callers use');
  assert.equal(got.obs.length, 2, 'with every species');
  assert.deepEqual(got.obs[0].mediaCounts, { P: 2 }, 'and the evidence');
  assert.equal(got.obs[0].comments, 'by the helipad', 'and the note');

  await a.window.__app.checklistView('S1');
  assert.equal(calls.length, 1, 'a second read in the same session costs nothing');

  // Carry the store across a relaunch, exactly as the device does.
  const saved = {};
  for (let i = 0; i < a.window.localStorage.length; i++) {
    const k = a.window.localStorage.key(i);
    saved[k] = a.window.localStorage.getItem(k);
  }
  const stored = saved[a.window.__app.CKL_NS + 'S1'];
  assert.ok(stored, 'the checklist really is persisted');
  assert.ok(!/protocolId|effortDistanceKm|subAux/.test(stored),
    'and ONLY the three fields anything reads — the rest is protocol metadata '
    + 'that nothing here touches and localStorage is a few MB in total');
  a.window.close();

  const b = await boot({ fetch, storage: saved });
  const again = await b.window.__app.checklistView('S1');
  assert.equal(calls.length, 1,
    'a NEW LAUNCH serves it from disk — this is the case the 30-minute '
    + 'in-memory cache could not, and it is 66% of the traffic');
  assert.equal(again.obs[0].comments, 'by the helipad', 'intact across the relaunch');
  b.window.close();
});

// The pacing was budgeting for a competitor that no longer exists.
test('the rate limiter is sized for the key it actually has to itself', () => {
  const m = HTML.match(/var FG_GAP_MAX = \d+, FG_BUCKET = (\d+), FG_REFILL_PER_S = ([\d.]+)/);
  assert.ok(m, 'the limiter constants are still readable');
  // Measured in prototypes/ebird-ratelimit-*.py: a bucket of ~10 refilling
  // ~1/s short-term, and ~0.37/s sustained. They were held at 8 and 0.3 to
  // leave room for the scheduled report job sharing the key.
  assert.equal(+m[1], 10, 'bucket at the measured burst');
  assert.ok(Math.abs(+m[2] - 0.37) < 0.001, 'refill at the measured sustained rate');
  assert.ok(+m[2] <= 0.37,
    'and never ABOVE it — the ceiling is eBird\u2019s, and one 429 pauses every '
    + 'queued call for a 20s cooldown');
});

test('all four Go birding sections offer the same anchor, and rank from it', async () => {
  const app = await boot();
  const doc = app.window.document, A = app.window.__app;

  // Quick outing NAVIGATES between anchors (it is the destination); the other
  // three RE-RANK in place. Different verbs, same three options in the same
  // order — that is what makes it one template rather than four menus.
  const rows = [...doc.querySelectorAll('.modeswitch[data-modes="anchor"]')];
  assert.equal(rows.length, 3,
    'Top destinations, Top excursions and Targets near you each carry the switch');
  for (const r of rows) {
    const chips = [...r.querySelectorAll('.modebtn')].map((b) => b.getAttribute('data-anchor'));
    assert.deepEqual(chips, ['here', 'home', 'find'],
      'the same three options, in the same order, as Quick outing');
  }
  const quick = [...doc.querySelectorAll('.modeswitch[data-modes="quick"] .modebtn')]
    .map((b) => (b.getAttribute('data-goto') || '').replace('quick:', ''));
  assert.deepEqual(quick, ['here', 'home', 'find'],
    'and Quick outing still offers exactly those, so the four agree');

  // The single choke point. Every section's ranking already flowed through
  // getAnchors(), which is what let four sections share an anchor without
  // four separate changes — and is what makes this assertion worth making.
  const src = HTML.slice(HTML.indexOf('function getAnchors('),
    HTML.indexOf('function getAnchors(') + 700);
  assert.match(src, /quickAnchor\(quickOrigin\)/,
    'getAnchors honours the chosen origin, so the algorithms need not each know');
  assert.match(src, /getHome\(\)/,
    'and falls back to home, so an untouched section still matches the report, '
    + 'which ranks from a fixed anchor and cannot ask where you are standing');
  app.window.close();
});

test('rare means the same thing on a hotspot card and in the 7-day list', () => {
  const idx = HTML.slice(HTML.indexOf('function locSpeciesIndex('),
    HTML.indexOf('function locSpeciesIndex(') + 2400);
  assert.match(idx, /r\.kind === 'Rarity' \? 1 : 0/,
    'the hotspot index reads rare off the same field');
  // RARITY IS STICKY per species and place. Reported from the device: a Tufted
  // Puffin wearing the R at Edmonds Waterfront and not at Marina Beach Park,
  // while both cards said "1 rarity" in their own sub-header. The same sighting
  // arrives twice — `recent` as a Sighting, `notable` as a Rarity — so taking
  // the flag from whichever row was newest made the badge depend on feed
  // ordering rather than on the bird.
  assert.match(idx, /var rare = \(prev && prev\.rare\) \|\|/,
    'and ORs it across every row for that species at that place');
  assert.match(idx, /if \(rare\) prev\.rare = 1;/,
    'including a row that loses the date comparison — discarding that was the '
    + 'bug, because the older row is often the notable one');
  const act = HTML.slice(HTML.indexOf('function buildActiveRarities('),
    HTML.indexOf('function buildActiveRarities(') + 2200);
  assert.match(act, /r\.kind !== 'Rarity'/,
    'and the 7-day list selects on the very same field');
  // Both are built from cv.merged, so a bird cannot be rare in one and not the
  // other. The ONE legitimate divergence is distance: the 7-day list is bounded
  // by the chase radius, so a rarity further out is still badged on its hotspot
  // card and still absent from that list.
  assert.match(act, /chaseMaxMi\(\)/,
    'the only difference is the chase radius, and it is applied here');
});

// The R badge, and why it is not a star.
test('the rare badge is an R tile, and ⭐ no longer means two things', () => {
  const src = HTML.slice(HTML.indexOf('function rareBadge('),
    HTML.indexOf('function rareBadge(') + 1400);
  assert.match(src, />R</, 'the badge is a letter R');
  assert.match(src, /<rect[^>]*rx=/, 'in a rounded square');
  assert.match(src, /fill="none"/,
    'OUTLINED — eBird\u2019s mark is a solid tile, and this one must not be a copy');
  assert.match(src, /aria-label=/, 'and it is announced, not just drawn');
  // The collision it removes: ⭐ was the rarity mark AND the save-hotspot
  // control, so one glyph meant "this bird is rare" and "pin this place".
  const lists = HTML.slice(HTML.indexOf('function speciesListHtml('),
    HTML.indexOf('function speciesListHtml(') + 1400);
  assert.ok(!/class="star">\u2b50/.test(lists),
    'a species row no longer wears the save control\u2019s glyph');
  assert.match(lists, /x\.rare \? rareBadge\(\)/, 'it wears the R badge instead');
  // Sized in em so it tracks the text at every UI scale.
  assert.match(HTML, /\.rarebadge svg \{ width: 1\.05em/,
    'and scales with the text rather than pinning itself to 16px');
});

test('a watchlist bird is unseen on the ROW as well as in the heading', async () => {
  const app = await boot({ fetch: () => null });
  const A = app.window.__app;
  const rep = app.window.__SEED_BIRDLIST__.seenByReport[A.getReportSlug()];

  // Exactly the shipped shape: the species is on the year list, is held back by
  // the watchlist, and its NAME is still in the report's own name list.
  rep.codes = ['shbdow'];
  rep.watchHeld = ['shbdow'];
  rep.names = ["Short-billed Dowitcher"];
  app.window.localStorage.setItem('ebird_seen_field', 'speciesCode');
  app.window.localStorage.setItem('ebird_watchlist_v1',
    JSON.stringify([{ code: 'shbdow', name: "Short-billed Dowitcher" }]));

  assert.equal(A.getReportSeen()['shbdow'], undefined,
    'the LIST calls it unseen — that is what the watchlist is for');
  assert.equal(A.isSpeciesSeen('shbdow', "Short-billed Dowitcher"), false,
    'and so must the ROW. A name match must not undo an explicit '
    + '"I have not confirmed this"');
  assert.match(A.needTag('shbdow', "Short-billed Dowitcher"), /needflag/,
    'so the marker is actually rendered');
  app.window.close();
});

// The cross-region half of the same defect: the name pools are a union across
// every report, so matching against them called a Lower 48 bird seen in
// Washington. The pool is now this report's OWN year-list names.
test('a name match is scoped to the report, not unioned across regions', async () => {
  const app = await boot({ fetch: () => null });
  const A = app.window.__app;
  const rep = app.window.__SEED_BIRDLIST__.seenByReport[A.getReportSlug()];
  rep.codes = [];
  rep.watchHeld = [];
  rep.names = ['Dark-eyed Junco'];
  app.window.localStorage.setItem('ebird_seen_field', 'speciesCode');
  // A bird on some OTHER region's list, and on the life list.
  app.window.localStorage.setItem('ebird_life_names',
    JSON.stringify(['Yellow-headed Blackbird']));
  assert.equal(A.isSpeciesSeen('', 'Yellow-headed Blackbird'), false,
    'seen somewhere else is not seen here');
  assert.equal(A.isSpeciesSeen('', 'Dark-eyed Junco'), true,
    'but this report\u2019s own list still answers');
  app.window.close();
});

test('convoys: a subspecies of a bird on your year list is NOT unseen', async () => {
  // Reported bug: "Dark-eyed Junco (Oregon)" showed as unseen although a
  // Dark-eyed Junco is on the year list. isSpeciesSeen only ever compared the
  // RAW code and an exact name, so every form observation was a false
  // positive. analyze.py has always followed reportAs; the app now does too.
  const app = await boot({ fetch: () => null });
  const A = app.window.__app;
  seedSeen(app, ['daejun'], ['Dark-eyed Junco']);
  assert.equal(A.isSpeciesSeen('daejun', 'Dark-eyed Junco'), true, 'the parent itself');
  // Named nothing like the parent, so ONLY the reportAs chain can answer this.
  seedSeen(app, ['daejun', 'norfli'], ['Dark-eyed Junco']);
  assert.equal(A.isSpeciesSeen('yeflic1', 'Yellow-shafted Flicker', { yeflic1: 'norfli' }),
    true, 'the form resolves to its parent via reportAs');
  assert.equal(A.isSpeciesSeen('yeflic1', 'Yellow-shafted Flicker'), false,
    'and with no taxonomy loaded there is nothing to resolve it to');
  assert.equal(A.isSpeciesSeen('daejun5', 'Dark-eyed Junco (Oregon)'), true,
    'and falls back to the name with the parenthetical group stripped');
  assert.equal(A.isSpeciesSeen('rebnut', 'Red-breasted Nuthatch'), false,
    'a bird you have not seen is still unseen');
  app.window.close();
});

test('a checklist link is labelled by its subId, never the word "checklist"', () => {
  assert.ok(!/checklistLink\([^)]*'checklist'\)/.test(HTML),
    'every call site passes the id: "checklist" names nothing you can look up');
});

test('the three species sections use the large icon + title treatment', () => {
  // targetResults (Closest spots) is NOT in this list any more: its rows are
  // HOTSPOTS, and a hotspot list carrying the species container classes is
  // what silently replaced the hotspot card's geometry — see "every hotspot
  // list is built by the one shared card".
  ['lastNewResults'].forEach((id) => {
    const m = new RegExp('<ul id="' + id + '"[^>]*class="([^"]*)"').exec(HTML);
    assert.ok(m && /\bbig\b/.test(m[1]), id + ' renders large rows');
  });
  assert.match(CARDS_SPECIES, /\.obs\.big \.thumb \{[^}]*width: calc\(64px \* var\(--s\)\)/,
    'the icon is actually bigger, not just a class name');
  // Today's rarities is a LIST of today's rare-bird checklists — one row per
  // report — so it uses the SMALL card. The large card is for reading about ONE
  // bird; using it here made 13 checklists into 13 full screens of stats. The
  // medium card was better but still tall enough that a busy day scrolled; the
  // small card scans, and everything that no longer fits the row is printed
  // underneath it, labelled, so nothing is dropped.
  const rare = /<ul id="results"[^>]*class="([^"]*)"/.exec(HTML);
  assert.ok(rare && /\bxl\b/.test(rare[1]),
    "today's rarities render as medium cards, one per checklist");
  assert.ok(rare && !/\bcard-sm\b/.test(rare[1]),
    'and must not also carry the small size — one list, one size');
});

test('favorites: the hotspot is the heading, its birds are the list under it', () => {
  const src = HTML.slice(HTML.indexOf('function renderFavs('),
    HTML.indexOf('function favRarityCodes('));
  // The distance and the map link are NOT part of the name. Crammed into the
  // title they made a place read like a caption with facts stuck to it, and
  // locLink's inline 🗺 duplicated the Open in Maps link sitting right below.
  assert.doesNotMatch(src, /class="favtitle"[\s\S]{0,200}locLink\(/,
    'the title must not use locLink — it appends its own 🗺 beside the name');
  assert.match(src, /class="favtitle"[\s\S]{0,200}extA\(hotspotUrl\(/,
    'the title is the hotspot name, linked, and nothing else');
  assert.match(src, /class="hsact"[\s\S]{0,300}Open in Maps/,
    'the map link moves below the card, into the shared actions row');
  assert.match(src, /class="hsact"[\s\S]{0,300}toFixed\(1\) \+ ' mi/,
    'and the distance goes with it');
  // A heading has to outrank the 17px species links beneath it by enough to
  // see. At 19px it did not, so the row read as birds with a caption.
  const fav = /\.favtitle \{ font-size: calc\((\d+)px/.exec(HTML);
  assert.ok(fav, '.favtitle must set a size');
  assert.ok(Number(fav[1]) >= 23,
    `the hotspot title (${fav[1]}px) must clearly outrank the 17px species names under it`);
});

test('latest ticks: the bird outranks the roster of who added it', () => {
  // The row's subject is the BIRD. "Who added it" is a roster read at a glance
  // — how many, how recently — not row by row, and at the checklist size it
  // competed with the name it was evidence for. Sized by what the list IS, so
  // the ranking holds wherever a roster appears.
  const px = (re) => {
    const m = re.exec(CARDS_SPECIES);
    assert.ok(m, 'rule must exist: ' + re);
    return Number(m[1]);
  };
  const name = px(/\.obs\.xl > li > \.name \{ font-size: calc\((\d+)px/);
  const ckl = px(/\.obs\.xl > li > \.cklrows \{ font-size: calc\((\d+)px/);
  assert.ok(name > ckl, `the bird name (${name}px) must outrank its checklists (${ckl}px)`);
  // The roster is no longer a table. It is one sentence, which is smaller than
  // the checklists by being prose rather than by opting into a size class —
  // it was the tallest thing on the card and the least scanned.
  assert.match(HTML, /class="wholine"/,
    'the roster is a single labelled line, not a row per birder');
  assert.doesNotMatch(HTML, /class="cklrows whorows"/,
    'and no longer renders as a checklist-style table');
});

test('latest ticks: the bird links to its species page and shows fresh lists', () => {  const src = HTML.slice(HTML.indexOf('function renderLastNew('),
    HTML.indexOf('function loadAbaAlert('));
  assert.match(src, /speciesLink\(sp, code\)/,
    'the bird title is a link to ebird.org/species/<code>/<region>');
  assert.match(src, /LAST_NEW_FRESH_DAYS/,
    'checklists inside the fresh window are never hidden behind "and N more"');
  assert.match(src, /Math\.max\(LAST_NEW_CHECKLISTS, nFresh\)/,
    'the fresh window only ever ADDS rows to the 5-row floor');
});

test("today's rarities show the time of the latest report, not just the date", () => {
  const src = HTML.slice(HTML.indexOf('function refresh()'),
    HTML.indexOf('function loadTargets('));
  assert.match(src, /fmtDateTime\(r\.dateStr\)/,
    'a rarity is chased within hours, so the clock time is the deciding number');
});

test('closest spots: rows carry the distance in miles, closest first', async () => {
  // This guard used to match a source-text literal ("toFixed(1) + ' mi'"),
  // which pinned ONE WAY of printing the distance rather than the fact that
  // the distance is printed. When the medium hotspot card moved distance out
  // of the `·`-joined sub-header into its own column, the section kept showing
  // miles on every row and the guard failed anyway. Assert the MEANING against
  // the rendered DOM: every row shows its distance, and the nearest is first.
  const app = await boot({ fetch: () => null });
  const A = app.window.__app;
  const targets = [
    { locId: 'LFAR', locName: 'Far Pond', lat: 47.9, lng: -122.4, distMi: 23.4,
      comName: 'Sora', speciesCode: 'sora', obsDt: '2026-07-29 08:00' },
    { locId: 'LNEAR', locName: 'Near Marsh', lat: 47.76, lng: -122.16, distMi: 8.04,
      comName: 'Merlin', speciesCode: 'merlin', obsDt: '2026-07-30 07:00' }
  ];
  const places = A.groupTargetsByPlace(targets);
  assert.deepEqual(places.map((p) => p.locId).join(','), 'LNEAR,LFAR',
    'places are ranked by their NEAREST target, closest first');

  const ul = app.window.document.createElement('ul');
  A.renderTargetPlaces(ul, places);
  const rows = [...ul.children];
  assert.equal(rows.length, 2, 'one row per place');
  rows.forEach((li, i) => {
    const txt = li.textContent.replace(/\s+/g, ' ');
    assert.match(txt, /\d+(\.\d+)?\s*mi/,
      `row ${i + 1} must state how far away it is: ${txt.slice(0, 120)}`);
  });
  // And the distance is a distinct field, not buried mid-sentence — that is
  // what makes a list of hotspots scannable down one edge.
  const dists = rows.map((li) => {
    const d = li.querySelector('.hsdist');
    return d ? d.textContent.replace(/\s+/g, '') : null;
  });
  assert.deepEqual(dists.join('|'), '8.0mi|23mi',
    'each row carries its own distance cell, nearest first');

  const build = HTML.slice(HTML.indexOf('function buildClosestSpots('),
    HTML.indexOf('function loadTargets('));
  assert.match(build, /distMi:/, 'and the builder carries the distance through');
  assert.match(build, /targets\.sort\(/, 'sorted closest first');
});

test('quick outing: capped to an impulse detour and sorted by distance', async () => {
  const app = await boot({ fetch: () => null });
  const home = { lat: 47.75, lng: -122.15 };
  // Quality DEcreases with distance here, so a list ordered by score would come
  // back 8, 4, 2, 1 - the reverse of what an impulse detour needs.
  const far = (mi) => ({ locId: 'L' + mi, locName: mi + ' mi', lat: home.lat + mi / 69, lng: home.lng, numSpeciesAllTime: 200 + mi });
  const rows = app.window.__app.buildQuickOuting(
    [far(12), far(2), far(4), far(1), far(8)], home);
  assert.equal(rows.radiusMi, 5, 'a 5-mile radius is about a five-minute drive');
  // Array.from: rows are built inside the jsdom realm, so their prototype is
  // not this realm's Array.prototype and deepStrictEqual would reject them on
  // identity alone.
  const dists = Array.from(rows).map((r) => Math.round(r.dist));
  assert.deepEqual(dists, [1, 2, 4], 'only the near spots, closest first');
  // ...but a rural region must not get an empty section.
  const sparse = app.window.__app.buildQuickOuting([far(9), far(30)], home);
  assert.ok(sparse.radiusMi > 5, 'the radius widens when nothing is that close');
  assert.ok(sparse.length >= 1);
  app.window.close();
});

test('rankings: the rank is shown out of the number of eBirders', async () => {  const app = await boot({ fetch: (u) => (/top100/.test(u) ? FIX('top100-wa.html') : null) });
  const A = app.window.__app;
  A.renderRankings(A.parseRankingsHTML(FIX('top100-wa.html'), 'sally frandsen'),
    'US-WA', 'https://ebird.org/top100', 'sally frandsen');
  assert.ok(app.document.querySelector('.rankcard #rankOf'),
    'a rank with no field size is not a standing - the report prints "#210 of 13,303"');
  // The count endpoint rejects a normal API key, so the app lifts eBird's own
  // web token the way rankings.py does. Port check against a minimal page.
  const key = A.extractWebKey(
    'window.__NUXT__=(function(a,b,c){return {x:a,cfg:{ebirdApiKey:b}}}("zz","jfekjedvescr",1));');
  assert.equal(key, 'jfekjedvescr',
    'the token is resolved by parameter NAME, so eBird can reorder its args');
});

test('easy misses: ranked by location-days, excluding birds on your year list', async () => {
  // Ports report.section_common_missing. The two things that make this list
  // worth chasing are (a) it never suggests a bird you already have and
  // (b) it ranks by how many DIFFERENT PLACES reported a bird, not by how
  // many reports it got - eight reports from one feeder is one lucky yard.
  const app = await boot({ fetch: () => null });
  const A = app.window.__app;
  // The bundled seed IS the WA year list, which of course has robins on it —
  // so the fixture replaces both halves of the set, codes and names, or the
  // real list decides the answer instead of the fixture.
  seedSeen(app, ['daejun'], ['Dark-eyed Junco']);

  const obs = [];
  const add = (code, name, day, loc) => obs.push({
    speciesCode: code, comName: name, obsDt: '2026-07-' + day + ' 08:00',
    locId: loc, locName: loc, lat: 47.6, lng: -122.3, subId: 'S' + day + loc,
  });
  const DAYS = ['21', '22', '23', '24'];
  // Song Sparrow first, so the ordering below is the sort's doing, not the
  // insertion order. Present on the same 4 days as the robin - identical
  // frequency - but always at the SAME spot, so it is one place you know
  // about rather than a bird that is everywhere.
  DAYS.forEach((d) => add('sonspa', 'Song Sparrow', d, 'L9'));
  // Same 4 days, three different places each day = 12 location-days.
  DAYS.forEach((d) => ['L0', 'L1', 'L2'].forEach((l) => add('amerob', 'American Robin', d, l)));
  // One lucky day out of ten - under the 40% floor.
  add('rebnut', 'Red-breasted Nuthatch', '25', 'L1');
  // Already on the year list: must never appear however common it is.
  DAYS.forEach((d, i) => add('daejun', 'Dark-eyed Junco', d, 'L' + i));

  const rows = A.computeEasyMisses(obs, 10, {});
  // Only two birds clear the 40% bar here, so the section lowers it rather than
  // print two rows — the nuthatch is admitted BY THAT RULE, not by accident.
  assert.ok(rows.minFreq < 0.4, 'a two-row section lowers its bar');
  assert.deepEqual(Array.from(rows, (r) => r.code), ['amerob', 'sonspa', 'rebnut'],
    'birds already on your year list are excluded; spread beats repetition');
  assert.ok(!Array.from(rows, (r) => r.code).includes('daejun'),
    'a seen bird never returns however common it is, at any bar');
  assert.equal(rows[0].siteDays, 12, 'location-days: 4 days x 3 places');
  assert.equal(rows[1].siteDays, 4, 'same 4 days at one spot is 4 location-days');
  assert.ok(Math.abs(rows[0].freq - rows[1].freq) < 1e-9,
    'the two are tied on frequency, so ONLY location-days can order them');
  assert.equal(rows[0].days, 4);
  assert.ok(Math.abs(rows[0].freq - 0.4) < 1e-9, 'frequency is days / sampled days');
  assert.equal(rows[0].spots.length, 3, 'the report offers the nearest 3 spots');

  // A subspecies of a bird you have must resolve through reportAs, exactly as
  // it does in the convoy lists - otherwise the "easy" list is full of birds
  // you already ticked under the parent name.
  const forms = [];
  DAYS.forEach((d, i) =>
    forms.push({ speciesCode: 'daejun5', comName: 'Dark-eyed Junco (Oregon)',
      obsDt: '2026-07-' + d + ' 08:00', locId: 'L' + i, lat: 47.6, lng: -122.3 }));
  assert.equal(A.computeEasyMisses(forms, 10, { daejun5: 'daejun' }).length, 0,
    'a form of a bird on your year list is not a miss');
  app.window.close();
});

test('easy misses: a fetched day is cached, because a past day never changes', async () => {
  // The report reads 75 days of committed snapshots; the app has none, so it
  // samples 30 days live. That is only affordable once - re-fetching a month
  // of history on every open would be 60 calls per visit on a shared key.
  let calls = 0;
  const day = [{ speciesCode: 'amerob', comName: 'American Robin',
    obsDt: '2026-07-21 08:00', locId: 'L1', locName: 'Marymoor',
    lat: 47.6, lng: -122.3, subId: 'S1' }];
  const app = await boot({ fetch: (u) => (/maxResults=1000/.test(u) ? (calls++, day) : null) });
  const A = app.window.__app;
  const d = new Date('2026-07-21T12:00:00');

  const first = await A.easyFetch(['US-WA-033'], [d]);
  assert.equal(calls, 1, 'the first pass fetches the day');
  assert.equal(first.length, 1);

  const second = await A.easyFetch(['US-WA-033'], [d]);
  assert.equal(calls, 1, 'the second pass reads the cache, not the network');
  assert.deepEqual(Array.from(second, (o) => o.speciesCode), ['amerob']);
  assert.equal(second[0].locName, 'Marymoor',
    'the cache keeps the fields the section renders, not just the code');
  app.window.close();
});

test('convoy checklists load concurrently, with a hard cap on in-flight calls', async () => {
  // Serial + a 170 ms gap meant ~9 s of mostly-idle key for a ten-convoy day.
  // Unbounded parallelism is the other failure: it would swamp the single
  // eBird key that every other section shares.
  const app = await boot({ fetch: () => null });
  const A = app.window.__app;
  assert.match(HTML, /var CONVOY_FETCH_CONC = \d+;/, 'the cap is a named constant');
  const cap = +/var CONVOY_FETCH_CONC = (\d+);/.exec(HTML)[1];
  assert.ok(cap > 1 && cap <= 8, `cap is concurrent but polite (got ${cap})`);

  let live = 0, peak = 0, done = 0;
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  await A.pool(items, cap, () => {
    peak = Math.max(peak, ++live);
    return new Promise((res) => setTimeout(res, 1)).then(() => { live--; done++; });
  });
  assert.equal(done, 10, 'every item ran');
  assert.equal(peak, cap, `pool keeps exactly ${cap} in flight, no more and no fewer`);

  // A rejection must not strand the pool - one bad checklist used to be enough
  // to leave a convoy stuck on "Loading species...".
  let ran = 0;
  await A.pool(items, cap, (i) => { ran++; return i === 3 ? Promise.reject(new Error('x')) : null; });
  assert.equal(ran, 10, 'a rejected job does not stop the remaining ones');

  const load = HTML.slice(HTML.indexOf('function loadConvoySpecies('),
    HTML.indexOf('function loadConvoys('));
  assert.match(load, /pool\(list, CONVOY_FETCH_CONC/, 'the convoy loader uses the pool');
  assert.ok(!/todDelay/.test(load), 'and no longer sleeps between checklists');
  app.window.close();
});


// ---------------------------------------------------------------------------
// v1.0.19: branding, the tile menu, and the two sections the app was missing.
// ---------------------------------------------------------------------------

test('branding: the app icon photo is the in-app mark, bundled offline', async () => {
  const app = await boot();
  const d = app.document;
  const marks = [...d.querySelectorAll('img.brandmark')];
  assert.ok(marks.length >= 2,
    'the mark appears in the header AND the navbar, not just once');
  const srcs = new Set(marks.map((m) => m.getAttribute('src')));
  // One file, referenced twice. Two separately-cropped files would drift the
  // moment either is regenerated, which is the whole reason generate.js emits
  // the icon, the splash and this mark from a single master.
  assert.equal(srcs.size, 1, 'both sites use the SAME file as the app icon source');
  const src = [...srcs][0];
  assert.match(src, /^assets\/brand\/mark\.png$/,
    'the mark is a bundled relative path');
  assert.ok(fs.existsSync(path.join(WWW, src)),
    'and that file is actually shipped in www/, not a broken link');
  // A remote logo would break the "no runtime GitHub dependency" rule and would
  // render as a hole on a phone with no signal - the whole point of bundling.
  assert.ok(!/<img[^>]+src="(https?:)?\/\//i.test(HTML),
    'no image anywhere in the shell is fetched over the network');
  // The header mark carries the name; the navbar copy is decorative beside a
  // title that already says it, so announcing it twice is noise.
  const header = d.querySelector('header img.brandmark');
  assert.equal(header.getAttribute('alt'), 'Bird Chaser',
    'the header mark names the app for screen readers');
  assert.equal(d.querySelector('#navbar img.brandmark').getAttribute('alt'), '',
    'the navbar copy is decorative and stays silent');
  assert.match(d.querySelector('header h1').textContent, /Bird Chaser/,
    'the wordmark is real text, so it is searchable and scales');
  app.window.close();
});

test('Contents is a grid of tiles, and the first one leads it', async () => {
  const app = await boot();
  const A = app.window.__app;
  const parts = A.splitLabel('🔴 Happening now');
  assert.equal(parts.icon, '🔴', 'a label splits off its glyph');
  assert.equal(parts.text, 'Happening now', 'and keeps the rest as words');
  const plain = A.splitLabel('Settings');
  assert.equal(plain.icon, '', 'a label with no glyph claims none');
  assert.equal(plain.text, 'Settings',
    'and keeps all of its text rather than losing a letter to a bad guess');
  // THE FIRST ROW IS NOW A PAIR, not a banner. "the happening now button and
  // region selection can be two columns of one table, to reduce screen space":
  // the region control used to be a full-width row directly above a full-width
  // Happening-now tile, so the two most-used controls ate the first screen
  // between them. They now share one grid row, so the Happening-now tile is no
  // longer `.wide` and the region cell sits beside it.
  const cells = [...app.document.querySelectorAll('#menuList > li:not(.tocgroup)')];
  assert.ok(cells[0].classList.contains('regioncell'),
    'the region control is not the first cell, so it is not sharing the row');
  assert.ok(cells[0].querySelector('#menuRegion'),
    'the region cell exists but holds no picker — the control was lost in the move');
  assert.ok(!cells[1].classList.contains('wide'),
    'Happening now still spans the whole row, so nothing can sit beside it');
  assert.match(cells[1].querySelector('.toclink').getAttribute('aria-label'),
    /Happening now/, 'and it is the report\'s first section, not whatever sorts first');
  // The headings are labels for the tiles, not tiles: a screen reader
  // stepping through Contents must not find one that does nothing.
  const heads = [...app.document.querySelectorAll('#menuList li.tocgroup')];
  assert.ok(heads.length >= 2, 'the menu is broken into named groups');
  heads.forEach((h) => {
    assert.equal(h.getAttribute('role'), 'presentation',
      'a group heading is not announced as a list item');
    assert.ok(!h.querySelector('button'), 'and carries nothing tappable');
  });
  assert.ok(heads.some((h) => /go birding/i.test(h.textContent)),
    'including the one that holds the place-finding sections');
  app.window.close();
});

test('All unseen reports: one card per SPECIES, its places listed beneath', async () => {
  const app = await boot();
  const A = app.window.__app;
  // Four raw rows: three observers on one stakeout inside 250 m (which is ONE
  // errand) plus a farther bird. Printing four lines makes the list look four
  // times as busy as the day actually was.
  const rows = A.buildAllUnseen([
    { code: 'tufpuf', name: 'Tufted Puffin', lat: 47.80, lon: -122.39,
      dateStr: '2026-07-28 07:10', distMi: 12.4, loc: 'Marina Beach Park',
      locId: 'L1', observer: 'A', subId: 'S1' },
    { code: 'tufpuf', name: 'Tufted Puffin', lat: 47.8008, lon: -122.3902,
      dateStr: '2026-07-28 09:30', distMi: 12.4, loc: 'Edmonds waterfront',
      locId: 'L2', observer: 'B', subId: 'S2' },
    { code: 'tufpuf', name: 'Tufted Puffin', lat: 47.8004, lon: -122.3898,
      dateStr: '2026-07-28 11:05', distMi: 12.4, loc: 'Marina Beach Park',
      locId: 'L1', observer: 'A', subId: 'S3', valid: false },
    { code: 'rufhum', name: 'Rufous Hummingbird', lat: 47.70, lon: -122.15,
      dateStr: '2026-07-27 08:00', distMi: 2.1, loc: 'Home pond',
      locId: 'L9', observer: 'C', subId: 'S4' },
  ]);
  assert.equal(rows.length, 2, 'the stakeout collapses to one row, not three');
  assert.equal(rows[0].code, 'rufhum', 'nearest first, mirroring the report');
  const puffin = rows[1];
  assert.equal(puffin.nReports, 3, 'but the report count is kept - it is the signal');
  assert.equal(puffin.nObservers, 2,
    'observers are counted distinctly: one birder filing twice is not two people');
  assert.equal(puffin.dateStr, '2026-07-28 11:05',
    'the newest observation represents the group');
  assert.equal(puffin.anyUnconfirmed, true,
    'an unconfirmed report in the group is surfaced, not averaged away');
  app.window.close();
});

// Reported from the device: the list printed one row per species PER PLACE, so
// one bird at four spots read as four birds. The species is the thing you are
// chasing; the places are how you chase it.
test('All unseen reports: a species at several places is ONE card, places by date', async () => {
  const app = await boot();
  const A = app.window.__app;
  const rows = A.buildAllUnseen([
    // Same bird, three genuinely different places, three different days.
    { code: 'btywar', name: 'Black-throated Gray Warbler', lat: 47.66, lon: -122.11,
      dateStr: '2026-07-28 09:00', distMi: 6.7, loc: 'Marymoor Park',
      locId: 'LA', observer: 'A', subId: 'S10' },
    { code: 'btywar', name: 'Black-throated Gray Warbler', lat: 47.86, lon: -122.30,
      dateStr: '2026-07-30 15:13', distMi: 11.2, loc: 'Interurban Trail',
      locId: 'LB', observer: 'B', subId: 'S11' },
    { code: 'btywar', name: 'Black-throated Gray Warbler', lat: 47.55, lon: -122.02,
      dateStr: '2026-07-29 07:45', distMi: 9.9, loc: 'Lake Sammamish',
      locId: 'LC', observer: 'C', subId: 'S12' },
  ]);
  assert.equal(rows.length, 1, 'one species is one card however many places it was at');
  const g = rows[0];
  assert.equal(g.places.length, 3, 'and every place it was seen at is kept');
  assert.equal(g.nPlaces, 3, 'the place count is carried for the sub-header');
  assert.equal(g.places.map((p) => p.subId).join(','), 'S11,S12,S10',
    'places sort by date, newest first - a two-day-old report is a worse lead');
  assert.equal(g.distMi, 6.7,
    'the card leads with the NEAREST place, not the newest, so species still rank by distance');
  assert.ok(g.places.every((p) => p.subId),
    'every place carries the checklist that proves it');

  // The rendered rows must expose date, distance and a checklist link —
  // a place you cannot date, measure or verify is not a lead.
  const html = A.unseenPlacesHtml(g.places);
  assert.match(html, /class="cklcards cklcards-sm uplaces"/, 'renders the place list');
  assert.equal((html.match(/<li class="cklcard cklcard-sm"/g) || []).length, 3,
    'one row per checklist');
  assert.match(html, /S11/, 'and names the checklist rather than saying "checklist"');
  for (const bit of ['cklead', 'ckdate', 'ckdist', ' mi']) {
    assert.ok(html.includes(bit), 'each row carries ' + bit);
  }
  assert.ok(!/class="uploc"|class="upmeta"/.test(html),
    'and says it on ONE line — the place heading and its meta line are gone');
  app.window.close();
});

// eBird issues a separate locId for every personal location, so ONE hotspot
// arrived as several rows with the same name, each holding one checklist —
// "Penny Creek Natural Area" three times over. The reader sees a name, not an
// id, so that is what the rows are grouped by.
test('All unseen reports: one hotspot NAME is one place, with every checklist under it', async () => {
  const app = await boot();
  const A = app.window.__app;
  const rows = A.buildAllUnseen([
    { code: 'merlin', name: 'Merlin', lat: 47.90, lon: -122.20,
      dateStr: '2026-07-31 15:40', distMi: 8.1, loc: 'Penny Creek Natural Area',
      locId: 'L111', observer: 'A', subId: 'S1' },
    // Same name, DIFFERENT locId — a personal location for the same place.
    { code: 'merlin', name: 'Merlin', lat: 47.90, lon: -122.20,
      dateStr: '2026-07-30 08:00', distMi: 8.1, loc: 'Penny Creek Natural Area',
      locId: 'L222', observer: 'B', subId: 'S2' },
    // And once more with different spacing/case, which is still the same place.
    { code: 'merlin', name: 'Merlin', lat: 47.90, lon: -122.20,
      dateStr: '2026-07-29 06:15', distMi: 8.1, loc: '  penny creek   natural area ',
      locId: 'L333', observer: 'C', subId: 'S3' },
    { code: 'merlin', name: 'Merlin', lat: 47.60, lon: -122.10,
      dateStr: '2026-07-28 07:00', distMi: 12.0, loc: 'Marymoor Park',
      locId: 'L999', observer: 'D', subId: 'S9' },
  ]);
  const g = rows[0];
  assert.equal(g.places.length, 2,
    'three locIds sharing one hotspot name collapse to one place, plus the genuine second place');
  const penny = g.places.filter((p) => /penny/i.test(p.loc))[0];
  assert.ok(penny, 'the merged place keeps a readable name');
  assert.equal(penny.checklists.length, 3,
    'and keeps ALL THREE checklists — "3 reports" you cannot open is a number, not evidence');
  assert.equal(penny.checklists.map((c) => c.subId).join(','), 'S1,S2,S3',
    'newest checklist first');

  const html = A.unseenPlacesHtml(g.places);
  for (const s of ['S1', 'S2', 'S3']) {
    assert.ok(html.includes(s), `every checklist is linked, missing ${s}`);
  }
  assert.match(html, /class="cklcards cklcards-sm uplaces"/,
    'checklists render through the shared checklist card');
  // THE DUPLICATION BUG, pinned. This used to be a place heading, a
  // distance/date line under it, and THEN a card per checklist — so the
  // ordinary place-with-one-report printed its date twice, stacked, and a
  // place with three checklists printed its name once and its evidence three
  // rows below. Now the hotspot NAME is the row and the name is the link, so
  // there is exactly one line per checklist and nothing is said twice on it.
  assert.equal((html.match(/<li class="cklcard cklcard-sm"/g) || []).length, 4,
    'one row per checklist — three at Penny Creek, one at Marymoor');
  assert.ok(!/class="uploc"|class="upmeta"/.test(html),
    'the separate heading and meta lines are gone');
  const pennyRows = (html.match(/Penny Creek/gi) || []).length;
  assert.equal(pennyRows, 3,
    'the name repeats only because each row is a different report you can open');
  assert.match(html, /class="cklead"><a[^>]*ebird\.org\/checklist\/S1[^>]*>Penny Creek/,
    'and the NAME is the link to the checklist, not a hotspot page');
  // The date is numeric now — "abbreviate the date time more" — so a rarity
  // with fifteen checklists filed the same afternoon stops printing the month
  // name fifteen times. The month is kept as a NUMBER rather than dropped,
  // because these lists span days and a bare time would make yesterday look
  // like this morning.
  assert.match(html, /class="ckdate">7\/31/, 'when it was reported');
  assert.match(html, /class="ckdist[^"]*"[^>]*>8\.1 mi/,
    'and how far it is, on the same line — the class may now carry `maplink` '
    + 'too, because the distance opens maps');

  const CK = require(require('node:path')
    .join(__dirname, '..', 'www', 'cards-checklist.js'));
  const full = CK.small({ place: 'Marymoor Park--Audubon BirdLoop', date: 'Jul 30 9:29 AM',
                          href: 'https://ebird.org/checklist/S1', count: 42, distMi: 4.24 });
  // REFINED TWICE. It first asserted NO count on a small row, quoting "remove
  // the bird count"; then "It's missing the bird count in each item." made it
  // "only when greater than one"; then, looking at that shipped:
  //
  //   "the checklists are missing the bird count"
  //
  // The middle rule was the problem: a blank row had come to mean EITHER a
  // count of one OR eBird's "X" (present, nobody counted), which arrives as
  // null. One is a fact about the bird, the other about the checklist, and no
  // reader could tell them apart. So the blank is retired - a number whenever
  // eBird gave one, ×X when it explicitly did not, nothing when the caller
  // supplied no count at all.
  assert.match(full, /class="ckcount"[^>]*>\u00d742</,
    'an informative count (42) is hidden on the one-line row');
  assert.match(CK.small({ place: 'P', date: 'd', count: 1 }), /class="ckcount"[^>]*>\u00d71</,
    'a count of one is invisible again, which is what read as missing');
  assert.match(CK.small({ place: 'P', date: 'd', count: null }), /class="ckcount"[^>]*>\u00d7X/,
    'an uncounted report is indistinguishable from a count of one');
  assert.ok(!/class="ckcount"/.test(CK.small({ place: 'P', date: 'd' })),
    'a row given no count at all invented one');
  assert.match(CK.medium({ place: 'P', count: 1 }), /1 bird</,
    'the medium card has a whole line, so it spells it out and pluralises');
  assert.match(full, /class="ckdist">4\.2 mi/, 'and how far, when the caller has it');
  assert.match(full, /class="ckdate">7\/30 9:29a/,
    'the time is shortened AND the month is numeric — "7/30 9:29a" against '
    + '"Jul 30 9:29 AM" is six characters a 320px row cannot spare');
  // The observer is the one field of unbounded width. The layout sweep caught
  // it hanging 247px past a 320px row at 1.75x text scale, so the small card
  // drops it and the medium card keeps it.
  assert.ok(!/ckwho/.test(CK.small({ place: 'P', who: 'Neil Pankey' })),
    'a one-line row never carries the observer name');
  assert.match(CK.medium({ place: 'P', who: 'Neil Pankey' }), /class="ckwho">Neil Pankey/,
    'but the medium card, which has the room, does');
  // A name that carries a sub-area is condensed: the tail almost never tells
  // one row apart from its neighbours, and it is what breaks the one-line row.
  assert.equal(CK.condense('Marymoor Park--Audubon BirdLoop/Interpretive-Boardwalk'),
    'Marymoor Park', 'the hotspot name is condensed');
  app.window.close();
});

// Reported from the device with a screenshot: the checklist list under a place
// showed the same name over and over and wrapped onto three lines per row.
test('a checklist row is ONE line that truncates, and never overflows', async () => {
  const CK = require(require('node:path')
    .join(__dirname, '..', 'www', 'cards-checklist.js'));
  // The LEAD is the only part allowed to shrink, so a long hotspot name loses
  // its tail instead of pushing the facts off the screen.
  assert.match(CK.css, /\.cklcards-sm > \.cklcard-sm \{[^}]*white-space: nowrap/,
    'no individual fact ever splits down the middle');
  assert.match(CK.css, /\.cklcards-sm > \.cklcard-sm \{[^}]*overflow: hidden/,
    'and the row CLIPS as a backstop — nowrap without overflow control hides '
    + 'the overflow off the screen edge instead of preventing it (+196px once)');
  assert.match(CK.css, /\.cklcards-sm > \.cklcard-sm > \.cklead \{[^}]*flex: 1 1 0/,
    'flex-BASIS 0 on the lead: with `auto` the name claimed its content width '
    + 'first and shoved the facts onto a second line, which is the reported bug');
  assert.match(CK.css, /\.cklcards-sm > \.cklcard-sm > span:not\(\.cklead\) \{[^}]*flex: 0 1 auto/,
    'the facts take their natural width and shrink only if they must');
  assert.match(CK.css, /\.cklcards-sm > \.cklcard-sm \{[^}]*flex-wrap: wrap/,
    'wrapping survives ONLY as the last resort: at 1.75x on a 320px screen '
    + 'the facts alone are wider than the screen, so there is no one-line '
    + 'answer left and clipping would delete the distance silently');
  assert.match(CK.css, /\.cklcards-sm > \.cklcard-sm > \.cklead \{[^}]*text-overflow: ellipsis/,
    'the lead is the part that truncates');
  assert.match(CK.css, /\.cklcards-sm > \.cklcard-sm > \.cklead \{[^}]*min-width: 0/,
    'and min-width:0 is what lets a flex item shrink below its content at all');
  // The ellipsis must be on the LINK, not only its wrapper: text-overflow acts
  // on the box that overflows, and an inline <a> inside a clipping span still
  // measures its full width. The sweep caught exactly that, at +162px.
  assert.match(CK.css, /\.cklcards-sm > \.cklcard-sm > \.cklead > \.ckgo \{[^}]*display: block/,
    'the link itself is a block, so it is bounded by the row');
  assert.match(CK.css, /\.cklcards-sm > \.cklcard-sm > \.cklead > \.ckgo \{[^}]*text-overflow: ellipsis/,
    'and truncates itself rather than being painted and clipped');
  // Separators are DRAWN, so an omitted field cannot strand a "·".
  assert.match(CK.css, /span \+ span::before \{\s*\n?\s*content: "\\00b7"/,
    'the separators are CSS, not characters in the string');
  const sparse = CK.small({ href: 'https://x/1', date: 'Aug 2 9:29 AM' });
  assert.ok(!/\u00b7/.test(sparse),
    'a row with only a date types no separator characters of its own');
  // Every field is optional, because the CALLER's context decides what is
  // redundant — that is the whole fix for the duplicate-name screenshot.
  assert.ok(!/class="ckplace"|class="ckcount"|class="ckdist"/.test(sparse),
    'and prints no empty cells for the facts it was not given');
});

test('All unseen reports: the same checklist is never listed twice', async () => {
  const app = await boot();
  const A = app.window.__app;
  // The identical submission arriving under two locIds of one hotspot — which
  // is exactly what the name merge above makes possible.
  const rows = A.buildAllUnseen([
    { code: 'merlin', name: 'Merlin', lat: 47.9, lon: -122.2, dateStr: '2026-07-31 15:40',
      distMi: 8.1, loc: 'Penny Creek', locId: 'L1', observer: 'A', subId: 'SDUP' },
    { code: 'merlin', name: 'Merlin', lat: 47.9, lon: -122.2, dateStr: '2026-07-30 15:40',
      distMi: 8.1, loc: 'Penny Creek', locId: 'L2', observer: 'A', subId: 'SDUP' },
  ]);
  const p = rows[0].places[0];
  assert.equal(p.checklists.length, 1, 'one submission is one row however many locIds carried it');
  app.window.close();
});

// The distance was buried mid-sentence in the sub-header — "66 places ·
// nearest 4.2 mi · 67 reports" — where the one number that decides whether you
// can go read at the same weight as the two that don't. It is a column now,
// matching the hotspot medium card.
test('the medium species card gives distance its own column', async () => {
  const app = await boot();
  const SpeciesCards = app.window.SpeciesCards;
  const md = SpeciesCards.medium({
    icon: '<span class="thumb"></span>', name: 'Merlin', sub: '66 places', distMi: 4.24,
  });
  assert.match(md, /class="spdist"/, 'the distance is its own element, not sub-header prose');
  assert.match(md, />4\.2<small>mi<\/small>/, 'one decimal, with the unit as a caption');
  assert.ok(md.indexOf('spdist') > md.indexOf('ntext'),
    'and it sits after the name, so it is the third column');
  // A caller with no distance must not reserve an empty gutter.
  const none = SpeciesCards.medium({ icon: '', name: 'Merlin', sub: 'x' });
  assert.ok(!/spdist/.test(none), 'no distance, no column');
  assert.ok(!/undefined|NaN/.test(SpeciesCards.medium({ name: 'M', distMi: null })),
    'a null distance never leaks a placeholder');

  const css = SpeciesCards.css;
  assert.match(css, /grid-template-columns: auto minmax\(0, 1fr\) auto/,
    'three columns: icon · name · distance');
  // ROW 1 only. The distance used to span both rows, like the hotspot card's
  // number; the sub-header now runs the full width underneath it, so spanning
  // would put the mileage on top of that text.
  assert.match(css, /\.spdist[^}]*grid-column: 3; grid-row: 1;/,
    'the distance occupies row 1, above the full-width sub-header');
  app.window.close();
});

test('All unseen reports drops the rank number from the species name', () => {
  const fn = HTML.slice(HTML.indexOf('function loadAllUnseen('),
    HTML.indexOf('function loadAllUnseen(') + 4000);
  // It rendered hard against the name as "1Merlin".
  assert.ok(!/class="rank"/.test(fn),
    'no rank badge — the list is already ordered, and it read as "1Merlin"');
  assert.match(fn, /distMi: g\.distMi/, 'distance moved to the card column');
  assert.ok(!/nearest ' \+ g\.distMi/.test(fn),
    'so it is not also repeated in the sub-header');
  // The shared renderer owns the name slot for both sections now.
  const card = HTML.slice(HTML.indexOf('function speciesPlacesCard('),
    HTML.indexOf('function easySpotsToPlaces('));
  assert.match(card, /name: speciesLink\(o\.name, o\.code\)/,
    'the name slot is the species name and nothing else');
});

// A bird reported at 66 places turned one card into a wall you had to scroll
// past to reach the next species.
test('All unseen reports shows five places, then folds the rest away', async () => {
  const app = await boot();
  const A = app.window.__app;
  assert.equal(A.UNSEEN_PLACES_SHOWN, 5, 'five places per bird before the fold');
  const card = HTML.slice(HTML.indexOf('function speciesPlacesCard('),
    HTML.indexOf('function easySpotsToPlaces('));
  assert.match(card, /places\.slice\(0, UNSEEN_PLACES_SHOWN\)/, 'the head is the first five');
  assert.match(card, /places\.slice\(UNSEEN_PLACES_SHOWN\)/, 'and the tail is kept, not dropped');
  assert.match(card, /upmore/, 'behind its own expander');

  // Proven by rendering, not just by reading the source: seven places must
  // produce five rows outside the expander and two inside it.
  const places = [];
  for (let i = 0; i < 7; i++) {
    places.push({ loc: 'Spot ' + i, lat: 47, lon: -122, locId: 'L' + i, distMi: i,
                  dateStr: '2026-07-2' + i + ' 08:00', nReports: 1,
                  checklists: [{ subId: 'S' + i, dateStr: '2026-07-2' + i + ' 08:00' }] });
  }
  const html = A.speciesPlacesCard({ code: 'merlin', name: 'Merlin', places: places });
  const cut = html.indexOf('<details class="upmore"');
  assert.ok(cut > 0, 'the expander exists');
  // Counted as CHECKLIST ROWS, not as the old `.uploc` place headings: the
  // section is one line per checklist now, and each of these seven fixtures
  // carries exactly one. Anchoring on `<details class="upmore">` rather than
  // the first `<details>` matters for the same reason — a place's own
  // checklists can open an expander of their own further down the row.
  const rowRe = /class="cklcard cklcard-sm"/g;
  assert.equal((html.slice(0, cut).match(rowRe) || []).length, 5,
    'exactly five places are shown before the fold');
  assert.equal((html.slice(cut).match(rowRe) || []).length, 2,
    'and the remaining two are inside it, not discarded');

  // The cap must not silently become the count.
  const fn = HTML.slice(HTML.indexOf('function loadAllUnseen('),
    HTML.indexOf('function loadAllUnseen(') + 4000);
  assert.match(fn, /near\.length \+ ' place'/,
    'the sub-header still counts ALL near places, not just the five shown');
  app.window.close();
});

// Easy misses hand-rolled its own row markup and so drifted into a different
// card, a different place list and a "#N" rank badge. The card system's rule is
// that no section rolls its own bird row; this is that rule one layer up.
test('Easy misses renders through the SAME card as All unseen', async () => {
  const app = await boot();
  const A = app.window.__app;
  const doc = app.window.document;
  A.renderEasyMisses(Object.assign([{
    code: 'sonspa', name: 'Song Sparrow', days: 12, totalDays: 30, freq: 0.4,
    siteDays: 20, locs: 2,
    spots: [
      { locId: 'L1', name: 'Marymoor Park', lat: 47.66, lng: -122.11, when: '2026-07-30 08:00', sub: 'S1', mi: 6.7 },
      { locId: 'L2', name: 'Juanita Bay', lat: 47.70, lng: -122.20, when: '2026-07-28 09:00', sub: 'S2', mi: 9.1 },
    ],
  }], { minFreq: 0.4 }), 30);
  const box = doc.getElementById('easyResults');
  const ul = box.querySelector('ul');
  for (const cls of ['obs', 'big', 'xl', 'icon-sm']) {
    assert.ok(ul.className.split(/\s+/).includes(cls),
      'the same wrapper All unseen uses, missing: ' + cls);
  }
  assert.ok(box.querySelector('.spdist'), 'distance is the third column here too');
  assert.ok(box.querySelector('.uplaces'), 'places render through the shared place list');
  assert.ok(box.querySelector('.cklcards'), 'with their checklists beneath them');
  assert.ok(!/#1/.test(box.textContent), 'and the "#N" rank badge is gone');
  assert.match(box.textContent, /Marymoor Park/, 'the places are still named');
  app.window.close();
});

test('Easy misses maps its spots onto the shared place shape', async () => {
  const app = await boot();
  const A = app.window.__app;
  // Two spots sharing a hotspot NAME, as the unseen list already merges.
  const places = A.easySpotsToPlaces([
    { locId: 'L1', name: 'Penny Creek', lat: 47.9, lng: -122.2, when: '2026-07-29 08:00', sub: 'S1', mi: 8.1 },
    { locId: 'L2', name: 'penny creek', lat: 47.9, lng: -122.2, when: '2026-07-31 15:40', sub: 'S2', mi: 8.1 },
    { locId: 'L3', name: 'Marymoor Park', lat: 47.6, lng: -122.1, when: '2026-07-30 07:00', sub: 'S3', mi: 12.0 },
  ]);
  assert.equal(places.length, 2, 'one hotspot name is one place, as in All unseen');
  assert.equal(places[0].loc, 'Penny Creek', 'newest place first');
  assert.equal(places[0].checklists.length, 2, 'both checklists kept');
  assert.equal(places[0].checklists[0].subId, 'S2', 'newest checklist first');
  assert.equal(places[0].dateStr, '2026-07-31 15:40', 'the place is dated by its freshest report');
  app.window.close();
});

// Sections that answer the same question different ways read as ONE report with
// several modes. They stay SEPARATE sections because each mirrors its own report
// heading — folding a group into one panel would force declaring the others
// omitted from the app, and the omission list is the one mechanism that catches
// a section silently disappearing.
// --- The chase snapshot survives closing the app ----------------------------
// "I often close the app and then open it again." Every cold start re-fired the
// whole ~47-call wave because the cache lived only in memory — visible in a
// device log as full waves on separate days, and the single largest remaining
// source of 429s.
test('a cold start reuses today\'s snapshot instead of refetching', async () => {
  const rows = { 'king-recent.json': [{ speciesCode: 'merlin', comName: 'Merlin',
    locId: 'L1', locName: 'Marymoor', lat: 47.6, lng: -122.1,
    obsDt: '2026-08-02 08:00', obsValid: true }] };
  // First app: store a snapshot the way the real code does.
  const a1 = await boot();
  await a1.window.__app.saveChaseSnapshot('wa', ['merlin'], rows);
  const stored = a1.window.localStorage.getItem(a1.window.__app.chaseKey('wa'));
  assert.ok(stored, 'a snapshot was written');
  a1.window.close();

  // Second app: same storage, and it must not touch eBird.
  const a2 = await boot({ storage: { [a1.window.__app.chaseKey('wa')]: stored } });
  const before = a2.state.fetches.filter((u) => /api\.ebird\.org/.test(u)).length;
  const res = await a2.window.__app.getChase();
  const after = a2.state.fetches.filter((u) => /api\.ebird\.org/.test(u)).length;
  assert.equal(after, before, 'a fresh snapshot costs ZERO eBird calls');
  assert.ok(res && res.cv, 'and still produces the computed views');
  a2.window.close();
});

// The load-bearing design choice: store the raw feed rows, recompute the views.
// A stored RESULT would keep calling a bird unseen after it had been logged.
test('the snapshot stores raw rows, so a newly seen bird is respected', async () => {
  const rows = { 'king-recent.json': [{ speciesCode: 'merlin', comName: 'Merlin',
    locId: 'L1', locName: 'Marymoor', lat: 47.6, lng: -122.1,
    obsDt: '2026-08-02 08:00', obsValid: true }] };
  const a1 = await boot();
  await a1.window.__app.saveChaseSnapshot('wa', ['merlin'], rows);
  const key = a1.window.__app.chaseKey('wa');
  const stored = a1.window.localStorage.getItem(key);
  const snap = await a1.window.__app.unpackJson(stored);
  assert.ok(snap.rows, 'the payload carries RAW rows');
  assert.ok(!snap.cv && !snap.unseen && !snap.destinations,
    'and NOT the computed views, which would go stale against the seen list');
  a1.window.close();
});

test('a snapshot round-trips through compression', async () => {
  const app = await boot();
  const A = app.window.__app;
  // Realistic shape and volume: field names repeat on every row, which is
  // exactly what makes this worth compressing.
  const rows = { 'big.json': [] };
  for (let i = 0; i < 400; i++) {
    rows['big.json'].push({
      speciesCode: 'merlin', comName: 'Merlin', sciName: 'Falco columbarius',
      locId: 'L' + i, locName: 'Some Hotspot Name ' + i, lat: 47.6, lng: -122.1,
      obsDt: '2026-08-02 08:00', howMany: 1, subId: 'S' + i, obsValid: true,
    });
  }
  const plain = JSON.stringify({ t: 0, codes: null, rows });

  // jsdom has no CompressionStream, so without this the ONLY path these tests
  // ever exercise is the plaintext fallback — and the gzip path is the one that
  // actually runs on the phone. Node has both, so lend them to the window.
  assert.equal(typeof app.window.CompressionStream, 'undefined',
    'jsdom still lacks it — if this ever changes, the lending below is redundant');
  app.window.CompressionStream = CompressionStream;
  app.window.DecompressionStream = DecompressionStream;
  app.window.Response = Response;

  const packed = await A.packJson({ t: Date.now(), codes: null, rows });
  assert.equal(packed.slice(0, 2), 'z:', 'with the API present it really does compress');
  assert.ok(packed.length < plain.length / 2,
    `gzip+base64 must beat plaintext by a wide margin: ${packed.length} vs ${plain.length}`);
  const back = await A.unpackJson(packed);
  assert.equal(back.rows['big.json'].length, 400, 'everything survives the round trip');
  assert.equal(back.rows['big.json'][399].subId, 'S399', 'including the last row');

  // ...and the fallback still works, because a payload written by either build
  // must be readable by the other.
  delete app.window.CompressionStream;
  const raw = await A.packJson({ t: 0, codes: null, rows });
  assert.equal(raw.slice(0, 2), 'j:', 'without the API it falls back to readable JSON');
  const backRaw = await A.unpackJson(raw);
  assert.equal(backRaw.rows['big.json'].length, 400, 'and that round-trips too');
  app.window.close();
});

test('an untagged or corrupt payload is discarded, not thrown', async () => {
  const app = await boot();
  const A = app.window.__app;
  assert.equal(await A.unpackJson('z:not-valid-base64!!'), null, 'corrupt gzip yields null');
  assert.equal(await A.unpackJson('j:{not json'), null, 'corrupt json yields null');
  assert.equal(await A.unpackJson(''), null, 'empty yields null');
  // Written before the format tag existed.
  const bare = await A.unpackJson('{"rows":{}}');
  assert.equal(JSON.stringify(bare), '{"rows":{}}', 'bare JSON still reads');
  app.window.close();
});

test('Refresh drops every cache, or the button does nothing', () => {
  const src = HTML.slice(HTML.indexOf('function clearChaseCache('),
    HTML.indexOf('function clearChaseCache(') + 1200);
  assert.match(src, /localStorage\.removeItem\(chaseKey\(/,
    'clearing the cache must clear the stored snapshot too');
  // The per-URL memo is newer and fails the same way: Refresh would be answered
  // from the in-memory copy of the very feeds it is trying to re-read.
  assert.match(src, /ebClearCache\(\)/,
    'and the per-URL memo, or Refresh returns the same data it already had');
  assert.match(src, /_partialDone = \{\}/,
    'and the once-per-wave repaint guard, or the next wave never repaints');
});

test('only chase-derived sections repaint on the phase-1 publish', () => {
  // Happening now calls getChase() AND fetches its own convoy feeds. Repainting
  // it re-issued those, and at ~3.3 s per call under the measured rate limit
  // that turned a free repaint into a 30-second reload — reported from a device
  // as "happening now appears to be in a load loop".
  const src = HTML.slice(HTML.indexOf('function onChasePartial('),
    HTML.indexOf('function onChasePartial(') + 900);
  assert.match(src, /spec\.fromChase/,
    'the repaint is restricted to loaders that issue no requests of their own');
  assert.match(src, /_partialDone\[slug\]/,
    'and fires once per wave, so a repaint can never cascade');

  const loaders = HTML.slice(HTML.indexOf('var LOADERS = {'),
        HTML.indexOf('var _autoLoaded'));
  // These render purely from the chase cache — verified by grepping each loader
  // for its own ebird() calls.
  ['allUnseenBtn', 'activeBtn', 'destBtn', 'targetsBtn', 'excBtn'].forEach((id) => {
    assert.match(loaders, new RegExp(id + ':[^\\n]*fromChase: true'),
      id + ' renders from the chase cache and may repaint');
  });
  // These fetch their own feeds and must NOT be repainted.
  ['surgeBtn', 'convoyBtn', 'tripBtn', 'quickBtn', 'easyBtn', 'rankBtn', 'abaBtn'].forEach((id) => {
    const line = loaders.split('\n').filter((l) => l.indexOf(id + ':') >= 0)[0] || '';
    assert.ok(line && line.indexOf('fromChase') < 0,
      id + ' issues its own requests, so repainting it would refetch');
  });
});

test('yesterday\'s snapshot is pruned, not kept forever', async () => {
  const app = await boot();
  const A = app.window.__app;
  const stale = 'ebird_chase_v1:wa:2020-01-01';
  app.window.localStorage.setItem(stale, 'j:{"rows":{}}');
  await A.saveChaseSnapshot('wa', null, { 'a.json': [{ x: 1 }] });
  assert.equal(app.window.localStorage.getItem(stale), null,
    'a day-scoped snapshot from another day is removed — keeping them is how a cache '
    + 'becomes the reason the next write fails');
  assert.ok(app.window.localStorage.getItem(A.chaseKey('wa')), "but today's is kept");
  app.window.close();
});

// --- Reported from the device: frequent HTTP 429 ----------------------------
// The foreground lane was a bare fetch, written when a foreground load really
// was "a handful of calls the user is waiting on". That premise expired: the
// chase pipeline's phase 2 is one call PER UNSEEN SPECIES (~41 on a normal
// Washington day) and hotspot cards hydrate one call each after paint. A single
// 429 then rendered an empty section instead of costing a second.
test('a rate-limited foreground call is retried, not fatal', async () => {
  let hits = 0;
  const app = await boot({
    fetch(url) {
      if (!/ref\/region\/info/.test(url)) return null;
      hits++;
      // Rate-limited once, then fine — the shape of a real burst.
      if (hits === 1) return { __status: 429, __headers: { 'Retry-After': '0.05' } };
      return { code: 'US-WA', result: 'ok' };
    },
  });
  const A = app.window.__app;
  const out = await A.ebird('ref/region/info/US-WA');
  assert.equal(hits, 2, 'the 429 was retried rather than thrown at the section');
  assert.equal(out.result, 'ok', 'and the caller gets the real answer');
  app.window.close();
});

test('a 429 that never clears says what it is, in words', async () => {
  const app = await boot({
    fetch(url) {
      if (!/ref\/region\/info/.test(url)) return null;
      return { __status: 429, __headers: { 'Retry-After': '0.01' } };
    },
  });
  const A = app.window.__app;
  let err = null;
  try { await A.ebird('ref/region/info/US-WA'); } catch (e) { err = e; }
  assert.ok(err, 'it still fails eventually rather than retrying forever');
  // "eBird returned HTTP 429" tells the reader nothing they can act on.
  assert.match(err.message, /rate-limit/i,
    `the message names the cause: got "${err && err.message}"`);
  assert.match(err.message, /minute|try again/i, 'and what to do about it');
  app.window.close();
});

test('Retry-After is obeyed when eBird sends one', async () => {
  const app = await boot();
  const A = app.window.__app;
  // A guessed backoff that is shorter than the server asked for earns the next
  // 429, so a header in seconds is the only number here that is not a guess.
  const withHeader = A.retryAfterMs({ headers: { get: () => '2' } }, 0);
  assert.equal(withHeader, 2000, 'seconds from the header become milliseconds');
  const capped = A.retryAfterMs({ headers: { get: () => '9999' } }, 0);
  assert.ok(capped <= 30000, 'but an absurd value is capped rather than hanging the app');
  const guessed = A.retryAfterMs({ headers: { get: () => null } }, 2);
  assert.equal(guessed, 4000, 'with no header it backs off exponentially');
  app.window.close();
});

test('a burst of foreground calls is bounded', async () => {
  const app = await boot();
  const A = app.window.__app;
  // Sized from a real device log, not guessed: 6-wide batches put 24 calls
  // through in 570 ms and the 25th onward was refused, while 8 sequential
  // calls at 4.5 req/s drew no 429 at all. So the ceiling is a BURST
  // allowance, and two knobs are needed — concurrency stops a batch arriving
  // as a spike, the gap holds the sustained rate.
  assert.ok(A.FG_MAX_CONC >= 1 && A.FG_MAX_CONC <= 3,
    `concurrency must stay well under the 6-wide batches that tripped it: ${A.FG_MAX_CONC}`);
  const perSec = (1000 / A.FG_MIN_GAP_MS) * 1;
  assert.ok(perSec <= 5,
    `sustained rate must stay at or under the ~4.5/s the log proves safe: ${perSec}/s`);
  // ...and not so slow that a 41-call wave is unusable on a phone.
  const waveSec = (41 * A.FG_MIN_GAP_MS) / 1000;
  assert.ok(waveSec < 15, `a full wave must still finish promptly: ${waveSec}s`);
  app.window.close();
});

test('one 429 slows the whole lane, not just the call that failed', () => {
  const src = HTML.slice(HTML.indexOf('function fgAttempt('),
    HTML.indexOf('function ebird('));
  // The expensive part of a 429 is not the first one, it is the recovery. A
  // device log measured 15 successes in 100 s afterwards, with ~25 further
  // 429s interleaved and three species dropped entirely — because each
  // success immediately released the next call into a limiter that had just
  // refused. Backing off only the failed call is what turns one 429 into
  // twenty-five, so a refusal has to be treated as evidence about the LANE.
  assert.match(src, /_fgNextAt = Math\.max\(_fgNextAt, Date\.now\(\) \+ Math\.max\(back, FG_COOLDOWN_MS\)\)/,
    'the shared gate is held for a real cooldown, so the whole wave waits');
  assert.match(src, /_fgGap = Math\.min\(FG_GAP_MAX, Math\.max\(_fgGap \* 2, 1000\)\)/,
    'and the sustained gap doubles — multiplicative decrease, so it backs off fast');
  assert.match(src, /_fgTokens = 0/,
    'and the burst bucket is emptied, or the next call bursts straight back into the wall');
});

test('the rate limiter is sized from what the log actually measured', async () => {
  const app = await boot();
  const A = app.window.__app;
  // 37 calls got through in 7.7 s before the first refusal, so the bucket is
  // ~37 and a burst under that is safe. Sizing it AT the observed limit would
  // trip on the very next call, so it sits below.
  assert.ok(A.FG_BUCKET > 0 && A.FG_BUCKET <= 10,
    'the burst allowance sits under the DIRECTLY MEASURED bucket of ~10 '
    + '(prototypes/ebird-ratelimit-probe2.py), not the ~37 a device log implied');
  // Serialized. The log's 429s arrive in PAIRS because two calls were always
  // in flight, so every refusal cost two.
  assert.equal(A.FG_MAX_CONC, 1, 'one call in flight, so a refusal costs one call');
  // The sustained ceiling is ~0.37/s measured directly, and the report job
  // already spends 0.25/s of it. Sitting above this is how the 429 storm
  // happened.
  assert.ok(A.FG_REFILL_PER_S > 0 && A.FG_REFILL_PER_S <= 0.37,
    'the sustained rate is under the measured 0.37/s ceiling');
});

test('a long wave reports staged progress instead of a moving total', async () => {
  const app = await boot();
  const A = app.window.__app;
  assert.ok(app.$('loadBar'), 'there is a progress bar');
  assert.ok(app.$('loadBarFill'), 'with a fill');
  assert.ok(app.$('loadBarText'), 'and a label');
  assert.equal(app.$('loadBar').hidden, true, 'hidden when nothing is in flight');

  // A denominator that grows is not progress. Each stage declares a FIXED
  // total and is named for what it is fetching — "12 of 20" then "12 of 44"
  // then "12 of 51" made a working wave look like a looping one.
  A.progressStage('Recent sightings near you', 8);
  let st = A.progressState();
  assert.equal(st.total, 8, 'the stage total is fixed up front');
  assert.equal(st.done, 0);
  assert.equal(app.$('loadBar').hidden, false, 'and the bar is showing');
  assert.match(app.$('loadBarText').textContent, /Recent sightings near you — 0 of 8/,
    'the label says WHAT is loading, not just a count');

  A.progressStep(); A.progressStep();
  assert.equal(A.progressState().done, 2);
  assert.match(app.$('loadBarText').textContent, /2 of 8/);
  assert.equal(app.$('loadBarFill').style.width, '25%');

  // A second stage replaces the first rather than extending its total.
  A.progressStage('Finding where your missing birds are', 44);
  st = A.progressState();
  assert.equal(st.total, 44, 'the new stage has its own total');
  assert.equal(st.done, 0, 'and starts from zero rather than carrying over');
  assert.match(app.$('loadBarText').textContent, /Finding where your missing birds are — 0 of 44/);

  // Stepping can never run past the stage total, so the bar cannot read
  // "46 of 44" if a stray completion arrives.
  A.progressStep(99);
  assert.equal(A.progressState().done, 44, 'progress is clamped to the stage');

  A.progressEnd();
  assert.equal(A.progressState(), null, 'and the stage clears when it is done');
});

// "I would the loading progress bar to show more granular progress with more
// detailed descriptions or more specific descriptions of what its doing. its
// not clear what its loading."
test('the progress bar names the step, the feed, and any pause', async () => {
  const app = await boot();
  const A = app.window.__app;
  const text = () => app.$('loadBarText').textContent;

  // 1. WHICH step of how many. A bar with no end in sight reads as a hang even
  //    when it is moving.
  A.progressStage('Recent sightings near you', 8, 1, 2);
  assert.match(text(), /^Step 1 of 2 · Recent sightings near you — 0 of 8/,
    'the label says which step this is');

  // 2. WHAT just finished. The feeds run concurrently, so "in flight" is
  //    several things at once and cannot be reported honestly — the last one
  //    to land can.
  A.progressStep(1, A.feedLabel({ src: 'King County', kind: 'notable' }));
  assert.match(text(), /1 of 8 · King County · rare birds/,
    'and names the feed that just landed');
  assert.equal(A.feedLabel({ src: 'Snohomish County', kind: 'recent' }),
    'Snohomish County · everything reported',
    'a plain recent feed says so in words');
  assert.equal(A.feedLabel({ src: 'Geo50km', kind: 'recent' }),
    'within 31 mi of home · everything reported',
    'and "Geo50km" is turned into a distance a reader recognises — in the '
    + 'miles the rest of the app uses, not the km the eBird parameter takes');

  // 3. A HELD LANE IS THE ONE THING THAT LOOKS BROKEN. During a 429 cooldown
  //    nothing completes for up to a minute: the count freezes, the bar sits
  //    still, and the app reads as hung. A countdown is visibly progress even
  //    while the completed count is not moving.
  A.fgSetNextAt(Date.now() + 12000);
  A.fgProgressSync();
  assert.match(text(), /paused 1[12]s — eBird rate limit/,
    'a rate-limit hold says how long it is holding for');
  assert.ok(!/going slowly/.test(text()),
    'and does not also mutter about the gap — the countdown is the message');

  A.fgSetNextAt(0);
  A.fgProgressSync();
  assert.ok(!/paused/.test(text()), 'and the notice clears when the lane reopens');
  A.progressEnd();
});

test('a hand-added region asks GBIF for a real state name', async () => {
  // The built-in regions' `label` IS the state name — "Washington", "Missouri" —
  // so reading getReport().label worked by coincidence. It stops being a
  // coincidence the moment a region is added by hand: a trip called "Tucson in
  // April" would be sent as stateProvince=Tucson%20in%20April, match nothing,
  // and return null for every species. That is indistinguishable from "this
  // state has no migrants", which is a real answer, so the failure is silent.
  const BL = require('../www/logic.js');

  assert.strictEqual(BL.stateNameFor({ stateCode: 'US-WA', label: 'Washington' }),
    'Washington', 'a built-in region must keep working unchanged');
  assert.strictEqual(BL.stateNameFor({ stateCode: 'US-AZ', label: 'Tucson in April' }),
    'Arizona',
    'a hand-added region must resolve its state from the DERIVED code, not the '
    + 'typed label');
  assert.strictEqual(BL.stateNameFor({ stateCode: 'us-mo', label: 'anything' }),
    'Missouri', 'the code lookup must not be case-sensitive');

  // A continent-wide tracker has no stateProvince, and '' is the honest answer:
  // scoping a GBIF query to "Lower 48" would return nothing and look like data.
  assert.strictEqual(BL.stateNameFor({ stateCode: '', label: 'Lower 48' }), '',
    'a continent-wide region must report NO state rather than a guess');
  assert.strictEqual(BL.stateNameFor(null), '');

  // Every built-in region must resolve, or a section silently empties there.
  for (const slug of BL.REGION_ORDER) {
    const p = BL.REPORTS[slug];
    const st = BL.stateNameFor(p);
    if (p.stateCode && /^US-[A-Z]{2}$/.test(p.stateCode)) {
      assert.ok(st, `${slug} (${p.stateCode}) resolves to no GBIF state name`);
    }
  }
});

test('adding a region warms it, without touching the eBird budget for feeds', async () => {
  // "when a region is added, it can start downloading seed data for that region
  //  including gbif"
  //
  // The warm-up is allowed to spend the species index (~7 cached eBird calls)
  // and GBIF (no per-key budget). It must NOT prefetch rarities, hotspots or
  // checklists: those go stale in hours, and spending a shared budget on a
  // region you have not opened yet is the speculative traffic this project
  // keeps refusing. Adding a region must not cost you the feed you are reading.
  const seen = [];
  const app = await boot({
    fetch(url) {
      seen.push(url);
      if (/gbif\.org/.test(url)) return { results: [], usageKey: 0, count: 0, facets: [] };
      if (/product\/spplist/.test(url)) return ['weskin', 'norcar'];
      if (/ref\/taxonomy/.test(url)) {
        return [{ speciesCode: 'weskin', comName: 'Western Kingbird', sciName: 'Tyrannus verticalis' },
                { speciesCode: 'norcar', comName: 'Northern Cardinal', sciName: 'Cardinalis cardinalis' }];
      }
      return null;
    },
  });
  const a = app.window.__app;
  const before = seen.length;
  const r = await a.warmRegion({ slug: 'user-test', stateCode: 'US-AZ',
                                 label: 'Tucson in April' });
  assert.ok(r, 'the warm-up reported nothing');
  assert.strictEqual(r.species, 2, 'the species index was not fetched');

  const spent = seen.slice(before);
  const forbidden = spent.filter((u) =>
    /data\/obs\/.*\/recent(?!\/)/.test(u) || /notable/.test(u)
    || /ref\/hotspot/.test(u) || /product\/lists/.test(u)
    || /product\/checklist/.test(u));
  assert.deepStrictEqual(forbidden, [],
    'the warm-up prefetched live eBird feeds: ' + JSON.stringify(forbidden));

  // And the GBIF side was actually asked, using the RESOLVED state name.
  const gbif = spent.filter((u) => /gbif\.org/.test(u));
  assert.ok(gbif.length, 'no GBIF call was made, so no arrival history was warmed');
});

test('warming the same region twice does not do it twice', async () => {
  const app = await boot({
    fetch(url) {
      if (/gbif\.org/.test(url)) return { results: [], usageKey: 0, count: 0, facets: [] };
      if (/product\/spplist/.test(url)) return ['weskin'];
      if (/ref\/taxonomy/.test(url)) {
        return [{ speciesCode: 'weskin', comName: 'Western Kingbird', sciName: 'Tyrannus verticalis' }];
      }
      return null;
    },
  });
  const a = app.window.__app;
  const p1 = a.warmRegion({ slug: 'user-dup', stateCode: 'US-AZ', label: 'x' });
  const p2 = a.warmRegion({ slug: 'user-dup', stateCode: 'US-AZ', label: 'x' });
  assert.strictEqual(p1, p2,
    'a second warm-up for the same region started a second sweep — tapping Add '
    + 'twice would read the whole state twice');
  await p1;
});

test('the bundled arrival table means the phone does not ask GBIF again', async () => {
  // The whole economy of v1.4.0. birding/scripts/harvest_arrivals.py asks these
  // questions once, for everyone, because the answer is identical for every
  // user in the state and comes from an archive that lags a year. If the seed
  // does not actually land in the store, the section still WORKS — it just
  // quietly spends a thousand calls per phone to rediscover 27 KB it already
  // shipped with, which is the kind of regression nothing else would catch.
  const app = await boot({
    fetch(url) {
      if (/gbif\.org/.test(url)) return { results: [], usageKey: 0, count: 0, facets: [] };
      return null;
    },
  });
  const a = app.window.__app;
  const bundle = app.window.__ARRIVALS__;
  assert.ok(bundle && bundle.states,
    'arrivals.js did not load — run `node assets/build-arrivals.js`');
  const wa = bundle.states.Washington;
  assert.ok(wa && Object.keys(wa.a).length > 50,
    'the Washington table is missing or implausibly small');
  assert.ok((wa.res || []).length > 50,
    'no residents shipped — they are the MAJORITY of a region and each one is '
    + 'two calls the device now never makes; shipping only the dated species '
    + 'leaves the phone rediscovering "no" hundreds of times');

  const store = a.loadArrivalStore('US-WA', 'Washington');
  const anySci = Object.keys(wa.a)[0];
  assert.ok(store.done[anySci] && store.done[anySci].day,
    'a dated species from the bundle is not in the store, so the sweep would '
    + 'fetch it again');
  assert.strictEqual(store.done[wa.res[0]], null,
    'a bundled resident is not recorded as a resident, so the sweep would '
    + 'spend two calls to be told what the bundle already said');

  // ...and with it seeded, a sweep over those species must do nothing at all.
  const rows = Object.keys(wa.a).slice(0, 20).map((sci) => ({
    code: wa.a[sci].c, name: sci, sci,
  }));
  let asked = 0;
  const n = await a.sweepArrivals(rows, 'US-WA', 'Washington', store,
    () => true, () => { asked++; });
  assert.strictEqual(n, 0, 'the sweep found work to do on species the bundle covers');
  assert.strictEqual(asked, 0, 'the sweep fetched a species the bundle covers');
});

test('the bundle never overwrites what this phone already learned', async () => {
  // A table shipped in January must not overwrite what a phone learned in June.
  // Anything the device fetched itself is at worst as old as the bundle and at
  // best newer, so `done` wins on every collision.
  const app = await boot({
    fetch(url) {
      if (/gbif\.org/.test(url)) return { results: [], usageKey: 0, count: 0, facets: [] };
      return null;
    },
  });
  const a = app.window.__app;
  const wa = app.window.__ARRIVALS__.states.Washington;
  const sci = Object.keys(wa.a)[0];
  const bundledDay = wa.a[sci].d;

  const mine = { at: 1, done: {} };
  mine.done[sci] = { day: '02-29', records: 1, months: 3, peakMonth: 3 };
  const seeded = a.seedArrivals(mine, 'Washington');
  assert.strictEqual(seeded.done[sci].day, '02-29',
    `the bundle overwrote a device-learned answer with ${bundledDay}`);

  // A resident the device has since dated must also survive.
  const res = wa.res[0];
  const mine2 = { at: 1, done: {} };
  mine2.done[res] = { day: '05-05', records: 9, months: 4, peakMonth: 5 };
  assert.ok(a.seedArrivals(mine2, 'Washington').done[res].day === '05-05',
    'the bundle demoted a species the device had dated back to resident');
});

test('a state with no harvest still works', async () => {
  // Only Washington is harvested. Every other region must fall through to the
  // live sweep rather than showing an empty section, because "we have not
  // harvested Missouri" is not something a reader should ever have to know.
  const app = await boot({
    fetch(url) {
      if (/gbif\.org/.test(url)) return { results: [], usageKey: 0, count: 0, facets: [] };
      return null;
    },
  });
  const a = app.window.__app;
  const store = a.loadArrivalStore('US-MO', 'Missouri');
  assert.strictEqual(Object.keys(store.done).length, 0,
    'an unharvested state was seeded with something');
  assert.ok(!store.seeded, 'an unharvested state claims to be seeded');
});

// ---- 📆 Due back soon (F11 part 2) -----------------------------------------
//
// The only screen that knowingly spends hundreds of calls. Three properties are
// what make that defensible rather than reckless, and each one is a separate
// test because each fails silently and differently: a lost negative just costs
// money, a lost resume costs the whole sweep, and a lost `alive` check writes
// into a list nobody is looking at.

test('a resident is remembered as a resident — the sweep caches its NOs', async () => {
  // gbifArrival returns null for a bird that is present all year and caches
  // NOTHING, which is right for a lookup and ruinous for a sweep: most of a
  // region's list are residents, so an uncached null means paying for the same
  // "no" on every run, forever. Storing it is what makes the second run free.
  const app = await boot({
    fetch(url) {
      // Everything GBIF answers "no such taxon", which is the cheap path:
      // gbifArrival gives up at the taxon key and never reaches the facets.
      if (/gbif\.org/.test(url)) return { results: [], usageKey: 0, count: 0, facets: [] };
      return null;
    },
  });
  const a = app.window.__app;
  const store = { at: 0, done: {} };
  const rows = [{ code: 'norcar', name: 'Northern Cardinal', sci: 'Cardinalis cardinalis' }];

  let calls = 0;
  const realGbif = app.window.fetch;
  app.window.fetch = (...args) => { calls++; return realGbif(...args); };

  await a.sweepArrivals(rows, 'US-WA', 'Washington', store, () => true, null);
  assert.ok('Cardinalis cardinalis' in store.done,
    'a species the sweep asked about must be recorded even when the answer is '
    + '"no arrival to predict" — otherwise it is asked again on every run');
  assert.strictEqual(store.done['Cardinalis cardinalis'], null,
    'the stored form of "no arrival" is null, which is a RESULT, not a gap');

  // ...and asking again must not spend anything.
  const before = calls;
  await a.sweepArrivals(rows, 'US-WA', 'Washington', store, () => true, null);
  assert.strictEqual(calls, before,
    'the second sweep re-fetched a species it had already answered — the cache '
    + 'is not being consulted, so a 400-species region pays full price forever');
});

test('the sweep resumes instead of restarting', async () => {
  // The answers ARE the cursor: a species is either in the map or it is not.
  // That is the whole resume mechanism, so it has to be true that a populated
  // store means no work.
  const app = await boot({
    fetch(url) {
      // Everything GBIF answers "no such taxon", which is the cheap path:
      // gbifArrival gives up at the taxon key and never reaches the facets.
      if (/gbif\.org/.test(url)) return { results: [], usageKey: 0, count: 0, facets: [] };
      return null;
    },
  });
  const a = app.window.__app;
  const rows = [
    { code: 'aaa', name: 'A', sci: 'Genus a' },
    { code: 'bbb', name: 'B', sci: 'Genus b' },
    { code: 'ccc', name: 'C', sci: 'Genus c' },
  ];
  // Two already answered — one positively, one negatively. Both count as done.
  const store = { at: 0, done: { 'Genus a': { day: '04-20', records: 10 }, 'Genus b': null } };
  const asked = [];
  const n = await a.sweepArrivals(rows, 'US-WA', 'Washington', store,
    () => true, (done, total, name) => asked.push(name));
  assert.strictEqual(n, 1,
    'the sweep should have had exactly one species left to do, not ' + n
    + ' — a resume that redoes finished work is not a resume');
  assert.strictEqual(asked.join(','), 'C', 'only the unanswered species is fetched');
});

test('a sweep whose section has gone away stops asking', async () => {
  // Same failure as the detached convoy box: work that outlives the thing that
  // wanted it. Here it also writes to localStorage, so it is not merely wasted.
  const app = await boot({
    fetch(url) {
      // Everything GBIF answers "no such taxon", which is the cheap path:
      // gbifArrival gives up at the taxon key and never reaches the facets.
      if (/gbif\.org/.test(url)) return { results: [], usageKey: 0, count: 0, facets: [] };
      return null;
    },
  });
  const a = app.window.__app;
  const rows = Array.from({ length: 8 }, (_, i) => (
    { code: 'c' + i, name: 'Bird ' + i, sci: 'Genus sp' + i }));
  const store = { at: 0, done: {} };
  let seen = 0;
  await a.sweepArrivals(rows, 'US-WA', 'Washington', store,
    () => false,                     // closed before the first call resolves
    () => { seen++; });
  assert.strictEqual(seen, 0,
    'a dead sweep still reported progress; nothing should be fetched or '
    + 'recorded once the section it belongs to is gone');
  assert.strictEqual(Object.keys(store.done).length, 0,
    'a dead sweep still wrote results');
});

test('due back soon shows what is coming, soonest first, and what you need', async () => {
  const app = await boot({
    fetch(url) {
      // Everything GBIF answers "no such taxon", which is the cheap path:
      // gbifArrival gives up at the taxon key and never reaches the facets.
      if (/gbif\.org/.test(url)) return { results: [], usageKey: 0, count: 0, facets: [] };
      return null;
    },
  });
  const a = app.window.__app;
  const rows = [
    { code: 'weskin', name: 'Western Kingbird', sci: 'Tyrannus verticalis' },
    { code: 'rufhum', name: 'Rufous Hummingbird', sci: 'Selasphorus rufus' },
    { code: 'vargre', name: 'Varied Thrush', sci: 'Ixoreus naevius' },
    { code: 'norcar', name: 'Northern Cardinal', sci: 'Cardinalis cardinalis' },
    { code: 'farout', name: 'Far Out Warbler', sci: 'Distant warblerus' },
  ];
  const store = { at: 0, done: {
    'Tyrannus verticalis': { day: '04-20', records: 900 },   // +5 days
    'Selasphorus rufus':   { day: '04-28', records: 400 },   // +13 days
    'Ixoreus naevius':     { day: '04-05', records: 700 },   // -10, already back
    'Cardinalis cardinalis': null,                           // resident
    'Distant warblerus':   { day: '09-01', records: 50 },    // far outside window
  } };
  const now = new Date(2026, 3, 15);            // 15 Apr 2026
  const seen = { rufhum: 1 };                   // already got this one
  const out = a.dueBackRows(store, rows, seen, now);

  // Joined rather than deepStrictEqual: `out` is built inside jsdom, so its
  // Array.prototype is a different realm's and a strict deep compare rejects
  // arrays whose contents are identical.
  assert.strictEqual(out.map((r) => r.name).join(' | '),
    ['Varied Thrush', 'Western Kingbird', 'Rufous Hummingbird'].join(' | '),
    'rows must be soonest-first with an already-arrived bird at the top — it is '
    + 'the one you can act on today — and must exclude both the resident (no '
    + 'arrival to predict) and the bird months away');
  assert.strictEqual(out[0].days, -10, 'a bird already back reads as negative days');
  assert.strictEqual(out.find((r) => r.code === 'rufhum').need, false,
    'a bird already on your year list is listed but not flagged as needed');
  assert.strictEqual(out.find((r) => r.code === 'weskin').need, true,
    'a bird you have not recorded is flagged');
  assert.match(a.dueBackWhen(0), /today/);
  assert.match(a.dueBackWhen(-3), /3 days ago/);
});

// BirdLogic.iconicMultiplier, iconicLabel, arrivalDay and the GBIF callers were
// all built, parity-tested, and wired to nothing — the same failure as a button
// bound to no handler, except harder to notice because the code looks finished.
// A bird that is hard to find is not a bird that is rare, and this is the only
// thing in the app that can tell them apart.
test('a species lookup shows how good its places are historically', async () => {
  const app = await boot({
    fetch(url) {
      if (/ref\/taxonomy/.test(url)) return [];
      if (/product\/spplist/.test(url)) return ['weskin'];
      if (/data\/obs\/.*\/recent\/weskin/.test(url)) {
        return [{
          speciesCode: 'weskin', comName: 'Western Kingbird', sciName: 'Tyrannus verticalis',
          locId: 'L1', locName: 'McNary NWR', lat: 46.1, lng: -119.0,
          obsDt: '2026-07-31 08:00', howMany: 2, subId: 'S1', obsValid: true,
        }];
      }
      // GBIF: species/match, then the counts the multiplier divides.
      if (/species\/match/.test(url)) return { usageKey: 2482593 };
      // The baseline is the COUNTY the place sits in, so the code reverse-
      // geocodes the coordinate first. Unstubbed, this hangs forever by design
      // (see boot()), which is how it should behave - an unanswered dependency
      // must not quietly pass.
      if (/geocode\/reverse/.test(url)) {
        return [
          { type: 'GADM0', id: 'USA', title: 'United States' },
          { type: 'GADM1', id: 'USA.48_1', title: 'Washington' },
          { type: 'GADM2', id: 'USA.48.03_1', title: 'Benton' },
        ];
      }
      if (/occurrence\/search/.test(url)) {
        if (/facet=year/.test(url)) {
          // Eight seasons of effort; the kingbird in six of them.
          const sp = !/taxonKey=212/.test(url);
          return { count: 1, facets: [{ field: 'YEAR', counts: [
            { name: '2017', count: sp ? 0 : 40 }, { name: '2018', count: sp ? 7 : 40 },
            { name: '2019', count: sp ? 9 : 40 }, { name: '2020', count: sp ? 0 : 40 },
            { name: '2021', count: sp ? 11 : 40 }, { name: '2022', count: sp ? 8 : 40 },
            { name: '2023', count: sp ? 14 : 40 }, { name: '2024', count: sp ? 12 : 40 },
          ].filter((x) => x.count > 0) }] };
        }
        if (/facet=month/.test(url)) {
          return { count: 4000, facets: [{ field: 'MONTH', counts: [
            { name: '4', count: 900 }, { name: '5', count: 1500 },
            { name: '6', count: 1200 }, { name: '7', count: 400 },
          ] }] };
        }
        if (/facet=day/.test(url)) {
          return { count: 900, facets: [{ field: 'DAY', counts: [
            { name: '18', count: 5 }, { name: '20', count: 60 }, { name: '25', count: 200 },
          ] }] };
        }
        // geometry= is the 2 km box; gadmGid= the county baseline that replaced
        // the statewide one; neither, the state-wide fallback.
        if (/geometry=/.test(url)) return { count: /taxonKey=212/.test(url) ? 56424 : 721 };
        if (/gadmGid=/.test(url)) return { count: /taxonKey=212/.test(url) ? 1360000 : 2100 };
        return { count: /taxonKey=212/.test(url) ? 36800000 : 45199 };
      }
      return null;
    },
    storage: {
      'ebird_species_v2:US-WA': JSON.stringify({
        at: Date.now(),
        rows: [{ code: 'weskin', name: 'Western Kingbird', sci: 'Tyrannus verticalis' }],
      }),
    },
  });
  const doc = app.window.document;
  const A = app.window.__app;
  assert.equal(A.sciNameFor('weskin'), 'Tyrannus verticalis',
    'the scientific name comes from the cached index — GBIF does not resolve common names');

  doc.getElementById('spLookup').value = 'Western Kingbird';
  A.runSpeciesLookup();
  await new Promise((r) => setTimeout(r, 400));
  const host = doc.getElementById('spLookupBest');
  assert.ok(host, 'the lookup has somewhere to put this');
  const txt = host.textContent;

  // THIS BLOCK NO LONGER RANKS PLACES, and that is the fix rather than a
  // regression. It used to print its own five-place ranking under the list,
  // computed over a different sample and a different window than the Iconic
  // view above it — "this content doesnt make sense and contradicts above
  // list. values arent in list above." It printed the multiplier twice, had no
  // isPublicPlace filter (somebody's "Home", 79 miles away), and could show
  // "3.4× · seen in 0 of 8 years" because the two numbers used different
  // windows. All of that came from answering a question that already had an
  // answer. One question, one answer, and the answer is the Iconic sort.
  assert.ok(!/×/.test(txt),
    `the duplicate place ranking is back: got "${txt.slice(0, 200)}"`);
  assert.ok(!/McNary/.test(txt),
    'it is ranking places again instead of leaving that to the Iconic view');

  // What stays is the ARRIVAL note, which nothing else in the app says.
  assert.match(txt, /Historically back around/,
    'the arrival note went with it — that one is not duplicated anywhere');
  assert.match(txt, /GBIF lags/,
    'and it still says the archive is a year behind, so it is not read as this season');
  app.window.close();
});

test('the historical block never blocks or breaks the live answer', async () => {
  const app = await boot({
    fetch(url) {
      if (/ref\/taxonomy/.test(url)) return [];
      if (/product\/spplist/.test(url)) return ['weskin'];
      if (/data\/obs\/.*\/recent\/weskin/.test(url)) {
        return [{
          speciesCode: 'weskin', comName: 'Western Kingbird', sciName: 'Tyrannus verticalis',
          locId: 'L1', locName: 'McNary NWR', lat: 46.1, lng: -119.0,
          obsDt: '2026-07-31 08:00', howMany: 2, subId: 'S1', obsValid: true,
        }];
      }
      return null;   // every GBIF call fails
    },
    storage: {
      'ebird_species_v2:US-WA': JSON.stringify({
        at: Date.now(),
        rows: [{ code: 'weskin', name: 'Western Kingbird', sci: 'Tyrannus verticalis' }],
      }),
    },
  });
  const doc = app.window.document;
  doc.getElementById('spLookup').value = 'Western Kingbird';
  app.window.__app.runSpeciesLookup();
  await new Promise((r) => setTimeout(r, 900));
  // The live answer is the section's job; GBIF is enrichment from a keyless
  // third party and must never be able to take the section down with it.
  assert.ok(doc.querySelectorAll('#spLookupResults li').length > 0,
    'the live places still render when GBIF is unreachable');
  const left = doc.getElementById('spLookupBest').textContent.trim();
  assert.ok(!/×/.test(left),
    `no multiplier is invented when GBIF is unreachable: got "${left.slice(0, 120)}"`);
  app.window.close();
});

// Manual, hand-listed, keyed by locId because a hotspot NAME is not stable —
// eBird renames and merges them, and the same name exists in several counties.
// The file is shared byte-identical with the report so a site flagged in one is
// flagged in both.
test('a scope site is badged on its name, everywhere a place is rendered', async () => {
  const app = await boot();
  const A = app.window.__app;
  A.setScopeSites({ L164858: { name: 'Jetty Island', why: 'the birds are out on the far flats' } });
  assert.equal(A.scopeBadge('L164858'), ' 🔭', 'a listed site is badged');
  assert.equal(A.scopeBadge('L999'), '', 'an ordinary hotspot is not');
  assert.equal(A.scopeBadge(''), '', 'and a missing id never badges');
  assert.match(A.scopeWhy('L164858'), /far flats/, 'the reason is available to render');

  // The badge rides on the NAME, via locLink, so it reaches every section that
  // renders a place rather than only the ones that thought to ask.
  const withScope = A.locLink('Jetty Island', 48.0, -122.2, 'L164858', false);
  assert.match(withScope, /🔭/, 'a scope site is marked wherever a place is linked');
  const plain = A.locLink('Marymoor Park', 47.6, -122.1, 'L1', false);
  assert.ok(!/🔭/.test(plain), 'and an ordinary one is left alone');
  // A private location has no hotspot page but can still want a scope.
  assert.match(A.locLink('Some Spit', 48.0, -122.2, 'L164858', true), /🔭/,
    'including private locations, which take the other branch');
  app.window.close();
});

test('a missing scope file costs the badge, never the section', async () => {
  const app = await boot();
  const A = app.window.__app;
  A.setScopeSites({});   // as if the file were absent or unreadable
  assert.equal(A.scopeBadge('L164858'), '', 'no data, no badge');
  assert.match(A.locLink('Jetty Island', 48.0, -122.2, 'L164858', false), /Jetty Island/,
    'and the place still renders — an optional annotation must not take a section with it');
  app.window.close();
});

test('the app ships the same scope list the report reads', async () => {
  const fs2 = require('node:fs');
  const appFile = path.join(WWW, 'scope-sites.json');
  assert.ok(fs2.existsSync(appFile), 'the app bundles the file, so it works offline');
  const data = JSON.parse(fs2.readFileSync(appFile, 'utf8'));
  assert.ok(data.sites && Object.keys(data.sites).length >= 2,
    'seeded with the known sites');
  for (const [id, e] of Object.entries(data.sites)) {
    assert.match(id, /^L\d+$/, 'keyed by eBird locId, because a hotspot NAME is not stable');
    assert.ok(e.why && e.why.length > 20,
      `${id} states WHY it wants a scope — "scope site" does not tell you whether to carry the tripod`);
  }
});

// "distance from home" in every mode that RANKS places, and "leg from the
// previous stop" in the planner, which SEQUENCES them. Now that they are modes
// of one report, an unlabelled column silently means two things.
test('the distance column says which distance it is', async () => {
  const app = await boot();
  const HC = app.window.HotspotCards;
  const ranked = HC.medium({ locName: 'Marymoor', distance: 8.04 });
  assert.match(ranked, /8\.0<small>mi<\/small>/, 'ranking modes read plain miles');
  const leg = HC.medium({ locName: 'Marymoor', distance: 2.1, distanceLabel: 'mi leg' });
  assert.match(leg, /2\.1<small>mi leg<\/small>/, 'the planner names its column a leg');
  // And the planner must actually pass it, or the guard tests a capability
  // nothing uses.
  const src = HTML.slice(HTML.indexOf('function renderRoute('),
    HTML.indexOf('function renderRoute(') + 1400);
  assert.match(src, /distMi: d\.leg/, 'the planner still measures the leg');
  assert.match(src, /distanceLabel: 'mi leg'/, 'and labels the column as one');
  assert.ok(!/'leg',/.test(src),
    'and no longer repeats "leg" as a sub-header fact, which the column now says');
  app.window.close();
});

test('grouped sections offer each other as modes of one report', async () => {
  const app = await boot();
  const doc = app.window.document;
  const groups = {};
  for (const sw of doc.querySelectorAll('.modeswitch')) {
    const key = sw.getAttribute('data-modes');
    assert.ok(key, 'every mode switch names its group');
    const pick = sw.querySelector('.modepick');
    // Three shapes, one contract. A switch either NAVIGATES between sections
    // (buttons carrying data-goto, or a select once there are more options
    // than fit across a phone) or toggles a mode WITHIN one panel (buttons
    // with no target, because there is nowhere to go).
    const btns = [...sw.querySelectorAll('.modebtn')];
    const inPanel = !pick && btns.length > 0 && btns.every((b) => !b.getAttribute('data-goto'));
    if (inPanel) {
      assert.ok(btns.length >= 2, `group "${key}" needs at least two modes to be a switch`);
      assert.equal(btns.filter((b) => b.getAttribute('aria-pressed') === 'true').length, 1,
        `group "${key}" must mark exactly one mode as current`);
      // An in-panel switch lives in one section, so there is nothing to
      // cross-check — but it must still be inside a real one.
      assert.ok(sw.closest('section.panel'), `group "${key}" sits in a section`);
      continue;
    }
    const modes = pick
      ? [...pick.options].map((o) => o.value)
      : btns.map((b) => b.getAttribute('data-goto'));
    assert.ok(modes.length >= 2, `group "${key}" needs at least two modes to be a switch`);
    if (pick) {
      assert.ok(pick.getAttribute('aria-label'), 'a select-based switch is labelled for screen readers');
      assert.equal([...pick.options].filter((o) => o.selected).length, 1,
        `group "${key}" must have exactly one option selected`);
    } else {
      const btns = [...sw.querySelectorAll('.modebtn')];
      assert.equal(btns.filter((b) => b.getAttribute('aria-pressed') === 'true').length, 1,
        `group "${key}" must mark exactly one mode as current`);
    }
    for (const m of modes) {
      // A mode is either a section to show, or a section plus an argument.
      const id = m.indexOf('quick:') === 0 ? 'sec-quickBtn' : m;
      assert.ok(doc.getElementById(id), `"${m}" resolves to a real section`);
    }
    (groups[key] = groups[key] || []).push(modes.join('|'));
  }
  assert.ok(Object.keys(groups).length >= 2, 'more than one group exists');
  // Tiles, PLUS the sections deliberately kept off the menu. A mode target
  // must be a real section — but "real section" is not the same as "has a
  // tile". Easy misses and Being reported are two modes of one switch, so the
  // menu carries one tile and the switch is how you reach the other; Trip
  // planner is off pending a redesign. Both are listed in `menuOmittedAts`,
  // which is the SAME allowance tests/parity/test_section_docs.py reads, so
  // there is one place to change and the two repos cannot disagree about it.
  const omitted = new Set(CONTRACT.menuOmittedAts || []);
  const ids = new Set([...CONTRACT.menu.map((m) => m.at), ...omitted].map((at) => 'sec-' + at));
  for (const k of Object.keys(groups)) {
    const modes = groups[k][0].split('|');
    // The switch must appear in every SECTION it offers, or it is a one-way
    // door: you can leave a mode but not come back to it. Several modes can
    // share one section (the quick: anchors all live in sec-quickBtn), so the
    // expected count is distinct sections, not options.
    const sections = new Set(modes.map((m) => (m.indexOf('quick:') === 0 ? 'sec-quickBtn' : m)));
    assert.equal(groups[k].length, sections.size,
      `group "${k}" must carry its switch in all ${sections.size} of its sections`);
    for (const seen of groups[k]) {
      assert.equal(seen, groups[k][0], `group "${k}" offers the same modes in the same order everywhere`);
    }
    for (const s of sections) {
      assert.ok(ids.has(s), `${s} is still a section in its own right, not absorbed`);
    }
  }
  app.window.close();
});

test('choosing "Find a place" opens the search box and searches from there', async () => {
  const app = await boot({
    fetch(url) {
      if (/nominatim/.test(url)) {
        return [{ lat: '47.61', lon: '-122.33', display_name: 'Seattle, King County, Washington' }];
      }
      if (/ref\/hotspot\/geo/.test(url)) {
        return [{ locId: 'L1', locName: 'Discovery Park', lat: 47.66, lng: -122.42,
                  numSpeciesAllTime: 270, latestObsDt: '2026-07-31 08:00' }];
      }
      return [];
    },
    storage: { ebird_home_lat: '47.75', ebird_home_lng: '-122.16' },
  });
  const A = app.window.__app;
  const doc = app.window.document;
  // The modes are CHIPS now, not a <select>: one tap instead of
  // tap-scroll-tap, and every option is readable without opening anything.
  const row = doc.querySelector('#sec-quickBtn .modeswitch');
  assert.ok(row, 'the quick section carries the mode switch');
  const find = row.querySelector('.modebtn[data-goto="quick:find"]');
  assert.ok(find, '"Find a place" is one of the modes');
  assert.match(find.getAttribute('aria-label'), /place/i,
    'the accessible name carries the full wording the chip abbreviates');

  find.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  // A mode you cannot type into is a dead end, which is how the geolocation
  // fallback used to feel when it fired without explanation.
  assert.equal(doc.getElementById('quickHereRow').hidden, false,
    'the place box opens rather than silently doing nothing');

  doc.getElementById('quickHerePlace').value = 'Seattle';
  app.click(doc.getElementById('quickHereFind'));
  await new Promise((r) => setTimeout(r, 260));
  assert.match(doc.getElementById('quickStatus').textContent, /Seattle/,
    'the status names the place you searched, not "your location"');
  app.window.close();
});

test('a searched place is not confused with where you are standing', async () => {
  const app = await boot();
  const A = app.window.__app;
  // Two different anchors, deliberately kept apart: a later tap on Current
  // location must mean the device's position, not the last thing you typed.
  const src = HTML.slice(HTML.indexOf('function resolveHere('),
    HTML.indexOf('function loadQuickOuting('));
  // The two resolvers are now separate functions, so the rule can be stated
  // per resolver instead of over one blob: each writes ITS OWN anchor and
  // never the other's. That is what keeps a later tap on Current location
  // meaning the device's position rather than the last thing you typed.
  const here = HTML.slice(HTML.indexOf('function resolveHere('),
    HTML.indexOf('function resolveFound('));
  const found = HTML.slice(HTML.indexOf('function resolveFound('),
    HTML.indexOf('function quickUseHere('));
  assert.match(found, /quickFound = \{/, 'a searched place lands in its own anchor');
  assert.ok(!/quickHere = \{/.test(found),
    'and never overwrites the device-location anchor');
  assert.match(here, /quickHere = \{/, 'the device location lands in its own anchor');
  assert.ok(!/quickFound = \{/.test(here),
    'and never overwrites the searched place');
  assert.match(src, /loadQuickOuting\('find'\)/, 'then loads as the find origin');
  assert.match(HTML, /QUICK_ORIGINS = \{ home: 1, here: 1, find: 1 \}/,
    'find is a first-class origin, so every "near X" path accepts it');
  app.window.close();
});

test('the mode switch is wired, and does not re-navigate to where you already are', async () => {
  assert.match(HTML, /closest\('\.modeswitch \.modebtn'\)/,
    'one delegated handler serves every pair — adding a pair is markup only');
  assert.match(HTML, /=== 'true' && to\.indexOf\('quick:'\) !== 0\) return;/,
    'tapping the mode you are already in does nothing — EXCEPT a quick-outing '
    + 'origin, where "Here" must be allowed to mean "where I am now"');

  // Proven by clicking. "The handler exists" is not "the control works" — the
  // species picker shipped with buttons bound to nothing and looked fine.
  const app = await boot();
  const doc = app.window.document;
  const A = app.window.__app;
  A.showSection('sec-allUnseenBtn');
  const from = doc.getElementById('sec-allUnseenBtn');
  const btns = [...from.querySelectorAll('.modeswitch .modebtn')];
  assert.ok(btns.length >= 2, 'the switch is built from the shared table');
  // Every chip carries an accessible name, because the visible label is
  // deliberately abbreviated to two words.
  btns.forEach((b) => assert.ok((b.getAttribute('aria-label') || '').length > 6,
    'each chip names itself in full for a screen reader: ' + b.getAttribute('data-goto')));
  const other = btns.filter((b) => b.getAttribute('aria-pressed') !== 'true')[0];
  assert.ok(other, 'the inactive mode is present to tap');
  const target = other.getAttribute('data-goto');
  other.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  assert.ok(!doc.getElementById(target).hidden, 'tapping the other mode shows that section');
  assert.ok(from.hidden, 'and leaves the one you were on');
  app.window.close();
});

// One table drives every switch, so a mode cannot exist in one panel and not
// another. The `places` group is deliberately GONE: destinations, excursions
// and the trip planner rank places by the birds you still need, while the
// quick-outing anchors just list what is near a point you pick. Merging them
// hid two top-level sections inside another section's control.
test('every mode switch is built from ONE table', async () => {
  assert.doesNotMatch(HTML, /<select class="modepick"/,
    'the wheel picker is gone — chips are one tap, a select is three');
  assert.doesNotMatch(HTML, /data-modes="places"/,
    'no panel offers the merged places switch any more');
  const app = await boot();
  const doc = app.window.document;
  const rows = [...doc.querySelectorAll('.modeswitch[data-modes]')];
  assert.ok(rows.length >= 3, 'the sections that really have modes carry a switch');
  const byGroup = {};
  // A chip is keyed by data-goto when it NAVIGATES and by id when it TOGGLES a
  // mode inside its own panel — both are chips, so read whichever it carries.
  // ...and by data-anchor when it RE-RANKS the panel it is already in.
  const keyOf = (b) => b.getAttribute('data-goto')
    || (b.getAttribute('data-anchor') ? 'anchor:' + b.getAttribute('data-anchor') : '')
    || b.id;
  rows.forEach((r) => {
    const g = r.getAttribute('data-modes');
    const gotos = [...r.querySelectorAll('.modebtn')].map(keyOf);
    assert.ok(gotos.length, g + ' switch was actually built');
    assert.ok(gotos.every(Boolean), g + ': every chip is addressable');
    if (byGroup[g]) {
      assert.deepEqual(JSON.stringify(gotos), JSON.stringify(byGroup[g]),
        g + ': every panel in a group offers exactly the same modes');
    } else byGroup[g] = gotos;
    // Exactly one chip is pressed, and it is the panel's own mode.
    const on = [...r.querySelectorAll('.modebtn[aria-pressed="true"]')];
    assert.equal(on.length, 1, g + ': exactly one mode reads as current');
    assert.equal(keyOf(on[0]), r.getAttribute('data-current'),
      g + ': the pressed chip is the one the panel declares current');
  });
  assert.equal(byGroup.quick.length, 3,
    'the quick outing offers exactly its three anchors — near home, here, '
    + 'and a place you name — and no longer smuggles three other SECTIONS in '
    + 'beside them');
  assert.deepEqual(JSON.stringify(byGroup.quick),
    JSON.stringify(['quick:here', 'quick:home', 'quick:find']),
    // HERE first: the panel exists for "I have twenty minutes, where am I",
    // and where you are answers that more often than where you live. Home
    // led only because it shipped first.
    //
    // Home stays the DEFAULT though, and that is not an inconsistency: Here
    // needs a location permission, so opening on it would prompt before the
    // reader has asked for anything. Offered first, chosen second.
    'here, home, find — with home still the default');
  // Build order is load-bearing: the checklist chips are addressed by id and
  // get their handlers bound in the init block, so the switch must be built
  // BEFORE that block runs or those handlers land on elements that are about
  // to be thrown away.
  assert.ok(HTML.indexOf('buildModeSwitches();')
            < HTML.indexOf("$('cklModeBest').addEventListener"),
    'the switch is built before the id-addressed chips get their handlers');
  // And the table itself must be declared above its first call: `var`
  // initialisers do not hoist, so a table defined lower would read as
  // undefined and quietly build nothing at all.
  assert.ok(HTML.indexOf('var MODE_SETS = {') < HTML.indexOf('buildModeSwitches();'),
    'and the table is assigned before it is read');
  assert.equal((HTML.match(/var MODE_SETS = \{/g) || []).length, 1,
    'there is exactly ONE table — two would be the drift it exists to stop');
  app.window.close();
});

// The section was listing places 111 mi away beside one 8 mi from the house,
// in a report whose whole job is "where can I go and see this".
test('All unseen reports respects the chase radius, and sorts far places apart', async () => {
  const app = await boot();
  const A = app.window.__app;
  const R = A.chaseMaxMi();
  assert.ok(R > 0, 'there is a shared chase radius');
  const fn = HTML.slice(HTML.indexOf('function loadAllUnseen('),
    HTML.indexOf('function unseenPlacesHtml('));
  assert.match(fn, /p\.distMi > chaseMaxMi\(\)/,
    'places are partitioned by the SAME radius the rarity section uses — and '
    + 'by CALLING it, because the radius is a setting now and a var read at '
    + 'load time would keep filtering by whatever it was when the app booted');
  // The far places are no longer given a per-card expander. Every card carried
  // one, so a single section repeated "there is more, further away" dozens of
  // times — a second fold under the one that already folds the extra places.
  // The STATUS LINE is what has to carry it now, so it is asserted here rather
  // than merely dropped: a partition nobody is told about is just missing data.
  assert.doesNotMatch(fn, /upfar/,
    'no per-card "beyond N mi" expander — one per species was the noise');
  assert.match(fn, /more species only further out/,
    'the status line says how many species are ONLY further out, so the '
    + 'partition is still visible without repeating it on every card');
  assert.match(fn, /within ' \+ chaseMaxMi\(\) \+ ' mi/,
    'the status line states the radius rather than implying the list is everything');
  app.window.close();
});

// "Also, Id like the option to choose the chase radius."
test('the chase radius is a setting, and every list obeys the live value', async () => {
  const app = await boot();
  const A = app.window.__app, doc = app.window.document;

  assert.equal(A.chaseMaxMi(), A.CHASE_DEFAULT_MI,
    'unset, it is the radius shared with report.CHASE_MAX_MI');
  const sel = doc.getElementById('chaseMi');
  assert.ok(sel, 'Settings offers a control');
  assert.equal(sel.value, String(A.CHASE_DEFAULT_MI),
    'showing the value actually in force, not a hardcoded first option');

  app.window.localStorage.setItem(A.chaseMiKey(), '75');
  assert.equal(A.chaseMaxMi(), 75, 'a stored radius wins');
  A.syncChaseMi();
  assert.equal(sel.value, '75', 'and the control reflects it');

  // The mechanism, not a slogan. eBird caps `dist` on its around-me feeds at
  // 50 km, so past ~31 mi the extra reach is county coverage — which is not a
  // circle. A control that implied otherwise would be lying about the data.
  const hint = doc.getElementById('chaseMiHint');
  assert.match(hint.textContent, /31 mi/,
    'past the geo-feed cap the hint says where the extra range comes from');
  assert.match(hint.textContent, /counties/, 'and names the mechanism');
  assert.match(hint.textContent, new RegExp(A.CHASE_DEFAULT_MI + ' mi'),
    'and warns that the Markdown report still uses its own radius');

  // A value with no matching <option> must not blank the control.
  app.window.localStorage.setItem(A.chaseMiKey(), '42');
  A.syncChaseMi();
  assert.equal(sel.value, '42', 'an unlisted radius is added rather than lost');

  // THE TRAP: the radius only filters, so nothing is re-fetched — but a list
  // already on screen was built against the old number and its own status line
  // still claims it. Changing the setting has to clear those lists, or the
  // section reads "within 30 mi" over rows chosen by a different rule.
  const src = HTML.slice(HTML.indexOf("$('chaseMi').addEventListener"),
    HTML.indexOf("$('chaseMi').addEventListener") + 700);
  assert.match(src, /_autoLoaded = \{\}/, 'the loaded-section marks are cleared');
  assert.match(src, /RESET_ON_REPORT_CHANGE/,
    'and the rendered lists with them, so no list outlives the radius it was '
    + 'built for');
  assert.ok(!/clearChaseCache/.test(src),
    'but the fetched rows are KEPT — the radius filters what was fetched, it '
    + 'never changes what to fetch, so re-fetching would spend the rate limit '
    + 'for nothing');
  app.window.close();
});


// Both sections that hit the same eBird feed cap now say so the same way:
// behind the ℹ button, not as a yellow block above the results.
test('the feed-cap caveat lives behind the ℹ button, in every section that has one', async () => {
  assert.ok(!/class="status feedwarn"/.test(HTML),
    'no section renders the caveat as a banner above its list any more');
  for (const [name, from, to] of [
    ['Birdiest checklists', 'function loadBirdiest(', 'function markBirdiestUnseen('],
    ['Birder convoys', 'function renderConvoys(', 'function convoyLocName('],
  ]) {
    const i = HTML.indexOf(from);
    assert.ok(i > -1, name + ': ' + from + ' must exist');
    const j = HTML.indexOf(to, i);
    const src = HTML.slice(i, j > i ? j : i + 4000);
    assert.match(src, /setSectionNote\(/, name + ' attaches the caveat as a section note');
    assert.match(src, /sectionNoteHtml\(/, name + ' formats it through the shared helper');
    assert.ok(!/feedwarn/.test(src), name + ' no longer builds a banner');
  }

  // Proven by driving it, not just by reading: the note reaches the box and
  // marks the button, and clearing it removes both.
  const app = await boot();
  const doc = app.window.document;
  const A = app.window.__app;
  const sec = doc.getElementById('sec-convoyBtn');
  assert.ok(sec, 'the convoys section exists');
  const btn = sec.querySelector('.docbtn'), box = sec.querySelector('.sectiondoc');
  assert.ok(btn && box, 'it has an ℹ button and a doc box');
  A.setSectionNote(sec, A.sectionNoteHtml('Showing 3 days, not 7.'));
  assert.ok(btn.classList.contains('hasnote'), 'the ℹ button marks itself');
  assert.match(box.getAttribute('data-note') || '', /Showing 3 days/, 'and holds the note');
  A.setSectionNote(sec, '');
  assert.ok(!btn.classList.contains('hasnote'), 'and unmarks when the caveat no longer applies');
  app.window.close();
});

// Reported from the device: on some favourites the ▲▼✕ column dropped below
// the card. Flexbox wraps a line BEFORE it shrinks an item below its
// min-content width, so as soon as the card could not get narrower the
// controls — the one thing in the row you have to be able to hit — went with
// it. There is no second line to escape to now.
test('the favourites controls never wrap below the card', async () => {
  const app = await boot();
  const css = [...app.window.document.querySelectorAll('style')]
    .map((s) => s.textContent).join('\n');
  const favrow = /\.favrow \{([^}]*)\}/.exec(css);
  assert.ok(favrow, '.favrow is defined');
  assert.match(favrow[1], /flex-wrap:\s*nowrap/,
    'the row does not wrap, so the controls cannot leave it');
  const favmain = /\.favrow \.favmain \{([^}]*)\}/.exec(css);
  assert.ok(favmain, '.favrow .favmain is defined');
  assert.match(favmain[1], /flex:\s*1 1 0/,
    'the main column starts from zero rather than from its content width');
  assert.match(favmain[1], /min-width:\s*0/,
    'and may shrink below min-content, which is what nowrap requires of it');
  // The actions row inside the card is what set that floor.
  assert.match(app.window.HotspotCards.css, /\.hsact \{[^}]*min-width: 0/,
    'the card actions row can shrink too, or it becomes the floor again');
  app.window.close();
});
// bundled seed is 60px wide and `photoSlot` deliberately stops there rather
// than paying for a network rendition — so at the medium card's 92px it is
// upscaled 1.5x. Last 7-Days looked crisp in the SAME 92px card because its
// birds are rare: most have no bundled seed, miss tier 1, and fall through to
// a full-size network photo. The seed size is the real constraint, so the card
// that shows seeds is sized to it.
test('the unseen list sizes its icon to the seed it actually shows', async () => {
  const app = await boot();
  const doc = app.window.document;
  const ul = doc.getElementById('allUnseenResults');
  assert.ok(ul.className.split(/\s+/).includes('icon-sm'),
    'the unseen list opts into the small icon');
  for (const cls of ['obs', 'big', 'xl']) {
    assert.ok(ul.className.split(/\s+/).includes(cls), 'still the medium card wrapper: ' + cls);
  }
  const css = app.window.SpeciesCards.css;
  assert.match(css, /\.obs\.xl\.icon-sm > li > \.name > \.thumb \{\s*width: calc\(46px \* var\(--s\)\)/,
    'and that resolves to 46px — the width the seed was cut for');
  assert.match(css, /\.obs\.xl > li > \.name > \.thumb \{ width: calc\(70px \* var\(--s\)\)/,
    'while sections showing a network photo keep the larger box');
  app.window.close();
});

// That is exactly how the unseen list ended up with 20px names in a 29px card.
test('every medium-card list carries the medium wrapper, not a lookalike', () => {
  const wrapper = (CARDS_SPECIES.match(/medium: *'([^']+)'/)
               || CARDS_SPECIES.match(/medium: *"([^"]+)"/) || [])[1];
  assert.ok(wrapper, 'cards-species.js still names the medium wrapper class');
  // "todays rarity should be using medium species card, and so should last
  // 7-days rarity report" — so both are pinned here beside the unseen list
  // rather than trusted. A list that calls SpeciesCards.medium but wears
  // another wrapper renders the medium template at a different size, which is
  // exactly how the unseen list ended up with 20px names in a 29px card.
  const lists = ['allUnseenResults', 'results', 'activeResults', 'lastNewResults'];
  for (const id of lists) {
    const m = HTML.match(new RegExp('<ul id="' + id + '"[^>]*class="([^"]*)"'))
          || HTML.match(new RegExp('<ul[^>]*class="([^"]*)"[^>]*id="' + id + '"'));
    assert.ok(m, 'the ' + id + ' list still exists');
    for (const cls of wrapper.split(/\s+/)) {
      assert.ok(m[1].split(/\s+/).includes(cls),
        id + ' must carry "' + cls + '" — the medium card\'s own wrapper — '
        + 'or it renders at another size than the template it uses');
    }
  }
});

test('the fixed anchor is home alone, and anchors never widen coverage', async () => {
  const app = await boot();
  const A = app.window.__app;
  // F1 step 1 retired the stored workplace. It ranked well -- 59 of 138 live WA
  // locations were closer to the office than to home -- but it was a GUESS about
  // where you would be, hand-kept in sync with a geocode, and it could not serve
  // a friend's house, a new lunch spot, or being away on a trip. The transient
  // here/find anchors replaced it and are not guesses.
  const anchors = A.getAnchors();
  assert.equal(anchors.length, 1, 'exactly one fixed anchor');
  assert.equal(anchors[0].name, 'home', 'and it is home');
  assert.equal(typeof A.workKey, 'undefined', 'the work storage key is gone');
  assert.equal(typeof A.getWork, 'undefined', 'and so is its accessor');
  // The anchors must not reach the feed planner: an anchor-centred circle would
  // change WHICH birds the app knows about, and the report would then be
  // answering a different question than the app.
  const planner = HTML.slice(HTML.indexOf('BL.planFeeds('), HTML.indexOf('BL.planFeeds(') + 200);
  assert.ok(!/anchor/i.test(planner),
    'planFeeds must not take an anchor -- anchors rank, they never gather');
  app.window.close();
});

/*
 * Accessibility: one control scales the whole app.
 *
 * "Many birders are older and have bad vision." The scale is a CSS custom
 * property rather than CSS zoom on purpose -- zoom silently breaks Leaflet's
 * container-size and hit-testing math, so maps would misplace pins at any
 * setting but 1.
 */
test('every px font size in the stylesheet is multiplied by the --s scale', () => {
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  const raw = arr(css.matchAll(/font-size:\s*\d+(?:\.\d+)?px/g), (m) => m[0]);
  assert.deepEqual(raw, [],
    'these font sizes ignore the accessibility scale: ' + raw.join(', '));
  assert.ok(/font-size: calc\(\d+(?:\.\d+)?px \* var\(--s\)\)/.test(css),
    'font sizes go through calc(Npx * var(--s))');
  assert.ok(/--s:\s*1;/.test(css), ':root declares the default scale');
  // Pictures have to grow with the text beside them, or a "Largest" list is
  // big type wrapped around a postage stamp.
  assert.ok(/\.thumb \{[^}]*width: calc\(46px \* var\(--s\)\)/.test(css),
    'the list thumbnail scales too');
});

test('the text-size control persists and drives the document scale', async () => {
  const app = await boot();
  const html = app.document.documentElement;
  assert.equal(app.window.__app.getUiScale(), 1, 'defaults to normal');

  const sel = app.$('uiScale');
  assert.ok(sel, 'Settings has a text-size control');
  assert.equal(sel.value, '1', 'the control shows the stored value');

  sel.value = '1.5';
  sel.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(html.style.getPropertyValue('--s'), '1.5', 'changing it applies immediately');
  assert.equal(app.window.localStorage.getItem('ebird_ui_scale'), '1.5', 'and is persisted');

  // Out-of-range values are clamped, not trusted: a corrupt entry that renders
  // the app at 40x is unrecoverable without clearing storage on the device.
  assert.equal(app.window.__app.setUiScale('99'), 2, 'clamped to the maximum');
  assert.equal(app.window.__app.setUiScale('nonsense'), 1, 'garbage falls back to normal');
});

test('a stored text size is applied before anything renders', async () => {
  const app = await boot({ storage: { ebird_ui_scale: '1.3' } });
  assert.equal(app.document.documentElement.style.getPropertyValue('--s'), '1.3',
    'the scale is live on boot, not only after opening Settings');
  assert.equal(app.$('uiScale').value, '1.3', 'and Settings reflects it');
});
/*
 * Quick outing anchors.
 *
 * The section is an impulse detour, so the anchor is the whole answer: hotspots
 * near home on a Saturday are the wrong list on a Tuesday lunch break. Home
 * stays the default so the first open still matches the Markdown report.
 */
test('quick outing offers home and current location, defaulting to home', async () => {
  const app = await boot();
  const ids = ['quickBtn', 'quickHereBtn'];
  ids.forEach((id) => assert.ok(app.$(id), id + ' exists'));
  assert.equal(app.$('quickBtn').getAttribute('aria-pressed'), 'true', 'home is the default anchor');
  assert.equal(app.$('quickHereBtn').getAttribute('aria-pressed'), 'false');
  assert.match(app.$('quickBtn').textContent, /Home/);
  assert.ok(app.$('quickHereRow').hidden, 'the type-a-place fallback stays out of the way');
  // F1 step 1 retired the stored work anchor: a saved workplace is a guess
  // about where you will be, and "current location" is not.
  assert.equal(app.$('quickWorkBtn'), null, 'the work anchor button is gone');
});

test('an anchor with no coordinate yet asks for one instead of dying on tap', async () => {
  const app = await boot();
  const w = app.window;
  // "here" and "find" are the anchors that can legitimately be unset — home
  // always falls back to the region coordinate so distances match the report
  // before anything is configured.
  assert.equal(w.__app.quickAnchor('here'), null,
    'no current location until one is resolved');
  assert.equal(w.__app.quickAnchor('find'), null,
    'and no searched place until one is searched');

  // Tapping "find" with nothing set must open the search box rather than fail.
  const before = app.state.fetches.length;
  w.__app.loadQuickOuting('find');
  assert.equal(app.state.fetches.length, before,
    'it taps no feed it cannot centre');
  assert.ok(!app.$('quickHereRow').hidden,
    'it opens the place search instead — a dead button teaches nothing');
});

// getDeviceLocation() is promise-based, so the UI it drives settles a microtask
// or two after the tap rather than inside the click handler.
const settle = () => new Promise((r) => setTimeout(r, 0));

test('current location falls back to a typed place when geolocation is refused', async () => {
  const app = await boot();
  const w = app.window;
  let asked = 0;
  w.navigator.geolocation = {
    getCurrentPosition(ok, fail) { asked++; fail({ code: 1, message: 'User denied Geolocation' }); },
  };
  app.click(app.$('quickHereBtn'));
  await settle();
  assert.equal(asked, 1, 'it asks the device first');
  assert.equal(app.$('quickHereRow').hidden, false, 'refusal reveals the place input');
  // "User denied Geolocation" is the browser's words, and they leave you with
  // nowhere to go. A refusal is the one failure the user can actually undo, so
  // the message names the switch instead of quoting the error.
  assert.match(app.$('quickStatus').textContent, /Location Services/,
    'a refusal says where to turn it back on');
  assert.match(app.$('quickStatus').textContent, /Type where you are/,
    'and still offers the fallback that needs no permission at all');

  // Anything that is NOT a refusal is quoted, because there is nothing to tap.
  w.navigator.geolocation.getCurrentPosition = (ok, fail) => fail({ code: 2, message: 'kCLErrorDomain 0' });
  app.click(app.$('quickHereBtn'));
  await settle();
  assert.match(app.$('quickStatus').textContent, /kCLErrorDomain 0/,
    'a real failure says WHY, so "nothing happened" is never the outcome');

  // A granted fix re-anchors the section and scans around the new point.
  w.navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: 48.5, longitude: -122.6 } });
  const before = app.state.fetches.length;
  app.click(app.$('quickHereBtn'));
  await settle();
  const scan = app.state.fetches.slice(before).find((u) => /ref\/hotspot\/geo/.test(u));
  assert.ok(scan, 'a granted fix triggers a hotspot scan');
  assert.match(scan, /lat=48\.5&lng=-122\.6/, 'centred on where you actually are');
  assert.equal(app.$('quickHereBtn').getAttribute('aria-pressed'), 'true', 'and Here becomes the active anchor');
  w.close();
});

test('current location asks the NATIVE plugin first, not the web API', async () => {
  // The reported bug. Capacitor serves the app from capacitor://localhost, and
  // WebKit only honours navigator.geolocation on origins it deems secure, so on
  // device the web API is present (every `if (!navigator.geolocation)` guard
  // passes) and then calls NEITHER callback — no prompt, no error, no result.
  // Preferring the native plugin is the whole fix, so it is pinned at runtime.
  const app = await boot();
  const w = app.window;
  let plugin = 0, web = 0;
  w.Capacitor = Object.assign({}, w.Capacitor, {
    Plugins: Object.assign({}, w.Capacitor && w.Capacitor.Plugins, {
      Geolocation: {
        getCurrentPosition() {
          plugin++;
          return Promise.resolve({ coords: { latitude: 47.1, longitude: -123.2 } });
        },
      },
    }),
  });
  w.navigator.geolocation = { getCurrentPosition() { web++; } };

  const before = app.state.fetches.length;
  app.click(app.$('quickHereBtn'));
  await settle();
  assert.equal(plugin, 1, 'the native CoreLocation bridge is asked');
  assert.equal(web, 0, 'the web API is the fallback, never the first choice');
  const scan = app.state.fetches.slice(before).find((u) => /ref\/hotspot\/geo/.test(u));
  assert.ok(scan && /lat=47\.1&lng=-123\.2/.test(scan), 'and its fix anchors the scan');

  // The dependency has to be declared or the plugin never registers on device.
  assert.ok(PKG.dependencies && PKG.dependencies['@capacitor/geolocation'],
    '@capacitor/geolocation must be a runtime dependency — without it ' +
    'Capacitor.Plugins.Geolocation is undefined on device and this silently ' +
    'falls back to the web API that does not work there');
  w.close();
});

test('a location request that never answers still lands somewhere usable', async () => {
  // This is the symptom the user actually saw: the status line stuck on
  // "Asking for your location…" forever. A PositionOptions `timeout` is enforced
  // BY the implementation, so it cannot fire when the implementation is the
  // thing that has gone quiet — the watchdog has to be ours.
  const app = await boot();
  const w = app.window;
  const realTimeout = w.setTimeout;
  // Fire only the long watchdog immediately; leave short timers alone so the
  // rest of the app keeps its ordering.
  w.setTimeout = function (fn, ms) {
    if (typeof ms === 'number' && ms >= 5000) { return realTimeout(fn, 0); }
    return realTimeout.apply(this, arguments);
  };
  w.Capacitor = Object.assign({}, w.Capacitor, {
    Plugins: Object.assign({}, w.Capacitor && w.Capacitor.Plugins, {
      Geolocation: { getCurrentPosition() { return new Promise(() => {}); } },
    }),
  });
  app.click(app.$('quickHereBtn'));
  await settle();
  await settle();
  w.setTimeout = realTimeout;

  assert.equal(app.$('quickHereRow').hidden, false,
    'silence must reveal the typed-place fallback, not hang');
  assert.match(app.$('quickStatus').textContent, /timed out/i, 'and say the request timed out');
  assert.doesNotMatch(app.$('quickStatus').textContent, /Asking for your location/,
    'the status line must not be left mid-sentence');
  w.close();
});

test('the iOS build declares the location permission it cannot commit', () => {
  // ios/ is gitignored and regenerated by `npx cap add ios` every build, so
  // Info.plist cannot carry this key in the repo. Without it CoreLocation
  // refuses the request WITHOUT ever prompting — the app looks broken and no
  // dialog appears, which is exactly the bug that was reported.
  assert.match(IOS_WF, /NSLocationWhenInUseUsageDescription/,
    'the workflow must inject the usage description into the generated Info.plist');
  const sync = IOS_WF.indexOf('npx cap sync ios');
  const inject = IOS_WF.indexOf('NSLocationWhenInUseUsageDescription');
  assert.ok(sync !== -1 && inject > sync,
    'inject AFTER `cap sync` so nothing downstream can drop the key');
  assert.match(IOS_WF, /PlistBuddy[\s\S]{0,600}test -n/,
    'and verify it stuck — a silent no-op here reproduces the exact bug');
  // The string is shown verbatim in the iOS permission dialog, so it has to
  // explain the trade the user is being asked to make.
  const msg = /MSG='([^']+)'/.exec(IOS_WF);
  assert.ok(msg, 'the usage description must be a real sentence, not a placeholder');
  assert.ok(/hotspot/i.test(msg[1]) && msg[1].length > 40,
    'it must say what the location is FOR: ' + (msg && msg[1]));
});

test('the debug panel says which location path the device will take', () => {
  // "It does not prompt" is invisible from the outside; this is how the next
  // report of it gets diagnosed without a Mac.
  const src = HTML.slice(HTML.indexOf('function dbgContext('), HTML.indexOf('function dbgRender('));
  assert.match(src, /Geolocation: /, 'the debug dump reports the geolocation path');
  assert.match(src, /native plugin/, 'it distinguishes the native bridge');
  assert.match(src, /will NOT prompt/,
    'and calls out the web-API-only case, which is the broken one on device');
});


test('quick outing scans exactly one circle — the anchor you picked', async () => {
  const app = await boot();
  const before = app.state.fetches.length;
  app.click(app.$('quickBtn'));
  // The foreground lane takes a token before it fetches, so the request leaves
  // a tick after the tap rather than during it.
  await new Promise((r) => setTimeout(r, 30));
  const scans = app.state.fetches.slice(before).filter((u) => /ref\/hotspot\/geo/.test(u));
  assert.equal(scans.length, 1, 'one origin means one scan, not a union nobody reads');
  assert.match(scans[0], /lat=47\.75&lng=-122\.16/, 'centred on home');
});
/*
 * "How is this calculated?"
 *
 * Sections that look thin or surprising are usually correct and just opaque.
 * The explanation is DATA, bundled with the app and vendored into the report
 * repo, so the two can never give different answers.
 */
const DOCS = JSON.parse(
  fs.readFileSync(path.join(WWW, 'section-docs.json'), 'utf8')).docs;

test('every section in the contract is documented', () => {
  const missing = CONTRACT.menu.map((m) => m.at).filter((at) => !DOCS[at]);
  assert.deepEqual(missing, [], 'undocumented sections: ' + missing.join(', '));
  // A doc may also describe a section the APP omits, because the REPORT still
  // emits it — Trip planner is switched off behind a feature flag, but the
  // Markdown still carries the section and still needs its explanation, and
  // this file is vendored into the report repo for exactly that. Deleting the
  // doc to satisfy the app would strip the explanation from the report.
  //
  // The list lives in the CONTRACT, not here: a literal 'tripBtn' in a test is
  // a second place to remember, and it would keep passing after the flag was
  // turned back on.
  const omittedAts = new Set(CONTRACT.menuOmittedAts || []);
  const stray = Object.keys(DOCS).filter(
    (at) => !CONTRACT.menu.some((m) => m.at === at) && !omittedAts.has(at));
  assert.deepEqual(stray, [], 'docs for sections that do not exist: ' + stray.join(', '));
  Object.entries(DOCS).forEach(([at, d]) => {
    assert.ok(d.summary && d.summary.length > 20, at + ' has a real summary');
    assert.ok(Array.isArray(d.how) && d.how.length, at + ' says how it is calculated');
    assert.ok(Array.isArray(d.limits), at + ' declares its limits (may be empty)');
  });
});

test('the closest-spots doc names the gates that make it look sparse', () => {
  const d = DOCS.targetsBtn;
  const all = [d.summary].concat(d.inputs, d.how, d.limits).join(' ');
  // These four are exactly the questions the section provokes and cannot answer
  // from its own output.
  assert.match(all, /250 m/, 'the clustering radius');
  assert.match(all, /Measure each cluster from home/,
    'ranking is from home, the one fixed anchor');
  assert.match(all, /private/i, 'why a residential address can legitimately appear');
  assert.match(all, /ONE observation per species|one observation per species/,
    'the feed limit that makes the section sparse by construction');
});

test('every section carries an info button that opens its calculation notes', async () => {
  const app = await boot();
  const secs = [...app.document.querySelectorAll('main section')]
    .filter((s) => s.querySelector('h2') && s.id && s.id !== 'menuPanel');
  assert.ok(secs.length >= 15, 'found the report sections (got ' + secs.length + ')');
  secs.forEach((s) => {
    const b = s.querySelector('.docbtn');
    assert.ok(b, s.id + ' has an info button');
    assert.equal(b.getAttribute('aria-expanded'), 'false', s.id + ' starts collapsed');
    assert.match(b.getAttribute('aria-label') || '', /is calculated/,
      s.id + ' names what the button explains');
  });

  const sec = app.document.getElementById('sec-targetsBtn');
  const box = sec.querySelector('.sectiondoc');
  assert.ok(box.hidden, 'notes start hidden');
  app.click(sec.querySelector('.docbtn'));
  assert.equal(box.hidden, false, 'tapping opens them');
  assert.equal(sec.querySelector('.docbtn').getAttribute('aria-expanded'), 'true');
  await new Promise((r) => setTimeout(r, 30));
  assert.match(box.textContent, /250 m/, 'and they are the real notes, read from the bundle');
  // Bundled, not fetched over the network — the app has no runtime GitHub
  // dependency and help has to work on a phone with no signal.
  assert.ok(!app.state.fetches.some((u) => /section-docs\.json/.test(u) && /^https?:\/\/(?!localhost)/.test(u)),
    'the notes are read from the app bundle, never from a remote host');
});
/*
 * Easy misses widens its bar rather than shrinking to nothing.
 *
 * The section was reported as "only two entries". It was right: the 40% bar is
 * absolute, and by mid-year the genuinely common birds are already on your year
 * list. An honest section that nobody can use is still a section nobody can use.
 */
test('easy misses lowers its threshold until the section is worth reading', async () => {
  const app = await boot();
  const compute = app.window.__app.computeEasyMisses;
  const days = 20;
  // 12 species, each on a different number of the 20 sampled days: one at 90%,
  // the rest between 10% and 45%. At a fixed 40% bar this yields 2 rows.
  const obs = [];
  const freqs = [18, 9, 8, 7, 6, 5, 5, 4, 4, 3, 3, 2];
  freqs.forEach((n, s) => {
    for (let d = 0; d < n; d++) {
      obs.push({
        speciesCode: 'sp' + s, comName: 'Species ' + s,
        obsDt: '2026-06-' + String(d + 1).padStart(2, '0') + ' 08:00',
        locId: 'L' + (d % 3), locName: 'Spot ' + (d % 3), lat: 47.7, lng: -122.2, subId: 'S' + s + d,
      });
    }
  });
  const rows = compute(obs, days, {});
  assert.ok(rows.length >= 10,
    'the bar drops until at least ten birds qualify (got ' + rows.length + ')');
  assert.ok(rows.minFreq < 0.4, 'and the section says it lowered the bar');
  assert.ok(rows.every((r) => r.freq >= rows.minFreq),
    'every row really clears the bar that was reported');
  // Still ranked by location-days, not by the relaxed frequency: a bird
  // reported from eight places is one you can go and get.
  const sd = arr(rows, (r) => r.siteDays);
  assert.deepEqual(sd, Array.from(sd).sort((a, b) => b - a), 'prevalence order survives');

  // A region where plenty clears 40% must NOT be relaxed.
  const rich = [];
  for (let s = 0; s < 15; s++) {
    for (let d = 0; d < 19; d++) {
      rich.push({
        speciesCode: 'r' + s, comName: 'Rich ' + s,
        obsDt: '2026-06-' + String(d + 1).padStart(2, '0') + ' 08:00',
        locId: 'L' + (d % 4), locName: 'Spot', lat: 47.7, lng: -122.2, subId: 'S' + s + d,
      });
    }
  }
  assert.equal(compute(rich, days, {}).minFreq, 0.4,
    'the bar only moves when it has to');
});
// --- v1.0.23: Needs verification, map provider, Happening-now legibility -----

// The watchlist is the one list that changes what "seen" MEANS, so "never
// edited" and "deliberately emptied" must be distinguishable: localStorage
// returning null falls back to the bundled seed, but a stored [] stays empty.
test('the watchlist tells "never edited" apart from "emptied"', async () => {
  const fresh = await boot();
  const seeded = arr(fresh.window.__app.getWatchlist(), (e) => e.code);
  const authored = arr(fresh.window.__SEED_BIRDLIST__.watchlist, (e) => e.code);
  assert.ok(seeded.length > 0, 'a fresh install starts from the authored list');
  // Named species make this guard fail the day one is verified and removed,
  // which says nothing about the code. The invariant is that an unedited
  // install shows EXACTLY birdlist-needsverification.md, whatever is on it.
  assert.deepEqual(seeded, authored,
    'the bundled seed carries birdlist-needsverification.md');
  fresh.window.close();

  const emptied = await boot({ storage: { ebird_watchlist_v1: '[]' } });
  assert.deepEqual(arr(emptied.window.__app.getWatchlist()), [],
    'an emptied list must not snap back to the seed');
  emptied.window.close();

  // Corrupt storage is not an instruction to erase the list.
  const junk = await boot({ storage: { ebird_watchlist_v1: 'not json' } });
  assert.ok(arr(junk.window.__app.getWatchlist()).length > 0,
    'unparseable storage falls back to the seed rather than emptying');
  junk.window.close();
});

// analyze.py computes seen = birdlist − watchlist, and the bundled seed
// already has the AUTHORED list subtracted. Device edits are a delta on top,
// and the delta has to be right in BOTH directions.
test('editing the watchlist moves species in and out of the seen set', async () => {
  const app = await boot();
  const A = app.window.__app;
  const held = app.window.__SEED_BIRDLIST__.seenByReport.wa.watchHeld;
  // Two codes THIS report actually held back, read from the seed rather than
  // named here: the authored list is user data and a verified bird leaves it.
  assert.ok(held.length >= 2, 'fixture assumption: WA really holds watchlist codes back');
  const tracked = held[0], other = held[1];

  assert.equal(A.getReportSeen()[tracked], undefined,
    'a tracked species is deliberately NOT seen — that is what makes it resurface');

  A.setWatchlist([]);
  assert.equal(A.getReportSeen()[tracked], 1,
    'dropping it restores the tick the report was holding back');

  A.setWatchlist([{ code: tracked, name: 'Tracked Bird' }]);
  assert.equal(A.getReportSeen()[tracked], undefined, 'and re-tracking holds it off again');

  // The guard that matters: a bird you never recorded must not become a tick
  // just because you stopped tracking it. Only codes this report ACTUALLY held
  // back are eligible to come back.
  A.setWatchlist([]);
  app.window.__SEED_BIRDLIST__.seenByReport.wa.watchHeld = [tracked];
  const seen = A.getReportSeen();
  assert.equal(seen[tracked], 1, 'a species this report held back returns when untracked');
  assert.equal(seen[other], undefined,
    'a species it never held back must NOT be invented as a year tick');

  A.setWatchlist([{ code: 'zzznope', name: 'Imaginary Bird' }]);
  assert.equal(A.getReportSeen().zzznope, undefined, 'tracking an unrecorded bird changes nothing');
  A.setWatchlist([]);
  assert.equal(A.getReportSeen().zzznope, undefined,
    'and un-tracking it must not invent a year tick either');
  app.window.close();
});

test('the watchlist is reorderable, de-duplicated, and exportable', async () => {
  const app = await boot({ storage: { ebird_watchlist_v1: '[]' } });
  const A = app.window.__app;
  assert.equal(A.addWatch('aaa', 'Alpha Bird'), true);
  assert.equal(A.addWatch('bbb', 'Beta Bird'), true);
  assert.equal(A.addWatch('aaa', 'Alpha Bird'), false, 'the same species cannot be tracked twice');

  A.moveWatch(1, -1);
  assert.deepEqual(arr(A.getWatchlist(), (e) => e.code), ['bbb', 'aaa'],
    'the order is the user\'s own, so it is stored rather than derived');
  A.moveWatch(0, -1);
  assert.deepEqual(arr(A.getWatchlist(), (e) => e.code), ['bbb', 'aaa'],
    'moving the first row up is a no-op, not a wrap-around');

  // The whole point of the export: analyze.py parses "N. Common Name" back.
  const md = A.watchlistMarkdown();
  assert.match(md, /^1\. Beta Bird$/m);
  assert.match(md, /^2\. Alpha Bird$/m);

  A.removeWatchAt(0);
  assert.deepEqual(arr(A.getWatchlist(), (e) => e.code), ['aaa']);
  app.window.close();
});

test('the Needs-verification section renders the tracked list with controls', async () => {
  const app = await boot({
    storage: { ebird_watchlist_v1: JSON.stringify([
      { code: 'aaa', name: 'Alpha Bird' },
      { code: 'bbb', name: 'Beta Bird' },
      { code: '', name: 'Unresolvable Bird' },
    ]) },
  });
  app.open(/Needs verification/);
  const rows = [...app.$('nvResults').querySelectorAll('li')];
  assert.equal(rows.length, 3, 'every tracked species gets a row, resolved or not');
  // A name that resolves to no eBird code still ships, because silently
  // dropping it hides a typo in the authored file forever.
  assert.match(rows[2].textContent, /Not resolved to an eBird species code/);
  assert.equal(app.$('nvResults').querySelectorAll('.nvup').length, 3);
  assert.equal(app.$('nvResults').querySelectorAll('.nvdown').length, 3);
  assert.equal(app.$('nvResults').querySelectorAll('.nvdel').length, 3);
  assert.equal(rows[0].querySelector('.nvup').disabled, true, 'the first row cannot move up');
  assert.equal(rows[2].querySelector('.nvdown').disabled, true, 'the last row cannot move down');

  app.click(rows[0].querySelector('.nvdown'));
  assert.deepEqual(arr(app.window.__app.getWatchlist(), (e) => e.code), ['bbb', 'aaa', ''],
    'the reorder button really reorders the stored list');
  app.click([...app.$('nvResults').querySelectorAll('.nvdel')][0]);
  assert.deepEqual(arr(app.window.__app.getWatchlist(), (e) => e.code), ['aaa', ''],
    'and delete really deletes');
  app.window.close();
});

// Word-prefix, the same rule the hotspot picker uses: typing "black th" has to
// find "Black-throated Gray Warbler" without matching every name that happens
// to contain those letters mid-word.
test('species search matches on word prefixes, not substrings', async () => {
  const app = await boot();
  const rows = [
    { code: 'btywar', name: 'Black-throated Gray Warbler' },
    { code: 'bkbwar', name: 'Blackburnian Warbler' },
    { code: 'amerob', name: 'American Robin' },
    { code: 'rethaw', name: 'Red-tailed Hawk' },
  ];
  const S = app.window.__app.searchSpecies;
  assert.deepEqual(arr(S(rows, 'black th'), (r) => r.code), ['btywar'],
    'hyphens are word breaks, and both terms must hit a word start');
  assert.deepEqual(arr(S(rows, 'warbler'), (r) => r.code).sort(), ['bkbwar', 'btywar']);
  assert.deepEqual(arr(S(rows, 'obin')), [], 'a mid-word substring is not a match');
  assert.deepEqual(arr(S(rows, 'r')), [], 'one letter is too broad to be useful');
  app.window.close();
});

// A search result list with no way out is a dead end on a phone: the results
// replace the section you came to read, and there is no browser chrome.
test('both pick-lists can be dismissed once they have results', async () => {
  const app = await boot({ storage: { ebird_watchlist_v1: '[]' } });
  [['favSearch', 'favFound', 'favSearchClear'],
   ['nvSearch', 'nvFound', 'nvSearchClear']].forEach(([inputId, listId, btnId]) => {
    const input = app.$(inputId), list = app.$(listId), btn = app.$(btnId);
    assert.ok(input && list && btn, inputId + ' needs an input, a result list and a way out');
    assert.equal(btn.hidden, true, 'nothing to dismiss before a search runs: ' + btnId);
    // Simulate a result landing, then take the only exit the user has.
    input.value = 'heron';
    list.innerHTML = '<li>a result</li>';
    app.click(btn);
    assert.equal(list.children.length, 0, btnId + ' must clear the results');
    assert.equal(input.value, '', btnId + ' must also clear the query it came from');
    assert.equal(btn.hidden, true, 'and hide itself again');
  });
  app.window.close();
});

// Every outbound map link follows the setting, and the schemes are genuinely
// different per provider — so each one is checked against its own shape.
test('map links are built by the selected provider', async () => {
  const app = await boot();
  const A = app.window.__app;
  assert.equal(A.getMapProvider(), 'google', 'Google is the default');
  assert.equal(A.setMapProvider('nonsense'), 'google',
    'an unknown provider falls back rather than producing broken links');

  const stops = [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { lat: 5, lng: 6 }];
  const home = { lat: 0, lng: 0 };
  const cases = {
    google: [/google\.com\/maps\/dir/, /waypoints=/, true],
    apple: [/maps\.apple\.com/, /\+to:/, true],
    bing: [/bing\.com\/maps\/directions/, /rtp=pos\./, true],
    osm: [/openstreetmap\.org\/directions/, null, false],
  };
  Object.keys(cases).forEach((p) => {
    const [host, waypoints, carries] = cases[p];
    assert.equal(A.setMapProvider(p), p, p + ' round-trips through storage');
    assert.equal(A.getMapProvider(), p);
    const r = A.routeMapsUrl(stops, home);
    assert.match(r.url, host, p + ' builds its own URL scheme');
    if (waypoints) assert.match(r.url, waypoints, p + ' carries the intermediate stops');
    assert.equal(r.allStops, carries,
      p + ' must declare honestly whether the link really contains every stop');
    assert.match(A.mapPointUrl('47.75,-122.16'), new RegExp(host.source.split('\\/')[0]),
      p + ' also owns the single-pin links');
  });

  // A route with nothing in the middle loses nothing, so even the two-point
  // provider is complete — the warning must not cry wolf.
  assert.equal(A.routeMapsUrl([{ lat: 1, lng: 2 }], home).allStops, true);
  assert.equal(A.routeMapsUrl([], home), null, 'no usable stops means no link at all');
  assert.equal(A.routeMapsUrl([{ lat: 1, lng: 2 }], null), null,
    'one stop and no home is a destination, not a route');
  app.window.close();
});

test('the map-provider setting is reachable and lists every provider', async () => {
  const app = await boot();
  const sel = app.$('mapProvider');
  assert.ok(sel, 'Settings must expose the provider choice');
  assert.deepEqual(arr(sel.options, (o) => o.value).sort(),
    Object.keys(app.window.__app.MAP_PROVIDERS).sort(),
    'every provider the app can build links for is offered');
  sel.value = 'apple';
  sel.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.window.__app.getMapProvider(), 'apple',
    'the control is wired — an unwired select is the exact bug that hid the rankings scope for a release');
  app.window.close();
});

// "19" on its own is not information. Every number in Happening now says what
// it counts, and the supporting names/links are rows rather than a run-on line.
test('Happening now labels every count and lists names as rows', async () => {
  const app = await boot();
  const birders = [];
  for (let i = 0; i < 12; i++) birders.push({ name: 'Birder ' + i, rank: i + 1 });
  app.window.__app.renderSurge(
    [{
      code: 'tufpuf', name: 'Tufted Puffin', observers: 10, checklists: 11, ratio: 10,
      novel: false, seen: false, loc: 'Marina Beach Park', locId: 'L123',
      lat: 47.8, lon: -122.4, latest: '2026-07-29 08:00', subId: 'S999', distMi: 12.3,
    }],
    [{ species: 'Terek Sandpiper', code: '', birders, latest: '2026-07-28' }],
    [{ loc: 'Marina Beach Park', locId: 'L123', observers: 16, ratio: 10 }]);
  const box = app.$('surgeResults');
  // Each lane used to print its headline number TWICE — once as a big
  // `.count.big` and again, immediately below, inside `.meta`. Two renderings of
  // one number read as two facts. The surviving invariant is not "how many
  // headline numbers are there" but "every number is stated once, with its
  // unit", so the assertion moved onto the line that carries the meaning.
  assert.equal(box.querySelectorAll('.count.big').length, 0,
    'a headline number that only restates the sub-header below it is a duplicate, not emphasis');
  const metas = [...box.querySelectorAll('.meta')].map((m) => m.textContent);
  assert.equal(metas.length, 3, 'one sub-header per lane');
  assert.match(metas[0], /\b10 birders\b/,
    'the observation lane counts distinct BIRDERS, and says so');
  assert.match(metas[1], /\b12 of the top 100 added it\b/,
    'the cascade count is a slice of the leaderboard, not a count of sightings');
  assert.match(metas[2], /\b16 birders\b/,
    'the convergence lane counts birders at the spot, and says so');
  metas.forEach((m) => assert.ok(/\d/.test(m) && /[a-z]/i.test(m),
    'a bare number explains nothing — every count carries its unit: ' + m));

  // Convergence rows are PLACES, so they have no photo. They now go through the
  // SAME medium hotspot card Top patches uses, whose numbered badge occupies
  // that slot — "i would like these hotspots to use the same medium hotspot
  // card as top patches, use number circles too". The invariant is unchanged:
  // the slot must not be empty, or the headers do not line up with the bird
  // rows directly above them.
  const conv0 = box.querySelectorAll('ul.obs')[2];
  const pin = conv0 && conv0.querySelector('.hsnum');
  assert.ok(pin, 'a place row still needs something in the photo slot');
  assert.match(pin.textContent, /^\d+$/,
    'the badge must carry the row number, so a card can be tied to its map pin');

  // The cascade lane used to print "Name (#4) · Name (#7) · …" as one paragraph,
  // then eight labelled rows. It now uses the SAME card as Latest ticks, where
  // the roster is ONE SENTENCE with a capped list — which is what stops a
  // forty-birder cascade filling the screen.
  const cascade = box.querySelectorAll('ul.obs')[1];
  const wholine = cascade.querySelector('.wholine');
  assert.ok(wholine, 'the roster is neither a sentence nor capped');
  assert.match(wholine.textContent, /Who added it/,
    'the roster does not say what it is a list of');
  const src = HTML.slice(HTML.indexOf('function renderSurge'), HTML.indexOf('function loadSurge'));
  // The remainder is stated rather than silently dropped.
  assert.match(src, /more of the top 100/,
    'the remainder is silently dropped once the roster is capped');
  // ...and the reports behind it are collapsed, not inline. This fixture's
  // cascade has NO reports and no species code, so the row must instead say
  // WHY there is nowhere to go — a leaderboard tick with no report attached is
  // the one case where this lane cannot be actionable, and saying so is better
  // than an empty row.
  assert.match(cascade.textContent, /nowhere to link to/,
    'a cascade with no report behind it renders as a dead end instead of saying why');
  assert.match(src, /cascadeChecklists\(c\.recent\)/,
    'the reports behind a cascade are no longer collapsed, so one row becomes a page');

  // The place and the checklist are what you act on, so they must be findable.
  const surge = box.querySelectorAll('ul.obs')[0];
  assert.match(surge.textContent, /Where/);
  assert.match(surge.textContent, /S999/, 'the checklist is named by its subId, never "checklist"');
  // Convergence carries no coordinates of its own, so the NAME links the
  // hotspot page. It used to add a second "Recent visits at X" link saying the
  // same thing one line lower; the row is one line now, and the name is the
  // destination.
  const conv = box.querySelectorAll('ul.obs')[2];
  assert.match(conv.innerHTML, /ebird\.org\/hotspot\/L123/);
  assert.match(conv.textContent, /Marina Beach Park/,
    'the busy hotspot is not named, so there is nothing to link or drive to');
  app.window.close();
});

// "maybe look at all the recent species and show the rarest ones" — and the
// measurement (F155) that says WHICH rarest. A precomputed range-size rank
// would have put Black Phoebe (19 of 64 ABA regions) above Baird's Sandpiper
// (64 of 64), which is the answer that was rejected. The signal that
// reproduces eBird's own Iconic Birds panel is the multiplier: how much more
// of this place's records are this bird than the county's are.
//
// Rendered, not regexed — the ordering only exists at runtime, and the exact
// trap here is that speciesListHtml re-sorts by rare-then-alphabetical unless
// it is told the list is already ordered.
test('busy hotspots rank by the iconic multiplier and tag the row with it', async () => {
  const gbif = (u) => {
    if (/species\/match/.test(u)) {
      if (/Tyrannus/.test(u)) return { usageKey: 1 };
      if (/Turdus/.test(u)) return { usageKey: 2 };
      return {};
    }
    if (/geocode\/reverse/.test(u)) return [{ type: 'GADM2', id: 'USA.48.17_1' }];
    if (/occurrence\/search/.test(u)) {
      const box = /geometry=/.test(u);
      // Months ride along with the count on the same call, which is how the
      // row can say "30x May-Jul" without a second request.
      const mo = (ms) => ({ facets: [{ field: 'MONTH', counts: ms.map((m) => ({ name: String(m), count: 9 })) }] });
      if (/taxonKey=212/.test(u)) return { count: box ? 1000 : 100000 };
      // Eastern Kingbird: 6% of this box, 0.2% of the county -> 30x, and its
      // 60 records clear the species evidence floor.
      if (/taxonKey=1&/.test(u)) return { count: box ? 60 : 200, ...mo([5, 6, 7]) };
      // American Robin: 1% of both -> 1.0x, which is not a reason to drive.
      if (/taxonKey=2&/.test(u)) return { count: box ? 10 : 1000, ...mo([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) };
      return { count: 0 };
    }
    return null;
  };
  const app = await boot({
    fetch: gbif,
    storage: {
      'ebird_hotspots_v1:US-WA': JSON.stringify({
        at: Date.now(), rows: [{ locId: 'L123', name: 'Cedar River mouth', lat: 47.5, lng: -122.2 }],
      }),
      'ebird_species_v2:US-WA': JSON.stringify({
        at: Date.now(), rows: [
          { code: 'easkin', sci: 'Tyrannus tyrannus' },
          { code: 'amerob', sci: 'Turdus migratorius' },
        ],
      }),
    },
  });
  assert.equal(app.window.__app.getObsRegion(), 'US-WA', 'the fixture seeded the wrong cache key');
  // amerob is reported from four places region-wide and easkin from one, so
  // the FALLBACK ordering (scarcity) already puts easkin first. The fixture
  // therefore proves nothing on its own — `unkbrd` is the control: it has no
  // scientific name, so it can never be measured, and it must sink below the
  // measured birds however scarce it looks.
  const merged = [
    { locId: 'L123', subId: 'S1', code: 'amerob', name: 'American Robin' },
    { locId: 'L123', subId: 'S1', code: 'easkin', name: 'Eastern Kingbird', kind: 'Rarity' },
    { locId: 'L123', subId: 'S2', code: 'unkbrd', name: 'Mystery Bird' },
    { locId: 'L999', subId: 'S3', code: 'amerob', name: 'American Robin' },
    { locId: 'L998', subId: 'S4', code: 'amerob', name: 'American Robin' },
  ];
  app.window.__app.renderSurge([], [], [{ loc: 'Cedar River mouth', locId: 'L123', observers: 16, ratio: 10 }],
    [], merged);

  // FIRST PAINT MUST NOT WAIT. The whole point of hydrating after paint is
  // that a bounded pile of GBIF calls cannot hold the section hostage the way
  // the 221-second phase-2 stall did.
  const nameOf = (li) => {
    const a = li.querySelector('.ntext a.extlink');
    return (a || li.querySelector('.ntext')).textContent.trim();
  };
  const names0 = [...app.$('surgeConvList').querySelectorAll('.sppl > li')].map(nameOf);
  assert.equal(names0.length, 3, 'the lane painted nothing before the multipliers resolved');
  assert.equal(app.$('surgeConvList').querySelectorAll('.ictag').length, 0,
    'a multiplier was printed before it was measured');

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10));
    if (app.$('surgeConvList').querySelector('.ictag')) break;
  }
  const rows = [...app.$('surgeConvList').querySelectorAll('.sppl > li')];
  const names = rows.map(nameOf);
  // Mystery Bird sits ABOVE American Robin on purpose: the robin was measured
  // and found ordinary here, which is a stronger "not why anyone came" than
  // never having been measurable at all.
  assert.deepEqual(names, ['Eastern Kingbird', 'Mystery Bird', 'American Robin'],
    'the lane is not ordered by how much this place stands out for each bird');
  const tags = rows.map((li) => {
    const t = li.querySelector('.ictag');
    return t ? t.textContent : null;
  });
  assert.deepEqual(tags, ['30× May–Jul', null, null],
    'a bare ordering is not a reason — the row must say 30×, and must not invent one for a bird that is merely average or unmeasured');
  // ...and the multiplier is ADDITIVE. It is a reason to look, not a
  // replacement for "you have not seen this one".
  assert.ok(rows[0].querySelector('.rarebadge'),
    'the iconic tag evicted the [R] badge it was supposed to sit beside');
  app.window.close();
});

// The a11y scale is only honest if EVERY sized box multiplies through it. A
// fixed px box holding scaled text clips at Huge, which is exactly the reader
// the setting exists for.
test('no fixed-size box holds text that scales', () => {
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  const offenders = [];
  css.split('\n').forEach((line) => {
    if (!/font-size:\s*calc\(\d+px \* var\(--s\)\)/.test(line)) return;
    if (/(^|[^-])(min-)?(width|height):\s*\d+px/.test(line)) offenders.push(line.trim());
  });
  assert.deepEqual(offenders, [],
    'these boxes stay fixed while their text grows, so the text clips at large scales');
});

// Leaflet is told the marker's pixel size in JS while CSS draws it; if the two
// disagree the pin anchors off the coordinate it is marking.
test('map pins scale in lockstep with the text-size setting', () => {
  assert.match(HTML, /\.pinbubble \{[^}]*width:\s*calc\(24px \* var\(--s\)\)/,
    'the bubble box scales');
  const fn = HTML.slice(HTML.indexOf('function pinIcon('));
  const body = fn.slice(0, fn.indexOf('function renderMap('));
  assert.match(body, /24 \* getUiScale\(\)/,
    'and Leaflet is told the same number, from the same source');
  assert.doesNotMatch(body, /iconSize:\s*\[24, 24\]/,
    'a hard-coded iconSize desyncs from the CSS the moment the scale changes');
});

// --- v1.0.24: finder attribution, GBIF state records, shared row template ---

test('the first report is credited only when we watched the bird arrive', async () => {
  const app = await boot();
  const A = app.window.__app;
  const rs = [
    { obsDt: '2026-07-20 08:00', userDisplayName: 'Finder', subId: 'S1' },
    { obsDt: '2026-07-28 09:00', userDisplayName: 'Chaser', subId: 'S2' },
  ];
  // Coverage opened well before the first report, so there is a stretch of
  // watched days with nothing: the earliest observer really is the finder.
  const inside = A.firstReport(rs, '2026-07-01');
  assert.equal(inside.r.userDisplayName, 'Finder', 'picks the EARLIEST, not the latest');
  assert.equal(inside.found, true, 'inside coverage => a real find');
  // Coverage opened after the bird was already being reported, so whoever is
  // oldest in our slice is not the finder and must not be credited as one.
  const strad = A.firstReport(rs, '2026-07-20');
  assert.equal(strad.found, false, 'at the boundary the true finder is earlier');
  assert.equal(A.firstReport([], '2026-07-01'), null, 'no records, no claim');
});

test('coverage never starts later than the API window we always have', async () => {
  const app = await boot();
  const A = app.window.__app;
  const s = A.coverageStart('US-WA');
  const thirty = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  assert.ok(s <= thirty, 'a device with no archive still covers the last 30 days');
});

test('GBIF state history states its window and never says "all time"', async () => {
  const app = await boot();
  const A = app.window.__app;
  const some = A.histLine({ records: 1085, years: 36, first: 1972, last: 2023,
    wide: 22409, states: 50, topState: 'California', topPct: 28 }, 'Washington');
  assert.match(some, /1,085 records in Washington/, 'leads with the state count');
  assert.match(some, /1972–2023/, 'and the years it covers');
  assert.match(some, /22,409 records in the USA/, 'national context');
  assert.doesNotMatch(some, /all[- ]time/i, 'the snapshot is bounded, so never "all time"');
  assert.match(some, /GBIF/, 'the source is named');
  // The ABA code is CONTINENTAL: a bird that is near-annual in Alaska still
  // appears on the alert in Washington. 898 US records reads as common until
  // you know 69% of them are one state, so the top state must be named.
  assert.match(some, /most in California \(28%\)/, 'names where the records actually are');
  const none = A.histLine({ records: 0, years: 0, first: null, last: null,
    wide: 898, states: 6, topState: 'Alaska', topPct: 69 }, 'Washington');
  assert.match(none, /No Washington record/, 'zero is reported as a category, not a count');
  assert.match(none, /most in Alaska \(69%\)/, 'and explains why the US number looks big');
  assert.equal(A.histLine(null, 'Washington'), '', 'no data renders nothing at all');
});

test('the GBIF lookup needs a scientific name and asks for no eBird quota', async () => {
  const app = await boot();
  const A = app.window.__app;
  // Common names do not resolve in GBIF's backbone taxonomy, so a lookup
  // without a scientific name would be a guaranteed-miss request.
  assert.equal(await A.gbifHistory('', 'Washington', 'US'), null, 'no name, no request');
  assert.equal(await A.gbifHistory('Calidris pugnax', '', 'US'), null, 'no state, no request');
  const html = HTML.slice(HTML.indexOf('function gbifHistory('),
    HTML.indexOf('function histLine('));
  assert.match(html, /api\.gbif\.org/, 'reads GBIF directly from the device');
  assert.doesNotMatch(html, /ebird\(/, 'and spends no eBird API call doing it');
});

test('Happening now titles all three lanes so the last is not a footnote', async () => {
  const app = await boot();
  const A = app.window.__app, d = app.window.document;
  A.renderSurge(
    [{ name: 'Tufted Puffin', code: 'tuf', observers: 10, checklists: 10,
      ratio: 10, loc: 'Marina Beach', lat: 47, lon: -122 }],
    [{ species: 'Terek Sandpiper', code: 'tersan', latest: '2026-07-20',
      birders: [{ rank: 3, name: 'Brian' }],
      recent: [{ obsDt: '2026-07-28 10:00', locName: 'Stanwood STP',
        lat: 48, lng: -122, subId: 'S9' }] }],
    [{ locId: 'L1', loc: 'Magnuson Park', observers: 16, ratio: 10 }]);
  const heads = [].map.call(d.querySelectorAll('#surgeResults .lanehead'), e => e.textContent);
  assert.equal(heads.length, 3, 'every lane gets its own heading');
  assert.ok(heads[2].includes('hotspot'), 'including the hotspot lane that was buried');
  const box = d.getElementById('surgeResults').innerHTML;
  // A leaderboard row on its own says a bird is gettable but never where. That
  // used to be a labelled "Where it is being reported" block under the row;
  // the row is one line now, so the place and time ARE the row — but the lane
  // must still end somewhere you can drive to.
  assert.match(box, /class="ckgo"|class="extlink"/,
    'the cascade lane became actionable');
  assert.match(box, /Stanwood STP/, 'with a real place');
  assert.match(box, /S9/, 'and a checklist to cite');
  // "the paragraph text under this section goes into the information help
  // dialogue too" — so the lane explanations left the screen and the ⓘ dialog
  // is where they have to be, or they are simply gone.
  const docs = JSON.parse(fs.readFileSync(path.join(WWW, 'section-docs.json'), 'utf8'));
  const how = (docs.docs.surgeBtn.how || []).join(' ');
  assert.match(how, /species-blind/,
    'the hotspot lane no longer explains why it is notable, in the section or the dialog');
  assert.match(how, /Celebrity Birds/,
    'the renamed lane is not described where its paragraph went');
});

// The MEDIUM card is a 2x2 table, and that is the whole point of it. The float
// it replaced made the sub-header's position depend on how many lines the title
// took: a short name let .meta ride UP beside the photo, a long one pushed it
// below, so no two rows in a list ever lined up. That is the "wrapping odd" that
// was reported four separate times against four different sections.
//
//   col 1  the photo, spanning BOTH rows
//   col 2  row 1 = header (what this is) · row 2 = sub-header (what you decide on)
//   anything after those two cells starts a new FULL-WIDTH row underneath
test('the medium card is a real 2x2 grid, not a float', async () => {
  const app = await boot();
  // The card CSS lives in www/cards-species.js now, which is the point of the
  // split: the rules you tweak are in a file named after what they style.
  const css = CARDS_SPECIES.slice(CARDS_SPECIES.indexOf('.obs.xl > li, .obs.card-md > li {'),
    CARDS_SPECIES.indexOf('MEDIUM typography'));
  assert.match(css, /display: grid;/, 'the row is a grid');
  assert.match(css, /grid-template-columns: auto minmax\(0, 1fr\)/,
    'photo column sized to the photo, text column takes the rest and may shrink');
  // display:contents is load-bearing: .thumb and .ntext are nested INSIDE .name
  // in the markup, so .name's own box has to disappear for them to become cells
  // of the row grid. Inherited typography still passes through it.
  assert.match(css, /> \.name, \.obs\.card-md > li > \.name \{ display: contents/,
    '.name must dissolve so its children can be grid cells');
  assert.match(css, /> \.thumb[^}]*grid-row: 1;/, 'the photo occupies row 1');
  assert.match(css, /> \.ntext[^}]*grid-column: 2; grid-row: 1/, 'the header is row 1');
  // ROW 2 SPANS ALL THREE COLUMNS — under the photo, out under the mileage.
  // It used to sit in column 2 only, boxed between them, which gave it about
  // half the card: a place, a time and an observer wrapped to three ragged
  // lines in a gutter while the space under the photo and the number sat
  // empty. This is additional information about the row, not a third column.
  assert.match(css, /> \.meta, \.obs\.card-md > li > \.meta \{[\s\S]{0,80}grid-column: 1 \/ -1; grid-row: 2/,
    'the sub-header spans the full width on row 2, whatever the title did');
  assert.match(css, /> li > \*, \.obs\.card-md > li > \* \{ grid-column: 1 \/ -1/,
    'everything else spans the full width on its own row');
  // A medium card CONTAINS a small-card species list (a hotspot's unseen birds).
  // A descendant selector would hand those nested rows display:contents and the
  // 26px title, which is exactly how the two templates would silently merge.
  const scoped = css.match(/\.obs\.(xl|card-md) [.a-z]/g);
  assert.equal(scoped, null,
    'every medium-card rule must be child-scoped (>) or it leaks into nested small cards');
  const d = app.window.document;
  // Today's rarities left this set when it became a small card; the two that
  // remain are the ones that genuinely read one row at a time.
  for (const id of ['activeResults', 'lastNewResults']) {
    assert.ok(d.getElementById(id).className.includes('xl'),
      id + ' shares the template rather than styling itself');
  }
  app.window.close();
});

test('Latest ticks answers how far away the bird is', async () => {
  const app = await boot({ storage: { 'ebird_home_lat:wa': '47.75', 'ebird_home_lng:wa': '-122.15' } });
  const A = app.window.__app, d = app.window.document;
  const groups = {}, byName = {};
  groups['Terek Sandpiper'] = { latest: '2026-07-20', birders: [{ rank: 3, name: 'Brian' }] };
  byName['Terek Sandpiper'] = { code: 'tersan', obs: [
    { obsDt: '2026-07-28 10:00', locName: 'Far', lat: 46.0, lng: -122.15, subId: 'S1' },
    { obsDt: '2026-07-27 10:00', locName: 'Near', lat: 47.70, lng: -122.15, subId: 'S2' },
  ] };
  A.renderLastNew(groups, byName, 'US-WA');
  const txt = d.getElementById('lastNewResults').textContent;
  // The CLOSEST report, not the newest: the nearest one is where you would go.
  // It now renders in the medium card's distance COLUMN rather than as a
  // phrase in the sub-header, which is the same convention every other medium
  // card uses — the number is there to be scanned down the edge of a list.
  assert.match(txt, /3\.\d/, 'measures to the closest report, not the latest');
  const dist = d.querySelector('#lastNewResults .spdist');
  assert.ok(dist, 'and it is the card distance column, not buried in a sentence');
  assert.match(dist.textContent, /3\.\d/);
});

test('Favorite hotspots shows what is worth driving for, not a species dump', async () => {
  const app = await boot();
  const A = app.window.__app;
  // A hotspot list that includes birds you have already seen answers "what
  // lives here", which is not the question. The report drops them.
  const obs = [
    { speciesCode: 'ruff', comName: 'Ruff', obsDt: '2026-07-28 08:00', subId: 'S1', userDisplayName: 'Ann' },
    { speciesCode: 'amerob', comName: 'American Robin', obsDt: '2026-07-28 09:00', subId: 'S2', userDisplayName: 'Ann' },
    { speciesCode: 'ruff', comName: 'Ruff', obsDt: '2026-07-20 08:00', subId: 'S0', userDisplayName: 'Ann' },
    { speciesCode: 'tersan', comName: 'Terek Sandpiper', obsDt: '2026-07-27 08:00', subId: 'S3', userDisplayName: 'Birder Wyatt' },
  ];
  app.window.localStorage.setItem('ebird_year_names', JSON.stringify(['American Robin']));
  const res = A.favInteresting(obs, { ruff: 1 });
  const codes = res.rows.map((r) => r.code);
  assert.ok(codes.indexOf('amerob') < 0, 'a bird already on your year list is not a reason to drive');
  assert.equal(codes[0], 'ruff', 'rarities outrank plain unseen birds');
  assert.ok(codes.indexOf('tersan') < 0, 'your own checklist is not news at your own hotspot');
  assert.equal(res.rows[0].o.subId, 'S1', 'keeps the NEWEST report of each species');
  const html = A.favDetailHtml({ name: 'x' }, obs, { ruff: 1 });
  assert.match(html, /card-sm/, 'uses the small one-row card template');
  assert.match(html, /⭐/, 'and flags the rarity the way the report does');
  assert.match(html, /species in 7d/, 'header states the window it counted');
  const quiet = A.favDetailHtml({ name: 'x' }, [obs[1]], {});
  assert.match(quiet, /No rarities, watchlist hits, or unseen/, 'says nothing is here rather than going blank');
});
test('there are exactly three card templates and each one is really used', () => {
  // The templates are a system, not three coincidences, and they now live in
  // two files named after what they style — one per family, three sizes each.
  for (const cls of ['.obs.card-sm .name', '.obs.card-md > li > .name', '.card-lg > li']) {
    assert.ok(CARDS_SPECIES.includes(cls), cls + ' is defined in cards-species.js');
  }
  for (const cls of ['.hscard-sm', '.hscard-md', '.hscard-lg']) {
    assert.ok(CARDS_HOTSPOT.includes(cls), cls + ' is defined in cards-hotspot.js');
  }
  // Each family exposes the same three sizes, so a section picks a SIZE and
  // never a bespoke shape.
  for (const src of [CARDS_SPECIES, CARDS_HOTSPOT]) {
    for (const size of ['small:', 'medium:', 'large:']) {
      assert.ok(src.includes(size), 'both families expose ' + size);
    }
  }
  // SMALL is one row: the text box matches the icon height so a long list
  // scans as evenly spaced lines rather than a ragged stack.
  assert.match(CARDS_SPECIES, /\.obs\.card-sm \.name \{ display: flex;[^}]*min-height: calc\(46px \* var\(--s\)\)/,
    'small card ties its row height to its icon');
  assert.match(CARDS_SPECIES, /\.obs\.card-sm \.thumb \{ float: none/,
    'and the icon sits beside the name instead of floating out of the row');
  // LARGE stacks: photo, then name, then sub-header.
  assert.match(CARDS_SPECIES, /\.bchero \{ width: 100%;[^}]*aspect-ratio: 3 \/ 2/, 'large card photo is full width');
  assert.ok(CARDS_SPECIES.indexOf('.bcname') < CARDS_SPECIES.indexOf('.bcsub'),
    'name row precedes the sub-header row');
  // Favorites and the rarity lists must OPT IN to a size rather than hand-roll
  // one. Favorites builds its list through the shared builder now, so the class
  // is applied at render time — assert the delegation, not a source literal.
  assert.match(HTML, /speciesListHtml\(rows, \{ presorted: true, cls: 'favspp' \}\)/,
    'favorites use the small template via the one builder');
  assert.ok(HTML.includes('class="obs big xl"'), 'ticks/rarities use the medium template');
  // The ABA list takes its class at render time, because the same <ul> holds a
  // grouped card grid or a flat observation list depending on the region.
  assert.match(HTML, /grouped \? 'cards' : 'obs'/,
    'the ABA section uses the large template when it groups by species');
  // index.html must not keep a second copy of any card rule — one definition
  // is the entire point of moving them out.
  for (const rule of ['.obs.card-sm .name {', '.obs.xl > li, .obs.card-md > li {',
                      '.bchero {', '.hsnum {']) {
    assert.ok(!HTML.includes(rule),
      'index.html must not redeclare "' + rule + '" — the card files own it');
  }
});

// The bug this guards was reported three times against two different sections
// ("the font size STILL has not increased") and survived two releases, because
// every fix raised a number that could not reach the screen.
test('a card title that is a link keeps the TITLE type, not the action-link type', async () => {
  const app = await boot();
  const { window } = app;
  const doc = window.document;

  // The action-link rule that caused it. It is legitimate — it styles "Open in
  // Maps" — so the fix is scoping, not deletion, and this pins the rule it is
  // allowed to be so the guard keeps meaning something if it is retuned.
  const actionRule = (HTML.match(
    /\.maplink, \.extlink, \.favlink, \.mylink \{[^}]*\}/) || [])[0];
  assert.ok(actionRule && /font-size:/.test(actionRule),
    'the action-link rule still exists and still sets a font-size');
  const actionSize = actionRule.match(/font-size: (calc\([^)]*\)[^;]*);/)[1];

  const host = doc.createElement('ul');
  host.className = 'obs hscards hscards-medium';
  doc.body.appendChild(host);
  host.appendChild(window.__app.hotspotCard({
    n: 1, locId: 'L1', locName: 'Marymoor Park', facts: ['9.3 mi', '37 species']
  }));

  const link = host.querySelector('.ntext a');
  assert.ok(link, 'the hotspot name really is rendered as a link');
  assert.match(link.className, /extlink/,
    'and it really carries the action-link class this guard is about');

  // WHY THIS IS RE-STAGED IN A CLEAN DOCUMENT RATHER THAN MEASURED IN PLACE:
  // asserting getComputedStyle on the booted app looks stronger and is in fact
  // VACUOUS — jsdom never applies index.html's action-link rule to this link at
  // all, so the assertion passed identically with the fix deleted. It was
  // caught by mutating the rule and watching the test stay green. jsdom DOES
  // resolve specificity correctly on a stylesheet it parses, so the honest test
  // is to put the two REAL competing rules in one document and ask which wins.
  const cardCss = ['hotspot', 'species'].map((k) => {
    const el = doc.querySelector('style[data-cards="' + k + '"]');
    assert.ok(el && el.textContent, k + ' card CSS is injected by its module');
    return el.textContent;
  });
  // Same order as the shipped page: index.html's inline <style> is parsed
  // first, the card modules append theirs afterwards, so a module wins ties.
  const stage = new JSDOM('<!doctype html><html><head><style>:root{--s:1}\n'
    + actionRule + '\n</style><style>' + cardCss.join('\n') + '</style></head>'
    + '<body><ul class="obs hscards hscards-medium">'
    + host.querySelector('li').outerHTML + '</ul></body></html>');
  const sw = stage.window;
  const sLink = sw.document.querySelector('.ntext a');
  const sText = sw.document.querySelector('.ntext');
  const sMeta = sw.document.querySelector('.meta');
  const cs = (el) => sw.getComputedStyle(el).fontSize;
  assert.ok(sLink && sText && sMeta, 'the card re-stages with its parts intact');
  // Precondition: prove the staged document really is resolving the cascade,
  // so a future jsdom change cannot silently turn this guard vacuous again.
  assert.equal(cs(sw.document.createElement('a')) !== cs(sText), true,
    'the staged stylesheet is live — an unstyled element differs from .ntext');

  assert.notEqual(cs(sLink), actionSize,
    'the hotspot NAME must not take the 13px action-link size — that is the '
    + 'reported "font size still has not increased", and it also made the '
    + 'sub-header bigger than the title it belongs to');
  assert.equal(cs(sLink), cs(sText),
    'a link that IS the title renders at the title size');
  assert.equal(sw.getComputedStyle(sLink).marginTop, '0px',
    'and carries no action-link top margin — that margin is the blank line '
    + 'reported above the hotspot name');
  assert.notEqual(cs(sText), cs(sMeta),
    'title and sub-header are distinguishable at all');
  stage.window.close();

  // Both card families had the identical bug, so both must carry the fix. The
  // selector must reset a BARE descendant `a`; `.ntext a.something` would
  // satisfy a looser pattern while matching no title in the app.
  for (const [src, file] of [[CARDS_HOTSPOT, 'cards-hotspot.js'],
                             [CARDS_SPECIES, 'cards-species.js']]) {
    assert.match(src, /\.ntext a\s*[,{][^{]*\{[^}]*font-size: inherit/,
      file + ' resets link typography inside a name slot');
  }
  app.window.close();
});

// The blank line above the name and the dead space under the number were ONE
// mechanism, and it is a property of the grid rather than of any single value.
test('the hotspot card text block is taller than the number it sits beside', () => {
  const px = (re) => {
    const m = CARDS_HOTSPOT.match(re);
    assert.ok(m, 'could not read ' + re);
    return parseFloat(m[1]);
  };
  // The MEDIUM card's badge, not the base .hsnum. This regex used to match the
  // base rule (46px) while every other value it reads comes from .hscard-md,
  // whose badge is 40px — so the check was 6px stricter than the card it was
  // describing, and would have rejected a correct size.
  const badge = px(/\.hscard-md \.hsnum \{[\s\S]*?height: calc\((\d+)px \* var\(--s\)\)/);
  const name = px(/\.hscard-md > \.name > \.ntext \{[\s\S]*?font-size: calc\((\d+)px \* var\(--s\)\)/);
  const nameLh = px(/\.hscard-md > \.name > \.ntext \{[\s\S]*?line-height: ([\d.]+)/);
  const meta = px(/\.hscard-md > \.meta \{[\s\S]*?font-size: calc\((\d+)px \* var\(--s\)\)/);
  const gap = px(/\.hscard-md \{[\s\S]*?row-gap: (\d+)px/);

  assert.ok(name > meta,
    'the hotspot name outranks its own sub-header (' + name + ' vs ' + meta + ')');
  // ...and by a real margin. Reducing the name alone (asked for twice) would
  // have left 17 against 16, which is not a hierarchy — it is two sizes that
  // happen to differ. The species card sets its own subject 1.2x its meta, so
  // that is the ratio pinned here rather than either raw number.
  assert.ok(name / meta >= 1.15,
    'and does so by enough to read as the subject (' + name + '/' + meta
    + ' = ' + (name / meta).toFixed(2) + ', want >= 1.15)');
  // A hotspot name must not outshout a BIRD name on a card of the same rank.
  // This is what "the medium hotspot name is too big" actually was: nothing
  // was wrong with 21px in isolation, it was wrong beside the 17px the medium
  // species card gives its subject — and hotspot names are the long ones.
  const spName = parseFloat(
    CARDS_SPECIES.match(/\.obs\.xl > li > \.name \{ font-size: calc\((\d+)px/)[1]);
  assert.ok(name <= spName + 1,
    'the medium hotspot name (' + name + 'px) may not exceed the medium '
    + 'species name (' + spName + 'px) — same rank of card, same weight for '
    + 'its subject');
  // .hsnum spans BOTH grid rows. A grid distributes a spanning item's minimum
  // height across the rows it spans, so a text block shorter than the badge
  // makes the rows STRETCH — which is the reported blank line and the dead
  // space under the number. align-self cannot fix that; only height can.
  const block = name * nameLh + gap + meta * 1.35;
  assert.ok(block > badge,
    'name + gap + meta (' + block.toFixed(1) + 'px) must exceed the '
    + badge + 'px badge it spans, or the grid rows stretch to fill it');
  // Every term scales with --s, so the relationship holds at every text size.
  for (const rule of [/\.hscard-md > \.name > \.ntext \{[\s\S]*?font-size: calc\(\d+px \* var\(--s\)\)/,
                      /\.hscard-md > \.meta \{[\s\S]*?font-size: calc\(\d+px \* var\(--s\)\)/]) {
    assert.match(CARDS_HOTSPOT, rule, 'both sizes scale with --s');
  }
  // A 1fr column refuses to shrink below its content, which is how a long
  // hotspot name pushes the whole page sideways.
  assert.match(CARDS_HOTSPOT, /\.hscard-md \{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\)/,
    'the text column may shrink below its content instead of widening the page');
});

// The shared card is fed by five different record shapes. A missing slot must be
// OMITTED, not rendered — "score 42 · undefined rarities · 2 targets" is what a
// template that trusts every caller produces the first time one of them changes.
test('the hotspot card omits facts it was not given', async () => {
  const app = await boot();
  const A = app.window.__app;
  const li = A.hotspotCard({
    n: 3, locId: 'L1', locName: 'Marina Beach Park', lat: 47.8, lng: -122.39,
    facts: ['12.0 mi', null, '', undefined + ' rarities', 'score ' + NaN, '2 targets'],
    species: [{ code: 'tufpuf', comName: 'Tufted Puffin', rare: 1 }],
  });
  const meta = li.querySelector('.meta').textContent;
  assert.equal(meta, '12.0 mi · 2 targets', 'unknown facts vanish rather than printing junk');
  assert.equal(li.querySelector('.hsnum').textContent, '3', 'the stop number is the icon');
  assert.match(li.querySelector('.ntext').textContent, /Marina Beach Park/, 'name is the header');
  // Tier 1 of the icon pipeline is the bundled seed, which is keyed by species
  // CODE. A species list carrying only names silently downgrades every row to a
  // network lookup and loses the /species/{code} link with it.
  assert.match(li.innerHTML, /tufpuf/, 'nested species rows carry the code, not just the name');
  app.window.close();
});

// A hotspot card exists to answer ONE question: is this worth the drive? Only
// the unseen list answers it. Hot hotspots collapsed BOTH lists behind a single
// expander, so the deciding fact was a tap away on every row while a species
// count you cannot act on was printed in full. Seen birds still earn a place —
// they say the spot is alive rather than empty — but they are context, so they
// collapse. A section may not swap which is which.
test('a hotspot card shows the unseen birds and collapses the seen ones', async () => {
  const app = await boot();
  const A = app.window.__app;
  const li = A.hotspotCard({
    n: 1, locId: 'L2', locName: 'Edmonds Marsh', lat: 47.8, lng: -122.38,
    facts: ['2.4 mi'],
    species: [{ code: 'tufpuf', comName: 'Tufted Puffin', rare: 1 }],
    seenSpecies: [{ code: 'amecro', comName: 'American Crow', rare: 0 },
                  { code: 'sonspa', comName: 'Song Sparrow', rare: 0 }],
  });
  const unseen = li.querySelector('.hsunseen');
  assert.ok(unseen, 'the unseen birds are rendered');
  assert.equal(unseen.closest('details'), null,
    'the unseen list is NEVER behind an expander — it is the reason to drive there');
  assert.match(unseen.textContent, /Tufted Puffin/, 'and it names the birds');

  const seen = li.querySelector('.hsseen');
  assert.equal(seen.tagName, 'DETAILS', 'the seen list IS an expander — it is context');
  assert.ok(!seen.hasAttribute('open'), 'and it starts closed');
  // The count has to be on the summary: it is the only thing readable while shut.
  assert.match(seen.querySelector('summary').textContent, /2 more species already seen/,
    'the summary carries the count, because the list itself is hidden');
  assert.match(seen.textContent, /American Crow/, 'the seen birds are still there to open');

  // Both lists use the small SPECIES card, so a bird looks like a bird everywhere.
  for (const el of [unseen, seen]) {
    assert.ok(el.querySelector('ul.obs.card-sm'), 'species render as small cards');
  }
  // And the actions come last, after the birds — you decide, then you go.
  const acts = li.querySelector('.hsact');
  assert.ok(acts, 'every hotspot card offers Open in Maps / Save');
  assert.match(acts.textContent, /Open in Maps/, 'Open in Maps');
  assert.match(acts.textContent, /Save|Saved/, 'and Save, exactly like the quick outing');
  assert.ok(li.querySelector('.hsseen').compareDocumentPosition(acts)
    & app.window.Node.DOCUMENT_POSITION_FOLLOWING, 'actions sit below the lists');
  app.window.close();
});

// Measured: only hotspotRow (Hot & Cold) ever passed seenSpecies, because it is
// the one section that runs its own full hotspot scan. Top destinations, Top
// excursions, the Trip planner, Closest spots and Quick outing read the CHASE
// feeds — which carry every recent observation and are then FILTERED to unseen
// for ranking — so the seen birds were fetched, merged and discarded one step
// before the card. The collapsed "already seen" list belongs to the CARD, not
// to one section, or it goes missing again the next time a section is added.
test('the seen list reaches every hotspot card, not just Hot and Cold', async () => {
  const app = await boot();
  const A = app.window.__app;
  // Take a species the ACTIVE report's year list really contains, so this
  // guard cannot quietly pass by finding nothing seen to show.
  const seenCodes = Object.keys(A.getReportSeen() || {});
  assert.ok(seenCodes.length, 'the bundled seed supplies a year list to test against');
  const already = seenCodes[0];
  assert.ok(A.isSpeciesSeen(already, null), 'and that code really resolves as seen');

  // The exact shape computeChaseViews returns, seeded through the cache the
  // sections already render from — the point is that no extra fetch is needed.
  A.seedChase(A.getReportSlug(), {
    t: Date.now(), rarity: false,
    cv: {
      merged: [
        { locId: 'L9', code: 'tufpuf', name: 'Tufted Puffin', kind: 'Rarity', dateStr: '2026-07-29 08:00' },
        { locId: 'L9', code: already, name: 'Already Seen Bird', kind: 'Need', dateStr: '2026-07-29 07:00' },
        { locId: 'L7', code: already, name: 'Already Seen Bird', kind: 'Need', dateStr: '2026-07-29 07:00' },
      ],
    },
  });

  // Array.from: these arrays are built inside the jsdom realm, and assert
  // compares prototypes — an identical-looking list from another realm fails.
  const split = A.locSpeciesSplit('L9', [{ code: 'tufpuf', comName: 'Tufted Puffin', rare: 1 }]);
  assert.deepEqual(Array.from(split.unseen, (s) => s.code), ['tufpuf'],
    'a caller that brought its own scored unseen list keeps exactly that list');
  assert.deepEqual(Array.from(split.seen, (s) => s.code), [already],
    'and the seen half is filled in from the merged chase feed');
  // The split is a PARTITION decided by isSpeciesSeen, not a guess.
  for (const row of split.seen) {
    assert.ok(A.isSpeciesSeen(row.code, row.comName),
      `${row.code} is in the seen half because the year list holds it`);
    assert.equal(row.tag, '',
      'seen rows carry no 🔍/⭐ — those mark a bird worth chasing, and this one is not');
  }

  // Now the card itself: a section that passes NO seenSpecies still gets it.
  const li = A.hotspotCard({
    n: 1, locId: 'L9', locName: 'Edmonds Marsh', lat: 47.8, lng: -122.38,
    facts: ['2.4 mi'],
    species: [{ code: 'tufpuf', comName: 'Tufted Puffin', rare: 1 }],
  });
  assert.match(li.querySelector('.hsunseen').textContent, /Tufted Puffin/,
    'the unseen half still comes from the section');
  const seen = li.querySelector('.hsseen');
  assert.ok(seen, 'and the seen half is filled in from the chase feed already paid for');
  assert.equal(seen.tagName, 'DETAILS', 'collapsed, exactly as Hot hotspots shows it');
  assert.ok(!seen.hasAttribute('open'), 'and closed, because it is context');
  assert.ok(seen.querySelector('ul.obs.card-sm'),
    'the seen birds use the SMALL species card, like every other bird list');
  assert.match(seen.querySelector('summary').textContent, /more species already seen/,
    'the summary carries the count — it is all you can read while it is shut');

  // A place with nothing recorded gets no invented list.
  assert.equal(A.locSpeciesSplit('L-nothing-here', []).seen.length, 0,
    'an unknown hotspot yields no seen birds rather than a wrong one');
  app.window.close();
});

// A card that showed the seen list while hiding the unseen one would answer
// "is this worth the drive?" with a confident NO about a spot with a target
// sitting on it. Quick outing brings neither list (its ref/hotspot/geo feed
// carries no species at all), so it must get BOTH halves or neither.
test('a hotspot card never shows seen birds while hiding unseen ones', async () => {
  const app = await boot();
  const A = app.window.__app;
  A.seedChase(A.getReportSlug(), {
    t: Date.now(), rarity: false,
    cv: {
      merged: [
        { locId: 'L5', code: 'zzzrare', name: 'Zzz Rare Bird', kind: 'Rarity', dateStr: '2026-07-29 08:00' },
      ],
    },
  });
  // No `species` at all — the Quick outing shape.
  const li = A.hotspotCard({ n: 1, locId: 'L5', locName: 'Some Park', lat: 47.8, lng: -122.38, facts: ['1.0 mi'] });
  const seen = li.querySelector('.hsseen');
  const unseen = li.querySelector('.hsunseen');
  // A species the year list cannot contain must land in the UNSEEN half, and a
  // card holding only unseen birds must not render an empty seen expander.
  assert.ok(unseen, 'a bird you have not logged is surfaced, not buried as context');
  assert.match(unseen.textContent, /Zzz Rare Bird/, 'and it is named');
  assert.equal(seen, null, 'no empty "already seen" expander when there is nothing to put in it');
  app.window.close();
});

// The app had TWO definitions of "seen", and they disagree by a measurable
// amount. getReportSeen() is the ACTIVE report's year list, mirroring the
// Markdown report. isSpeciesSeen() reads localStorage K.seen, which applySeed()
// fills with the COMBINED cross-region code list — 331 codes against
// Washington's 303. Hot & Cold hotspots asked only isSpeciesSeen, so a bird
// ticked in Missouri was reported as already seen in Washington and buried in
// the collapsed context list: the section that exists to say "there are birds
// here you still need" hiding 28 of them. On the Waikoloa trip report, whose
// entire premise is that every Big Island bird is a lifer target, the combined
// set silences all 331.
test('a bird ticked in another region is still a target in this report', async () => {
  const app = await boot();
  const A = app.window.__app;
  const seed = app.window.__SEED_BIRDLIST__;
  const slug = A.getReportSlug();
  const rep = seed.seenByReport[slug];
  const perReport = A.getReportSeen();

  // Find a code the COMBINED seed calls seen that THIS report does not. If the
  // seed ever stops diverging this guard says so rather than passing vacuously.
  const elsewhere = seed.codes.map((c) => String(c).toLowerCase())
    .filter((c) => !perReport[c]);
  assert.ok(elsewhere.length,
    `the shipped seed must diverge for this guard to mean anything (${slug})`);
  const other = elsewhere[0];
  // isSpeciesSeen now reads the PER-REPORT set, so it agrees with the scan
  // instead of contradicting it. This assertion used to be the opposite —
  // "precondition: the combined set really does call this bird seen" — which
  // documented the divergence rather than objecting to it, and the divergence
  // is what the section then had to work around.
  assert.ok(!A.isSpeciesSeen(other, null),
    'a bird ticked in ANOTHER region is not seen in this one, and the marker '
    + 'says so as plainly as the scan does');

  // HOT_MIN_FRESH is 5, so pad with four birds the report genuinely has.
  const mine = Object.keys(perReport).slice(0, 4);
  assert.equal(mine.length, 4, 'the report supplies four genuinely-seen birds');
  const codes = mine.concat([other]);
  const recent = codes.map((c, i) => ({
    locId: 'L1', speciesCode: c, comName: 'Bird ' + i,
    subId: 'S' + i, obsDt: '2026-07-29 08:00',
  }));
  const meta = [{ locId: 'L1', locName: 'Test Marsh', lat: 47.8, lng: -122.38, numSpeciesAllTime: '120' }];
  const res = A.computeHotspots(recent, meta, { lat: 47.8, lng: -122.38 }, []);

  assert.equal(res.hot.length, 1, 'the fixture produces exactly one hot hotspot');
  const row = res.hot[0];
  assert.deepEqual(Array.from(row.birds.filter((b) => b.unseen), (b) => b.code), [other],
    'the out-of-region bird is the target; the four on this year list are not');
  assert.equal(row.unseenN, 1, 'and the row counts exactly one');

  // The card the section renders has to agree with the scan, or the fix stops
  // at the data and never reaches the screen.
  const sp = A.splitHotspotBirds(row);
  assert.equal(sp.unseen.length, 1, 'the card splits the row the same way');
  assert.equal(sp.seen.length, 4, 'and the other four are the collapsed context list');

  // A watchlisted bird is deliberately held OFF the year list so it resurfaces
  // as a target. The resolver must not quietly hand it back via a name match.
  const held = (rep.watchHeld || []).filter((c) => !perReport[String(c).toLowerCase()]);
  if (held.length) {
    const h = String(held[0]).toLowerCase();
    const r2 = A.computeHotspots(
      mine.concat([h]).map((c, i) => ({
        locId: 'L2', speciesCode: c, comName: 'Bird ' + i, subId: 'T' + i, obsDt: '2026-07-29 08:00',
      })),
      [{ locId: 'L2', locName: 'Held Marsh', lat: 47.8, lng: -122.38, numSpeciesAllTime: '120' }],
      { lat: 47.8, lng: -122.38 }, []);
    assert.deepEqual(Array.from(r2.hot[0].birds.filter((b) => b.unseen), (b) => b.code), [h],
      'a species held back for verification stays a target');
  }
  app.window.close();
});


test('destination clusters carry the species code into the render shape', () => {
  const logic = fs.readFileSync(path.join(WWW, 'logic.js'), 'utf8');
  const fn = logic.slice(logic.indexOf('function toRenderDest('),
    logic.indexOf('function dedupeObs('));
  assert.match(fn, /code: s\.code/,
    'the code buys the offline icon, the species link and taxonomy-aware seen resolution');
});

// The five sections that answer "where do I go, and what is there" — Top
// destinations, Top excursions, Closest spots, Quick outing, Trip planner — are
// ONE template with fixed slots. They used to be five hand-rolled row builders,
// and they drifted every time one was touched: the trip planner had silently
// lost its photo hydration entirely, which is why its species icons rendered as
// blank grey squares while the structurally identical Top destinations was fine.
// Standardising is only worth anything if the sections cannot opt back out.
test('every hotspot list is built by the one shared card', () => {
  const fns = {
    'Top destinations / excursions': ['function renderDestinations(', 'function renderRoute('],
    'the trip planner': ['function renderRoute(', 'function loadTripPlanner('],
    'closest spots': ['function renderTargetPlaces(', 'function refresh()'],
    'quick outing': ['function loadQuickOuting(', 'function parseCSV('],
    // Hot & Cold were the last holdouts: they rendered a hand-rolled row with
    // the birds — unseen AND seen together — collapsed behind one expander.
    'hot & cold hotspots': ['function hotspotRow(', 'var _hotspotCache'],
  };
  for (const [name, [from, to]] of Object.entries(fns)) {
    const i = HTML.indexOf(from), j = HTML.indexOf(to);
    assert.ok(i > -1, name + ': ' + from + ' must exist');
    assert.ok(j > i, name + ': ' + to + ' must follow it');
    const src = HTML.slice(i, j);
    assert.match(src, /hotspotCard\(\{/, name + ' must build its rows with hotspotCard');
    assert.doesNotMatch(src, /<div class="name">/,
      name + ' must not hand-roll a row — that is how the five drifted apart');
    assert.doesNotMatch(src, /<details/,
      name + ' must not roll its own expander — the card decides what collapses');
  }
  // The shared card is what makes the standardisation real: one place to fix.
  const card = HTML.slice(HTML.indexOf('function hotspotCard('),
    HTML.indexOf('function renderDestinations('));
  assert.match(card, /HotspotCards\.medium\(/,
    'the card delegates its layout to www/cards-hotspot.js, the one definition');
  assert.match(card, /unseen:/, 'unseen birds are a slot the template renders open');
  assert.match(card, /seen:/, 'seen birds are a slot the template collapses');
  assert.match(card, /speciesListHtml\(/, 'and both are SPECIES cards, not a third row shape');
  assert.match(card, /class="hsact"/, 'the actions come last, on their own line');
  assert.match(card, /Open in Maps/, 'every hotspot can be opened in maps');
  assert.match(card, /favLink\(/, 'and saved, exactly like the quick outing');
  // A hotspot list must NOT carry the SPECIES card's container classes.
  //
  // This is the bug that put the medium hotspot card's sub-header back in
  // column 2: these lists were `class="obs big xl dest"`, and cards-species.js
  // scopes its geometry as `.obs.xl > li > .meta` and `.obs.big .name` — three
  // classes, which beats the hotspot card's own two-class `.hscard-md > .meta`
  // and `.hscard-md > .name`. So `display: contents` lost to `display: flex`,
  // the three-column grid lost to the species grid, and the sub-header stopped
  // spanning. Nothing in the hotspot module was wrong; it was simply outranked.
  //
  // The rule is stated as what it MEANS rather than as a list of banned class
  // names for one section: whichever family a list belongs to, it may not
  // declare itself the other one.
  const SPECIES_CONTAINER = /\b(xl|card-md|big)\b/;
  for (const id of ['destResults', 'excResults', 'tripResults', 'quickResults', 'targetResults']) {
    const m = new RegExp('<ul id="' + id + '"[^>]*class="([^"]*)"').exec(HTML);
    assert.ok(m, id + ' must exist');
    assert.ok(!SPECIES_CONTAINER.test(m[1]),
      id + ' holds hotspot cards, so it must not carry a species-card container '
      + 'class (' + m[1] + ') — those rules outrank .hscard-md and replace its layout');
  }
  // And the reason the clash is real: prove the species sheet claims those
  // selectors, so this guard cannot be satisfied by renaming a class.
  assert.match(CARDS_SPECIES, /\.obs\.xl > li > \.meta/,
    'the species sheet really does own .obs.xl > li > .meta');
  assert.match(CARDS_HOTSPOT, /\.hscard-md > \.meta \{/,
    'and the hotspot sheet really does own .hscard-md > .meta');
});

// This is the bug the shared card exists to prevent, pinned directly: the trip
// planner appended rows carrying photoSlot() placeholders and never asked for
// them to be filled, so every species icon stayed a grey box. Nothing about the
// markup was wrong — the hydration CALL was simply missing, which no markup
// assertion could ever see.
test('a section that renders photo slots must also hydrate them', () => {
  for (const [name, from, to] of [
    ['the trip planner', 'function renderRoute(', 'function loadTripPlanner('],
    ['top destinations', 'function renderDestinations(', 'function renderRoute('],
    ['closest spots', 'function renderTargetPlaces(', 'function refresh()'],
    ['latest ticks', 'function renderLastNew(', 'function loadAbaAlert('],
    ["today's rarities", 'function refresh()', 'function buildClosestSpots('],
  ]) {
    const src = HTML.slice(HTML.indexOf(from), HTML.indexOf(to));
    assert.match(src, /hydratePhotos\(/,
      name + ' renders photo slots, so it must hydrate them or they stay grey squares');
  }
});

// The sub-header is what you decide on, so it must not be a run-on of names.
test('latest ticks: names are a list sorted newest first, not a run-on', () => {
  const src = HTML.slice(HTML.indexOf('function renderLastNew('),
    HTML.indexOf('function loadAbaAlert('));
  assert.doesNotMatch(src, /birders[\s\S]{0,80}\.join\(' · '\)/,
    'a paragraph of "Name (#4) · Name (#7) · …" is unreadable on a phone');
  assert.match(src, /b\.date \|\| ''\)\.localeCompare\(String\(a\.date/,
    'sorted most recent first — yesterday’s tick says more than the highest rank');
  assert.match(src, /Who added it[\s\S]{0,80}class="wholine"|class="wholine"[\s\S]{0,80}Who added it/,
    'the birders render as ONE labelled sentence — the table was the tallest '
    + 'thing on the card and the least scanned');
  assert.match(src, /checklistDetails\([\s\S]{0,900}'recent checklist'/,
    'and the checklists carrying the bird follow as their own shared-card '
    + 'list, through the helper the other three sections use');
});

// The expander mirrors report._rarity_reports_cell: a section whose rows ARE the
// rarities cannot be truncated (that drops chase targets), but 40 checklist
// links per row is what made it the largest section in the report.
test('Last 7-Days rarities can expand the full checklist list', () => {
  const src = HTML.slice(HTML.indexOf('function rarityChecklistDetails('),
    HTML.indexOf('function loadQuickOuting('));
  assert.match(src, /checklistDetails\(/,
    'the full list is behind an expander — the SHARED one, so this section '
    + 'cannot drift from the three others that show the same thing');
  assert.match(HTML, /function checklistDetails\([\s\S]{0,900}<details class="ckall">/,
    'and that helper really is the <details> wrapper');
  assert.match(src, /' — show every report'/, 'with a summary that states the total');
  // A <details> holding one row is a control that does nothing.
  assert.match(src, /< 2|<= 1|length < 2/,
    'a single checklist needs no expander — that is a control that does nothing');
});

// Wikipedia REST stub: "Ruff" is a disambiguation page (the real behaviour that
// caused the bug); "Ruff (bird)" is the article we actually want.
const wiki = (url) => {
  if (!/wikipedia\.org/.test(url)) return null;
  if (/summary\/Ruff_\(bird\)/.test(url)) {
    return { type: 'standard', title: 'Ruff (bird)', extract: 'The ruff is a medium-sized wader.',
      thumbnail: { source: 'https://upload.wikimedia.org/x/330px-Ruff.jpg' } };
  }
  if (/summary\/Ruff/.test(url)) return { type: 'disambiguation', title: 'Ruff', extract: 'Ruff may refer to:' };
  if (/summary\/Nonesuch/.test(url)) {
    return { type: 'standard', title: 'Nonesuch', extract: 'A bird that later gained an article.',
      thumbnail: { source: 'https://upload.wikimedia.org/x/330px-None.jpg' } };
  }
  return null;
};

test('a cached disambiguation blurb is discarded, not served forever', async () => {
  // "Ruff may refer to:" shipped to devices before the write-side guard
  // existed. A cache is read BEFORE it is written, so a fix that only guards
  // the write path never reaches the installs that actually have the bug.
  const poisoned = JSON.stringify({ Ruff: { extract: 'Ruff may refer to: a collar', title: 'Ruff' } });
  const app = await boot({ storage: { ebird_birdinfo_v2: poisoned }, fetch: wiki });
  const A = app.window.__app;
  assert.equal(A.usableInfo({ extract: 'Ruff may refer to: a collar' }), null, 'rejected on read');
  assert.ok(A.usableInfo({ extract: 'The ruff is a medium-sized wader.' }), 'a real blurb still passes');
  const got = await A.birdInfo('Ruff');
  assert.match(got.extract, /medium-sized wader/, 'falls through to the real article instead of the stub');
  const now = JSON.parse(app.window.localStorage.getItem('ebird_birdinfo_v2') || '{}');
  assert.ok(!(now.Ruff && /may refer to/.test(now.Ruff.extract)),
    'and the poisoned entry is gone, so it cannot be served again');
});

test('the caches that could hold a bad value are versioned past it', async () => {
  // Read-side validation fixes blurbs, but a cached EMPTY photo string is
  // indistinguishable from a legitimate miss, so those installs need the key
  // to move instead.
  assert.match(HTML, /PHOTO_KEY = 'ebird_photos_v2'/, 'photo cache versioned past the bad misses');
  assert.match(HTML, /INFO_KEY = 'ebird_birdinfo_v2'/, 'blurb cache versioned past the disambiguations');
});

test('a photo miss expires so a bird can gain an article later', async () => {
  const fresh = await boot({ fetch: wiki, storage: {
    ebird_photos_v2: JSON.stringify({ Nonesuch: '' }),
    ebird_photos_neg_v1: JSON.stringify({ Nonesuch: Date.now() }),
  } });
  assert.equal(await fresh.window.__app.photoLookup('Nonesuch'), '',
    'a recent miss is answered from cache rather than refetched');
  // An OLD miss is retried rather than believed forever — a permanent '' is the
  // one cache entry that can never correct itself.
  const stale = await boot({ fetch: wiki, storage: {
    ebird_photos_v2: JSON.stringify({ Nonesuch: '' }),
    ebird_photos_neg_v1: JSON.stringify({ Nonesuch: Date.now() - 40 * 86400000 }),
  } });
  assert.match(await stale.window.__app.photoLookup('Nonesuch'), /330px-None\.jpg/,
    'an expired miss is retried, and the bird gets its photo');
});

test('GBIF states the window it searched instead of implying the bird vanished', async () => {
  const app = await boot();
  const A = app.window.__app;
  // "1,085 records, 1972-2023" reads as "not seen since 2023". If the DATA
  // stops in 2024, that is a different claim, and the card must not leave the
  // reader to guess which one it is making.
  const s = A.histLine({ records: 1085, years: 36, first: 1972, last: 2023, edge: 2024,
    wide: 22409, states: 50, topState: 'California', topPct: 28 }, 'Washington');
  assert.match(s, /Searched 2024 and earlier/, 'names the last year the snapshot covers');
  assert.match(s, /not counted/, 'and says what that excludes');
  const noEdge = A.histLine({ records: 5, years: 2, first: 2001, last: 2003 }, 'Washington');
  assert.doesNotMatch(noEdge, /Searched/, 'no measured edge means no claim about one');
});

// One shape, one definition. `.sppl` (a hotspot's bird list, a convoy stop's
// birds) used to hand-roll its own flex row and 34px thumb -- which was
// `.card-sm` at a second, slightly different size. That is exactly the drift
// the three-template block exists to prevent: two definitions of one shape
// means a fix to the card lands in one list and not the other.
test('the small species list uses the shared card template, not its own copy', () => {
  // There must be no hand-rolled `.sppl` list markup left in the app at all:
  // the one builder delegates to www/cards-species.js. Two literals is how the
  // drift started — hotspotBirdList hand-rolled a second, 34px copy of what
  // speciesListHtml already built at 46px.
  const uls = HTML.match(/<ul class="obs[^"]*\bsppl\b[^"]*"/g) || [];
  assert.equal(uls.length, 0,
    'no section may hand-roll a .sppl list; found ' + uls.length);
  assert.match(HTML, /SpeciesCards\.list\('small'/,
    'the list wrapper comes from the card file, which owns the size class');
  // …and it must be used by more than one section, or "shared" means nothing.
  const calls = (HTML.match(/speciesListHtml\(/g) || []).length;
  assert.ok(calls >= 3, 'the one builder must serve several sections; found ' + calls);
  // …and must NOT redeclare the parts the template owns.
  const rules = HTML.match(/\.obs\.sppl[^{]*\{[^}]*\}/g) || [];
  for (const r of rules) {
    for (const owned of ['display:', 'font-size:', 'width:', 'height:']) {
      assert.ok(!r.includes(owned),
        `.sppl must not redeclare "${owned}" -- .card-sm owns the shape. Found: ${r}`);
    }
  }
  assert.match(CARDS_SPECIES, /\.obs\.card-sm \.thumb \{[^}]*width:\s*calc\(46px \* var\(--s\)\)/,
    'www/cards-species.js is the one place the small icon size is set');
});

// A species row is only scannable if the name is a real heading, not the 15px
// caption `.sppl` used to render. Adopting `.card-sm` also means these names
// inherit `.obs .name`, so they get the same weight and colour as every other
// species name in the app.
test('small species rows render their name through .name, not a bare span', () => {
  assert.match(CARDS_SPECIES.slice(CARDS_SPECIES.indexOf('var SMALL')),
    /<div class="name">/,
    'the small template wraps its row in .name so the shared card styles apply');
  assert.match(CARDS_SPECIES.slice(CARDS_SPECIES.indexOf('var SMALL')),
    /class="ntext"/,
    'and puts the text in .ntext so a long name wraps as one block');
  assert.ok(!/class="bn"/.test(CARDS_SPECIES), 'no old unstyled .bn span');
  // The hotspot sections feed it through the split, so they cannot re-hand-roll.
  const split = HTML.slice(HTML.indexOf('function splitHotspotBirds('),
    HTML.indexOf('var _hotspotCache'));
  assert.match(split, /comName:/, 'the split hands speciesListHtml its own record shape');
  assert.ok(!/<li>/.test(split), 'and builds no markup of its own');
});

// getAnchors() resolves WHERE the coordinates come from; logic.js decides which
// anchors exist and in what order, because that ordering is the tie-break rule
// report.py's section_closest_spots relies on. Rebuilding the list in the app is
// how the two silently diverge.
test('the app does not rebuild the anchor list that logic.js already defines', () => {
  const i = HTML.indexOf('function getAnchors(');
  assert.ok(i > -1, 'getAnchors must exist');
  const body = HTML.slice(i, HTML.indexOf('\n      }', i));
  assert.match(body, /anchorsFor\(/,
    'getAnchors must delegate to BirdLogic.anchorsFor, the shared definition');
  assert.ok(!/name:\s*'home'/.test(body) && !/name:\s*'here'/.test(body),
    'getAnchors must not hand-roll the anchor objects -- that is a second '
    + 'definition of the anchor ordering the report ranks on');
});
// The leaderboard cascade lane resolved species names ONLY from the merged
// observation feeds, which are rarity-biased (notable + hotspot recent). But a
// cascade is a bird several top-100 birders just added to a YEAR list, which
// skews to regular migrants. Pectoral Sandpiper -- code `pecsan`, in the WA
// species list, in no notable feed -- rendered "could not resolve this name to
// an eBird species code", losing its link, its photo and its where-to-go feed.
test('a cascade species absent from every observation feed still resolves via the region list', async () => {
  const app = await boot({
    fetch: (u) => {
      if (/product\/spplist\/US-WA/.test(u)) return ['pecsan'];
      if (/ref\/taxonomy\/ebird/.test(u) && /pecsan/.test(u)) {
        return [{ speciesCode: 'pecsan', comName: 'Pectoral Sandpiper' }];
      }
      if (/data\/obs\/US-WA\/recent\/pecsan/.test(u)) {
        return [{ obsDt: '2026-07-25 08:00', locName: 'Montlake Fill', locId: 'L1', subId: 'S1' }];
      }
      return null;
    },
  });
  // merged is EMPTY: this is precisely the case the old resolver gave up on.
  const out = await app.window.__app.cascadeSpots(
    [{ species: 'Pectoral Sandpiper', birders: [{ rank: 1, name: 'A' }], latest: '2026-07-25' }], []);
  assert.equal(out[0].code, 'pecsan',
    'a bird in the region species list must resolve even when no local feed mentions it');
  assert.ok(out[0].recent && out[0].recent.length,
    'resolving the code must also buy the species-scoped feed that says where to stand');
});

// The unresolved message used to blame the NAME ("could not resolve this name")
// when the real cause was the dictionary. Now that the region list is consulted,
// the only honest remaining cause is absence from that list. Matched on the full
// rendered sentence, so the comment above may keep quoting the old wording.
test('the unresolved-species message names the real cause, not the name', () => {
  assert.ok(!/resolve this name to an eBird species code/.test(HTML),
    'that message blamed the species name for a lookup that never consulted the region list');
  assert.ok(/Not in this region.s species list/.test(HTML),
    'an unlinked cascade must say the bird is absent from the region list');
});

// Guards the two-tier order itself: the free tier (already-fetched observations)
// must still be tried first, so the common case costs no extra call.
test('cascade code resolution tries the already-fetched feeds before the region list', async () => {
  const app = await boot({
    fetch: (u) => {
      if (/product\/spplist/.test(u)) throw new Error('region list must not be fetched when merged answers');
      if (/data\/obs\/US-WA\/recent\/pecsan/.test(u)) return [];
      return null;
    },
  });
  const out = await app.window.__app.cascadeSpots(
    [{ species: 'Pectoral Sandpiper', birders: [], latest: '2026-07-25' }],
    [{ comName: 'Pectoral Sandpiper', speciesCode: 'pecsan' }]);
  assert.equal(out[0].code, 'pecsan');
  assert.equal(app.state.fetches.filter((f) => /spplist/.test(f)).length, 0,
    'the region index is a fallback, not the first stop');
});


// ---------------------------------------------------------------------------
// F10 - the section navbar's chrome crowded out the thing it was labelling.
// Reported from the device: the region <select> rendered its widest option
// ("Waikoloa / Big Island") inline and the back button spelled out
// "< Contents", leaving the section name - the only element a reader needs -
// with almost nothing. Both controls are now icon-sized; the title takes the
// rest. These guard the SHAPE, because jsdom has no layout engine and cannot
// measure the result.
// ---------------------------------------------------------------------------

test('F10: the navbar back control is icon-only but keeps its accessible name', async () => {
  const app = await boot();
  const back = app.$('navBack');
  assert.ok(back, 'the navbar still has a back control');
  assert.equal(back.getAttribute('aria-label'), 'Back to Contents',
    'an icon-only button carries its words in aria-label, which is the contract the label tests read');
  assert.ok(!/contents/i.test(back.textContent),
    'the words must not also be painted: spelling out "Contents" is the width this fix reclaims');
  assert.ok(back.textContent.trim().length <= 2,
    'what is left is a single chevron glyph, not a text label');

  app.open(/Settings/);
  assert.equal(app.$('navbar').hidden, false);
  app.click(back);
  assert.equal(app.$('menuPanel').hidden, false,
    'shrinking the control must not unwire it - it still returns to Contents');
});

test('F10: the region picker is an icon-sized overlay, not an inline-sized select', async () => {
  const app = await boot();
  const sel = app.$('navRegion');
  assert.ok(sel, 'the navbar still offers the region picker');
  assert.equal(sel.tagName, 'SELECT',
    'it stays a native select so iOS opens its wheel picker with the full region labels');
  const wrap = sel.closest('.navregion');
  assert.ok(wrap, 'the select is wrapped in a fixed-size box that supplies the icon');
  assert.ok(wrap.querySelector('.navregionicon'),
    'the wrapper paints a glyph, which is what the reader sees instead of "Waikoloa / Big Island"');

  const css = HTML.slice(HTML.indexOf('<style'), HTML.indexOf('</style>'));
  const rule = (sel2) => {
    const m = css.match(new RegExp('(^|[\\s}])' + sel2.replace(/[.#*]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
    return m ? m[2] : '';
  };
  assert.match(rule('#navRegion'), /opacity:\s*0/,
    'the select is laid transparently over the glyph - opacity:0 still receives taps, unlike visibility:hidden');
  assert.match(rule('#navRegion'), /position:\s*absolute/,
    'absolute positioning is what stops the select claiming width from the title');
  assert.match(rule('#navTitle'), /flex:\s*1 1 auto/,
    'the title is the element that should absorb the freed space');
  assert.match(rule('#navTitle'), /min-width:\s*0/,
    'without min-width:0 a flex item refuses to shrink below its content and the ellipsis never engages');
});

test('F10: the navbar controls scale with the text-size setting', () => {
  const css = HTML.slice(HTML.indexOf('<style'), HTML.indexOf('</style>'));
  ['#navbar #navBack', '.navregion'].forEach((s) => {
    const m = css.match(new RegExp('(^|[\\s}])' + s.replace(/[.#*]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
    assert.ok(m, 'expected a rule for ' + s);
    assert.match(m[2], /width:\s*calc\(\s*\d+px\s*\*\s*var\(--s\)\s*\)/,
      s + ' must scale its box with --s, or it clips at the size a low-vision reader picks');
    assert.match(m[2], /height:\s*calc\(\s*\d+px\s*\*\s*var\(--s\)\s*\)/,
      s + ' must scale its height too');
  });
});

// ---------------------------------------------------------------------------
// F13 - guided eBird key acquisition. Without a key the app cannot make one
// call, and the old Settings copy was an untappable URL in a <code> block.
// ---------------------------------------------------------------------------

test('F13: with no key stored the Contents menu leads with a way to get one', async () => {
  const app = await boot({ key: null });
  const banner = app.$('keyBanner');
  assert.ok(banner, 'the Contents menu has a place to say the app is unusable');
  assert.equal(banner.hidden, false, 'with no key the banner shows');
  const btn = app.$('keyBannerBtn');
  assert.ok(btn, 'and it carries the button that fixes it, not just a complaint');
  app.click(btn);
  assert.equal(app.$('settingsPanel').hidden, false,
    'the banner routes to Settings, where the field is');
});

test('F13: a stored key hides the banner', async () => {
  const app = await boot();
  assert.equal(app.$('keyBanner').hidden, true,
    'once a key is stored the banner is noise and must get out of the way');
});

test('F13: Settings offers get / paste / test beside the key field', async () => {
  const app = await boot({ key: null });
  ['keyGetBtn', 'keyPasteBtn', 'keyTestBtn'].forEach((id) => {
    assert.ok(app.$(id), id + ' must exist: a bare password box is where the old dead end was');
  });
  assert.ok(app.$('keyStatus'), 'and somewhere to report what happened');
  assert.ok(/ebird\.org\/api\/keygen/.test(HTML),
    'the key request form is the destination and must be named in the app, not looked up');
  assert.equal(app.window.__app.EBIRD_KEYGEN_URL, 'https://ebird.org/api/keygen');
});

test('F13: an obviously wrong key is named and refused, never silently saved', async () => {
  const app = await boot({ key: null });
  const wrong = app.window.__app.keyLooksWrong;
  assert.match(wrong('https://ebird.org/api/keygen'), /URL/,
    'pasting the page URL instead of the key is the most likely mistake');
  assert.match(wrong('abc def'), /space/, 'a copied line of surrounding text carries whitespace');
  assert.match(wrong('ab'), /characters/, 'a truncated copy is short');
  assert.match(wrong('abcd-efgh-ijkl'), /punctuation/, 'eBird keys are alphanumeric');
  assert.equal(wrong('a1b2c3d4e5f6'), '', 'a real 12-character key passes');

  app.open(/Settings/);
  app.$('apiKey').value = 'https://ebird.org/api/keygen';
  app.click(app.$('saveBtn'));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!app.window.localStorage.getItem('ebird_api_key'),
    'a malformed key must not reach storage: every section would then read empty, which looks like a broken app rather than a typo');
  assert.match(app.$('keyStatus').textContent, /Not saved/,
    'and the refusal has to say so, at the moment the user is looking at the field');
});

test('F13: testing a key asks eBird and reports what it said', async () => {
  const app = await boot({ key: null, fetch: (u) => (/ref\/region\/info/.test(u) ? { code: 'US-WA' } : null) });
  const r = await app.window.__app.testApiKey('a1b2c3d4e5f6');
  assert.equal(r.ok, true, 'a key eBird accepts is reported as working');
  assert.ok(app.state.fetches.some((f) => /ref\/region\/info/.test(f)),
    'the check is a real call - claiming a key works without asking is how the old dead end felt');
  const empty = await app.window.__app.testApiKey('');
  assert.equal(empty.ok, false, 'nothing to test is not a pass');
});


// ---------------------------------------------------------------------------
// F9 - the county feeds collapse to ONE observation per species, so every
// "closest spot" ranking was ranking a sample. Measured on live WA data the day
// this shipped: 41 unseen species went from 66 distinct locations to 945, and
// Common Loon alone went from 1 location to 49.
// ---------------------------------------------------------------------------
test('F9: getChase makes a SECOND wave of per-species calls', async () => {
  const need = (obsId, code, locId) => ({
    obsId, speciesCode: code, comName: code, locId, locName: locId,
    lat: 47.6, lng: -122.3, obsDt: '2026-07-30 08:00', subId: 'S' + obsId
  });
  const app = await boot({
    fetch: (u) => {
      if (/\/recent\/notable/.test(u)) return [];
      // A per-species call is data/obs/<region>/recent/<code>; the phase-1
      // county feeds are .../recent and .../recent/notable.
      const sp = u.match(/data\/obs\/[^/]+\/recent\/([a-z0-9]+)\?/);
      if (sp) return [need('X' + sp[1], sp[1], 'L-far'), need('Y' + sp[1], sp[1], 'L-near')];
      if (/data\/obs\//.test(u)) return [need('A', 'comloo', 'L-one')];
      return null;
    }
  });
  const first = await app.window.__app.getChase();
  // getChase now resolves on PHASE 1 so the screen can come up in seconds
  // rather than minutes; phase 2 fills it in behind. A test that wants the
  // complete answer waits for it explicitly.
  assert.ok(first.cv, 'phase 1 alone already produces a usable view');
  const res = await app.window.__app.chasePhase2();
  const sp = app.state.fetches.filter((u) => /data\/obs\/US-WA\/recent\/[a-z]/.test(u));
  assert.ok(sp.length > 0,
    'phase 2 ran - without it a needed bird contributes exactly one location ' +
    'however many places reported it');
  assert.ok(sp.every((u) => /includeProvisional=true/.test(u)),
    'phase 2 asks for provisional records, like the report does');
  assert.deepEqual(res.speciesCodes, res.speciesCodes.slice().sort(),
    'the code list is sorted - it IS the fetch plan, so it cannot depend on ' +
    'iteration order or the two languages could not be proven equal');
  assert.ok(res.speciesCodes.length <= app.window.BirdLogic.SPECIES_FEED_MAX,
    'and capped, so a big unseen list cannot become a 200-call run');

  // The payoff: the needed bird is now known from more than one place.
  const locs = new Set(res.cv.unseenAll.filter((r) => r.code === 'comloo').map((r) => r.locId));
  assert.ok(locs.size > 1,
    'a needed bird now contributes MORE than one location (' + locs.size + ')');
  app.window.close();
});

test('F9: phase 2 is batched, not 41 simultaneous requests', async () => {
  // Measured at 41 unseen species on a normal Washington day. The report can
  // throttle to 1.2s/call because it is an hourly job; a phone firing all 41
  // at once earns a 429 and renders an empty section, which reads as a broken
  // app. Batching is what makes the correctness fix safe to ship on device.
  const CODES = ['comloo', 'amepip', 'blkswi', 'arcter', 'casfin', 'comnig',
    'btywar', 'bkbwoo', 'comter', 'commur'];
  const need = (obsId, code, locId) => ({
    obsId, speciesCode: code, comName: code, locId, locName: locId,
    lat: 47.6, lng: -122.3, obsDt: '2026-07-30 08:00', subId: 'S' + obsId
  });
  const app = await boot({
    fetch: (u) => {
      if (/\/recent\/notable/.test(u)) return [];
      if (/data\/obs\//.test(u)) return CODES.map((c, i) => need('A' + i, c, 'L' + i));
      return null;
    }
  });
  const w = app.window;
  const orig = w.fetch;
  let inFlight = 0, peak = 0;
  // A REAL async delay, not a resolved promise: batches are chained through
  // microtasks, so a synchronous counter would see every call at once no
  // matter how the fetching is scheduled and the guard would prove nothing.
  w.fetch = function (u) {
    if (/data\/obs\/US-WA\/recent\/[a-z]/.test(String(u))) {
      inFlight++; peak = Math.max(peak, inFlight);
      return new Promise((res) => setTimeout(() => {
        inFlight--;
        res({ ok: true, status: 200, json: () => Promise.resolve([]), text: () => Promise.resolve('[]') });
      }, 5));
    }
    return orig(u);
  };
  w.__app.clearChaseCache();
  const res = await w.__app.getChase().then(function () { return w.__app.chasePhase2(); });
  assert.ok(res.speciesCodes.length > 6,
    'the fixture must produce more needs than one batch (' + res.speciesCodes.length + ')');
  assert.ok(peak > 0, 'phase 2 actually ran');
  assert.ok(peak <= 6,
    'no more than 6 species calls are ever in flight at once (peak was ' + peak + ')');
  w.close();
});

test('F9: concurrent callers share one wave, not two', async () => {
  // The cache is only written at the END, so two sections opening together used
  // to run two complete waves. Phase 2 turned that from wasteful into harmful:
  // a 41-call run became 82, against a ~50/min throttle.
  const app = await boot({
    fetch: (u) => {
      if (/\/recent\/notable/.test(u)) return [];
      if (/data\/obs\//.test(u)) return [{
        obsId: 'A', speciesCode: 'comloo', comName: 'Common Loon', locId: 'L1',
        locName: 'One', lat: 47.6, lng: -122.3, obsDt: '2026-07-30 08:00', subId: 'S1'
      }];
      return null;
    }
  });
  const w = app.window;
  w.__app.clearChaseCache();
  const before = app.state.fetches.length;
  const [a, b] = await Promise.all([w.__app.getChase(), w.__app.getChase()]);
  assert.equal(a, b, 'both callers get the SAME result object, not two waves');
  // Phase 2 is detached now, so wait for it before counting its calls.
  await w.__app.chasePhase2();
  const n = app.state.fetches.slice(before).filter((u) => /data\/obs\/US-WA\/recent\/comloo/.test(u)).length;
  assert.equal(n, 1, 'the species feed is fetched once, not once per caller');
  w.close();
});

test('F9: phase 2 cannot change what phase 1 already found', async () => {
  // Merge order decides which row becomes the base row for a duplicated obsId.
  // Phase 2 is appended, so this must hold or the second pass would silently
  // restate observations the report already had.
  const A = { obsId: 'A', speciesCode: 'comloo', comName: 'Common Loon',
    locId: 'L1', locName: 'One', lat: 47.5, lng: -122.3,
    obsDt: '2026-07-30 08:00', subId: 'S1' };
  const app = await boot();
  const BL = app.window.BirdLogic;
  const wa = BL.profileFor('wa');
  const rows = { 'king-recent.json': [A] };
  const before = BL.mergeFromFiles(wa, rows);
  const after = BL.mergeFromFiles(wa,
    Object.assign({ 'sp-comloo.json': [A, Object.assign({}, A, { obsId: 'B', locId: 'L2' })] }, rows),
    ['comloo']);
  const a0 = after.find((r) => r.obsId === 'A');
  ['kind', 'code', 'loc', 'locId', 'lat', 'lon', 'dateStr', 'subId'].forEach((f) => {
    assert.deepEqual(a0[f], before[0][f], 'phase-1 row field "' + f + '" is untouched');
  });
  assert.equal(after.length, before.length + 1, 'phase 2 only ADDS');
  app.window.close();
});

// --- Birdiest checklists: name the birds, do not just count them -----------
// "4 unseen birds on this list" is a number you cannot act on. A 90-species
// checklist is interesting for the four names it holds, so the section shows
// them — unseen expanded because they are the reason to care, seen collapsed
// because they are context. Same rule, and the same markup, as every hotspot
// card, so the two cannot drift.
test('birdiest checklists name the unseen birds and collapse the seen ones', async () => {
  const app = await boot();
  const A = app.window.__app;
  const doc = app.window.document;
  const perReport = A.getReportSeen();
  const seenCode = Object.keys(perReport)[0];
  assert.ok(seenCode, 'fixture assumption: the report has birds on its year list');
  // A code no report counts as seen, so it must land in the unseen half.
  const targetCode = 'zzztest1';
  assert.ok(!perReport[targetCode], 'the target must really be unseen');

  const slot = doc.createElement('div');
  slot.className = 'cklneed';
  A.renderChecklistSplit(slot, [seenCode, targetCode], {
    nameByCode: { [seenCode]: 'Already Had It', [targetCode]: 'Zzz Test Bird' },
    parentOf: {}
  });

  const unseen = slot.querySelector('.hsunseen');
  const seen = slot.querySelector('.hsseen');
  assert.ok(unseen, 'the unseen birds are rendered');
  assert.ok(seen, 'the seen birds are rendered too');
  assert.equal(seen.tagName, 'DETAILS', 'seen birds collapse');
  assert.equal(unseen.tagName, 'DIV', 'unseen birds do NOT collapse');
  assert.ok(!seen.open, 'and the collapsed half starts shut');

  assert.match(unseen.textContent, /Zzz Test Bird/,
    'the unseen bird is NAMED, not counted');
  assert.ok(!/Zzz Test Bird/.test(seen.textContent),
    'and it is not also listed as seen');
  assert.match(seen.querySelector('summary').textContent, /already seen/,
    'the count lives on the summary, the only text readable while it is shut');
  assert.match(unseen.textContent, /1 unseen bird on this list/,
    'the unseen label still carries the count');
  assert.ok(slot.className.includes('hit'),
    'a list holding a target is marked as one');

  // The old renderer printed a bare count and nothing else.
  assert.ok(!/^\s*\S*\s*1 unseen birds? on this list\s*$/.test(slot.textContent),
    'the bare-count badge is gone');
  app.window.close();
});

test('birdiest checklists resolve every name in ONE taxonomy pass', async () => {
  // 25 checklists sharing ~300 distinct species were 25 taxonomy calls for the
  // same answer. The union is resolved once. This guard counts the requests.
  const calls = [];
  const app = await boot({
    fetch: (u) => {
      calls.push(u);
      if (/product\/checklist\/view/.test(u)) {
        const sub = u.split('/').pop();
        return { obs: [{ speciesCode: 'aaa' + sub }, { speciesCode: 'shared1' }] };
      }
      if (/ref\/taxonomy/.test(u)) {
        const codes = decodeURIComponent(/species=([^&]*)/.exec(u)[1]).split(',');
        return codes.map((c) => ({ speciesCode: c, comName: 'Name ' + c }));
      }
      return null;
    }
  });
  const A = app.window.__app;
  const doc = app.window.document;
  const root = doc.createElement('ul');
  ['S1', 'S2', 'S3'].forEach((s) => {
    const li = doc.createElement('li');
    li.innerHTML = '<div class="cklneed" data-sub="' + s + '"></div>';
    root.appendChild(li);
  });
  await A.markBirdiestUnseen(root);

  const tax = calls.filter((u) => /ref\/taxonomy/.test(u));
  const chk = calls.filter((u) => /product\/checklist\/view/.test(u));
  assert.equal(chk.length, 3, 'one read per checklist — eBird has no bulk endpoint');
  assert.equal(tax.length, 1,
    `names resolve in one pass over the union, not one per checklist (got ${tax.length})`);
  const asked = decodeURIComponent(/species=([^&]*)/.exec(tax[0])[1]).split(',').sort();
  assert.deepEqual(asked.join(','), 'aaaS1,aaaS2,aaaS3,shared1',
    'and the union is de-duplicated before it is asked for');

  // Every row got its birds, not just the first.
  const filled = [...root.querySelectorAll('.cklneed')]
    .filter((s) => s.querySelector('.hsunseen'));
  assert.equal(filled.length, 3, 'every checklist row is filled in');
  app.window.close();
});
// --- The sideways drag: the element that actually did it -------------------
// Reported three times and "fixed" twice blind, because every probe looked in
// the wrong place: this suite has no layout engine, the in-app reporter
// scanned `.panel *`, and the containment fix was `.panel { overflow-x: clip }`
// — while the device screenshot showed the NAVBAR panning, outside every
// panel. A real-browser sweep (assets/audit-overflow.js) finally named it:
// `.cklrows li.lblrow > .when`, +83px past a 375px viewport at text scale
// 1.75, in Today's rarity reports.
//
// The clip rules stay, but they are containment, not the fix — and they are
// why this took so long: `overflow-x: clip` clamps documentElement.scrollWidth
// to clientWidth, so every document-level measurement read clean while an
// element stuck out 83px.
test('a panel clips sideways overflow WITHOUT becoming a scroll container', () => {
  const css = HTML.slice(HTML.indexOf('<style'), HTML.indexOf('</style>'));
  const rule = /\.panel\s*\{[^}]*overflow-x:\s*clip[^}]*\}/.exec(css);
  assert.ok(rule, 'panels declare overflow-x: clip');
  // `hidden` would force overflow-y to auto and give every section its own
  // scrollbar. `clip` is the ONLY value that may pair with visible.
  assert.ok(!/\.panel\s*\{[^}]*overflow-x:\s*hidden/.test(css),
    'and never overflow-x: hidden, which would nest a vertical scroller');
  assert.ok(!/\.panel\s*\{[^}]*overflow-y:\s*(auto|scroll|hidden)/.test(css),
    'nor pin overflow-y, for the same reason');
  // The root guard shipped in v1.0.34 stays — this is a second line, not a
  // replacement, and deleting the first would silently widen the document
  // again on any engine that ignores the panel rule.
  assert.match(css, /html\s*\{[^}]*overflow-x:\s*clip/,
    'the root clip is still there too');
});

// The measured cause, guarded at the CSS level because this suite cannot
// measure: a flexible grid/flex track defaults to `min-width: auto`, so it
// refuses to shrink below its content's min-content width. Pair that with
// `white-space: nowrap` and one unbroken line sets the width of the whole
// page. Every rule below is one of those escape hatches; the real proof is
// `node assets/audit-overflow.js <width> <scale>`, which drives a browser.
test('the flexible tracks that carry text can actually shrink', () => {
  const css = HTML.slice(HTML.indexOf('<style'), HTML.indexOf('</style>'));

  // The row that overflowed: LATEST / OBSERVER / WHERE in a checklist list.
  const lbl = /\.cklrows li\.lblrow\s*\{[^}]*\}/.exec(css);
  assert.ok(lbl, '.cklrows li.lblrow is styled');
  assert.match(lbl[0], /grid-template-columns:\s*auto minmax\(0,\s*1fr\)/,
    'its value column is minmax(0, 1fr), not a bare 1fr that cannot shrink');
  const lblCells = /\.cklrows li\.lblrow > \.who[^{]*\{[^}]*\}/.exec(css);
  assert.ok(lblCells, 'the labelled value cells are styled together');
  assert.match(lblCells[0], /min-width:\s*0/,
    'and they may shrink — `.when` inherits nowrap from the 3-column variant');
  assert.match(lblCells[0], /white-space:\s*normal/,
    'and that inherited nowrap is explicitly undone here');

  // The 3-column variant feeding the same content.
  assert.match(css, /\.cklrows li\s*\{[^}]*grid-template-columns:\s*auto auto minmax\(0,\s*1fr\)/,
    'the unlabelled checklist row has the same escape hatch');

  // A row of buttons must wrap rather than run off a narrow phone: a flex item
  // will not shrink below its widest label.
  assert.match(css, /\.row\s*\{[^}]*flex-wrap:\s*wrap/,
    'button rows wrap instead of overflowing at 320px');

  // Contents tiles: a grid track that is already minmax(0,1fr) still overflows
  // if the flex item inside it refuses to shrink.
  assert.match(css, /\.toc li\s*\{[^}]*min-width:\s*0/, 'contents tiles may shrink');
  assert.match(css, /\.tilelabel\s*\{[^}]*overflow-wrap:\s*anywhere/,
    'and a long tile label breaks rather than pushing the tile wide');

  // The photo yields before the touch targets do.
  assert.match(css, /\.nvrow > \.thumb\s*\{[^}]*flex:\s*0 1 auto/,
    'the needs-verification thumb shrinks so the ▲▼✕ column stays on screen');

  // Hostnames and alert ids are single unbreakable tokens.
  assert.match(css, /\.hint code\s*\{[^}]*overflow-wrap:\s*anywhere/,
    'a hostname in a hint breaks instead of widening the panel');
});

test('the overflow reporter can see OUTSIDE a panel', () => {
  const fn = HTML.slice(HTML.indexOf('function auditOverflow('),
    HTML.indexOf('function auditOverflow(') + 1600);
  // The whole reason three sweeps missed this: the navbar is not in a panel.
  assert.match(fn, /querySelectorAll\('body \*'\)/,
    'it sweeps the document, not just .panel * — the navbar is chrome, not content');
  assert.ok(!/querySelectorAll\('\.panel \*'\)/.test(fn),
    'and the old panel-only selector is gone, not merely supplemented');
  // An SVG className is an SVGAnimatedString, so a string test on it silently
  // never matches and every Leaflet overlay reads as a false positive.
  assert.match(fn, /getAttribute\('class'\)/,
    'the Leaflet skip reads the class ATTRIBUTE, which works for SVG too');
  assert.match(fn, /closest\('\.leaflet-container'\)/,
    'and also skips by ancestry, which catches the panes themselves');
});

// --- Take four: measure BOTH edges, and tell zoom apart from overflow ------
// Three fixes have missed the sideways drag. The last one missed for a reason
// worth encoding: every sweep asked only "does anything stick out past the
// RIGHT edge?", while the device screenshot showed the LEFT edge clipped. And
// no probe could tell a page that is too wide from a page that is merely
// zoomed — on iOS both pan the whole screen, sticky navbar included.
test('the drag probe measures both edges, not just the right one', async () => {
  const app = await boot();
  const A = app.window.__app;
  const doc = app.window.document;
  Object.defineProperty(doc.documentElement, 'clientWidth', { value: 390, configurable: true });

  const panel = doc.querySelector('.panel');
  const far = doc.createElement('div');
  panel.appendChild(far);
  far.getBoundingClientRect = () => ({ width: 60, height: 10, left: 400, right: 460, top: 0, bottom: 10 });
  const off = doc.createElement('div');
  off.id = 'hangsLeft';
  panel.appendChild(off);
  off.getBoundingClientRect = () => ({ width: 60, height: 10, left: -40, right: 20, top: 0, bottom: 10 });

  const ex = A.dragExtremes();
  assert.match(ex.right, /div/, 'it names the element past the right edge');
  assert.ok(ex.rightBy >= 69, `and by how much: got ${ex.rightBy}`);
  // The half nothing in this project has ever looked for.
  assert.match(ex.left, /#hangsLeft/, 'it also names the element hanging off the LEFT edge');
  assert.equal(ex.leftBy, -40, 'and reports how far past it sits');
  app.window.close();
});

test('the drag snapshot separates zoom from a page that is genuinely too wide', async () => {
  const app = await boot();
  const A = app.window.__app;
  const doc = app.window.document;
  Object.defineProperty(doc.documentElement, 'clientWidth', { value: 390, configurable: true });
  Object.defineProperty(doc.documentElement, 'scrollWidth', { value: 425, configurable: true });
  const snap = A.dragSnapshot();
  assert.equal(snap.clientW, 390, 'it records the layout viewport');
  assert.equal(snap.scrollW, 425, 'and the scrollable width, whose difference IS the overflow');
  assert.ok('scale' in snap && 'vvOffL' in snap && 'vvPageL' in snap,
    'and the visual-viewport figures, which are the only way to spot zoom');

  // The decisive numbers must ride along on every copied log, so a device
  // report is diagnosable even when the user never armed the probe.
  const ctx = A.dbgContext();
  assert.match(ctx, /geometry: layout 390 · scrollW 425/, 'the context line carries both widths');
  assert.match(ctx, /OVERFLOWS by 35px/, 'and states the verdict rather than leaving arithmetic to the reader');
  app.window.close();
});

test('the drag probe is wired to a real button', () => {
  assert.match(HTML, /<button id="dbgDrag"/, 'the debug bar has a Drag button');
  assert.match(HTML, /\$\('dbgDrag'\)\.addEventListener\('click', armDragProbe\)/,
    'and it is bound — an unbound control is how the species picker shipped dead');
});

// The clip rules stop the DOCUMENT scrolling sideways; they cannot stop iOS
// panning the visual viewport, which is what carries the sticky navbar along.
// touch-action is enforced by the compositor rather than by layout, so it holds
// whether or not anything overflows.
test('a finger may scroll the page down but not sideways — and may still pinch', () => {
  const css = HTML.slice(HTML.indexOf('<style'), HTML.indexOf('</style>'));
  // TAKE SIX, and it splits the problem in two because ONE touch-action value
  // cannot solve both halves. `manipulation` killed the double tap and
  // silently handed back `pan-x`, so the sideways drag returned within hours:
  // "side scrolling issue is back. screen drags to the right." The drag is
  // therefore handled here in CSS and the double tap in JS.
  assert.match(css, /body\s*\{\s*touch-action:\s*pan-y pinch-zoom/,
    'the page permits horizontal panning, and the screen drags sideways again');
  // PINCH-ZOOM MUST SURVIVE. Removing user-scalable=no (F142) is the single
  // most valuable accessibility fix in this file, and a value that forbade the
  // pinch would quietly take it back — `pan-y` ALONE does exactly that, which
  // is the bug this guard was originally written for.
  assert.match(css, /body\s*\{[^}]*pinch-zoom/,
    'body forbids the pinch, so a reader who zooms in cannot zoom back out');
  // ...and the double tap is suppressed in JS instead, NARROWLY: anything
  // tappable is exempt, or the five-tap debug gesture loses every other tap.
  const dt = HTML.slice(HTML.indexOf('function bindDoubleTapGuard'),
                        HTML.indexOf('// A ZOOM YOU CANNOT UNDO'));
  assert.ok(dt.length > 100, 'the double-tap guard is gone, so the gesture fires again');
  assert.match(dt, /passive:\s*false/,
    'preventDefault is ignored on a passive listener — this would look wired and do nothing');
  assert.match(dt, /isTappable\(e\.target\)/,
    'the guard fires on buttons and links too, which breaks the 5-tap debug gesture');
  // Maps are the one thing that must pan both ways. An ancestor's value is
  // INTERSECTED with the element's, so the map has to opt back out explicitly.
  assert.match(css, /\.leaflet-container\s*\{[^}]*touch-action:\s*none/,
    'and maps opt back out, because Leaflet drives its own gestures from JS');
  assert.ok(css.indexOf('body { touch-action: pan-y pinch-zoom; }')
            < css.indexOf('.leaflet-container { touch-action: none; }'),
    'with the map override after the body rule so it is not itself overridden');
  // ...and the way BACK, for a page already stuck zoomed: "the entire app is
  // zoomed some even after double clicking whitespace to unzoom". The reset
  // clamps the viewport to maximum-scale=1 and then RESTORES the original
  // content — leaving user-scalable=no in place would be the very thing F142
  // removed.
  assert.match(HTML, /id="zoomreset"/, 'there is no way back from a stuck zoom');
  const fn = HTML.slice(HTML.indexOf('function resetZoom'), HTML.indexOf('function bindZoomReset'));
  assert.match(fn, /maximum-scale=1\.0/, 'the reset does not actually clamp the scale');
  assert.match(fn, /setAttribute\('content', keep\)/,
    'the reset never restores the viewport, so pinch-zoom stays disabled afterwards');
});
test('Happening now paints from the notable feeds, not after 40 species calls', () => {
  // From the device log, and the numbers are the argument:
  //
  //   WAVE phase 1 done in 5.5s      (rarities ready in 4.3s, 3 of 6 feeds)
  //   WAVE phase 2 · 40 species feeds ... done in 221.3s
  //
  // ...and the screen sat on "Step 2 of 2 - 0 of 40 - paused, eBird rate
  // limit" for all of it. Reported as hitting a rate-limit stall the moment
  // the section was opened.
  //
  // Phase 2 fills in WHERE unseen birds are. The needs lane stopped asking
  // that when it became notable-only, and everything it now shows comes from
  // the three `notable` feeds that land in phase 1.
  const at = HTML.indexOf('function loadSurge');
  assert.ok(at > 0, 'loadSurge not found');
  const src = HTML.slice(at, HTML.indexOf('\n      function ', at + 1));
  assert.match(src, /getChaseRarity\(\)/,
    'Happening now still waits for the full wave, so it waits for phase 2');
  assert.ok(!/[^y]getChase\(\)/.test(src),
    'it also calls getChase() directly, which reinstates the wait');

  // The head start is only half of it: the section must be REPAINTED when the
  // full wave lands, or the crowd lane never gets the recent feeds.
  const early = HTML.indexOf('function onRarityEarly');
  const esrc = HTML.slice(early, HTML.indexOf('\n      function ', early + 1));
  assert.match(esrc, /'surgeBtn'/,
    'the section is never repainted when phase 2 completes, so its crowd lane '
    + 'stays empty on a partial view');

  // And the head start must keep the wave running underneath rather than
  // replacing it - otherwise the partial view becomes the permanent one.
  const gr = HTML.indexOf('function getChaseRarity');
  const gsrc = HTML.slice(gr, HTML.indexOf('\n      function ', gr + 1));
  assert.match(gsrc, /getChase\(force\)/,
    'the rarity head start no longer starts the full wave behind it');
});

test('showing a section reports any element wider than the screen', async () => {
  const app = await boot();
  const A = app.window.__app;
  const doc = app.window.document;
  const warned = [];
  app.window.console.warn = (...a) => warned.push(a.join(' '));
  // jsdom reports 0 for every rect, so the measurement is staged: a stub
  // element whose rect is genuinely past the right edge must be NAMED.
  const panel = doc.querySelector('.panel');
  const bad = doc.createElement('div');
  bad.id = 'tooWide';
  bad.className = 'wideThing';
  bad.textContent = 'a box that hangs off the edge';
  panel.appendChild(bad);
  Object.defineProperty(doc.documentElement, 'clientWidth', { value: 393, configurable: true });
  bad.getBoundingClientRect = () => ({ width: 600, height: 20, left: 0, right: 640, top: 0, bottom: 20 });

  A.auditOverflow('testPanel');
  await new Promise((r) => setTimeout(r, 50));

  const hit = warned.find((w) => /overflow/.test(w));
  assert.ok(hit, 'the overflow is reported at all');
  assert.match(hit, /#tooWide/, 'and the element is NAMED, not just counted');
  assert.match(hit, /247px past 393/, 'with how far past the edge it reaches');

  // One line per section per element: a per-frame log would flood the 800-line
  // debug buffer and push out the fetch trail that is the point of the panel.
  const before = warned.length;
  A.auditOverflow('testPanel');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(warned.length, before, 'and it is not repeated');
  app.window.close();
});

test('the overflow reporter ignores Leaflet, which overflows by design', async () => {
  const app = await boot();
  const A = app.window.__app;
  const doc = app.window.document;
  const warned = [];
  app.window.console.warn = (...a) => warned.push(a.join(' '));
  const tile = doc.createElement('img');
  tile.className = 'leaflet-tile leaflet-tile-loaded';
  doc.querySelector('.panel').appendChild(tile);
  Object.defineProperty(doc.documentElement, 'clientWidth', { value: 393, configurable: true });
  tile.getBoundingClientRect = () => ({ width: 256, height: 256, left: 500, right: 756, top: 0, bottom: 256 });
  A.auditOverflow('tilePanel');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(warned.filter((w) => /overflow/.test(w)).length, 0,
    'map tiles sit outside their clipped container on purpose and are never the cause');
  app.window.close();
});
// --- Today's rarity reports respects the chase radius -----------------------
// Reported from the device: the section was listing birds 60+ miles out beside
// one four miles from the house, in the one section whose entire job is "what
// can I go and see today". The radius already existed — report.py wrote it
// down once for Closest spots and called it "a reasonable chase" — it was just
// never applied here. Far reports are SORTED APART, not deleted: a rarity is
// still worth a longer drive on the right day, and this is the only section
// that lists today's.
test("today's rarities lead with what is inside the chase radius", async () => {
  const app = await boot();
  const A = app.window.__app;
  const doc = app.window.document;
  const R = A.CHASE_MAX_MI;
  assert.equal(R, BL.CONST.CHASE_MAX_MI,
    'the app reads the radius from the shared logic module, not its own copy');

  A.seedChase(A.getReportSlug(), {
    t: Date.now(), rarity: false,
    cv: {
      merged: [],
      notableToday: [
        { code: 'nearbird', name: 'Near Rarity', distMi: 4.2, dateStr: '2026-07-31 08:00',
          loc: 'Close Park', locId: 'L1', lat: 47.7, lon: -122.2, subId: 'S1', observer: 'A B' },
        { code: 'farbird', name: 'Far Rarity', distMi: R + 30, dateStr: '2026-07-31 07:00',
          loc: 'Distant Slough', locId: 'L2', lat: 48.5, lon: -122.9, subId: 'S2', observer: 'C D' },
      ],
    },
  });
  A.refresh();
  await new Promise((r) => setTimeout(r, 60));

  const out = doc.getElementById('results');
  const far = out.querySelector('details.farrare');
  assert.ok(far, 'the out-of-range reports are still there');
  assert.ok(!far.open, 'but collapsed - they are not what the section is for');
  assert.match(far.querySelector('summary').textContent, new RegExp(`1 more beyond ${R} mi`),
    'and the summary says how many and past what');
  assert.match(far.textContent, /Far Rarity/, 'the far bird lives inside the collapsed half');

  // The near bird must be OUTSIDE the <details>, or "filtering" just means
  // "everything moved one tap down".
  const nearHtml = out.innerHTML.slice(0, out.innerHTML.indexOf('farrare'));
  assert.match(nearHtml, /Near Rarity/, 'the near bird is listed directly');
  assert.ok(!/Far Rarity/.test(nearHtml), 'and the far one is not');

  assert.match(doc.getElementById('status').textContent,
    new RegExp(`1 rarity report within ${R} mi`),
    'the count in the header counts what it is showing, not the whole feed');
  app.window.close();
});
// --- a hotspot's species list must describe the HOTSPOT ---------------------
// Reported from the device: a well-birded park's card read "5 unseen · 7 more
// species already seen" — twelve species at a place that gets fifty in a
// morning. Nothing was broken in the split; the INPUT was wrong. Every card
// built its lists out of cv.merged, the region-wide `recent` feed, and that
// feed returns exactly ONE observation per species for the whole region. So a
// hotspot only ever received the species whose single region-wide
// representative row happened to land there, and the card was internally
// consistent while being badly incomplete.
//
// The correction is one location-scoped read per card: /data/obs/{locId}/recent
// is still one row per species, but scoped to the LOCATION, so "one per
// species" is now exactly the list we want.
test('a hotspot card lists the birds seen AT THAT HOTSPOT, not the region feed', async () => {
  const feeds = [];
  const app = await boot({
    fetch(url) {
      if (/ref\/taxonomy/.test(url)) return [];
      const m = /data\/obs\/(L\d+)\/recent/.exec(url);
      if (!m) return null;
      feeds.push(url);
      // Ten species at this one park. The region feed only ever knew about two.
      return Array.from({ length: 10 }, (_, i) => ({
        speciesCode: 'sp' + i, comName: 'Bird ' + i, obsDt: '2026-07-31 08:00',
      }));
    },
  });
  const A = app.window.__app;
  const doc = app.window.document;

  A.renderHot({
    hot: [{
      locId: 'L1', name: 'Big Park', lat: 47.7, lng: -122.2, dist: 8,
      fresh: 2, checklists: 3, share: 5, latest: '2026-07-31',
      birds: [{ name: 'Bird 0', code: 'sp0', unseen: true },
              { name: 'Bird 1', code: 'sp1', unseen: false }],
    }],
  });
  await new Promise((r) => setTimeout(r, 80));

  const card = doc.querySelector('#hotResults [data-hsloc]');
  assert.ok(card, 'the card carries its locId so it can be corrected after paint');
  assert.equal(card.getAttribute('data-hsloc'), 'L1');

  assert.equal(feeds.length, 1, 'exactly one location-scoped read per rendered card');
  assert.match(feeds[0], new RegExp(`back=${A.LOC_SPECIES_DAYS}\\b`),
    'windowed to the last few days: a species list for a place you might drive to today should describe today');

  const names = [].slice.call(card.querySelectorAll('.hslists .name'))
    .map((n) => n.textContent);
  assert.ok(names.length >= 10,
    `the card lists what the LOCATION feed returned, got ${names.length}: ${names.join(', ')}`);
  assert.ok(names.some((n) => /Bird 9/.test(n)),
    'including the species the region-wide feed never attributed to this hotspot');

  // The sub-header counted the same wrong feed, so correcting one and not the
  // other leaves the card contradicting itself on its own line.
  assert.ok(!/\b2 species\b/.test(card.querySelector('.meta').textContent),
    'the species count is re-stated from the corrected list, not left at the feed sample size');
  app.window.close();
});

// --- The checklist pulse is a MODE of Birdiest, and it costs nothing --------
// Birdiest answers "where was the best birding this week" by collapsing to one
// checklist per hotspot. That collapse destroys the other signal: three lists
// filed at one park this morning means people are STILL THERE. The Newest mode
// keeps them, and shares Birdiest's single cached fetch, so the second question
// is free. It shipped as its own top-level section for one day (v1.0.35), which
// was one day too long — a view of another section's data is a mode of that
// section, not a peer to it.
test('the newest-checklists mode is newest first and never collapsed per hotspot', async () => {
  const app = await boot();
  const A = app.window.__app;
  // These are the REAL field shapes eBird's product/lists returns, verified
  // against a live WA response: obsDt is a HUMAN date ("31 Jul 2026"),
  // isoObsDate is "YYYY-MM-DD HH:MM". The first version of this fixture
  // invented an ISO obsDt, which made the sort look correct in a world where
  // the bug could not occur. The Jul/Aug pair is the whole point: sorting the
  // human string ranks "31 Jul" above "01 Aug" because '3' > '0'.
  const rows = A.sortRecentLists([
    { subId: 'S2', obsDt: '31 Jul 2026', isoObsDate: '2026-07-31 06:00', locId: 'L1', numSpecies: 40 },
    { subId: 'S1', obsDt: '01 Aug 2026', isoObsDate: '2026-08-01 09:00', locId: 'L1', numSpecies: 12 },
    { subId: 'S1', obsDt: '01 Aug 2026', isoObsDate: '2026-08-01 09:00', locId: 'L1', numSpecies: 12 },
    { subId: 'S3', obsDt: '30 Jul 2026', isoObsDate: '2026-07-30 18:00', locId: 'L2', numSpecies: 90 },
  ]);
  assert.deepEqual(rows.map((r) => r.subId).join(','), 'S1,S2,S3',
    'sorted by observation time, newest first - not by species count, and not '
    + 'by the human obsDt string, which would sink 01 Aug below 31 Jul');
  assert.equal(rows.filter((r) => r.locId === 'L1').length, 2,
    'two lists at one hotspot stay two rows: that repetition IS the signal');
  assert.equal(rows.length, 3, 'but the same checklist id is never listed twice');
  app.window.close();

  // ...and the RENDERED row must carry the clock time. Asserting fmtDateTime
  // in isolation would not notice the row reverting to a bare obsDt, which is
  // exactly the regression this mode cannot afford: an 06:00 list and a
  // 21:00 list on the same day are different answers to "what is happening
  // right now".
  const rendered = await boot({
    fetch(url) {
      if (/product\/lists\//.test(url)) {
        return [{
          subId: 'S_AUG01', obsDt: '01 Aug 2026', isoObsDate: '2026-08-01 09:00',
          numSpecies: 12, userDisplayName: 'B',
          loc: { locName: 'Marina', locId: 'L1', latitude: 47.8, longitude: -122.4, isHotspot: true },
        }];
      }
      return null;
    },
  });
  rendered.window.__app.setChecklistMode('new');
  // The foreground lane paces requests now, so a render takes a beat longer.
  await new Promise((r) => setTimeout(r, 600));
  // Both modes render through the SHARED medium checklist card, so the clock
  // time lands in .ckdate rather than in a hand-rolled .name.
  const doc2 = rendered.window.document;
  const when = doc2.querySelector('#cklResults .cklcard-md .ckdate');
  assert.ok(when, 'the mode rendered a card into the Birdiest panel');
  assert.match(when.textContent, /\d{1,2}(:\d{2})?\s*[ap]/i,
    `the rendered when carries the clock time, not just the day: got "${when && when.textContent}"`);
  // The headline is the PLACE and it links to the checklist — the separate
  // "View S379659278 ↗" line is gone, and with it eleven characters of noise.
  const head = doc2.querySelector('#cklResults .cklcard-md .ckplace a');
  assert.ok(head, 'the place is the headline and it is a link');
  assert.match(head.getAttribute('href') || '', /ebird\.org\/checklist\/S_AUG/,
    'and the link is the checklist itself');
  assert.ok(!/View\s+S_AUG|View checklist/.test(doc2.getElementById('cklResults').textContent),
    'so no row carries a separate "View …" line any more');
  rendered.window.close();
});

// Four things the device reported about this one section, pinned together
// because they are one idea: the section should look like every other section.
test('Birdiest and Newest are ONE template, with the caveat behind the ℹ', async () => {
  const app = await boot();
  const doc = app.window.document;
  const CK = require(require('node:path')
    .join(__dirname, '..', 'www', 'cards-checklist.js'));

  // 1. Both modes render through the shared medium checklist card. They were
  //    two hand-rolled <li> shapes for one question.
  const best = HTML.slice(HTML.indexOf('function loadBirdiest('),
    HTML.indexOf('function markBirdiestUnseen('));
  const recent = HTML.slice(HTML.indexOf('function loadRecentLists('),
    HTML.indexOf('function buildBirdiest('));
  for (const [name, src] of [['Birdiest', best], ['Newest', recent]]) {
    assert.match(src, /ChecklistCards\.list\('medium'/,
      name + ' renders through the shared medium checklist card');
    assert.match(src, /ChecklistCards\.medium\(\{/, name + ' builds shared cards');
    assert.ok(!/<span class="count big">/.test(src),
      name + ' must not hand-roll a row — that is how the two drifted apart');
    // 2. The headline links to the checklist, so the "View …" line is gone.
    assert.match(src, /href: sub \? checklistUrl\(sub\) : ''/,
      name + ': the headline carries the checklist link');
    // Asserted on the EMITTING call, not on the words: the comment above each
    // renderer explains what was removed, and matching prose would fail on the
    // explanation rather than on the code.
    assert.ok(!/extA\(checklistUrl\(/.test(src),
      name + ' must not emit a separate "View …" link of its own');
  }
  assert.ok(!/id="cklWarn"/.test(HTML),
    'the inline yellow warning block is gone from the markup, not just unused');

  // 3. The caveat is a LIVE note inside the ℹ dialog, and the button marks
  //    itself — an explanation nobody knows is there is no explanation.
  const sec = doc.getElementById('sec-cklBtn');
  assert.ok(sec, 'the checklists section exists');
  const docBtn = sec.querySelector('.docbtn');
  const box = sec.querySelector('.sectiondoc');
  assert.ok(docBtn && box, 'it has an ℹ button and a doc box');
  assert.ok(!docBtn.classList.contains('hasnote'), 'unmarked when there is nothing to say');
  app.window.__app.setSectionNote(sec, app.window.__app.sectionNoteHtml('Showing 3 days, not 7.'));
  assert.ok(docBtn.classList.contains('hasnote'), 'marked once a note is attached');
  assert.match(docBtn.getAttribute('aria-label') || '', /note/i,
    'and says so to a screen reader, which cannot see the dot');
  assert.match(box.getAttribute('data-note') || '', /Showing 3 days/,
    'the note is held on the box, ready for the dialog');
  // Cleared, not just overwritten: a caveat that no longer applies must not
  // linger behind the icon from a previous load.
  app.window.__app.setSectionNote(sec, '');
  assert.ok(!docBtn.classList.contains('hasnote'), 'and unmarked again when cleared');
  assert.ok(!box.getAttribute('data-note'), 'with the note actually removed');

  // 4. The "Load checklists" button becomes the ↻ icon like every other
  //    section. It never did, because the MODE SWITCH is a `.row` too and it
  //    is the first one, so the helper skipped this section entirely.
  const refresh = sec.querySelector('.refreshbtn');
  assert.ok(refresh, 'the section has the ↻ icon every other section has');
  const loadRow = doc.getElementById('cklBtn').closest('.row');
  assert.equal(loadRow.hidden, true, 'and the wide Load button row is hidden');
  assert.ok(!loadRow.classList.contains('modeswitch'),
    'the row that got hidden is the LOAD row, not the mode switch');
  assert.equal(sec.querySelector('.modeswitch').hidden, false,
    'the mode switch is still visible — hiding it would remove the modes');
  app.window.close();
});

// The device reports its own geometry, and it reported the document 33px
// wider than the screen at 402px — a width the sweep did not test. eBird
// personal locations are raw addresses with no break opportunity a normal
// wrap would take, and they are the headline of these cards.
test('a checklist headline cannot widen the card, however long the name', () => {
  const CK = require(require('node:path')
    .join(__dirname, '..', 'www', 'cards-checklist.js'));
  assert.match(CK.css, /\.cklcard-md > \.ckhead > \.ckplace \{[^}]*overflow-wrap: anywhere/,
    'a raw street address breaks rather than pushing the card wide');
  assert.match(CK.css, /\.cklcard-md > \.ckhead > \.ckplace \{[^}]*min-width: 0/,
    'and the headline cell may shrink below its content');
  assert.match(CK.css, /\.cklcards-md > \.cklcard-md > \.ckhead \{[^}]*minmax\(0, 1fr\)/,
    'the grid track it sits in is minmax(0, 1fr), or min-content wins anyway');
  // Condensed too, so the common case is short before CSS has to rescue it.
  const long = CK.medium({
    place: '1730 North 122nd Street, Seattle, Washington, US (47.718, -122.335)',
    href: 'https://ebird.org/checklist/S1',
  });
  assert.ok(/\u2026/.test(long), 'and a very long name is truncated with an ellipsis');
});
test('the checklist modes share one section and one cached feed', async () => {
  const app = await boot();
  const doc = app.window.document;
  const A = app.window.__app;
  assert.ok(!doc.getElementById('recentBtn'),
    'Recent checklists is no longer its own section');
  assert.ok(!doc.getElementById('recentResults'), 'nor its own results list');
  const best = doc.getElementById('cklModeBest'), rec = doc.getElementById('cklModeNew');
  assert.ok(best && rec, 'Birdiest carries both modes');
  assert.equal(best.getAttribute('aria-pressed'), 'true', 'Birdiest is the default');
  assert.equal(rec.getAttribute('aria-pressed'), 'false');
  // These two chips are BUILT from the shared mode table but are addressed by
  // id and keep their own handlers, so build order is load-bearing: building
  // the switch AFTER the listeners are bound replaces the very elements the
  // handlers sit on and leaves two buttons that look right and do nothing.
  // Driving them by CLICK is the only assertion that can see that.
  assert.ok(best.getAttribute('aria-label'), 'the chip names itself in full');
  rec.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  assert.equal(rec.getAttribute('aria-pressed'), 'true',
    'TAPPING Newest switches mode — not just calling setChecklistMode');
  assert.equal(best.getAttribute('aria-pressed'), 'false');
  best.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  assert.equal(best.getAttribute('aria-pressed'), 'true', 'and tapping back returns');
  // Both collapses read the SAME cached promise, which is why the second mode
  // is free — if either stopped using recentLists() it would double the calls.
  const src = HTML.slice(HTML.indexOf('function loadRecentLists('),
    HTML.indexOf('function loadChecklists(') > 0 ? HTML.length : HTML.length);
  assert.match(HTML.slice(HTML.indexOf('function loadRecentLists(')), /recentLists\(\)/,
    'the newest mode reads the shared cached feed');
  assert.match(HTML.slice(HTML.indexOf('function loadBirdiest(')), /recentLists\(\)/,
    'and so does Birdiest');
  A.setChecklistMode('new');
  assert.equal(rec.getAttribute('aria-pressed'), 'true', 'switching marks the new mode current');
  assert.equal(best.getAttribute('aria-pressed'), 'false', 'and un-marks the old one');
  app.window.close();
});

// --- the tide table must answer "now" before it answers "today" -------------
// Reported from the device: "I looked at it today, and it was difficult at a
// glance to see current conditions and when next prime birding is." The table
// printed a whole day of windows including the ones that had already passed,
// so the reader had to locate themselves in it before it said anything. Two
// changes carry the fix: a state line ABOVE the table, and a table that starts
// at the window you are standing in.
test('the tide table starts at now and says what the water is doing', async () => {
  const app = await boot();
  const A = app.window.__app;
  const doc = app.window.document;

  // Four turning points spread around a fixed "now" of 12:00.
  const day = new Date();
  const iso = (h, m) => {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(h)}:${p(m)}`;
  };
  const preds = [
    { t: iso(2, 0),  v: '9.5',  type: 'H' },   // 02:00 -> 08:00 falling  (past)
    { t: iso(8, 0),  v: '-1.0', type: 'L' },   // 08:00 -> 14:00 rising   (NOW)
    { t: iso(14, 0), v: '10.2', type: 'H' },   // 14:00 -> 20:00 falling
    { t: iso(20, 0), v: '0.4',  type: 'L' },   // 20:00 -> overnight rising
  ];
  const rows = A.buildTideRows(preds);
  assert.equal(rows.length, 4, 'one row per window plus the overnight one');

  const noon = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0).getTime();
  const now = A.tideNow(rows, noon);
  assert.ok(now.cur, 'it can say which window you are standing in');
  assert.equal(now.cur.rising, true, 'and at noon on this fixture the water is coming in');
  assert.equal(now.untilRise, 0, 'so there is nothing to wait for');

  const dawn = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 3, 0).getTime();
  const early = A.tideNow(rows, dawn);
  assert.equal(early.cur.rising, false, 'at 3am it is falling');
  assert.ok(early.nextRise, 'and the next rising window is named');
  assert.equal(A.tideCountdown(early.untilRise), '5h',
    'the countdown is the wait until the water turns, in plain hours and minutes');
  assert.equal(A.tideCountdown(75 * 60000), '1h 15m', 'and carries minutes when it has them');
  assert.equal(A.tideCountdown(20 * 60000), '20 min', 'and drops the hour when there is none');

  A.renderTides(preds, { id: '9447427', name: 'Edmonds' }, noon);
  const el = doc.getElementById('wxTides');
  const table = el.querySelector('.wxtable');
  assert.ok(el.querySelector('.tidenowline'),
    'the current state is stated ABOVE the table, not left to be reconstructed from it');
  assert.match(el.querySelector('.tidenowline').textContent, /(Rising|Falling) now/,
    'and it says which, in words');

  // Pinned to noon, so this is the same table in every timezone: the two
  // windows that ended before noon are gone and the one containing noon leads.
  const bodyRows = [].slice.call(table.querySelectorAll('tbody tr'));
  assert.ok(bodyRows.length > 0 && bodyRows.length < rows.length,
    'past windows are dropped');
  const marked = bodyRows.filter((tr) => tr.classList.contains('tidenow'));
  assert.equal(marked.length, 1, 'exactly one row is marked as the one you are in');
  assert.equal(marked[0], bodyRows[0], 'and it leads the table');

  // A bird on every rising row would say nothing the highlight does not; the
  // marker earns its place only by separating daylight windows from dark ones.
  assert.match(el.textContent, /🦆/, 'prime windows carry a bird');

  // …and the bird only means something if a rising window can FAIL to earn it.
  var lit = { a: noon - 5 * 3600000, b: noon + 5 * 3600000 };   // 7am - 5pm
  const win = (h0, h1) => ({ rising: true, startMs: noon + (h0 - 12) * 3600000, endMs: noon + (h1 - 12) * 3600000 });
  assert.equal(A.tidePrime(win(9, 15), lit), true, 'a midday incoming tide is prime');
  assert.equal(A.tidePrime(win(0.5, 4), lit), false, 'the same tide at 1am is not - you cannot see the birds it brings in');
  assert.equal(A.tidePrime(win(16, 22), lit), true, 'a window that only overlaps the end of daylight still counts');
  assert.equal(A.tidePrime({ rising: false, startMs: noon, endMs: noon + 1 }, lit), false, 'and an outgoing tide is never prime');
  assert.equal(A.tidePrime(win(0.5, 4), null), true, 'with no sun times, a rising window keeps the benefit of the doubt');
  app.window.close();
});

// --- 🔎 Species lookup (F12) ------------------------------------------------
// The section exists because of one gap: every other section answers "what
// haven't you seen", and the question people actually ask on a Saturday is
// "where can I find a Western Kingbird" — a question that stays valid when the
// bird is already on your year list. If a lookup refused birds you have seen it
// would just be All unseen reports with a search box.
test('a species lookup answers for a bird you have ALREADY seen', async () => {
  const app = await boot({
    fetch(url) {
      if (/ref\/taxonomy/.test(url)) return [];
      return null;
    },
  });
  const A = app.window.__app;
  const seenCodes = Object.keys(A.getReportSeen());
  assert.ok(seenCodes.length > 0, 'the wa report bundles a year list to test against');
  const code = seenCodes[0];
  app.window.close();

  const feeds = [];
  const app2 = await boot({
    fetch(url) {
      if (/ref\/taxonomy/.test(url)) return [];
      if (/product\/spplist\//.test(url)) return [code];
      if (/data\/obs\/.*\/recent\//.test(url)) {
        feeds.push(url);
        return [{
          speciesCode: code, comName: 'Testable Kingbird', locName: 'Marina',
          locId: 'L1', lat: 47.8, lng: -122.4, obsDt: '2026-07-31 08:00',
          howMany: 2, subId: 'S1', obsValid: true,
        }];
      }
      return null;
    },
    storage: { ['ebird_species_v2:US-WA']: JSON.stringify({ at: Date.now(), rows: [{ code, name: 'Testable Kingbird', sci: 'Tyrannus testus' }] }) },
  });
  const doc2 = app2.window.document;
  doc2.getElementById('spLookup').value = 'Testable Kingbird';
  app2.window.__app.runSpeciesLookup();
  await new Promise((r) => setTimeout(r, 250));

  assert.equal(feeds.length, 1, 'one read of the per-species feed');
  assert.match(feeds[0], new RegExp(`recent/${code}\\b`),
    'it asks eBird for THAT species, not the whole region feed filtered afterwards');
  assert.match(feeds[0], new RegExp(`back=${app2.window.__app.SP_LOOKUP_BACK}\\b`),
    'over a window wider than the chase feeds, because a lookup asks about birds that may not be here today');
  const status = doc2.getElementById('spLookupStatus').textContent;
  assert.match(status, new RegExp('Testable Kingbird'),
    `a seen bird is answered, not refused: got "${status}"`);
  // Asserted against the whole rendered panel rather than one element, because
  // WHICH node carries the year-list fact is layout, not behaviour. What must
  // never regress is that a bird you have already seen is still answered AND
  // still marked as seen — the ✅ and the words, both.
  const panel = doc2.getElementById('sec-spLookupBtn').textContent;
  assert.match(panel, /already on your year list/,
    'the answer says you have already seen it rather than staying silent');
  assert.match(panel, /✅/, 'and marks it with the same tick the other sections use');
  assert.ok(doc2.querySelectorAll('#spLookupResults li').length > 0,
    'and the places it was seen are listed');
  app2.window.close();
});

// Two orders because they are two different questions: "is it still around"
// (date) and "how far must I drive" (distance). One fetch serves both.
test('species lookup sorts by date and by distance from one fetch', async () => {
  const app = await boot();
  const A = app.window.__app;
  const g = {
    places: [
      { loc: 'Far but fresh',  distMi: 40, dateStr: '2026-07-31 09:00' },
      { loc: 'Near but stale', distMi: 2,  dateStr: '2026-07-20 09:00' },
      { loc: 'Middle',         distMi: 10, dateStr: '2026-07-25 09:00' },
    ],
  };
  assert.deepEqual(A.sortSpeciesPlaces(g, 'date').places.map((p) => p.loc),
    ['Far but fresh', 'Middle', 'Near but stale'],
    'by date, the most recent sighting leads however far away it is');
  assert.deepEqual(A.sortSpeciesPlaces(g, 'dist').places.map((p) => p.loc),
    ['Near but stale', 'Middle', 'Far but fresh'],
    'by distance, the closest leads however old it is');
  // A place with no distance must not win the distance sort by being falsy.
  const withNull = { places: [{ loc: 'Unknown', distMi: null, dateStr: '2026-07-31' }, { loc: 'Known', distMi: 9, dateStr: '2026-07-01' }] };
  assert.equal(A.sortSpeciesPlaces(withNull, 'dist').places[0].loc, 'Known',
    'an unknown distance sorts last, not first');
  app.window.close();
});

// "Not being reported" is the answer to the question, not a failure to answer.
test('a species with no recent reports says so as a result, not an error', async () => {
  const app = await boot({
    fetch(url) {
      if (/ref\/taxonomy/.test(url)) return [];
      if (/product\/spplist\//.test(url)) return ['zzzrare'];
      if (/data\/obs\/.*\/recent\//.test(url)) return [];
      return null;
    },
    storage: { 'ebird_species_v2:US-WA': JSON.stringify({ at: Date.now(), rows: [{ code: 'zzzrare', name: 'Absent Grebe', sci: 'Nullus absentus' }] }) },
  });
  const doc = app.window.document;
  doc.getElementById('spLookup').value = 'Absent Grebe';
  app.window.__app.runSpeciesLookup();
  await new Promise((r) => setTimeout(r, 250));
  const st = doc.getElementById('spLookupStatus').textContent;
  assert.match(st, /not being seen right now|No reports/,
    `absence is stated plainly: got "${st}"`);
  assert.doesNotMatch(st, /error|failed|undefined/i, 'and it is not dressed up as a failure');
  app.window.close();
});

// The multi-match list renders a 🔎 button per row. It was markup with no
// handler — every one of those buttons was dead on tap.
test('tapping a species in the match list runs the lookup', async () => {
  const hit = [];
  const app = await boot({
    fetch(url) {
      if (/ref\/taxonomy/.test(url)) return [];
      if (/product\/spplist\//.test(url)) return ['sp1', 'sp2'];
      if (/data\/obs\/.*\/recent\//.test(url)) { hit.push(url); return []; }
      return null;
    },
    storage: { 'ebird_species_v2:US-WA': JSON.stringify({ at: Date.now(), rows: [
      { code: 'sp1', name: 'Marsh Wren', sci: 'A' },
      { code: 'sp2', name: 'Marsh Sandpiper', sci: 'B' },
    ] }) },
  });
  const doc = app.window.document;
  doc.getElementById('spLookup').value = 'Marsh';
  app.window.__app.runSpeciesLookup();
  await new Promise((r) => setTimeout(r, 250));

  const btns = doc.querySelectorAll('#spLookupFound .splook');
  assert.equal(btns.length, 2, 'two matches offer two choices rather than guessing');
  assert.equal(hit.length, 0, 'and nothing is fetched until one is chosen');
  btns[0].dispatchEvent(new app.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(hit.length, 1, 'tapping a match actually looks it up');
  app.window.close();
});

/*
 * F25: regions and trips the user adds in the app.
 *
 * regions.py is compiled into the report generator, so a region invented on the
 * phone can never reach the Markdown report. That makes this app-only BY FORCE,
 * and the tests below guard the parts that bite rather than the happy path.
 */
test('a user region is geo-only, starts unseen, and never touches logic.js', async () => {
  const app = await boot();
  const A = app.window.__app;
  const rec = { slug: 'u-victoria-bc', label: 'Victoria BC', place: 'Victoria, BC',
                lat: 48.4284, lng: -123.3656, stateCode: 'CA-BC',
                tzStdOffset: -8, tzObservesDst: true };
  const p = A.customProfile(rec);

  // Geo-only scope. Not a stopgap — the rarity trackers ship no counties either,
  // so this is an already-supported shape and planFeeds needs no new branch.
  // JSON.stringify rather than deepEqual: these objects come from jsdom's realm,
  // and deepEqual compares prototypes.
  assert.equal(JSON.stringify(p.counties), '[]', 'a user region has no county feeds');
  assert.equal(p.geoFeed, true, 'it gathers from its own map circle instead');
  const jobs = app.window.BirdLogic.planFeeds(p);
  assert.ok(jobs.length > 0, 'and that still produces a usable feed plan');
  assert.ok(jobs.every((j) => !/US-|CA-/.test(j.file || '') || /geo/.test(j.file || '')),
    'every job is a geo job — there is no county lane to scope');

  // An empty seen list is CORRECT for a trip: nearly everything is genuinely new,
  // and it makes the region useful the moment it is created.
  assert.equal(p.birdlistSlug, '', 'no bundled year list, so everything reads unseen');

  // logic.js is proven equal to regions.py by the parity suite. A user row in its
  // registry would make the two disagree by design.
  assert.equal(app.window.BirdLogic.REPORTS['u-victoria-bc'], undefined,
    'the shared registry must never learn about a user region');
});

test('a user region cannot shadow a built-in', async () => {
  const app = await boot();
  const A = app.window.__app;
  // Hand-written storage is the realistic attack: an edited export, or an older
  // build that wrote a different shape.
  app.window.localStorage.setItem('ebird_custom_regions', JSON.stringify([
    { slug: 'wa', label: 'Fake Washington', lat: 1, lng: 2 },
    { slug: 'u-ok', label: 'Fine', lat: 48.4, lng: -123.3 },
    { slug: 'u-nocoord', label: 'No coordinate' }
  ]));
  const mine = A.getCustomRegions();
  assert.equal(JSON.stringify(mine.map((r) => r.slug)), JSON.stringify(['u-ok']),
    'an un-namespaced slug and a region with no coordinate are both refused');

  // And a generated slug never collides either.
  app.window.localStorage.setItem('ebird_custom_regions', JSON.stringify([
    { slug: 'u-victoria-bc', label: 'Victoria BC', lat: 48.4, lng: -123.3 }
  ]));
  assert.equal(A.slugifyRegion('Victoria BC'), 'u-victoria-bc-2',
    'a second region of the same name gets its own slug');
  assert.equal(A.slugifyRegion('Washington'), 'u-washington',
    'and a user region is namespaced away from the built-in slug');
});

test('deleting a region sweeps every per-region key it left behind', async () => {
  const app = await boot();
  const A = app.window.__app;
  const w = app.window;
  w.localStorage.setItem('ebird_custom_regions', JSON.stringify([
    { slug: 'u-trip', label: 'A trip', lat: 48.4, lng: -123.3 }
  ]));
  // Everything a region accumulates. The chase snapshot is the big one — the
  // durable cache stores a compressed copy of every feed.
  w.localStorage.setItem('ebird_home_lat:u-trip', '48.4');
  w.localStorage.setItem('ebird_home_lng:u-trip', '-123.3');
  w.localStorage.setItem('ebird_home_place:u-trip', 'Victoria');
  w.localStorage.setItem('ebird_tide_station:u-trip', '9443090');
  w.localStorage.setItem('ebird_chase_v1:u-trip:2026-08-02', 'z:xxxx');
  w.localStorage.setItem('bc_snap:u-trip:2026-08-02', '["abc"]');
  // A neighbour that must survive.
  w.localStorage.setItem('ebird_home_lat:wa', '47.75');

  A.deleteCustomRegion('u-trip');

  ['ebird_home_lat:u-trip', 'ebird_home_lng:u-trip', 'ebird_home_place:u-trip',
   'ebird_tide_station:u-trip', 'ebird_chase_v1:u-trip:2026-08-02',
   'bc_snap:u-trip:2026-08-02'].forEach((k) => {
    assert.equal(w.localStorage.getItem(k), null,
      k + ' must go with the region, or storage grows a dead trip every holiday');
  });
  assert.equal(w.localStorage.getItem('ebird_home_lat:wa'), '47.75',
    'another region must not be swept with it');
  assert.equal(JSON.stringify(A.getCustomRegions()), '[]', 'and the region itself is gone');
});

test('deleting the region you are looking at falls back to a built-in', async () => {
  const app = await boot();
  const A = app.window.__app;
  const w = app.window;
  w.localStorage.setItem('ebird_custom_regions', JSON.stringify([
    { slug: 'u-trip', label: 'A trip', lat: 48.4, lng: -123.3 }
  ]));
  w.localStorage.setItem('ebird_report', 'u-trip');
  assert.equal(A.getReportSlug(), 'u-trip', 'the user region is selectable');
  assert.equal(A.getReport().label, 'A trip', 'and resolves to its own profile');

  A.deleteCustomRegion('u-trip');
  assert.equal(A.getReportSlug(), 'wa',
    'deleting the active region must not leave the app on a slug that cannot resolve');

  // The same must hold for a stored slug that was never valid.
  w.localStorage.setItem('ebird_report', 'u-does-not-exist');
  assert.equal(A.getReportSlug(), 'wa', 'an unknown slug falls back rather than throwing');
});

test('the region pickers offer user regions alongside the built-ins', async () => {
  const app = await boot();
  const A = app.window.__app;
  const before = A.allReportsList().length;
  app.window.localStorage.setItem('ebird_custom_regions', JSON.stringify([
    { slug: 'u-victoria-bc', label: 'Victoria BC', lat: 48.4284, lng: -123.3656 }
  ]));
  const after = A.allReportsList();
  assert.equal(after.length, before + 1, 'the user region joins the list');
  const mine = after[after.length - 1];
  assert.equal(mine.slug, 'u-victoria-bc');
  assert.equal(mine.kind, 'trip', 'and reads as a trip, like Fort Casey and Waikoloa');
});

test('the time zone is derived from longitude, which is right where it matters', async () => {
  const app = await boot();
  const { tzFromLng } = app.window.__app;
  // Crude, and correct for the cases this feature exists for. It only drives
  // time-of-day labels, so an error costs a mislabelled hour, not a wrong bird.
  assert.equal(tzFromLng(-123.3656).tzStdOffset, -8, 'Victoria BC is PST');
  assert.equal(tzFromLng(-155.8).tzStdOffset, -10, 'Waikoloa is HST');
  assert.equal(tzFromLng(-122.14).tzStdOffset, -8, 'Woodinville is PST');
  assert.equal(tzFromLng(-155.8).tzObservesDst, false,
    'Hawaii does not observe DST, and it is the one common zone that does not');
  assert.equal(tzFromLng(-123.3656).tzObservesDst, true, 'British Columbia does');
});

test('the same feed is fetched once, however many sections ask for it', async () => {
  // A device log showed product/lists/US-WA-033 and -061 each fetched TWICE,
  // seven seconds apart, and data/obs/US-WA/recent/tersan twice as well —
  // because three sections (Birdiest, Convoys, Happening now) each call
  // BL.planConvoyFeeds and none knew the others had already paid. The comment
  // at the convoy call site asserted the opposite ("costs no extra network"),
  // which was true when written and false once the third caller arrived.
  //
  // Under the MEASURED rate limit each duplicate costs ~3.3 s and a slot out of
  // a burst allowance of about 10, so four wasted calls is ~13 s for nothing.
  //
  // Promise IDENTITY is the assertion, and it needs no network: if the second
  // caller gets the same promise object, there is only one request. Awaiting
  // would drag the real retry path (20 s cooldowns) into the suite.
  const app = await boot();
  const A = app.window.__app;
  const path = 'product/lists/US-WA-033?maxResults=200';
  const a = A.ebird(path);
  const b = A.ebird(path);
  assert.equal(a, b, 'a second caller shares the first request rather than issuing its own');
  const other = A.ebird('product/lists/US-WA-061?maxResults=200');
  assert.notEqual(a, other, 'but a different feed is still its own request');
  a.catch(() => {}); b.catch(() => {}); other.catch(() => {});
});

test('a failed feed is evicted from the memo, so it can be retried', () => {
  // Memoising the promise is what collapses duplicates, but a REJECTED promise
  // must not stay cached, or one transient failure would poison that feed for
  // the rest of the session. Asserted on the source rather than by driving a
  // real failure: the retry path deliberately waits out a 20 s cooldown, so
  // exercising it here would make the suite take minutes.
  const src = HTML.slice(HTML.indexOf('function ebird(path, bg)'),
                         HTML.indexOf('function ebird(path, bg)') + 2400);
  assert.match(src, /delete _ebCache\[path\]/,
    'a rejected call is evicted so the next attempt actually goes out');
  assert.match(src, /_ebCache\[path\] = \{ t: Date\.now\(\), p: p \}/,
    'and the promise is what is cached, so concurrent callers share one request');
});

test('the hotspot medium card is three cells over a full-width sub-header', () => {
  // Requested layout: row 1 is number | name | distance, row 2 is the
  // sub-header spanning all three columns.
  //
  // It previously had the badge and the distance each spanning rows 1-2 with
  // the sub-header boxed into column 2, which gave the line carrying the
  // actual facts about 60% of the card and made it the first thing to wrap.
  //
  // Asserted against the EXPORTED css rather than the source file, so the test
  // reads the artifact the app actually installs.
  const css = require(require('node:path')
    .join(__dirname, '..', 'www', 'cards-hotspot.js')).css;

  const rule = (sel) => {
    const i = css.indexOf(sel + ' {');
    assert.ok(i >= 0, 'missing rule for ' + sel);
    return css.slice(i, css.indexOf('}', i));
  };

  assert.match(css, /grid-template-columns: auto minmax\(0, 1fr\) auto/,
    'three columns: badge, name, distance');

  const num = rule('.hscard-md > .name > .hsnum');
  assert.match(num, /grid-column: 1;/, 'the number is column 1');
  assert.match(num, /grid-row: 1;/, 'of row 1, and it no longer spans rows');

  const name = rule('.hscard-md > .name > .ntext');
  assert.match(name, /grid-column: 2;/, 'the name is column 2');
  assert.match(name, /grid-row: 1;/, 'of row 1');

  const dist = rule('.hscard-md > .name > .hsdist');
  assert.match(dist, /grid-column: 3;/, 'the distance is column 3');
  assert.match(dist, /grid-row: 1;/, 'of row 1, and it no longer spans rows');

  const meta = rule('.hscard-md > .meta');
  assert.match(meta, /grid-column: 1 \/ -1;/,
    'the sub-header spans all three columns');
  assert.match(meta, /grid-row: 2;/, 'on its own second row');

  // The blanket span rule comes later at equal specificity, so listing .meta
  // in its reset would silently undo the span.
  assert.ok(!/\.hscard-md > \.name, \.hscard-md > \.meta \{ grid-column: auto/.test(css),
    '.meta must not be reset to grid-column:auto after being told to span');
});

test('latest ticks: today\u2019s species feeds are cached, and only new birds cost a call', async () => {
  // The most expensive section in the app: one region feed plus ONE CALL PER
  // SPECIES the top 100 recently added — measured at ~46, which at the rate
  // limit eBird actually enforces is over two minutes of paced fetching.
  // "Where has this bird been in the last 14 days" does not change between two
  // visits on the same morning, so it is cached by region and DAY.
  const app = await boot();
  const A = app.window.__app, w = app.window;

  assert.match(A.lastNewKey('US-WA'), /^bc_lastnew:US-WA:\d{4}-\d{2}-\d{2}$/,
    'the key is scoped to the region AND the day, so it expires by itself');

  // Only the fields the section renders are stored. detail=full would put
  // megabytes into localStorage for a handful of columns.
  const picked = A.lastNewPick({
    obsDt: '2026-08-03 07:00', locName: 'Edmonds Marsh', lat: 47.8, lng: -122.3,
    locId: 'L1', locationPrivate: false, howMany: 4, subId: 'S1',
    userDisplayName: 'Wyatt', comName: 'Sora', speciesCode: 'sora',
    obsReviewed: true, obsValid: true, exoticCategory: null
  });
  assert.equal(picked.locName, 'Edmonds Marsh');
  assert.equal(picked.subId, 'S1');
  assert.ok(!('comName' in picked) && !('obsReviewed' in picked),
    'and nothing else — the projection is the point');

  // Round-trips through the same compressor the chase snapshot uses.
  await A.saveLastNewCache('US-WA', { Sora: { code: 'sora', obs: [picked] } });
  const back = await A.loadLastNewCache('US-WA');
  assert.equal(JSON.stringify(back.Sora.obs[0]), JSON.stringify(picked),
    'what goes in comes back out');
  assert.ok(w.localStorage.getItem(A.lastNewKey('US-WA')),
    'and it is actually on disk');

  // Yesterday's copy is dead weight once the date rolls over.
  w.localStorage.setItem('bc_lastnew:US-WA:2000-01-01', 'z:stale');
  await A.loadLastNewCache('US-WA');
  A.lastNewChecklists([], 'US-WA').catch(() => {});
  assert.equal(w.localStorage.getItem('bc_lastnew:US-WA:2000-01-01'), null,
    'an older day is pruned rather than kept forever');
});

test('the sustained limit is a sliding window, not just a bucket', async () => {
  // A device log caught the gap in the first model. The app stalled for 57
  // seconds mid-wave (a backgrounded phone suspends timers), the token bucket
  // refilled to full while nothing ran, and then released all of it in about
  // two seconds — the log shows tokens walking 7.0, 6.1, 5.1, 4.2, 3.3, 2.3,
  // 1.4, 0.5, 0.0 — with the 429s starting eight seconds later.
  //
  // The bucket was working. The problem is that it only models the SHORT-term
  // allowance, while the measured limiter ALSO caps ~30 successes per minute.
  // Idle time earns burst credit against the short window and none at all
  // against the long one.
  const app = await boot();
  const A = app.window.__app;
  assert.equal(typeof A.FG_WINDOW_MAX, 'number', 'there is a rolling-window cap');
  assert.ok(A.FG_WINDOW_MAX > 0 && A.FG_WINDOW_MAX <= 30,
    'set under the measured ~30/min, because the scheduled report spends part '
    + 'of the same budget whenever it is running');
  assert.equal(A.FG_WINDOW_MS, 60000, 'measured over a minute, like the limit');

  const src = HTML.slice(HTML.indexOf('function fgSlot('),
                         HTML.indexOf('function fgSlot(') + 700);
  // Takes the lane now: background stops short of the cap so an interactive
  // tap always has budget. Every call still passes through the same window.
  assert.match(src, /fgWindowWait\(at, bg\)/,
    'and every call is scheduled through it, not just the bucket');
  assert.match(src, /_fgStarts\.push\(at\)/,
    'recording when it actually starts, so the window is real rather than notional');
});

test('getChase resolves on phase 1 so the screen can come up', () => {
  // The bug this fixes: phase 1 finished in 4.5s with all eight feeds at HTTP
  // 200, and the user saw nothing for a minute and then a 429. getChase was
  // publishing phase 1 into the cache and then CONTINUING to await phase 2
  // before resolving — on a cold start every section is blocked on that very
  // promise, so the "publish" had no audience.
  // Sliced to the end of runWave, not a magic character count — a fixed-length
  // window silently stops covering the function as soon as anything is added.
  const src = HTML.slice(HTML.indexOf('function runWave()'),
                         HTML.indexOf('// A cold start had nothing in memory'));
  assert.match(src, /var first = finish\(codes, false\);/,
    'phase 1 produces the result that is returned');
  assert.match(src, /return first;/,
    'and it is returned rather than awaited past');
  assert.match(src, /_chasePhase2\[slug\] = fetchBatched\(/,
    'phase 2 is detached and kept, so a caller that needs it can wait');
  // A phase-2 failure must not take down what is already on screen.
  assert.match(src, /the phase-1 view stands/,
    'and a phase-2 failure leaves the phase-1 view standing');
  // ...and it must not hold the queue against the section you are looking at.
  assert.match(src, /_chasePhase2\[slug\] = fetchBatched\(spFeeds, SPECIES_BATCH, true\)/,
    'phase 2 runs in the BACKGROUND lane');
});

// Reported from the device: Quick outing needs exactly ONE call and still sat
// on "Finding hotspots near home…" for a long time. It was queued behind the
// detached phase-2 species wave — ~46 calls, over two minutes at the rate
// eBird actually enforces. The section on screen was waiting on work nobody
// was waiting for.
test('the section you are looking at is not queued behind the background wave', async () => {
  const app = await boot();
  const A = app.window.__app;
  assert.ok(A.fgState, 'the gate exposes its state');
  const st = A.fgState();
  assert.ok('queuedBg' in st, 'and reports the two lanes separately');

  const src = HTML.slice(HTML.indexOf('function fgSlot('),
                         HTML.indexOf('function retryAfterMs('));
  assert.match(src, /else if \(bg\) _fgBgWaiters\.push\(take\);/,
    'background callers queue in their own lane');
  assert.match(src, /else _fgWaiters\.push\(take\);/,
    'and everything else keeps the foreground lane');
  // Each lane must stay FIFO. Jumping the whole queue to the FRONT instead
  // would reverse the order of the foreground calls against each other.
  assert.ok(!/_fgWaiters\.unshift\(/.test(HTML),
    'no lane is drained out of order');
  const rel = HTML.slice(HTML.indexOf('function fgRelease()'),
                         HTML.indexOf('function fgRelease()') + 600);
  assert.match(rel, /_fgWaiters\.length \? _fgWaiters\.shift\(\)/,
    'foreground drains first');
  assert.match(rel, /_fgBgWaiters\.length \? _fgBgWaiters\.shift\(\)/,
    'and the background lane is served only when nothing else is waiting');
  // The lane is a QUEUE POSITION, not a second rate. Both lanes must go
  // through the same bucket, window and gap, or "priority" would become a way
  // to exceed the limit that every 429 in this app came from.
  assert.match(src, /_fgStarts\.push\(at\)/, 'both lanes enter the rolling window');
  assert.match(src, /fgTakeToken\(now\)/, 'and both spend a token');
  assert.match(src, /_fgNextAt = at \+ _fgGap/, 'and both respect the AIMD gap');
  app.window.close();
});

// Reported from the device with a screenshot: "Matching 12 of 52 birds to
// recent checklists…" and an otherwise empty section. Everything on the card
// EXCEPT the checklists comes from one leaderboard read that has already
// returned, so there was no reason to hold it back.
test('latest ticks paints the board before the checklists arrive', () => {
  const load = HTML.slice(HTML.indexOf('function loadLastNew()'),
                          HTML.indexOf('function lastNewKey('));
  assert.match(load, /renderLastNew\(groups, \{\}, region, codeIdx\)/,
    'the board is painted from the leaderboard read, with no checklists yet');
  assert.ok(load.indexOf('renderLastNew(groups, {}, region, codeIdx)')
            < load.indexOf('lastNewChecklists('),
    'and painted BEFORE the per-species fetches start');
  assert.match(load, /lastNewPatch\(sp, groups\[sp\], info, region, codeIdx/,
    'each row is replaced as its own feed lands');

  // The order must be decided by the leaderboard alone, or rows would jump
  // around under a thumb that is already reaching for one.
  const order = HTML.slice(HTML.indexOf('function lastNewOrder('),
                           HTML.indexOf('function renderLastNew('));
  assert.match(order, /groups\[b\]\.birders\.length - groups\[a\]\.birders\.length/,
    'ranked by how many of the top 100 added it');
  assert.ok(!/byName|info\./.test(order),
    'and never by anything that arrives later, so the list cannot reshuffle');

  // Patching ONE row rather than re-rendering the list: a full re-render would
  // restart photo hydration ~46 times and close any expander already opened.
  const patch = HTML.slice(HTML.indexOf('function lastNewPatch('),
                           HTML.indexOf('function lastNewCard('));
  assert.match(patch, /replaceChild\(fresh, el\)/, 'one row is swapped in place');
  assert.ok(!/innerHTML = ''/.test(patch), 'the list is never rebuilt wholesale');
  assert.match(patch, /getAttribute\('data-sp'\) === sp/,
    'the row is found by species, not by index — the list must not be re-sorted');

  // A pending row still says something useful rather than looking broken.
  const card = HTML.slice(HTML.indexOf('function lastNewCard('),
                          HTML.indexOf('function loadAbaAlert('));
  assert.match(card, /var pending = !info && !!code;/,
    'a row knows whether its feed has landed — and a species with no code has '
    + 'no feed coming, so it must not wait forever');
  assert.match(card, /finding recent checklists/, 'and says so while it waits');
});

// "I would like the latest ticks on the leaderboard to be split, showing the
// unseen birds first and seen birds second." The list is the longest in the
// app and the magnifier was carrying the whole distinction on its own.
//
// This asserts on the RENDERED DOM rather than the source, because the failure
// mode that matters is not the markup — it is `data-sp`, which renderLastNew
// stamps positionally. Interleaving heading rows shifts every index by one, and
// a mis-stamped list means lastNewPatch silently updates the WRONG bird as each
// checklist feed lands. Source regexes cannot see that.
test('latest ticks splits unseen birds from seen ones', async () => {
  const app = await boot();
  const A = app.window.__app;
  const doc = app.window.document;
  seedSeen(app, ['zzseen1']);
  app.window.localStorage.setItem('ebird_seen_field', 'speciesCode');

  // Synthetic species on purpose: every real bird the leaderboard shows is a
  // WA bird, and isSpeciesSeen also matches against the bundled year-list
  // NAMES, so a real name would resolve as seen no matter what is in storage.
  //
  // The SEEN bird deliberately outranks the unseen one on the board (two
  // birders to one). Board order alone would put it first, so this proves the
  // split really regroups rather than the fixture agreeing by accident.
  const groups = {
    'Zzz Junco': { birders: [{ name: 'A', rank: 1, date: '2026-07-30' },
                             { name: 'B', rank: 2, date: '2026-07-29' }],
                   latest: '2026-07-30' },
    'Zzz Sandpiper': { birders: [{ name: 'C', rank: 3, date: '2026-07-30' }],
                       latest: '2026-07-30' }
  };
  const codeIdx = { 'zzz junco': 'zzseen1', 'zzz sandpiper': 'zzneed1' };
  assert.equal(A.isSpeciesSeen('zzseen1', 'Zzz Junco'), true, 'fixture: junco is seen');
  assert.equal(A.isSpeciesSeen('zzneed1', 'Zzz Sandpiper'), false,
    'fixture: sandpiper is not');
  A.renderLastNew(groups, {}, 'US-WA', codeIdx);

  const out = doc.getElementById('lastNewResults');
  const heads = [...out.querySelectorAll('.cardgroup .cghead')].map(e => e.textContent);
  assert.equal(heads.length, 2, 'both groups render a heading');
  assert.match(heads[0], /Still needed/, 'the birds you can still add come FIRST');
  assert.match(heads[1], /Already on your year list/, 'the ones you have come second');

  const kids = [...out.children];
  const stamps = kids.map(e => e.getAttribute('data-sp'));
  assert.deepEqual(stamps,
    [null, 'Zzz Sandpiper', null, 'Zzz Junco'],
    'data-sp lands on the CARDS and skips the headings — lastNewPatch finds '
    + 'rows by this attribute, so an off-by-one here updates the wrong bird');

  // The marker stays on the needed row even though the heading already says so:
  // these are cards, and a card read on its own loses a heading scrolled past.
  const need = kids[1].innerHTML, have = kids[3].innerHTML;
  assert.match(need, /needflag/, 'an unseen bird still carries its own marker');
  assert.ok(!/needflag/.test(have), 'and a seen bird never does');

  // The code must be known at PAINT time, or a row would start under one
  // heading and jump to the other once its own feed landed.
  assert.match(need, /zzneed1/, 'the card is built with the code from the index');
  app.window.close();
});

// "the medium hotspots card should include the collapsed list of recent
// checklists. this is missing from top destinations."
// "the checklists should be filtered to only showing ones with the unseen
// birds… dont show checklists without unseen birds."
//
// A hotspot card answers ONE question — is this worth the drive? — and a list
// of twelve checklists that between them prove nothing you want is not
// evidence for it, it is other people's mornings pushing the next hotspot off
// the screen. This runs the real chain (hydrateLocSpecies → hydrateHotspot-
// Checklists) against a hotspot where exactly one of three checklists reported
// the bird you need.
test('a hotspot lists the checklists with a bird you need, and says how many it dropped', async () => {
  const lists = ['S1', 'S2', 'S3'].map((s, i) => ({
    subId: s, numSpecies: 20 + i, isoObsDate: '2026-08-0' + (7 - i) + ' 08:00',
    userDisplayName: 'Birder ' + i,
    loc: { locId: 'L1', locName: 'Big Park', latitude: 47.7, longitude: -122.2 },
  }));
  const app = await boot({
    fetch(url) {
      if (/product\/lists\//.test(url)) return lists;
      if (/data\/obs\/L1\/recent/.test(url)) {
        return [
          // The bird you need — reported on S1, and ONLY on S1.
          { speciesCode: 'sp0', comName: 'Needed Bird', obsDt: '2026-08-07 08:00', subId: 'S1' },
          // Already on the year list, so S2 is not a reason to drive anywhere.
          { speciesCode: 'daejun', comName: 'Dark-eyed Junco', obsDt: '2026-08-06 08:00', subId: 'S2' },
        ];
      }
      return null;
    },
  });
  const doc = app.window.document, A = app.window.__app;
  const rep = app.window.__SEED_BIRDLIST__.seenByReport[A.getReportSlug()];
  rep.codes = ['daejun']; rep.watchHeld = []; rep.names = ['Dark-eyed Junco'];
  app.window.localStorage.setItem('ebird_seen_field', 'speciesCode');

  A.renderHot({
    hot: [{ locId: 'L1', name: 'Big Park', lat: 47.7, lng: -122.2, dist: 8,
            fresh: 2, checklists: 3, share: 5, latest: '2026-08-07',
            birds: [{ name: 'Needed Bird', code: 'sp0', unseen: true }] }],
  });
  await new Promise((r) => setTimeout(r, 900));

  const card = doc.querySelector('#hotResults [data-hsloc]');
  const det = card.querySelector('.hsckl details.ckall');
  assert.ok(det, 'the qualifying checklist is still shown');
  assert.equal(det.querySelectorAll('.cklcard-sm').length, 1,
    'one of three checklists reported a bird you need, so one is listed');
  assert.match(det.innerHTML, /S1/, 'and it is the one that reported it');
  assert.ok(!/S2|S3/.test(det.innerHTML),
    'a checklist holding only birds you already have is not evidence for a drive');

  // The label has to say WHICH checklists these are, or a reader who knows the
  // park had a dozen lists today reads "1 checklist" as a bug in the fetch.
  assert.match(det.querySelector('summary').textContent, /bird you need/,
    'the summary states the filter it applied rather than implying a total');
  // ...and the dropped ones are COUNTED, not silently deleted. "3 checklists
  // here today, 1 of them useful to you" is a different fact from "1 checklist
  // here today", and only the first tells you the place is alive.
  assert.match(det.textContent, /2 more here today without a bird you need/,
    'the filtered-out lists survive as a count');
  app.window.close();
});

// The same pass, at a hotspot where you need NOTHING. This is the case the
// first implementation got wrong: an empty subId list was read as "no hint
// available" and the card fell back to printing all twelve.
test('a hotspot with nothing you need lists no checklists at all', async () => {
  const lists = ['S1', 'S2'].map((s, i) => ({
    subId: s, numSpecies: 30, isoObsDate: '2026-08-0' + (7 - i) + ' 08:00',
    userDisplayName: 'Birder ' + i,
    loc: { locId: 'L1', locName: 'Big Park', latitude: 47.7, longitude: -122.2 },
  }));
  const app = await boot({
    fetch(url) {
      if (/product\/lists\//.test(url)) return lists;
      if (/data\/obs\/L1\/recent/.test(url)) {
        return [{ speciesCode: 'daejun', comName: 'Dark-eyed Junco',
                  obsDt: '2026-08-07 08:00', subId: 'S1' }];
      }
      return null;
    },
  });
  const doc = app.window.document, A = app.window.__app;
  const rep = app.window.__SEED_BIRDLIST__.seenByReport[A.getReportSlug()];
  rep.codes = ['daejun']; rep.watchHeld = []; rep.names = ['Dark-eyed Junco'];
  app.window.localStorage.setItem('ebird_seen_field', 'speciesCode');

  A.renderHot({
    hot: [{ locId: 'L1', name: 'Big Park', lat: 47.7, lng: -122.2, dist: 8,
            fresh: 2, checklists: 2, share: 5, latest: '2026-08-07', birds: [] }],
  });
  await new Promise((r) => setTimeout(r, 900));

  const card = doc.querySelector('#hotResults [data-hsloc]');
  assert.equal(card.getAttribute('data-unseen-n'), '0',
    'the species pass ran and found nothing you need');
  assert.ok(!card.querySelector('.hsckl details'),
    'so there is no checklist list — every one of them is somebody else\'s morning');
  app.window.close();
});

test('a hotspot card shows its recent checklists, and pays nothing extra', async () => {
  const lists = [
    { subId: 'S1', numSpecies: 34, isoObsDate: '2026-07-31 07:10',
      userDisplayName: 'A Birder',
      loc: { locId: 'L1', locName: 'Big Park', latitude: 47.7, longitude: -122.2 } },
    { subId: 'S2', numSpecies: 21, isoObsDate: '2026-07-30 09:00',
      userDisplayName: 'B Birder',
      loc: { locId: 'L1', locName: 'Big Park', latitude: 47.7, longitude: -122.2 } },
    { subId: 'S3', numSpecies: 9, isoObsDate: '2026-07-30 06:00',
      userDisplayName: 'C Birder',
      loc: { locId: 'L9', locName: 'Somewhere Else', latitude: 47.1, longitude: -122.9 } },
  ];
  const seen = [];
  const app = await boot({
    fetch(url) {
      seen.push(String(url));
      if (/product\/lists\//.test(url)) return lists;
      if (/data\/obs\/L1\/recent/.test(url)) {
        return [{ speciesCode: 'sp0', comName: 'Bird 0', obsDt: '2026-07-31 08:00' }];
      }
      return null;
    },
  });
  const doc = app.window.document;
  app.window.__app.renderHot({
    hot: [{ locId: 'L1', name: 'Big Park', lat: 47.7, lng: -122.2, dist: 8,
            fresh: 2, checklists: 3, share: 5, latest: '2026-07-31',
            birds: [{ name: 'Bird 0', code: 'sp0', unseen: true }] }],
  });
  await new Promise((r) => setTimeout(r, 900));

  const card = doc.querySelector('#hotResults [data-hsloc]');
  const det = card.querySelector('.hsckl details.ckall');
  assert.ok(det, 'the card carries a collapsed checklist list');
  assert.ok(!det.open, 'collapsed — it is the evidence, not the decision');
  assert.match(det.querySelector('summary').textContent, /2 recent checklists/,
    'the summary counts only the checklists filed AT THIS HOTSPOT');
  const rows = det.querySelectorAll('.cklcard-sm');
  assert.equal(rows.length, 2, 'and lists them');
  assert.match(det.innerHTML, /S1/, 'each row links its checklist');
  assert.ok(!/Somewhere Else/.test(det.innerHTML),
    'another park\'s checklists are not this park\'s evidence');

  // The point of building it this way. product/lists is the per-county feed
  // Birdiest, Convoys and Happening now already share through one cached
  // promise, so indexing it by locId costs NOTHING — whereas one
  // product/lists/<locId> per card would be a call for every row of every
  // hotspot list in the app.
  const perLoc = seen.filter((u) => /product\/lists\/L1/.test(u));
  assert.equal(perLoc.length, 0,
    'no per-hotspot checklist fetch: the county feed already in memory has '
    + 'every row, and it carries the locId to index them by');
  app.window.close();
});

// "the ...and X more should be a link to expand and show the additional x more
// checklists." It was dead text stating a count the reader already had.
test('"…and N more" opens, and costs nothing until it does', async () => {
  const app = await boot();
  const A = app.window.__app, doc = app.window.document;

  let built = 0;
  const host = doc.createElement('div');
  host.innerHTML = A.checklistDetails(['<li class="cklcard cklcard-sm">shown</li>'],
    9, 'recent checklist', '',
    A.moreDetails(8, 'checklists', function () {
      built++;
      return '<ul class="cklcards"><li class="cklcard cklcard-sm">hidden row</li></ul>';
    }));
  doc.body.appendChild(host);

  const more = host.querySelector('details.ckmore');
  assert.ok(more, 'the count is a disclosure, not a dead line');
  assert.match(more.querySelector('summary').textContent, /…and 8 more checklists/,
    'and still states how many, because that was the useful half');

  // LAZY is the whole design. These caps exist because the enumeration is
  // expensive — one latest-ticks row reached 18 KB — so building the remainder
  // up front would hand all of that back for a disclosure most readers never
  // open.
  assert.equal(built, 0, 'the hidden rows are NOT built at render time');
  assert.ok(!/hidden row/.test(host.innerHTML), 'and are nowhere in the markup');

  more.querySelector('summary').dispatchEvent(
    new app.window.MouseEvent('click', { bubbles: true }));
  assert.equal(built, 1, 'opening it builds them, once');
  assert.match(host.innerHTML, /hidden row/, 'and they appear');

  more.querySelector('summary').dispatchEvent(
    new app.window.MouseEvent('click', { bubbles: true }));
  assert.equal(built, 1, 'closing and reopening does not rebuild them');

  // A count of zero is not a disclosure with nothing behind it — it is nothing.
  assert.equal(A.moreDetails(0, 'checklists', () => 'x'), '',
    'no remainder, no control');
  app.window.close();
});

// "often rare bird observations will contain waypoints, so id primarily like to
// highlight comments with waypoints because they clarify chasing. todays lark
// sparrow had a waypoint that pointed to a helipad in union bay hotspot"
//
// ...and why the plain note badge is suppressed on these lists:
//
// "rare birds require comments in observations, so all rare bird observations
// are not interesting, but some have chasing details like waypoints"
//
// The fixture is the REAL pair of comments on that bird, pulled from
// product/checklist/view on 2026-08-07. One carries a waypoint; the other is a
// perfectly good description that tells you nothing about where to stand. eBird
// made BOTH observers write something, so a "has a note" badge would appear on
// both and mean nothing on either.
const LARK_WP = '47.65798\u00b0 N, 122.29830\u00b0 W thanks Alec and Louis! Continuing '
  + 'sparrow with reddish well defined streaks on head.  Foraging on far side of '
  + 'helipad, viewable from parking lot side of helipad. Photos';
const LARK_PLAIN = 'Harlequin pattern of rusty brown and white. Light gray breast '
  + 'with dark spot on central breast.  Thanks Alec!!! Lifer';

test('a rarity checklist marks its media instantly, spending nothing', async () => {
  const asked = [];
  const app = await boot({
    fetch(url) {
      if (/product\/checklist\/view\//.test(url)) {
        asked.push(String(url));
        return { obs: [{ speciesCode: 'larspa', comments: 'a bird, no coordinates' }] };
      }
      return null;
    },
  });
  const A = app.window.__app, doc = app.window.document;
  // Twenty reports is an ordinary rarity: a good bird gets chased all week.
  const recs = [];
  for (let i = 0; i < 20; i++) {
    recs.push({ subId: 'S' + i, loc: 'Park', lat: 47.6, lng: -122.3,
                dateStr: '2026-08-0' + (1 + (i % 7)) + ' 08:00', observer: 'B' + i,
                evidence: ['P', 'A', 'V'][i % 3] });
  }
  const host = doc.createElement('div');
  host.innerHTML = A.rarityChecklistDetails({ code: 'larspa', recs });
  doc.body.appendChild(host);

  // THE POINT. The notable feed already said which reports carry a photo, a
  // recording or a video — `evidence`, present on 400 of 400 live WA rows. So
  // every mark is on screen before a single call is made. This used to cost
  // one product/checklist/view PER ROW, which eBird's token bucket serves at
  // ~0.37/s: twenty rows sat blank and filled in over the best part of a
  // minute, to print letters the app was already holding.
  const marked = [...host.querySelectorAll('.ckevid')]
    .filter((s) => s.textContent.trim());
  assert.equal(asked.length, 0, 'not one call');
  assert.equal(marked.length, 20, 'and every row is already marked');
  // The TYPE survives, which a bool like hasRichMedia could never carry.
  assert.equal(marked[0].textContent, '\u{1F4F7}', 'P is a photo');
  assert.equal(marked[1].textContent, '\u{1F50A}', 'A is a recording');
  assert.equal(marked[2].textContent, '\u{1F3A5}', 'V is a video, not a camera');

  // What a CALL still buys is the waypoint, and only the waypoint — the note
  // badge is suppressed here because eBird makes comments compulsory on a
  // flagged species. So the fetch is capped: the newest reports are the ones
  // you would drive to, and the twentieth from last Tuesday is not worth
  // 2.7 seconds of the shared token budget.
  const det = host.querySelector('details.ckall');
  det.open = true;
  await A.hydrateChecklistEvidence(det);
  await new Promise((r) => setTimeout(r, 900));
  assert.ok(asked.length <= A.CKL_EVID_MAX,
    `opening 20 rows costs at most ${A.CKL_EVID_MAX} calls, not 20`);
  assert.ok(asked.length > 0, 'but the waypoint hunt still happens');
  // And nothing the free pass painted was taken away by the slow one.
  assert.equal([...host.querySelectorAll('.ckevid')]
    .filter((s) => s.textContent.trim()).length, 20,
    'a row the fetch could not improve keeps the mark it already had');
  app.window.close();
});

test('a rarity checklist surfaces the waypoint, and only the waypoint', async () => {
  const asked = [];
  const app = await boot({
    fetch(url) {
      if (/product\/checklist\/view\//.test(url)) {
        asked.push(String(url));
        if (/S1/.test(url)) {
          return { obs: [{ speciesCode: 'larspa', mediaCounts: { P: 4 }, comments: LARK_WP }] };
        }
        return { obs: [{ speciesCode: 'larspa', comments: LARK_PLAIN }] };
      }
      return null;
    },
  });
  const A = app.window.__app, doc = app.window.document;
  const host = doc.createElement('div');
  host.innerHTML = A.rarityChecklistDetails({
    code: 'larspa',
    recs: [
      { subId: 'S1', loc: 'Union Bay Natural Area', lat: 47.658, lng: -122.298,
        dateStr: '2026-08-07 11:39', observer: 'Andrew Eller' },
      { subId: 'S2', loc: 'Union Bay Natural Area', lat: 47.658, lng: -122.298,
        dateStr: '2026-08-07 11:05', observer: 'Tom Gergen' },
    ],
  });
  doc.body.appendChild(host);

  // NOTHING is fetched until the list is opened. The note lives one
  // product/checklist/view call away per row, and that is the traffic this
  // project keeps refusing to spend on a disclosure nobody has touched.
  assert.equal(asked.length, 0, 'a closed list costs no calls');
  assert.equal(host.querySelectorAll('[data-ev-sub]').length, 2,
    'but every row carries what it would need to ask');

  const det = host.querySelector('details.ckall');
  det.open = true;
  await A.hydrateChecklistEvidence(det);
  await new Promise((r) => setTimeout(r, 600));

  const btns = [...host.querySelectorAll('.evidbtn')];
  assert.equal(btns.length, 1,
    'exactly ONE row earns a mark. Both observers wrote a comment because eBird '
    + 'made them; only one said where the bird was');
  assert.equal(btns[0].getAttribute('data-evid'), 'S1|larspa');
  assert.ok(btns[0].textContent.includes('\u{1F3AF}'), 'the waypoint is marked');
  assert.ok(btns[0].textContent.includes('\u{1F4F7}'), 'and the photos with it');

  // The mark OPENS the note. A waypoint you cannot tap is a fact you retype.
  A.openEvidence('S1|larspa');
  const sheet = doc.getElementById('appSheet');
  assert.equal(sheet.hidden, false, 'the sheet opens');
  assert.equal(sheet.querySelector('.sheettitle').textContent, 'Union Bay Natural Area');
  const body = sheet.querySelector('.sheetbody').innerHTML;
  assert.match(body, /data-q="47\.65798,-122\.2983"/,
    'with the waypoint as a maps link — and the longitude NEGATIVE, though the '
    + 'observer typed it positive with a W');
  assert.match(body, /helipad/, 'the note itself is readable in-app');
  assert.match(body, /photos/, 'and the media is named');

  A.hideSheet();
  assert.equal(sheet.hidden, true, 'and it closes');
  app.window.close();
});

// SPEC 2026-08-06: row 2 of the medium species card carries "number of reports
// (ONLY if more than 1), datetime of the latest observation, and all the icons
// — day #, unseen icon, unverified icon, media icon, number of observers."
//
// Today's rarities and Last 7-Days had each built this row independently from
// the same five span classes and had already drifted: only one showed the span,
// only one counted observers, and NEITHER showed the media mark.
test('the medium species card has one second row, and it obeys the spec', async () => {
  const app = await boot();
  const A = app.window.__app;

  // "ONLY if more than 1" — a card that IS one report must not say "1 report".
  const one = A.speciesMetaRow({ loc: 'Edmonds Marsh', when: 'Jul 31, 7:10 am',
    reports: 1, observers: 1 });
  assert.ok(!/1 report/.test(one), 'one report is what a row already is');
  assert.ok(!/1 observer/.test(one), 'and one observer likewise');

  const many = A.speciesMetaRow({ loc: 'Edmonds Marsh', when: 'Jul 31',
    reports: 6, observers: 4 });
  assert.match(many, /6 reports/, 'more than one is worth stating');
  assert.match(many, /4 observers/, 'and so is the crowd behind them');

  // A card that knows WHO must not degrade to a count of one.
  assert.match(A.speciesMetaRow({ observer: 'A Birder' }), /A Birder/,
    'a single report names its observer rather than saying "1 observer"');

  // The icons the spec lists, in the order the questions are asked.
  const full = A.speciesMetaRow({
    flags: '<span class="needflag">🔍</span><span class="stakeflag">📍 Day 3</span>⚠️',
    icons: '📷', loc: 'Edmonds Marsh', when: 'Jul 31', span: '4 days',
    reports: 6, observers: 4,
  });
  ['🔍', '📍 Day 3', '⚠️', '📷'].forEach((ic) => {
    assert.ok(full.indexOf(ic) > -1, 'row 2 carries ' + ic);
  });
  assert.ok(full.indexOf('📷') < full.indexOf('Edmonds Marsh'),
    'the evidence marks sit with the other flags, before the place');

  // Nothing is rendered empty. An absent fact is an absent span, not a blank.
  const bare = A.speciesMetaRow({ loc: 'Somewhere' });
  assert.ok(!/rareflags/.test(bare), 'no flags, no flag span');
  assert.ok(!/rarecount/.test(bare), 'no counts, no count span');
  assert.ok(!/rarespan/.test(bare), 'no span, no span span');
  assert.ok(!/undefined|NaN|null/.test(bare), 'and nothing leaks a placeholder');

  // The point of extracting it: both sections feed the SAME builder, so the
  // media mark that only ABA showed now reaches the two rarity sections.
  const src = HTML.slice(HTML.indexOf('function loadActiveRarities'),
    HTML.indexOf('function loadActiveRarities') + 8000);
  assert.match(src, /icons: BirdLogic\.recordIcons\(/,
    'Last 7-Days passes the evidence marks it always had in its feed');
  app.window.close();
});

// "in todays rarities, if i click on the species icon or name, then link to the
// checklist on ebird."
//
// A render probe, because the icon is not an <a> anywhere else in the app and
// the risk is layout: `.thumb` and `.extlink` set competing display/margin at
// EQUAL specificity, so which one wins is decided by source order — something
// no source regex can see.
test('Today\u2019s rarities: the icon and the name open the checklist', async () => {
  const app = await boot();
  const doc = app.window.document, w = app.window;
  const host = doc.createElement('ul');
  host.className = 'obs big xl';
  host.innerHTML = w.SpeciesCards.medium({
    icon: w.BirdIcons.photoSlot('Terek Sandpiper', 'tersan',
      'https://ebird.org/checklist/S12345'),
    name: '<a class="extlink" data-href="https://ebird.org/checklist/S12345">Terek Sandpiper</a>',
    tags: '', sub: 'somewhere',
  });
  doc.body.appendChild(host);

  const icon = host.querySelector('.thumb');
  assert.equal(icon.tagName, 'A', 'the icon is a link');
  assert.match(icon.getAttribute('data-href'), /checklist\/S12345/,
    'and it goes to the CHECKLIST, not the species page');
  assert.ok(icon.classList.contains('extlink'),
    'wearing the class the delegated opener listens for');
  assert.ok(icon.getAttribute('data-bird'),
    'and it is still a photo slot, so hydratePhotos still fills it');

  // The layout must be untouched. `.thumb` and `.extlink` set competing
  // display/margin at EQUAL specificity, so which wins is decided by source
  // order. If that ever flips, the icon becomes an 8px-margin inline-block and
  // the card head collapses. (In a MEDIUM card the thumb is a grid item, so
  // the thing to check is its box, not a float.)
  const cs = w.getComputedStyle(icon);
  const span = doc.createElement('span');
  assert.ok(/^(70px|calc)/.test(cs.width) || parseFloat(cs.width) >= 46,
    'the icon keeps the medium card\u2019s box, got width ' + cs.width);
  assert.ok(!/^8px/.test(cs.marginTop),
    'and did not inherit .extlink\u2019s 8px top margin (got ' + cs.marginTop + ')');
  assert.equal(cs.cursor, 'pointer', 'it looks tappable, because it is');
  void span;

  const name = host.querySelector('.ntext a');
  assert.match(name.getAttribute('data-href'), /checklist\/S12345/,
    'the name goes to the same checklist');

  // The section really wires it that way.
  const src = HTML.slice(HTML.indexOf('function refresh()'),
    HTML.indexOf('function refresh()') + 12000);
  assert.match(src, /photoSlot\(r\.name, r\.code, r\.subId \? checklistUrl\(r\.subId\)/,
    'Today\u2019s rarities passes the checklist url to the icon');
  assert.match(src, /r\.subId \? checklistLink\(r\.subId, r\.name\)/,
    'and links the name to it');
  assert.match(src, /: speciesLink\(r\.name, r\.code\)/,
    'a row with no submission id falls back to the species page rather than '
    + 'rendering a dead name');
  app.window.close();
});

// The generalised form of the bug behind "it doesn't seem to be using the
// medium hotspot card". A card of one family rendered inside a container that
// claims a DIFFERENT family gets the other family's geometry, because
// cards-species.js scopes some rules as three-class descendants
// (`.obs.big .name`) which outrank the hotspot card's own two-class
// `.hscard-md > .name`. The static class check elsewhere pins the five lists
// we know about; this one asks the BROWSER, so it also covers any list added
// later and any nesting the class check cannot see.
test('a hotspot card keeps its own layout wherever it is rendered', async () => {
  const app = await boot();
  const doc = app.window.document;
  const A = app.window.__app;
  const row = {
    n: 1, locId: 'L1', locName: 'Discovery Park', lat: 47.66, lng: -122.42,
    distMi: 8.1, facts: ['270 species all-time', 'latest Jul 30'],
    species: [{ code: 'merlin', name: 'Merlin' }],
  };
  // Every list in the app that hotspot cards are actually appended to.
  const ids = ['destResults', 'excResults', 'tripResults', 'quickResults', 'targetResults'];
  const checked = [];
  for (const id of ids) {
    const ul = doc.getElementById(id);
    assert.ok(ul, id + ' exists');
    ul.innerHTML = '';
    ul.appendChild(A.hotspotCard(row));
    const li = ul.firstElementChild;
    assert.ok(li && /hscard-md/.test(li.className),
      id + ': renders the medium hotspot card');

    // MEASURED, not assumed. jsdom does NOT apply the descendant rule
    // `.obs.big .name { display: flex }`, so asserting on `display` here looks
    // like coverage and silently passes even with the bug present — the first
    // version of this test did exactly that and had to be thrown away. It DOES
    // resolve the `>`-scoped rules, and `.obs.xl > li > .meta` sets
    // `grid-column: 2` where `.hscard-md > .meta` sets `1 / -1`. That single
    // value IS the reported symptom: the sub-header not spanning.
    const meta = li.querySelector(':scope > .meta');
    assert.ok(meta, id + ': the card has its sub-header');
    const col = app.window.getComputedStyle(meta).gridColumn;
    assert.equal(col, '1 / -1',
      id + ': the sub-header must span all three columns, got grid-column "'
      + col + '" — a species-card container class on this list outranks '
      + '.hscard-md and boxes the sub-header back into column 2');

    // The name block itself is only checked for existence: its font-size comes
    // from a rule that legitimately applies in both families, so it is not a
    // signal. grid-column above is.
    const name = li.querySelector(':scope > .name');
    assert.ok(name, id + ': the card has its name block');
    checked.push(id);
  }
  assert.equal(checked.length, ids.length, 'every hotspot list was checked');
  app.window.close();
});

// The other half of the same rule: the species cards NESTED inside a hotspot
// card (the "3 unseen 🔍" list) must keep the small species treatment. They
// live two levels down, so a descendant selector on the outer list is exactly
// what would reach them.
test('species cards nested inside a hotspot card keep the small treatment', async () => {
  const app = await boot();
  const doc = app.window.document;
  const A = app.window.__app;
  const ul = doc.getElementById('destResults');
  ul.innerHTML = '';
  ul.appendChild(A.hotspotCard({
    n: 1, locId: 'L1', locName: 'Discovery Park', lat: 47.66, lng: -122.42,
    distMi: 8.1, facts: ['x'], species: [{ code: 'merlin', name: 'Merlin' }],
  }));
  const nested = ul.querySelector('.sppl');
  assert.ok(nested, 'the unseen-species list renders inside the hotspot card');
  assert.match(nested.className, /card-sm/,
    'and declares the SMALL species size, not the big one');
  assert.ok(!/\bbig\b|\bxl\b/.test(nested.className),
    'a nested list must not claim a size its parent list also claims');
  app.window.close();
});




// ---------------------------------------------------------------- gallery --
// docs/CARDS.md maps every template to the sections that use it, and
// www/cards.html renders every template with sample data. Both are claims
// about the code, and a claim nobody checks is a claim that rots — which
// matters most for the four templates nothing in the app calls, since there is
// no section to notice when one of them breaks.
const CARDS_CHECKLIST = fs.readFileSync(path.join(WWW, 'cards-checklist.js'), 'utf8');
const CARDS_MD = fs.readFileSync(path.join(__dirname, '..', 'docs', 'CARDS.md'), 'utf8');
const GALLERY = fs.readFileSync(path.join(WWW, 'cards.html'), 'utf8');

// The families and the sizes each one actually exports.
const FAMILIES = {
  SpeciesCards: ['small', 'medium', 'large'],
  HotspotCards: ['small', 'medium', 'large', 'marker'],
  ChecklistCards: ['small', 'medium'],
};

test('the section gallery builds real cards, with no network', async () => {
  const SECTIONS = fs.readFileSync(path.join(WWW, 'sections.html'), 'utf8');

  // Same invariant as the app and the card gallery.
  assert.ok(!/https?:\/\/(?!ebird\.org)/.test(
    SECTIONS.replace(/https?:\/\/www\.w3\.org[^"']*/g, '')),
    'the section gallery loads nothing off the network');
  assert.ok(!/fetch\(|XMLHttpRequest/.test(SECTIONS),
    'and makes no calls of its own');

  // It must call the REAL card builders. A gallery that hand-rolls its own
  // markup drifts from the app silently, which is the whole failure this
  // family of files exists to prevent.
  for (const call of ['SpeciesCards.medium(', 'HotspotCards.medium(', 'ChecklistCards.small(']) {
    assert.ok(SECTIONS.includes('window.' + call),
      'the section gallery builds rows with ' + call);
  }

  // And it must pass the arguments those templates actually read. The first
  // version invented rank/when/who/where, so every hotspot and checklist row
  // rendered as empty placeholders — which looks like a layout bug and is not
  // one. Assert the real key names.
  for (const key of ['num:', 'place:', 'distMi:', 'unseenLabel:']) {
    assert.ok(SECTIONS.includes(key),
      'the section gallery passes ' + key + ' - the key the template reads');
  }
  // distance AND distMi together printed the mileage twice.
  assert.ok(!/distance:\s*'\d/.test(SECTIONS),
    'distance is left to distMi, so the mileage is not printed twice');

  // A section this gallery has NOT mirrored must say so on its face. Sketch
  // content that looks finished is the trap: you would tune a layout the app
  // does not have, which is exactly what the invented card arguments above
  // nearly caused. Greyed, badged, and captioned - all three.
  assert.ok(SECTIONS.includes('todo: true'),
    'unmirrored sections are marked, not quietly omitted');
  assert.ok(/\.sec\.todo\s*\{[^}]*opacity/.test(SECTIONS),
    'a sketch is visibly greyed');
  assert.ok(SECTIONS.includes('sketch'),
    'a sketch carries a badge saying so');
  assert.ok(SECTIONS.includes('not its layout'),
    'and says in words that it is content, not layout');

  // Every sketch must actually carry stub content: a greyed EMPTY section
  // reads as "this section is empty in the app", which is a different and
  // wrong claim.
  //
  // Counts `todo: true,` WITH the comma — the property as written in a section
  // entry. Counting the bare phrase also matched the comment above the list
  // that explains what the flag means, which reported one sketch more than
  // exists.
  const sketches = (SECTIONS.match(/todo: true,/g) || []).length;
  const stubs = (SECTIONS.match(/stub: \[/g) || []).length;
  assert.equal(stubs, sketches,
    'every sketched section has stub data (' + sketches + ' sketches, ' + stubs + ' stubs)');
});

test('the card gallery renders every template, with no network', async () => {
  const app = await boot();
  const w = app.window;
  // Every family the gallery loads must actually be on the page it loads them
  // from, or the gallery is showing a stale copy of the app's shapes.
  for (const [family, sizes] of Object.entries(FAMILIES)) {
    assert.ok(w[family], family + ' is a global the gallery can read');
    for (const size of sizes) {
      assert.equal(typeof w[family][size], 'function',
        family + '.' + size + '() exists');
    }
  }
  // The gallery must render all of them — including the unused four.
  const total = Object.values(FAMILIES).reduce((a, s) => a + s.length, 0);
  for (const [family, sizes] of Object.entries(FAMILIES)) {
    for (const size of sizes) {
      assert.ok(GALLERY.includes("size: '" + size + "'"),
        'the gallery has a ' + size + ' entry');
      assert.ok(GALLERY.includes("family: '" + family + "'"),
        'the gallery has a ' + family + ' group');
    }
  }
  // Every template must appear; extra entries are allowed because a template
  // can have more than one state worth seeing. The small species card is
  // shown three times on purpose — with a bundled photo, with the shared
  // fallback image, and with no picture at all (.thumb.nopic collapses the
  // slot). A gallery that only ever renders the happy path cannot tell you
  // the fallback is too dark or that a collapsed row loses its gutter.
  //
  // The per-template loop above is what guards coverage; this only guards
  // against a template silently disappearing from the count.
  assert.ok((GALLERY.match(/size: '/g) || []).length >= total,
    'the gallery has at least one entry per template (' + total + ')');
  // NO RUNTIME GITHUB OR NETWORK DEPENDENCY, same invariant as the app.
  assert.ok(!/https?:\/\/(?!ebird\.org)/.test(GALLERY.replace(/https?:\/\/www\.w3\.org[^"']*/g, '')),
    'the gallery loads nothing off the network');
  assert.ok(!/fetch\(|XMLHttpRequest/.test(GALLERY.replace(/w\.fetch/g, '')),
    'and makes no calls of its own');
  app.window.close();
});

test('docs/CARDS.md matches the code it documents', () => {
  // 1. Every template that exists is documented, and nothing else is.
  for (const [family, sizes] of Object.entries(FAMILIES)) {
    assert.ok(CARDS_MD.includes('`' + family + '`'), family + ' is documented');
    for (const size of sizes) {
      assert.ok(new RegExp('\\|\\s*`' + size + '`\\s*\\|').test(CARDS_MD),
        family + '.' + size + ' has a row in the mapping table');
    }
  }

  // 2. The "unused" claims are TRUE. This is the half that rots: a template
  //    picked up by a new section stays labelled unused for a year otherwise.
  const src = { SpeciesCards: HTML, HotspotCards: HTML, ChecklistCards: HTML };
  const documentedUnused = [
    // SpeciesCards.large left this list on 2026-08-18: My year switched to it.
    // This is exactly the rot the check exists to catch - a template picked up
    // by a new section and still labelled unused a year later.
    // HotspotCards.marker briefly left it and came back the same day: the
    // Stakeout "By odds" rows DO carry a number, but build() computes the badge
    // from v.num and ignores a `marker` passed in, so calling it was the bug.
    ['HotspotCards', 'large'],
    ['HotspotCards', 'marker'],
  ];
  for (const [family, size] of documentedUnused) {
    const calls = (src[family].match(
      new RegExp(family + '\\.' + size + '\\(', 'g')) || []).length;
    assert.equal(calls, 0,
      'docs/CARDS.md calls ' + family + '.' + size + ' unused, but index.html '
      + 'calls it ' + calls + ' time(s) — update the doc');
  }
  // ...and everything the doc does NOT list as unused must actually be used.
  const unusedSet = new Set(documentedUnused.map(([f, s]) => f + '.' + s));
  for (const [family, sizes] of Object.entries(FAMILIES)) {
    for (const size of sizes) {
      if (unusedSet.has(family + '.' + size)) continue;
      const calls = (src[family].match(
        new RegExp(family + '\\.' + size + '\\(', 'g')) || []).length;
      assert.ok(calls > 0,
        family + '.' + size + ' is no longer called anywhere — either restore '
        + 'its caller or move it to the "unused" list in docs/CARDS.md');
    }
  }

  // 3. The builders the doc names must exist, or the mapping points nowhere.
  for (const fn of ['speciesListHtml', 'hotspotCard', 'unseenPlacesHtml',
                    'rarityChecklistDetails', 'lastNewCard', 'loadBirdiest',
                    'loadRecentLists', 'speciesPlacesCard', 'renderSpeciesLookup',
                    'loadActiveRarities']) {
    assert.ok(CARDS_MD.includes('`' + fn + '`'), fn + ' is named in the mapping');
    assert.ok(HTML.includes('function ' + fn + '('),
      'docs/CARDS.md names ' + fn + ' as a builder, but it does not exist');
  }
});

// A dozen ABA megararities is a dozen full-screen profiles, and there was no
// way to see WHICH birds the section held without scrolling every one of them.
// The ABA section is the SPECIES LIST. Each profile is a full screen — latest
// report, finder, every report we hold, state history — so a dozen
// megararities was a dozen screens to scroll past before you knew which birds
// were even in it. A bird opens as a SUB-PAGE over the list.
test('the ABA alert shows a species list, and a bird opens as a sub-page', async () => {
  const app = await boot();
  const doc = app.window.document;
  const A = app.window.__app;
  const rows = [
    { speciesCode: 'tersan', comName: 'Terek Sandpiper', obsDt: '2026-08-02 09:00',
      locName: 'Stanwood', lat: 48.2, lng: -122.3, subId: 'S1', howMany: 1 },
    { speciesCode: 'whiwag', comName: 'White Wagtail', obsDt: '2026-08-01 07:30',
      locName: 'Neah Bay', lat: 48.4, lng: -124.6, subId: 'S2', howMany: 1 },
    { speciesCode: 'litgul', comName: 'Little Gull', obsDt: '2026-07-30 16:00',
      locName: 'Ocean Shores', lat: 46.9, lng: -124.1, subId: 'S3', howMany: 2 },
  ];
  A.renderAbaAlert(rows, 'https://ebird.org/alert/summary?sid=X', true);

  // 1. The section shows the LIST, and only the list.
  const list = doc.getElementById('abaResults');
  const detail = doc.getElementById('abaDetail');
  assert.equal(list.hidden, false, 'the species list is what the section shows');
  assert.equal(detail.hidden, true, 'and no profile is open');
  const items = [...list.querySelectorAll('ul.obs.card-sm > li')];
  assert.equal(items.length, 3, 'one entry per species, not per report');
  assert.ok(list.querySelector('ul.obs.card-sm'), 'built from the small species card');
  // Every row carries BOTH ways in: the name, and a chevron at the RIGHT EDGE
  // — a bare name does not look like it opens anything.
  items.forEach((li) => {
    assert.ok(li.querySelector('.ntext a.abajump'), 'the name opens the profile');
    const go = li.querySelector('.name > a.spgo.abajump');
    assert.ok(go, 'and so does the chevron at the right edge of the row');
    assert.ok((go.getAttribute('aria-label') || '').length > 6,
      'which names itself, since "›" reads as nothing');
  });
  const jumps = items.map((li) => li.querySelector('.ntext a.abajump'));
  // Newest first — a list in a different order than the thing it indexes is
  // worse than no list.
  assert.deepEqual(JSON.stringify(jumps.map((a) => a.textContent)),
    JSON.stringify(['Terek Sandpiper', 'White Wagtail', 'Little Gull']),
    'newest first');
  // The profiles exist but are put away.
  const cards = doc.getElementById('abaDetailCards');
  assert.equal(cards.children.length, 3, 'every profile is built');
  [...cards.children].forEach((c) => assert.equal(c.hidden, true, 'and hidden'));

  // 2. Tapping a name opens THAT bird, over the list.
  const ev = new app.window.MouseEvent('click', { bubbles: true, cancelable: true });
  jumps[1].dispatchEvent(ev);
  assert.ok(ev.defaultPrevented, 'handled here, not by the browser — a hash '
    + 'change would fight showSection()');
  assert.equal(detail.hidden, false, 'the sub-page opens');
  assert.equal(list.hidden, true, 'and the list goes away, rather than the '
    + 'profile being the tenth thing you scroll past');
  assert.equal(doc.getElementById('aba-whiwag').hidden, false, 'the bird you tapped');
  assert.equal(doc.getElementById('aba-tersan').hidden, true, 'and only that one');
  assert.match(doc.getElementById('navTitle').textContent, /White Wagtail/,
    'the navbar names where you are');

  // 3. Back means UP ONE LEVEL, not all the way out.
  assert.match(doc.getElementById('navBack').getAttribute('aria-label') || '',
    /rarities list/i, 'and the back button says so');
  // Entering the section first makes "back does not leave it" a real claim:
  // from the menu, everything is hidden and the assertion would be vacuous.
  A.showSection('sec-abaBtn');
  A.abaOpenBird('whiwag');
  assert.equal(doc.getElementById('menuPanel').hidden, true, 'we are in the section');
  A.navBack();
  assert.equal(detail.hidden, true, 'back closes the sub-page');
  assert.equal(list.hidden, false, 'and returns to the list');
  assert.equal(doc.getElementById('menuPanel').hidden, true,
    'without leaving the section entirely — back is UP ONE LEVEL, not all the way out');
  A.navBack();
  assert.equal(doc.getElementById('menuPanel').hidden, false,
    'and a second back, with no sub-page open, does leave for Contents');
  assert.match(doc.getElementById('navBack').getAttribute('aria-label') || '',
    /contents/i, 'and back now means Contents again');
  app.window.close();
});

// Leaving the section must forget the sub-page, or coming back later lands you
// on a bird's profile with no memory of having chosen it.
test('navigating away closes the ABA sub-page', async () => {
  const app = await boot();
  const doc = app.window.document;
  const A = app.window.__app;
  A.renderAbaAlert([
    { speciesCode: 'tersan', comName: 'Terek Sandpiper', obsDt: '2026-08-02 09:00',
      locName: 'Stanwood', lat: 48.2, lng: -122.3, subId: 'S1', howMany: 1 },
  ], 'https://ebird.org/alert/summary?sid=X', true);
  assert.ok(A.abaOpenBird('tersan'), 'the bird opens');
  assert.equal(doc.getElementById('abaDetail').hidden, false);
  A.showSection('sec-refreshBtn');
  assert.equal(doc.getElementById('abaDetail').hidden, true, 'and is put away on leaving');
  assert.equal(doc.getElementById('abaResults').hidden, false, 'with the list restored');
  app.window.close();
});

// "I previously asked to merge the destinations and excursions, but this was a
// mistake." Two top-level sections had become options inside a THIRD section's
// control, so finding "excursions" meant knowing it lived on the Quick outing
// panel. They are menu entries again, grouped with the other place-finders.
test('the place-finding sections are top-level, and grouped as Go birding', async () => {
  const app = await boot({ storage: { ebird_home_lat: '47.75', ebird_home_lng: '-122.16' } });
  const doc = app.document;
  // Trip planner is deliberately absent: switched off behind `enabled: false`
  // pending a redesign. The section, its panel and its loader all still exist,
  // so this is a hidden entry rather than a deleted one — see menuOmittedAts
  // in report-contract.json, which is where that fact lives.
  // Scout LEFT the menu on 2026-08-18: "i don't like that there are two menus
  // for the identical behavior" - looking a place up already lives inside
  // Find local patches, which has its own place box (#quickHerePlace). The
  // panel is still in the DOM but hidden, and hidden is load-bearing: a section
  // with no menu entry is not managed by showSection, so without it the app
  // booted with a panel already open.
  //
  // Stakeout bird joins them instead, and last: the others answer "where shall
  // I go", it answers "I know the bird already - where do I stand and wait".
  // Producing and Under-birded patches joined on 2026-08-18: they answer the
  // same question the rest of this group answers - "where shall I go" - and
  // sitting them under Hotspots & birders separated them from it.
  // F156 added 'Iconic spots near me' beside Stakeout bird: the two are halves
  // of one thought — that one starts from a BIRD and finds the place, this one
  // starts from where you ARE and finds what the places round you are known for.
  const GO = ['destBtn', 'excBtn', 'quickBtn', 'targetsBtn', 'spLookupBtn',
              'iconicBtn', 'hotBtn', 'coldBtn'];

  // 1. Each is its own section, reachable from the menu on its own.
  const labels = [...doc.querySelectorAll('#menuList .toclink')]
    .map((b) => b.getAttribute('aria-label'));
  for (const want of ['Today', 'Day-trip patches', 'Find local patches',
                      'Closest unseen birds', 'Stakeout bird', 'Iconic spots near me',
                      'Producing patches', 'Under-birded patches']) {
    assert.ok(labels.some((l) => l && l.includes(want)),
      want + ' has its own tile in Contents');
  }
  assert.ok(!labels.some((l) => l && l.includes('Trip planner')),
    'Trip planner is switched off, so it has no tile');
  assert.ok(!labels.some((l) => l && l.includes('Look up a place')),
    'Look up a place is a duplicate of the place box inside Find local patches');

  // 2. They sit under one heading, contiguously — a group with a gap in it is
  //    not a group, it is a coincidence.
  const kids = [...doc.querySelectorAll('#menuList > li')];
  const headIdx = kids.findIndex((k) => k.classList.contains('tocgroup')
    && /go birding/i.test(k.textContent));
  assert.ok(headIdx > -1, 'there is a Go birding heading');
  const under = [];
  for (let i = headIdx + 1; i < kids.length; i++) {
    if (kids[i].classList.contains('tocgroup')) break;
    under.push(kids[i].querySelector('.toclink').getAttribute('aria-label'));
  }
  assert.equal(under.length, GO.length,
    'exactly the place-finding sections sit under it, got: ' + under.join(' | '));

  // 3. The MENU ARRAY order is a contract with the Markdown report and is
  //    never touched. Grouping changes only the LAYOUT: a group collects its
  //    members wherever they sit, because "eBird Rankings" belongs with My
  //    year even though the report prints it third. What must hold is that
  //    every entry declares a group the renderer knows how to place.
  const order = [...HTML.matchAll(/\{ at: '([A-Za-z0-9_]+)',[^\n]*group: '([^']+)'/g)]
    .map((m) => ({ at: m[1], group: m[2] }));
  // DERIVED, not a hard-coded 26. The count is not the property being tested —
  // "every entry declares a group" is — and pinning a number here means adding
  // a section fails a test about grouping for a reason that has nothing to do
  // with grouping.
  const declared = (HTML.match(/\{ at: '[A-Za-z0-9_]+',/g) || []).length;
  assert.equal(order.length, declared, 'every menu entry declares a group');
  const known = /var MENU_GROUPS = \[([\s\S]*?)\];/.exec(HTML);
  assert.ok(known, 'the group order is DECLARED, not derived from position — '
    + 'a group whose members are scattered has no position to derive from');
  const groupNames = [...known[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const e of order) {
    assert.ok(groupNames.includes(e.group),
      e.at + ' is in group "' + e.group + '", which MENU_GROUPS does not place '
      + '— it would render nowhere at all');
  }
  app.window.close();
});

// The Quick outing panel is about ONE question: which anchor to measure from.
test('quick outing offers only its three anchors, and asks for a place only when told to', async () => {
  const app = await boot({
    fetch(url) {
      if (/nominatim/.test(url)) return [{ lat: '47.61', lon: '-122.33', display_name: 'Seattle' }];
      if (/ref\/hotspot\/geo/.test(url)) return [];
      return [];
    },
    storage: { ebird_home_lat: '47.75', ebird_home_lng: '-122.16' },
  });
  const doc = app.document;
  const sec = doc.getElementById('sec-quickBtn');
  const chips = [...sec.querySelectorAll('.modeswitch .modebtn')]
    .map((b) => b.getAttribute('data-goto'));
  assert.deepEqual(JSON.stringify(chips),
    JSON.stringify(['quick:here', 'quick:home', 'quick:find']),
    'here, home, find — and nothing that is really a different section');
  for (const gone of ['sec-destBtn', 'sec-excBtn', 'sec-tripBtn']) {
    assert.ok(!chips.includes(gone), gone + ' is a section, not a quick-outing mode');
  }

  // The two anchor buttons are the SAME state the chips carry, so they are
  // kept for their handlers but never shown: two controls for one choice is
  // how this panel came to have a dropdown AND a button pair on screen.
  assert.ok(doc.getElementById('quickBtn'), 'the loader button still exists');
  assert.equal(doc.getElementById('quickBtn').closest('.row').hidden, true,
    'but its row is hidden — the chips are the control now');

  // The place box belongs to Find alone. It used to be a permanent third row,
  // so the panel asked for an address every time you opened it to look near
  // home — and a failed geolocation opened it and nothing ever closed it.
  const row = doc.getElementById('quickHereRow');
  assert.equal(row.hidden, true, 'no address box before it is asked for');
  app.window.__app.loadQuickOuting('home');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(row.hidden, true, 'still none when looking near home');
  sec.querySelector('.modebtn[data-goto="quick:find"]')
    .dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(row.hidden, false, 'Find opens it');
  app.window.__app.loadQuickOuting('home');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(row.hidden, true, 'and going back to Home closes it again');
  app.window.close();
});

// Requests that arrived in another session and were nearly lost. Pinned
// together because they are one idea: a checklist row is a ROW YOU TAP.
test('a checklist row is the requested one-liner, and the whole row is the link', async () => {
  const CK = require(require('node:path')
    .join(__dirname, '..', 'www', 'cards-checklist.js'));

  // The row as it was asked for, to the character:
  //   "33014 NE 138th St. Aug 3 5:14AM x3 12.4mi"
  const row = CK.small({
    place: '33014 NE 138th St', href: 'https://ebird.org/checklist/S1',
    date: 'Aug 3 5:14 AM', count: 3, distMi: 12.4,
  });
  const app = await boot();
  const d = app.window.document;
  d.body.insertAdjacentHTML('beforeend', '<ul class="cklcards cklcards-sm">' + row + '</ul>');
  const li = d.querySelector('body > ul.cklcards-sm > li.cklcard-sm');
  const txt = li.textContent.replace(/\s+/g, ' ').trim();
  assert.match(txt, /33014 NE 138th St/, 'the hotspot name leads');
  assert.match(txt, /8\/3 5:14a/, 'then when — numerically, to leave room for the name');
  // Three birds is worth knowing; one is not. The rule changed from "never"
  // to "only when greater than one" - see the checklist card for why both
  // requests were right about different numbers.
  assert.match(txt, /×3/, 'a count of three is hidden, which is information lost');
  assert.match(txt, /12\.4 mi/,
    'then how far, to ONE DECIMAL — it used to round anything over 10mi to '
    + '"12 mi", and on a list you scan to pick a drive the tenth is what '
    + 'separates two hotspots ten minutes apart');

  // The WHOLE ROW is the link, not just the name: on a phone the name is a
  // ~10px target in a 30px row and the rest looked tappable but was not.
  assert.equal(li.getAttribute('data-href'), 'https://ebird.org/checklist/S1',
    'the row carries the checklist link');
  // ...via data-href, NOT by wrapping the row in an <a>: the row also holds a
  // map pin, and an <a> inside an <a> is invalid HTML that browsers silently
  // un-nest, which would break the pin.
  assert.ok(!/^<li[^>]*>\s*<a /.test(row), 'the row is not wrapped in an anchor');
  // The name stays a REAL link so keyboard and screen-reader users get one.
  assert.ok(li.querySelector('a.ckgo'), 'the name is still a proper link');
  assert.match(CK.css, /\.cklcard-sm\[data-href\] \{ cursor: pointer/,
    'and the row looks tappable, because it is');

  // The handler must let a real link inside the row win, or the map pin would
  // open the checklist instead of the map.
  const src = HTML.slice(HTML.indexOf(".cklcard-sm[data-href]'"),
    HTML.indexOf(".cklcard-sm[data-href]'") + 400);
  assert.match(src, /!ev\.target\.closest\('a'\)/,
    'a click on a link inside the row is left alone');
  app.window.close();
});

// The unseen birds are the finding; the already-seen list is the context it is
// contrasted with — and at a busy convoy it was the longer of the two.
test('the convoy already-seen list is collapsed', () => {
  // Not scoped to renderConvoys: the species split is filled in by a later
  // hydration pass, several functions away from where the card is built.
  assert.match(HTML, /<details class="convoyseen"><summary>Already seen this year/,
    'it is a collapsed <details>, not an always-open block');
  assert.ok(!/<div class="convoyhead">Already seen this year/.test(HTML),
    'and the old always-open heading is gone, not merely bypassed');
  assert.match(HTML, /\.convoyseen > summary \{/, 'and it is styled as one');
});

// "In the birder convoy section, id like the list of stops to use the small
// hotspot card. each stop should show the number icon corresponding to the stop
// on the map. if possible, show a different color theme for map pins for each
// convoy."
//
// A render probe, not a source scan: HotspotCards.small had NO caller before
// this — docs/CARDS.md listed it as unused — so its markup had never been
// exercised against a real stack, and the failure mode is layout that only
// exists at runtime.
test('convoy stops render as small hotspot cards, numbered to match the map', async () => {
  const app = await boot();
  const A = app.window.__app, doc = app.window.document;
  const stop = (name, lat, lng, sub, t) => ({
    locId: 'L' + sub, subId: 'S' + sub, _subs: ['S' + sub], obsTime: t,
    numSpecies: 21, loc: { locName: name, name: name, latitude: lat, longitude: lng }
  });
  const routes = [
    { day: '2026-07-30', members: ['a', 'b'],
      stops: [stop('Edmonds Marsh', 47.80, -122.38, 1, '07:10'),
              stop('Marina Beach Park', 47.81, -122.39, 2, '08:20')] },
    { day: '2026-07-29', members: ['c', 'd'],
      stops: [stop('Juanita Bay Park', 47.70, -122.22, 3, '09:00'),
              stop('Marymoor Park', 47.66, -122.11, 4, '10:15')] }
  ];
  A.renderConvoys(routes, []);

  const cards = [...doc.querySelectorAll('#convoyResults .hscard-sm')];
  assert.equal(cards.length, 4, 'every stop is a small hotspot card');
  assert.ok(!doc.querySelector('#convoyResults ul.obs.dest'),
    'and the hand-rolled list it replaced is gone, not merely hidden');

  // The number is the whole point: it is what ties a row to a pin.
  const nums = [...doc.querySelectorAll('#convoyResults .hscard-sm .hsnum')]
    .map((e) => e.textContent.trim());
  assert.deepEqual(nums, ['1', '2', '1', '2'],
    'each convoy numbers its own stops from 1, exactly as its own map does');

  // Per-convoy tone. Colour is the SECONDARY cue — the number above already
  // carries the map correspondence — so this asserts the two convoys differ,
  // not that either wears a particular colour.
  const wraps = [...doc.querySelectorAll('#convoyResults .convoywrap')];
  const toneOf = (w) => w.querySelector('.hsnum').getAttribute('style');
  assert.notEqual(toneOf(wraps[0]), toneOf(wraps[1]),
    'two convoys on one screen are two colours');
  assert.match(toneOf(wraps[0]), /^--pin:\s*#[0-9a-f]{6}/i,
    'delivered as a CSS variable, so the palette has one definition');
  assert.equal(A.pinTone(A.PIN_TONES.length), A.PIN_TONES[0],
    'and the palette cycles rather than running out');

  // Nothing the old markup carried may have been dropped on the way.
  const first = wraps[0].querySelector('.hscard-sm').innerHTML;
  assert.match(first, /Edmonds Marsh/, 'the place is still named');
  assert.match(first, /07:10/, 'and still says when they were there');
  assert.match(first, /21 sp/, 'and how many species they logged');
  assert.match(first, /S1/, 'and still links its checklist');
  assert.match(first, /data-q="47\.8,-122\.38"/, 'and still opens a map');
  app.window.close();
});

// "Remove the Load latest ticks button, since there's already a refresh
// button" — and the same complaint had already been made about Birdiest
// checklists. Rather than fix them one at a time, this asserts the RULE for
// every section at once.
test('no section shows a bare Load button — every loader is the refresh icon', async () => {
  const app = await boot();
  const doc = app.document;
  const win = app.window;
  const LOADERS = ['refreshBtn', 'targetsBtn', 'allUnseenBtn', 'spLookupBtn', 'destBtn',
    'excBtn', 'tripBtn', 'cklBtn', 'quickBtn', 'surgeBtn', 'wxBtn', 'rankBtn',
    'activeBtn', 'abaBtn', 'lastNewBtn', 'hotBtn', 'coldBtn', 'convoyBtn',
    'easyBtn', 'migBtn', 'todBtn'];
  const visible = [], noIcon = [];
  for (const id of LOADERS) {
    const b = doc.getElementById(id);
    if (!b) continue;
    const row = b.closest('.row'), sec = b.closest('section');
    // Species lookup is driven by TYPING, not by a load button — its row is
    // the search box and must stay visible. The one exception, named rather
    // than silently tolerated.
    if (id === 'spLookupBtn') {
      assert.equal(row.hidden, false, 'the species search box stays on screen');
      continue;
    }
    // Computed display rather than the `hidden` property. This test used to
    // assert `row.hidden === true` and passed for days while every one of
    // these buttons was still on screen: `hidden` is a UA-stylesheet
    // `display: none` and `.row { display: flex }` silently outvotes it, so
    // the property said "hidden" and the row rendered anyway.
    //
    // BE HONEST ABOUT WHAT THIS CATCHES: jsdom does NOT reproduce that
    // cascade conflict — it reports `none` here with or without the fix, so
    // this line alone would still have missed the bug. The guard that really
    // holds the fix is 'hidden means hidden, whatever else sets display',
    // which pins the rule itself and fails when it is removed. This check is
    // kept for the OTHER half of the question: that the row is marked hidden
    // at all, in whichever section grows a Load button next.
    if (row && win.getComputedStyle(row).display !== 'none') visible.push(id);
    // Quick outing has no icon because its mode chips ARE the reload: tapping
    // the anchor you are already on re-runs it.
    if (id !== 'quickBtn' && sec && !sec.querySelector('.refreshbtn')) noIcon.push(id);
  }
  assert.deepEqual(JSON.stringify(visible), JSON.stringify([]),
    'these sections still show a wide Load button: ' + visible.join(', '));
  assert.deepEqual(JSON.stringify(noIcon), JSON.stringify([]),
    'these sections have no refresh icon to replace it: ' + noIcon.join(', '));
  app.window.close();
});

// The rule the test above depends on, pinned on its own — and this is the
// guard that actually holds it. Removing the rule fails THIS test; it does not
// fail the computed-display check above, because jsdom does not reproduce the
// cascade conflict that caused the bug. Mutation-verified, both ways.
test('hidden means hidden, whatever else sets display', async () => {
  const app = await boot();
  const win = app.window, doc = app.document;
  assert.match(HTML, /\[hidden\] \{ display: none !important; \}/,
    'ONE global rule, not a per-element patch each time someone hits it — '
    + 'this file carried five of those before it (navbar, keybanner, '
    + 'abaCapWarn, sectiondoc, debugPanel), each added on a separate day');
  // `.row` is the class that actually caused it: it sets `display: flex`,
  // which outvotes the UA stylesheet's `[hidden] { display: none }`.
  assert.match(HTML, /\.row \{ display: flex/,
    '.row sets display, which is what defeated `hidden` before the rule above');
  // Every one of these must honour `hidden`, whether or not it sets display
  // today — the next rule someone adds must not be able to bring the bug back.
  for (const cls of ['row', 'panel', 'obs', 'modeswitch']) {
    const el = doc.createElement('div');
    el.className = cls;
    el.hidden = true;
    doc.body.appendChild(el);
    assert.equal(win.getComputedStyle(el).display, 'none',
      '.' + cls + ' honours `hidden`');
    el.remove();
  }
  app.window.close();
});

// The distance is the one number on a card that answers "can I go", so it is
// also the thing that takes you. All three medium cards, one mechanism.
test('the medium cards centre the name and make the distance open maps', () => {
  const P = require('node:path').join(__dirname, '..', 'www');
  const S = require(P + '/cards-species.js');
  const H = require(P + '/cards-hotspot.js');
  const C = require(P + '/cards-checklist.js');
  const Q = '47.66,-122.42';

  // 1. The name cell is vertically centred in its row, in all three.
  assert.match(S.css, /> \.ntext \{[\s\S]{0,260}align-self: center/,
    'species: the name is centred against the photo beside it');
  assert.match(H.css, /\.hscard-md > \.name > \.ntext \{[\s\S]{0,280}align-self: center/,
    'hotspot: the name is centred against the badge and the distance');
  assert.match(C.css, /\.ckhead \{[^}]*align-items: center/,
    'checklist: the head row is centred, not baseline-aligned');

  // 2. The distance opens maps when the caller knows where the place is.
  assert.match(S.medium({ name: 'x', distMi: 8.1, distQ: Q }),
    /<a class="spdist maplink" data-q="47\.66,-122\.42"/, 'species distance is a map link');
  assert.match(H.medium({ name: 'x', distance: 8.1, distQ: Q }),
    /<a class="hsdist maplink" data-q="47\.66,-122\.42"/, 'hotspot distance is a map link');
  assert.match(C.small({ place: 'p', distMi: 4.2, distQ: Q }),
    /<a class="ckdist maplink" data-q="47\.66,-122\.42"/, 'checklist distance is a map link');

  // 3. Inert when we do NOT know where it is — a link that goes nowhere is
  //    worse than plain text.
  assert.match(S.medium({ name: 'x', distMi: 8.1 }), /<span class="spdist">/, 'no coordinate, no link');
  assert.match(H.medium({ name: 'x', distance: 8.1 }), /<span class="hsdist">/);
  assert.match(C.small({ place: 'p', distMi: 4.2 }), /<span class="ckdist">/);

  // 4. The card TAGS the element; it does not build a URL. Map-provider choice
  //    lives in index.html with the rest of the routing.
  for (const [n, m] of [['species', S], ['hotspot', H], ['checklist', C]]) {
    assert.ok(!/maps\.google|google\.com\/maps|apple\.com\/maps/.test(m.css),
      n + ' card must not know how to build a map URL');
  }

  // 5. A coordinate is VALIDATED, not escaped — these files have no escaper.
  const bad = S.medium({ name: 'x', distMi: 1, distQ: '47.6,-122.4" onerror=alert(1)' });
  assert.ok(!/onerror/.test(bad), 'a value that is not a coordinate cannot survive');
  assert.match(/data-q="([^"]*)"/.exec(bad)[1], /^[0-9.,-]*$/, 'only coordinate characters remain');

  // 6. `.maplink`'s 8px top margin is undone, or the number would drop below
  //    the name it is aligned with.
  assert.match(S.css, /a\.spdist[^{]*\{[^}]*margin-top: 0/, 'species distance keeps its position');
  assert.match(H.css, /a\.hsdist \{ margin-top: 0/, 'hotspot distance keeps its position');
  assert.match(C.css, /a\.ckdist \{ margin-top: 0/, 'checklist distance keeps its position');
});

// The big picture on an ABA profile is a SLOT until something fills it, and
// nothing ever asked — so every profile showed a grey box where the bird
// should be. Same for the small icons in the list.
test('the ABA section hydrates its photos', () => {
  const open = HTML.slice(HTML.indexOf('function abaOpenBird('),
    HTML.indexOf('function abaCloseBird('));
  assert.match(open, /hydratePhotos\(card\)/, 'the profile photo is filled when opened');
  const render = HTML.slice(HTML.indexOf('function renderAbaAlert('),
    HTML.indexOf('function renderAbaAlert(') + 5000);
  assert.match(render, /hydratePhotos\(el\)/, 'and the list icons when the list is built');
});

// --- performance: stop paying for answers that have not changed ------------
// Measured from a device log: opening Hot & Cold fired FOUR heavy calls at
// once and all four 429'd. Two of them were reference DIRECTORIES that had
// not changed in months.
test('static reference feeds are cached across restarts, observation feeds are not', async () => {
  const app = await boot();
  const A = app.window.__app;
  assert.ok(A.ebRefGet && A.ebRefPut, 'the durable reference cache is reachable');

  // A DIRECTORY is cacheable for a week: hotspots are created and renamed over
  // months, and a region's species list moves with taxonomy, once a year.
  for (const p of ['ref/hotspot/US-WA-033?fmt=json', 'product/spplist/US-WA',
                   'ref/taxonomy/ebird?fmt=json&locale=en&species=merlin']) {
    A.ebRefPut(p, [{ x: 1 }]);
    assert.ok(A.ebRefGet(p), p + ' is held across restarts');
  }
  // A SIGHTING is not. A stale observation is a WRONG ANSWER — it sends you to
  // a bird that has gone — where a stale hotspot list is merely a short one.
  for (const p of ['data/obs/US-WA-033/recent?back=7',
                   'data/obs/US-WA/recent/notable?back=7',
                   'ref/hotspot/geo?lat=47&lng=-122',
                   'product/lists/US-WA-033?maxResults=200']) {
    A.ebRefPut(p, [{ x: 1 }]);
    assert.equal(A.ebRefGet(p), null, p + ' must NEVER be cached for a week');
  }
  // `ref/hotspot/geo` is the trap in that list: it starts with the same six
  // characters as the directory feed but is a live "what is near me" query.
  assert.match(HTML, /ref\\\/hotspot\\\/\(\?!geo\)/,
    'the pattern excludes ref/hotspot/geo explicitly, not by accident');
  A.ebRefPurge();
  assert.equal(A.ebRefGet('product/spplist/US-WA'), null, 'and the cache can be cleared');
  app.window.close();
});

// Every 429 storm in this app has been a budget problem, and the budget was
// invisible: the log said which URL was slow, never which SECTION asked.
test('the debug log reports what each section cost', async () => {
  const app = await boot();
  const A = app.window.__app;
  assert.ok(A.costReport, 'the ledger is reachable');
  // NOT driven through ebird(): with no key that path takes the real retry
  // ladder — four attempts behind 20s cooldowns — and hangs the suite. The
  // ledger is fed by costEnter/costNote, so it is exercised directly and the
  // WIRING is asserted on the source, which is the part that can rot.
  A.costEnter('Hot hotspots');
  A.costNote('ref/hotspot/US-WA-033?fmt=json', false);
  A.costNote('ref/hotspot/US-WA-061?fmt=json', true);
  A.costEnter('Quick outing');
  A.costNote('ref/hotspot/geo?lat=47&lng=-122', false);
  const rep = A.costReport();
  const hot = rep.find((r) => r.section === 'Hot hotspots');
  assert.ok(hot, 'the section that spent the call is named');
  assert.equal(hot.calls, 1, 'live calls are counted');
  assert.equal(hot.cached, 1, 'and so is what the cache SAVED');
  // Sorted by LIVE calls, so the expensive sections name themselves.
  for (let i = 1; i < rep.length; i++) {
    assert.ok(rep[i - 1].calls >= rep[i].calls, 'most expensive first');
  }
  // ebird() must actually feed it, or the ledger stays empty in real use.
  const eb = HTML.slice(HTML.indexOf('function ebird(path, bg)'),
    HTML.indexOf('function ebird(path, bg)') + 1600);
  assert.match(eb, /costNote\(path, true\)/, 'a cache hit is recorded as a saving');
  assert.match(eb, /costNote\(path, false\)/, 'and a live call as a cost');
  // ...and showSection must name the section, or every call lands on 'startup'.
  const show = HTML.slice(HTML.indexOf('function showSection(id)'),
    HTML.indexOf('function showSection(id)') + 700);
  assert.match(show, /costEnter\(/, 'opening a section makes it the one being charged');
  // It has to reach the log the user actually copies, or it is a metric
  // nobody will ever see.
  // Scoped to the FUNCTION, not to a byte count. This read 4000 characters and
  // broke the moment dbgContext gained a comment - the assertion is about
  // costReport reaching the copied log, and how many characters happen to
  // precede it is not part of that claim.
  const ctxStart = HTML.indexOf('function dbgContext(');
  const ctxAfter = HTML.indexOf('\n      function ', ctxStart + 1);
  const ctx = HTML.slice(ctxStart, ctxAfter > 0 ? ctxAfter : ctxStart + 8000);
  assert.match(ctx, /costReport\(\)/, 'and it is printed in the copied debug log');
  assert.match(ctx, /most expensive first/, 'with the order stated');
  app.window.close();
});

// "Top destinations and Top excursions should not show hotspots with no unseen
// birds." The ranking is by target count, so a zero sorted to the bottom
// rather than being excluded — a row that answers the section's own question
// with "don't go".
test('destinations and excursions drop hotspots with nothing you need', async () => {
  const app = await boot();
  const A = app.window.__app;
  const doc = app.document;
  const list = [
    { locId: 'L1', locName: 'Has targets', lat: 47.6, lng: -122.3, dist: 5,
      score: 9, rare: 1, species: [{ code: 'merlin', name: 'Merlin' }] },
    { locId: 'L2', locName: 'Nothing here', lat: 47.7, lng: -122.4, dist: 6,
      score: 0, rare: 0, species: [] },
  ];
  A.renderDestinations(list, doc.getElementById('destMap'), doc.getElementById('destResults'));
  const txt = doc.getElementById('destResults').textContent;
  assert.match(txt, /Has targets/, 'a hotspot holding a bird you need is kept');
  assert.ok(!/Nothing here/.test(txt), 'one holding nothing you need is dropped');

  // And when NOTHING qualifies, say so rather than rendering an empty list.
  A.renderDestinations([list[1]], doc.getElementById('destMap'), doc.getElementById('destResults'));
  assert.match(doc.getElementById('destResults').textContent, /No hotspot in range/,
    'an empty section explains itself');
  app.window.close();
});

// ---------------------------------------------------------------------------
// eBird API Terms compliance: attribution, and erasing your own data.
// ---------------------------------------------------------------------------

// §3: "You agree to attribute eBird.org as the source of the data accessed via
// the API wherever it is used or displayed." The app had 1,339 links to
// ebird.org before this and satisfied none of it -- deep-links to species pages
// are navigation, not a statement of provenance. So the test is not "does the
// string ebird appear", which was already true; it is that a persistent,
// visible element names eBird as the SOURCE, from every section.
test('eBird is credited as the data source, persistently and visibly', async () => {
  const app = await boot();
  const doc = app.document;
  const attrib = doc.getElementById('attrib');
  assert.ok(attrib, 'the footer carries an attribution element');

  const txt = attrib.textContent.replace(/\s+/g, ' ');
  assert.match(txt, /data from .*eBird/i, 'it names eBird as the source of the data');
  assert.match(txt, /Cornell Lab of Ornithology/i, 'it credits the Cornell Lab');
  assert.match(txt, /[Nn]ot affiliated with or endorsed by/,
    'the Data Access terms require saying use implies no endorsement');

  const link = attrib.querySelector('a[href="https://ebird.org"]');
  assert.ok(link, 's3 asks for a link back to ebird.org');

  // It lives in the footer, which is outside <main> and therefore not hidden
  // when sections toggle. If it ever moves inside a section it would be visible
  // from one screen and absent from every other, which is not "wherever it is
  // used or displayed".
  assert.ok(attrib.closest('footer'), 'attribution sits in the persistent footer');
  assert.ok(!attrib.closest('section'),
    'attribution must not live inside a section, or it disappears with that section');
  assert.equal(attrib.hidden, false, 'and it is not hidden');
  app.window.close();
});

// The scrub must enumerate localStorage by prefix. Three of the app's keys are
// themselves prefixes with one entry per region (ebird_home_, ebird_mig_,
// ebird_tod_), so a hardcoded list of key names is already wrong for anyone who
// has viewed a second region -- and would leave home coordinates on the device
// after telling the user everything was erased.
test('erasing your data removes every ebird_ key, including per-region ones', async () => {
  const app = await boot();
  const A = app.window.__app;
  const ls = app.window.localStorage;

  ls.setItem('ebird_api_key', 'secret-key');
  ls.setItem('ebird_seen', '["amecro"]');
  ls.setItem('ebird_favs', '[{"locId":"L1"}]');
  ls.setItem('ebird_display_name', 'Birder Wyatt');
  ls.setItem('ebird_home_wa', '47.6,-122.3');     // per-region: the trap
  ls.setItem('ebird_home_az', '33.4,-111.9');
  ls.setItem('ebird_mig_wa', '{"x":1}');
  ls.setItem('ebird_tod_wa', '{"y":2}');
  ls.setItem('unrelated_app_key', 'keep me');

  const found = A.scrubbableKeys();
  for (const k of ['ebird_home_wa', 'ebird_home_az', 'ebird_mig_wa', 'ebird_tod_wa']) {
    assert.ok(found.includes(k), `${k} is found by enumeration, not by a fixed list`);
  }

  const removed = A.scrubPersonalData();
  assert.ok(removed >= 8, `removed everything it found (got ${removed})`);

  const left = [];
  for (let i = 0; i < ls.length; i++) left.push(ls.key(i));
  const leaked = left.filter((k) => k.startsWith('ebird_') && k !== 'ebird_seed_dismissed');
  assert.deepEqual(leaked, [],
    `no personal data may survive an erase; found ${JSON.stringify(leaked)}`);

  assert.equal(ls.getItem('ebird_api_key'), null, 'the API key is gone');
  assert.equal(ls.getItem('ebird_home_wa'), null, 'per-region home coordinates are gone');
  assert.equal(ls.getItem('unrelated_app_key'), 'keep me',
    'it only touches this app\'s namespace');

  // Having erased your list, repopulating with the bundled sample (someone
  // else's birding history) on next load is not a clean slate.
  assert.equal(ls.getItem('ebird_seed_dismissed'), '1',
    'the bundled sample list stays dismissed after an erase');
  app.window.close();
});

// The control has to be reachable, and has to warn before doing something
// irreversible.
test('the erase control exists, is labelled, and confirms first', async () => {
  const app = await boot();
  const doc = app.document;
  const btn = doc.getElementById('scrubBtn');
  assert.ok(btn, 'Settings has an erase control');
  assert.match(btn.textContent, /Erase all my data/i, 'it says what it does');
  assert.ok(btn.closest('#settingsPanel'), 'it lives in Settings');

  let asked = null;
  app.window.confirm = (m) => { asked = m; return false; };
  app.window.localStorage.setItem('ebird_api_key', 'secret-key');
  btn.click();
  assert.ok(asked && /cannot be undone/i.test(asked),
    'it warns that the erase is irreversible');
  assert.equal(app.window.localStorage.getItem('ebird_api_key'), 'secret-key',
    'declining the confirm changes nothing');
  app.window.close();
});

// The shipped app must not carry the author's identity. This is a privacy
// matter in a public repo, but the reason it is a TEST is that it was a
// correctness bug: getDisplayName() defaulted to the author's eBird name, which
// is the identity used to look you up on the Top 100 leaderboard and to filter
// out "your own" checklists. A fresh install on anyone else's phone showed them
// the author's rank as theirs, and hid the author's sightings as already-seen.
test('the app ships with no identity baked in', async () => {
  const app = await boot();
  const A = app.window.__app;

  assert.equal(A.getDisplayName(), '',
    'an unconfigured install has NO display name; a default would be someone else\u2019s identity');

  // Saving a blank field must not quietly restore a hardcoded fallback.
  app.$('ebirdName').value = '';
  app.$('saveBtn').click();
  // Assert the effect, not the storage representation: an unset key reads back
  // as null and a saved-blank one as '', and both mean "no identity".
  assert.equal(A.getDisplayName(), '', 'blank stays blank through a save');
  assert.ok(!(app.window.localStorage.getItem('ebird_display_name') || ''),
    'and nothing was quietly substituted into storage');

  app.window.localStorage.setItem('ebird_display_name', 'Someone Else');
  assert.equal(A.getDisplayName(), 'Someone Else', 'and a real name is used when set');
  app.window.close();
});

// Separate from the runtime check: the SOURCE must not contain the author's
// eBird identity outside test fixtures, or a later edit can reintroduce a
// default that the runtime test above would only catch if it went through
// getDisplayName().
test('no personal eBird identity is hardcoded in the shipped source', () => {
  const shipped = HTML + fs.readFileSync(path.join(WWW, 'logic.js'), 'utf8');
  const hits = [];
  // The author's eBird display name and personal handle. The GitHub URL is
  // fine and stays: Nominatim's usage policy REQUIRES a User-Agent that
  // identifies the application and gives a contact point.
  for (const needle of ['Birder Wyatt', 'wyhoutz-birding-app']) {
    if (shipped.includes(needle)) hits.push(needle);
  }
  assert.deepEqual(hits, [],
    `shipped source contains personal identity: ${JSON.stringify(hits)}. ` +
    'A default identity is not a cosmetic issue - it is what the leaderboard ' +
    'lookup and own-checklist filtering key on.');
});

// The app half of the rarity-distance bug. Reported from a real report: the
// Nashville Warbler row claimed 16 reports and expanded into checklists from
// Clarkston (252 mi), Chief Timothy Park (250 mi) and Whitman Mission (210 mi),
// beside the two at Bolt Creek Burn 32.1 mi away that were the actual reports.
//
// kind === 'Rarity' is not a local marker: the ABA Code 3+ recovery path pulls a
// whole state's notable feed and those records carry the same kind.
//
// The filter is DISTANCE, not "did eBird flag it here" -- eBird judges rarity
// per location, so an Eastern Kingbird is unremarkable in one county and notable
// in the next. A nearby checklist holding the bird is worth seeing whether or
// not that sighting was flagged; filtering on the flag drops the useful case.
test('rarity reports are bounded by the chase radius, not by the flag', async () => {
  const app = await boot();
  const A = app.window.__app;
  const home = { lat: 47.75, lng: -122.16 };
  const at = (miNorth) => ({ lat: 47.75 + miNorth / 69, lon: -122.16 });

  const recs = [
    // The two real ones, close.
    { kind: 'Rarity', code: 'nawwar', name: 'Nashville Warbler', subId: 'S378890306',
      observer: 'Birder Wyatt', dateStr: '2026-08-01', ...at(30) },
    { kind: 'Rarity', code: 'nawwar', name: 'Nashville Warbler', subId: 'S378544956',
      observer: 'Aaron Gyllenhaal', dateStr: '2026-07-31', ...at(30) },
    // Across the mountains.
    { kind: 'Rarity', code: 'nawwar', name: 'Nashville Warbler', subId: 'S379303809',
      observer: 'Someone', dateStr: '2026-08-02', ...at(252) },
    { kind: 'Rarity', code: 'nawwar', name: 'Nashville Warbler', subId: 'S379390171',
      observer: 'Someone', dateStr: '2026-08-02', ...at(250) },
    { kind: 'Rarity', code: 'nawwar', name: 'Nashville Warbler', subId: 'S379630222',
      observer: 'Someone', dateStr: '2026-08-03', ...at(66) },
  ];

  const rows = A.buildActiveRarities(recs, home);
  assert.equal(rows.length, 1, 'one species row');
  const row = rows[0];

  assert.equal(row.reports, 2,
    `the count must match what the expander lists (got ${row.reports}); ` +
    'reporting 16 while only 2 are chaseable is the original bug');
  // JSON.stringify, not deepEqual: the array comes from the jsdom realm and
  // cross-realm deepEqual fails on identical contents.
  const subs = row.recs.map((r) => r.subId).sort().join(',');
  assert.equal(subs, 'S378544956,S378890306',
    'only the checklists inside the radius survive');
  assert.ok(row.distMi < A.CHASE_MAX_MI, 'and the closest is genuinely close');
  assert.equal(rows.droppedFar, 3, 'what was withheld is counted, not silently dropped');

  // A species whose every report is far away is not a chase at all.
  const onlyFar = A.buildActiveRarities(recs.slice(2), home);
  assert.equal(onlyFar.length, 0,
    'a species with nothing inside the radius gets no row - there is nowhere to go');
  app.window.close();
});


// ---- F1 step 3: the chase radius belongs to the report ---------------------
//
// The home coordinate has been per-report since v1.0.45 — "chasing from
// Woodinville is meaningless on the Big Island" — but the RADIUS from that home
// stayed global across all nine reports. regions.py has carried chase_max_mi on
// every Region since Regions existed and analyze.set_region() rebinds it, so
// the Markdown report was already per-region while the app was not.
test('the chase radius is per report, not one knob for all nine', async () => {
  const app = await boot();
  const A = app.window.__app, W = app.window;

  // The DEFAULT comes from the profile, which mirrors regions.py — so the two
  // repos cannot pick different radii for the same report.
  W.localStorage.setItem('ebird_report', 'wa');
  assert.equal(A.chaseMaxMi(), A.chaseDefaultMi(), 'unset means the profile value');
  assert.equal(A.chaseDefaultMi(), 35, 'which is regions.py Region.chase_max_mi');

  // Set a continent-sized radius on the ABA tracker, where 35 miles is a
  // meaningless filter for a report that spans a continent.
  W.localStorage.setItem('ebird_report', 'aba');
  W.localStorage.setItem(A.chaseMiKey(), '2000');
  assert.equal(A.chaseMaxMi(), 2000, 'the ABA tracker reaches as far as it needs');

  // THE POINT. Washington must be untouched. With one global key this was
  // impossible: widening the tracker widened home birding with it.
  W.localStorage.setItem('ebird_report', 'wa');
  assert.equal(A.chaseMaxMi(), 35,
    'Washington keeps its own radius — the whole reason this became per report');

  // Keys are namespaced by slug, exactly as homeKey and tideKey are.
  W.localStorage.setItem('ebird_report', 'waikoloa');
  assert.notEqual(A.chaseMiKey(), 'ebird_chase_mi', 'never the bare global key');
  assert.ok(A.chaseMiKey().endsWith(':waikoloa'), 'one key per report');
  app.window.close();
});

test('a radius chosen before this migrates into the report it was chosen in', async () => {
  const app = await boot();
  const A = app.window.__app, W = app.window;
  // A value stored under the OLD global key by an earlier build, while the
  // reader had Washington open.
  W.localStorage.setItem('ebird_report', 'wa');
  W.localStorage.setItem('ebird_chase_mi', '75');
  A.migrateHomeKeys();

  assert.equal(A.chaseMaxMi(), 75, 'the choice survives the upgrade');
  assert.equal(W.localStorage.getItem('ebird_chase_mi'), null,
    'and the global key is gone, so it cannot shadow the per-report one later');

  // It lands in the report that was open — NOT applied to all nine, which
  // would be inventing a decision the reader never made.
  W.localStorage.setItem('ebird_report', 'aba');
  assert.equal(A.chaseMaxMi(), 35, 'other reports keep their own default');
  app.window.close();
});


// ---- the class of bug jsdom cannot see -------------------------------------
//
// "the new search fields dont work. i tried searching for everett in top
// destinations and it didnt work in the ui of the app."
//
// Search was dead on device while every test passed, because NODE'S FETCH DOES
// NOT ENFORCE CORS. The suite happily resolved a place the phone could never
// reach. Measured 2026-08-08 against every external host the app uses:
//
//   api.ebird.org ................ Access-Control-Allow-Origin: *
//   api.tidesandcurrents.noaa.gov  Access-Control-Allow-Origin: *
//   en.wikipedia.org ............. Access-Control-Allow-Origin: *
//   nominatim.openstreetmap.org .. NO CORS HEADER AT ALL   <-- the geocoder
//   photon.komoot.io ............. Access-Control-Allow-Origin: *
//
// So this cannot verify CORS from Node — it pins the DECISION instead. Moving
// the geocoder to a host somebody has not checked should require editing this
// test and reading why.
test('the geocoder points at a host that a webview can actually read', () => {
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');

  // Verified to send Access-Control-Allow-Origin. Add to this list only after
  // measuring the header — not after a URL works in a terminal, which proves
  // nothing about a webview.
  const CORS_OK = ['photon.komoot.io', 'geocoding-api.open-meteo.com'];
  const m = HTML.match(/var GEOCODER_HOST = '([^']+)'/);
  assert.ok(m, 'the geocoder host is a named constant, so it can be pinned');
  assert.ok(CORS_OK.includes(m[1]),
    `geocoder host ${m[1]} is not on the CORS-verified list ${CORS_OK.join(', ')}`);

  // The specific host that was broken, named so it cannot quietly come back.
  assert.ok(!/https:\/\/nominatim/.test(HTML),
    'nominatim.openstreetmap.org sends no Access-Control-Allow-Origin header, so a '
    + 'WKWebView blocks the response before any app code sees it');
});

// User-Agent is a FORBIDDEN header name: a browser drops it silently. Setting
// it was the one thing the broken geocoder call did that no working call in the
// app does, and a header that cannot be set is at best a comment in the wrong
// place.
test('no fetch tries to set a header the platform forbids', () => {
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  const FORBIDDEN = ['User-Agent', 'Referer', 'Origin', 'Host', 'Cookie'];
  for (const h of FORBIDDEN) {
    assert.ok(!new RegExp("'" + h + "'\\s*:\\s*'").test(HTML),
      `${h} is a forbidden header name — the browser drops it, so setting it is `
      + 'a false assurance that the request identified itself');
  }
});


// "there needs to be a clearer distinction between unseen and seen. add more
// contrast to the divider and make the sections separate."
//
// This is the most important distinction in the app — a bird you still need is
// a REASON TO DRIVE, one you have is just news — and it was carried by a 1px
// #e4e8e4 hairline, which measures 1.15:1 against the page. On a phone in
// daylight that reads as one more row.
test('the seen / unseen divider is a real separator, not a hairline', () => {
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  const css = HTML.slice(HTML.indexOf('.cardgroup {'), HTML.indexOf('.cghead {'));

  // A rule you can see. --accent measures 4.98:1 on light and 9.60:1 on dark,
  // against 1.15:1 and 1.36:1 for the --line hairline it replaced.
  assert.match(css, /border-top:\s*3px solid var\(--accent\)/,
    'the top edge is an accent rule, not a grey line');
  assert.ok(!/border-bottom:\s*1px solid var\(--line\);\s*background:\s*none/.test(css),
    'and the group is no longer JUST a hairline with nothing behind it');

  // A tint behind the heading, so it reads as a header rather than a card that
  // lost its picture. Named per theme rather than color-mix() so it renders on
  // any WebKit the app is sideloaded onto.
  // NOT a filled band any more: "the new still needed header is ugly and the
  // text runs against the edge". A full-bleed slab of colour sat outside the
  // inset the cards use, so its text started where nothing else's did. Space
  // and a rule separate two lists; colour was never doing that work.
  assert.match(css, /background:\s*none/, 'the heading is not a slab of colour');
  assert.ok(!/border-radius/.test(css), 'and not a rounded box pretending to be a card');
  assert.match(HTML, /--band:\s*#[0-9a-f]{6}/i, 'light mode defines the band');

  // SPACE is what actually makes two lists look like two lists; contrast alone
  // does not. The gap above the heading must be large and must NOT apply to the
  // first group, where 30px of air at the top of a list looks like a fault.
  const top = /margin:\s*(\d+)px/.exec(css);
  assert.ok(top && Number(top[1]) >= 24,
    `the gap above a group is ${top && top[1]}px — it separates the two lists`);
  assert.match(HTML, /\.cardgroup:first-child\s*\{[^}]*margin-top:\s*\dpx/,
    'but the first group keeps its place at the top of the list — 24px of air '
    + 'above the very first heading reads as a rendering fault');
});




// TODAY, as the app computes it.
//
// The rarity sections filter to today's reports, so a fixture dated
// '2026-08-08' is only "today" on a machine whose clock says so. These tests
// passed here and timed out on CI, which was already into the 9th UTC: the
// feed returned rows, notableToday() correctly dropped every one as
// yesterday's, and the section took its empty-list early return — so nothing
// ever rendered and the wait had nothing to wait for. A fixture that encodes
// the day it was written is a test with an expiry date.
function todayFixtureDate() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

// Wait for a CONDITION, not for a duration.
//
// The rarity tests below drive a real async wave (fetch -> merge -> render) and
// were written with fixed setTimeout waits tuned on a fast laptop. They passed
// locally and failed on CI, which is slower — the classic flake. Polling for
// the thing the assertion is about removes the whole class: it returns the
// moment the app is ready and only spends the full budget when something is
// genuinely wrong.
async function waitFor(fn, what, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    let v;
    // AWAITED. Without this an async predicate returns a promise, which is
    // always truthy, so waitFor returns immediately and the test measures
    // nothing. Sync predicates are unaffected.
    try { v = await fn(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) {
      throw new Error(`timed out after ${ms}ms waiting for: ${what}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ---- "refresh button does nothing" -----------------------------------------
//
// It was an accurate description of the code. getChase() memoises for 30
// minutes and Refresh called straight through it, so within that window it
// repainted byte-identical rows and the only thing that moved was the clock.
// The comment above the cache had said "Refresh is there for the times it
// isn't" for months, and nothing implemented that.
//
// There were TWO caches to get past. Dropping only the chase snapshot rebuilt
// it from 30-minute-old memoised eBird responses — the same do-nothing one
// level down — so the observation memo has to go with it. The durable
// REFERENCE cache (hotspot lists, region info; static for a week) is kept:
// refresh means "re-read what the birds are doing", not "re-download the map
// of Washington".
test('Refresh actually refetches; opening the section does not', async () => {
  let waves = 0;
  const rows = [{ speciesCode: 'tufpuf', comName: 'Tufted Puffin',
    obsDt: todayFixtureDate() + ' 14:23', locName: 'Marina Beach Park', locId: 'L1',
    lat: 47.81, lng: -122.39, subId: 'S1', userDisplayName: 'Barb Chan',
    howMany: 1, evidence: 'P', obsValid: true }];
  const app = await boot({
    fetch(url) {
      if (/notable/.test(url)) waves++;
      if (/data\/obs\//.test(url)) return rows;
      return null;
    },
  });
  const doc = app.window.document, A = app.window.__app;

  A.refresh();
  await new Promise((r) => setTimeout(r, 1400));
  const first = waves;
  assert.ok(first > 0, 'the first load fetches');

  // Re-opening a section must NOT spend the wave again. This is the behaviour
  // the 30-minute memo exists for and it has to survive the fix.
  A.refresh();
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(waves, first,
    'reloading from cache costs nothing — a section you open twice is not two waves');

  // ...but the ↻ is a promise to go and look again.
  doc.getElementById('sec-refreshBtn').querySelector('.refreshbtn').click();
  await new Promise((r) => setTimeout(r, 1600));
  assert.ok(waves > first,
    `Refresh must actually refetch: ${first} calls before, ${waves} after`);
  app.window.close();
});

// "it needs a way to sort by date or distance." Two different questions:
// newest-first answers "is it still there", nearest-first answers "what can I
// actually get to". Shared by BOTH rarity sections, because a reader who wants
// distance wants it in both — "these reports should look the same".
test('both rarity lists sort by date or distance, from one control', async () => {
  const rows = [
    // Newest but FURTHEST.
    { speciesCode: 'zztuft1', comName: 'Zed Test Puffin', obsDt: todayFixtureDate() + ' 14:23',
      locName: 'Far Park', locId: 'L1', lat: 48.05, lng: -122.60, subId: 'S1',
      userDisplayName: 'B', howMany: 1, evidence: 'P', obsValid: true },
    // Older but NEAREST.
    { speciesCode: 'zztatt1', comName: 'Zed Test Tattler', obsDt: todayFixtureDate() + ' 09:05',
      locName: 'Near Park', locId: 'L2', lat: 47.77, lng: -122.15, subId: 'S2',
      userDisplayName: 'K', howMany: 1, evidence: 'A', obsValid: true },
  ];
  const app = await boot({
    fetch(url) { return /data\/obs\//.test(url) ? rows : null; },
  });
  const doc = app.window.document, A = app.window.__app;
  const names = () => [...doc.querySelectorAll('#results .cardname, #results .name a')]
    .map((e) => e.textContent.trim()).filter(Boolean);

  A.setRaritySort('date');
  A.refresh();
  const pick = await waitFor(() => doc.getElementById('todaySort'),
    'the sort control to render');
  assert.ok(pick, 'the control is on the status line, where the order is claimed');
  assert.match(doc.getElementById('status').textContent, /newest first/,
    'and the line SAYS which order it is in — a sorted list that does not say '
    + 'how is a list you have to verify by hand');
  const byDate = names();
  assert.ok(/Puffin/.test(byDate[0] || ''), 'newest first puts the 14:23 report top');

  // Switching order is local work on rows already in hand and must not refetch.
  pick.querySelector('.sortbtn[data-sort="distance"]').click();
  await waitFor(() => /nearest first/.test(doc.getElementById('status').textContent),
    'the list to re-sort by distance');
  assert.match(doc.getElementById('status').textContent, /nearest first/,
    'the claim changes with the order');
  const byDist = names();
  assert.ok(/Tattler/.test(byDist[0] || ''),
    'nearest first puts the closer bird top, even though it is older');
  assert.equal(A.raritySort(), 'distance', 'and the choice is remembered');
  app.window.close();
});

// "id like to be able to drag down on a page to refresh like other apps."
test('pull-to-refresh exists, and cannot fire by accident', () => {
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  const fn = HTML.slice(HTML.indexOf('function initPullToRefresh()'),
    HTML.indexOf('function _setH2('));

  assert.match(fn, /touchstart/, 'it is a drag, not a button');
  // Only from a genuine top, so it cannot interrupt a scroll that happens to
  // end near the top.
  assert.match(fn, /scrollTop > 0/, 'only from the top of the page');
  // Only a mostly-vertical drag: the app is full of horizontally scrolling
  // card rows, and a sideways swipe through one must never reload.
  assert.match(fn, /x > Math\.abs\(y\)/,
    'a sideways swipe through a scrolling row is not a reload');
  // A threshold with visible tracking, so it is never a surprise — and
  // releasing early cancels, which is what makes it safe to try.
  assert.match(HTML, /PULL_TRIGGER_PX = \d+/, 'there is a threshold');
  assert.match(fn, /dy >= PULL_TRIGGER_PX/, 'and it must be passed to fire');
  assert.match(fn, /\.refreshbtn/,
    'it triggers the SAME reload as the arrow, so it forces too');
});


// "so on the two rarities pages, a full refresh of everything isnt needed.
// primarily a refresh of the county alerts."
//
// Right, and the difference is not small. A full wave is ~47 calls — 6 region
// feeds plus one per unseen species — which at eBird's ~0.37/s ceiling is over
// two minutes. The rarity sections read the NOTABLE feeds; the per-species
// phase answers a different question and does not go stale on the timescale of
// "is that puffin still there".
test('a rarity refresh re-reads the alerts, not the whole wave', async () => {
  const rows = [{ speciesCode: 'zztuft3', comName: 'Zed Test Puffin',
    obsDt: todayFixtureDate() + ' 14:23', locName: 'P', locId: 'L1', lat: 47.8, lng: -122.2,
    subId: 'S1', obsId: 'OBS1', userDisplayName: 'B', howMany: 1,
    evidence: 'P', obsValid: true }];
  let calls = [];
  const app = await boot({
    fetch(url) { calls.push(String(url)); return /data\/obs\//.test(url) ? rows : null; },
  });
  const doc = app.window.document, A = app.window.__app;

  A.refresh();
  await waitFor(() => doc.querySelector('#results [data-hsloc], #results .cardname, #results li'),
    'the first load to render');
  const first = calls.slice();
  calls = [];
  await waitFor(() => !doc.getElementById('refreshBtn').disabled,
    'the first load to release the button');
  doc.getElementById('sec-refreshBtn').querySelector('.refreshbtn').click();
  await waitFor(() => calls.some((u) => /notable/.test(u)),
    'the alert feeds to be re-read');
  await new Promise((r) => setTimeout(r, 400));   // let any stragglers land
  const notable = calls.filter((u) => /notable/.test(u));
  assert.ok(notable.length > 0,
    'the alert feeds ARE re-read — that is the whole point of the button');
  // The precise claim: nothing ALREADY PAID FOR is bought again. A species feed
  // for a bird the refreshed alert just introduced is new work and must happen;
  // re-running the phase for birds already in the memo is the ~47-call waste
  // this mode exists to avoid.
  const repaid = calls.filter((u) => !/notable/.test(u) && first.includes(u));
  assert.deepEqual(repaid, [],
    'a targeted refresh re-buys nothing it already had: ' + repaid.join(', '));
  app.window.close();
});

// "if an observation is within the last 24 hours it should get the new icon
// (everywhere), not just today's rarities."
//
// NEW used to mean "not in the list the last time you looked", which is a fact
// about the READER. Two things were wrong with it. It needed per-section
// memory, so the badge could only ever exist on the one list that kept any —
// and it went stale backwards: a bird found ten minutes ago stopped being NEW
// the instant you glanced at the screen, which is the opposite of what the
// word means to somebody deciding whether to get in the car.
//
// It is now a fact about the OBSERVATION: reported in the last 24 hours. That
// needs no storage, cannot disagree between two sections, and is the same rule
// everywhere.
test('NEW means reported in the last 24 hours, on every list', async () => {
  const B = require(path.join(__dirname, '..', 'www', 'logic.js'));
  const now = Date.parse('2026-08-11T10:00:00');
  assert.equal(B.isFresh('2026-08-11 09:00', now), true, 'an hour ago is new');
  assert.equal(B.isFresh('2026-08-10 11:00', now), true, '23 hours ago still is');
  assert.equal(B.isFresh('2026-08-10 09:00', now), false, '25 hours ago is not');
  // A clock a few minutes out must not start calling rows stale, and an
  // unreadable date must not CLAIM freshness it cannot support.
  assert.equal(B.isFresh('2026-08-11 10:05', now), true, 'a slight clock skew is tolerated');
  assert.equal(B.isFresh('', now), false, 'an empty date claims nothing');
  assert.equal(B.isFresh('not a date', now), false, 'and neither does a junk one');
  assert.equal(B.FRESH_HOURS, 24, 'the window is named, not sprinkled');

  const mk = (c, n, t, sub) => ({ speciesCode: c, comName: n, obsDt: t, locName: 'P',
    locId: 'L1', lat: 47.8, lng: -122.2, subId: sub, obsId: 'OBS' + sub,
    userDisplayName: 'B', howMany: 1, evidence: 'P', obsValid: true });
  // One bird from an hour ago, one from three days back.
  const hourAgo = new Date(Date.now() - 3600000);
  const pad = (x) => String(x).padStart(2, '0');
  const stamp = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  const rows = [
    mk('zztuft4', 'Zed Test Puffin', stamp(hourAgo), 'S1'),
    mk('zztatt4', 'Zed Test Tattler', stamp(new Date(Date.now() - 3 * 86400000)), 'S2'),
  ];
  const app = await boot({ fetch(url) { return /data\/obs\//.test(url) ? rows : null; } });
  const doc = app.window.document, A = app.window.__app;
  const badges = () => (doc.getElementById('results').innerHTML.match(/newflag/g) || []).length;

  A.refresh();
  // Wait for the ROW, not the status line: the status is written before the
  // rows are painted, so matching on it returns while #results is still empty.
  await waitFor(() => /Zed Test Puffin/.test(doc.getElementById('results').textContent),
    'the fresh row to paint');

  // THE FIRST LOOK IS NOT QUIET ANY MORE, and that is the point: a bird found
  // an hour ago is news the first time you open the app, which is exactly when
  // you needed to be told.
  assert.equal(badges(), 1, 'the fresh bird is marked on the very first view');
  assert.match(doc.getElementById('results').textContent, /Zed Test Puffin/);

  // ...and looking again does not change it. The old rule cleared every badge
  // on the second render; recency is not consumed by being read.
  A.refresh();
  await waitFor(() => /Zed Test Puffin/.test(doc.getElementById('results').textContent), 're-render');
  assert.equal(badges(), 1, 'still marked — reading a list does not age a sighting');

  // Re-sorting is not a new visit either.
  A.setRaritySort('distance');
  A.refresh();
  await waitFor(() => /nearest first/.test(doc.getElementById('status').textContent), 're-sorted');
  assert.equal(badges(), 1, 'and order has nothing to do with it');
  A.setRaritySort('date');
  app.window.close();
});

// The badge is not confined to one section. speciesListHtml is the template
// every hotspot species list, unseen cluster and small bird row is built
// through, so putting the rule there is what makes "everywhere" true rather
// than a promise.
test('the 24-hour badge reaches the shared species row, not just the rarity lists', () => {
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  const fn = HTML.slice(HTML.indexOf('function speciesListHtml'),
                        HTML.indexOf('function speciesListHtml') + 2600);
  assert.match(fn, /BL\.isFresh\(x\.dateStr\)/,
    'the shared small-row template applies the same freshness rule');
  assert.match(fn, /newRarityTag\(\) \+ tags/, 'and marks the row with the same badge');
});


// "similar logic should go for the four go birding locations: a deep refresh
// isnt need, but primarily a quick refresh for new observations that changes
// the results."
//
// What moves a hotspot up or down one of these lists is somebody FILING A
// CHECKLIST. So a refresh re-reads the observation feeds and nothing else: not
// the per-species phase (a different question, and the expensive half), and not
// ref/hotspot/{county}, which is a list of PARKS — and parks do not appear
// between two taps of a button.
test('the Go birding sections refresh observations, not the world', () => {
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');

  // The three modes are distinct on purpose; a single boolean force would make
  // every refresh the ~47-call one.
  assert.match(HTML, /if \(force === 'notable'\) ebClearMatching\(FORCE_NOTABLE_RE\)/,
    'the rarity pages drop only the alert feeds');
  assert.match(HTML, /else if \(force === 'obs'\) ebClearMatching\(FORCE_OBS_RE\)/,
    'the Go birding pages drop only the observation feeds');

  // The regex is the whole contract: it must catch a region or location feed
  // and must NOT catch a species feed.
  const m = /var FORCE_OBS_RE = (\/.*\/);/.exec(HTML);
  assert.ok(m, 'the observation-feed pattern is a named constant');
  const re = new RegExp(m[1].slice(1, -1));
  assert.ok(re.test('data/obs/US-WA-033/recent?back=7&detail=full'), 'county feed');
  assert.ok(re.test('data/obs/US-WA-033/recent/notable?back=7'), 'county alerts');
  assert.ok(re.test('data/obs/L1234/recent?back=30'), 'a hotspot feed');
  assert.ok(!re.test('data/obs/US-WA/recent/tufpuf?back=7'),
    'but NOT a species feed — that is the expensive phase this exists to skip');
  assert.ok(!re.test('ref/hotspot/US-WA-033'),
    'and NOT the hotspot directory, which is a list of parks');

  // All four sections wired: destinations and excursions through getChase,
  // hot and cold through their own scan.
  const dest = HTML.slice(HTML.indexOf('function loadDestinations'),
    HTML.indexOf('function loadDestinations') + 1200);
  assert.match(dest, /getChase\(takeForce\(\) \? 'obs' : false\)/, 'Top patches');
  const exc = HTML.slice(HTML.indexOf('function loadExcursions'),
    HTML.indexOf('function loadExcursions') + 1200);
  assert.match(exc, /getChase\(takeForce\(\) \? 'obs' : false\)/, 'Worth the drive');
  const scan = HTML.slice(HTML.indexOf('function runHotspotScan'),
    HTML.indexOf('function runHotspotScan') + 2600);
  assert.match(scan, /if \(opts\.force\) ebClearMatching\(FORCE_OBS_RE\)/,
    'Hot and Cold clear the same feeds');
  // ...and their ↻ actually sets force, which it did not before: the registry
  // called runHotspotScan({}) so the button rescanned from cache.
  assert.match(HTML, /hotBtn:\s*\{ fn: function \(\) \{ runHotspotScan\(\{ force: takeForce\(\) \}\)/,
    'Hot passes the flag');
  assert.match(HTML, /coldBtn:\s*\{ fn: function \(\) \{ runHotspotScan\(\{ force: takeForce\(\) \}\)/,
    'Cold passes the flag');
});


// "theres no need to repeat the hotspot name on the chrcklists under a hotspot,
// instead it should say the date time, submitters name, count, and show media
// icons." — and "update the template so its chsnged everywhere", so this is
// asserted on the shared card, not on one section's copy of it.
test('a checklist under a hotspot names the visit, not the place again', () => {
  const CK = require(require('node:path')
    .join(__dirname, '..', 'www', 'cards-checklist.js'));

  // No place: the caller has already printed it as the card's heading.
  const row = CK.small({ date: 'Aug 8 2:26 PM', href: 'https://ebird.org/checklist/S1',
                         sp: 5, distMi: 17.3, who: 'Barb Chan', data: { 'ckl-sub': 'S1' } });
  const txt = row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  assert.match(txt, /8\/8 2:26p/, 'the DATE leads, and carries the link');
  assert.match(row, /class="cklead"><a[^>]*checklist\/S1[^>]*>8\/8 2:26p</,
    'so the row still has something to tap without repeating the heading');
  assert.match(txt, /Barb Chan/, 'who filed it — one of the few facts that differs per row');
  assert.match(txt, /5 sp/, 'how many SPECIES they found');
  assert.match(txt, /17\.3 mi/, 'and how far away it is');
  assert.match(row, /data-ckl-sub="S1"/, 'with the hook the media pass needs');

  // SPECIES count and BIRD count are different facts. Keeping them apart is
  // what lets a rarity row drop "×1" while a hotspot row keeps "19 sp".
  assert.ok(!/ckcount/.test(row), 'no bird count here');
  assert.ok(!/Marymoor|Charles Richey/.test(txt), 'and no place name');

  // The medium card still spells out the bird count: it has a whole line, and
  // it describes a visit rather than one row under a heading.
  assert.match(CK.medium({ place: 'P', count: 3 }), /3 birds</,
    'the medium card is unchanged');

  // The place still leads when there ISN'T a heading above it to lean on.
  const rarity = CK.small({ place: 'Union Bay Natural Area/Montlake Fill',
    date: 'Aug 7 11:39 AM', href: 'https://ebird.org/checklist/S2', distMi: 9.3 });
  assert.match(rarity.replace(/<[^>]+>/g, ' '), /Union Bay Natural Area/,
    'a row with no heading above it still names its place');
});


// "top destination had no unseen birds" — Sandel Lookout, ranked #1, reading
// "score 6 · 2 rarities · 2 targets" with nothing under it but "19 more species
// already seen".
//
// TWO WINDOWS, one card. The ranking that produced "2 targets" comes from the
// 7-day region feeds; hydrateLocSpecies then CORRECTS the lists from
// data/obs/{locId}/recent?back=3. A bird reported here five days ago is a real
// scored target the shorter feed has never heard of — and the correction
// replaced the list with the empty answer, so the card contradicted its own
// sub-header.
//
// It also explains the second symptom in the same screenshot: with
// data-unseen-n driven to 0, the checklist filter hides the checklists too. One
// root cause, two visible bugs.
test('a shorter feed may correct a hotspot card, but never empty it', async () => {
  const app = await boot({
    fetch(url) {
      // The 3-day feed knows ONLY a bird already on the year list.
      if (/data\/obs\/L1\/recent/.test(url)) {
        return [{ speciesCode: 'daejun', comName: 'Dark-eyed Junco',
                  obsDt: todayFixtureDate() + ' 08:00', subId: 'S9' }];
      }
      return null;
    },
  });
  const doc = app.window.document, A = app.window.__app;
  const rep = app.window.__SEED_BIRDLIST__.seenByReport[A.getReportSlug()];
  rep.codes = ['daejun']; rep.watchHeld = []; rep.names = ['Dark-eyed Junco'];
  app.window.localStorage.setItem('ebird_seen_field', 'speciesCode');

  A.renderHot({ hot: [{ locId: 'L1', name: 'Sandel Lookout', lat: 47.7, lng: -122.2,
    dist: 10, fresh: 2, checklists: 3, share: 5, latest: todayFixtureDate(),
    birds: [{ name: 'Tufted Puffin', code: 'tufpuf', unseen: true },
            { name: 'Common Murre', code: 'commur', unseen: true }] }] });

  const card = await waitFor(
    () => { const c = doc.querySelector('#hotResults [data-hsloc]');
            return c && c.getAttribute('data-unseen-n') != null ? c : null; },
    'the species pass to finish correcting the card');

  const txt = card.textContent.replace(/\s+/g, ' ');
  assert.match(txt, /Tufted Puffin/, 'the scored target survives the correction');
  assert.match(txt, /Common Murre/, 'and so does the other one');
  assert.match(txt, /2 unseen/,
    'so the list agrees with the "2 targets" the card was ranked on');
  assert.equal(card.getAttribute('data-unseen-n'), '2',
    'and the checklist filter is told the truth, which is what stopped it '
    + 'hiding the checklists as well');

  // The correction still DOES its job: the junco the location feed found is
  // folded into the already-seen half rather than ignored.
  assert.match(txt, /1 more species already seen/,
    'the shorter feed still adds what it knows');

  // ...and it cannot resurrect a bird you have ticked: the scored list is run
  // through the same resolver, so a target you have since seen stays seen.
  assert.ok(!/Dark-eyed Junco/.test(txt.split('unseen')[0] || ''),
    'a bird on the year list is not promoted back into the targets');
  app.window.close();
});


// "the species look up shoudl allow searching by bird codes."
//
// eBird codes are what the debug log, the URLs and every feed row actually
// carry. "tufpuf" is faster to type than "Tufted Puffin" and it is unambiguous,
// which a common name is not.
test('species lookup finds a bird by its eBird code', async () => {
  const app = await boot();
  const A = app.window.__app;
  const rows = [
    { code: 'tufpuf', name: 'Tufted Puffin' },
    { code: 'commur', name: 'Common Murre' },
    { code: 'tuftit', name: 'Tufted Titmouse' },
    { code: 'purfin', name: 'Purple Finch' },
  ];
  // Array.from, not .map: searchSpecies returns an array from the JSDOM realm,
  // whose Array.prototype is not Node's, and deepStrictEqual compares
  // prototypes — so identical values fail with an unreadable diff.
  const find = (q) => Array.from(A.searchSpecies(rows, q), (s) => s.code);

  assert.deepEqual(find('tufpuf'), ['tufpuf'], 'a full code finds exactly its bird');
  assert.deepEqual(find('commur'), ['commur'], 'and another');
  // A code PREFIX works, and so does the name — "tuf" is both the start of two
  // codes and the start of a word in two names, and must not return one bird
  // twice.
  assert.deepEqual(find('tuf').sort(), ['tuftit', 'tufpuf'].sort(),
    'a prefix matches codes and names alike, without duplicating a bird');
  assert.deepEqual(find('Tufted').sort(), ['tuftit', 'tufpuf'].sort(),
    'name search is untouched');
  assert.deepEqual(find('purple'), ['purfin'], 'including a word that is only in the name');
  assert.deepEqual(find('xyzzy'), [], 'and nothing matches nothing');

  // A code is tried as a WHOLE STRING, not split into word terms: a code has no
  // word breaks, so splitting "tufpuf" would make it match nothing at all.
  assert.ok(A.searchSpecies(rows, 'tufpuf').length === 1,
    'the code is matched whole');
  app.window.close();
});


// "is there a way for the app to get my birdlist dynamically?"
//
// Not directly — an eBird API key identifies an APP, not a person, so there is
// no "my life list" endpoint to call. But your checklists are PUBLIC, and
// product/lists/{county} carries userDisplayName on every row. That is a feed
// this app ALREADY fetches for Birder convoys, so the incremental half costs
// nothing: measured 2026-08-09, 200 rows covers the last 2-3 days in King and
// Snohomish and contained this reader's own checklists in both.
test('your own checklists top up the year list, for free', async () => {
  const lists = [
    { subId: 'S1', userDisplayName: 'Birder Wyatt', numSpecies: 10,
      loc: { locId: 'L1', locName: 'Charles Richey' } },
    { subId: 'S2', userDisplayName: 'Someone Else', numSpecies: 5,
      loc: { locId: 'L1', locName: 'Charles Richey' } },
  ];
  const viewed = [];
  const app = await boot({
    fetch(url) {
      const m = /product\/checklist\/view\/(S\d)/.exec(String(url));
      if (m) {
        viewed.push(m[1]);
        return { obs: m[1] === 'S1'
          ? [{ speciesCode: 'tufpuf' }, { speciesCode: 'commur' }]
          : [{ speciesCode: 'shouldnotappear' }] };
      }
      return null;
    },
  });
  const A = app.window.__app, W = app.window;
  W.localStorage.setItem('ebird_display_name', 'Birder Wyatt');

  assert.equal(A.isOwnRow(lists[0]), true, 'your checklist is yours');
  assert.equal(A.isOwnRow(lists[1]), false, 'and somebody else\'s is not');

  assert.equal(await A.harvestOwnChecklists(lists), 1, 'one checklist to read');
  assert.deepEqual(Array.from(viewed), ['S1'],
    'ONLY yours is fetched — reading the whole county would be the expensive '
    + 'thing this exists to avoid');
  assert.deepEqual(Object.keys(A.ownSeenCodes()).sort(), ['commur', 'tufpuf'],
    'and its species are now known');

  // Idempotent: a checklist already read is never bought twice, however many
  // times the feed returns it.
  viewed.length = 0;
  assert.equal(await A.harvestOwnChecklists(lists), 0, 'nothing new to do');
  assert.deepEqual(Array.from(viewed), [], 'and nothing re-fetched');

  // The point: a bird you filed since the bundle was built stops being a target.
  assert.ok(A.getReportSeen().tufpuf, 'a bird you reported counts as seen');
  assert.ok(!A.getReportSeen().shouldnotappear,
    'and a bird from somebody else\'s checklist does not');
  app.window.close();
});

// The watchlist still wins. A tentative ID is deliberately HELD OFF the year
// list so it keeps resurfacing as a target — and you filed a checklist for it,
// which is exactly why it is tentative. Your own checklist must not tick it.
test('a bird you are holding back is not ticked by your own checklist', async () => {
  const app = await boot({
    fetch(url) {
      return /product\/checklist\/view\/S1/.test(String(url))
        ? { obs: [{ speciesCode: 'tufpuf' }] } : null;
    },
  });
  const A = app.window.__app, W = app.window;
  W.localStorage.setItem('ebird_display_name', 'Birder Wyatt');
  await A.harvestOwnChecklists([{ subId: 'S1', userDisplayName: 'Birder Wyatt' }]);
  assert.ok(A.getReportSeen().tufpuf, 'ticked while nothing is held');

  // Now hold it back.
  W.localStorage.setItem('ebird_watchlist_v1',
    JSON.stringify([{ code: 'tufpuf', name: 'Tufted Puffin' }]));
  assert.ok(!A.getReportSeen().tufpuf,
    'the watchlist subtracts it again — the union is applied BEFORE the '
    + 'watchlist, never after');
  app.window.close();
});


// The seen set just changed, so every chase view computed from the old one is
// stale — the same reason setWatchlist() clears it. Without this a bird you
// logged this morning went on being offered as a target until the 30-minute
// memo lapsed. Verified against live data on 2026-08-09: two of this reader's
// own checklists carried Tufted Puffin and Wandering Tattler, neither of which
// is on the bundled Washington year list.
test('learning a bird from your own checklist refreshes what is a target', async () => {
  let waves = 0;
  const app = await boot({
    fetch(url) {
      const u = String(url);
      if (/product\/checklist\/view\/S1/.test(u)) return { obs: [{ speciesCode: 'tufpuf' }] };
      if (/notable/.test(u)) waves++;
      if (/data\/obs\//.test(u)) return [];
      return null;
    },
  });
  const A = app.window.__app, W = app.window;
  const doc = () => app.window.document;
  W.localStorage.setItem('ebird_display_name', 'Birder Wyatt');

  // Settling is measured by the CALL COUNT going quiet, not by the Refresh
  // button. The button re-enables as soon as the rarity feeds land — the
  // rarity list is complete at that point — while the rest of the wave is
  // still in flight, so it never answered "has the wave finished".
  const waitQuiet = async (what) => {
    let last = -1;
    await waitFor(async () => {
      if (last === waves) return true;
      last = waves;
      await new Promise((r) => setTimeout(r, 400));
      return last === waves;
    }, what);
  };

  A.refresh();
  await waitFor(() => waves > 0, 'the first wave');
  // Sampled once the first wave is DONE. Sampling mid-wave made the next
  // assertion measure the tail of this wave rather than a new one.
  await waitQuiet('the first wave to finish');
  const before = waves;

  // A checklist of yours appears carrying a bird the bundle does not know.
  const n = await A.harvestOwnChecklists([{ subId: 'S1', userDisplayName: 'Birder Wyatt' }]);
  assert.equal(n, 1, 'the checklist was read');
  assert.ok(A.getReportSeen().tufpuf, 'and the bird now counts as seen');

  // The next look must recompute rather than serve the memo that still calls
  // it a target.
  A.refresh();
  await waitFor(() => waves > before, 'the chase view to be rebuilt');
  assert.ok(waves > before,
    'learning a bird invalidates the cached chase view, exactly as changing '
    + 'the watchlist does');

  // ...but ONLY when something was learned. Re-running with nothing new must
  // not throw away a wave that is already correct.
  await waitQuiet('the rebuild to finish');
  const steady = waves;
  assert.equal(await A.harvestOwnChecklists([{ subId: 'S1', userDisplayName: 'Birder Wyatt' }]), 0);
  A.refresh();
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(waves, steady, 'nothing new means nothing re-fetched');
  app.window.close();
});


// A DEVICE LOG caught both of these, and the suite could not have.
//
//   [warn] hotspot checklists: Can't find variable: slot
//   [warn] chase snapshot not saved: QuotaExceededError
//
// The first was a ReferenceError thrown AFTER the list had already been
// written, and the section's own .catch turned it into a warning — so every
// hotspot list still rendered and only the media wiring silently never
// happened. Nothing failed, which is exactly why nothing caught it.
test('the media pass is wired inside the card loop, where slot exists', () => {
  // Line endings normalised on read. core.autocrlf=true and the blob is stored
  // with LF, so every fresh checkout on Windows hands this file back as CRLF —
  // and the literal '});\n        });' below then matches nothing, lastIndexOf
  // returns -1, and the assertion fails on a repo where nothing is wrong. A
  // guard that depends on how git happened to materialise the file is testing
  // the checkout, not the code.
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8')
    .replace(/\r\n/g, '\n');
  const fn = HTML.slice(HTML.indexOf('function hydrateHotspotChecklists'),
    HTML.indexOf('function hydrateLocSpecies'));

  const slotDecl = fn.indexOf("var slot = el.querySelector('.hsckl')");
  const usesSlot = fn.indexOf("var det = slot.querySelector('details.ckall')");
  assert.ok(slotDecl > -1 && usesSlot > slotDecl,
    'the media wiring reads slot AFTER it is declared');

  // ...and before the callback that declared it closes. Counting braces is
  // crude; what matters is that the toggle hook sits inside the forEach body,
  // so it is checked by position against the loop's own terminator.
  const loopEnd = fn.lastIndexOf('});\n        });');
  assert.ok(usesSlot < loopEnd,
    'and inside the per-card loop, not after it — reading a per-card variable '
    + 'once the loop has finished is how this broke on device while every test '
    + 'stayed green');
});

// The chase snapshot is the most expensive object the app owns — ~47 calls and
// two minutes — and the device log caught it losing its place to single-call
// checklist entries. The priority was exactly inverted.
test('the expensive snapshot evicts cheap caches rather than giving up', () => {
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  const fn = HTML.slice(HTML.indexOf('function saveChaseSnapshot'),
    HTML.indexOf('function loadChaseSnapshot'));

  assert.match(fn, /freeCacheSpace\(/,
    'a quota failure makes room instead of shrugging');
  // Was `attempt < 3`. A device log showed three attempts freeing two
  // checklists between them and failing anyway: the retry count was never the
  // limit, the size of the drawer was. Retries are cheap (a failed setItem
  // throws immediately) so the loop now runs until it fits or there is
  // genuinely nothing disposable left.
  assert.match(fn, /attempt < 12/, 'and retries until it fits, rather than dropping the wave');
  assert.match(fn, /if \(!n\) \{/,
    'giving up only when there is genuinely nothing cheap left to drop');
  // Our own expired copies go BEFORE the write. pruneChaseSnapshots ran after
  // it, so every attempt competed with yesterday's garbage — the one thing in
  // the store guaranteed to be worthless.
  assert.ok(fn.indexOf('pruneChaseSnapshots()') < fn.indexOf('localStorage.setItem(chaseKey'),
    "yesterday's snapshots are dropped before the write, not after it");
  // A failure now names what actually filled the store, so the next device log
  // is evidence instead of inference.
  assert.match(fn, /storeComposition\(\)/, 'and a failure says what the store is made of');

  // The eviction can reach more than one namespace. "freed 2 cached
  // checklists to make room" followed by a failed write proved the drawer we
  // were opening was nearly empty while the rest of the store sat untouched.
  assert.match(HTML, /var DISPOSABLE = \[/, 'there is a ranked list of what may be dropped');
  const disposable = /var DISPOSABLE = \[([\s\S]*?)\];/.exec(HTML)[1];
  assert.match(disposable, /'bc_ckl:'/, 'cheapest first: a checklist costs one call');
  assert.match(disposable, /'ebird_photos_v2'/, 'and it reaches the big blob caches too');
  // The rule that matters: nothing the network cannot hand back.
  [['ebird_watchlist_v1', 'your watchlist'],
   ['ebird_own_seen:', 'birds harvested from your own checklists'],
   ['ebird_rankhist:', 'rank history accumulated a day at a time'],
   ['ebird_rarity_seen:', 'which rarities you have already been shown'],
   ['ebird_api_key', 'your key']].forEach(([k, what]) => {
    assert.ok(disposable.indexOf(k) < 0, `${what} (${k}) is not a cache and is never evicted`);
  });

  // The cap came down with it: 900 checklist entries at 1-2 KB each is most of
  // an iOS origin's 5 MB, before the seed, the photos and the ticks cache.
  assert.match(HTML, /var CKL_CACHE_MAX = 250;/, 'the checklist cap is 250, not 900');
  // ...and it is enforced DURING a session. Pruning only at boot is what let a
  // long session accumulate until the snapshot could not be written.
  assert.match(HTML, /_cklWrites % 40\) === 0\) pruneChecklistCache\(\)/,
    'the cache is trimmed as it grows, not only at the next launch');
});


// A device log caught two waves overlapping — started 23 seconds apart,
// finishing "phase 2 done in 185.8s" and "163.1s" back to back, both writing a
// snapshot, both fighting the same token bucket. The limiter sat at window
// 21/20 with single calls stalling 30 to 60 seconds.
//
// The cause was the force path deleting the in-flight promise, which is the
// very guard that stops a second wave starting. You cannot be more up to date
// than a fetch that is in progress.
test('a forced refresh joins a running wave instead of racing it', async () => {
  let waves = 0;
  const app = await boot({
    fetch(url) {
      const u = String(url);
      if (/notable/.test(u)) waves++;
      if (/data\/obs\//.test(u)) return [];
      return null;
    },
  });
  const A = app.window.__app, doc = app.window.document;

  // Start a wave and, WITHOUT waiting, force another. The second must not
  // start a rival.
  A.refresh();
  doc.getElementById('sec-refreshBtn').querySelector('.refreshbtn').click();
  A.refresh();
  await waitFor(() => !doc.getElementById('refreshBtn').disabled, 'the wave to finish');
  await new Promise((r) => setTimeout(r, 400));

  // Six region feeds per wave, three of them notable. More than one wave's
  // worth here means two ran at once.
  assert.ok(waves <= 3,
    `one wave's worth of alert feeds, not two: ${waves}`);

  // ...and the guard is the in-flight promise, kept rather than deleted.
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  const gc = HTML.slice(HTML.indexOf('function getChase('),
    HTML.indexOf('function getChase(') + 2200);
  assert.match(gc, /if \(_chaseInflight\[slug\]\) return _chaseInflight\[slug\];/,
    'a force joins the running wave');
  assert.ok(!/delete _chaseInflight\[slug\];/.test(gc),
    'and never deletes the guard that makes that possible');
  app.window.close();
});


// "✖ [error] GET 403 api.ebird.org/v2/product/region/US-WA/ebirders/count"
//
// Not a bug, and not a key problem: that endpoint refuses EVERY public API key
// — verified against the live API — so the 403 is the deliberate first step of
// a two-step that then tries a web token scraped from ebird.org. Logging it as
// an ERROR made a working design look broken in every session log.
//
// What WAS wrong is that the whole dance repeated on every rankings load — one
// dead call plus one HTML fetch each time — for a number the card simply omits
// when it cannot be had.
test('a number eBird will not give is asked for once a day, not once a load', () => {
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  const fn = HTML.slice(HTML.indexOf('function ebirderCount('),
    HTML.indexOf('function rankNum('));

  // The failure is remembered. store() used to return early on null, so only
  // successes were cached and a failure was retried forever.
  assert.match(fn, /n == null \? null : Math\.round\(n\)/,
    'a null is written to the cache rather than discarded');
  assert.match(fn, /n == null \? store\(null\) : n/,
    'and the failing path actually calls store');

  // ...and it always settles. The fallback fetches a PAGE, and a request that
  // never resolves would leave this pending — which would also mean the
  // negative result is never recorded, so the dead call returns every load
  // anyway. Verified functionally: the second call costs zero attempts.
  assert.match(fn, /Promise\.race\(/, 'the attempt is capped');
  assert.match(fn, /setTimeout\(function \(\) \{ res\(null\); \}, 12000\)/,
    'at 12 seconds — long enough for a page on a phone, short enough that a '
    + 'stall does not hold the promise for the session');

  // The log line is honest about what it is.
  const dbg = HTML.slice(0, HTML.indexOf('</script>'));
  assert.match(dbg, /r\.status === 403 && \/\\\/ebirders\\\/count\//,
    'an expected 403 is logged as a warning, not as an error');
});


// "number one has nonunseen birds" — Sandel Lookout, ranked #1, reading
// "score 6 · 2 rarities · 2 targets" with nothing under it but "15 more species
// already seen".
//
// TWO MOMENTS, one card. The chase view scored those targets against the seen
// set as it was when the wave ran; the card's list is split against the set as
// it is NOW. Those stopped agreeing the day the app began learning birds from
// your own checklists — the two "targets" were the Tufted Puffin and Wandering
// Tattler you had just been credited with.
//
// So the LIST was right and the FACTS LINE was stale. The count now follows the
// list rather than the other way round.
test('a hotspot counts only the targets you still need, right now', async () => {
  const app = await boot();
  const A = app.window.__app;
  const rep = app.window.__SEED_BIRDLIST__.seenByReport[A.getReportSlug()];
  rep.codes = ['tufpuf', 'wantat1']; rep.watchHeld = []; rep.names = [];
  app.window.localStorage.setItem('ebird_seen_field', 'speciesCode');

  // Scored as two rarities — but both are birds you have since logged.
  const stale = A.toDest({ locId: 'L1', locName: 'Sandel Lookout', lat: 47.7, lon: -122.3,
    score: 6, species: [{ name: 'Tufted Puffin', code: 'tufpuf', kind: 'Rarity' },
                        { name: 'Wandering Tattler', code: 'wantat1', kind: 'Rarity' }] });
  assert.equal(stale.species.length, 0,
    'a bird you have seen is not a target, however it was scored');
  // The rarity count is a count OF THOSE SPECIES, so it has to move too —
  // otherwise the card says "2 rarities" over a list holding none, which is the
  // same bug wearing a different number.
  assert.equal(stale.rare, 0, 'and the rarity count follows the species, not the score');

  // renderDestinations drops a zero, so the hotspot leaves the section rather
  // than sitting at #1 answering its own question with "do not go".
  assert.ok(!(stale.species.length > 0), 'so it is filtered out of the list entirely');

  // A hotspot that genuinely holds something you need is untouched.
  const real = A.toDest({ locId: 'L2', locName: 'Marina Beach Park', lat: 47.8, lon: -122.4,
    score: 3, species: [{ name: 'Common Loon', code: 'comloo' },
                        { name: 'Common Murre', code: 'commur', kind: 'Rarity' }] });
  assert.equal(real.species.length, 2, 'the birds you still need survive');
  assert.equal(real.rare, 1, 'with their rarity count intact');
  assert.equal(real.species[0].comName, 'Common Loon', 'and their names');
  app.window.close();
});


// "top deatination is showing dated checklist format that doesnt have the media
// icons or newly added formating. check template cards"
//
// The rows DID go through the shared card already — what they never got was the
// evidence. The checklist entry each row is built from was dropping `evidence`
// on the way out of the cluster builder, so recordIcons had nothing to render
// and this was the last list still showing bare rows.
test('unseen place rows carry the media mark, like every other list', async () => {
  const app = await boot();
  const A = app.window.__app;
  const html = A.unseenPlacesHtml([{
    loc: 'The Produce Market', locId: 'L1', lat: 47.8, lon: -122.2,
    distMi: 5.1, dateStr: '2026-08-09 16:46',
    checklists: [
      { subId: 'S1', dateStr: '2026-08-09 16:46', count: 1, valid: true, evidence: 'P' },
      { subId: 'S2', dateStr: '2026-08-08 09:23', count: 1, valid: true, evidence: '' },
    ],
  }]);

  assert.match(html, /\u{1F4F7}/u, 'the checklist with a photo says so');
  // ...and only that one. A mark on a row with no media would be worse than
  // none, because it is a claim about evidence that does not exist.
  assert.equal((html.match(/\u{1F4F7}/gu) || []).length, 1,
    'and the one without stays bare');

  // The rest of the shared formatting reaches here too, which is the point of
  // it being shared: numeric date, and a count that is never ambiguous.
  assert.match(html, /8\/9 4:46p/, 'the abbreviated date');
  assert.match(html, /class="ckcount"[^>]*>\u00d71/,
    'the count is blank again - which used to mean either one bird or eBird\u2019s '
    + '"X", and a reader could not tell which');
});

// "in main menu, move go birding section above rare birds."
//
// The MENU array already listed Go birding first. MENU_GROUPS is the array that
// actually decides the order, and it disagreed — two orderings for one menu,
// the same shape as every heading that disagreed with its own rows.
test('the menu leads with Go birding, not Rare birds', () => {
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  const m = /var MENU_GROUPS = \[([^\]]+)\]/.exec(HTML);
  assert.ok(m, 'the group order is a named array');
  const groups = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  const go = groups.indexOf('Go birding'), rare = groups.indexOf('Rare birds');
  assert.ok(go > -1 && rare > -1, 'both groups exist');
  assert.ok(go < rare,
    `Go birding (${go}) comes before Rare birds (${rare}) — "where do I go" is `
    + 'the question with a deadline; a rarity keeps');
});


// "new seen birds are missing" — from My year, and ONLY from My year: the same
// birds had correctly stopped being offered as targets everywhere else.
//
// That split is the bug. The harvest stored a set of CODES, which is all "is
// this bird seen?" needs, and My year is the one section that does not ask
// that — it renders a list, so it needs a name, a date, a checklist and a
// place. A code cannot be a row.
test('a bird harvested from your own checklist is a row, not just a tick', async () => {
  const lists = [{
    subId: 'S1', userDisplayName: 'Birder Wyatt', numSpecies: 3,
    isoObsDate: '2026-08-09 16:46',
    loc: { locId: 'L4321', name: 'Edmonds Waterfront', isHotspot: true },
  }];
  const app = await boot({
    fetch(url) {
      const u = String(url);
      if (/product\/checklist\/view\/S1/.test(u)) return { obs: [{ speciesCode: 'tuftpu' }] };
      // ONE taxonomy call turns the codes into names. Fetched here, before the
      // record is stored, rather than lazily at paint time — where a failure
      // would leave a permanent blank in the list.
      if (/ref\/taxonomy\/ebird/.test(u)) {
        assert.match(u, /species=tuftpu/, 'and it asks only for what was learned');
        return [{ speciesCode: 'tuftpu', comName: 'Tufted Puffin' }];
      }
      return null;
    },
  });
  const A = app.window.__app, W = app.window;
  W.localStorage.setItem('ebird_display_name', 'Birder Wyatt');
  await A.harvestOwnChecklists(lists);

  // The tick is durable BEFORE the name lookup is awaited. That ordering is
  // the load-bearing part: a name is a rendering detail, and a taxonomy call
  // that never returns must not be able to hold up the thing that stops a bird
  // you logged this morning being offered as a target.
  assert.ok(A.getReportSeen().tuftpu, 'seen the moment the checklist is read');
  await A.nameOwnCodes();

  const rec = A.ownSeenCodes().tuftpu;
  assert.equal(typeof rec, 'object', 'the entry is a record now');
  assert.equal(rec.n, 'Tufted Puffin', 'with the name My year needs to print');
  // The date, the place and the subId were ALREADY in the product/lists row —
  // this costs no extra call, it just stopped throwing them away.
  assert.equal(rec.d, '9 Aug 2026', "in the export's own date shape");
  assert.equal(rec.s, 'S1', 'the checklist it came from');
  assert.equal(rec.l, 'Edmonds Waterfront', 'and where');

  const merged = A.mergedYearList();
  const row = merged.filter((e) => e.code === 'tuftpu')[0];
  assert.ok(row, 'so it reaches the list');
  assert.equal(row.name, 'Tufted Puffin');
  assert.ok(row.own, 'flagged, because it is the reason the count now runs '
    + 'ahead of the eBird page the heading links to');

  // ...and it still does the job it already did.
  assert.ok(A.getReportSeen().tuftpu, 'while still counting as seen');
  app.window.close();
});

// A name lookup that fails leaves a record that cannot be rendered — so the
// next harvest simply tries again, at no cost when there is nothing to fix.
test('a name that failed to resolve is retried, not lost', async () => {
  let allow = false;
  const app = await boot({
    fetch(url) {
      const u = String(url);
      if (/product\/checklist\/view\/S1/.test(u)) return { obs: [{ speciesCode: 'tuftpu' }] };
      if (/ref\/taxonomy\/ebird/.test(u)) {
        return allow ? [{ speciesCode: 'tuftpu', comName: 'Tufted Puffin' }] : { __status: 500 };
      }
      return null;
    },
  });
  const A = app.window.__app, W = app.window;
  W.localStorage.setItem('ebird_display_name', 'Birder Wyatt');
  await A.harvestOwnChecklists([{
    subId: 'S1', userDisplayName: 'Birder Wyatt', isoObsDate: '2026-08-09 16:46',
    loc: { locId: 'L1', name: 'Here', isHotspot: true },
  }]);
  await A.nameOwnCodes();
  assert.equal(A.ownSeenCodes().tuftpu.n, '', 'no name yet');
  assert.ok(A.getReportSeen().tuftpu, 'but the bird is still seen — that half never depended on it');
  assert.equal(A.mergedYearList().filter((e) => e.code === 'tuftpu').length, 0,
    'and it is kept OUT of the list rather than rendered as a blank row');

  allow = true;
  await A.nameOwnCodes();
  assert.equal(A.ownSeenCodes().tuftpu.n, 'Tufted Puffin', 'the retry fills it in');
  assert.equal(A.mergedYearList().filter((e) => e.code === 'tuftpu').length, 1, 'and now it is a row');
  app.window.close();
});

// The export is newest-first. A harvested bird is INSERTED at the first row it
// is newer than, rather than the whole list being re-sorted on a date field
// some rows may not have — a rebuild would reorder the export using a weaker
// key than the one that built it.
test('the export keeps its own order when new birds are merged in', async () => {
  const app = await boot();
  const A = app.window.__app, W = app.window;
  const seed = A.reportYearList();
  if (!seed.length) { app.window.close(); return; }
  // Dated TODAY rather than a frozen '9 Aug 2026'. The merged list sorts
  // newest-first, so a hardcoded date silently stops being the newest the
  // moment a fresher export is pasted - which is exactly what happened on
  // 2026-08-12. The fixture's premise is "newer than the export", so it should
  // say that rather than assert a date that used to mean it.
  const _mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const _now = new Date();
  const todayExportDate = _now.getDate() + ' ' + _mon[_now.getMonth()] + ' ' + _now.getFullYear();
  W.localStorage.setItem('ebird_own_seen:' + A.getReportSlug(), JSON.stringify({
    aaaaaa: { n: 'Brand New Bird', d: todayExportDate, s: 'S1', l: 'Here', i: 'L1', h: 1 },
    // A bare 1 is what harvests before this change stored. It still marks the
    // bird seen; it simply has no name, and a row with no name is worse than
    // no row.
    bbbbbb: 1,
  }));
  const merged = A.mergedYearList();
  assert.equal(merged.length, seed.length + 1, 'one row added, one skipped');
  assert.equal(merged[0].code, 'aaaaaa', 'the newest bird leads');
  assert.deepEqual(merged.filter((e) => !e.own).map((e) => e.code), seed.map((e) => e.code),
    'and the export is in exactly the order it arrived in');

  A.updateMyYear();
  const rows = W.document.getElementById('myYearList').querySelectorAll('li');
  assert.equal(rows.length, seed.length + 1);
  // report.py numbers the OLDEST #1, so a newly added bird is #N.
  // .trim() because the row now renders through the shared medium card, whose
  // template indents its markup — the assertion is about the NUMBER, and
  // leading whitespace was incidental to the hand-rolled <li> it replaced.
  assert.match(rows[0].textContent.trim(), new RegExp('^' + (seed.length + 1) + '\\.'),
    'numbered as the newest, not renumbered from the top');
  assert.match(rows[0].textContent, /new since the export/,
    'and it says why it is not on the eBird page');
  app.window.close();
});


// The device log that forced this open:
//
//   [warn] freed 2 cached checklists to make room
//   [warn] chase snapshot not saved: QuotaExceededError
//
// Three attempts, two checklists freed between them, and 141 seconds plus 48
// calls discarded. The retry count was never the limit — the drawer we were
// opening was nearly empty while megabytes of other caches sat untouched.
test('a full store gives up its cheapest caches, not the wave', async () => {
  const app = await boot();
  const A = app.window.__app, W = app.window;

  W.localStorage.setItem('bc_ckl:S1', JSON.stringify({ d: '2026-08-01', o: '2026-08-01' }));
  W.localStorage.setItem('ebird_photos_v2', JSON.stringify({ a: 'https://x/1.jpg' }));
  W.localStorage.setItem('ebird_birdinfo_v2', JSON.stringify({ a: 'blurb' }));
  W.localStorage.setItem('easymiss_v1:x', '[]');
  // ...and the things that are not caches at all.
  W.localStorage.setItem('ebird_watchlist_v1', 'Tufted Puffin');
  W.localStorage.setItem('ebird_own_seen:wa', JSON.stringify({ tuftpu: { n: 'Tufted Puffin' } }));
  W.localStorage.setItem('ebird_rankhist:wa', '[1,2,3]');
  W.localStorage.setItem('ebird_rarity_seen:wa', '{}');

  const freed = A.freeCacheSpace(100);
  assert.ok(freed >= 4, `every disposable cache is reachable, not just checklists (freed ${freed})`);
  assert.equal(W.localStorage.getItem('bc_ckl:S1'), null, 'the cheapest thing goes');
  assert.equal(W.localStorage.getItem('ebird_photos_v2'), null, 'and so do the big blobs');

  // The rule that matters. A full disk is not a reason to lose something the
  // network cannot hand back.
  assert.equal(W.localStorage.getItem('ebird_watchlist_v1'), 'Tufted Puffin',
    'your watchlist survives');
  assert.ok(W.localStorage.getItem('ebird_own_seen:wa'),
    'so do the birds harvested from your own checklists');
  assert.equal(W.localStorage.getItem('ebird_rankhist:wa'), '[1,2,3]',
    'and the rank history, which is accumulated a day at a time and cannot be refetched');
  assert.ok(W.localStorage.getItem('ebird_rarity_seen:wa') != null,
    'and which rarities you have already been shown');

  // Nothing left to give is reported honestly, rather than looping.
  assert.equal(A.freeCacheSpace(100), 0, 'an empty drawer says so');
  app.window.close();
});


// "speed up the load time, especially of the rare bird alerts"
//
// Phase 1 is six calls and, with FG_MAX_CONC = 1, they are serial — a device
// log measured 20.8s before anything painted. Three of those six are the
// `notable` feeds, and in phase 1 a row is a Rarity if and ONLY if a notable
// feed carried it: mergeSnapshot sets kind='Rarity' from notableIds, and the
// `recent` feeds carry no rarity flag at all. So a rarity list built from the
// notable feeds alone is not an early approximation — it IS the phase-1 answer.
// Making it wait for the other three calls bought nothing.
test('the rarity feeds are fetched first, and paint without waiting for the rest', async () => {
  const order = [];
  const app = await boot({
    fetch(url) {
      const u = String(url);
      // Must RESOLVE: the foreground gate admits one call at a time, so a
      // stub that never settles means only ever one request goes out and the
      // order of the rest is unobservable.
      if (/data\/obs\/.*recent/.test(u)) {
        order.push(/notable/.test(u) ? 'notable' : 'recent');
        return [];
      }
      return [];
    },
  });
  const A = app.window.__app;
  A.getChase(false);
  // The three notable feeds go out before any of the recent feeds — the order
  // in which they are FETCHED, which planFeeds deliberately does not decide.
  await waitFor(() => order.length >= 3, 'the first three feeds');
  assert.deepEqual(Array.from(order).slice(0, 3), ['notable', 'notable', 'notable'],
    'rarity feeds lead, because they answer a whole section on their own');
  app.window.close();
});

// planFeeds is a cross-repo contract — the golden pins `feeds` and `mergeOrder`
// separately — so the app reorders only what it FETCHES. Results are keyed by
// file, which is what makes that safe.
test('fetch order is the app\'s business; merge order is the contract', () => {
  const BL = require(path.join(__dirname, '..', 'www', 'logic.js'));
  const profile = {
    slug: 'wa', counties: [{ slug: 'king', code: 'US-WA-033', label: 'King' },
                           { slug: 'snohomish', code: 'US-WA-061', label: 'Snohomish' }],
    home: { lat: 47.75, lng: -122.16 }, geoDistKm: 50,
  };
  const kinds = BL.planFeeds(profile).map((f) => f.kind);
  assert.deepEqual(kinds, ['recent', 'notable', 'recent', 'notable', 'recent', 'notable'],
    'planFeeds still returns the report\'s order, untouched');

  const run = HTML.slice(HTML.indexOf('function runWave()'),
                         HTML.indexOf('// A cold start had nothing in memory'));
  assert.match(run, /f\.kind === 'notable' \? early : rest/,
    'and the split that reorders the fetch lives in the app, not in the plan');
  // A profile with no notable feeds (or no recent ones) must not end up
  // fetching an empty first group and publishing a view built from nothing.
  assert.match(run, /if \(!early\.length \|\| !rest\.length\) \{ early = feeds; rest = \[\]; \}/,
    'a profile that does not split simply runs as one group');
});

// The partial is complete for rarities and badly incomplete for everything
// else, so it must never reach the cache every other section reads. "All
// unseen reports" rendering from notable feeds alone would confidently show
// almost nothing.
test('the early rarity view never leaks into the shared chase cache', () => {
  const src = HTML.slice(HTML.indexOf('function runWave()'),
                         HTML.indexOf('// A cold start had nothing in memory'));
  assert.match(src, /_chaseRarity\[slug\] = \{/, 'the partial has its own home');
  // `_chase` is assigned in exactly one place — finish(), which is only ever
  // called with a complete phase-1 view. Asserting the ABSENCE of the
  // assignment inside runWave is what makes this hard to defeat by accident.
  assert.ok(!/_chase\[slug\]\s*=/.test(src),
    'and runWave never writes the shared cache itself — finish() does that, '
    + 'and only with a complete phase-1 view');
  assert.match(src, /delete _chaseRarity\[slug\];/,
    'and it is dropped the moment the real phase-1 view exists');
  // Only the sections a notable feed can COMPLETELY answer repaint on it.
  const early = HTML.slice(HTML.indexOf('function onRarityEarly'),
                           HTML.indexOf('function getChase(force)'));
  assert.match(early, /\['refreshBtn', 'activeBtn', 'surgeBtn'\]/,
                           'exactly the sections a notable feed can answer — surgeBtn joined once its '
                           + 'needs lane became notable-only, because then its rows come from these '
                           + 'three feeds and nothing else');
  assert.match(early, /if \(!_autoLoaded\[id\]\) return;/,
    'and only if they are actually open');
});


// A document that quotes constants goes stale silently — API-CALLS.md spent
// several releases telling readers the app paced at 0.3/s and a bucket of 8
// after both had been raised, and recommending four things that had shipped.
// If the numbers are worth writing down they are worth pinning.
test('the API docs quote the constants the app actually uses', () => {
  const docs = ['API-CALLS.md', 'QUERY-PLAN.md'].map((f) =>
    fs.readFileSync(path.join(__dirname, '..', 'docs', f), 'utf8')).join('\n');
  const constants = [
    /var FG_MAX_CONC = (\d+)/, /FG_MIN_GAP_MS = (\d+)/, /FG_BUCKET = (\d+)/,
    /FG_REFILL_PER_S = ([\d.]+)/, /FG_WINDOW_MS = (\d+)/, /FG_WINDOW_MAX = (\d+)/,
  ];
  constants.forEach((re) => {
    const m = re.exec(HTML);
    assert.ok(m, `${re} is still a named constant`);
    assert.ok(docs.indexOf(m[1]) >= 0,
      `the docs quote ${re.source} as ${m[1]}; update them when it changes`);
  });
  // The checklist cap and the eviction rule are quoted too.
  assert.match(HTML, /var CKL_CACHE_MAX = 250;/);
  assert.ok(/250/.test(docs), 'the checklist cap is quoted');
  // And the two files cross-reference rather than drifting into two accounts.
  assert.match(docs, /QUERY-PLAN\.md/, 'API-CALLS points at the query plan');
});


// "none of the locations are near yakima" — correct, and they never could be.
//
// The reader searched Yakima, and the header said "6 hotspots · from Yakima"
// above a list whose nearest entry was 124 mi away in Puget Sound.
// rerankFromAnchor recomputes distances and re-sorts, but the candidates come
// from this report's counties plus a 50 km circle around HOME; searching a
// place outside them re-ranks that same list rather than finding new ones.
// And the sort is score-first with distance only as a tie-break, so a 124-mile
// hotspot still led. Neither is a wrong number; together they read as "the best
// spots near Yakima", which is not what they are.
test('a list that cannot reach the anchor says what it covers', async () => {
  const app = await boot();
  const A = app.window.__app;

  // Silent when the list can actually answer the question.
  assert.equal(A.coverageNote([{ dist: 12 }, { dist: 40 }]), '',
    'nothing to explain when something is within a chase');
  assert.equal(A.coverageNote([]), '', 'and nothing to explain about an empty list');

  // ...and explicit when it cannot. This is the screenshot's case.
  const note = A.coverageNote([{ dist: 124 }, { dist: 150 }]);
  assert.match(note, /nearest is 124 mi/, 'it leads with the fact that was missing');
  assert.match(note, new RegExp(A.countyLabelStr().replace(/\+/g, '\\+')),
    'and names what the report actually covers');
  assert.match(note, /nothing closer was fetched/,
    'saying WHY, because "no results nearby" and "we never looked nearby" are '
    + 'different answers and only one of them is true here');

  // The threshold is the chase radius, not a magic number.
  const r = A.chaseMaxMi();
  assert.equal(A.coverageNote([{ dist: r - 1 }]), '', 'inside the chase radius, silent');
  assert.ok(A.coverageNote([{ dist: r + 1 }]), 'outside it, explained');
  app.window.close();
});

// The pill has to move with the anchor. After a successful Find the label read
// "from Yakima" while the Home pill stayed lit — quickOrigin was set to 'find'
// and syncAnchorSwitches() was never called, so the control and the status line
// were two sources of truth for one anchor.
test('choosing Find lights Find, not Home', () => {
  const src = HTML.slice(HTML.indexOf('var go = function ()'),
                         HTML.indexOf('function syncAnchorSwitches'));
  // Every branch that assigns quickOrigin in the sheet has to re-sync.
  const assigns = [...src.matchAll(/quickOrigin = '(\w+)';/g)];
  assert.ok(assigns.length >= 2, 'the sheet sets the anchor in more than one place');
  assigns.forEach((m, n) => {
    // Bounded by the NEXT assignment, not a fixed window — otherwise one
    // branch's re-sync vouches for a neighbour that has none.
    const end = n + 1 < assigns.length ? assigns[n + 1].index : src.length;
    const after = src.slice(m.index, end);
    assert.match(after, /sync(AnchorSwitches|QuickButtons)\(\)/,
      `${m[0]} is followed by a re-sync before the next branch — the control `
      + 'must not disagree with the label it sits above');
  });
});


// "The quick outing report should display data the same way as top
// destinations." It already built the SAME card — hotspotCard — so the
// structure matched; what it never did was HYDRATE it. Every row was a name, a
// distance and an all-time count, with no unseen/seen split and no checklists,
// because renderDestinations ends with three calls Quick outing never made.
test('quick outing hydrates its cards like top destinations does', async () => {
  const locCalls = [];
  const app = await boot({
    fetch(url) {
      const u = String(url);
      if (/ref\/hotspot\/geo/.test(u)) {
        return [{ locId: 'L1', locName: 'Yakima Sportsman SP', lat: 46.60, lng: -120.45,
                  numSpeciesAllTime: 210, latestObsDt: '2026-08-10 07:00' }];
      }
      if (/data\/obs\/(L\d+)\/recent/.test(u)) {
        locCalls.push(u.match(/data\/obs\/(L\d+)/)[1]);
        return [
          { speciesCode: 'zztuft2', comName: 'Zed Test Puffin', subId: 'S1', obsDt: '2026-08-10 07:00' },
          { speciesCode: 'amecro', comName: 'American Crow', subId: 'S1', obsDt: '2026-08-10 07:00' },
        ];
      }
      return [];
    },
  });
  const A = app.window.__app, W = app.window, D = W.document;
  W.localStorage.setItem('ebird_home_lat', '46.60');
  W.localStorage.setItem('ebird_home_lng', '-120.45');
  A.loadQuickOuting('home');

  const el = () => D.getElementById('quickResults');
  // Wait for the CALL, not for .hslists — that slot is part of the card
  // template and exists before anything hydrates it, so waiting on it returns
  // immediately and measures nothing.
  await waitFor(() => locCalls.length >= 1, 'the per-hotspot species feed');

  // The per-hotspot feed is data/obs/{locId}/recent — scoped to the LOCATION,
  // not to the report's counties, which is why this works from any anchor.
  assert.match(locCalls[0], /^L\d+$/, 'it asks each hotspot what has been reported there');

  const txt = () => el().textContent.replace(/\s+/g, ' ');
  await waitFor(() => /unseen/.test(txt()), 'the unseen split');
  assert.match(txt(), /unseen/, 'a bird you still need is called out');

  // ...and the all-time count is NOT rewritten. hydrateLocSpecies corrects a
  // species count that came from a location feed; numSpeciesAllTime off
  // ref/hotspot/geo is a different, correct fact, and rewriting it produced
  // "210 species in 3d all-time".
  assert.match(txt(), /210 species all-time/, 'the all-time count survives intact');
  assert.ok(!/in 3d all-time/.test(txt()),
    'the 3-day correction does not collide with a fact it does not own');
  app.window.close();
});


// "the bird photos in the aba alert large cards are getting cropped weird,
// cutting off parts of the bird."
//
// Measured against the photos the app actually fetches (Wikipedia summary API,
// 20 species): 11 of 20 are exactly 3:2 and lose nothing, which is why a fixed
// `aspect-ratio: 3/2` with `object-fit: cover` looked fine for so long. But
// Sharp-shinned Hawk is 2178x3132 and Yellow-headed Blackbird 1367x1914 —
// PORTRAIT shots, which lost 53% of their height. Tufted Puffin (760x667) lost
// 24%, Gray-crowned Rosy-Finch 22%, Ruddy Turnstone 17%. With object-position
// biased to 35% it is the bottom that goes: legs, tail, and most of a perched
// bird.
test('a card photo frame follows the photo, within limits', async () => {
  const app = await boot();
  const A = app.window.BirdIcons, D = app.window.document;
  const shot = (w, h, cls) => {
    const el = D.createElement('span');
    el.setAttribute('data-hero', '1');
    const img = D.createElement('img');
    if (cls) img.className = cls;
    Object.defineProperty(img, 'naturalWidth', { value: w });
    Object.defineProperty(img, 'naturalHeight', { value: h });
    A.fitHeroFrame(el, img);
    return el.style.aspectRatio ? parseFloat(el.style.aspectRatio) : null;
  };

  // The common case is untouched: a 3:2 photo still gets a 3:2 frame.
  assert.ok(Math.abs(shot(5478, 3652) - 1.5) < 0.01, '3:2 stays 3:2 — no crop, as before');

  // The ones that were being mutilated. Clamped rather than obeyed, so a card
  // cannot become a skyscraper.
  const hawk = shot(2178, 3132);          // 0.695 natural
  assert.equal(hawk, A.HERO_AR_MIN, 'a portrait photo is clamped, not squashed into 3:2');
  const lost = 1 - (2178 / 3132) / hawk;  // fraction of height still cropped
  assert.ok(lost < 0.15,
    `Sharp-shinned Hawk now loses ${Math.round(lost * 100)}% of its height, not 53%`);

  // Between the clamps nothing is cropped at all.
  assert.ok(Math.abs(shot(760, 667) - 760 / 667) < 0.01, 'Tufted Puffin is shown whole');
  assert.ok(Math.abs(shot(2838, 2271) - 2838 / 2271) < 0.01, 'and so is Ruddy Turnstone');

  // A panorama is clamped the other way rather than making a letterbox sliver.
  assert.equal(shot(4000, 1000), A.HERO_AR_MAX, 'very wide is clamped too');

  // The two images that are NOT photographs of this bird must not reshape the
  // card: the bundled seed is a 60px list icon on a mat, and the fallback is a
  // generic silhouette.
  assert.equal(shot(60, 60, 'birdpic isseed'), null, 'the bundled seed icon does not reshape the card');
  assert.equal(shot(512, 512, 'birdpic isfallback'), null, 'nor does the generic silhouette');

  // A non-hero thumb keeps its fixed 46px box.
  const li = D.createElement('span');
  const img = D.createElement('img');
  Object.defineProperty(img, 'naturalWidth', { value: 2178 });
  Object.defineProperty(img, 'naturalHeight', { value: 3132 });
  A.fitHeroFrame(li, img);
  assert.equal(li.style.aspectRatio, '', 'a list thumb is not a hero and is left alone');
  app.window.close();
});





// "some of the species items are not spanning the width of the screen, and the
// mile distance is not right aligned."
//
// The rows inside the "N more beyond X mi" expander. The medium card's CSS is
// child-scoped (`.obs.xl > li`) ON PURPOSE, so a nested small-card list cannot
// inherit the outer row's grid — but that also means an <li> sitting inside a
// <details> is not a child of the list and falls back to the pre-grid float
// layout: the name stops filling the row and the distance stops being a
// column. It was invalid markup too; <details> is not a permitted child of
// <ul>, nor a bare <li> of <details>.
test('the far-rarity expander keeps its rows inside a real list', () => {
  const src = HTML.slice(HTML.indexOf('if (far.length) {'),
                         HTML.indexOf('if (far.length) {') + 1400);
  assert.match(src, /<li class="farhost">/,
    'a host <li> makes the expander a legal child of the results <ul>');
  assert.match(src, /<ul class="obs big xl">/,
    'and the far rows sit in their own list, so the medium-card grid applies');
  // The wrapper class must match the medium card's own, or those rows render
  // at a different size than the identical rows above them.
  const wrapper = (CARDS_SPECIES.match(/medium: *'([^']+)'/)
               || CARDS_SPECIES.match(/medium: *"([^"]+)"/) || [])[1];
  assert.ok(wrapper, 'cards-species.js still names the medium wrapper');
  assert.ok(src.indexOf('<ul class="' + wrapper + '">') >= 0,
    'the nested list wears the medium wrapper "' + wrapper + '", not a lookalike');
  // ...and the host must opt OUT of being a card itself, or it draws an empty
  // frame around the expander.
  assert.match(HTML, /\.obs > li\.farhost \{[^}]*display: block/,
    'the host row is not styled as a card');
});


// "id like to make a help section that explains what each menu item report
// does."
//
// GENERATED, not written. Every section already carries an ℹ️ block and
// section-docs.json is the canonical source both this app and report.py read,
// so a hand-written help page would be a second copy of the same prose, free
// to drift from the first. This walks the menu and renders the SAME notes
// through the SAME renderer.
test('the help section is generated from the notes each section already carries', async () => {
  const app = await boot();
  const A = app.window.__app, D = app.window.document;
  await A.loadHelp();
  const host = D.getElementById('helpBody');

  // One entry per section that applies, grouped exactly as the menu groups it.
  const items = host.querySelectorAll('.helpitem');
  const links = app.links().length;
  assert.equal(items.length, links,
    'one help entry per menu tile — a section you can open is a section you can look up');
  assert.ok(host.querySelectorAll('.helpgroup').length >= 2, 'and it keeps the menu grouping');

  // The three things a reader actually needs, from the shared notes.
  assert.match(host.innerHTML, /How it is calculated/, 'how it decides');
  assert.match(host.innerHTML, /cannot tell you/,
    'and what it cannot tell you — the half a reader can never infer from the output');

  // Collapsed. The point is finding ONE answer without reading the other
  // twenty-four.
  assert.equal([...items].filter((d) => d.open).length, 0, 'every entry starts closed');
  // The manual sits last, after the thing you came in for.
  const groups = [...host.querySelectorAll('.helpgroup')].map((g) => g.textContent);
  // F141 appended a glossary AFTER the manual, deliberately - it is a key
  // to the words, not a section you can open. So this checks the SECTION
  // groups, preserving the original intent exactly: the manual is still
  // the last thing before it.
  const secGroups = groups.filter((g) => !/glossary/i.test(g));
  assert.equal(secGroups[secGroups.length - 1], 'Your list & the app',
    'and the group it lives in is the last one');
  app.window.close();
});

// "on the main menu display the ebird username and current ranking."
//
// Read from the cache the Rankings section already fills, and only when it is
// TODAY's and for THIS region. NEVER fetched: the menu is the first thing
// painted, and at 0.37 calls/s a lookup there delays every section behind a
// line of text.
test('the menu names you, from cache, without spending a call', async () => {
  const app = await boot();
  const A = app.window.__app, D = app.window.document, W = app.window;
  const before = app.state.fetches.length;

  // With nothing cached it says who you are and no more — a "—" where a number
  // belongs reads as a failure rather than as "not looked up".
  W.localStorage.setItem('ebird_display_name', 'Birder Wyatt');
  A.renderMenuIdentity();
  let txt = D.getElementById('menuIdentity').textContent;
  assert.match(txt, /Birder Wyatt/, 'the name shows');
  assert.doesNotMatch(txt, /#/, 'and no rank is invented when none is known');

  // With today's board cached for this region, the standing appears.
  W.localStorage.setItem('ebird_rank_cache_v2', JSON.stringify({
    'US-WA|2026|500|Birder Wyatt': { date: A.todayStr(),
      data: { region: 'US-WA', me: { rank: 42, species: 331, checklists: 120 } } },
  }));
  A.renderMenuIdentity();
  txt = D.getElementById('menuIdentity').textContent;
  assert.match(txt, /#42/, 'the cached rank is used');

  // A board for ANOTHER region must not be borrowed.
  W.localStorage.setItem('ebird_rank_cache_v2', JSON.stringify({
    'US-MO|2026|500|Birder Wyatt': { date: A.todayStr(),
      data: { region: 'US-MO', me: { rank: 7 } } },
  }));
  A.renderMenuIdentity();
  assert.doesNotMatch(D.getElementById('menuIdentity').textContent, /#7/,
    'a Missouri standing is not your Washington standing');

  // ...and a YESTERDAY board is not today's.
  W.localStorage.setItem('ebird_rank_cache_v2', JSON.stringify({
    'US-WA|2026|500|Birder Wyatt': { date: '2001-01-01',
      data: { region: 'US-WA', me: { rank: 9 } } },
  }));
  A.renderMenuIdentity();
  assert.doesNotMatch(D.getElementById('menuIdentity').textContent, /#9/,
    'a stale board is not shown as current');

  assert.equal(app.state.fetches.length, before, 'and none of that touched the network');
  app.window.close();
});


// "anywhere that has a collapsed list of items e.g. checklists, id like to
// lazy load their contents, so they dont make ebird calls until theyre
// expanded."
//
// Convoys were the app's largest eager spend after the chase wave — a convoy
// day is ~50 product/checklist/view reads, and a device log measured 35 live
// calls on this section alone, paid before anyone had asked what any convoy
// found.
//
// But convoys are NOT a collapsed list: "nothing in the section collapses -
// the user asked for plain lists" is a standing decision with its own guard,
// and the two requests have to both hold. So the trigger is VISIBILITY, the
// same one the photos already use: the list stays plain, and a convoy nobody
// scrolls to costs nothing.
test('convoy species are read when scrolled to, not all at once', () => {
  const src = HTML.slice(HTML.indexOf('var CONVOY_FETCH_CONC'),
                         HTML.indexOf('function pool('));

  assert.match(src, /new IntersectionObserver/,
    'the boxes are filled on visibility, not in a loop at render time');
  // ...and the observer is actually USED. Checking only that it is constructed
  // passed happily with the observe() call replaced by a loop that read every
  // box up front — which is the exact behaviour being removed.
  assert.match(src, /_convoyObs\.observe\(/, 'every box is handed to it');
  assert.ok(!/boxes\.reduce\([^)]*fillConvoyBox/.test(src.replace(/if \(!_convoyObs\)[\s\S]*?\n {8}\}/, '')),
    'and nothing reads them all in a loop outside the no-observer fallback');
  assert.match(src, /_convoyObs\.unobserve\(en\.target\)/,
    'and each is read once, not on every scroll past it');
  assert.match(src, /rootMargin/, 'starting just before it reaches the screen');

  // A webview without IntersectionObserver must still fill them. A section
  // that costs too much is a complaint; one that never loads is a bug.
  assert.match(src, /if \(!_convoyObs\)/, 'there is a fallback when the observer is missing');

  // The observer fires asynchronously, so the box may be gone by then —
  // fetching into a detached node spends a call on nobody.
  assert.match(src, /!box\.isConnected/, 'a detached box is not fetched into');

  // ...and it still says something while it works. ~50 reads is over a minute
  // at the measured rate, and a silent empty box that long reads as a failure.
  assert.match(src, /loadingdots/, 'a box that is working looks like it');
  assert.match(HTML, /@keyframes bcdots/, 'and that has an actual animation behind it');

  // The standing decision is untouched: still a plain list, no disclosure.
  const render = HTML.slice(HTML.indexOf('function renderConvoys('),
                            HTML.indexOf('function loadConvoySpecies('));
  assert.ok(!/<details|<summary/.test(render),
    'convoys remain plain lists — lazy loading did not smuggle in a toggle');
});


// "in the species lookup, by default do not show the checklists that are
// beyond the chase distance... when I sort the results by date it has too many
// that are outside of the chase distance, and this makes the list difficult to
// read. Sorting by distance doesnt cause the problem."
//
// Exactly so, and the reason is the useful part: sorting by DISTANCE puts
// everything reachable at the top, so the far rows fall off the end and cost
// nothing. Sorting by DATE interleaves them, and a bird reported this morning
// 200 miles away outranks one reported yesterday down the road — true, and not
// what the list is for.
test('species lookup shows what you can drive to first, and keeps the rest', async () => {
  const app = await boot();
  const A = app.window.__app;
  const lim = A.chaseMaxMi();
  const mk = (n, d) => ({ loc: n, locId: 'L' + n, lat: 47.8, lng: -122.2, distMi: d,
    dateStr: '2026-08-11 08:00',
    checklists: [{ subId: 'S' + n, dateStr: '2026-08-11 08:00', count: 1, valid: true, evidence: 'P' }] });

  const html = A.spLookupPlacesHtml([mk('Near', 5), mk('AlsoNear', lim - 1),
                                     mk('Far', lim + 1), mk('Farther', 200)]);
  assert.match(html, /farplaces/, 'the far places are collapsed, not dropped');
  assert.match(html, new RegExp('2 more places beyond ' + lim + ' mi'),
    'and the summary says how many and from what radius');
  // Order matters: reachable first, unreachable behind the fold.
  assert.ok(html.indexOf('Near') < html.indexOf('farplaces'), 'reachable places lead');
  assert.ok(html.indexOf('Farther') > html.indexOf('farplaces'), 'the rest sit inside');

  // THE BOUNDARY IS THE CHASE RADIUS, not a magic number, and it is inclusive
  // — a place exactly at the limit is still a chase.
  const edge = A.spLookupPlacesHtml([mk('Edge', lim)]);
  assert.ok(!/farplaces/.test(edge), 'a place exactly at the radius is not "beyond" it');

  // Nothing within range is a real answer, not an empty list. An expander over
  // the only rows there are would hide the whole result.
  const allFar = A.spLookupPlacesHtml([mk('OnlyFar', 300)]);
  assert.ok(!/farplaces/.test(allFar), 'with nothing in range the far places show outright');
  assert.match(allFar, /OnlyFar/, 'so the lookup still answers the question that was asked');
  app.window.close();
});


// "what is the plan for the window 21/20?"
//
// The plan turned out not to be the one I assumed. `window 21/20` was two
// separate faults wearing one symptom, and only measuring the real scheduler
// separated them.
//
// 1. THE DISPLAY was printing the raw `_fgStarts` array, which is pruned only
//    when a reservation happens, so it keeps entries that have already aged
//    out. That alone can read 21/20 while the window is fine.
// 2. THE LIMITER really was over. Driving the shipped functions over 300 calls
//    gave 21 starts inside a 60 s window against a declared cap of 20, and a
//    steady 0.348/s against a declared 0.333/s — because the two limiters
//    DISAGREED. The bucket paces 0.37/s; the window allowed 20/60s = 0.333/s.
//    The bucket won wherever the boundary arithmetic let a call through, so
//    the backstop was being exceeded by its own scheduler.
//
// Both halves now express ONE number: 22/60 s is 0.367/s, the rate the bucket
// already used and the rate measured off the live API.
test('the two rate limiters agree, and the window is never exceeded', () => {
  const cfg = (re, n) => { const m = re.exec(HTML); assert.ok(m, re + ' is a named constant'); return +m[n]; };
  const winMs = cfg(/var FG_WINDOW_MS = (\d+), FG_WINDOW_MAX = (\d+);/, 1);
  const winMax = cfg(/var FG_WINDOW_MS = (\d+), FG_WINDOW_MAX = (\d+);/, 2);
  const refill = cfg(/FG_BUCKET = (\d+), FG_REFILL_PER_S = ([\d.]+)/, 2);

  // THE INVARIANT: the sustained window and the bucket must describe the same
  // rate. When they disagreed, the faster one silently won.
  const windowRate = winMax / (winMs / 1000);
  assert.ok(Math.abs(windowRate - refill) < 0.005,
    `the window allows ${windowRate.toFixed(4)}/s and the bucket paces ${refill}/s — `
    + 'two limiters describing one budget must describe the same number, or the '
    + 'looser one is the real limit and the other is decoration');

  // A start must never land exactly on the boundary it waited for: eBird's
  // clock is not ours and its edge may be inclusive.
  assert.match(HTML, /var FG_WINDOW_EPS_MS = \d+;/, 'the boundary has a margin');
  assert.match(HTML, /\+ FG_WINDOW_MS\s*\n?\s*\+ FG_WINDOW_EPS_MS - startAt/,
    'and the wait actually applies it');

  // The debug line must report what the window HOLDS, not the raw array — a
  // count that can exceed its own cap teaches the reader to distrust the
  // number rather than the limiter.
  assert.match(HTML, /' · window ' \+ fgWindowUsed\(\)/,
    'the log prints the pruned in-window count');
  assert.match(HTML, /function fgWindowUsed\(\)/, 'which is a real function');
});

test('your own checklists are harvested without opening Birdiest or Convoys', async () => {
  // "my list of seen birds in the app is not updating automatically. i thought
  //  we fixed this"
  //
  // The harvest worked. What it lacked was a reason to run: it was called from
  // exactly one place, inside recentLists(), so your own new checklists were
  // read only if you happened to open Birdiest checklists or Birder convoys.
  // Open the app, look at the rarities, close it — nothing was harvested.
  //
  // So the assertion is about the TRIGGER. It hangs off refresh(), which is
  // what runs when you actually open the app to go birding, rather than off a
  // boot timer — a timer in every window is a timer in all 300 test windows.
  const urls = [];
  const app = await boot({
    fetch(url) { urls.push(url); return /product\/lists/.test(url) ? [] : null; },
    storage: { ebird_display_name: 'Birder Wyatt' },
  });
  const A = app.window.__app;
  assert.strictEqual(typeof A.scheduleOwnHarvest, 'function',
    'nothing schedules the harvest, so it runs only if another section happens '
    + 'to want the same feed — which is the bug that was reported');
  await A.ensureOwnHarvest();
  assert.ok(urls.some((u) => /product\/lists/.test(u)),
    'the harvest never reached product/lists, so it could not learn anything');
  app.window.close();
});

test('the harvest does not run when it cannot tell which checklists are yours', async () => {
  // The feed carries userDisplayName and no user id, so that name IS the join
  // key. Running without one reads checklists and matches nothing.
  const urls = [];
  const app = await boot({
    fetch(url) { urls.push(url); return /product\/lists/.test(url) ? [] : null; },
  });
  await app.window.__app.ensureOwnHarvest();
  assert.strictEqual(urls.filter((u) => /product\/lists/.test(u)).length, 0,
    'the harvest ran with no display name set — those calls buy nothing');
  app.window.close();
});

test('My year says so when it cannot keep itself up to date', async () => {
  // The silent half of the same bug: with no display name the harvest returned
  // 0 and said nothing, so a list that never grew looked exactly like a list
  // with nothing to add.
  const app = await boot({ fetch() { return null; } });
  const body = app.document.getElementById('myYearBody');
  assert.match(body.innerHTML, /display name/i,
    'My year does not mention the missing display name, so the reader has no '
    + 'way to know why their list stopped growing');
  app.window.close();
});

test('the species code rides on medium cards and stays off the small ones', () => {
  // "I'd like to include the species code on all the medium sized cards. I
  //  dont want it on the small lists to save space."
  //
  // Medium is the DECIDING size — "which bird is this, and is it worth the
  // drive?" — and the code is what you type into eBird or use to tell two
  // look-alike names apart. Small is the SCANNING size, nested inside other
  // cards, where six characters on every row is width spent on something you
  // are not reading yet.
  const SC = require(path.join(__dirname, '..', 'www', 'cards-species.js'));

  const med = SC.medium({ name: 'Red-necked Phalarope', code: 'renpha',
                          sub: '2 places · 3 reports' });
  assert.match(med, /renpha/, 'the code is missing from a medium card');
  assert.match(med, /class="spcode"/, 'the code is not marked up, so it cannot be styled');
  assert.match(med, /spcodesep/, 'no separator before the sub-header it precedes');

  // REVERSED 2026-08-18, by the owner, and worth keeping the history.
  //
  // This used to assert the OPPOSITE, quoting "dont want it on the small lists
  // to save space". That quote was about two menu entries doing the identical
  // thing, not about species codes, and I had attached it to the wrong
  // decision. Asked again - "id like the small spieces card to show the bird
  // code" - I first read it as a contradiction and built an opt-in flag,
  // solving a conflict that never existed and leaving every caller a chance to
  // forget the flag.
  //
  // The width worry is real, but it is a LAYOUT question and there is a layout
  // audit that answers it at 320px with text at 1.75x. Measured beats guessed.
  const small = SC.small({ name: 'Red-necked Phalarope', code: 'renpha',
                           alpha: 'RNPH', sub: '2 places' });
  assert.match(small, /renpha/, 'the small card lost the species code');
  assert.match(small, /RNPH/, 'the small card lost the banding code, which is the one people say');

  // REVERSED 2026-08-18, with My year: "make sure all the fields from medium
  // card are included." The large card was missing code, dist and conf, so a
  // section moving from medium to large would have silently LOST facts the
  // reader had a moment earlier - which is a worse outcome than a slightly
  // busier card. Changing size should change size, not content.
  const large = SC.large({ name: 'Red-necked Phalarope', code: 'renpha',
                           distMi: 3.5, conf: '3 reports · 5 days', sub: 'x' });
  for (const [field, re] of [['code', /renpha/], ['dist', /3\.5/], ['conf', /3 reports/]]) {
    assert.ok(re.test(large), `the large card lost ${field}, which medium carries`);
  }

  // A card with no sub-header must not render a dangling separator.
  const bare = SC.medium({ name: 'X', code: 'renpha' });
  assert.match(bare, /renpha/);
  assert.ok(!/spcodesep/.test(bare), 'a dangling "renpha ·" is worse than no code');

  // No code, nothing rendered.
  assert.ok(!/spcode/.test(SC.medium({ name: 'X', sub: 'y' })),
    'a card with no code still emitted the wrapper');

  // Validated, not escaped — this file has no escaper by design, so a value
  // that is not a species code must not survive at all.
  const nasty = SC.medium({ name: 'X', code: '<img src=x onerror=alert(1)>', sub: 'y' });
  const slot = nasty.match(/<span class="spcode">([^<]*)<\/span>/);
  assert.ok(slot, 'the code slot did not render at all');
  // The assertion is that nothing STRUCTURAL survives, not that the letters
  // are gone: stripping to [a-z0-9] leaves "imgsrcxonerroralert1", which is
  // inert text. Testing for the substring "onerror" would be testing the
  // wrong property — it is the angle brackets, quotes and equals signs that
  // could break out of the span, and none of them can.
  assert.ok(!/[<>="'`]/.test(slot[1]),
    'something structural survived the species-code slot: ' + slot[1]);
});

// ---- F32: a bird you NEED just turned up near you ---------------------------
//
// "alerts on unseen birds in chase area... for example the spotted sandpiper
//  showed up at redmond retention ponds and i missed it because it was not the
//  top destination... maybe a grouped by species list."
//
// The bird was never missing — it was in All unseen. What failed was SALIENCE.
// These pin the four things that make the lane worth having, each of which
// fails quietly and differently.

test('a bird you need, reported nearby, is not buried by the place it was at', () => {
  // The reported case, as data. A Spotted Sandpiper at a retention pond draws
  // no crowd and its pond will never out-rank Marymoor, so all three existing
  // lanes are blind to it BY DESIGN.
  const BL = require(path.join(__dirname, '..', 'www', 'logic.js'));
  const now = Date.parse('2026-08-12T12:00:00');
  const at = (h) => {
    const d = new Date(now - h * 3600000), p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  // Four sightings at ONE place is the gate now — "a celebrity bird is one
  // that has 4+ obs at the same hotspot". The fixture grew to match; the three
  // EXCLUSION reasons below are the part worth keeping and are unchanged.
  const recs = [
    { code: 'sposan', name: 'Spotted Sandpiper', distMi: 4.2, dateStr: at(2), locId: 'L9', loc: 'Redmond retention ponds', subId: 'S1', kind: 'Rarity' },
    { code: 'sposan', name: 'Spotted Sandpiper', distMi: 4.2, dateStr: at(3), locId: 'L9', loc: 'Redmond retention ponds', subId: 'S1b', kind: 'Rarity' },
    { code: 'sposan', name: 'Spotted Sandpiper', distMi: 4.2, dateStr: at(6), locId: 'L9', loc: 'Redmond retention ponds', subId: 'S1c', kind: 'Rarity' },
    { code: 'sposan', name: 'Spotted Sandpiper', distMi: 4.2, dateStr: at(7), locId: 'L9', loc: 'Redmond retention ponds', subId: 'S7', kind: 'Rarity' },
    // A fifth report at a DIFFERENT pond 18 mi away. It must not join the
    // cluster, and it must not become the row's address.
    { code: 'sposan', name: 'Spotted Sandpiper', distMi: 18, dateStr: at(5), locId: 'L8', loc: 'Far pond', subId: 'S2', kind: 'Rarity' },
    { code: 'amecro', name: 'American Crow', distMi: 1, dateStr: at(1), locId: 'L1', loc: 'Yard', subId: 'S3', kind: 'Rarity' },
    { code: 'weskin', name: 'Western Kingbird', distMi: 60, dateStr: at(3), locId: 'L7', loc: 'Too far', subId: 'S4', kind: 'Rarity' },
    { code: 'rufhum', name: 'Rufous Hummingbird', distMi: 9, dateStr: at(40), locId: 'L6', loc: 'Stale', subId: 'S5', kind: 'Rarity' },
    { code: 'baisan', name: "Baird's Sandpiper", distMi: 12, dateStr: at(6), locId: 'L5', loc: 'Marsh', subId: 'S6', kind: 'Rarity' },
    { code: 'baisan', name: "Baird's Sandpiper", distMi: 12, dateStr: at(7), locId: 'L5', loc: 'Marsh', subId: 'S6b', kind: 'Rarity' },
    { code: 'baisan', name: "Baird's Sandpiper", distMi: 12, dateStr: at(8), locId: 'L5', loc: 'Marsh', subId: 'S6c', kind: 'Rarity' },
    { code: 'baisan', name: "Baird's Sandpiper", distMi: 12, dateStr: at(9), locId: 'L5', loc: 'Marsh', subId: 'S6d', kind: 'Rarity' },
  ];
  const out = BL.needNearby(recs, { now, seen: { amecro: 1 }, maxMi: 35, hours: 24 });

  assert.strictEqual(out.map((r) => r.code).join(','), 'sposan,baisan',
    'expected the two reachable unseen birds, closest first — a bird already '
    + 'on your list, one beyond the chase radius and one from yesterday are all '
    + 'excluded, and each for a different reason');

  // ONE ROW PER BIRD. The same bird at three ponds is one decision, not three;
  // place-first is what Top destinations is for and is exactly what buried it.
  const sp = out[0];
  // The counts describe the QUALIFYING CLUSTER, not the species region-wide.
  // The far pond is a different bird as far as this lane is concerned.
  assert.strictEqual(sp.nPlaces, 1, 'a pond 18 mi away was folded into the cluster');
  assert.strictEqual(sp.reports, 4, 'the four reports at the near pond are counted');
  assert.strictEqual(sp.sightings, 4, 'the corroboration count must be the cluster\u2019s');
  assert.strictEqual(sp.locName, 'Redmond retention ponds',
    'the row carries the NEAREST place, because the row is a decision about driving');
  assert.strictEqual(sp.distMi, 4.2);
  assert.strictEqual(out[1].rare, true, 'a rarity among them is still marked');
});

test('the nearby-needs lane spends nothing and drops what it cannot date', () => {
  const BL = require(path.join(__dirname, '..', 'www', 'logic.js'));
  const now = Date.parse('2026-08-12T12:00:00');
  // This lane's whole claim is freshness, so a record it cannot date must not
  // be assumed fresh — it is dropped rather than guessed at.
  const out = BL.needNearby([
    { code: 'aaa', name: 'A', distMi: 1, dateStr: '', locId: 'L1', loc: 'X', kind: 'Rarity' },
    { code: 'bbb', name: 'B', distMi: 1, dateStr: 'not a date', locId: 'L2', loc: 'Y', kind: 'Rarity' },
  ], { now, seen: {}, maxMi: 35, hours: 24 });
  assert.strictEqual(out.length, 0,
    'an undateable record was shown in a lane that exists to say "just now"');

  // A cluster whose distance never resolved is DROPPED, not ranked last.
  //
  // This reverses an earlier rule, and the reversal is the owner's: "also this
  // observation must be in chase radius too." The old reasoning — "absence of a
  // distance is not evidence of distance, so keep it and sort it last" — is
  // sound in general and wrong for THIS lane, whose entire claim is that the
  // bird is somewhere you can drive to tonight. A row that cannot be shown to
  // be in range cannot support that claim.
  const mixed = BL.needNearby([
    { code: 'ccc', name: 'C', dateStr: '2026-08-12 11:00', locId: 'L3', loc: 'Z', subId: 'S1', kind: 'Rarity' },
    { code: 'ccc', name: 'C', dateStr: '2026-08-12 10:00', locId: 'L3', loc: 'Z', subId: 'S2', kind: 'Rarity' },
    { code: 'ccc', name: 'C', dateStr: '2026-08-12 09:00', locId: 'L3', loc: 'Z', subId: 'S8', kind: 'Rarity' },
    { code: 'ccc', name: 'C', dateStr: '2026-08-12 08:00', locId: 'L3', loc: 'Z', subId: 'S10', kind: 'Rarity' },
    { code: 'ddd', name: 'D', distMi: 9, dateStr: '2026-08-12 11:00', locId: 'L4', loc: 'W', subId: 'S3', kind: 'Rarity' },
    { code: 'ddd', name: 'D', distMi: 9, dateStr: '2026-08-12 10:00', locId: 'L4', loc: 'W', subId: 'S4', kind: 'Rarity' },
    { code: 'ddd', name: 'D', distMi: 9, dateStr: '2026-08-12 09:00', locId: 'L4', loc: 'W', subId: 'S9', kind: 'Rarity' },
    { code: 'ddd', name: 'D', distMi: 9, dateStr: '2026-08-12 08:00', locId: 'L4', loc: 'W', subId: 'S11', kind: 'Rarity' },
  ], { now, seen: {}, maxMi: 35, hours: 24 });
  assert.strictEqual(mixed.map((r) => r.code).join(','), 'ddd',
    'a bird whose distance never resolved was offered as somewhere to drive tonight');
});

test('Happening now leads with what you need, not with the crowd', async () => {
  // Ordering IS the feature. The other three lanes answer "what are other
  // birders doing"; putting this fourth would repeat the original failure.
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  const fn = HTML.slice(HTML.indexOf('function renderSurge'),
                        HTML.indexOf('function loadSurge'));
  const need = fn.indexOf('Celebrity Birds');
  const crowd = fn.indexOf('species drawing a crowd');
  assert.ok(need > -1, 'the needs lane is not rendered at all');
  assert.ok(crowd > -1, 'the crowd lane vanished');
  assert.ok(need < crowd,
    'the needs lane must LEAD — it is the one about you, and burying it under '
    + 'the crowd lanes is the failure that was reported');

  // And it must be fed from the records the wave already merged, not from a
  // new fetch: a lane that costs calls is a lane that gets switched off.
  const load = HTML.slice(HTML.indexOf('function loadSurge'),
                          HTML.indexOf('function loadSurge') + 6000);
  assert.match(load, /BL\.needNearby\(_merged/,
    'the lane fetches its own data instead of reusing the merged wave');
});

// ---- F30 tier 3: Look up a place (was Scout another place) ---------------------------------------
//
// "id like to support this kind of lookup. it would be like temporary change
//  of home location"
//
// rerankFromAnchor could always re-RANK and never DISCOVER: the candidates came
// from this report's counties plus a circle around home, so "Find Yakima"
// re-sorted a list containing nothing near Yakima. These pin the three claims
// the section makes, each of which fails quietly if it stops being true.

test('scouting a place costs exactly three calls, however far away it is', async () => {
  // The cost is the whole argument for shipping this, and it is the thing a
  // future change is most likely to break — one more feed here would be
  // invisible on screen and would quadruple what a look costs.
  const urls = [];
  const app = await boot({
    fetch(url) {
      const u = String(url);
      urls.push(u);
      if (/ref\/hotspot\/geo/.test(u)) {
        return [{ locId: 'L1', locName: 'Yakima Sportsman SP', lat: 46.6, lng: -120.5,
                  numSpeciesAllTime: 210, latestObsDt: '2026-08-12 07:00' }];
      }
      if (/data\/obs\/geo\/recent\/notable/.test(u)) return [];
      if (/data\/obs\/geo\/recent/.test(u)) {
        return [{ speciesCode: 'zzscout1', comName: 'Zed Scout Bird', locId: 'L1',
                  locName: 'Yakima Sportsman SP', lat: 46.6, lng: -120.5,
                  obsDt: '2026-08-12 07:00', subId: 'S1', obsValid: true }];
      }
      return null;
    },
  });
  const A = app.window.__app, D = app.document;
  // A pasted "lat, lng" resolves offline, so the geocoder is out of the
  // measurement entirely and what is counted is only what eBird was asked for.
  D.getElementById('scoutPlace').value = '46.6021, -120.5059';
  A.scoutPlaceRun();
  await waitFor(() => /hotspot/i.test(D.getElementById('scoutResults').textContent),
    'the scouted view to paint');

  const ebirdCalls = urls.filter((u) => /\/v2\//.test(u) || /data\/obs|ref\/hotspot/.test(u));
  assert.strictEqual(ebirdCalls.length, 3,
    'a scout must cost exactly three eBird calls (geo recent, geo notable, '
    + 'hotspot index); got ' + ebirdCalls.length + ': ' + JSON.stringify(ebirdCalls));

  // And NOT the expensive one. Species feeds are ~25 more calls and are
  // deliberately not fetched: this is a look, not a move.
  // A per-species feed is data/obs/{region}/recent/{code}. Matching on
  // "recent/<word>" alone also matches .../geo/recent?... and
  // .../recent/notable, so the pattern has to exclude the two legitimate
  // shapes rather than just look for a slash.
  assert.ok(!ebirdCalls.some((u) => /\/recent\/(?!notable)[a-z0-9]+/.test(u)),
    'a scout fetched per-species feeds, which is the tier it exists to avoid: '
    + JSON.stringify(ebirdCalls));
});

test('a scouted place is one slot, and survives a relaunch', async () => {
  // One slot, and the reason is the ASK, not the storage — this comment used to
  // say otherwise. "~800 KB" is the raw JSON; localStorage holds the packed
  // string, and the biggest snapshot ever committed stores in 73 KB (17x), so
  // a dozen scouted places would fit fine.
  //
  // What justifies one slot is that the request was "a temporary change of home
  // location". Temporary is the feature. A saved collection is a different
  // product (favourites already exist) and would owe an answer to "which of
  // these is stale" that nothing here provides.
  //
  // So this test pins the BEHAVIOUR — new scout replaces old, clearing leaves
  // nothing — without pretending a storage limit forced it.
  const app = await boot({ fetch() { return null; } });
  const A = app.window.__app, W = app.window;
  A.saveScout({ v: 1, at: Date.now(), label: 'First', lat: 1, lng: 2, rows: [], hotspots: [] });
  A.saveScout({ v: 1, at: Date.now(), label: 'Second', lat: 3, lng: 4, rows: [], hotspots: [] });
  const keys = Object.keys(W.localStorage).filter((k) => /scout/i.test(k));
  assert.strictEqual(keys.length, 1,
    'more than one scout slot exists: ' + JSON.stringify(keys));
  assert.strictEqual(A.loadScout().label, 'Second', 'the newer scout did not replace the older');

  A.clearScout();
  assert.strictEqual(A.loadScout(), null, 'clearing left the slot behind');
});

test('a scout ranks what you need first, measured from THERE', () => {
  // The distances must be from the scouted point, not from home — a list of
  // distances means nothing until you know what they are distances from, and
  // getting this wrong is F30's original bug in a new place.
  const BL = require(path.join(__dirname, '..', 'www', 'logic.js'));
  const at = { lat: 46.6021, lng: -120.5059 };                 // Yakima
  const mi = (a, b, c, d) => {                                  // rough haversine
    const R = 3958.8, r = (x) => x * Math.PI / 180;
    const dLat = r(c - a), dLon = r(d - b);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const rows = [
    { speciesCode: 'need1', comName: 'Needed Far', lat: 46.9, lng: -120.9, locId: 'L1', locName: 'Far', obsDt: '2026-08-12 08:00' },
    { speciesCode: 'need2', comName: 'Needed Near', lat: 46.61, lng: -120.51, locId: 'L2', locName: 'Near', obsDt: '2026-08-12 09:00' },
    { speciesCode: 'seen1', comName: 'Already Seen', lat: 46.60, lng: -120.50, locId: 'L3', locName: 'Closest', obsDt: '2026-08-12 10:00' },
    { speciesCode: 'need2', comName: 'Needed Near', lat: 46.7, lng: -120.7, locId: 'L4', locName: 'Second place', obsDt: '2026-08-12 07:00' },
  ];
  const out = BL.scoutGroups(rows, { seen: { seen1: 1 }, at, distFn: mi });

  assert.strictEqual(out.map((g) => g.code).join(','), 'need2,need1,seen1',
    'birds you NEED must lead, closest first, with seen birds after — a bird '
    + 'you already have is context, not a reason to drive');
  assert.strictEqual(out[0].nPlaces, 2, 'the same bird at two places is one row');
  assert.strictEqual(out[0].locName, 'Near', 'the row carries its NEAREST place');
  assert.ok(out[0].distMi < 1, 'distance is measured from the scouted point, not from home');
  assert.strictEqual(out[2].need, false, 'a bird on your list is not marked as needed');
});

test('a dead geocoder tells you the way round it', async () => {
  // Scout is ENTIRELY gated behind a third party this app does not control, and
  // that geocoder has already been dead on device once: "i tried searching for
  // everett in top destinations and it didnt work". A bare "geocoder returned
  // HTTP 503" is a dead end for the whole section.
  //
  // The way out is already built — geocodePlace parses a pasted "lat, lng"
  // locally, before the network is touched — but that was knowledge living
  // nowhere the reader could find it, which is no use to someone standing in a
  // car park.
  const app = await boot({
    fetch(url) {
      if (/photon|geocod/i.test(String(url))) {
        return { __status: 503 };            // geocoder down
      }
      return null;
    },
  });
  const A = app.window.__app, D = app.document;
  D.getElementById('scoutPlace').value = 'Yakima';
  A.scoutPlaceRun();
  await waitFor(() => /coordinates|paste/i.test(D.getElementById('scoutStatus').textContent),
    'the fallback to be offered');
  const msg = D.getElementById('scoutStatus').textContent;
  assert.match(msg, /paste coordinates/i,
    'a failed lookup must name the offline way round it, not just report the '
    + 'third party that failed: ' + JSON.stringify(msg));
  assert.match(msg, /46\.6021/, 'and show the shape it expects');
  app.window.close();
});

test('pasted coordinates never touch the geocoder at all', async () => {
  // The fallback is only worth offering if it genuinely bypasses the thing that
  // failed. This is the assertion that makes the advice true.
  const urls = [];
  const app = await boot({
    fetch(url) {
      urls.push(String(url));
      if (/ref\/hotspot\/geo/.test(String(url))) return [];
      if (/data\/obs\/geo/.test(String(url))) return [];
      return null;
    },
  });
  const A = app.window.__app, D = app.document;
  D.getElementById('scoutPlace').value = '46.6021, -120.5059';
  A.scoutPlaceRun();
  await waitFor(() => /hotspot/i.test(D.getElementById('scoutResults').textContent),
    'the scouted view to paint');
  assert.ok(!urls.some((u) => /photon|geocod/i.test(u)),
    'a pasted coordinate still called the geocoder, so the fallback would fail '
    + 'for exactly the reason it exists');
  app.window.close();
});

// ---- F122: chase confidence on the card ------------------------------------
test('chase confidence counts sightings, not the people who filed them', () => {
  // "if a bird is seen by multiple people at once, or repeatedly over the last
  //  few days, theres a higher chance for a successful chase."
  //
  // The trap that makes this non-obvious: eBird gives every member of a party
  // its own subId for the same sighting. These two rows are real, from the
  // 2026-08-13 Washington feeds, and they are the same person twice.
  const now = new Date('2026-08-14T12:00:00').getTime();
  const party = BL.chaseConfidence([
    { locId: 'L2', obsDt: '2026-08-13 10:15', howMany: 1, userDisplayName: 'Bruce and Linda Plakke' },
    { locId: 'L2', obsDt: '2026-08-13 10:15', howMany: 1, userDisplayName: 'Linda Plakke' },
  ], { nowMs: now });
  assert.equal(party.events, 1, 'one sighting filed twice is ONE confirmation');
  assert.equal(party.observers, 2, 'the names are still reported, just not scored');

  // REVERSED, and the reversal is the owner's. A party of five at one spot in
  // one minute routinely disagrees about flock size, so counting "1" and "4"
  // as two sightings is exactly how a convoy inflates into a crowd — "make
  // sure its not just a convoy of 5". Count is out of the event key in both
  // repos; the NAMES are still counted, so a card can show who was there.
  const two = BL.chaseConfidence([
    { locId: 'L3', obsDt: '2026-08-14 08:00', howMany: 1, userDisplayName: 'A' },
    { locId: 'L3', obsDt: '2026-08-14 08:00', howMany: 4, userDisplayName: 'B' },
  ], { nowMs: now });
  assert.equal(two.events, 1,
    'a party that disagreed about flock size counted as two independent sightings');
  assert.equal(two.observers, 2, 'the two names were lost along with the inflation');
});

test('chase confidence lets recency outrank volume', () => {
  const now = new Date('2026-08-14T12:00:00').getTime();
  const mk = (day) => BL.chaseConfidence([
    { locId: 'L', obsDt: day + ' 07:00', howMany: 1, userDisplayName: 'A' },
    { locId: 'L', obsDt: day + ' 09:00', howMany: 1, userDisplayName: 'B' },
  ], { nowMs: now });
  const fresh = mk('2026-08-14'), mid = mk('2026-08-12'), stale = mk('2026-08-08');
  assert.ok(fresh.score > mid.score && mid.score > stale.score,
    'ten observers six days ago is a worse bet than two this morning');
  assert.equal(fresh.events, stale.events, 'the counts themselves are unchanged');
});

test('a wide-ranging bird is labelled, never quietly rescored', () => {
  // Raptors are re-found at the same place about half as often (16% vs 31%),
  // which is n=25 pairs: enough to say so, not enough for a coefficient that
  // reorders what you drive to.
  const now = new Date('2026-08-14T12:00:00').getTime();
  const rows = [{ locId: 'L', obsDt: '2026-08-14 07:00', howMany: 1, userDisplayName: 'A' }];
  const plain = BL.chaseConfidence(rows, { nowMs: now });
  const wide = BL.chaseConfidence(rows, { nowMs: now, wideRanging: true });
  assert.equal(plain.score, wide.score, 'the flag must not move the score');
  assert.ok(wide.wideRanging && !plain.wideRanging);
  assert.match(BL.confidenceNote(wide), /wide-ranging/);
});

test('the confidence badge rides on medium cards and stays off the small ones', () => {
  const CARDS = require(path.join(__dirname, '..', 'www', 'cards-species.js'));
  const note = '3 reports · 2 days';
  const md = CARDS.medium({ name: 'Wandering Tattler', code: 'wantat1', conf: note });
  assert.ok(md.includes('class="conf"'), 'the medium card carries it');
  assert.ok(md.includes('3 reports'), 'and states the counts rather than a verdict');
  const sm = CARDS.small({ name: 'Wandering Tattler', code: 'wantat1', conf: note });
  assert.ok(!sm.includes('class="conf"'),
    'the small lists are a scanning surface; an extra line costs one');
});

test('the confidence badge renders nothing it did not build itself', () => {
  const CARDS = require(path.join(__dirname, '..', 'www', 'cards-species.js'));
  const bad = CARDS.medium({ name: 'X', conf: '<img src=x onerror=alert(1)>' });
  assert.ok(!bad.includes('onerror'), 'anything outside the generated shape is dropped');
  assert.ok(!CARDS.medium({ name: 'X', conf: '' }).includes('class="conf"'),
    'no reports means no claim');
});

test('chase confidence is wired into a section, not built and left dangling', () => {
  // iconicMultiplier was built, parity-shaped, described in PARITY.md as
  // "all parity-tested" — and wired to nothing for weeks. That is the same
  // failure as a button bound to no handler and harder to spot, because the
  // code looks finished. So the wiring itself is asserted.
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  assert.match(html, /conf:\s*BL\.confidenceNote\(/,
    'chaseConfidence has no call site — the badge would never render');
  assert.match(html, /BL\.chaseConfidence\(r\.recs/,
    'it must read the rows the section already fetched, not fetch its own');
  // And the card template has to have somewhere to put it.
  const cards = fs.readFileSync(path.join(WWW, 'cards-species.js'), 'utf8');
  assert.ok(cards.includes('{{conf}}'), 'the medium template has no conf slot');
});

test('a subspecies form is not counted as a new bird on the year list', () => {
  // "208 huttons vireo pacific is not a new bird on list. (pacific) doesnt
  //  count as different species as hutton vireo."
  //
  // eBird forms carry their OWN species code, so a code-only comparison let
  // "Hutton's Vireo (Pacific)" onto a list that already held Hutton's Vireo:
  // the total inflated and a bird already ticked was announced as newly added.
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const fn = html.slice(html.indexOf('function mergedYearList'),
                        html.indexOf('function updateMyYear'));

  // The form test has to be GATED on the name actually being a form. Matching
  // every entry by base name also swallowed plain birds and broke "a bird
  // harvested from your own checklist is a row, not just a tick".
  assert.ok(fn.includes('.test(raw)'),
    'the form check is gone, or no longer gated on the entry being a form');
  assert.ok(fn.includes('haveName[n]'), 'the parent-name index is never consulted');

  // And the rule itself, driven rather than described.
  const isForm = (nm) => /\([^()]*\)\s*$/.test(String(nm || ''));
  const base = (nm) => String(nm || '').replace(/\s*\([^()]*\)\s*$/, '').trim();
  assert.ok(isForm("Hutton's Vireo (Pacific)"), 'a form must be recognised');
  assert.ok(isForm('Rock Pigeon (Feral Pigeon)'));
  assert.ok(!isForm('Tufted Puffin'), 'a plain species must NOT be treated as a form');
  assert.ok(!isForm('Cassin\u2019s Vireo'));
  assert.equal(base("Hutton's Vireo (Pacific)"), "Hutton's Vireo");
  assert.equal(base('Tufted Puffin'), 'Tufted Puffin', 'a plain name survives untouched');
});

test('rank deltas answer recent windows, and say nothing they cannot', () => {
  // "i would like to see my personal rank changes recently vs last month.
  //  it can go based on whatever snapshots are cached."
  const hist = [
    { d: '2026-07-18', rank: 230 },
    { d: '2026-08-10', rank: 212 },
    { d: '2026-08-16', rank: 190 },
    { d: '2026-08-17', rank: 187 },
  ];
  const now = new Date('2026-08-17T12:00:00Z').getTime();
  const d = BL.rankDeltas(hist, now);
  // A rank is inverted: 190 -> 187 is an improvement, so positive means up.
  assert.equal(d.day.places, 3, 'yesterday to today');
  assert.equal(d.week.places, 25, 'measured from the newest snapshot at or before the cutoff');
  assert.equal(d.month.places, 43);

  // A window the history cannot cover has NO answer. Reporting 0 would be
  // inventing one, and "no change" is a claim.
  const thin = BL.rankDeltas([{ d: '2026-08-17', rank: 187 }], now);
  assert.equal(thin.day, null);
  assert.equal(thin.week, null);
  assert.equal(thin.month, null);

  // Two snapshots on the same day must not report a self-comparison.
  const same = BL.rankDeltas([{ d: '2026-08-17', rank: 190 }, { d: '2026-08-17', rank: 187 }], now);
  assert.equal(same.day, null, 'a window whose only prior IS the newest row says nothing');
});

test('the needs lane leads with the bird people keep re-finding', () => {
  // "this ten birds you need - is not valuable. use recent burst algorithm to
  //  filter only birds that have many recent reports in chase area."
  //
  // Timestamps are built FROM `now` in local time. eBird's obsDt has no zone,
  // so parseObsDt reads it as local — a fixture with hard-coded strings and a
  // UTC `now` passes in PDT and fails on a UTC runner, which is exactly what
  // it did.
  const now = new Date(2026, 7, 17, 12, 0, 0).getTime();
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  const at = (hoursAgo) => {
    const d = new Date(now - hoursAgo * 3600000);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
      + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  };
  const mk = (code, name, mi, rows) => rows.map((r) => Object.assign(
    { code, name, distMi: mi, locId: 'L' + code, loc: name + ' Park', lat: 47, lon: -122 }, r));
  const records = [].concat(
    // ONE person, once, and very close - and an ordinary bird, so it fails the
    // notability gate as well as the corroboration one.
    mk('aaaaaa', 'Lonely Warbler', 1, [
      { obsDt: at(3), dateStr: at(3), howMany: 1, userDisplayName: 'A', kind: 'Need' }]),
    // A crowd, further out, spanning two calendar days but all inside 24 h.
    // FOUR of them, at ONE place: "a celebrity bird is one that has 4+ obs at
    // the same hotspot". Three was the old bar and is now correctly not enough.
    mk('bbbbbb', 'Crowd Puffin', 20, [
      { obsDt: at(2), dateStr: at(2), howMany: 1, userDisplayName: 'A', kind: 'Rarity' },
      { obsDt: at(4), dateStr: at(4), howMany: 2, userDisplayName: 'B', kind: 'Rarity' },
      { obsDt: at(6), dateStr: at(6), howMany: 1, userDisplayName: 'D', kind: 'Rarity' },
      { obsDt: at(20), dateStr: at(20), howMany: 1, userDisplayName: 'C', kind: 'Rarity' }]),
  );
  const out = BL.needNearby(records, { now, seen: {}, maxMi: 100 });
  // THIS REVERSES AN EARLIER DECISION, deliberately, and then tightened twice
  // more. The lane used to RANK and never filter, on the reasoning that a
  // filter could silently drop the exact bird being chased. The owner asked
  // three times for the opposite:
  //
  //   "use recent burst algorithm to filter only birds that have many recent
  //    reports in chase area"
  //   "happening now shouldnt be showing birds seen by one observation"
  //   "happening now still shows birds with 2 obs"
  //   "happening now is about buzz, not one offs that might not be real"
  //
  // Two reports can be one pair of birders standing together - the surge lane
  // learned that when a couple's dawn walk fired "novel" for every montane
  // species they saw - so the gate is three.
  assert.equal(out.length, 1,
    'a bird with fewer than three sightings is still listed under "Happening now"');
  assert.equal(out[0].code, 'bbbbbb', 'the corroborated bird is the one that survives');
  assert.equal(out[0].sightings, 4, 'sightings are counted as events, at ONE place');

  // THE EXEMPTION IS GONE, and this reverses the decision above it.
  //
  // "a REVIEWED rarity is kept at any count" sounded careful and was not: in
  // practice virtually every row in the rarity feeds is reviewed, so the
  // exemption fired on all of them and the corroboration threshold beside it
  // was decorative. That is how a Red Crossbill with ONE observation reached
  // the lane after three separate rounds of "stop showing me single
  // sightings", ending with "a celebrity bird is one that has 4+ obs at the
  // same hotspot".
  //
  // The mega it was written to protect is not lost — it is a TWITCH, and
  // Twitches today and Twitches this week are the sections about exactly that.
  // This lane is about a crowd forming, which one report is not.
  const rare = BL.needNearby(records.map((r) => (
  r.code === 'aaaaaa' ? Object.assign({}, r, { kind: 'Rarity', obsValid: true }) : r)),
  { now, seen: {}, maxMi: 100 });
  assert.equal(rare.length, 1,
  'a single reviewed report still qualifies, so the four-sighting gate is decorative');
  assert.equal(rare[0].code, 'bbbbbb', 'and the corroborated bird is the survivor');

  // But an UNREVIEWED single report of a rarity is exactly the "one off that
  // might not be real", and eBird says which is which.
  const unreviewed = BL.needNearby(records.map((r) => (
    r.code === 'aaaaaa' ? Object.assign({}, r, { kind: 'Rarity', obsValid: false }) : r)),
  { now, seen: {}, maxMi: 100 });
  assert.equal(unreviewed.length, 1,
    'a single UNREVIEWED rarity report is still shown as though it were buzz');

  // The gate is a named constant, not a literal buried in a filter, because the
  // section prints it on screen and the two must not drift. FOUR now: "a
  // celebrity bird is one that has 4+ obs at the same hotspot".
  assert.equal(BL.NEED_MIN_SIGHTINGS, 4);
});

test('Happening now carries what birders talk about, not what YOU still need', () => {
  // The specification, finally stated plainly after four rounds:
  //
  //   "happening now should be things local birders would talk about without
  //    having to check ebird"
  //
  // That retires the earlier answers rather than adding to them. Corroboration
  // was never the real test - three people reporting a Common Loon is well
  // corroborated and nobody mentions it. The test is NOTABILITY, and it is not
  // a personal one: a bird is talked about because it is unusual HERE, not
  // because it is missing from your year list.
  const BL = require(path.join(__dirname, '..', 'www', 'logic.js'));
  const now = Date.parse('2026-08-19T12:00:00');
  const at = (h) => {
    const d = new Date(now - h * 3600000), p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  // ONE locId, not one per row. Corroboration is now counted PER PLACE, so a
  // fixture that scatters its reports across N pins is testing N single
  // sightings — which is the very thing the lane now rejects.
  const rows = (code, kind, n) => Array.from({ length: n }, (_, i) => ({
    code, name: code, kind, loc: 'Golden Gardens Park', locId: 'L' + code,
    distMi: 12, subId: 'S' + code + i, dateStr: at(i + 1), userDisplayName: 'obs' + i,
  }));

  // The exact rows from the device: a Common Loon several people reported, and a
  // Marbled Godwit. eBird flags the godwit and not the loon, and eBird is right
  // about which one gets talked about. Both now carry four sightings, so the
  // ONLY thing separating them is notability — which is what this test is for.
  const out = BL.needNearby([].concat(
    rows('comloo', 'Need', 4),
    rows('margod', 'Rarity', 4),
  ), { now, seen: {}, maxMi: 100 });

  assert.deepEqual(out.map((r) => r.code), ['margod'],
    'an ordinary unseen bird is still listed under a heading about buzz');

  // Nothing is LOST by this - it moves to the sections that are about you. The
  // same function still answers the personal question when asked for it, so
  // All unseen reports keeps working from one implementation.
  const personal = BL.needNearby(rows('comloo', 'Need', 4),
    { now, seen: {}, maxMi: 100, notableOnly: false });
  assert.deepEqual(personal.map((r) => r.code), ['comloo'],
    'the personal view can no longer be obtained at all, so it has to be '
    + 'reimplemented somewhere else - which is how two definitions of one thing start');

  // ...and notability alone is not enough: a single UNREVIEWED report is still
  // "a one off that might not be real".
  const unreviewed = BL.needNearby(
    rows('margod', 'Rarity', 1).map((r) => Object.assign(r, { obsValid: false })),
    { now, seen: {}, maxMi: 100 });
  assert.equal(unreviewed.length, 0,
    'a single unreviewed rarity is presented as buzz');
});

test('a lead you cannot legally drive to is not a lead', () => {
  // From the device: a Great Horned Owl whose "Nearest" read
  // "HOME 4648 86th Ave SE, Mercer Island". This lane never consulted
  // isPublicPlace, which every other place-ranking path in the app does - so it
  // was the one section that would send a birder to a stranger's driveway.
  const BL = require(path.join(__dirname, '..', 'www', 'logic.js'));
  const now = Date.parse('2026-08-19T12:00:00');
  const at = (h) => {
    const d = new Date(now - h * 3600000), p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  // ONE locId per PLACE, not per row: corroboration is counted per place now,
  // and four of them, because that is the gate.
  const rows = (code, name, loc, n) => Array.from({ length: n }, (_, i) => ({
    code, name, loc, locId: 'L' + code + loc.slice(0, 4), distMi: 5, subId: 'S' + code + i,
    dateStr: at(i + 1), userDisplayName: 'obs' + i, kind: 'Rarity',
  }));
  const out = BL.needNearby([].concat(
    rows('grhowl', 'Great Horned Owl', 'HOME 4648 86th Ave SE, Mercer Island', 4),
    rows('wesgre', 'Western Grebe', 'Skiff Point', 4),
  ), { now, seen: {}, maxMi: 100 });
  assert.deepEqual(out.map((r) => r.code), ['wesgre'],
    'a named private residence was offered as somewhere to drive');

  // A bird reported at BOTH a private address and a public place keeps the
  // public one - the bird is chaseable, just not there.
  const both = BL.needNearby([].concat(
    rows('grhowl', 'Great Horned Owl', 'HOME 4648 86th Ave SE, Mercer Island', 2),
    rows('grhowl', 'Great Horned Owl', 'Marymoor Park', 4),
  ), { now, seen: {}, maxMi: 100 });
  assert.equal(both.length, 1);
  assert.equal(both[0].locName, 'Marymoor Park',
    'the private address survived as the place to drive to');
  // ONE place, because the private address is rejected outright and Marymoor
  // is a single pin. nPlaces describes the QUALIFYING CLUSTER, so a number
  // above one here would mean the residence had been folded back in.
  assert.equal(both[0].nPlaces, 1,
    'the private address was counted as part of the place you are sent to');

  // An unnamed place is not evidence of privacy, and dropping it would lose
  // records the feed simply did not name.
  const unnamed = BL.needNearby(
    rows('sposan', 'Spotted Sandpiper', '', 4).map((r) => Object.assign(r, { loc: '' })),
    { now, seen: {}, maxMi: 100 });
  assert.equal(unnamed.length, 1, 'a record with no place name was treated as private');
});

test('the board records itself so each birder can show movement', async () => {
  // "i would like to see up and down arrows on each person for position
  //  changes ... avoid wrapping."
  //
  // eBird publishes no historical board, so the app has to record one. Arrows
  // can only appear once there are two days to compare — a blank column is
  // honest, an invented zero is not.
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  assert.match(html, /function boardHistRecord\(/, 'the board is never snapshotted');
  assert.match(html, /boardMoveHTML\(boardDeltasFor\(/, 'rows carry no movement');
  // It must reuse the ONE period helper, not grow a second one.
  assert.match(html, /BL\.rankDeltas\(mine, nowMs\)/,
    'board movement must share rankDeltas with the personal card');
  // The column has to be in the header too, or the grid loses a cell.
  assert.match(html, /<span class="mv"><\/span>/, 'the header has no movement cell');
  // And it must not wrap.
  assert.match(html, /\.rankrow \.mv \{[^}]*white-space: nowrap/,
    'the movement column can wrap, which is the one thing that was ruled out');
  // Direction must not be carried by colour alone, and must not be red/green.
  assert.ok(!/\.rankrow \.mv\.down \{ color: #e5484d/.test(html), 'red/green pairing is back');
  assert.match(html, /\.rankrow \.mv\.up \{ color: #0072B2/);
});

test('the county RBA tag is BOTH styled and tap-wired (F128)', () => {
  // It was neither. The <a> carries data-href and no href, so it matched no
  // link pseudo-class and rendered as body text; and the delegated handler
  // only knew .cklcard-sm[data-href] and .ebirdlink, so tapping did nothing.
  // Two independent failures with one symptom - "it should link to the
  // webpage" - so both halves are pinned separately here.
  const html = HTML;

  const tag = html.match(/return '<a class="([^"]*rbalink[^"]*)"/);

  // Reported as "the king rba link is wrong": it went to the region page, which
  // was the right COUNTY but the wrong PAGE. eBird exposes a per-region alert
  // at /alert/rba/{regionCode} with no personal subscription id - measured, it
  // 302s to the Cornell login when signed out rather than 404ing, and the phone
  // is signed in. A tag that says RBA has to go to the RBA.
  // Reported as "the king rba link is wrong": it pointed at the region
  // OVERVIEW, which was the right county but the wrong page. /alert/rba/{code}
  // is the clean form of the alert itself - confirmed working on device - and
  // it needs no subscription id, so there is no table to maintain and every
  // region works rather than the two that happened to be pasted.
  assert.ok(!/\/rare-birds\?rank=mrec/.test(html),
    'the region overview url is gone');
  assert.ok(/alert\/rba\/' \+ encodeURIComponent\(code\)/.test(html),
    'the RBA tag builds the alert route from the county code itself');
  assert.ok(!/RBA_SIDS/.test(html),
    'no hand-maintained sid table - it only ever covered the counties someone ' +
    'had pasted, and sids are not derivable: King SN35705 and Snohomish ' +
    'SN35706 are consecutive yet sit 14 apart in eBird region order');
  assert.ok(/sortBy=obsDt&o=desc/.test(html),
    'still ordered newest first, which is what was asked for');
  assert.ok(tag, 'countyAlertLink still emits an .rbalink anchor');

  // half 1: it must reach a tap handler. .ebirdlink is the one that opens
  // eBird in the in-app browser, and an eBird region page is exactly that.
  assert.ok(/\bebirdlink\b/.test(tag[1]),
     'the RBA tag carries a class the tap handler actually listens for');
  assert.ok(/closest\('\.ebirdlink'\)/.test(html),
     'the .ebirdlink delegated handler still exists to receive it');

  // half 2: it must LOOK tappable. Without an href there is no default
  // styling, so the rule is the only thing making it read as a link.
  const css = html.match(/\.rbalink\s*\{([^}]*)\}/);
  assert.ok(css, '.rbalink has a CSS rule at all - it had none, which is why it read as prose');
  assert.ok(/text-decoration:\s*underline/.test(css[1]),
     'the RBA tag is underlined, so colour is not the only thing marking it a link');
  assert.ok(/color:\s*var\(--link\)/.test(css[1]),
     'it uses the colour-blind-safe link colour, not the green --accent');
});

test('a hybrid never asks Wikipedia for a title that cannot exist, and a bird never shows a warship (F139)', () => {
  // MEASURED on device 2026-08-17, v1.11.0. "Graylag x Canada Goose (hybrid)"
  // spent three requests and resolved to nothing:
  //     404 Graylag_x_Canada_Goose_(hybrid)
  //     200 Graylag                     <- USS Graylag, a WWII minesweeper
  //     404 Graylag_(bird)
  // eBird ELIDES the shared group word from a hybrid's first parent, so the
  // fallback was the bare word "Graylag", which Wikipedia answers with a US
  // Navy vessel as a perfectly ordinary article - type "standard", no "may
  // refer to" - so neither existing guard rejected it, and summaryFetch caches
  // the extract against the bird.
  const m = HTML.match(/var _PHOTO_ADJ[\s\S]*?return out;\s*\}/);
  assert.ok(m, 'photoNames still exists');
  const photoNames = new Function('return (function(){ ' + m[0] + ' ; return photoNames; })()')();

  const hy = photoNames('Graylag x Canada Goose (hybrid)');
  assert.ok(!hy.some(x => /\(hybrid\)/i.test(x)),
    'a "(hybrid)" title is a guaranteed 404 and must not be requested');
  assert.strictEqual(hy[0], 'Graylag Goose',
    'the group word is borrowed back off the second parent, so the first try ' +
    'resolves to Greylag goose instead of a minesweeper');

  // Only when the first parent is a BARE word. "Muscovy Duck" already names
  // itself, and borrowing would invent "Muscovy Duck Mallard".
  assert.ok(!photoNames('Muscovy Duck x Mallard (hybrid)').includes('Muscovy Duck Mallard'),
    'the group word is not borrowed when the first parent already has one');

  // " x " INSIDE parentheses is a form, not a hybrid, and splitting on it
  // shreds a name Wikipedia answers perfectly well.
  const form = 'Northern Flicker (Yellow-shafted x Red-shafted)';
  assert.strictEqual(photoNames(form)[0], form,
    'a form containing " x " is still asked for under its own full name');

  // The description filter is what stops the wrong ORDINARY article. Merlin
  // is "Legendary Welsh wizard"; Graylag is "Minesweeper of the United States
  // Navy". Both are type "standard".
  const guard = HTML.match(/if \(j && j\.description &&[\s\S]{0,600}?return null;/);
  assert.ok(guard, 'summaryFetch still rejects an article whose description is not an organism');
  const re = guard[0];
  assert.ok(/\bbird\b/.test(re) && /species/.test(re),
    'the organism test still accepts "Species of bird"');
  const accepts = d => new RegExp(re.match(/!\/([^/]+)\//)[1], 'i').test(d);
  assert.ok(accepts('Species of bird') && accepts('Wading bird found in the Americas'),
    'real bird descriptions are accepted');
  assert.ok(!accepts('Minesweeper of the United States Navy') &&
            !accepts('Legendary Welsh wizard'),
    'a warship and a wizard are both rejected');
});

test('two callers wanting the same GBIF url share one request (F140)', async () => {
  // MEASURED on device 2026-08-17: species/match?name=Anser anser was issued
  // TWICE in the same millisecond and both completed. The cache is only
  // written once a response lands, so concurrent callers all miss it - and
  // cards render in parallel, so they routinely ask the same question.
  const m = HTML.match(/var _gbifInflight = \{\};\s*function gbifJson\(url\) \{[\s\S]*?\n      \}/);
  assert.ok(m, 'gbifJson still de-duplicates in-flight requests');

  let calls = 0;
  const sandbox = {
    dbg() {},
    fetch() { calls++; return Promise.resolve({ ok: true, json: () => Promise.resolve({ v: 1 }) }); },
    Object,
  };
  const make = new Function('dbg', 'fetch', 'Object',
    m[0] + ' ; return gbifJson;');
  const gbifJson = make(sandbox.dbg, sandbox.fetch, Object);

  const url = 'https://api.gbif.org/v1/species/match?name=Anser%20anser';
  const [a, b] = await Promise.all([gbifJson(url), gbifJson(url)]);
  assert.strictEqual(calls, 1, 'the same url asked twice concurrently hit the network once');
  assert.deepStrictEqual(a, b, 'both callers get the same answer');

  // and the entry must be released, or the cache can never refresh
  await gbifJson(url);
  assert.strictEqual(calls, 2, 'a later call is not served from a stale in-flight entry');
});

test('an empty movement column says WHY it is empty (F125 follow-up)', () => {
  // Reported about an hour after v1.11.0 shipped: "top 100 was supposed to get
  // position changes for everyone on the top 100". It does - but eBird
  // publishes no historical board, so the first snapshot has nothing to be
  // compared against and no arrow can honestly be drawn until there are two
  // days. A silently blank column is indistinguishable from a broken feature,
  // which is the whole reason absence has to explain itself here.
  assert.ok(/movement starts tomorrow/.test(HTML),
    'the board says when movement will appear while it has too little history');
  assert.ok(/snapshot ' \+ bdays \+ ' of the 2 needed/.test(HTML),
    'it names how many snapshots exist, rather than only that something is missing');
  const m = HTML.match(/var bdays = \(bhist \|\| \[\]\)\.length;[\s\S]{0,320}?: '';/);
  assert.ok(m, 'the note is derived from the real history length');
  assert.ok(/bdays < 2/.test(m[0]),
    'the note disappears once two days exist, so it cannot become permanent furniture');
});

test('the birder glossary is defined once, and says where each word is used (F141)', () => {
  // Jargon is only usable if it is defined somewhere the reader can reach, and
  // it is only CORRECT if the definitions are precise. Two obvious swaps were
  // rejected while writing this and are pinned here so they cannot creep back:
  // an excursion is a BIG DAY, not a twitch (a twitch is one specific rare bird
  // someone else found), and a year tick is not a LIFER (first-ever, for life).
  const J = BL.JARGON;
  assert.ok(Array.isArray(J) && J.length >= 12, 'the glossary exists and is not a stub');

  for (const j of J) {
    assert.ok(j.term && j.def && j.where,
      `every term carries a definition AND where it is used: ${JSON.stringify(j)}`);
    assert.ok(j.def.length > 20,
      `"${j.term}" has a real definition rather than a synonym`);
  }
  assert.strictEqual(new Set(J.map(j => j.term)).size, J.length, 'no term is listed twice');

  const by = Object.fromEntries(J.map(j => [j.term, j]));

  // The owner's own suggestion, and the best fit in the list.
  assert.ok(by['home patch'], 'home patch is defined');

  // A twitch is single-target. If this ever points at excursions, the word is
  // being misused - which reads worse than plain English.
  assert.ok(/one specific rare bird/i.test(by['twitch'].def),
    'twitch is still defined as ONE specific bird someone else found');
  assert.ok(!/excursion/i.test(by['twitch'].where),
    'twitch is not attached to excursions - that is a big day');
  assert.ok(/excursion/i.test(by['big day'].where),
    'big day is the term attached to excursions');

  // A lifer is first-ever. A year tick is not one.
  assert.ok(/first time ever|for life/i.test(by['lifer'].def),
    'lifer still means first-ever, for life');
  assert.ok(/year tick counts for the year, not for life/i.test(by['tick'].def),
    'tick still distinguishes itself from a lifer');

  // Rendered into the page that already explains the sections, so it costs no
  // new screen and no new menu tile.
  assert.ok(/BL\.JARGON/.test(HTML), 'the help page renders the shared glossary');
  assert.ok(/class="glossitem"/.test(HTML),
    'a glossary entry carries its OWN class - it looks like a help entry but is ' +
    'not a section, and counting it as a menu tile broke the per-tile guard');
  assert.ok(/Used in: ' \+ esc\(j\.where\)/.test(HTML),
    'each entry says where the word is used, so it is a key to THIS app');
  assert.ok(/typeof BL !== 'undefined' && BL\.JARGON/.test(HTML),
    'help still renders if logic.js has not loaded');

  // Terms rejected on purpose: subjective, hostile, or accusing a named person.
  for (const bad of ['crippler', 'gripped off', 'stringer']) {
    assert.ok(!by[bad], `"${bad}" stays out of the glossary`);
  }
});

test('the state alert is an escape hatch, not another row tag (F128 follow-up)', () => {
  // The state alert is the SUPERSET of every county one. Tagging each record
  // with it would fight the chase-radius filtering these sections exist to do -
  // a WA alert includes Walla Walla, 300 miles away. At the foot of the
  // section it answers the other question: what did you NOT show me?
  const m = HTML.match(/function stateAlertLink\(countyCode\)[\s\S]*?\n      \}/);
  assert.ok(m, 'stateAlertLink exists');
  const fn = new Function('esc', m[0] + ' ; return stateAlertLink;')(s => String(s));

  // Confirmed working on device: https://ebird.org/alert/rba/US-WA
  assert.match(fn('US-WA-033'), /ebird\.org\/alert\/rba\/US-WA\?/,
    'a county code yields its STATE alert - no lookup table, just the code');
  assert.match(fn('US-KS-045'), /alert\/rba\/US-KS\?/, 'and it is not WA-specific');
  assert.strictEqual(fn('US-WA'), '', 'a state code has no state above it');
  assert.strictEqual(fn(''), '', 'and nothing is not a region');

  assert.ok(/Wider than your radius/.test(HTML),
    'it is offered once per section, framed as what the radius excluded');
});

test('Happening now is buzz, not the rarities list again (F144)', () => {
  // Reported from device use: "the birds you need reported near you in the
  // happening now isnt notable enough ... i dont want to repeat rarities list
  // ... this should be a list of birds that are getting particular attention
  // but didnt make the aba list like the wandering tattler."
  //
  // The section's own subtitle already said "Birds a crowd is chasing", so the
  // intent was right - the overlap was not.
  const src = fs.readFileSync(path.join(WWW, 'logic.js'), 'utf8');

  // The filter must live INSIDE surgeEvents and key on the field that function
  // actually uses. A first attempt put it in annotateDistance, where `skip` did
  // not exist, and took ten tests down with a ReferenceError - so this pins
  // both the location and the key.
  const fn = src.slice(src.indexOf('function surgeEvents'));
  assert.ok(/var skip = \{\};/.test(fn), 'surgeEvents builds an exclusion set');
  assert.ok(/opts\.excludeCodes/.test(fn), 'it reads excludeCodes from opts');
  assert.ok(/if \(skip\[r\.code\]\) return;/.test(fn),
    'and skips on r.code - the field surgeEvents keys on, not speciesCode');

  // And it must actually be PASSED, or the parameter is decoration.
  assert.ok(/excludeCodes: rareCodes/.test(HTML),
    'Happening now passes the exclusion');
  assert.ok(/r\.kind === 'Rarity'/.test(HTML),
    'derived from rows the merged set already marks as Rarity, so it costs no ' +
    'extra data');

  // The gate stays at 4 until F124 is unified: moving it while surge counts
  // NAMES and chase confidence counts EVENTS relocates the inconsistency, and
  // it shifted ten stored fixtures as a side effect rather than a decision.
  assert.strictEqual(BL.SURGE.MIN_OBSERVERS, 4,
    'the crowd gate has not been raised ahead of the F124 unification');
});

test('the first badge is wired, and opening a section ages its news (F134)', () => {
  // The mechanism shipped in v1.13.0 with an EMPTY registry, so it was live
  // but inert - nothing badged, and nothing called seenMark, which meant every
  // badge would have read "0 new" forever. This is the line that turns it on.
  const m = HTML.match(/MENU_BADGES\.abaBtn = function \(id\) \{[\s\S]*?\n      \};/);
  assert.ok(m, 'the ABA badge entry exists');
  const fn = new Function('newSince', 'localStorage',
    'var MENU_BADGES = {};' + m[0] + ' return MENU_BADGES.abaBtn;');

  const store = (v) => ({ getItem: () => v });

  // Unknown is not zero. Nothing cached yet must show NO badge rather than a 0.
  assert.strictEqual(fn(() => 0, store(null))('abaBtn'), null,
    'an empty archive yields no badge at all');
  assert.strictEqual(fn(() => 0, store('not json'))('abaBtn'), null,
    'and unreadable storage degrades to no badge, never an exception');

  // Species codes come off the archive KEY, so the badge needs nothing about
  // the record shape.
  const arc = JSON.stringify({ 'US-WA': { 'tersan|S1': {}, 'wantat1|S2': {}, 'tersan|S3': {} } });
  const withNew = fn((id, ids) => ids.length, store(arc))('abaBtn');
  assert.deepStrictEqual(withNew.ids.sort(), ['tersan', 'wantat1'],
    'two distinct species from three archive rows - deduplicated by code');
  assert.strictEqual(withNew.kind, 'new');

  // Nothing new still returns the ids, because showSection marks from them.
  const none = fn(() => 0, store(arc))('abaBtn');
  assert.strictEqual(none.n, 0, 'no news, no badge drawn');
  assert.ok(none.ids.length, 'but the ids are still returned, so opening the ' +
    'section can mark them as seen');

  // And the marker must read the badge's OWN ids, not a second lookup, or the
  // two drift and the badge sticks forever.
  assert.ok(/seenMark\(id, \{ ids: _b\.ids/.test(HTML),
    'showSection marks from the badge it just computed');
});

test('state records ship as a bundled asset and rank by THIS month (F137)', () => {
  // The model needs GBIF and decades of history; the phone has neither, and the
  // app must keep working with no runtime GitHub dependency. So it is computed
  // offline and bundled - 222 KB for six regions.
  const fs2 = require('fs');
  const dir = path.join(WWW, 'state-records');
  assert.ok(fs2.existsSync(dir), 'the bundled asset directory exists');
  const files = fs2.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 1, 'at least one region is bundled');

  const doc = JSON.parse(fs2.readFileSync(path.join(dir, 'US-WA.json'), 'utf8'));
  assert.ok(doc.rows.length > 50, 'Washington has a real list');
  assert.ok(Array.isArray(doc.window) && doc.window[1] < doc.year,
    'the training window ENDS before the year being predicted - this year is ' +
    'what is being forecast, not evidence');

  const r = doc.rows[0];
  assert.strictEqual(r.p.length, 12, 'twelve monthly probabilities');
  assert.ok(r.c && r.n && r.s, 'each row carries code, name and status');

  // Ranked by the current month, which is the whole point: rarity is what every
  // other section already sorts on.
  assert.ok(/\(r\.p \|\| \[\]\)\[month - 1\]/.test(HTML),
    'the loader reads THIS month from the probability array');
  assert.ok(/rows\.sort\(function \(a, b\) \{ return b\.p - a\.p; \}\)/.test(HTML),
    'and sorts by it');

  // It must never fetch this from the network at runtime.
  assert.ok(!/api\.gbif\.org[^']*state-record/i.test(HTML),
    'no runtime GBIF call for state records');

  // Say the hit rate plainly (Q3) - a watchlist that implies forecast accuracy
  // reads as broken the first month nothing turns up.
  assert.ok(/watchlist, not a forecast/.test(HTML),
    'the section admits what it is');
});

test('tapping a state-record bird says when and how many, and is honest about where (F137)', () => {
  // "clicking on one of the birds should have details about where its been
  //  found in the past, and when it was found, and how many times."
  //
  // WHEN and HOW MANY come straight out of the bundle. WHERE does not - the
  // asset carries regions and seasons, no coordinates and no place names - so
  // the detail must not imply a precision it does not have.
  assert.ok(/class="recdetail"/.test(HTML), 'a tap opens a detail panel');
  assert.ok(/<b>When<\/b>/.test(HTML) && /record' \+\s*\n?\s*\(when === 1/.test(HTML)
            || /<b>When<\/b>/.test(HTML),
    'it says how many records and in which month they peak');
  assert.ok(/<b>Which years<\/b>/.test(HTML), 'and which years');
  assert.ok(/<b>Nearby<\/b>/.test(HTML), 'and which nearby regions have had it');

  // The honesty line is the point, not decoration: without it the section
  // implies it knows a spot it has never been told.
  assert.ok(/knows the region and the '\s*\+\s*'season, not the spot/.test(HTML)
            || /season, not the spot/.test(HTML),
    'it says plainly that it knows the region and season, not the spot');
  assert.ok(/ebird\.org\/map\//.test(HTML),
    'and hands the map to eBird, which has every record and needs nothing bundled');

  // A first record must read as an opportunity, not as missing data.
  assert.ok(/this would be a first/.test(HTML),
    'no local years is stated as "this would be a first", not as a blank');

  // The peak month is RINGED as well as filled - a colour difference alone
  // would be invisible to this reader.
  const css = HTML.match(/\.mcell\.peak \{([^}]*)\}/);
  assert.ok(css && /outline/.test(css[1]),
    'the peak month is marked by shape, not only by colour');
});

test('the seen-list line explains itself, so a disagreement with eBird is diagnosable (Q17)', () => {
  // Reported: eBird says 306 for the ABA area, the app said 331, and a
  // Northern Pygmy-Owl added by REVISING an old checklist never appeared. The
  // debug log gave a bare total, which cannot explain any of that.
  //
  // All three missing facts were already on the device.
  const ctxStart = HTML.indexOf('function dbgContext(');
  const ctx = HTML.slice(ctxStart, ctxStart + 12000);

  assert.ok(/imported '/.test(ctx),
    'the log says WHEN the list was imported - a checklist revised in eBird ' +
    'after that date is invisible until the CSV is imported again, which is ' +
    'the whole explanation for a bird eBird counts and the app does not');
  assert.ok(/no CSV yet/.test(ctx),
    'and says so plainly when there has never been an import');
  assert.ok(/\^\[xy\]\\d\+\$/.test(ctx),
    'it separates eBird slash/hybrid/spuh codes, which are not countable ' +
    'species and inflate any total compared with a life list');
  assert.ok(/slash\/hybrid\/spuh/.test(ctx), 'and labels them');
  assert.ok(/self-harvested/.test(ctx),
    'and distinguishes what the app found itself from what was imported');

  // It must never throw. A debug header that dies takes the whole report with
  // it, and this one reads three separate stores.
  assert.ok(/try \{[\s\S]{0,900}?seen list[\s\S]{0,900}?\} catch \(e\) \{\}/.test(ctx),
    'the whole block is guarded - a debug header that throws is worse than a ' +
    'vague one');
});

test('the F8 probe can tell a login page from a wrong URL', () => {
  // v1.18.0's probe classified on the first 200 characters and reported
  // "HTML, not CSV - needs a different url or a session". On device that was
  // the real answer, and it was useless: "<!doctype html><html class=no-js"
  // opens a login page and a real life-list page ALIKE. The two need opposite
  // fixes - find another URL, versus carry a session - so a probe that cannot
  // separate them has not answered anything.
  assert.ok(/id="lifeProbeBtn"/.test(HTML), 'there is a button to run it');
  assert.ok(/function probeLifeList/.test(HTML), 'and something for it to run');

  const cands = HTML.slice(HTML.indexOf('var F8_CANDIDATES'),
    HTML.indexOf('function classifyF8'));
  assert.ok(/ebird\.org\/lifelist\?r=/.test(cands),
    'it asks for the life list, which is the actual question');
  assert.ok(/\{R\}/.test(cands) , 'the region is substituted, not hardcoded');
  assert.ok(cands.split('url:').length - 1 >= 2,
    'more than one candidate URL, or "wrong url" can never be ruled out');

  const cls = HTML.slice(HTML.indexOf('function classifyF8'),
    HTML.indexOf('function probeLifeList'));
  // The bug being guarded: classify on the WHOLE body, never the opening tag.
  assert.ok(/String\(body \|\| ''\)/.test(cls), 'it reads the whole body');
  assert.ok(/<title/.test(cls),
    'it reads the page title, which says "Sign in" or "Life List" outright');
  assert.ok(/name="password"|cas\/login|sign in to ebird/i.test(cls),
    'it detects a login page, which arrives as a perfectly happy 200');

  const fn = HTML.slice(HTML.indexOf('function probeLifeList'),
    HTML.indexOf('function probeLifeList') + 4000);
  assert.ok(/credentials: 'include'/.test(fn),
    'a session cookie is actually sent, or the answer is a foregone "logged out"');
  assert.ok(/r\.url/.test(fn),
    'the FINAL url is reported - a bounce to a login host is the decisive signal');
  // Three simultaneous hits on ebird.org is the manners problem the rate
  // limiter exists to prevent.
  assert.ok(/reduce\(function \(chain/.test(fn), 'candidates are tried in sequence');

  assert.ok(/F8 IS UNBLOCKED/.test(fn), 'it says so plainly when it works');
  assert.ok(/missing piece is a session/.test(fn), 'and names a session when that is the cause');
  assert.ok(/URL is wrong rather than the session/.test(fn), 'and names the URL when that is');

  assert.ok(/blocked before any response/i.test(fn),
    'a block before any response is reported as such, not as a mystery');
  assert.ok(/dbg\('net', 'F8/.test(fn),
    'the result goes to the debug log, so it can be pasted rather than retyped');
});

// ---- F142 "Easy read" -------------------------------------------------------
// The audience reason is the whole feature: a lot of birders are seniors with
// poor reading vision, reading outdoors at dawn through varifocals. These guard
// the parts most easily lost to a later restyle.

test('pinch-zoom is never disabled, because it is the reader\'s last resort', () => {
  const vp = (HTML.match(/<meta name="viewport"[^>]*>/) || [''])[0];
  assert.ok(vp, 'no viewport meta at all');
  // Either of these takes away the ability to magnify a MAP or a photo, which
  // no in-app text-size setting can substitute for.
  assert.ok(!/user-scalable\s*=\s*no/i.test(vp), 'viewport disables pinch-zoom');
  assert.ok(!/maximum-scale\s*=\s*1/i.test(vp), 'viewport pins maximum-scale, which also blocks zoom');
});

test('Easy read composes with text size instead of overriding it', () => {
  // Two independent keys. If Easy read ever wrote the text-size key, turning it
  // on would silently discard a choice the reader made deliberately.
  assert.ok(/A11Y_KEY\s*=\s*'bc_easyread'/.test(HTML), 'Easy read has no key of its own');
  const setA11y = (HTML.match(/function setA11y\([\s\S]{0,600}?\n      \}/) || [''])[0];
  assert.ok(setA11y, 'setA11y not found');
  assert.ok(!/UI_SCALE_KEY|applyUiScale|setUiScale/.test(setA11y),
    'Easy read touches the text-size setting, so it can clobber it');
  // ...and the reverse: text size must not clear Easy read.
  const setScale = (HTML.match(/function setUiScale\([\s\S]{0,600}?\n      \}/) || [''])[0];
  assert.ok(!/A11Y_KEY|applyA11y/.test(setScale), 'text size touches Easy read');
});

test('Easy read buys 44px tap targets, not just bigger text', () => {
  // Size alone would fail the people it is for: a control that is hard to see
  // is also hard to hit.
  const m = HTML.match(/html\[data-a11y="on"\][\s\S]{0,1400}?min-height:\s*44px/);
  assert.ok(m, 'no 44px minimum under Easy read');
  const sel = m[0];
  for (const want of ['button', 'select', '.docbtn']) {
    assert.ok(sel.includes(want), `${want} is not covered by the 44px rule`);
  }
});

test('Easy read is reachable from Settings and remembers itself', () => {
  assert.ok(/id="a11yMode"/.test(HTML), 'no Easy read control');
  assert.ok(/\$\('a11yMode'\)\.value = getA11y\(\)/.test(HTML), 'control does not load its saved value');
  assert.ok(/a11yMode'\)\.addEventListener\('change'/.test(HTML), 'control is not wired to anything');
});

test('reduced motion is honoured app-wide, not on one spinner', () => {
  const rm = HTML.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\*/);
  assert.ok(rm, 'no global prefers-reduced-motion rule');
});

test('the in-app browser is looked up by the name it actually registers under', () => {
  // The device reported "InAppBrowser: NOT available" while the plugin was
  // installed and working. It registers natively as CapgoInAppBrowser;
  // "InAppBrowser" is only the LEGACY name. Checking the legacy name alone
  // meant every external link fell back to window.open, and F8's only viable
  // route - log in once, reuse the session - looked blocked by a missing
  // dependency that was in fact present.
  const fn = (HTML.match(/function ib\(\)[\s\S]{0,400}?\n      \}/) || [''])[0];
  assert.ok(fn, 'ib() not found');
  assert.ok(/CapgoInAppBrowser/.test(fn), 'the current plugin name is not checked');
  assert.ok(/\bInAppBrowser\b/.test(fn), 'the legacy name is not checked, so older installs break');

  // The dependency the names have to agree with.
  assert.ok(/@capgo\/capacitor-inappbrowser/.test(JSON.stringify(PKG.dependencies || {})),
    'the plugin is not actually a dependency');

  // And the debug line must name WHICH key matched: "NOT available" on its own
  // is what sent me hunting for a missing package that was already installed.
  assert.ok(/available as/.test(HTML), 'the debug line does not say which name matched');
  assert.ok(/registered plugins/.test(HTML),
    'a failure does not list what DID register, which is the only clue that matters');
});

test('the wall probe measures before AND after, and judges by content', () => {
  // Anubis answers 200 for everything, including its own refusal, so a status
  // code proves nothing here - the same trap that made the first F8 probe
  // useless. And a single reading proves nothing either: the claim being
  // tested is that a browser view CHANGES the outcome, which needs both sides.
  assert.ok(/id="wallProbeBtn"/.test(HTML), 'no wall probe button');
  const fn = HTML.slice(HTML.indexOf('function probeWall'),
    HTML.indexOf('function probeWall') + 4000);
  assert.ok(fn, 'probeWall not found');

  const v = HTML.slice(HTML.indexOf('function wallVerdict'),
    HTML.indexOf('function wallFetch'));
  assert.ok(/anubis_challenge|not a bot/i.test(v), 'it cannot recognise the Anubis page');
  assert.ok(/cassso/i.test(v), 'it cannot tell a login wall from a bot wall');

  assert.ok(/cache: 'no-store'/.test(HTML),
    'a cached interstitial would read as a pass or a fail depending on nothing');
  assert.ok(/before\.verdict/.test(fn) && /a\.verdict/.test(fn),
    'it does not compare before with after, which is the whole measurement');
  assert.ok(/openWebView|IB\.open/.test(fn), 'it never opens the browser view');
  assert.ok(/THROUGH THE WALL/.test(fn), 'it does not say plainly when it works');
  assert.ok(/ITP/.test(fn), 'it does not name the likely cause when it fails');
});

test('F2: being blocked is recorded and reported, never silently absorbed', () => {
  // The eBirder field size ("of 13,303") disappeared from the rankings card and
  // the app said nothing, because the scrape returned eBird's bot-filter page,
  // no token was found in it, and the card simply omitted the number. Graceful
  // and silent - and silence is why it could have been gone for weeks.
  //
  // This half needs no browser view and no cookie: DETECTING a wall is not
  // defeating one, which is why F2 shipped while F8/F11/F19 still wait.
  const fn = HTML.slice(HTML.indexOf('function ebirdWebKey'),
    HTML.indexOf('function ebirdWebKey') + 1400);
  assert.ok(/wallVerdict\(html\)/.test(fn), 'the scrape does not check what it actually got');
  assert.ok(/noteWall\(/.test(fn), 'a block is not recorded anywhere');

  // The two failures must stay distinguishable. A reachable page with no token
  // means eBird changed the page; reporting that as a block sends the fix
  // looking in entirely the wrong place.
  assert.ok(/changed the page shape/.test(fn),
    'a page that loads but yields no token is conflated with being blocked');

  assert.ok(/WALL_SEEN_KEY/.test(HTML), 'nothing persists the observation');
  // It has to reach the log the owner actually pastes.
  const ctx = HTML.slice(HTML.indexOf('no eBird block recorded') - 800,
    HTML.indexOf('no eBird block recorded') + 200);
  assert.ok(/wallSeen\(\)/.test(ctx), 'the debug header never reads it');
  assert.ok(/blocked by/.test(ctx), 'the debug header does not say it plainly');
});

test('species search finds a bird by the letters a birder actually types', () => {
  // "i searched for btgw in the species lookup and it said no species found."
  // The bird was in the index the whole time. Three things were wrong: the
  // eBird code is btywar, the OFFICIAL banding code is BTYW (the Y borrowed
  // from "graY", because BTGW would collide with Black-throated Green), and
  // nobody remembers that mid-search. So initials are matched too.
  const src = HTML.slice(HTML.indexOf('function searchSpecies'),
    HTML.indexOf('function searchSpecies') + 3600);
  assert.ok(/s\.alpha/.test(src), 'banding codes are not searched');
  assert.ok(/initials\(/.test(src), 'initials are not matched, so "btgw" finds nothing');

  // eBird sends the codes in the same taxonomy response; discarding them was
  // the original fault.
  assert.ok(/bandingCodes/.test(HTML), 'the index throws the banding codes away');
  // An old cache would keep answering "no species found" until it expired.
  assert.ok(/ebird_species_v2:/.test(HTML), 'the cache key was not bumped');

  // Initials must not swallow ordinary word searches: "black" is a word, not a
  // code, and treating every short query as initials would wreck the search.
  assert.ok(/flat\.length >= 4 && flat\.length <= 6/.test(src),
    'initials matching is not bounded to code-length queries');
});

test('iconic-but-unwatched finds places the recent feed cannot', () => {
  // "id like to see a list of iconic hotspots for BTGW where there's a high
  // chance of finding one that may not have been reported on any checklist,
  // like at a cold hotspot."
  //
  // gbifIconic() cannot answer it: it ANNOTATES places the recent feed already
  // found, so a site nobody has visited is invisible to it by construction.
  // Candidates therefore come from GBIF's own locality facet.
  // Sliced to the END OF THE FUNCTION rather than a fixed character count. A
  // magic length silently stops covering the code it was written to cover the
  // moment the function grows - which is exactly what happened when the county
  // baseline moved the sort further down, turning a real guard into one that
  // failed for a reason that had nothing to do with its subject.
  const fnAt = HTML.indexOf('function iconicUnwatched');
  const nextFn = HTML.indexOf('\n      function ', fnAt + 1);
  const fn = HTML.slice(fnAt, nextFn > 0 ? nextFn : fnAt + 6000);
  assert.ok(fn, 'iconicUnwatched not found');
  assert.ok(/facet=locality/.test(fn), 'candidates are not discovered from GBIF');
  assert.ok(/unwatched: !covered/.test(fn), 'it never works out which places are uncovered');
  assert.ok(/a\.unwatched !== b\.unwatched/.test(fn), 'unwatched places are not surfaced first');

  // A ratio off a handful of checklists is a fiction that sends someone on a
  // two-hour drive - the same trap iconicMultiplier already guards.
  assert.ok(/minEffort/.test(fn), 'no minimum-effort floor');
  assert.ok(/BL\.isPublicPlace/.test(fn), 'private gardens are not excluded');

  // Name rules alone were NOT enough: they still left "Cailley's Retreat",
  // "Belle Center Rd." and "Area Z, Sudden Valley" at the top, all private.
  // eBird's own hotspot directory settles it, and is the filter that decides.
  assert.ok(/hotspotNames\[/.test(fn), 'the official hotspot directory is not consulted');
  assert.ok(/hotspotNames &&/.test(fn),
    'a directory that failed to load empties the list instead of degrading to the name rules');

  // ...and it must cost NOTHING. The first version fetched the directory
  // itself, and a guard caught it: the historical work runs on GBIF precisely
  // because eBird calls are the scarce resource. An enrichment that quietly
  // spends one is how a budget dies.
  const hs = HTML.slice(HTML.indexOf('function hotspotNameSet'),
    HTML.indexOf('function hotspotNameSet') + 900);
  assert.ok(!/ebird\(|fetch\(/.test(hs),
    'hotspotNameSet spends an eBird call instead of reading the cache others fill');
  assert.ok(/hotspotCacheKey/.test(hs), 'it does not reuse the existing hotspot cache');

  // The empty feed is the case this matters MOST in, and it used to end the
  // conversation.
  assert.ok(/it is not being seen right now[\s\S]{0,400}?hydrateUnwatched/.test(HTML),
    'a species with no recent reports still gets no historical list');

  // It must never read as a sighting.
  assert.ok(/historical odds, not sightings/.test(HTML),
    'historical odds are not distinguished from live reports');
});

test('the stakeout map plots the places the rows are numbered against', () => {
  // "map is not working" - and it was not, for a reason that leaves no trace on
  // screen. speciesPlaces builds places as { locId, loc, lat, lon }; the map
  // read p.lng, got undefined for every one, isFinite rejected them all, and
  // the map drew with nothing on it but the home marker.
  const at = HTML.indexOf('function renderSpeciesLookup');
  const src = HTML.slice(at, HTML.indexOf('\n      function ', at + 1));
  assert.ok(at > 0, 'renderSpeciesLookup not found');
  assert.ok(/p\.lon/.test(src),
    'the stakeout map still reads only p.lng, which speciesPlaces never sets');

  // The field names really are what this claims - if speciesPlaces ever emits
  // lng, this guard should be revisited rather than quietly passing.
  const logic = fs.readFileSync(path.join(WWW, 'logic.js'), 'utf8');
  const sp = logic.slice(logic.indexOf('function speciesPlaces'),
    logic.indexOf('function sortSpeciesPlaces'));
  assert.ok(/lat: r\.lat, lon: r\.lng/.test(sp),
    'speciesPlaces no longer emits lon - re-check what the map should read');

  // And a real place survives the projection, rather than only the shape of it.
  const places = BL.speciesPlaces([
    { locId: 'L1', locName: 'Marina Beach Park', lat: 47.8, lng: -122.4,
      obsDt: '2026-08-19 06:09', howMany: 1, subId: 'S1' },
  ], { lat: 47.75, lng: -122.16 });
  assert.equal(places.length, 1);
  assert.ok(isFinite(places[0].lat) && isFinite(places[0].lon),
    'a place came out of speciesPlaces with no usable coordinate');
});

test('the stakeout list shows every checklist a place actually has', async () => {
  // "show all checklists, not just the latest."
  //
  // THIS WAS NOT A RENDERING BUG, and finding that out is the useful part.
  // buildAllUnseen already keeps every checklist it is given; the reason the
  // screen shows one row per place is that eBird's per-species feed
  // (data/obs/{region}/recent/{speciesCode}) returns ONLY THE MOST RECENT
  // RECORD PER LOCATION - which is why the header reads "131 places, 131
  // reports". A first attempt at this guard "passed" against a mutation that
  // disabled the branch it was testing, which is what exposed the mistake.
  //
  // So this asserts the rendering really does show all of them when the feed
  // supplies them, and a second assertion pins the explanation on screen.
  const app = await boot({
    fetch(url) {
      if (/ref\/taxonomy/.test(url)) return [];
      if (/product\/spplist/.test(url)) return ['btywar'];
      if (/data\/obs\/.*\/recent\/btywar/.test(url)) {
        // THREE checklists, ONE place.
        return [
          { speciesCode: 'btywar', comName: 'Black-throated Gray Warbler', sciName: 'Setophaga nigrescens',
            locId: 'L1', locName: 'Discovery Park', lat: 47.66, lng: -122.42,
            obsDt: '2026-08-15 09:20', howMany: 1, subId: 'S1', obsValid: true },
          { speciesCode: 'btywar', comName: 'Black-throated Gray Warbler', sciName: 'Setophaga nigrescens',
            locId: 'L1', locName: 'Discovery Park', lat: 47.66, lng: -122.42,
            obsDt: '2026-08-15 07:20', howMany: 2, subId: 'S2', obsValid: true },
          { speciesCode: 'btywar', comName: 'Black-throated Gray Warbler', sciName: 'Setophaga nigrescens',
            locId: 'L1', locName: 'Discovery Park', lat: 47.66, lng: -122.42,
            obsDt: '2026-08-15 04:58', howMany: 1, subId: 'S3', obsValid: true },
        ];
      }
      return null;   // GBIF never answers: the live list must not depend on it
    },
    storage: {
      'ebird_species_v2:US-WA': JSON.stringify({
        at: Date.now(),
        rows: [{ code: 'btywar', name: 'Black-throated Gray Warbler', sci: 'Setophaga nigrescens' }],
      }),
    },
  });
  const doc = app.window.document;
  doc.getElementById('spLookup').value = 'Black-throated Gray Warbler';
  app.window.__app.runSpeciesLookup();
  await new Promise((r) => setTimeout(r, 500));

  const rows = [...doc.querySelectorAll('#spLookupResults .sppl > li')];
  assert.equal(rows.length, 3,
    `all three checklists at the one place should be rows, got ${rows.length}`);

  // Each row links to ITS OWN checklist, which is the reason to show them all.
  // data-href, not href: a raw target="_blank" is a no-op in the sideloaded
  // WKWebView, so the app routes every external link through the delegated
  // opener. This row used to hand-roll the one shape that does not work.
  const hrefs = rows.map((li) => {
    const a = li.querySelector('a.extlink[data-href]');
    return a ? a.getAttribute('data-href') : '';
  });
  assert.ok(hrefs.every((h) => /\/checklist\/S/.test(h)),
    `every row should link to its own checklist, got ${JSON.stringify(hrefs)}`);
  assert.equal(new Set(hrefs).size, 3, 'the three rows link to the same checklist');

  // ONE PIN PER PLACE. Three checklists at one place must not invent pins 1, 2
  // and 3 on a map that only has pin 1 — they all carry that place's number.
  const pins = rows.map((li) => (li.querySelector('.hsnum') || {}).textContent || '');
  assert.deepEqual(pins, ['1', '1', '1'],
    `three checklists at ONE place all carry that place's pin, got ${JSON.stringify(pins)}`);

  // ...and the row is a PLACE card, not a species card: the bird's photo is
  // already in the header above, so repeating it 132 times answers nothing.
  // "they should not show the bird icon on each bird item, its redundant."
  assert.ok(rows.every((li) => li.classList.contains('hscard-sm')),
    'the rows are not the shared hotspot card, so the three views look unalike');
  assert.equal(doc.querySelectorAll('#spLookupResults .sppl .thumb').length, 0,
    'the bird photo is repeated on every row');

  // The 1:1 place-to-report count is the ENDPOINT's limit, and the section has
  // to say so - otherwise "131 places, 131 reports" reads as a claim that the
  // bird was seen exactly once at each, which would be a much weaker bird than
  // the data supports.
  const body = doc.getElementById('spLookupResults').textContent;
  assert.match(body, /only the most recent report at each place/,
    'the feed limit is not stated, so the report count reads as the bird\u2019s history');

  app.window.close();
});

test('the stakeout sort controls sit under the map and offer the odds view', () => {
  // "the sort by buttons should be after the map, and it needs another botton
  //  to sort by iconic."
  const map = HTML.indexOf('id="spLookupMap"');
  const row = HTML.indexOf('id="spLookupSortRow"');
  assert.ok(map > 0 && row > 0, 'the stakeout map or sort row is missing');
  assert.ok(map < row,
    'the sort buttons still sit above the map, where they read as filtering the search');

  assert.ok(/id="spLookupByIconic"/.test(HTML), 'there is no odds sort button');
  assert.ok(/spLookupByIconic'\)\.addEventListener/.test(HTML),
    'the odds button is not wired - the same class of bug that left the rankings '
    + 'scope control dead for a whole release');

  // The button must actually change what the list renders, not just relabel it.
  const at = HTML.indexOf('function renderSpeciesLookup');
  const src = HTML.slice(at, HTML.indexOf('\n      function ', at + 1));
  assert.ok(/spLookupIconicHtml/.test(src),
    'the odds view never reaches the list body');
  assert.ok(/_spLookupIconic/.test(src) && /SP_ROWS_MAX/.test(src),
    'the odds view does not repoint the map at the places it lists');
});

test('the odds view is a list, not an appendix, and says what it is first', () => {
  // "the good odds data should be integrated into one list instead of an
  //  appendix ... show the paragraph of explanation text before the list."
  const at = HTML.indexOf('function spLookupIconicHtml');
  assert.ok(at > 0, 'spLookupIconicHtml not found');
  const src = HTML.slice(at, HTML.indexOf('\n      function ', at + 1));

  const caveat = src.indexOf('historical odds, not sightings');
  const list = src.indexOf('HotspotCards.list');
  assert.ok(caveat > -1, 'the odds list no longer says it is not a sighting list');
  assert.ok(list > -1, 'the odds rows are not hotspot cards');
  assert.ok(caveat < list,
    'the explanation comes after the rows, so the numbers are read as sightings first');

  // A place, not a bird: these rows often have NO recent checklist, which is
  // the whole point of the view, so a species card would promise a link it
  // cannot provide. The row builder lives in its own function, so look there.
  const rowAt = HTML.indexOf('function iconicRowHtml');
  assert.ok(rowAt > 0, 'iconicRowHtml not found');
  const rowSrc = HTML.slice(rowAt, HTML.indexOf('\n      function ', rowAt + 1));
  assert.ok(/HotspotCards\.small/.test(rowSrc), 'the odds rows are not place-shaped');
  assert.ok(/num: num/.test(rowSrc),
    'the odds rows carry no number, so they cannot be tied to the map pins');

  // Nothing found is an ANSWER here, not an empty section.
  assert.ok(/not a bird with a reliable address here/.test(src),
    'an empty odds list renders as nothing at all rather than saying so');
});

test('a row past the evidence budget stays eligible instead of being marked done', () => {
  // "these can lazy load but they are mot updating"
  //
  // hydrateChecklistEvidence marked EVERY row data-ev-done and only then
  // applied the call budget, so rows past the cap were permanently ineligible:
  // reopening the list, or returning later with the cache warm, could never
  // fill them in. The order of two lines was the whole bug.
  const at = HTML.indexOf('function hydrateChecklistEvidence');
  assert.ok(at > 0, 'hydrateChecklistEvidence not found');
  const src = HTML.slice(at, HTML.indexOf('\n      var _evidStore', at));
  const filter = src.indexOf('budget--');
  const mark = src.indexOf("setAttribute('data-ev-done'");
  assert.ok(filter > -1 && mark > -1, 'the budget filter or the done-marking vanished');
  assert.ok(filter < mark,
    'rows are marked done before the budget filter runs, so everything past '
    + 'the cap can never hydrate');

  // The media hydrator alongside it already had the right order; this pins it
  // so the two cannot drift back apart.
  const m = HTML.indexOf("setAttribute('data-ckl-done'");
  const mb = HTML.lastIndexOf('budget--', m);
  assert.ok(mb > -1 && mb < m,
    'the media hydrator now marks rows done before applying its budget');
});

test('a checklist row never leaves the count ambiguous', () => {
  const ChecklistCards = require(path.join(WWW, 'cards-checklist.js'));
  // "the checklists are missing the bird count"
  //
  // A blank had come to mean two different things: the observer counted one
  // bird, or the observer wrote "X" - present, not counted - which arrives as
  // null. One is a fact about the bird, the other about the checklist.
  const one = ChecklistCards.small({ place: 'Marina Beach Park', count: 1 });
  assert.match(one, /×1/, 'a count of one is still invisible, which reads as missing');

  const four = ChecklistCards.small({ place: 'Blakely Rock', count: 4 });
  assert.match(four, /×4/);

  // eBird's "X": present, nobody counted. Explicitly null, not absent.
  const x = ChecklistCards.small({ place: 'Somewhere', count: null });
  assert.match(x, /×X/,
    'an uncounted report renders the same as a count of one');

  // A caller that passes NO count at all still prints nothing - that is absence
  // of data, not a measurement, and "×X" for it would be the same conflation in
  // the other direction.
  const none = ChecklistCards.small({ place: 'Somewhere' });
  assert.ok(!/ckcount/.test(none),
    'a row with no count supplied invented one');

  // The medium card is unchanged: it is about a VISIT and always said it.
  assert.match(ChecklistCards.medium({ place: 'X', count: 1 }), /1 bird/);
});

test('a short Top patches list says which radius it covered', () => {
  // "top patches shows only two options" - and two was correct: both rows were
  // 11 mi out and the section stops at the daily-drive radius.
  //
  // WIDENING WOULD BE THE WRONG FIX, which is the part worth pinning. Beyond
  // this radius IS "Worth the drive", already its own section, so a ladder here
  // would print that section twice.
  const at = HTML.indexOf('function loadDestinations');
  const src = HTML.slice(at, HTML.indexOf('\n      // --- Top excursions', at));
  assert.ok(at > 0, 'loadDestinations not found');
  assert.ok(/DEST_THIN_ROWS/.test(src), 'a short list explains nothing');
  assert.ok(/Day-trip patches/.test(src),
    'the note does not point at the section holding everything further out');
  assert.ok(/destRadiusMi\(\)/.test(src),
    'the note does not name the radius, so it states a limit without saying what it is');

  // The threshold must not touch the DATA - it decides when a sentence is owed,
  // nothing else.
  assert.ok(!/DEST_THIN_ROWS[^;]*filter|filter[^;]*DEST_THIN_ROWS/.test(src),
    'the thin-list threshold is filtering results, not just explaining them');

  // And the note is removed before a re-render, or two runs stack two notes.
  assert.ok(/destThin[\s\S]{0,200}removeChild/.test(src),
    'the explanation is appended without clearing the previous one');
});

test('the odds rows are numbered, readable, and within reach first', () => {
  // Three bugs shipped in one view, all invisible to a source-text guard and
  // all obvious in a rendered row:
  //   1. "Saltese Wetlands3.5×" - the sub-line rendered inline, welding the
  //      place name to its first fact.
  //   2. no number on any row, because build() derives the badge from `num`
  //      and IGNORES a ready-made `marker`, which is what the caller passed.
  //   3. "shows state wide range by default under odds" - the archive is
  //      searched state-wide, so every row was 200 miles away.
  const HC = require(path.join(WWW, 'cards-hotspot.js'));

  // 1 + 2: the row itself.
  const row = HC.small({ num: 3, name: 'Saltese Wetlands', sub: '3.5× the regional average' });
  assert.match(row, /class="hsnum"[^>]*>3</,
    'the row carries no number, so it cannot be tied to a map pin');
  assert.match(row, /class="sub"/,
    'the sub-line is not wrapped, so it runs straight into the place name');
  // A ready-made marker must NOT be honoured, because half-honouring it is how
  // the numbers vanished: the caller thinks it passed one and the row has none.
  assert.ok(!/hsnum/.test(HC.small({ marker: '<span class="hsnum">9</span>', name: 'X' })),
    'a passed-in marker is now half-supported, which is worse than not at all');

  // The CSS has to make that wrapper a LINE. Without this rule the span is
  // inline and the fix above changes nothing visible.
  assert.match(HC.css, /\.hscard-sm > \.name > \.ntext > \.sub \{[^}]*display: block/,
    'the small hotspot card sub-line is not a block, so it renders inline');

  // 3: near first, far behind an expander - "should have to click expand to
  // see beyond chase area".
  const at = HTML.indexOf('function spLookupIconicHtml');
  const src = HTML.slice(at, HTML.indexOf('\n      function ', at + 1));
  assert.ok(at > 0, 'spLookupIconicHtml not found');
  assert.ok(/iconicOrdered\(\)/.test(src), 'the odds list is not split by distance at all');
  assert.ok(/<details class="farplaces"/.test(src),
    'places beyond the chase radius are not behind an expander');
  assert.ok(/ord\.near/.test(src) && /ord\.far/.test(src),
    'near and far are not rendered as separate groups');

  // Nothing nearby is an ANSWER, not an empty list - the state-wide sites are
  // still shown, they just stop pretending to be local.
  assert.ok(/Nothing within/.test(src),
    'a bird with no nearby site renders an empty view instead of saying so');

  // The MAP must follow the same split, or it zooms out to fit pins whose rows
  // are hidden - which is what made this look state-wide in the first place.
  const rl = HTML.indexOf('function renderSpeciesLookup');
  const rsrc = HTML.slice(rl, HTML.indexOf('\n      function ', rl + 1));
  assert.ok(/iconicOrdered\(\)/.test(rsrc),
    'the map plots every iconic place, including the ones behind the expander');
});

test('the cascade lane can hand you off to the board it came from', () => {
  // "add a link to jump to the latest ticks on the leaderboard section after
  // the list." The obvious next question after "a few of the top 100 are
  // ticking this" is what else the board has been ticking.
  const src = HTML.slice(HTML.indexOf('function renderSurge'), HTML.indexOf('function loadSurge'));
  assert.match(src, /data-sec="sec-lastNewBtn"/, 'there is no jump to Latest ticks');

  // WIRED, not just rendered. A link that navigates nowhere is the same bug as
  // the rankings scope control that sat dead for a whole release — and in this
  // app navigation is showSection(), never a URL, so an unhandled .seclink
  // would be a no-op in the WKWebView rather than a page load.
  assert.match(HTML, /closest\('\.seclink'\)/,
    'the in-app jump link has no handler');
  assert.match(HTML, /\.seclink[\s\S]{0,300}?showSection\(sid\)/,
    'the handler does not actually navigate');

  // ...and the target section really exists under that id. Section ids are
  // derived as 'sec-' + the menu button id, so a typo here fails silently.
  assert.match(HTML, /id="lastNewBtn"/,
    'sec-lastNewBtn cannot resolve, because there is no lastNewBtn to derive it from');
});

test('every Happening now lane explains its own logic', () => {
  // "i dont understand why sabines gull and rudy turnstone were chosen. each of
  // these three happening now sections needs a help dialogue button explaining
  // the logic."
  //
  // Four lanes with four different rules sat under ONE section-level ℹ, so the
  // answer to "why THIS bird" was never on screen beside the bird.
  const src = HTML.slice(HTML.indexOf('var LANE_DOCS'), HTML.indexOf('function renderSurge'));
  for (const key of ['celebrity', 'crowd', 'cascade', 'busy']) {
    assert.ok(new RegExp('\\b' + key + ':').test(src), `no help text for the ${key} lane`);
  }
  // Every lane heading must carry the button, or a lane has help nobody can
  // reach — the same shape of bug as a control with no listener.
  const rs = HTML.slice(HTML.indexOf('function renderSurge'), HTML.indexOf('function loadSurge'));
  const heads = (rs.match(/class="lanehead"/g) || []).length;
  const btns = (rs.match(/laneHelpBtn\('/g) || []).length;
  assert.equal(btns, heads,
    `${heads} lane headings but ${btns} help buttons — one lane cannot explain itself`);

  // WIRED. A button that opens nothing is the bug this app keeps re-learning.
  assert.match(HTML, /closest\('\.lanehelp'\)/, 'the lane help buttons have no handler');
  assert.match(HTML, /\.lanehelp[\s\S]{0,300}?showSheet\(/, 'the handler opens nothing');

  // The cascade text has to answer the actual question, which was not "what is
  // a cascade" but "why was THIS bird picked".
  assert.match(src, /recent species they added/,
    'the cascade help never says the board column it reads');
  assert.match(src, /not a rarity feed/i,
    'it never says why a bird can appear here without being rare anywhere');
});

test('a place you cannot visit is never recommended', () => {
  // The top of the ranking fills with personal locations, because those really
  // are the best places for the bird - and every one would send a birder to a
  // stranger's driveway. Matched on SHAPE (a house number, punctuation) so it
  // generalises past any blocklist of names.
  const logic = fs.readFileSync(path.join(WWW, 'logic.js'), 'utf8');
  assert.ok(/function isPublicPlace/.test(logic), 'isPublicPlace not found');
  for (const [name, want] of [
    ['Discovery Park', true], ['Marblemount boat launch', true],
    ['192 Lewallen Road, Port Angeles', false],
    ['Birdhaven (Our residence)', false],
    ['Bainbridge Island - Yard - Fletcher Bay Road', false],
    ['Restoration Point (restricted access)', false],
  ]) {
    assert.equal(BL.isPublicPlace(name), want, `${name} classified wrongly`);
  }
});

test('the code list can be browsed, because a code you cannot look up is a quiz', () => {
  // "i couldnt figured out the code for the black throated gray warbler, and
  // had to search google for it to find out it was BTYW."
  //
  // BTYW is the perfect example of why guessing fails: the Y is borrowed from
  // "graY", because BTGW would collide with Black-throated Green. No amount of
  // thinking gets you there, so the app has to show the list.
  assert.ok(/id="spCodesBtn"/.test(HTML), 'no button to show the codes');
  assert.ok(/id="spCodesList"/.test(HTML), 'nowhere to render them');

  const r = HTML.slice(HTML.indexOf('function renderSpCodes'),
    HTML.indexOf('function renderSpCodes') + 2200);
  assert.ok(r, 'renderSpCodes not found');
  // BOTH codes, because they are different things and the app uses both: the
  // eBird code is what URLs and the debug log carry, the banding code is what
  // birders say out loud.
  assert.ok(/r\.code/.test(r), 'the eBird code is not shown');
  assert.ok(/r\.alpha/.test(r), 'the banding code is not shown, which is the one that was googled');

  // All three orderings the request asked for.
  for (const id of ['spCodesByName', 'spCodesByCode', 'spCodesByCommon']) {
    assert.ok(new RegExp(`id="${id}"`).test(HTML), `${id} is missing`);
  }
  // "Most reported" must be MEASURED, not a stand-in for taxonomic order.
  const c = HTML.slice(HTML.indexOf('function speciesCommonness'),
    HTML.indexOf('function speciesCommonness') + 700);
  assert.ok(/data\/obs\//.test(c), 'commonness is not derived from real observations');

  // Tapping a row must run the lookup, or the list is a poster rather than a
  // control - it reuses the same .splook handler the match list uses.
  assert.ok(/class="favbtn splook"/.test(r), 'rows are not tappable');
});

test('no code reads getReport().region, which does not exist', () => {
  // A report carries `stateCode`, never `region`. Reading `.region` gave
  // undefined, so Break a state record fetched "state-records/.json", took the
  // 404, and announced "No state-record list bundled for Washington yet" about
  // a file sitting in the bundle. The message said "Washington" because it
  // falls back to the LABEL, which hid the one clue that pointed at the region.
  //
  // The second use had a 'US-WA' fallback that masked the same bug entirely: in
  // Missouri it probed Washington and looked like it worked. A default that
  // hides a bug is worse than no default.
  assert.ok(!/getReport\(\)\.region\b/.test(HTML),
    'getReport().region is read somewhere; the property is stateCode');
  const fn = HTML.slice(HTML.indexOf('function loadStateRecords'),
    HTML.indexOf('function loadStateRecords') + 900);
  assert.ok(/getRegion\(\)/.test(fn), 'the state-record loader does not use getRegion()');
});

test('every bundled state-record region can actually be requested', () => {
  // The loader builds a filename from the region code, so a mismatch between
  // what getRegion() returns and what is on disk is a silent 404.
  const dir = path.join(WWW, 'state-records');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 6, `only ${files.length} region files bundled`);
  for (const f of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(Array.isArray(doc.rows) && doc.rows.length,
      `${f} has no rows, so it would read as "not bundled"`);
    assert.equal(`${doc.region.toUpperCase()}.json`, f,
      `${f} does not match the region code inside it`);
  }
});

test('tapping a species row anywhere runs the lookup', () => {
  // "clicking on a bird does not search for the bird" - only the 24px book
  // button was wired, and the NAME is the biggest, most obvious target on the
  // row. A dead tap on the main thing is the app looking broken.
  assert.ok(/function pickSpeciesFromRow/.test(HTML), 'no row handler');
  const fn = HTML.slice(HTML.indexOf('function pickSpeciesFromRow'),
    HTML.indexOf('function pickSpeciesFromRow') + 1400);
  assert.ok(/closest\('li'\)/.test(fn), 'the row itself is not a target');
  // Both lists, or the browsable code list stays dead exactly as it was.
  assert.ok(/\$\('spLookupFound'\)\.addEventListener\('click', pickSpeciesFromRow\)/.test(HTML),
    'the match list is not wired to the shared handler');
  assert.ok(/\$\('spCodesList'\)\.addEventListener\('click', pickSpeciesFromRow\)/.test(HTML),
    'the code list is not wired, so every row in it is dead');
  assert.ok(/class="tappable"/.test(HTML) || /'tappable'/.test(HTML),
    'a row that acts like a button does not look like one');
});

test('no Python escape survives into the JavaScript', () => {
  // "\U0001f524 Show bird codes" shipped to the phone: \U is PYTHON escape
  // syntax and JavaScript has no \U escape at all, so it printed literally on
  // the button. Written with the tool that edits this file, so the guard belongs
  // with the file rather than with the tool.
  for (const f of ['index.html', 'logic.js', 'cards-species.js', 'cards-hotspot.js']) {
    const src = fs.readFileSync(path.join(WWW, f), 'utf8');
    assert.ok(!/\\U0001[0-9a-fA-F]{4}/.test(src),
      `${f} contains a Python \\U escape, which renders as literal text`);
  }
});

test('the code list hides rare birds by default, and says how to see them', () => {
  // ~570 species in Washington, mostly vagrants nobody looks up. A list you
  // have to wade through is barely better than the Google search it replaced.
  assert.ok(/id="spCodesAll"/.test(HTML), 'no way to reveal the rare ones');
  // Merlin's wording, because a birder already knows what "rare birds" means
  // and it describes the BIRDS rather than the filter state.
  assert.ok(/Show rare birds/.test(HTML), 'the toggle does not use familiar wording');
  const r = HTML.slice(HTML.indexOf('function renderSpCodes'),
    HTML.indexOf('function renderSpCodes') + 2600);
  assert.ok(/_spCodesHaveSeen/.test(r),
    'it filters before the counts arrive, which would show an empty list');
  // "Common" must be measured, so it moves with the seasons on its own.
  assert.ok(/\(r\.seen \|\| 0\) > 0/.test(r), 'the filter is not based on real reports');
});

test('scientific names are a setting, on by default, and only on the big cards', () => {
  const cards = fs.readFileSync(path.join(WWW, 'cards-species.js'), 'utf8');
  assert.ok(/function sciHtml/.test(cards), 'the card cannot render a scientific name');
  // Gated INSIDE the card, so "which sizes show this" is a property of the card
  // rather than a rule every section has to remember and half of them forget.
  const g = cards.slice(cards.indexOf('function sciHtml'), cards.indexOf('function sciHtml') + 500);
  assert.ok(/tpl !== MEDIUM && tpl !== LARGE/.test(g),
    'small cards would show it too, and small is a scanning surface');

  // ON by default: absence of the key must mean shown, not hidden.
  assert.ok(/localStorage\.getItem\(SCI_KEY\) !== 'off'/.test(HTML),
    'the default is off, or the check is inverted');
  assert.ok(/id="sciNames"/.test(HTML), 'there is no control for it');
  assert.ok(/\$\('sciNames'\)\.value = getSciNames\(\)/.test(HTML), 'the control never loads its value');
});

test('every card call site passes a variable that exists there', () => {
  // A bulk edit put `sci: sciFor(r && r.code)` into six call sites, and `r` was
  // in scope in only TWO of them - the others had g, code, o and e. Same fault
  // as a skip[] check landing in the wrong function: a ReferenceError at render
  // time, which takes the whole section down rather than one field.
  //
  // Stated as the invariant that actually matters rather than by trying to
  // resolve scope from text: THE VARIABLE MUST ALREADY BE USED BY A SIBLING
  // PROPERTY OF THE SAME CARD CALL. If `photoSlot(sp, code)` works two lines
  // below, `sciFor(code)` works. Two earlier attempts to walk back to the
  // enclosing function both produced false alarms - one missed a second
  // declarator in `var a = 1, b = 2`, the other ran out of window - and a guard
  // that cries wolf gets ignored, which is worse than not having it.
  const lines = HTML.split('\n');
  let checked = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/sci: sciFor\(([A-Za-z_$][\w$]*)/);
    if (!m) continue;
    const v = m[1];
    checked++;
    // Comments are stripped and the window is wide: these call sites carry long
    // explanatory blocks, and a 10-line window landed entirely inside one.
    const near = lines.slice(i + 1, i + 45)
      .filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    assert.ok(new RegExp(`\\b${v}\\b`).test(near),
      `line ${i + 1}: sciFor(${v}) but no sibling property in the same card uses ${v}`);
  }
  assert.ok(checked >= 5, `only ${checked} card call sites pass a scientific name`);
});

test('the small card shows how many birds, and absent is never zero', () => {
  // "id like the small species card to include the count of birds from the
  // checklist... it can be simple like [5] or x5".
  //
  // The number was already reaching the row, glued into the caller's sub string
  // as " - x5" between the date and the checklist link, where it read as
  // punctuation. Rendered by the card it looks identical everywhere.
  const SC = require(path.join(__dirname, '..', 'www', 'cards-species.js'));
  const base = { name: 'Western Kingbird', code: 'weskin', sub: 'Aug 18' };

  assert.match(SC.small({ ...base, count: 5 }), /\u00d75/, 'a count of 5 is not shown');
  assert.match(SC.small({ ...base, count: 2000 }), /\u00d72000/, 'a big flock is not shown');
  assert.match(SC.small({ ...base, count: '12' }), /\u00d712/, 'a numeric string is not handled');

  // THE IMPORTANT HALF. eBird lets an observer record presence WITHOUT a count
  // - the checklist says "X" - so howMany is missing on a large share of real
  // rows. "x0" would be a lie and "xundefined" would be a bug.
  for (const [label, n] of [['eBird X', null], ['undefined', undefined],
                            ['zero', 0], ['negative', -3], ['junk', {}]]) {
    assert.ok(!/spcount/.test(SC.small({ ...base, count: n })),
      `${label} rendered a count when it must render nothing`);
  }
  // One bird is the ordinary case; "x1" is noise on every row.
  assert.ok(!/spcount/.test(SC.small({ ...base, count: 1 })), 'x1 is rendered as noise');

  // And it must not be double-printed: the row builder stops formatting it
  // into `sub` now that the card owns it.
  assert.ok(!/howMany != null \? ' \u00b7 \u00d7'/.test(HTML),
    'the caller still glues the count into its sub string, so it prints twice');
  assert.ok(/count: t\.howMany/.test(HTML), 'the raw count is not passed to the card');
});

test('every menu tile carries a definition under its jargon', () => {
  // "the buttons might need a jargon title with a plain sub title. like Mega
  // Rarities or Megas for header and then ABA Code 3+ subtitle."
  //
  // The sub-line is the DEFINITION, not a softer synonym - "ABA Code 3+" is
  // MORE technical than "Mega rarities", and that is the point. The header is
  // the word a birder says; the line under it is what the section actually
  // selects on. A vaguer paraphrase teaches nothing and costs a line.
  const tbl = HTML.slice(HTML.indexOf('var MENU_SUB = {'),
    HTML.indexOf('};', HTML.indexOf('var MENU_SUB = {')));
  assert.ok(tbl, 'MENU_SUB not found');

  // Keyed by section id, not label, so a rename cannot orphan one - and every
  // enabled tile must have one, or the menu reads inconsistently.
  const menu = HTML.slice(HTML.indexOf('var MENU = ['), HTML.indexOf('];', HTML.indexOf('var MENU = [')));
  const ids = [...menu.matchAll(/at:\s*'([^']+)'/g)].map((m) => m[1]);
  const enabled = [...menu.matchAll(/at:\s*'([^']+)'[^\n]*/g)]
    .filter((m) => !/enabled:\s*false/.test(m[0])).map((m) => m[1]);
  const missing = enabled.filter((id) => !new RegExp(`\\b${id}:`).test(tbl));
  assert.deepEqual(missing, [], `tiles with no sub-line: ${missing.join(', ')}`);

  // And no sub-line may be orphaned by a tile that no longer exists.
  const subIds = [...tbl.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  const orphans = subIds.filter((id) => !ids.includes(id));
  assert.deepEqual(orphans, [], `sub-lines for tiles that are gone: ${orphans.join(', ')}`);

  // The one the request named, verbatim.
  assert.match(tbl, /abaBtn:\s*'ABA Code 3\+/, 'Mega rarities does not state its criterion');
});

test('the Stakeout map is rendered by the function that owns its data', () => {
  // This landed in the WRONG FUNCTION first. The insertion anchored on
  // "hydratePhotos(out);", which appears in several renderers, and took the
  // first match - the RARITY render - where `g` does not exist. It threw on
  // every refresh, the status line never updated, and a test that had nothing
  // to do with maps timed out instead of failing with a useful message.
  //
  // Third time this shape of bug has appeared: a bulk edit matched a
  // non-unique anchor and landed somewhere plausible-looking. Same family as
  // sciFor(r && r.code) reaching six call sites where r existed in two.
  const start = HTML.indexOf('function renderSpeciesLookup');
  assert.ok(start > 0, 'renderSpeciesLookup not found');
  const end = HTML.indexOf('\n      function ', start + 10);
  const fn = HTML.slice(start, end);
  assert.ok(/renderMap\(\$\('spLookupMap'\)/.test(fn),
    'the Stakeout map is not rendered by renderSpeciesLookup');

  // ...and nowhere else. Any other renderer touching it is reaching for data
  // it does not have.
  const all = HTML.split("renderMap($('spLookupMap')").length - 1;
  assert.equal(all, 1, `the Stakeout map is rendered from ${all} places`);

  // The rows and the pins must be numbered from the same list, or the numbers
  // are decoration.
  assert.ok(/function spLookupRowsHtml/.test(HTML), 'no numbered row renderer');
  // The bird is passed in rather than read off module state - the first
  // version reached for _spLookupGroup and threw the moment it ran with none
  // set, and threading it made these calls three arguments long.
  assert.ok(/spLookupCapped\(near, 1, bird\)/.test(HTML), 'near places are not numbered from 1');
  assert.ok(/spLookupCapped\(far, near\.length \+ 1, bird\)/.test(HTML),
    'far places restart their numbering, so a number is not unique');
  assert.ok(!/_spLookupGroup\.name/.test(HTML),
    'the row renderer still reaches for module state instead of its argument');
});

test('background fill leaves budget for the section you just opened', () => {
  // "i still am hitting ebird 429 30second pauses on initial loading of
  //  sections... i will load top destinations and try to load another report
  //  and its already on 30s wait."
  //
  // The two-lane queue already put interactive calls ahead of background fill,
  // and it was not enough - because the problem is the BUDGET, not the order.
  // Phase 2 of the wave is ~38 species feeds and it spent the whole 22-call
  // minute; after that a tap waits for slots to AGE OUT whichever lane it is
  // in. The device log proves ordering could not have helped: one call reported
  // `done 27458ms` with `queue 0+0bg/1` - an EMPTY queue and a full window.
  assert.ok(/FG_WINDOW_RESERVE\s*=\s*(\d+)/.test(HTML), 'no reserved headroom');
  const reserve = +HTML.match(/FG_WINDOW_RESERVE\s*=\s*(\d+)/)[1];
  const max = +HTML.match(/FG_WINDOW_MAX\s*=\s*(\d+)/)[1];
  assert.ok(reserve > 0 && reserve < max,
    `reserve ${reserve} must leave room and still be smaller than the cap ${max}`);

  const fn = HTML.slice(HTML.indexOf('function fgWindowWait'),
    HTML.indexOf('function fgWindowWait') + 800);
  assert.ok(/function fgWindowWait\(startAt, bg\)/.test(fn),
    'the window does not know whether the caller is background');
  assert.ok(/bg \? Math\.max\(1, FG_WINDOW_MAX - FG_WINDOW_RESERVE\) : FG_WINDOW_MAX/.test(fn),
    'background is not held below the cap, so it can still spend the whole minute');
  // The wait must be computed from the SAME cap it was tested against, or a
  // background caller waits on a foreground-sized window.
  assert.ok(/_fgStarts\.length - cap\]/.test(fn),
    'the wait is computed from a different cap than the check');
  assert.ok(/fgWindowWait\(at, bg\)/.test(HTML), 'the caller never passes bg through');

  // The rate eBird actually sees is unchanged: the ceiling is still the cap.
  // Only who may spend the last few slots has changed.
  assert.ok(!/FG_WINDOW_MAX\s*=\s*(2[3-9]|[3-9]\d)/.test(HTML),
    'the fix raised the ceiling instead of reserving part of it');
});

test('a species row says how many and when, and the fields survive the hop', () => {
  // "in top destinations, if it shows the western sandpiper, the link goes to a
  //  checklist, so id like to see the count and date last seen... x6 for the
  //  count, and 8/17 9:56A for the time."
  //
  // A count with no date is half an answer: six birds LAST WEEK is a different
  // decision from six this morning.
  const SC = require(path.join(__dirname, '..', 'www', 'cards-species.js'));
  const row = SC.small({ name: 'Western Sandpiper', code: 'wessan',
                         count: 6, when: '8/17 9:56A', sub: 'x' });
  assert.match(row, /\u00d76/, 'the count is missing');
  assert.match(row, /8\/17 9:56A/, 'the date is missing');

  // The card validates the shape and renders nothing else - it has no clock,
  // no locale and no escaper by design, so the app formats and it only places.
  for (const bad of ['not a date', '<script>x</script>', '2026-08-17T09:56']) {
    assert.ok(!/spwhen/.test(SC.small({ name: 'x', when: bad })),
      `"${bad}" was rendered as a date`);
  }
  assert.ok(/function fmtWhenShort/.test(HTML), 'nothing formats the short date');

  // THE ACTUAL BUG: toDest mapped the scored record to {comName, code, rare}
  // and dropped the rest, so a destination row had no count, no date - and no
  // NEW badge either, since that rule reads dateStr.
  const td = HTML.slice(HTML.indexOf('function toDest'), HTML.indexOf('function toDest') + 2200);
  for (const f of ['count: s.count', 'dateStr: s.dateStr', 'subId: s.subId']) {
    assert.ok(td.includes(f), `toDest drops ${f.split(':')[0]}, so the row cannot show it`);
  }
  assert.ok(/when: fmtWhenShort\(x\.dateStr\)/.test(HTML), 'the row never passes a date to the card');
});

test('a small checklist row shows a count only when it says something', () => {
  // SUPERSEDED and folded into "a checklist row never leaves the count
  // ambiguous", which is where the current rule lives. Kept as the record of
  // how it got there: "remove the bird count" -> "It's missing the bird count
  // in each item" -> "the checklists are missing the bird count". The middle
  // rule (only when greater than one) made a blank mean two different things.
  const CC = require(path.join(__dirname, '..', 'www', 'cards-checklist.js'));
  const small = (n) => CC.small({ place: 'Edmonds Marsh', date: '8/17', count: n });
  assert.match(small(6), /\u00d76/, 'an informative count is hidden');
  assert.match(small(1), /\u00d71/, 'a count of one is invisible, which reads as missing');
  assert.match(small(null), /\u00d7X/, 'eBird\u2019s "X" is not distinguished from one');
  // The medium card is about a VISIT, not one bird, so it still shows either.
  assert.ok(/ckcount/.test(CC.medium({ place: 'x', date: 'y', count: 1 })),
    'the medium card lost its count');
});

test('rank movement compares dates on the same clock', () => {
  const LOGIC_SRC = fs.readFileSync(path.join(WWW, 'logic.js'), 'utf8');
  // "the ebird Rankings & Top 100 still does not show the position changes...
  //  Id like to see up and down arrows on each person."
  //
  // The arrows were wired all along. The comparison was not: snapshots are
  // stamped with a LOCAL date (todayStr) and the cutoff used toISOString(),
  // which is UTC - so west of Greenwich every evening the cutoff read as
  // tomorrow, `prior` resolved to today's own snapshot, and the guard
  // `prior.d === last.d` bailed with no arrow at all.
  const BLl = require(path.join(WWW, 'logic.js'));
  const evening = new Date(2026, 7, 19, 18, 0, 0).getTime();   // 6pm local
  const hist = [{ d: '2026-08-18', rank: 40 }, { d: '2026-08-19', rank: 13 }];
  const d = BLl.rankDeltas(hist, evening);
  assert.ok(d.day, 'no 1-day movement in the evening - the UTC skew is back');
  assert.equal(d.day.places, 27, 'the movement is measured wrongly');

  // ...and it must still work at midday, which never exercised the skew.
  const midday = new Date(2026, 7, 19, 11, 0, 0).getTime();
  assert.ok(BLl.rankDeltas(hist, midday).day, 'midday movement broke');

  // Pinned to the cutoff itself rather than scanning the whole function: a
  // wide text search caught an unrelated toISOString further down and failed
  // a fix that was actually correct.
  const cut = LOGIC_SRC.slice(LOGIC_SRC.indexOf('var cutoff = new Date(now -'),
    LOGIC_SRC.indexOf('var cutoff = new Date(now -') + 520);
  assert.ok(/cutoff\.getFullYear\(\)/.test(cut), 'the cutoff is not built from a local date');
  assert.ok(!/cutoff\.toISOString/.test(cut), 'the cutoff is back on UTC');

  // A blank column must be explainable: one snapshot is not a bug.
  assert.ok(/board snapshots: /.test(HTML),
    'the debug header cannot say how many board snapshots exist');
});

test('GOLDEN CASE: Eastern Kingbird surfaces Fobes Road', () => {
  // The owner's own site, given as the case the iconic model must reproduce:
  // https://ebird.org/hotspot/L5495131 - "Fobes Ebey Slough Dike Road Trail",
  // the "Forbes" of the original F11 request ("my recent eastern kingbirds at
  // Forbes"). A real place, a real bird, and a number he can check.
  //
  // MEASURED against GBIF's eBird Observation Dataset on 2026-08-19, Washington,
  // July-September:
  //
  //   Fobes Road ......... 94 Eastern Kingbird records of 3,144 total there
  //   statewide baseline . 1 Eastern Kingbird in every 527 records
  //   multiplier ......... 15.8x
  //
  // Frozen as numbers rather than a live call: a guard that needs the network
  // is a guard that fails for reasons that have nothing to do with the code.
  const EK = { spBox: 94, allBox: 3144, spRegion: 1000, allRegion: 527000 };

  const mult = BL.iconicMultiplier(EK.spBox, EK.allBox, EK.spRegion, EK.allRegion);
  assert.ok(mult != null, 'the multiplier was refused outright');
  assert.ok(mult > 12 && mult < 20,
    `Fobes Road should read about 15.8x for Eastern Kingbird, got ${mult}`);

  // THE FLOOR MUST NOT EXCLUDE IT. iconicMultiplier refuses anything under 200
  // records - the rule that keeps a ratio off five checklists from sending
  // someone on a two-hour drive. Fobes has 3,144, so it clears comfortably; this
  // pins that, because lowering or raising the floor is an open question (F151)
  // and this site is the reference point for it.
  assert.ok(EK.allBox >= 200, 'the fixture no longer clears the effort floor');
  assert.equal(BL.iconicMultiplier(94, 150, EK.spRegion, EK.allRegion), null,
    'the effort floor stopped refusing thin samples');

  // It must survive the "can a stranger go here" filter too - a real hotspot
  // name that reads like a road is exactly what that rule could wrongly reject.
  assert.ok(BL.isPublicPlace('Fobes Road'),
    'Fobes Road was rejected as unvisitable, but it is a real eBird hotspot');
  assert.ok(BL.isPublicPlace('Fobes Ebey Slough Dike Road Trail'),
    'the full hotspot name was rejected as unvisitable');

  // And it must clear the 1.5x bar the section uses to mean "beats average".
  assert.ok(mult >= 1.5, 'it no longer counts as better than the regional average');
});

// ---------------------------------------------------------------------------
// CALIBRATION AGAINST eBIRD'S OWN NUMBERS
//
// The owner supplied screenshots of eBird's "Iconic Birds" panel for two of his
// hotspots, in August. Those four published figures are the only ground truth
// this metric has ever had, and they changed the design: the baseline is now the
// COUNTY the site sits in, not the state.
//
// Measured 2026-08-19 against GBIF's eBird mirror, Jul-Sep, GADM county filters
// (USA.48.31_1 Snohomish, USA.48.17_1 King). Frozen as numbers because a guard
// that needs the network fails for reasons that have nothing to do with the code.
const EBIRD_ICONIC = [
  // place, species, eBird's x, our box counts, our county counts
  ['Snoqualmie Falls', 'American Dipper', 85,
    { sp: 133, all: 3187 }, { sp: 585, all: 1521502 }],
  ['Fobes Road', 'Eastern Kingbird', 68,
    { sp: 126, all: 4197 }, { sp: 293, all: 396678 }],
  ['Snoqualmie Falls', 'Black Swift', 22,
    { sp: 22, all: 3187 }, { sp: 622, all: 1521502 }],
  ['Fobes Road', 'Wood Duck', 13,
    { sp: 123, all: 4197 }, { sp: 1590, all: 396678 }],
];

test("GOLDEN CASE: the iconic ranking reproduces eBird's own Iconic Birds order", () => {
  // THE ORDER IS THE PRODUCT, not the size of the number. Ours reads lower than
  // eBird's by construction (record shares vs checklist frequencies), so the
  // only thing that can be checked against them is which bird comes first - and
  // that is also the only thing a chase list gets wrong in a way that costs a
  // morning.
  const scored = EBIRD_ICONIC.map(([place, sp, ebird, box, county]) => ({
    place, sp, ebird,
    ours: BL.iconicMultiplier(box.sp, box.all, county.sp, county.all),
  }));
  scored.forEach((r) => {
    assert.ok(r.ours != null, `${r.place} / ${r.sp} was refused outright`);
  });

  const byOurs = [...scored].sort((a, b) => b.ours - a.ours).map((r) => r.sp);
  const byEbird = [...scored].sort((a, b) => b.ebird - a.ebird).map((r) => r.sp);
  assert.deepEqual(byOurs, byEbird,
    `our order ${byOurs.join(' > ')} does not match eBird's ${byEbird.join(' > ')}`);

  // And every one of them must still clear the bar that means "worth a look",
  // since eBird thought all four notable enough to print.
  scored.forEach((r) => {
    assert.ok(r.ours >= 1.5, `${r.place} / ${r.sp} fell below the 1.5x bar at ${r.ours}`);
  });
});

test('the STATE baseline is what a county baseline had to replace', () => {
  // This is the negative control for the test above, and the whole reason the
  // baseline changed. Measured state figures for the same four cases, Jul-Sep,
  // Washington. Against these the order is WRONG - Black Swift overtakes Eastern
  // Kingbird - so this pins the failure the county baseline fixes. If someone
  // reverts the baseline to the state, the test above starts failing and this
  // one explains why.
  const STATE = {
    'American Dipper': { sp: 7053, all: 8207865 },
    'Eastern Kingbird': { sp: 15573, all: 8207865 },
    'Black Swift': { sp: 3366, all: 8207865 },
    'Wood Duck': { sp: 38655, all: 8207865 },
  };
  const scored = EBIRD_ICONIC.map(([place, sp, ebird, box]) => ({
    sp, ebird,
    ours: BL.iconicMultiplier(box.sp, box.all, STATE[sp].sp, STATE[sp].all),
  }));
  const byOurs = [...scored].sort((a, b) => b.ours - a.ours).map((r) => r.sp);
  const byEbird = [...scored].sort((a, b) => b.ebird - a.ebird).map((r) => r.sp);
  assert.notDeepEqual(byOurs, byEbird,
    'the state baseline now reproduces eBird too, so the county baseline is no ' +
    'longer justified by this measurement - re-measure before simplifying');
});

test('"observed N of M years" separates a returning bird from a lucky one', () => {
  const years = (pairs) => pairs.map(([name, count]) => ({ name: String(name), count }));

  // Fobes: birded every season for eight years, kingbird present in seven of
  // them. This is the shape that earns a drive.
  const effort = years([[2017, 300], [2018, 380], [2019, 420], [2020, 250],
    [2021, 500], [2022, 610], [2023, 700], [2024, 640]]);
  const strong = BL.iconicYearsObserved(
    years([[2017, 8], [2018, 11], [2019, 14], [2021, 9], [2022, 20], [2023, 30], [2024, 21]]),
    effort);
  assert.deepEqual({ seen: strong.seen, of: strong.of }, { seen: 7, of: 8 });
  assert.equal(BL.iconicYearsLabel(strong), 'seen in 7 of 8 years');

  // THE F151 CASE. Mann Rd scores a spectacular multiplier off ONE season, and
  // the open question was whether to lower the 200-record effort floor to let it
  // through. A year count is the better answer than any floor: it does not
  // silently admit or exclude, it SAYS what the sample is.
  const thin = BL.iconicYearsObserved(years([[2024, 92]]), years([[2024, 300]]));
  assert.deepEqual({ seen: thin.seen, of: thin.of }, { seen: 1, of: 1 });
  assert.equal(BL.iconicYearsLabel(thin), 'only 1 year of data here',
    'a single season must state its thinness, not score 1-of-1 as if it were perfect');

  // A ratio over a tiny denominator invents confidence - the same rule that
  // stopped "Infinity x" being printed when a baseline was zero.
  const two = BL.iconicYearsObserved(years([[2023, 4], [2024, 6]]), years([[2023, 300], [2024, 300]]));
  assert.equal(BL.iconicYearsLabel(two), 'only 2 years of data here');

  // The window is anchored on the latest year the SITE has data, not on today:
  // GBIF's eBird mirror lags about a year, so anchoring on the calendar year
  // would spend a slot on a year no site can have records in yet.
  const old = BL.iconicYearsObserved(
    years([[2015, 5], [2016, 5], [2017, 5]]),
    years([[2014, 200], [2015, 200], [2016, 200], [2017, 200]]));
  assert.equal(old.to, 2017, 'the window did not anchor on the latest year with effort');
  assert.equal(old.of, 4, 'years before the site was ever birded were counted against it');
  assert.equal(old.seen, 3);

  // Years outside the window must not leak in.
  const wide = BL.iconicYearsObserved(
    years([[2000, 50], [2024, 3]]),
    years([[2000, 900], [2018, 200], [2019, 200], [2020, 200], [2021, 200],
      [2022, 200], [2023, 200], [2024, 200]]));
  assert.equal(wide.of, 7, '2000 is outside an 8-year window ending 2024');
  assert.equal(wide.seen, 1);

  // A site with no effort at all is not "0 of 8", it is unmeasured - the same
  // distinction the unwatched-hotspot work turned on.
  assert.equal(BL.iconicYearsObserved(years([[2024, 3]]), []), null);
  assert.equal(BL.iconicYearsLabel(null), '');
});

test('both iconic sections resolve the same baseline, or they print two answers', () => {
  // Two sections show a multiplier for the same hotspot. If one divides by the
  // county and the other by the state, the app contradicts itself on screen -
  // the precise class of drift that forced the card CSS out of index.html and
  // the section docs into a byte-identical mirror.
  // The Iconic view is the ONLY place that prints a multiplier now, so there is
  // one path to check rather than two. It used to be two (gbifIconic annotated
  // the feed's places under the list), and the pair disagreeing on screen is
  // exactly why the duplicate was removed.
  for (const name of ['iconicUnwatched']) {
    const at = HTML.indexOf('function ' + name);
    assert.ok(at > 0, `${name} not found`);
    const next = HTML.indexOf('\n      function ', at + 1);
    const src = HTML.slice(at, next > 0 ? next : at + 6000);
    assert.ok(/gbifCountyGid/.test(src),
      `${name} does not resolve the county, so its numbers are on a different scale`);
    assert.ok(/gbifCountyRates/.test(src),
      `${name} does not use county rates as its baseline`);
    // Falling back is required, not optional: a place must not vanish because a
    // geocode failed.
    assert.ok(/spRegion|stateRates/.test(src),
      `${name} has no state fallback, so an unresolved county drops the place`);
  }

  // Every count that goes into a ratio must share ONE window. A summer box over
  // an all-year baseline is not a ratio of anything, and this is how the year
  // count came to disagree with eBird's on the first attempt.
  //
  // The window itself CHANGED (season -> all months, v1.26.6) and this guard
  // survives that on purpose: it asserts the invariant, not the literal helper
  // it used to name. Its previous form hard-coded `seasonQs()`, so it failed
  // the correct fix and would have passed the bug — assert what a value MEANS.
  for (const fname of ['gbifBoxTotal', 'gbifCountyTotal', 'gbifRegionTotal', 'gbifBoxYears']) {
    const at = HTML.indexOf('function ' + fname);
    assert.ok(at > 0, `${fname} not found`);
    const src = HTML.slice(at, at + 700);
    assert.ok(/iconicQs\(\)/.test(src),
      `${fname} does not use the shared iconic window, so its count is on a different scale`);
    assert.ok(/iconicTag\(\)/.test(src),
      `${fname} caches without the window in the key, so a stale window is served ` +
      'as if it were the current one');
  }

  // The window has to reach the SCREEN, and the old assertion for that was
  // toothless: /seasonMonthNames\(\)/ matched the function's own DEFINITION, so
  // it passed even after the last call site was removed. Assert on the rendered
  // copy instead — with an all-months window, every row states its own months.
  const iconicAt = HTML.indexOf('function spLookupIconicHtml');
  const iconicCopy = HTML.slice(iconicAt, iconicAt + 3000);
  assert.match(iconicCopy, /across the whole year/,
    'the odds view does not say what window its numbers cover');
  assert.ok(!/this time of year/.test(iconicCopy),
    'the odds view still claims to be seasonal, which it no longer is');
  const rowAt = HTML.indexOf('function iconicRowHtml');
  assert.match(HTML.slice(rowAt, rowAt + 1600), /r\.when/,
    'an all-months row does not say WHICH months, so a May bird reads as a December chase');
});

// ── THE ICONIC WINDOW IS ALL MONTHS ──────────────────────────────────────
// Reported from the device: eBird's AUGUST panel at Bolt Creek Burn lists
// American Dipper at 130x and omits Northern House Wren entirely, which is the
// bird birders know the site for. On All Months the wren is top at 179x. It was
// never missing — it is a May–June bird there. The same switch surfaced Western
// Kingbird at Mann Rd, the bird that opened F11.
//
// This asserts the RULE, not one call site: no GBIF request that feeds an
// iconic number may carry a month filter, and no iconic cache key may be
// scoped to a season (a stale season-scoped entry outliving the switch would
// resurrect the bug silently).
test('no iconic number is scoped to a season', () => {
  const src = HTML.slice(HTML.indexOf('function iconicQs'), HTML.indexOf('function renderSurge'));
  const iconic = src.split('\n').filter((l) => /gbif(Count|Facet|CountMonths)\(|GBIF_OCC \+/.test(l));
  assert.ok(iconic.length >= 4, 'the iconic GBIF calls moved — this guard is looking in the wrong place');
  iconic.forEach((l) => assert.ok(!/seasonQs\(\)/.test(l),
    'an iconic GBIF call is still season-scoped, which is what hid the House Wren: ' + l.trim()));
  const keys = src.split('\n').filter((l) => /var ck = '(box|aves|corate|coall|boxyr)\|/.test(l));
  assert.ok(keys.length >= 5, 'the iconic cache keys moved — this guard is looking in the wrong place');
  keys.forEach((l) => assert.ok(!/seasonTag\(\)/.test(l),
    'an iconic cache key is still season-scoped, so old season entries would outlive the fix: ' + l.trim()));
  // The count call must carry the month facet, or an all-months multiplier has
  // no way to say WHEN and a May bird reads as a December chase.
  assert.match(HTML, /function gbifCountMonths[\s\S]{0,400}facet=month/,
    'the month spread is no longer fetched alongside the count');
});
