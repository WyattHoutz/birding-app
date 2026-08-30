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
const { spawn, spawnSync } = require('child_process');

const WWW = path.join(__dirname, '..', 'www');
const WIDTH = +(process.argv[2] || 390);
const HEIGHT = 844;
const SCALE = process.argv[3] || '1';
// F142. Easy read at the NARROWEST width is the hardest layout case in the
// app - 44px tap targets and extra spacing pushed into 320px - so it belongs
// in the sweep from the first commit rather than after something clips.
const EASY = String(process.argv[4] || '') === 'easyread';

// F245. LABELS WHOSE MID-WORD BREAK IS ACCEPTED, AND WHY.
//
// ⚠️ This is a DEBT LIST, not a permission slip. Every entry is a tile label
// that splits in the middle of a word at 393px — iPhone 14/15 Pro width, and
// one of the six this sweep already walks. They are accepted because the owner
// deferred the only real fix: "dont change button wrapping now. or sizes"
// (F237). Detection is not a wrapping change, so it ships; the cure does not.
//
// MEASURED 2026-08-29 at 393px / scale 1, where the label column is 62.8px —
// NOT the 67.3px figure this project has been quoting, which is the 402px
// column. That mistake is why these five went unnoticed: candidates were being
// measured against a column 4.5px wider than the binding one.
//
//     Twitches today / this week   "Twitches" 64.7px   short by 1.9px
//     Stakeout bird                "Stakeout" 66.3px   short by 3.5px
//     Nemesis birds                "Nemesis"  64.1px   short by 1.3px
//     Convoys                      "Convoys"  64.1px   short by 1.3px
//
// ANY OTHER label that splits mid-word FAILS the sweep. The point is to stop
// the set growing while the fix is deferred — and this list should SHRINK to
// empty when F237 is taken up, not be added to.
const MIDWORD_KNOWN = [
  'Twitches today',
  'Twitches this week',
  'Stakeout bird',
  'Nemesis birds',
  'Convoys',
];

// Windows dev box and Linux CI runner both have to find a browser. CHROME_BIN
// wins so a runner can point at whatever it actually installed.
const CHROME = [
  process.env.CHROME_BIN,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });

