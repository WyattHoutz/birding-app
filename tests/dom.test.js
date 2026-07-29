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
const CONTRACT = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'report-contract.json'), 'utf8'));
const BL = require(path.join(WWW, 'logic.js'));

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

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
      window.fetch = function (url) {
        state.fetches.push(String(url));
        // Tests that need a response supply opts.fetch(url) -> html string|null.
        if (opts.fetch) {
          const body = opts.fetch(String(url));
          if (body != null) {
            return Promise.resolve({
              ok: true, status: 200,
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

test('Contents menu matches the report section contract (labels + order)', async () => {
  const app = await boot();
  // Tiles split the label into a glyph span and a text span, so textContent
  // loses the space between them. The accessible name is the label a
  // screen-reader user actually hears, so that is what the contract pins.
  assert.deepEqual(
    app.links().map((a) => (a.getAttribute('aria-label') || a.textContent).trim()),
    CONTRACT.menu.map((m) => m.label),
    'menu labels/order drifted from tests/fixtures/report-contract.json — update ' +
    'both the app and the contract (and report.py if the report changed)');
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
  app.open(/Top destinations/);
  assert.match(app.$('destStatus').textContent, /Ranking hotspots/,
    'the section loader ran on first open');
  app.window.close();
});

test('hot and cold hotspots render from ONE shared scan', async () => {
  const app = await boot();
  app.open(/Hot hotspots/);
  const afterHot = app.state.fetches.length;
  assert.ok(afterHot > 0, 'opening Hot hotspots starts a scan');

  app.open(/Cold hotspots/);
  assert.equal(app.state.fetches.length, afterHot,
    'opening Cold hotspots must reuse the in-flight scan, not refetch');
  assert.match(app.$('coldStatus').textContent, /Scanning|overlooked/,
    'the cold section reports the shared scan');
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
  app.open(/Top destinations/);
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
  const open = () => { app.open(/Top destinations/); return app.$('destStatus'); };

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

// --- Bird icons -------------------------------------------------------------
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
  const app = await boot({ fetch: (u) => (/top100/.test(u) ? FIX('top100-wa.html') : null) });
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
  const app = await boot({ fetch: (u) => (/top100/.test(u) ? FIX('top100-wa.html') : null) });
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
  app.window.__app.renderTides([
    { t: '2026-07-27 03:11', v: '9.4', type: 'H' },
    { t: '2026-07-27 10:20', v: '-1.0', type: 'L' },
    { t: '2026-07-27 18:26', v: '11.2', type: 'H' },
    { t: '2026-07-27 23:47', v: '7.4', type: 'L' },
  ], 'Seattle');
  const marked = app.document.querySelectorAll('#wxTides tr.tiderise');
  assert.equal(marked.length, 2,
    'the daytime rising window and the overnight one both carry the highlight');
  assert.match(marked[0].textContent, /\u{1F440}/u, 'and the binocular marker the report prints');
  app.window.close();
});

test('convoys: a subspecies of a bird on your year list is NOT unseen', async () => {
  // Reported bug: "Dark-eyed Junco (Oregon)" showed as unseen although a
  // Dark-eyed Junco is on the year list. isSpeciesSeen only ever compared the
  // RAW code and an exact name, so every form observation was a false
  // positive. analyze.py has always followed reportAs; the app now does too.
  const app = await boot({ fetch: () => null });
  const A = app.window.__app;
  app.window.localStorage.setItem('ebird_seen', JSON.stringify({ daejun: 1 }));
  app.window.localStorage.setItem('ebird_seen_field', 'speciesCode');
  app.window.localStorage.setItem('ebird_year_names', JSON.stringify(['Dark-eyed Junco']));
  assert.equal(A.isSpeciesSeen('daejun', 'Dark-eyed Junco'), true, 'the parent itself');
  // Named nothing like the parent, so ONLY the reportAs chain can answer this.
  app.window.localStorage.setItem('ebird_seen', JSON.stringify({ daejun: 1, norfli: 1 }));
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
  ['results', 'targetResults', 'lastNewResults'].forEach((id) => {
    const m = new RegExp('<ul id="' + id + '"[^>]*class="([^"]*)"').exec(HTML);
    assert.ok(m && /\bbig\b/.test(m[1]), id + ' renders large rows');
  });
  assert.match(HTML, /\.obs\.big \.thumb\s*\{[^}]*width: 64px/,
    'the icon is actually bigger, not just a class name');
});

test('latest ticks: the bird links to its species page and shows fresh lists', () => {
  const src = HTML.slice(HTML.indexOf('function renderLastNew('),
    HTML.indexOf('function loadAbaAlert('));
  assert.match(src, /speciesLink\(sp, info\.code/,
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

test('closest spots: rows carry the distance in miles, closest first', () => {
  const render = HTML.slice(HTML.indexOf('function renderList('),
    HTML.indexOf('// --- eBird API'));
  assert.match(render, /o\.distMi[\s\S]*toFixed\(1\) \+ ' mi/,
    'the report prints miles on every row of this section');
  const load = HTML.slice(HTML.indexOf('function loadTargets('),
    HTML.indexOf('// --- shared chase pipeline'));
  assert.match(load, /distMi:/, 'and the loader carries the distance through');
  assert.match(load, /targets\.sort\(/, 'sorted closest first');
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
  app.window.localStorage.setItem('ebird_seen', JSON.stringify({ daejun: 1 }));
  app.window.localStorage.setItem('ebird_seen_field', 'speciesCode');
  // The bundled seed IS the WA year list, which of course has robins on it.
  app.window.localStorage.setItem('ebird_year_names', JSON.stringify(['Dark-eyed Junco']));

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
  assert.deepEqual(Array.from(rows, (r) => r.code), ['amerob', 'sonspa'],
    'seen birds and sub-40% birds are both excluded; spread beats repetition');
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

test('Contents is a grid of tiles, and the lead board leads it', async () => {
  const app = await boot();
  const A = app.window.__app;
  const parts = A.splitLabel('🧭 Where to go next');
  assert.equal(parts.icon, '🧭', 'a label splits off its glyph');
  assert.equal(parts.text, 'Where to go next', 'and keeps the rest as words');
  const plain = A.splitLabel('Settings');
  assert.equal(plain.icon, '', 'a label with no glyph claims none');
  assert.equal(plain.text, 'Settings',
    'and keeps all of its text rather than losing a letter to a bad guess');
  const first = app.document.querySelector('#menuList li');
  assert.ok(first.classList.contains('wide'),
    'the first tile spans the row - "where do I go next" is the whole app');
  assert.match(first.querySelector('.toclink').getAttribute('aria-label'),
    /Where to go next/, 'and it is the lead board, not whatever sorts first');
  app.window.close();
});

test('All unseen reports: one row per species per place, nearest first', async () => {
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

test('work anchor: a second waypoint ranks, it never widens coverage', async () => {
  const app = await boot();
  const A = app.window.__app;
  // regions.py ships a work waypoint for WA, so the default is already two
  // anchors; the setting overrides it rather than creating it.
  assert.equal(A.getAnchors().length, 2,
    'the region default supplies home and work');
  app.window.localStorage.setItem(A.workKey('lat'), '47.674');
  app.window.localStorage.setItem(A.workKey('lng'), '-122.1215');
  const anchors = A.getAnchors();
  assert.equal(anchors.length, 2, 'a saved work waypoint replaces the default');
  assert.equal(anchors[1].lat, 47.674, 'and it is the saved one that is used');
  assert.equal(anchors[0].name, 'home',
    'home is first, so a tie in distance resolves to home');
  // Clearing work stores an empty string rather than removing the key: a
  // removed key would silently fall back to the regions.py default, so
  // "I do not have a work location" would be un-expressible.
  app.window.localStorage.setItem(A.workKey('lat'), '');
  assert.equal(A.getAnchors().length, 1,
    'clearing work really removes the second anchor, not resets it');
  // The anchors must not reach the feed planner: a work-centred circle would
  // change WHICH birds the app knows about, and the report would then be
  // answering a different question than the app.
  const planner = HTML.slice(HTML.indexOf('BL.planFeeds('), HTML.indexOf('BL.planFeeds(') + 200);
  assert.ok(!/anchor/i.test(planner),
    'planFeeds is never handed anchors - the second waypoint ranks only');
  app.window.close();
});
