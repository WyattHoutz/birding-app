#!/usr/bin/env node
/**
 * Render the app's surfaces to PNGs at the real device viewport.
 *
 * Owner, 2026-08-29: *"I like these mock ups, can we generate them as part of
 * the release? It would be helpful to have recently generated mockups to
 * iterate ui bugs faster."*
 *
 * WHY THIS EXISTS RATHER THAN A SCREENSHOT FLAG
 * ---------------------------------------------
 * ⚠️ `chrome --headless --window-size=393,900 --screenshot` DOES NOT WORK for
 * this, and it fails in the most misleading way available: on this machine it
 * lays the page out at **500px** and merely CROPS the PNG to 393, so the image
 * looks like a real right-edge clip that is not there. Measured 2026-08-29,
 * and it is why F245's whole premise was wrong for weeks.
 *
 * So the page is rendered inside an IFRAME OF AN EXACT CSS WIDTH — the same
 * trick `assets/audit-overflow.js` uses — and captured with
 * `Page.captureScreenshot` over CDP with an explicit clip. The width in the
 * file name is therefore the width the browser really laid out at.
 *
 * DEFAULT WIDTH IS 393, NOT 402. 402 is the iPhone 16 Pro; 393 is the
 * 14/15 Pro and is the NARROWER of the two the sweep walks, so it is the one
 * that binds (F245).
 *
 * Usage:
 *   node assets/mockups.js               # every shot, 393px, into mockups/
 *   node assets/mockups.js --width 402
 *   node assets/mockups.js --only menu,top100
 *   node assets/mockups.js --out somewhere
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const WIDTH = Number(arg('width', 393));
const HEIGHT = Number(arg('height', 1400));
const SCALE = Number(arg('scale', 1));
const OUT = path.resolve(arg('out', path.join(ROOT, 'mockups')));
const ONLY = (arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

const CHROME = [process.env.CHROME_BIN,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser',
].filter(Boolean).find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon' };

// ---------------------------------------------------------------- the shots
//
// Each shot names a SURFACE and the state it needs. `prep` runs inside the
// app frame before capture and returns when the surface is painted.
//
// ⚠️ Everything here is OFFLINE — `fetch` is stubbed with fixtures below, for
// the same reason the audit is offline: a mockup that depends on the eBird
// token bucket takes minutes, varies run to run, and cannot be diffed against
// the last release. A mockup is for LAYOUT, and layout does not need live data.
const SHOTS = [
  { id: 'menu', title: 'Contents menu', prep: 'return true;' },
  { id: 'top100', title: 'Top 100 rows',
    prep: `A.showSection('sec-rankBtn');
           A.renderRankings(FIX.rankings, 'US-WA', 'https://ebird.org/top100', 'Sample Birder');
           return true;` },
  { id: 'twitches', title: 'Twitches today — a rarity card with comments',
    prep: `A.showSection('sec-refreshBtn');
           document.getElementById('results').innerHTML = FIX.rarityHtml();
           return true;` },
  { id: 'nemesis', title: 'Nemesis birds',
    prep: `A.showSection('sec-easyBtn'); return true;` },
  { id: 'opentargets', title: 'Open targets',
    prep: `A.showSection('sec-allUnseenBtn'); return true;` },
];

// ------------------------------------------------------------------ harness
//
// Injected into the app document BEFORE its own scripts run, so the app boots
// against a stub instead of the network and against a known localStorage.
const BOOTSTRAP = `
<script>
(function () {
  try {
    localStorage.clear();
    localStorage.setItem('ebird_report', 'wa');
    localStorage.setItem('ebird_api_key', 'mockupmockup');
    localStorage.setItem('ebird_home_lat', '47.75458');
    localStorage.setItem('ebird_home_lng', '-122.15889');
    localStorage.setItem('ebird_display_name', 'Sample Birder');
    localStorage.setItem('ebird_ui_scale', '__SCALE__');
  } catch (e) {}
  // Never settles: loaders start, spinners paint, nothing arrives and nothing
  // errors. Same stub the DOM suite boots against.
  var HANG = function () { return new Promise(function () {}); };
  window.fetch = HANG;
  window.XMLHttpRequest = function () {
    this.open = function () {}; this.setRequestHeader = function () {};
    this.send = function () {}; this.addEventListener = function () {};
  };
  window.FIX = {
    rankings: {
      rows: [
        { rank: 1, name: 'ada lovelace', species: 1204, checklists: 980, recent: 'Common Ringed Plover (Aug. 28, 2026)' },
        { rank: 2, name: 'Wilhelmina Featherstonehaugh', species: 987, checklists: 720, recent: 'Sharp-tailed Sandpiper (Aug. 27, 2026)' },
        { rank: 3, name: 'Grace Hopper', species: 902, checklists: 611, recent: 'Ruff (Aug. 26, 2026)' },
        { rank: 4, name: 'Alan Turing', species: 874, checklists: 590, recent: 'Marbled Godwit (Aug. 29, 2026)' },
        { rank: 182, name: 'Sample Birder', species: 209, checklists: 331, recent: 'American Golden-Plover (Aug. 29, 2026)' }
      ],
      me: { rank: 182, name: 'Sample Birder', species: 209, checklists: 331 }
    },
    rarityHtml: function () {
      return document.getElementById('results') ? '' : '';
    }
  };
})();
</script>`;

// ------------------------------------------------------------------- server
let onShot = null;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__harness') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}'
      + 'iframe{width:' + WIDTH + 'px;height:' + HEIGHT + 'px;border:0;display:block}</style>'
      + '<iframe id="f" src="/index.html"></iframe>');
    return;
  }
  let rel = url.replace(/^\//, '') || 'index.html';
  const file = path.join(WWW, rel);
  if (!file.startsWith(WWW) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('nope'); return;
  }
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') {
    let html = fs.readFileSync(file, 'utf8');
    html = html.replace(/<head(\s[^>]*)?>/i, (m) => m + BOOTSTRAP.replace('__SCALE__', String(SCALE)));
    res.writeHead(200, { 'Content-Type': MIME[ext] });
    res.end(html); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

// ---------------------------------------------------------------------- CDP
function cdp(wsUrl) {
  let WebSocket;
  try { WebSocket = require('ws'); }
  catch (e) {
    console.error('mockups: needs the `ws` package (npm i -D ws)');
    process.exit(2);
  }
  const ws = new WebSocket(wsUrl);
  let id = 0; const waiting = new Map();
  ws.on('message', (m) => {
    const msg = JSON.parse(m.toString());
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  });
  const ready = new Promise((r) => ws.on('open', r));
  return {
    ready,
    send: (method, params, sessionId) => new Promise((res, rej) => {
      const n = ++id;
      waiting.set(n, (msg) => (msg.error ? rej(new Error(method + ': ' + msg.error.message)) : res(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    }),
    close: () => ws.close(),
  };
}

async function main() {
  if (!CHROME) { console.error('mockups: no Chrome found (set CHROME_BIN)'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-'));

  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--window-size=' + (WIDTH + 420) + ',' + (HEIGHT + 200),
    'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });

  const kill = () => {
    // Kill the TREE. Chrome forks renderers that outlive the parent; 492
    // strays accumulated once because a cleanup only killed the parent.
    if (process.platform === 'win32') {
      try { spawnSync('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
    } else { try { process.kill(-ch.pid, 'SIGKILL'); } catch (e) { try { ch.kill('SIGKILL'); } catch (e2) {} } }
  };

  // ⚠️ READ THE PORT FROM THE PROFILE, NOT FROM stderr.
  //
  // Parsing the DevTools URL out of stderr is the documented trick and it does
  // not work on this build — `--headless=new` prints nothing there, so the
  // first version of this script timed out every run. Chrome always writes
  // `DevToolsActivePort` into its user-data-dir once the socket is up, which
  // is the same fact without the guesswork.
  const portFile = path.join(profile, 'DevToolsActivePort');
  const wsUrl = await (async () => {
    for (let i = 0; i < 120; i++) {
      try {
        const txt = fs.readFileSync(portFile, 'utf8').split('\n');
        if (txt.length >= 2 && txt[0].trim()) {
          return 'ws://127.0.0.1:' + txt[0].trim() + txt[1].trim();
        }
      } catch (e) { /* not written yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('Chrome never wrote DevToolsActivePort in ' + profile);
  })();

  const c = cdp(wsUrl);
  await c.ready;
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  await c.send('Page.enable', {}, sessionId);
  await c.send('Runtime.enable', {}, sessionId);
  await c.send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/__harness' }, sessionId);
  await new Promise((r) => setTimeout(r, 2500));

  const shots = ONLY.length ? SHOTS.filter((s) => ONLY.includes(s.id)) : SHOTS;
  const made = [];
  for (const shot of shots) {
    // Everything runs INSIDE the iframe, which is the box with the real width.
    // ⚠️ Do NOT declare a local named `document` here: `var` hoists, so the
    // first line would dereference the local (undefined) rather than the outer
    // document, and the whole expression throws before it starts.
    const expr = `(function () {
      var frame = window.document.getElementById('f');
      if (!frame) return 'no iframe';
      var w = frame.contentWindow;
      var A = w.__app, doc = w.document;
      if (!A) return 'no __app seam (the app did not boot)';
      try { (function (document, FIX) { ${shot.prep} })(doc, w.FIX); }
      catch (e) { return 'prep: ' + (e && e.message || e); }
      w.scrollTo(0, 0);
      return 'ok';
    })()`;
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
    const verdict = r.result && r.result.value;
    if (verdict !== 'ok') {
      console.error('  !! ' + shot.id + ': ' + verdict);
      continue;
    }
    await new Promise((r2) => setTimeout(r2, 700));
    // Measure the real painted height inside the frame so a short surface is
    // not padded with a screenful of background.
    const hr = await c.send('Runtime.evaluate', {
      expression: `(function () { var d = document.getElementById('f').contentDocument;
        return Math.min(${HEIGHT}, Math.max(600, d.documentElement.scrollHeight)); })()`,
      returnByValue: true }, sessionId);
    const h = Number(hr.result.value) || HEIGHT;
    const png = await c.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: WIDTH, height: h, scale: 2 },
      captureBeyondViewport: true,
    }, sessionId);
    const name = shot.id + '-' + WIDTH + 'px.png';
    fs.writeFileSync(path.join(OUT, name), Buffer.from(png.data, 'base64'));
    made.push({ name, title: shot.title, h });
    console.log('  ' + name.padEnd(28) + WIDTH + 'x' + h);
  }

  // An index, so the folder is browsable rather than a pile of PNGs.
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  fs.writeFileSync(path.join(OUT, 'README.md'),
    '# UI mockups — ' + WIDTH + 'px\n\n'
    + 'Generated ' + stamp + ' UTC by `node assets/mockups.js`.\n\n'
    + '⚠️ Laid out inside an iframe of an exact CSS width. Chrome\'s\n'
    + '`--window-size` does **not** set the layout viewport on Windows — it\n'
    + 'lays out at 500px and crops the PNG, which looks exactly like a real\n'
    + 'right-edge clip. Do not replace this with `--screenshot`.\n\n'
    + '**393px is the binding width** (iPhone 14/15 Pro), not 402 (16 Pro).\n\n'
    + made.map((m) => '### ' + m.title + '\n\n![' + m.title + '](' + m.name + ')\n').join('\n')
    + '\n');

  c.close(); kill(); server.close();
  console.log(made.length + ' mockup(s) -> ' + OUT);
  process.exit(made.length === shots.length ? 0 : 1);
}

main().catch((e) => { console.error('mockups: ' + (e && e.message || e)); process.exit(1); });