if (!CHROME) { console.error('No Chrome found (set CHROME_BIN)'); process.exit(2); }

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
    localStorage.setItem('bc_easyread', '__EASY__');
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
      // SVG className is an SVGAnimatedString, so a string test on it silently
      // never matches; getAttribute('class') works for HTML and SVG alike.
      // Ancestry catches the panes, the class catches an unparented tile.
      var cls = (el.getAttribute && el.getAttribute('class')) || '';
      if (/leaflet-/.test(cls)) continue;
      if (el.closest && el.closest('.leaflet-container')) continue;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.right > maxRight) maxRight = r.right;
      var over = r.right - vw;
      if (over > 0.5) {
        items.push({ sel: chain(el), over: +over.toFixed(1), width: +r.width.toFixed(1), left: +r.left.toFixed(1) });
      }
      // The other half, never checked until now: a box that starts before the
      // left edge makes the page just as draggable, and the device screenshot
      // showed the panel's LEFT edge clipped.
      if (r.left < -0.5) {
        items.push({ sel: chain(el), over: +(-r.left).toFixed(1), width: +r.width.toFixed(1),
                     left: +r.left.toFixed(1), side: 'LEFT' });
      }
    }
    items.sort(function (a, b) { return b.over - a.over; });
    // A control that is hard to SEE is also hard to HIT. Measured rather than
    // asserted in CSS, because a later restyle can shrink a box without ever
    // touching the rule that promised 44px.
    // F142, the VoiceOver half. A control whose only content is an emoji is
    // perfectly legible on screen and useless through a screen reader: "lady
    // beetle button" instead of "Debug log". Emoji are matched by CODE POINT
    // range rather than by listing them, so a new icon cannot quietly slip in.
    var unnamed = [];
    var EMOJI = /[\u2190-\u2BFF\u2600-\u27BF\uFE0F\u{1F000}-\u{1FAFF}]/gu;
    var acts = document.querySelectorAll(
      'section.panel:not([hidden]) button, section.panel:not([hidden]) a[href],'
      + ' #navbar button, nav a, .toc a');
    for (var q = 0; q < acts.length; q++) {
      var ae = acts[q], ar = ae.getBoundingClientRect();
      if (ar.width === 0 && ar.height === 0) continue;
      var label = (ae.getAttribute('aria-label') || '').trim();
      if (label) continue;                       // explicitly named: fine
      if (ae.getAttribute('aria-hidden') === 'true') continue;
      var txt = (ae.textContent || '').trim();
      var stripped = txt.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
      if (!stripped) {
        unnamed.push({ sel: chain(ae), saw: txt.slice(0, 24) || '(empty)' });
      }
    }

    var small = [];
    if (document.documentElement.getAttribute('data-a11y') === 'on') {
      var tapsel = 'section.panel:not([hidden]) button, section.panel:not([hidden]) select, #navbar button';
      var taps = document.querySelectorAll(tapsel);
      for (var t = 0; t < taps.length; t++) {
        var te = taps[t], tr = te.getBoundingClientRect();
        if (tr.width === 0 && tr.height === 0) continue;   // not rendered
        if (tr.height < 43.5 || tr.width < 43.5) {
          small.push({ sel: chain(te), w: +tr.width.toFixed(1), h: +tr.height.toFixed(1) });
        }
      }
    }
    // F181. Text that is CRUSHED rather than clipped: a label broken in the
    // middle of a word. Invisible to every overflow check by construction —
    // the whole point of the collapse is that nothing passes the edge — and
    // invisible to jsdom, which has no line boxes at all. Measured from real
    // line boxes: a break is mid-word when a line ends on a non-space and the
    // next begins on one.
    var crushed = [];
    var midword = [];
    var tl = document.querySelectorAll('.tilelabel');
    for (var c = 0; c < tl.length; c++) {
      var cel = tl[c];
      if (!cel.offsetParent) continue;
      var rows = [], tw = document.createTreeWalker(cel, NodeFilter.SHOW_TEXT, null), tn;
      while ((tn = tw.nextNode())) {
        var tv = tn.nodeValue, curl = null;
        for (var ci = 0; ci < tv.length; ci++) {
          var rg = document.createRange(); rg.setStart(tn, ci); rg.setEnd(tn, ci + 1);
          var rr = rg.getBoundingClientRect(); if (!rr.height) continue;
          var rt = Math.round(rr.top);
          if (!curl || Math.abs(curl.top - rt) > 2) { curl = { top: rt, s: '' }; rows.push(curl); }
          curl.s += tv[ci];
        }
      }
      // A label needs at most one line per word — plus one, to allow a single
      // unavoidable split of one genuinely long word. Needing MORE lines than
      // that means words are being shredded, which is the collapse this
      // catches: measured at 320px/Easy read before the fix, five words were
      // rendered on 27 lines, one letter each, in a label column of 0px.
      var words = (cel.textContent || '').trim().split(/\\s+/).filter(Boolean).length;
      if (rows.length > words + 1) {
        crushed.push({ sel: chain(cel), lines: rows.length, words: words,
                       saw: rows.slice(0, 4).map(function (x) { return x.s; }).join('|'),
                       w: +cel.getBoundingClientRect().width.toFixed(1) });
      }
      // F245. A SINGLE mid-word break, which \`crushed\` above cannot see BY
      // CONSTRUCTION: one word split once is two lines for two words, which is
      // under its words+1 bar. That blind spot is why F232, F235 and F237 were
      // all reported from the device rather than caught here.
      //
      // Same line boxes, one extra test: a break is mid-word when a line ends
      // on a non-space AND the next begins on one. A hyphen is NOT counted —
      // "Under-birded" breaking at its hyphen is correct typography.
      var splitAt = null;
      for (var r2 = 0; r2 + 1 < rows.length; r2++) {
        if (/[^\\s-]$/.test(rows[r2].s) && /^\\S/.test(rows[r2 + 1].s)) {
          splitAt = rows[r2].s.trim() + ' | ' + rows[r2 + 1].s.trim();
          break;
        }
      }
      if (splitAt) {
        midword.push({ sel: chain(cel), broke: splitAt,
                       text: (cel.textContent || '').replace(/\\s+/g, ' ').trim(),
                       w: +cel.getBoundingClientRect().width.toFixed(1) });
      }
    }
    // F232. Text CLIPPED on the left, which no overflow check can see by
    // construction: the glyphs fall outside an overflow:hidden ancestor, so
    // the document never gets wider and the sweep above reports 0.0px while
    // the phone shows "iscovery Park". Measured for real: a hanging indent
    // (a negative text-indent plus matching left padding) whose padding is won
    // by a more specific rule pulls its first line clean out of the row.
    // Only elements that OWN a negative indent or a negative left margin are
    // measured — text-indent inherits, so every inline descendant would
    // otherwise report the same cut three times — and only block boxes, since
    // a line box belongs to its block container.
    var clipped = [];
    var cands = document.querySelectorAll('section.panel:not([hidden]) *');
    for (var k = 0; k < cands.length; k++) {
      var ke = cands[k];
      var kcs = getComputedStyle(ke);
      if (/^inline(?!-block|-flex|-grid)/.test(kcs.display) || kcs.display === 'none') continue;
      if (!(parseFloat(kcs.textIndent || '0') < -0.5
            || parseFloat(kcs.marginLeft || '0') < -0.5)) continue;
      var kr = ke.getBoundingClientRect();
      if (!kr.width || !kr.height) continue;
      var kfl = null;
      try {
        var krg = document.createRange();
        krg.selectNodeContents(ke);
        var krects = krg.getClientRects();
        for (var kj = 0; kj < krects.length; kj++) {
          if (!krects[kj].width && !krects[kj].height) continue;
          if (kfl == null || krects[kj].top <= krects[0].top + 1) {
            kfl = (kfl == null) ? krects[kj].left : Math.min(kfl, krects[kj].left);
          }
        }
      } catch (e) { kfl = null; }
      if (kfl == null) continue;
      // The nearest ancestor that actually clips, and the edge it clips at —
      // overflow clips at the PADDING box, so the border width is added on.
      var kclip = null, kn = ke;
      while (kn && kn !== document.documentElement) {
        var ncs = getComputedStyle(kn);
        if (ncs.overflowX && ncs.overflowX !== 'visible') {
          var nr = kn.getBoundingClientRect();
          kclip = { el: kn, left: nr.left + parseFloat(ncs.borderLeftWidth || 0) };
          break;
        }
        kn = kn.parentElement;
      }
      if (!kclip) continue;
      var kcut = kclip.left - kfl;
      if (kcut > 0.5) {
        clipped.push({ sel: chain(ke), cut: +kcut.toFixed(1),
                       ti: kcs.textIndent, pad: kcs.paddingLeft,
                       by: sel(kclip.el),
                       saw: (ke.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 34) });
      }
    }

    var vis = document.querySelector('section.panel:not([hidden])');
    return {
      label: label, vw: vw, n: all.length,
      crushed: crushed.slice(0, 8),
      midword: midword.slice(0, 12),
      clipped: clipped.slice(0, 8),
      maxRight: +maxRight.toFixed(1),
      text: vis ? (vis.textContent || '').replace(/\\s+/g, ' ').trim().length : -1,
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      over: document.documentElement.scrollWidth - vw,
      items: items.slice(0, 8),
      small: small.slice(0, 8),
      unnamed: unnamed.slice(0, 10)
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
    html = html.replace(/<head(\s[^>]*)?>/i, (m) => m + BOOTSTRAP.replace('__SCALE__', SCALE).replace('__EASY__', EASY ? 'on' : 'off'));
    html = html.replace(/<\/body>/i, AUDIT + '</body>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const buildArgs = (profile) => [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + profile,
    '--window-size=' + (WIDTH + 420) + ',' + (HEIGHT + 120),
    '--force-device-scale-factor=1',
    'http://127.0.0.1:' + port + '/__harness',
  ];
  let profile = null;
  let ch = null;
  let timer = null;
  let attempt = 0;

  // ---- KILL THE TREE, NOT THE PARENT ------------------------------------
  //
  // MEASURED 2026-08-26: `ch.kill()` kills the parent Chrome and nothing else.
  // Chrome forks a renderer, a GPU process and helpers — **8 live processes
  // per run** on this box — and they outlive the parent while holding open
  // file handles inside `--user-data-dir`. So the rmSync below failed, every
  // time, silently into an empty catch. By the time anyone looked there were
  // **99 orphaned Chromes and 492 stale `bc-audit-*` profiles** in $TMP.
  //
  // THAT is the flake the timeout comment further down has been chasing. The
  // orphans load the machine, so a LATER width in the six-run chain boots
  // slowly and trips the budget — which is exactly why the failure point
  // MOVES (the 5th width on one run, the 3rd on the next) and why the same
  // width always passes standalone. Raising 120s → 240s treated the symptom.
  // No clock is large enough to outrun an unbounded leak.
  // ⚠️ `taskkill /pid … /T` IS NOT ENOUGH, measured: it killed the parent and
  // left **14 Chromes alive**. Chrome's launcher process exits as soon as it
  // has spawned the real browser, so by the time we kill, `ch.pid` is already
  // dead and its children have been re-parented — there is no tree left to
  // walk. The only durable handle on them is the one thing unique to this run:
  // its own `--user-data-dir`. Matching on that is precise by construction —
  // it can never touch the user's own browser, which is why this does not
  // kill by process NAME.
  const killTree = () => {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(ch.pid), '/T', '/F'],
                  { stdio: 'ignore' });
      } else {
        process.kill(-ch.pid, 'SIGKILL');
      }
    } catch (e) { /* already gone */ }
    try { ch.kill('SIGKILL'); } catch (e) { /* already gone */ }
    // ...then anything still carrying THIS run's profile.
    try {
      if (process.platform === 'win32') {
        spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
          "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
          + "Where-Object { $_.CommandLine -like '*" + path.basename(profile)
          + "*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force "
          + "-ErrorAction Stop } catch {} }"], { stdio: 'ignore' });
      } else {
        spawnSync('pkill', ['-9', '-f', path.basename(profile)],
                  { stdio: 'ignore' });
      }
    } catch (e) { /* no shell for it; the retry loop below still reports */ }
  };

  // Windows releases the handles a moment AFTER the tree dies, so one attempt
  // is a coin flip. Returns whether the directory is actually gone, because a
  // cleanup that reports nothing is how 492 of them accumulated unnoticed.
  const removeProfile = () => {
    const wait = (ms) => {
      const until = Date.now() + ms;
      while (Date.now() < until) { /* deliberate: no async left at exit */ }
    };
    for (let i = 0; i < 10; i++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
      if (!fs.existsSync(profile)) return true;
      wait(200);
    }
    return !fs.existsSync(profile);
  };

  const teardown = () => {
    if (!ch) return true;
    killTree();
    const gone = removeProfile();
    if (!gone) {
      console.error('LEAK: ' + profile + ' survived — a Chrome child is still '
        + 'holding it. This is what made the six-width chain flaky; it must '
        + 'not be ignored.');
    }
    ch = null;
    return gone;
  };

  // ---- A HUNG LAUNCH IS RETRIED, NOT SCORED AS A LAYOUT FAILURE ----------
  //
  // MEASURED 2026-08-26, after the leak above was fixed and verified at zero
  // orphans: the chain STILL failed once in six, and the width that failed
  // moved between runs. Timed back to back, 402 then 430 each finish in
  // **23 s** — against a 240 s budget. A 10× blow-up is not slowness, it is an
  // occasional hung Chrome start, roughly 1 launch in 30.
  //
  // The previous response to this was to raise the clock, 120 s → 240 s. That
  // is the wrong lever twice over: it cannot fix a hang (no clock is long
  // enough), and it makes a real failure take four minutes to report. What a
  // hang needs is another attempt.
  //
  // So the budget comes DOWN to 120 s — still 5× the measured 23 s — and a
  // timeout relaunches instead of failing. Only after three hung starts is it
  // called a failure, which it then genuinely is.
  const TIMEOUT_MS = +(process.env.AUDIT_TIMEOUT_MS || 120000);
  const MAX_ATTEMPTS = +(process.env.AUDIT_ATTEMPTS || 3);

  const launch = () => {
    attempt++;
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-audit-'));
    ch = spawn(CHROME, buildArgs(profile), {
      stdio: 'ignore',
      // POSIX needs its own process GROUP so the whole tree can be signalled.
      // On Windows the tree is killed by pid, then by profile, below.
      detached: process.platform !== 'win32',
    });
    timer = setTimeout(onTimeout, TIMEOUT_MS);
  };

  const onTimeout = () => {
    teardown();
    if (attempt < MAX_ATTEMPTS) {
      console.error('audit did not report in ' + Math.round(TIMEOUT_MS / 1000)
        + 's — Chrome start hung; relaunching (attempt ' + (attempt + 1)
        + ' of ' + MAX_ATTEMPTS + ')');
      launch();
      return;
    }
    console.error('audit never reported after ' + MAX_ATTEMPTS
      + ' attempts (page did not run)');
    server.close();
    process.exit(3);
  };

  const done = (report) => {
    clearTimeout(timer);
    teardown();
    server.close();
    if (!report) { console.error('audit never reported (page did not run)'); process.exit(3); }
    let bad = 0;
    console.log('viewport ' + WIDTH + 'px  text scale ' + SCALE + (EASY ? '  EASY READ' : '') + '\n');
    report.forEach((r) => {
      console.log('== ' + r.label + ' == vw ' + r.vw + '  els ' + r.n
        + '  text ' + r.text + '  maxRight ' + r.maxRight
        + '  docScrollW ' + r.docScrollW + '  (' + (+r.over).toFixed(1) + 'px over)');
      var nameless = r.unnamed || [];
      if (nameless.length) {
        bad++;
        nameless.forEach(function (it) {
          console.log('   NO ACCESSIBLE NAME  saw "' + it.saw + '"  ' + it.sel);
        });
      }
      var squashed = r.crushed || [];
      if (squashed.length) {
        bad++;
        squashed.forEach(function (it) {
          console.log('   CRUSHED LABEL  ' + it.lines + ' lines for ' + it.words
            + ' words  w=' + it.w + '  "' + it.saw + '"  ' + it.sel);
        });
      }
      var cut = r.clipped || [];
      if (cut.length) {
        bad++;
        cut.forEach(function (it) {
          console.log('   LEFT-CLIPPED TEXT  ' + it.cut + 'px lost  text-indent '
            + it.ti + '  padding-left ' + it.pad + '  clipped by ' + it.by
            + '  "' + it.saw + '"  ' + it.sel);
        });
      }
      // F245. A label split in the middle of a word. Reported ALWAYS, but only
      // FATAL for a label that is not on the accepted list — see MIDWORD_KNOWN.
      (r.midword || []).forEach(function (it) {
        var known = MIDWORD_KNOWN.indexOf(it.text) >= 0;
        if (!known) bad++;
        console.log('   ' + (known ? 'mid-word (known)  ' : 'MID-WORD BREAK    ')
          + '"' + it.text + '"  broke as: ' + it.broke + '  col=' + it.w + 'px');
      });
      var tiny = r.small || [];
      if (tiny.length) {
        bad++;
        tiny.forEach(function (it) {
          console.log('   TAP TARGET ' + it.w + 'x' + it.h + ' < 44px  ' + it.sel);
        });
      }
      if (r.over <= 0.5 && !r.items.length) return;
      bad++;
      r.items.forEach((it) => {
        console.log('   ' + (it.side === 'LEFT' ? '<-' : '+') + it.over + 'px'
          + (it.side === 'LEFT' ? ' PAST LEFT EDGE' : '')
          + '  w=' + it.width + ' left=' + it.left + '  ' + it.sel);
      });
      console.log('');
    });
    if (!bad) console.log('\nnothing overflows at ' + WIDTH + 'px' + (EASY ? ', and every tap target clears 44px' : ''));
    process.exit(bad ? 1 : 0);
  };

  onReport = done;
  // The history of this line is worth keeping, because it is a worked example
  // of treating a symptom twice. It began at 120s; it was raised to 240s when
  // F28's section pushed the page from ~4,600 elements to 6,013 and the 430px
  // run — the LAST of six, so the most contended — reported "audit never
  // reported". Measured standalone immediately afterwards: 22.4s. The right
  // conclusion was drawn at the time — *"the budget was never the sweep's
  // duration, it was the contended browser boot"* — and then the wrong lever
  // was pulled anyway, because a bigger clock was the only lever on offer.
  //
  // There were two real causes, and neither was time. A leaked browser tree
  // (see killTree) and an occasional hung Chrome start (see onTimeout). With
  // both addressed the budget could come DOWN to 120s and the check finally
  // means what it says: a failure here is the page, not the machine.
  launch();
});
