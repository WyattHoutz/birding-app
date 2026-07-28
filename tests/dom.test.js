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
  assert.deepEqual(
    app.links().map((a) => a.textContent.trim()),
    CONTRACT.menu.map((m) => m.label),
    'menu labels/order drifted from tests/fixtures/report-contract.json — update ' +
    'both the app and the contract (and report.py if the report changed)');
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


test('rankings: the board is scoped to the active report and includes Top 25', async () => {
  // Two shipped bugs live here. v1.0.10: the scope control had no change
  // listener, so a stale board sat under the wrong heading. v1.0.12 removed the
  // control entirely — rankings and Top 25 are one section scoped to the region
  // you picked — so the guard is now "the board follows the report".
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
  assert.match(src, /Top 25 eBirders/, 'the merged section labels its Top 25 board');
  assert.match(src, /slice\(0,\s*25\)/, 'the Top 25 board is capped at 25 like the report');
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
