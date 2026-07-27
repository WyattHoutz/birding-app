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
