#!/usr/bin/env node
/**
 * Find what makes the page wider than the phone screen.
 *
 * Two blind fixes and one blind diagnostic all missed this bug for the same
 * reason: they only ever looked INSIDE `.panel`. The in-app reporter scanned
 * `.panel *`, and the containment fix was `.panel { overflow-x: clip }`. A
 * device screenshot then showed the whole page — navbar included — panning
 * sideways, which is chrome OUTSIDE any panel and therefore invisible to both.
 *
 * This drives real Chrome (jsdom has no layout engine, which is why the unit
 * suite cannot see this class of bug at all), serves www/ over HTTP so
 * localStorage behaves, walks every section, and reports EVERY element whose
 * right edge passes the viewport — not just the ones in a panel.
 *
 *   node assets/audit-overflow.js [width]
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const WWW = path.join(__dirname, '..', 'www');
const WIDTH = +(process.argv[2] || 390);
const HEIGHT = 844;
const SCALE = process.argv[3] || '1';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

if (!CHROME) { console.error('No Chrome or Edge found'); process.exit(2); }

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

// Injected before the app's own script: a key and a home so sections render,
// and a fetch stub so the sweep is offline and deterministic.
const BOOTSTRAP = `<script>
(function () {
  try {
    localStorage.setItem('ebird_api_key', 'AUDITKEY');
    localStorage.setItem('ebird_home_lat', '47.75');
    localStorage.setItem('ebird_home_lng', '-122.16');
    localStorage.setItem('ebird_report', 'wa');
    localStorage.setItem('ebird_ui_scale', '__SCALE__');
  } catch (e) {}
  var realFetch = window.fetch;
  // Realistic-shaped eBird responses so sections actually RENDER. An empty
  // section cannot overflow, which is precisely how the first headless sweep
  // came back clean while the device kept side-scrolling.
  var LOC = [
    { locId: 'L1', locName: 'Edmonds Marsh & Willow Creek Hatchery (restricted access)', lat: 47.807, lng: -122.377 },
    { locId: 'L2', locName: 'Marymoor Park--Audubon Bird Loop', lat: 47.658, lng: -122.118 },
    { locId: 'L3', locName: 'Montlake Fill (Union Bay Natural Area)', lat: 47.657, lng: -122.291 }
  ];
  var SPP = [
    { speciesCode: 'rudtur', comName: 'Ruddy Turnstone', sciName: 'Arenaria interpres' },
    { speciesCode: 'bktgwa', comName: 'Black-throated Gray Warbler', sciName: 'Setophaga nigrescens' },
    { speciesCode: 'wesgre', comName: 'Western Grebe', sciName: 'Aechmophorus occidentalis' }
  ];
  function obsRows() {
    var out = [];
    for (var i = 0; i < 12; i++) {
      var s = SPP[i % SPP.length], l = LOC[i % LOC.length];
      out.push({
        speciesCode: s.speciesCode, comName: s.comName, sciName: s.sciName,
        locId: l.locId, locName: l.locName, lat: l.lat, lng: l.lng,
        obsDt: '2026-07-31 08:1' + (i % 10), howMany: i + 1,
        subId: 'S37840250' + i, userDisplayName: 'Eric Sandberg',
        obsValid: true, obsReviewed: false, locationPrivate: false
      });
    }
    return out;
  }
  window.fetch = function (url) {
    var u = String(url);
    if (/^https?:\\/\\/(localhost|127\\.)/.test(u) || /^[./]/.test(u)) return realFetch.apply(this, arguments);
    var body = [];
    if (/ref\\/taxonomy/.test(u)) body = SPP;
    else if (/product\\/spplist/.test(u)) body = SPP.map(function (s) { return s.speciesCode; });
    else if (/ref\\/hotspot/.test(u)) body = LOC.map(function (l) {
      return { locId: l.locId, locName: l.locName, lat: l.lat, lng: l.lng, numSpeciesAllTime: 220, latestObsDt: '2026-07-31 08:00' };
    });
    else if (/product\\/lists/.test(u)) body = LOC.map(function (l, i) {
      return { subId: 'S9' + i, obsDt: '31 Jul 2026', isoObsDate: '2026-07-31 0' + i + ':00',
               numSpecies: 40 - i, userDisplayName: 'Eric Sandberg',
               loc: { locId: l.locId, locName: l.locName, latitude: l.lat, longitude: l.lng, isHotspot: true } };
    });
    else if (/data\\/obs|product\\/top100|product\\/stats/.test(u)) body = obsRows();
    return Promise.resolve({
      ok: true, status: 200,
      json: function () { return Promise.resolve(body); },
      text: function () { return Promise.resolve(JSON.stringify(body)); }
    });
  };
})();
</script>`;

const AUDIT = `<script>
(function () {
  function sel(el) {
    if (!el || el === document.body) return 'body';
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    var c = String(el.className || '').trim();
    if (c && typeof c === 'string') s += '.' + c.split(/\\s+/).slice(0, 3).join('.');
    return s;
  }
  function chain(el) {
    var out = [], n = el, i = 0;
    while (n && n !== document.body && i++ < 4) { out.push(sel(n)); n = n.parentElement; }
    return out.join(' < ');
  }
  function scan(label) {
    var vw = document.documentElement.clientWidth;
    var items = [], all = document.querySelectorAll('body *'), maxRight = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // SVG elements have an SVGAnimatedString className, so a string test on
      // it silently never matches. Maps overflow their tile pane by design.
      if (el.closest && el.closest('.leaflet-container')) continue;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.right > maxRight) maxRight = r.right;
      var over = r.right - vw;
      if (over > 0.5) {
        items.push({ sel: chain(el), over: +over.toFixed(1), width: +r.width.toFixed(1), left: +r.left.toFixed(1) });
      }
    }
    items.sort(function (a, b) { return b.over - a.over; });
    var vis = document.querySelector('section.panel:not([hidden])');
    return {
      label: label, vw: vw, n: all.length,
      maxRight: +maxRight.toFixed(1),
      text: vis ? (vis.textContent || '').replace(/\\s+/g, ' ').trim().length : -1,
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      over: document.documentElement.scrollWidth - vw,
      items: items.slice(0, 8)
    };
  }
  function run() {
    var A = window.__app, out = [];
    out.push(scan('(contents menu)'));
    var secs = [].slice.call(document.querySelectorAll('section.panel'))
      .map(function (s) { return s.id; }).filter(Boolean);
    var i = 0;
    function step() {
      if (i >= secs.length) return finish(out);
      var id = secs[i++];
      try { A.showSection(id); } catch (e) { return step(); }
      // showSection triggers autoLoad, which paints asynchronously. Scanning
      // immediately measures an empty panel, which cannot overflow.
      setTimeout(function () { out.push(scan(id)); step(); }, 350);
    }
    step();
  }
  function finish(out) {
    try {
      var x = new XMLHttpRequest();
      x.open('POST', '/__audit', true);
      x.setRequestHeader('Content-Type', 'text/plain');
      x.send(JSON.stringify(out));
    } catch (e) {}
  }
  window.addEventListener('load', function () { setTimeout(run, 700); });
})();
</script>`;

let onReport = null;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__audit') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.writeHead(204); res.end();
      if (onReport) onReport(JSON.parse(body));
    });
    return;
  }
  // The app is measured inside an iframe of an EXACT css width. Relying on
  // --window-size gave a 485px viewport on this machine, because Windows
  // display scaling sits between the flag and the layout viewport - so the
  // "390px" sweep was never actually 390px.
  if (req.url === '/' || req.url.indexOf('/__harness') === 0) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#333}'
      + 'iframe{width:' + WIDTH + 'px;height:' + HEIGHT + 'px;border:0;display:block}</style>'
      + '<iframe src="/index.html"></iframe>');
    return;
  }
  let rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html';
  const file = path.join(WWW, rel);
  if (!file.startsWith(WWW) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('nope'); return;
  }
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') {
    let html = fs.readFileSync(file, 'utf8');
    html = html.replace(/<head(\s[^>]*)?>/i, (m) => m + BOOTSTRAP.replace('__SCALE__', SCALE));
    html = html.replace(/<\/body>/i, AUDIT + '</body>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-audit-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + profile,
    '--window-size=' + (WIDTH + 420) + ',' + (HEIGHT + 120),
    '--force-device-scale-factor=1',
    'http://127.0.0.1:' + port + '/__harness',
  ];
  const ch = spawn(CHROME, args, { stdio: 'ignore' });

  const done = (report) => {
    try { ch.kill(); } catch (e) {}
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    if (!report) { console.error('audit never reported (page did not run)'); process.exit(3); }
    let bad = 0;
    console.log('viewport ' + WIDTH + 'px  text scale ' + SCALE + '\n');
    report.forEach((r) => {
      console.log('== ' + r.label + ' == vw ' + r.vw + '  els ' + r.n
        + '  text ' + r.text + '  maxRight ' + r.maxRight
        + '  docScrollW ' + r.docScrollW + '  (' + (+r.over).toFixed(1) + 'px over)');
      if (r.over <= 0.5 && !r.items.length) return;
      bad++;
      r.items.forEach((it) => {
        console.log('   +' + it.over + 'px  w=' + it.width + ' left=' + it.left + '  ' + it.sel);
      });
      console.log('');
    });
    if (!bad) console.log('\nnothing overflows at ' + WIDTH + 'px');
    process.exit(bad ? 1 : 0);
  };

  onReport = done;
  setTimeout(() => done(null), 30000);
});
