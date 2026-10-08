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

const WWW = process.env.BIRDCHASER_WWW || path.join(__dirname, '..', 'www');
const WIDTH = +(process.argv[2] || 390);
const HEIGHT = 844;
const SCALE = process.argv[3] || '1';
const PROFILE = +SCALE > 1.3 ? 'high-visibility'
  : +SCALE > 1 ? 'large' : 'standard';

// F245/F251. LABELS WHOSE MID-WORD BREAK IS ACCEPTED.
//
// This must be EMPTY. The five entries previously here were manufactured by
// the harness: desktop Chrome's classic scrollbar consumed 15px, so a command
// labelled 393px actually measured documentElement.clientWidth == 378. The
// mockup generator already used --hide-scrollbars, and iOS uses non-consuming
// overlay scrollbars; both painted every word intact.
//
// Measured 2026-09-04, same worktree and browser:
//
//   without --hide-scrollbars  requested 393, measured 378 -> five breaks
//   with    --hide-scrollbars  requested 393, measured 393 -> zero breaks
//
// ANY label that splits mid-word now fails the sweep. A named device width that
// does not equal the measured app width fails separately below.
const MIDWORD_KNOWN = [];

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
    localStorage.setItem('bc_display_profile', '__PROFILE__');
    // Layout-only, previously validated personal evidence; not a live source claim.
    var acquired = new Date(), pad = function (n) { return String(n).padStart(2, '0'); };
    var owner = {profile:'', identityRevision:0, region:'US-WA',
      period:'year:' + acquired.getFullYear(), taxonomy:'2025.0', schema:1};
    localStorage.setItem('bc_taxonomy_v1', JSON.stringify({edition:'2025.0',checkedAt:Date.now()}));
    localStorage.setItem('ebird_personal_list_v1:' + JSON.stringify(owner), JSON.stringify({
      owner:owner, coverage:'complete', declaredCount:1, unresolved:0, paginated:false,
      codes:['amerob'], rows:[{code:'amerob',name:'American Robin',observedAt:''}],
      source:'https://ebird.org/lifelist/US-WA?time=year', readAt:acquired.toISOString(),
      readDate:acquired.getFullYear() + '-' + pad(acquired.getMonth()+1) + '-' + pad(acquired.getDate())
    }));
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
    window.__auditExternalCalls = (window.__auditExternalCalls || 0) + 1;
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
  var AUDIT_WIDTH = ${WIDTH};
  var AUDIT_SCALE = ${JSON.stringify(SCALE)};
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
  function releaseLayoutChecks() {
    var panel = document.querySelector('section.panel:not([hidden])');
    if (!panel) return null;
    var host = document.createElement('div');
    host.innerHTML = '<h2><span class="fixturetitle">Leaderboard Ticks — Newest on board</span>'
      + '<button class="refreshbtn" type="button" aria-label="Reload">↻</button></h2>'
      + '<ul class="cklcards cklcards-sm"><li class="cklcard cklcard-sm">'
      + '<div class="cksummary"><div class="ckmain"><span class="cklead">2:00 PM</span>'
      + '<span class="ckmeta"><span class="fixtureplace">Discovery Park</span>'
      + '<span class="ckwho">Louis Kreemer AMEGFI ×30, AMEPIP ×2, AMRO ×18, '
      + 'BARSWA ×4, BCCH ×12, BEKI ×3, BHCO ×40, BLJA ×8, BOHEWA ×16</span>'
      + '<span class="ckage"><span class="ckageunit">12h</span> ago</span></span>'
      + '</div></div></li></ul>';
    panel.appendChild(host);
    var title = host.querySelector('.fixturetitle').getBoundingClientRect();
    var reload = host.querySelector('.refreshbtn').getBoundingClientRect();
    var summary = host.querySelector('.cksummary');
    var lead = host.querySelector('.cklead').getBoundingClientRect();
    var place = host.querySelector('.fixtureplace').getBoundingClientRect();
    var age = host.querySelector('.ckage');
    var ageLineTops = {};
    var ageRange = document.createRange();
    ageRange.selectNodeContents(age);
    [].slice.call(ageRange.getClientRects()).forEach(function (rect) {
      if (rect.width || rect.height) ageLineTops[Math.round(rect.top)] = 1;
    });
    var result = {
      reloadInline: reload.top < title.bottom - 1,
      emptyMinHeight: parseFloat(getComputedStyle(summary).minHeight) || 0,
      ageLines: Object.keys(ageLineTops).length,
      ageHeight: age.getBoundingClientRect().height,
      ageLineHeight: parseFloat(getComputedStyle(age).lineHeight)
        || parseFloat(getComputedStyle(age).fontSize) * 1.2,
      metadataWrapped:
        Math.abs(place.top - lead.top) > Math.max(place.height, lead.height) * 0.5,
      metadataGap: place.left - lead.right
    };
    var cards = document.createElement('ul');
    cards.className = 'obs big xl';
    cards.innerHTML = window.SpeciesCards.medium({
      name: '<a href="#">Lewis\\'s Woodpecker</a>',
      icon: '<span class="thumb"></span>',
      distMi: 8.4,
      actions: '<button class="secondary speciesWatchlistAction">Remove from watchlist</button>'
    }) + window.SpeciesCards.medium({
      name: '<a href="#">Lewis\\'s Woodpecker</a>',
      icon: '<span class="thumb"></span>',
      below: '<button class="secondary speciesWatchlistAction">Remove from watchlist</button>'
    }) + window.SpeciesCards.medium({
      name: '<a href="#">American Robin</a>', icon: '<span class="thumb"></span>'
    });
    panel.appendChild(cards);
    if (panel.id === 'sec-myYearBody') {
      result.cardReadability = Array.from(cards.children).map(${require('./card-readability').toString()});
    }
    cards.remove();
    host.remove();
    if (panel.id === 'sec-rankBtn') {
      var icons = [].slice.call(panel.querySelectorAll('.rankbirdicon .thumb'));
      var font = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
      result.latestBirdIcons = icons.length === 2 && icons.every(function (icon) {
        var box = icon.getBoundingClientRect();
        return box.width > 0 && box.width <= 19 * font
          && box.height > 0 && box.height <= 19 * font;
      });
    }
    return result;
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
      var accessibleName = (ae.getAttribute('aria-label') || '').trim();
      if (accessibleName) continue;
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
    // F391. Stakeout bird uses the same field-plus-Go row as Stakeout hotspot.
    // Codes and Close live below it so they cannot squeeze the query field.
    var controlRows = [];
    var searchInput = document.getElementById('spLookup');
    var searchBtn = document.getElementById('spLookupBtn');
    var codesBtn = document.getElementById('spCodesBtn');
    if (searchInput && searchBtn && codesBtn) {
      if (searchBtn.parentElement !== searchInput.parentElement) {
        controlRows.push({ kind: 'separate-authored-row' });
      }
      var inputRect = searchInput.getBoundingClientRect();
      var searchRect = searchBtn.getBoundingClientRect();
      var codesRect = codesBtn.getBoundingClientRect();
      if (searchRect.width && inputRect.width) {
        var searchCenter = (searchRect.top + searchRect.bottom) / 2;
        var inputCenter = (inputRect.top + inputRect.bottom) / 2;
        if (Math.abs(searchCenter - inputCenter) > 0.5) {
          controlRows.push({
            kind: 'not-same-line',
            center: +searchCenter.toFixed(1),
            actionCenter: +inputCenter.toFixed(1)
          });
        }
      }
      if (codesRect.width) {
        if (codesRect.width < 43.5 || codesRect.height < 43.5) {
          controlRows.push({
            kind: 'too-small',
            w: +codesRect.width.toFixed(1),
            h: +codesRect.height.toFixed(1)
          });
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
                       w: +cel.getBoundingClientRect().width.toFixed(1),
                       // F251. The audit says these break mid-word; a 393px
                       // render of the same menu and the owner's device photo
                       // both show clean wrapping. Three numbers settle which
                       // page each is looking at: the label's own box, its
                       // parent's box, and the computed font size. If they
                       // disagree with the render, the audit is measuring a
                       // state no reader ever sees.
                       fs: +parseFloat(getComputedStyle(cel).fontSize).toFixed(1),
                       pw: cel.parentElement
                         ? +cel.parentElement.getBoundingClientRect().width.toFixed(1) : -1,
                       liw: cel.closest && cel.closest('li')
                         ? +cel.closest('li').getBoundingClientRect().width.toFixed(1) : -1,
                       lines: rows.length,
                       // F251. A character Range and a word Range can disagree
                       // at a soft wrap boundary. The screenshot paints the
                       // word, so record the browser's rectangles for each
                       // WHOLE word beside the per-character line assignment.
                       // One rect means the word painted intact; two means it
                       // genuinely crossed the line.
                       wordRects: (function () {
                         var out = [], wt = document.createTreeWalker(
                           cel, NodeFilter.SHOW_TEXT, null), wn;
                         while ((wn = wt.nextNode())) {
                           var text = wn.nodeValue || '', wm;
                           var re = /\\S+/g;
                           while ((wm = re.exec(text))) {
                             var wr = document.createRange();
                             wr.setStart(wn, wm.index);
                             wr.setEnd(wn, wm.index + wm[0].length);
                             var rs = [].slice.call(wr.getClientRects())
                               .filter(function (x) { return x.width || x.height; })
                               .map(function (x) {
                                 return Math.round(x.top) + '@'
                                   + x.left.toFixed(1) + '+' + x.width.toFixed(1);
                               });
                             out.push(wm[0] + '=' + rs.join(','));
                           }
                         }
                         return out.join(' ');
                       })(),
                       // F251. What ELSE is inside the button, and how much of
                       // the 151px it takes. If the glyph plus padding leaves
                       // ~63px the label really is constrained; if it does not,
                       // the audit is measuring a layout the reader never sees.
                       sibs: (function () {
                         var out = [], pp = cel.parentElement;
                         if (!pp) return 'none';
                         for (var k = 0; k < pp.children.length; k++) {
                           var ch = pp.children[k];
                           out.push((ch.className || ch.tagName) + '='
                             + ch.getBoundingClientRect().width.toFixed(1));
                         }
                         var cs2 = getComputedStyle(pp);
                         out.push('pad=' + cs2.paddingLeft + '/' + cs2.paddingRight);
                         out.push('disp=' + cs2.display);
                         out.push('gap=' + (cs2.gap || cs2.columnGap || '-'));
                         return out.join(' ');
                       })(),
                       ww: getComputedStyle(cel).wordBreak + '/'
                         + getComputedStyle(cel).overflowWrap });
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
      // Leaflet positions marker panes with negative translated margins and
      // intentionally clips them to the map viewport during fit/zoom. Those
      // are map coordinates, not hanging-indent text; the overflow scan above
      // already excludes the same implementation detail.
      if (ke.closest && ke.closest('.leaflet-container')) continue;
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

    // F467. Shared state controls are a visual contract, not just class names.
    // Measure the actual rendered controls so a later flex rule cannot stretch
    // them across the row, clip a label, wrap one side of a joined pill, or
    // drift from the compact ordinary size or the 44px Easy-read size while
    // the DOM tests remain green.
    var sharedControls = [];
    var controls = document.querySelectorAll('.pressbtn, .twopill');
    for (var sc = 0; sc < controls.length; sc++) {
      var control = controls[sc];
      if (!control.offsetParent) continue;
      var cr = control.getBoundingClientRect();
      var ccs = getComputedStyle(control);
      var problem = [];
      var expectedControlHeight = document.documentElement.getAttribute('data-a11y') === 'on'
        ? 44 : 30;
      if (Math.abs(cr.height - expectedControlHeight) > 0.5) {
        problem.push('SHARED CONTROL SIZE height ' + cr.height.toFixed(1) + 'px');
      }
      if (control.scrollWidth > control.clientWidth + 1) problem.push('content clipped');
      if (parseFloat(ccs.flexGrow || '0') > 0) problem.push('flex-grow ' + ccs.flexGrow);
      if (cr.right > vw + 0.5 || cr.left < -0.5) problem.push('outside viewport');
      var typeEl = control.classList.contains('pressbtn')
        ? control : control.querySelector(':scope > .sortbtn');
      var typeSize = typeEl ? parseFloat(getComputedStyle(typeEl).fontSize || '0') : 0;
      var scale = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--s') || '1');
      var expectedTypeSize = 12 * scale;
      if (Math.abs(typeSize - expectedTypeSize) > 0.25) {
        problem.push('SHARED CONTROL SIZE font ' + typeSize.toFixed(1)
          + 'px, expected ' + expectedTypeSize.toFixed(1) + 'px');
      }
      if (control.classList.contains('pressbtn')) {
        if (!control.querySelector('.pressicon') || !control.querySelector('.presslabel')) {
          problem.push('missing icon or text label');
        }
      } else {
        var sides = control.querySelectorAll(':scope > .sortbtn');
        if (sides.length !== 2) problem.push(sides.length + ' pill sides');
        var top = null;
        for (var ss = 0; ss < sides.length; ss++) {
          var sr = sides[ss].getBoundingClientRect();
          if (top == null) top = sr.top;
          if (Math.abs(sr.top - top) > 1) problem.push('sides wrapped');
          if (Math.abs(sr.height - expectedControlHeight) > 0.5) {
            problem.push('side height ' + sr.height.toFixed(1) + 'px');
          }
          if (sides[ss].scrollWidth > sides[ss].clientWidth + 1) problem.push('side clipped');
          var range = document.createRange();
          range.selectNodeContents(sides[ss]);
          var lineTops = {};
          [].slice.call(range.getClientRects()).forEach(function (line) {
            if (line.width || line.height) lineTops[Math.round(line.top)] = 1;
          });
          if (Object.keys(lineTops).length > 1) problem.push('side label wrapped');
        }
      }
      if (problem.length) {
        sharedControls.push({
          sel: chain(control), issue: problem.join(', '),
          w: +cr.width.toFixed(1), h: +cr.height.toFixed(1)
        });
      }
    }

    var vis = document.querySelector('section.panel:not([hidden])');
    var hydrated = document.querySelector('[data-f740-fixture] .cktargets');
    var metadata = null;
    if (hydrated && hydrated.offsetParent) {
      var targetBox = hydrated.getBoundingClientRect();
      var cardBox = hydrated.closest('.cklcard').getBoundingClientRect();
      var metaBox = hydrated.closest('.ckmeta').getBoundingClientRect();
      metadata = {
        text: hydrated.textContent,
        targetRight: targetBox.right, metadataRight: metaBox.right,
        cardRight: cardBox.right, viewportRight: vw,
        whiteSpace: getComputedStyle(hydrated).whiteSpace
      };
    }
    var favoriteMap = null;
    var favoriteHeaders = [];
    if (label === 'sec-favResults') {
      var fm = document.getElementById('favMap'), fr = fm && fm.getBoundingClientRect();
      var smallReference = document.createElement('ul');
      smallReference.className = 'obs card-sm';
      smallReference.style.cssText = 'position:absolute;left:-10000px;visibility:hidden';
      smallReference.innerHTML = window.SpeciesCards.small({
        icon: '<span class="thumb"></span>',
        name: 'Shared small-card size reference'
      });
      document.body.appendChild(smallReference);
      var sharedSmallPhoto = smallReference.querySelector('.thumb').getBoundingClientRect();
      favoriteMap = {
        width: fr && fr.width, height: fr && fr.height,
        pins: fm ? fm.querySelectorAll('.leaflet-marker-icon').length : 0,
        controls: [].map.call(document.querySelectorAll('#favResults .favoritecard'), function (card) {
          var heading = card.querySelector(':scope > .name');
          var title = heading && heading.querySelector(':scope > .ntext');
          var button = heading && heading.querySelector(':scope > .favctl .favdel');
          var distance = heading && heading.querySelector(':scope > .hsdist');
          var br = button && button.getBoundingClientRect();
          var dr = distance && distance.getBoundingClientRect();
          var row = card.querySelector('.favspp > li:first-child > .name');
          var photo = row && row.querySelector('.thumb');
          var photoBox = photo && photo.getBoundingClientRect();
          var cardBox = card.getBoundingClientRect();
          var cardStyle = getComputedStyle(card);
          var expectedRight = cardBox.right - parseFloat(cardStyle.paddingRight)
            - parseFloat(cardStyle.borderRightWidth);
          var buttonStyle = button && getComputedStyle(button);
          return {
            inHeader: !!(button && button.closest('.name') === heading),
            geometry: {
              cardWidth: cardBox.width,
              titleClientWidth: title && title.clientWidth,
              titleScrollWidth: title && title.scrollWidth,
              buttonLeft: br && +br.left.toFixed(1),
              buttonRight: br && +br.right.toFixed(1),
              touchHeight: br && +br.height.toFixed(1),
              visibleHeight: button && +(button.querySelector('.favRemoveLabel') || button)
                .getBoundingClientRect().height.toFixed(1),
              distanceLeft: dr && +dr.left.toFixed(1),
              distanceRight: dr && +dr.right.toFixed(1),
              expectedRight: +expectedRight.toFixed(1)
            },
            betweenNameAndDistance: !!(title && br && dr
              && title.getBoundingClientRect().right <= br.left + 1
              && br.right <= dr.left + 1
              && (button.compareDocumentPosition(distance)
                & Node.DOCUMENT_POSITION_FOLLOWING)),
            distanceRight: !!(dr && Math.abs(dr.right - expectedRight) <= 1),
            distanceAligned: !!(br && dr && Math.abs(br.top - dr.top) <= 1),
            nameReadable: !!(title && title.clientWidth > 0
              && title.scrollWidth <= title.clientWidth + 1),
            exactPatch: !!(button && button.getAttribute('data-favorite-id')
              === card.getAttribute('data-favorite-id')),
            touchTarget: !!(br && br.width >= 44 && br.height >= 44),
            compactVisible: !!(button && button.querySelector('.favRemoveLabel')
              && button.querySelector('.favRemoveLabel').getBoundingClientRect().height
                < br.height - 1),
            noVerticalPadding: !!(buttonStyle
              && parseFloat(buttonStyle.paddingTop) <= 0.5
              && parseFloat(buttonStyle.paddingBottom) <= 0.5),
            photoMatchesSharedSmall: !photoBox || (
              Math.abs(photoBox.width - sharedSmallPhoto.width) <= 0.5
              && Math.abs(photoBox.height - sharedSmallPhoto.height) <= 0.5),
            noSpeciesRemoval: !card.querySelector('.favspp .favdel')
          };
        })
      };
      smallReference.remove();
      favoriteHeaders = [].map.call(document.querySelectorAll('#favResults .favoritecard'), function (card) {
        var title = card.querySelector('.ntext'), distance = card.querySelector('.hsdist');
        var number = card.querySelector('.hsnum'), facts = card.querySelector('.recentbox');
        var actualHeight = facts.getBoundingClientRect().top - number.getBoundingClientRect().top;
        var reference = card.cloneNode(true), action = reference.querySelector('.favctl');
        var referenceDistance = reference.querySelector('.hsdist');
        reference.querySelector('.name').appendChild(referenceDistance);
        if (action) action.remove();
        card.parentElement.appendChild(reference);
        var referenceHeight = reference.querySelector('.recentbox').getBoundingClientRect().top
          - reference.querySelector('.hsnum').getBoundingClientRect().top;
        reference.remove();
        return {
          height: actualHeight, reference: referenceHeight,
          distanceInHeader: distance.parentElement === card.querySelector('.name'),
          removalInHeader: !!card.querySelector(':scope > .name > .favctl .favdel')
            && !facts.querySelector('.favdel'),
          birdRows: facts.querySelectorAll('.favspp li').length,
          namesFit: [].every.call(facts.querySelectorAll('.favspp .ntext'), function (name) {
            var title = name.querySelector('a');
            if (!title) return false;
            var measure = document.createElement('canvas').getContext('2d');
            measure.font = getComputedStyle(title).font;
            return title.textContent.trim().split(/\\s+/).every(function (word) {
              return measure.measureText(word).width <= name.getBoundingClientRect().width + 0.5;
            });
          }),
          spacing: (function () {
            if (!facts.querySelector('.favspp > li')) return null;
            function geometry(c) {
              var text = c.querySelector('.name > .ntext').getBoundingClientRect();
              var meta = c.querySelector('.favmeta, .meta:not(:empty)').getBoundingClientRect();
              var first = c.querySelector('.sppl > li').getBoundingClientRect();
              var last = c.querySelector('.sppl > li:last-child').getBoundingClientRect();
              return {headerToFacts: meta.top - text.bottom,
                factsToBird: first.top - meta.bottom,
                birdToEnd: c.getBoundingClientRect().bottom - last.bottom,
                rowPadding: getComputedStyle(c.querySelector('.sppl > li')).paddingTop};
            }
            var favorite = geometry(card), control = card.cloneNode(true);
            var detail = control.querySelector('.recentbox');
            var meta = detail.querySelector('.favmeta'), list = detail.querySelector('.sppl');
            control.querySelector(':scope > .meta').innerHTML = meta.innerHTML;
            control.querySelector('.hslists').appendChild(list);
            list.classList.remove('favspp');
            detail.remove();
            card.parentElement.appendChild(control);
            var shared = geometry(control);
            control.remove();
            return {favorite: favorite, shared: shared};
          })(),
          titleTop: title.getBoundingClientRect().top - number.getBoundingClientRect().top,
          removalOnly: card.querySelectorAll('.favdel').length === 1
            && !!card.querySelector(':scope > .name > .favctl .favdel')
            && !facts.querySelector('.favdel') && !card.querySelector('.hsact')
            && !/Open in Maps|Open in eBird/.test(card.textContent)
        };
      });
    }
    var menuWarnings = [];
    var watchNames = [];
    var watchPhotos = [];
    if (label === 'sec-nvResults') {
      var measure = document.createElement('canvas').getContext('2d');
      watchNames = [].map.call(document.querySelectorAll('#nvResults .nvrow .ntext'), function (name) {
        measure.font = getComputedStyle(name).font;
        return {
          width: name.getBoundingClientRect().width,
          required: Math.max.apply(null, name.textContent.trim().split(/\\s+/).map(function (word) {
            return measure.measureText(word).width;
          }))
        };
      });
      watchPhotos = [].map.call(document.querySelectorAll('#nvResults .nvrow .thumb'), function (photo) {
        var box = photo.getBoundingClientRect();
        var row = photo.closest('.nvrow'), top = row.getBoundingClientRect().top;
        var button = row.querySelector('.nvdel'), action = button.getBoundingClientRect();
        var main = row.querySelector('.favmain'), text = main.getBoundingClientRect();
        var textBelow = getComputedStyle(row).display === 'grid'
          && getComputedStyle(main).gridRowStart === '2';
        var scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
        return {width: box.width, height: box.height,
          maximum: Math.min(128 * scale, innerWidth * 0.28),
          topAligned: Math.abs(box.top - top) <= 1 && Math.abs(action.top - top) <= 1
            && (textBelow ? text.top >= Math.max(box.bottom, action.bottom)
              : Math.abs(text.top - top) <= 1 && text.right <= action.left),
          usableRemove: button.textContent === 'Remove' && action.width >= 44 && action.height >= 44};
      });
    }
    var savedSearch = [];
    if (label === 'sec-favResults' || label === 'sec-nvResults') {
      var prefix = label === 'sec-favResults' ? 'fav' : 'nv';
      var input = document.getElementById(prefix + 'Search');
      var search = document.getElementById(prefix + 'SearchBtn');
      var close = document.getElementById(prefix + 'SearchClear'), hidden = close.hidden;
      [true, false].forEach(function (closed) {
        close.hidden = closed;
        var ir = input.getBoundingClientRect(), br = search.getBoundingClientRect();
        savedSearch.push({closeHidden: closed, sameLine: Math.abs(
          (ir.top + ir.bottom) / 2 - (br.top + br.bottom) / 2) <= 1,
          afterInput: br.left >= ir.right, inputWidth: ir.width,
          right: br.right, width: br.width, height: br.height});
      });
      close.hidden = hidden;
    }
    var migrationWords = [];
    if (label === 'sec-surgeBtn' || label === 'sec-bcBody') {
      var measureWord = document.createElement('canvas').getContext('2d');
      [].forEach.call(document.querySelectorAll('section.panel:not([hidden]) .birdcast-flight-label'), function (word) {
        var style = getComputedStyle(word), box = word.getBoundingClientRect();
        var range = document.createRange(); range.selectNodeContents(word);
        var lines = {};
        [].forEach.call(range.getClientRects(), function (rect) {
          if (rect.width) lines[Math.round(rect.top)] = true;
        });
        measureWord.font = style.font;
        var text = word.textContent.trim();
        var graphic = word.closest('.birdcast-alert-icon, .surgebirdcastthumb');
        var graphicStyle = getComputedStyle(graphic), graphicBox = graphic.getBoundingClientRect();
        var available = graphicBox.width - parseFloat(graphicStyle.borderLeftWidth)
          - parseFloat(graphicStyle.borderRightWidth);
        migrationWords.push({text: text, lines: Object.keys(lines).length,
          width: Math.min(box.width, available)
            - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          required: measureWord.measureText(text).width
            + (parseFloat(style.letterSpacing) || 0) * text.length});
      });
    }
    if (label === '(contents menu)') {
      ['surgeBtn', 'excBtn'].forEach(function (at) {
        var tile = document.querySelector('#menuList .toclink[data-at="' + at + '"]');
        var subtitle = tile && tile.querySelector(':scope > .tilesub:not(.tileloadnotice)');
        var warning = tile && tile.querySelector(':scope > .tileextras > .tileloadnotice');
        function textRects(el) {
          if (!el) return [];
          var range = document.createRange();
          range.selectNodeContents(el);
          return [].slice.call(range.getClientRects()).filter(function (r) {
            return r.width || r.height;
          });
        }
        var sr = textRects(subtitle), wr = textRects(warning);
        var tr = tile && tile.getBoundingClientRect();
        var subtitleBottom = sr.length ? sr[sr.length - 1].bottom : 0;
        var warningTop = wr.length ? wr[0].top : 0;
        menuWarnings.push({
          at: at,
          subtitle: subtitle && subtitle.textContent.trim(),
          warning: warning && warning.textContent.trim(),
          title: tile && tile.querySelector('.tilelabel').textContent.trim(),
          withinTile: !!(tr && sr.length
            && sr.every(function (r) {
              return r.left >= tr.left && r.right <= tr.right
                && r.top >= tr.top && r.bottom <= tr.bottom;
            }) && wr.every(function (r) {
              return r.left >= tr.left && r.right <= tr.right
                && r.top >= tr.top && r.bottom <= tr.bottom;
            })),
          withinViewportWidth: !!(sr.length
            && sr.concat(wr).every(function (r) {
              return r.left >= 0 && r.right <= vw;
            }))
        });
      });
    }
    return {
      label: label, vw: vw, n: all.length,
      sectionId: vis ? vis.id : '',
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
      unnamed: unnamed.slice(0, 10),
      controlRows: controlRows,
      sharedControls: sharedControls.slice(0, 12),
      menuWarnings: menuWarnings,
      favoriteMap: favoriteMap,
      favoriteHeaders: favoriteHeaders,
      watchNames: watchNames,
      watchPhotos: watchPhotos,
      savedSearch: savedSearch,
      migrationWords: migrationWords,
      watchRows: label === 'sec-nvResults'
        ? document.querySelectorAll('#nvResults .nvrow').length : 0,
      hydratedMetadata: metadata,
      releaseLayout: releaseLayoutChecks()
    };
  }
  async function run() {
    auditStage('run started');
    var A = window.__app, out = [];
    if (${!!process.env.AUDIT_DIAGNOSTICS}) setInterval(function () {
      var request = new XMLHttpRequest();
      request.open('POST', '/__audit-diagnostics', true);
      request.send(JSON.stringify({queue:A.fgState(), costs:A.costReport()}));
    }, 10000);
    // Geometry fixtures use warm synthetic feeds, not real-time API pacing.
    var profile = A.chaseProfile(), logic = window.BirdLogic;
    var fixtureFeeds = logic.planFeeds(profile).concat(logic.planConvoyFeeds(profile),
      logic.planSpeciesFeeds(profile, ['rudtur', 'bktgwa', 'wesgre']));
    await Promise.all(fixtureFeeds.map(function (feed) {
      var path = logic.requestUrl(feed);
      return fetch('https://api.ebird.org/v2/' + path).then(function (response) {
        return response.json();
      }).then(function (rows) { A.seedEbirdCache(path, rows); });
    }));
    A.openSetupSheet();
    out.push(scan('(F727 setup sheet)'));
    document.getElementById('setupSheetClose').click();
    A.openRegionChooser();
    var chooser = document.getElementById('regionChooser');
    chooser.scrollTop = 800;
    document.getElementById('regionChooserClose').click();
    A.openRegionChooser();
    var chooserScan = scan('(F728 region chooser)');
    var current = document.getElementById('regionChooserCurrent').getBoundingClientRect();
    var recent = document.getElementById('regionChooserRecent').getBoundingClientRect();
    var header = document.querySelector('#regionChooser .sheethead').getBoundingClientRect();
    chooserScan.regionOpening = {
      scrollTop: chooser.scrollTop,
      focus: document.activeElement.id,
      headerTop: header.top,
      currentTop: current.top,
      recentTop: recent.top,
      viewportHeight: window.innerHeight
    };
    out.push(chooserScan);
    document.getElementById('regionChooserClose').click();
    out.push(scan('(contents menu)'));
    var savedFavorites = A.getFavs();
    [false, true].forEach(function (saved) {
      A.setFavs(saved ? [{ id: 'L828', locId: 'L828', locName: 'Layout hotspot', region: 'US-WA' }] : []);
      A.showSection('sec-stakeHsBtn');
      A.renderStakeHs('L828', 'Crescent Lake Wildlife Area--Long wrapped hotspot title and river access',
        [], [], { lat: 47.7, lng: -122.1 }, undefined, 'loaded');
      var root = document.getElementById('stakeHsResults');
      var fav = root.querySelector('.stakeHsFav');
      var title = root.querySelector('.hscardhead').getBoundingClientRect();
      var favorite = fav.getBoundingClientRect();
      var identity = root.querySelector('.stakeHsIdentity').getBoundingClientRect();
      var facts = root.querySelector('.stakeHsFacts').getBoundingClientRect();
      var actions = root.querySelector('.stakeHsIntroActions').getBoundingClientRect();
      var detailScan = scan('(F828 hotspot favorite ' + (saved ? 'Remove' : 'Add') + ')');
      detailScan.hotspotFavorite = {
        saved: saved, pressed: fav.getAttribute('aria-pressed'),
        titleBottom: title.bottom, favoriteTop: favorite.top, favoriteBottom: favorite.bottom,
        favoriteHeight: favorite.height, favoriteWidth: favorite.width,
        identityTop: identity.top, summaryBottom: facts.bottom, actionsTop: actions.top,
        ownRow: !!fav.closest('.stakeHsFavoriteRow'),
        noNavigation: !fav.parentNode.querySelector('.maplink, .extlink')
      };
      out.push(detailScan);
    });
    A.setFavs(savedFavorites);
    var secs = [].slice.call(document.querySelectorAll('section.panel'))
      .map(function (s) { return s.id; }).filter(Boolean);
    var i = 0;
    // ⚠️ F261. SAMPLED ACROSS TIME, because the bug that prompted this was
    // TRANSIENT and a single sample could not see it.
    //
    // Reported from the device with a reproduction: open Twitches today and
    // the whole page — navbar included — renders at about 80% width and left
    // aligned; pull to refresh and it is correct. Measured off the screenshot
    // at 402px: the content column is 300px, a uniform 0.746 scale. A uniform
    // scale that includes the navbar is not a card that is too narrow, it is
    // WKWebView fitting the page to something wider than the viewport — and
    // once the content settles and the wide thing is gone, it fits again.
    //
    // The audit scanned ONCE, 350 ms after opening, and reported "nothing
    // overflows" for six viewports while this shipped. It was measuring a
    // moment, not the section. A CHECK THAT LOOKS ONCE CANNOT SEE A FLICKER.
    var TICKS = [80, 350, 1200];
    function step() {
      if (i >= secs.length) return finalFixtures();
      var id = secs[i++];
      auditStage('section ' + id);
      try { A.showSection(id); } catch (e) { return step(); }
      var fixtureReady = Promise.resolve();
      if (id === 'sec-excBtn') {
        var trip = document.createElement('ul');
        trip.className = 'obs dest';
        document.getElementById(id).appendChild(trip);
        var fixture = document.createElement('li');
        fixture.setAttribute('data-f740-fixture', '1');
        fixture.setAttribute('data-hsloc', 'L2');
        fixture.setAttribute('data-unseen-n', '9');
        fixture.setAttribute('data-unseen-subs', 'S9');
        fixture.setAttribute('data-unseen-codes', JSON.stringify({
          S9: ['AMEGFI ×30', 'AMEPIP ×2', 'AMRO ×18', 'BARSWA ×4',
            'BCCH ×12', 'BEKI ×3', 'BHCO ×40', 'BLJA ×8', 'BOHEWA ×16']
            .map(function (label, index) { return { code: 'fixture' + index, label: label }; })
        }));
        fixture.innerHTML = '<div class="hsckl"></div>';
        trip.appendChild(fixture);
        fixtureReady = A.hydrateHotspotChecklists(trip).catch(function (error) {
          fixture.textContent = 'Fixture hydration failed: ' + error.message;
        });
      }
      // F303 needs all three actions rendered simultaneously. Close normally
      // appears only after a search, but showing it for the audit changes no
      // layout rule and lets the row contract be measured directly.
      if (id === 'sec-spLookupBtn') {
        var close = document.getElementById('spLookupClear');
        if (close) close.hidden = false;
      }
      // showSection triggers autoLoad, which paints asynchronously. Scanning
      // immediately measures an empty panel, which cannot overflow — so the
      //early tick is not a replacement for the later ones, it is an addition.
      var worst = null, k = 0;
      function tick() {
        if (k >= TICKS.length) { out.push(worst); return step(); }
        var at = TICKS[k], prev = k ? TICKS[k - 1] : 0;
        k++;
        setTimeout(function () {
          if (id === 'sec-favResults') {
            A.setFavs([
              { id: 'L-F1', locId: 'L-F1', locName: 'Long Favorite patch name for the visible map control',
                lat: 47.65, lng: -122.29, region: 'US-WA' },
              { id: 'L-F2', locId: 'L-F2', locName: 'Distant Favorite patch',
                lat: 47.66, lng: -122.42, region: 'US-WA' }
            ]);
            A.renderFavs();
          }
          if (id === 'sec-nvResults') {
            A.setWatchlist([
              { code: 'baisan', name: "Baird's Sandpiper" },
              { code: 'amerob', name: 'American Robin' }
            ]);
            A.renderWatch();
            var regionToggle = document.querySelector('#nvScope .nvscopebtn[aria-pressed="true"]');
            if (regionToggle) regionToggle.click();
          }
          if (id === 'sec-rankBtn') {
            var rankPair = { boards: {
              spp: {metric:'spp', period:'2026', rows:[
                {rank:1,profileId:'F811A',name:'Leaderboard fixture one',species:356,checklists:484,
                  recent:'Black-throated Gray Warbler (Oct. 1, 2026)'},
                {rank:2,profileId:'F811B',name:'Leaderboard fixture two',species:300,checklists:400}
              ]},
              cl: {metric:'cl', period:'2026', rows:[
                {rank:1,profileId:'F811C',name:'Other board fixture with a long wrapped name',species:200,checklists:800,
                  recent:'Marbled Godwit (Oct. 1, 2026)'},
                {rank:2,profileId:'F811A',name:'Leaderboard fixture one',species:356,checklists:484,
                  recent:'Black-throated Gray Warbler (Oct. 1, 2026)'}
              ]}
            },coverage:'Same-scope, same-period verified fixture boards.'};
            A.renderRankPair(rankPair,'US-WA','2026','');
            out.push(scan('(F811 Species board)'));
            document.querySelector('[data-rank-metric="cl"]').click();
            out.push(scan('(F811 Checklists board)'));
          }
          if (id === 'sec-surgeBtn') {
            var now = new Date(), pad = function (n) { return String(n).padStart(2, '0'); };
            var stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1)
              + '-' + pad(now.getDate()) + ' 00:01';
            A.setBirdcastSnapshot({
              forecast: {level: 'Medium', date: stamp.slice(0, 10)}, count: null
            });
            A.renderSurge([], [], [], [], [], {
              observations: 'ok', mega: 'ok', leaderboard: 'ok', hotspots: 'ok',
              favorites: 'partial', mass: 'partial',
              massCoverage: '12 of 15 candidate species; 6 of 7 daily samples; capped coverage'
            }, [], [{
              code: 'bktgwa', name: 'Black-throated Gray Warbler',
              count: 2, when: stamp, time: +now, checklistId: 'SFIXTURE',
              locId: 'L2', locName: 'Marymoor Park--Audubon Bird Loop'
            }], [{
              code: 'margod', name: 'Marbled Godwit', minCount: 600, maxCount: 750,
              evidenceCount: 3, supportingLowRows: 1, when: stamp, time: +now,
              locId: 'L257970', locName: 'Tokeland--marina', distanceMi: 125,
              insideChase: false, checklistId: 'SFLOCK',
              locations: [
                { locId: 'L257970', locName: 'Tokeland--marina', count: 750 },
                { locId: 'L257976', locName: 'Tokeland--Graveyard Spit', count: 3 }
              ]
            }]);
          }
          var s = scan(id);
          s.atMs = at;
          // WORST, not last: the widest moment is the one the reader saw.
          if (!worst || (s.items.length && s.items[0].over > (worst.items[0] ? worst.items[0].over : 0))
                     || (!worst.items.length && s.items.length)) worst = s;
          if (!worst) worst = s;
          fixtureReady.then(function () {
            if (id === 'sec-excBtn') A.setDayTripRange('from8plus');
            tick();
          });
        }, at - prev);
      }
      tick();
    }
    function finalFixtures() {
      auditStage('final fixtures');
      A.showMenu();
      var savedPeriod = localStorage.getItem(A.PERSONAL_PERIOD_KEY);
      var savedName = localStorage.getItem('ebird_display_name');
      var savedRanks = localStorage.getItem(A.RANK_CACHE_KEY);
      var sampleName = 'Sample Observer with a long display name';
      localStorage.setItem('ebird_display_name', sampleName);
      ['current', 'all'].forEach(function (mode) {
        localStorage.setItem(A.PERSONAL_PERIOD_KEY, mode);
        var period = A.personalBoardPeriod();
        ['spp', 'cl'].forEach(function (metric) {
          var me = {name:sampleName, rank:145, species:mode === 'all' ? 536 : 356,
            checklists:mode === 'all' ? 34759 : 484};
          A.rankCachePut('F812-audit-' + mode + '-' + metric, {
            region:A.activeScope().effectiveRegion, period:period, metric:metric, profile:A.bcProfile(),
            ownerRevision:A.identityRevision(), me:me, rows:[me]
          });
        });
        A.renderMenuIdentity();
        var header = scan('(F805/F812 shared header ' + mode + ')');
        var brand = document.querySelector('header .brand').getBoundingClientRect();
        var name = document.querySelector('#hdrId .hdrname').getBoundingClientRect();
        var scope = document.getElementById('hdrScope').getBoundingClientRect();
        header.personalHeader = {
          mode:mode, basis:document.getElementById('hdrScope').textContent,
          twoRows:name.top >= Math.max(brand.bottom, scope.bottom) - 1,
          nameWidth:name.width,
          periodFirst:document.querySelector('.quicksettings').children[1].classList.contains('periodpick'),
          controls:['hdrRankJump','hdrSpeciesJump','hdrChecklistJump'].map(function (id) {
            var button = document.getElementById(id), box = button.getBoundingClientRect();
            return {id:id, text:button.textContent, label:button.getAttribute('aria-label'),
              width:box.width, height:box.height, right:box.right,
              underlined:getComputedStyle(button).textDecorationLine.indexOf('underline') >= 0};
          })
        };
        out.push(header);
      });
      if (savedPeriod == null) localStorage.removeItem(A.PERSONAL_PERIOD_KEY);
      else localStorage.setItem(A.PERSONAL_PERIOD_KEY, savedPeriod);
      if (savedName == null) localStorage.removeItem('ebird_display_name');
      else localStorage.setItem('ebird_display_name', savedName);
      if (savedRanks == null) localStorage.removeItem(A.RANK_CACHE_KEY);
      else localStorage.setItem(A.RANK_CACHE_KEY, savedRanks);
      A.renderMenuIdentity();
      A.showSection('helpPanel');
      var feeds = window.BirdLogic.planSpeciesFeeds(A.chaseProfile(),
        Array.from({ length: 60 }, function (_, index) { return 'eta' + index; }));
      A.progressStage('Finding where your missing birds are', feeds.length, 2, 2,
        { feeds: feeds, work: { current: function () { return true; } } });
      A.progressDetail('Shared queue can change the estimate; useful results remain visible');
      var countdown = scan('(F749 estimated loader)');
      countdown.etaFixture = document.getElementById('loadBarText').textContent;
      out.push(countdown);
      A.progressEnd();
      var rows = Array.from({ length: 8993 }, function (_, index) {
        return { speciesCode: 'localetax' + index, comName: 'Synthetic bird ' + index,
          sciName: 'Synthetic taxon ' + index, category: 'species' };
      });
      rows.push(
        { speciesCode: 'rudtur', comName: 'Ruddy Turnstone',
          sciName: 'Arenaria interpres', category: 'species' },
        { speciesCode: 'bktgwa', comName: 'Black-throated Gray Warbler',
          sciName: 'Setophaga nigrescens', category: 'species' },
        { speciesCode: 'wesgre', comName: 'Western Grebe',
          sciName: 'Aechmophorus occidentalis', category: 'species' },
        { speciesCode: 'amerob', comName: 'American Robin',
          sciName: 'Turdus migratorius', category: 'species' },
        { speciesCode: 'baisan', comName: "Baird's Sandpiper",
          sciName: 'Calidris bairdii', category: 'species' },
        { speciesCode: 'localeaudit', comName: 'Synthetic locale bird',
          sciName: 'Synthetic localeaudit', category: 'species' },
        { speciesCode: 'localefallback',
          comName: 'Synthetic English fallback with a long name describing a bird and its habitat',
          sciName: 'Synthetic localefallback', category: 'species' }
      );
      var at = Date.now();
      Promise.all([
        A.taxonomyStore('put', 'identity:2025.0', window.BirdTaxonomy.create(rows, '2025.0')),
        A.taxonomyStore('put', 'names:2025.0:fr', {
          edition: '2025.0', locale: 'fr', at: at,
          names: { localeaudit: 'Nom francais de demonstration pour un oiseau avec une longue description de ses formes et de son habitat' }
        })
      ]).then(function () {
        localStorage.setItem('bc_taxonomy_v1', JSON.stringify({ edition: '2025.0', checkedAt: at }));
        localStorage.setItem('bc_taxa_locales_v1', JSON.stringify({ at: at,
          rows: [{ code: 'en', name: 'English' }, { code: 'fr', name: 'French (synthetic)' }] }));
        localStorage.setItem('bc_name_locale', 'fr');
        return A.restoreTaxonomyNames();
      }).then(function (restored) {
        if (!restored) throw new Error('Synthetic locale fixture did not restore.');
        var panel = document.querySelector('section.panel:not([hidden])');
        var list = document.createElement('ul');
        list.className = 'obs big xl';
        list.innerHTML = window.SpeciesCards.medium({
          name: 'Synthetic locale bird', code: 'localeaudit', distMi: 123, count: 7
        }) + window.SpeciesCards.medium({
          name: 'Synthetic fallback bird', code: 'localefallback', distMi: 12, count: 3
        });
        panel.appendChild(list);
        var locale = scan('(F736 long localized names)');
        locale.localeFixture = list.textContent;
        out.push(locale);
        A.showSection('sec-favResults');
        return A.loadFavs().then(function () {
          var favorite = scan('sec-favResults');
          favorite.populatedFixture = true;
          out.push(favorite);
          var profile = A.chaseProfile();
          A.seedChase(profile.slug, {
            t: Date.now(), rarity: false,
            fetchBaseKey: A.chaseFetchBaseKey(profile),
            geoNotableKm: window.BirdLogic.geoNotableDistKm(profile),
            speciesCodes: ['baisan', 'amerob'],
            rows: {'king-notable.json': [
              { speciesCode: 'baisan', comName: "Baird's Sandpiper",
                locName: 'Marymoor Park--Audubon Bird Loop', locId: 'L2',
                lat: 47.658, lng: -122.118, howMany: 2,
                obsDt: new Date().toISOString().slice(0, 10) + ' 08:00', subId: 'SAUDIT' },
              { speciesCode: 'amerob', comName: 'American Robin',
                locName: 'Long Favorite patch name for the visible map control', locId: 'L-F1',
                lat: 47.65, lng: -122.29, howMany: 1,
                obsDt: new Date().toISOString().slice(0, 10) + ' 07:00', subId: 'SAUDIT2' }
            ]}
          });
          A.showSection('sec-nvResults');
          return A.LOADERS.nvResults.fn();
        }).then(function (ready) {
          if (!ready || !/Marymoor Park/.test(document.getElementById('nvResults').textContent)) {
            throw new Error('Populated Watch fixture did not acquire actual details.');
          }
          var watch = scan('sec-nvResults');
          watch.populatedFixture = true;
          out.push(watch);
          A.showSection('sec-bcBody');
          ['None', 'Low', 'Medium', 'High', ''].forEach(function (level) {
            A.renderBirdcast(new Date('2026-09-10T19:00:00Z'),
              {forecast: level ? {level: level} : null, count: null});
            var migration = scan('sec-bcBody');
            migration.expectedMigrationWord = level ? level.toUpperCase() : 'LOADING';
            out.push(migration);
          });
          var profile = A.chaseProfile();
          A.seedChase(profile.slug, {
            t: Date.now(), rarity: false,
            fetchBaseKey: A.chaseFetchBaseKey(profile),
            geoNotableKm: window.BirdLogic.geoNotableDistKm(profile),
            speciesCodes: ['shtsan', 'solsan'],
            rows: {'king-notable.json': [
              { speciesCode: 'shtsan', comName: 'Sharp-tailed Sandpiper',
                sciName: 'Calidris acuminata', locName: 'Long numbered hotspot name',
                locId: 'L-TWITCH', lat: 47.7, lng: -122.2, howMany: 2,
                obsDt: new Date().toISOString().slice(0, 10) + ' 08:00',
                subId: 'S-TWITCH', obsReviewed: false, obsValid: false },
              { speciesCode: 'solsan', comName: 'Solitary Sandpiper',
                locName: 'Second hotspot', locId: 'L-TWITCH2', lat: 47.7, lng: -122.2,
                obsDt: new Date().toISOString().slice(0, 10) + ' 09:00',
                subId: 'S-TWITCH2', obsReviewed: true },
              { speciesCode: 'shtsan', comName: 'Sharp-tailed Sandpiper',
                sciName: 'Calidris acuminata', locName: 'Third hotspot',
                locId: 'L-TWITCH3', lat: 47.71, lng: -122.21, howMany: 1,
                obsDt: new Date().toISOString().slice(0, 10) + ' 10:00',
                subId: 'S-TWITCH3', obsReviewed: true, obsValid: true }
            ]}
          });
          localStorage.setItem('ebird_rarity_filters_v1', JSON.stringify({year:'all',distance:'near'}));
          localStorage.setItem('ebird_twitch_view_v1', 'grouped');
          A.showSection('sec-refreshBtn');
          A.refresh();
          return new Promise(function (resolve) { setTimeout(resolve, 1000); }).then(function () {
            var twitch = scan('(F785 F786 production grouped Twitches)');
            var controls = document.getElementById('todayControls');
            var bar = document.getElementById('todayView');
            var cards = [].slice.call(document.querySelectorAll('#results > li'));
            twitch.twitchGeometry = {
              large: document.getElementById('results').classList.contains('card-lg'),
              fullWidth: bar && Math.abs(bar.getBoundingClientRect().width
                - controls.getBoundingClientRect().width) <= 1,
              topBar: bar && bar.parentElement.firstElementChild === bar
                && bar.getBoundingClientRect().bottom
                  <= document.querySelector('.twitchhead').getBoundingClientRect().top,
              cards: cards.map(function (card) {
                var name = card.querySelector('.bcname');
                var hotspot = card.querySelector('.hscard-sm .ntext');
                var heading = card.querySelector('.bcheading');
                var primary = card.querySelector('.bcheading > .spprimary');
                var status = card.querySelector('.bcstatus');
                var places = card.querySelector('.birdreportplaces');
                var first = places && places.querySelector('.hscard-sm');
                return {
                  birdFont: name && parseFloat(getComputedStyle(name).fontSize),
                  hotspotFont: hotspot && parseFloat(getComputedStyle(hotspot).fontSize),
                  metricAligned: !!primary && Math.abs(primary.getBoundingClientRect().top
                    - heading.getBoundingClientRect().top) <= 1,
                  lowerStatus: !!status && /RARE/.test(status.textContent)
                    && status.getBoundingClientRect().top >= heading.getBoundingClientRect().bottom,
                  emptySub: !!card.querySelector('.bcsub:empty'),
                  gap: first && status ? first.getBoundingClientRect().top
                    - status.getBoundingClientRect().bottom : null,
                  rhythm: places ? parseFloat(getComputedStyle(places).marginTop) : 0
                };
              })
            };
            var todayBarRect = bar && bar.getBoundingClientRect();
            var todaySummary = controls && controls.querySelector('.twitchhead');
            var todaySummaryRect = todaySummary && todaySummary.getBoundingClientRect();
            var todayStyle = controls && getComputedStyle(controls);
            twitch.twitchControlGeometry = {
              barHeight: todayBarRect && todayBarRect.height,
              summaryGap: todayBarRect && todaySummaryRect
                ? todaySummaryRect.top - todayBarRect.bottom : null,
              marginTop: todayStyle ? parseFloat(todayStyle.marginTop) : null,
              flexGap: todayStyle ? parseFloat(todayStyle.gap) : null
            };
            out.push(twitch);
            A.setTwitchView('list');
            A.refresh();
            return new Promise(function (resolve) { setTimeout(resolve, 1000); }).then(function () {
            var megaRows = [
              { speciesCode: 'tersan', comName: 'Terek Sandpiper', sciName: 'Xenus cinereus',
                obsDt: '2026-09-24 10:00', locName: 'Long numbered hotspot name',
                locId: 'L-MEGA', lat: 47.7, lng: -122.2, subId: 'S-MEGA', howMany: 2 },
              { speciesCode: 'tersan', comName: 'Terek Sandpiper', sciName: 'Xenus cinereus',
                obsDt: '2026-09-23 09:00', locName: 'Second hotspot',
                locId: 'L-MEGA2', lat: 47.6, lng: -122.3, subId: 'S-MEGA2', howMany: 1 }
            ];
            A.setTwitchView('list');
            localStorage.setItem('ebird_mega_view_v1', 'list');
            A.showSection('sec-abaBtn');
            function paintMega() {
              A.renderAbaAlert(megaRows, 'https://ebird.org/alert/summary?sid=X',
                true, false, paintMega);
            }
            paintMega();
            var megaListAudit = scan('(F790 production Mega List)');
            var megaBar = document.getElementById('abaViewPick');
            var megaList = document.getElementById('abaReportResults');
            var megaControls = document.getElementById('abaControls');
            var megaSummary = document.getElementById('abaStatus');
            var megaFilters = megaSummary && megaSummary.nextElementSibling;
            var megaStyle = getComputedStyle(megaControls);
            var megaBarRect = megaBar.getBoundingClientRect();
            var megaSummaryRect = megaSummary.getBoundingClientRect();
            var twitchControlGeometry = twitch.twitchControlGeometry;
            megaListAudit.megaControlGeometry = {
              insideRarityControls: megaBar.parentElement === megaControls
                && megaControls.classList.contains('raritycontrols'),
              beforeSummary: megaBar.nextElementSibling === megaSummary,
              summaryBeforeFilters: !!(megaFilters
                && megaFilters.classList.contains('abascoperow')),
              barHeight: megaBarRect.height,
              twitchBarHeight: twitchControlGeometry.barHeight,
              summaryGap: megaSummaryRect.top - megaBarRect.bottom,
              twitchSummaryGap: twitchControlGeometry.summaryGap,
              marginTop: parseFloat(megaStyle.marginTop),
              twitchMarginTop: twitchControlGeometry.marginTop,
              flexGap: parseFloat(megaStyle.gap),
              twitchFlexGap: twitchControlGeometry.flexGap,
              listSelected: !!megaBar.querySelector(
                '[data-megaview="list"][aria-pressed="true"]')
            };
            function listSnapshot(list, selector, codeAttr) {
              return [].map.call(list.querySelectorAll(selector), function (card) {
                var name = card.querySelector('.megajump, .name .ntext a, .bcname a');
                var metric = card.querySelector('.spmetricstack');
                var evidence = card.querySelector('.spmetric-age');
                var alpha = card.querySelector('.spalpha');
                var megaCode = card.querySelector('[data-mega-code]');
                return {
                  code: card.getAttribute(codeAttr)
                    || card.getAttribute('data-ev-code')
                    || (megaCode && megaCode.getAttribute('data-mega-code'))
                    || (alpha && alpha.textContent.trim()) || '',
                  name: (name && name.textContent || '').replace(/\s+/g, ' ').trim(),
                  metric: (metric && metric.textContent || '').replace(/\s+/g, ' ').trim(),
                  evidence: evidence && (evidence.getAttribute('href')
                    || evidence.textContent.replace(/\s+/g, ' ').trim())
                };
              });
            }
            var originalProfile = A.getDisplayProfile();
            var profiles = ['standard', 'large', 'high-visibility'];
            A.setDisplayProfile('standard');
            megaList = document.getElementById('abaReportResults');
            var twitchList = document.getElementById('results');
            var twitchBaseline = listSnapshot(twitchList, ':scope > li.twitchcard',
              'data-species-code');
            var megaBaseline = listSnapshot(megaList, ':scope > li[data-mega-code]',
              'data-mega-code');
            var preferenceBaseline = JSON.stringify({
              twitch: localStorage.getItem('ebird_twitch_view_v1'),
              mega: localStorage.getItem('ebird_mega_view_v1'),
              filters: localStorage.getItem('ebird_rarity_filters_v1'),
              scope: A.abaScope(), sort: A.abaSort()
            });
            function profileGeometry(kind, list, selector, codeAttr, baseline, expectedCount) {
              var cards = list.querySelectorAll(selector);
              var snapshot = listSnapshot(list, selector, codeAttr);
              var codes = snapshot.map(function (item) { return item.code; });
              var repeatedCode = codes.some(function (code, index) {
                return codes.indexOf(code) !== index;
              });
              var preferencesUnchanged = preferenceBaseline === JSON.stringify({
                twitch: localStorage.getItem('ebird_twitch_view_v1'),
                mega: localStorage.getItem('ebird_mega_view_v1'),
                filters: localStorage.getItem('ebird_rarity_filters_v1'),
                scope: A.abaScope(), sort: A.abaSort()
              });
              return {
                profile: A.getDisplayProfile(),
                largeExpected: A.getDisplayProfile() === 'high-visibility',
                large: list.classList.contains('card-lg'),
                reportCount: cards.length,
                expectedReportCount: expectedCount,
                heroCount: list.querySelectorAll(':scope > li > .hero').length,
                listSelected: kind === 'mega'
                  ? !!document.querySelector(
                    '#abaViewPick [data-megaview="list"][aria-pressed="true"]')
                  : !!document.querySelector(
                    '#todayView [data-twitchview="list"][aria-pressed="true"]')
                    && A.twitchView() === 'list',
                separateReports: cards.length === expectedCount && repeatedCode,
                identityAndEvidence: snapshot.length > 0 && snapshot.every(function (item) {
                  return !!item.code && !!item.name && !!item.metric && !!item.evidence;
                }),
                profileSwitchPreserved: JSON.stringify(snapshot) === JSON.stringify(baseline)
                  && preferencesUnchanged
              };
            }
            var megaListGeometry = [], twitchListGeometry = [];
            profiles.forEach(function (profileName) {
              A.setDisplayProfile(profileName);
              megaList = document.getElementById('abaReportResults');
              megaListGeometry.push(profileGeometry('mega', megaList,
                ':scope > li[data-mega-code]', 'data-mega-code', megaBaseline, megaRows.length));
              twitchListGeometry.push(profileGeometry('twitch', twitchList,
                ':scope > li.twitchcard', 'data-species-code', twitchBaseline, 3));
            });
            A.setDisplayProfile(originalProfile);
            megaList = document.getElementById('abaReportResults');
            megaListAudit.megaListGeometry = megaListGeometry;
            megaListAudit.twitchListGeometry = twitchListGeometry;
            out.push(megaListAudit);
            document.querySelector('#abaViewPick [data-megaview="grouped"]').click();
            var mega = scan('(F790 production Mega Group)');
            megaList = document.getElementById('abaReportResults');
            var megaHost = document.getElementById('abaControls');
            megaBar = document.getElementById('abaViewPick');
            mega.megaGeometry = {
              large: megaList.classList.contains('card-lg'),
              hero: !!megaList.querySelector(':scope > li > .hero'),
              fullWidth: Math.abs(megaBar.getBoundingClientRect().width
                - megaHost.getBoundingClientRect().width) <= 1,
              topBar: megaHost.firstElementChild === megaBar,
              groupCount: megaList.querySelectorAll(':scope > li[data-mega-code]').length,
              checklists: megaList.querySelectorAll('.cklcard-sm').length,
              independentMode: A.twitchView() === 'list'
            };
            out.push(mega);
            A.showSection('sec-foyBtn');
            var foyCtx = A.foyContext(), foyNow = new Date();
            var foyDay = foyNow.getFullYear() + '-'
              + String(foyNow.getMonth() + 1).padStart(2, '0') + '-'
              + String(foyNow.getDate()).padStart(2, '0');
            var foySnapshot = A.firstYearWrite(foyCtx.region, foyCtx.year, {
              valid:true,declared:3,evidenceComplete:true,
              source:{kind:'annual-first',region:foyCtx.region,year:foyCtx.year,
                url:A.firstYearUrl(foyCtx.region),updatedAt:foyNow.toISOString()},
              rows:[
                {code:'bktgwa',name:'Black-throated Gray Warbler',sci:'Setophaga nigrescens',
                  date:foyDay,observedAt:foyDay + ' 08:00',subId:'S-FOY-1',
                  locName:'Marymoor Park--Audubon Bird Loop',locId:'L2'},
                {code:'comnig',name:'Common Nighthawk',date:foyDay,subId:'S-FOY-2'},
                {code:'gyrfal',name:'Gyrfalcon',sensitive:true,date:''}
              ]
            });
            A.renderFoy({snapshot:foySnapshot,record:null,saved:true,initial:true});
            var foy = scan('(F815 populated annual-first cards)');
            foy.foyGeometry = {
              rows:document.querySelectorAll('#foyResults .obs > li').length,
              mediumLists:document.querySelectorAll('#foyResults .card-md').length,
              largeLists:document.querySelectorAll('#foyResults .card-lg').length
            };
            if (foy.foyGeometry.rows !== 3
                || !/Date and location withheld/.test(document.getElementById('foyResults').textContent)) {
              foy.fixtureError = 'FOY layout fixture did not render dated and withheld evidence.';
            }
            out.push(foy);
            finish(out);
            });
          });
        });
      }).catch(function (error) {
        out.push({ label: 'Required locale fixture failed', fixtureError: error.message });
        finish(out);
      });
    }
    function birdGenCalls() {
      return A.costReport().filter(function (row) {
        return row.id === 'sec-surgeBtn';
      }).reduce(function (sum, row) { return sum + row.calls; }, 0);
    }
    var beforeBirdGen = birdGenCalls();
    A.showSection('sec-surgeBtn');
    var shell = document.querySelector('#surgeResults .surgesourceprogress');
    requestAnimationFrame(function () {
      var rect = shell && shell.getBoundingClientRect();
      var firstFrame = !!(rect && rect.width > 0 && rect.height > 0
        && !document.getElementById('sec-surgeBtn').hidden);
      var noEarlyRequests = birdGenCalls() === beforeBirdGen;
      requestAnimationFrame(function () {
        var frameCheck = scan('(F801 initial Bird Gen render frame)');
        frameCheck.birdGenFrame = { visibleShell: firstFrame, noEarlyRequests: noEarlyRequests };
        if (!firstFrame || !noEarlyRequests) {
          frameCheck.fixtureError = 'Bird Gen pre-acquisition frame failed: '
            + JSON.stringify(frameCheck.birdGenFrame);
        }
        out.push(frameCheck);
        document.getElementById('navBack').click();
        step();
      });
    });
  }
  function finish(out) {
    try {
      var x = new XMLHttpRequest();
      x.open('POST', '/__audit', true);
      x.setRequestHeader('Content-Type', 'text/plain');
      x.send(JSON.stringify(out));
    } catch (e) {}
  }
  var failed = false;
  function auditStage(stage) {
    var request = new XMLHttpRequest();
    request.open('POST', '/__audit-stage', true);
    request.send(stage);
  }
  function scriptFailure(message) {
    if (failed) return;
    failed = true;
    finish([{label:'(audit script failure)',fixtureError:String(message)}]);
  }
  window.addEventListener('error', function (event) {
    scriptFailure(event.message + ' at ' + event.lineno + ':' + event.colno);
  });
  window.addEventListener('unhandledrejection', function (event) {
    scriptFailure(event.reason && event.reason.message || event.reason);
  });
  document.addEventListener('DOMContentLoaded', function () { auditStage('DOMContentLoaded'); });
  window.addEventListener('load', function () {
    auditStage('window loaded');
    setTimeout(run, 700);
  });
})();
</script>`;

let onReport = null;
let auditStage = '';
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__audit-diagnostics') {
    let body = '';
    req.on('data', (data) => { body += data; });
    req.on('end', () => {
      console.error('audit diagnostics: ' + body);
      res.writeHead(204); res.end();
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/__audit-stage') {
    let body = '';
    req.on('data', (data) => { body += data; });
    req.on('end', () => {
      auditStage = body;
      res.writeHead(204); res.end();
      if (process.env.AUDIT_DIAGNOSTICS) console.error('audit stage: ' + body);
    });
    return;
  }
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
    html = html.replace(/<head(\s[^>]*)?>/i,
      (m) => m + BOOTSTRAP.replace('__PROFILE__', PROFILE));
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
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
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
    for (let i = 0; i < 50; i++) {
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
    auditStage = '';
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
    if (auditStage) {
      done([{label:'(audit timeout)',fixtureError:'Audit stalled after ' + auditStage}]);
      return;
    }
    teardown();
    if (attempt < MAX_ATTEMPTS) {
      console.error('audit did not report in ' + Math.round(TIMEOUT_MS / 1000)
        + 's — browser progress unavailable; relaunching (attempt ' + (attempt + 1)
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
    if (!report.some((r) => r.birdGenFrame && r.birdGenFrame.visibleShell
        && r.birdGenFrame.noEarlyRequests)) {
      bad++;
      console.log('   F801 FIXTURE missing the visible pre-acquisition Bird Gen frame');
    }
    if (!report.some((r) => /Estimated time remaining for this stage/.test(r.etaFixture || ''))) {
      bad++;
      console.log('   F749 FIXTURE missing a real estimated loader');
    }
    if (!report.some((r) => /Nom francais/.test(r.localeFixture || '')
        && /English fallback/.test(r.localeFixture))) {
      bad++;
      console.log('   F736 FIXTURE missing translated names and labelled fallback');
    }
    if (!report.some((r) => r.label === 'sec-favResults' && r.favoriteMap)) {
      bad++;
      console.log('   F765 FIXTURE missing the rendered Favorite map');
    }
    if (!report.some((r) => r.label === 'sec-nvResults' && r.watchRows > 0)) {
      bad++;
      console.log('   F765 FIXTURE missing rendered Watch list cards');
    }
    console.log('viewport ' + WIDTH + 'px  Display ' + PROFILE
      + ' (' + SCALE + 'x)\n');
    if (report.filter((r) => r.personalHeader).length !== 2) {
      bad++;
      console.log('   F805/F812 FIXTURE missing Current year / All time header geometry');
    }
    report.forEach((r) => {
      if (r.fixtureError) {
        bad++;
        console.log('   REQUIRED FIXTURE FAILED: ' + r.fixtureError);
        return;
      }
      console.log('== ' + r.label + ' == vw ' + r.vw + '  els ' + r.n
        + '  text ' + r.text + '  maxRight ' + r.maxRight
        + '  docScrollW ' + r.docScrollW + '  (' + (+r.over).toFixed(1) + 'px over)');
      if (r.personalHeader) {
        const header = r.personalHeader;
        if (!header.twoRows || header.nameWidth <= 0 || !header.periodFirst
            || !header.basis.includes(header.mode === 'all' ? 'Life List' : 'Year List')
            || header.controls.length !== 3
            || header.controls.some((control) => control.width < 44 || control.height < 44
              || control.right > r.vw + 0.5 || !control.underlined || !control.label)
            || !header.controls[1].text.endsWith('sp.')
            || !header.controls[2].text.endsWith('cl.')) {
          bad++;
          console.log('   F805/F812 HEADER controls, basis or two-row geometry failed: '
            + JSON.stringify(header));
        }
      }
      if (r.label === '(contents menu)') {
        var menuWarnings = r.menuWarnings || [];
        if (menuWarnings.length !== 2 || menuWarnings.some(function (warning) {
          return warning.subtitle !== (warning.at === 'surgeBtn' ? 'Talk and news' : 'Hotspot excursions')
            || warning.title !== (warning.at === 'surgeBtn' ? 'Bird Gen' : 'Day trip patches')
            || warning.warning || !warning.withinTile
            || !warning.withinViewportWidth;
        })) {
          bad++;
          console.log('   LOADING WARNING LAYOUT  ' + JSON.stringify(menuWarnings));
        }
      }
      if (r.label === 'sec-favResults') {
        console.log('   FAVORITE MAP  ' + JSON.stringify(r.favoriteMap));
        if (!r.favoriteMap || !(r.favoriteMap.width > 0)
            || !(r.favoriteMap.height >= r.favoriteMap.width / 2) || r.favoriteMap.pins < 2
            || r.favoriteMap.controls.length !== 2 || r.favoriteMap.controls.some((control) =>
              !control.inHeader || !control.betweenNameAndDistance || !control.distanceRight
                || !control.distanceAligned || !control.nameReadable || !control.exactPatch
                || !control.touchTarget || !control.compactVisible || !control.noVerticalPadding
                || !control.photoMatchesSharedSmall || !control.noSpeciesRemoval)) {
          bad++;
          console.log('   F795 FAVORITE LAYOUT CONTRACT FAILED  ' + JSON.stringify(r.favoriteMap));
        }
        console.log('   FAVORITE HEADER HEIGHTS  ' + JSON.stringify(r.favoriteHeaders));
        if (!r.favoriteHeaders.length || r.favoriteHeaders.some((header) =>
          !header.distanceInHeader || !header.removalInHeader
            || !header.namesFit || r.populatedFixture && !header.birdRows)) {
          bad++;
          console.log('   FAVORITE HEADER CONTENT FAILED  ' + JSON.stringify(r.favoriteHeaders));
        }
        if (r.favoriteHeaders.some((header) => !header.removalOnly)) {
          bad++;
          console.log('   FAVORITE REMOVAL FOOTER INCORRECT  ' + JSON.stringify(r.favoriteHeaders));
        }
        if (r.populatedFixture && r.favoriteHeaders.some((header) =>
          !header.spacing || ['headerToFacts', 'factsToBird', 'birdToEnd'].some((gap) =>
            header.spacing.favorite[gap] > header.spacing.shared[gap] + 0.5)
            || header.spacing.favorite.rowPadding !== header.spacing.shared.rowPadding)) {
          bad++;
          console.log('   FAVORITE EXTRA SPACING  ' + JSON.stringify(r.favoriteHeaders));
        }
      }
      if (r.label === 'sec-nvResults') {
        console.log('   WATCH NAME WIDTHS  ' + JSON.stringify(r.watchNames));
        if (!r.watchNames.length || r.watchNames.some((name) => name.width + 0.5 < name.required)) {
          bad++;
          console.log('   WATCH NAME CLIPPED  ' + JSON.stringify(r.watchNames));
        }
        console.log('   WATCH PHOTO SIZES  ' + JSON.stringify(r.watchPhotos));
        if (!r.watchPhotos.length || r.watchPhotos.some((photo) =>
          Math.abs(photo.width - photo.maximum) > 0.5 || Math.abs(photo.height - photo.maximum) > 0.5
            || !photo.topAligned || !photo.usableRemove)) {
          bad++;
          console.log('   WATCH PHOTO OVERSIZED  ' + JSON.stringify(r.watchPhotos));
        }
      }
      if (r.label === 'sec-favResults' || r.label === 'sec-nvResults') {
        if (r.savedSearch.length !== 2 || r.savedSearch.some((search) =>
          !search.sameLine || !search.afterInput || search.inputWidth <= 0
            || search.right > r.vw || search.width < 44 || search.height < 44)) {
          bad++;
          console.log('   SAVED SEARCH WRAPPED  ' + JSON.stringify(r.savedSearch));
        }
      }
      if (r.label === 'sec-surgeBtn' || r.label === 'sec-bcBody') {
        console.log('   MIGRATION WORD FIT  ' + JSON.stringify(r.migrationWords));
        if (!r.migrationWords.length || r.migrationWords.some((word) =>
          word.lines !== 1 || word.required > word.width + 0.5)
            || r.label === 'sec-surgeBtn' && !r.migrationWords.some((word) => word.text === 'MEDIUM')) {
          bad++;
          console.log('   MIGRATION WORD CLIPPED  ' + JSON.stringify(r.migrationWords));
        }
        if (r.expectedMigrationWord
            && !r.migrationWords.some((word) => word.text === r.expectedMigrationWord)) {
          bad++;
          console.log('   MIGRATION WORD FIXTURE MISSING  ' + r.expectedMigrationWord);
        }
      }
      // F251. The number in the command and the viewport measured inside the
      // app must be the SAME number. Desktop Chrome's classic scrollbar used
      // to consume 15px, so a run labelled 393px was actually auditing 378px
      // while iOS and the mockup generator use non-consuming overlay/hidden
      // scrollbars. That false width manufactured five mid-word breaks.
      if (r.vw !== WIDTH) {
        bad++;
        console.log('   VIEWPORT MISMATCH  requested ' + WIDTH + 'px but app measured '
          + r.vw + 'px — the harness is not testing the named device width');
      }
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
        // ⚠️ THE SELECTOR IS PART OF THE REPORT, not an optional extra.
        //
        // Without it this line says a label broke and at what width, and NOT
        // WHERE — so when a 393px render of the main menu showed the same five
        // labels wrapping cleanly at ~155px, there was no way to tell whether
        // the audit was wrong or was measuring a label in a different, narrower
        // place. Two measurements of "the same" label disagreed and neither
        // could be checked against the other. A finding you cannot locate is a
        // finding you cannot act on.
        console.log('   ' + (known ? 'mid-word (known)  ' : 'MID-WORD BREAK    ')
          + '"' + it.text + '"  broke as: ' + it.broke + '  col=' + it.w + 'px'
          + '\n        label ' + it.w + 'px  parent ' + it.pw + 'px  li ' + it.liw
          + 'px  font ' + it.fs + 'px  lines ' + it.lines + '  ' + it.ww
          + '\n        whole words: ' + it.wordRects
          + '\n        inside: ' + it.sibs
          + '\n        at ' + it.sel);
      });
      var tiny = r.small || [];
      if (tiny.length) {
        bad++;
        tiny.forEach(function (it) {
          console.log('   TAP TARGET ' + it.w + 'x' + it.h + ' < 44px  ' + it.sel);
        });
      }
      var controlRows = r.controlRows || [];
      if (controlRows.length) {
        bad++;
        controlRows.forEach(function (it) {
          if (it.kind === 'too-small') {
            console.log('   CODE CONTROL TARGET ' + it.w + 'x' + it.h
              + ' < 44px  #spCodesBtn');
          } else if (it.kind === 'separate-authored-row') {
            console.log('   BIRD SEARCH ROW #spLookup and #spLookupBtn must share '
              + 'the authored field-plus-Go row');
          } else {
            console.log('   BIRD SEARCH ROW center=' + it.center
              + ' differs from field center=' + it.actionCenter
              + '  #spLookup and #spLookupBtn must stay on one line');
          }
        });
      }
      var sharedControls = r.sharedControls || [];
      if (sharedControls.length) {
        bad++;
        sharedControls.forEach(function (it) {
          console.log('   SHARED CONTROL ' + it.issue + '  '
            + it.w + 'x' + it.h + '  ' + it.sel);
        });
      }
      var layout = r.releaseLayout;
      if (r.hotspotFavorite) {
        var hf = r.hotspotFavorite;
        console.log('   F828 FAVORITE GEOMETRY ' + JSON.stringify(hf));
        if (hf.pressed !== String(hf.saved) || !hf.ownRow || !hf.noNavigation
            || hf.favoriteHeight < 44 || hf.favoriteWidth < 44
            || hf.favoriteTop < hf.titleBottom || hf.identityTop < hf.favoriteBottom
            || hf.actionsTop < hf.summaryBottom) {
          bad++;
          console.log('   F828 favorite is not separated below title and above metadata');
        }
      }
      if (r.regionOpening) {
        console.log('   F793 REGION OPENING ' + JSON.stringify(r.regionOpening));
        if (r.regionOpening.scrollTop !== 0
            || r.regionOpening.focus !== 'regionChooserClose'
            || r.regionOpening.headerTop < 16
            || r.regionOpening.currentTop < r.regionOpening.headerTop
            || r.regionOpening.recentTop >= r.regionOpening.viewportHeight) {
          bad++;
          console.log('   F793 current/recent choices are not discoverable at sheet opening');
        }
      }
      if (r.megaControlGeometry) {
        var megaControlGeometry = r.megaControlGeometry;
        console.log('   F791 CONTROL GEOMETRY ' + JSON.stringify(megaControlGeometry));
        if (!megaControlGeometry.insideRarityControls || !megaControlGeometry.beforeSummary
            || !megaControlGeometry.summaryBeforeFilters
            || Math.abs(megaControlGeometry.barHeight - megaControlGeometry.twitchBarHeight) > 0.5
            || Math.abs(megaControlGeometry.summaryGap - megaControlGeometry.twitchSummaryGap) > 0.5
            || megaControlGeometry.marginTop !== megaControlGeometry.twitchMarginTop
            || megaControlGeometry.flexGap !== megaControlGeometry.twitchFlexGap
            || !megaControlGeometry.listSelected) {
          bad++;
          console.log('   F791 Mega List/Group outer spacing differs from Twitches');
        }
      }
      if (r.megaListGeometry) {
        var megaListGeometry = r.megaListGeometry;
        console.log('   F794 MEGA LIST GEOMETRY ' + JSON.stringify(megaListGeometry));
        if (megaListGeometry.length !== 3 || megaListGeometry.some(function (profile) {
          return profile.large !== profile.largeExpected
            || profile.heroCount !== (profile.largeExpected ? profile.reportCount : 0)
            || profile.reportCount !== profile.expectedReportCount
            || !profile.listSelected || !profile.separateReports
            || !profile.identityAndEvidence || !profile.profileSwitchPreserved;
        })) {
          bad++;
          console.log('   F794 Mega List profile/card/state contract failed');
        }
      }
      if (r.twitchListGeometry) {
        var twitchListGeometry = r.twitchListGeometry;
        console.log('   F794 TWITCHES LIST GEOMETRY ' + JSON.stringify(twitchListGeometry));
        if (twitchListGeometry.length !== 3 || twitchListGeometry.some(function (profile) {
          return profile.large !== profile.largeExpected
            || profile.heroCount !== (profile.largeExpected ? profile.reportCount : 0)
            || profile.reportCount !== profile.expectedReportCount
            || !profile.listSelected || !profile.separateReports
            || !profile.identityAndEvidence || !profile.profileSwitchPreserved;
        })) {
          bad++;
          console.log('   F794 Twitches List profile/card/state contract failed');
        }
      }
      if (r.megaGeometry) {
        var megaGeometry = r.megaGeometry;
        console.log('   F790 GEOMETRY ' + JSON.stringify(megaGeometry));
        if (!megaGeometry.large || !megaGeometry.hero || !megaGeometry.fullWidth
            || !megaGeometry.topBar || !megaGeometry.independentMode
            || megaGeometry.groupCount !== 1 || megaGeometry.checklists !== 2) {
          bad++;
          console.log('   F790 shared Mega Group/card/top-bar contract failed');
        }
        if (r.foyGeometry) {
          console.log('   F815 ADAPTIVE CARDS ' + JSON.stringify(r.foyGeometry));
        }
      }
      if (r.twitchGeometry) {
        var geometry = r.twitchGeometry;
        console.log('   F785 F786 GEOMETRY ' + JSON.stringify(geometry));
        if (!geometry.large || !geometry.fullWidth || !geometry.topBar
            || !geometry.cards.length || geometry.cards.some((card) =>
              !(card.birdFont > card.hotspotFont) || !card.metricAligned
              || !card.lowerStatus || card.emptySub || card.gap == null
              || card.gap > 9)) {
          bad++;
          console.log('   F785 F786 grouped hierarchy, metric, spacing or top-bar contract failed');
        }
      }
      if (r.sectionId === 'sec-excBtn') {
        var meta = r.hydratedMetadata;
        if (!meta) {
          bad++;
          console.log('   F740 HYDRATION missing real checklist target metadata');
        } else {
          console.log('   F740 METADATA target=' + meta.targetRight.toFixed(1)
            + ' meta=' + meta.metadataRight.toFixed(1)
            + ' card=' + meta.cardRight.toFixed(1) + ' viewport=' + meta.viewportRight
            + ' white-space=' + meta.whiteSpace);
          if (meta.targetRight > meta.cardRight + 0.5
              || meta.metadataRight > meta.viewportRight + 0.5
              || meta.whiteSpace !== 'normal') {
            bad++;
            console.log('   F740 HYDRATED species/count facts exceed their card or cannot wrap');
          }
        }
      }
      if (layout) {
        var layoutProblems = [];
        if (r.sectionId === 'sec-myYearBody' && (!layout.cardReadability || layout.cardReadability.length !== 3
            || layout.cardReadability.some(card => card.wordBroken || card.titleClipped
              || card.actions.some(action => action.clipped)))) {
          layoutProblems.push('F839 internal card readability: '
            + JSON.stringify(layout.cardReadability));
        }
        if (layout.latestBirdIcons === false) {
          layoutProblems.push('Top 100 latest-bird icons missing or larger than compact geometry');
        }
        if (!layout.reloadInline) layoutProblems.push('reload icon wrapped below heading');
        if (layout.emptyMinHeight > 0.5) {
          layoutProblems.push('empty checklist reserves ' + layout.emptyMinHeight + 'px min-height');
        }
        if (layout.ageLines !== 1
            || layout.ageHeight > layout.ageLineHeight * 1.5) {
          layoutProblems.push('12h ago wrapped');
        }
        if (!layout.metadataWrapped && layout.metadataGap < 2) {
          layoutProblems.push('checklist metadata gap is ' + layout.metadataGap.toFixed(1) + 'px');
        }
        if (layoutProblems.length) {
          bad++;
          console.log('   RELEASE LAYOUT ' + layoutProblems.join(', '));
        }
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
    if (!bad) console.log('\nnothing overflows at ' + WIDTH + 'px'
      + (PROFILE === 'standard' ? '' : ', and every tap target clears 44px'));
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
