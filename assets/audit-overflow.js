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
    localStorage.setItem('ebird_species_v2:US-WA', JSON.stringify({t:Date.now(), rows:[
      {name:'Common Ringed Plover',code:'coripl'},
      {name:'American Golden-Plover',code:'amgplo'}
    ]}));
    localStorage.setItem('ebird_species_v3:2025.0:US-WA',
      localStorage.getItem('ebird_species_v2:US-WA'));
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
      result.rankColumns = [].map.call(panel.querySelectorAll('.rankrow'), function (row) {
        var stack = row.querySelector('.rankstack'), number = stack.querySelector('.hsnum, .rankna');
        var name = row.querySelector('.ntext'), link = row.querySelector('.rankbirdline a.splink');
        return {
          rank: number ? number.textContent : stack.textContent,
          reservedWidth: stack.getBoundingClientRect().width,
          contentWidth: Math.max.apply(Math, [].map.call(stack.children, function (child) {
            return child.getBoundingClientRect().width;
          })),
          gap: name.getBoundingClientRect().left - stack.getBoundingClientRect().right,
          decoration: link && getComputedStyle(link).textDecorationLine
        };
      });
      var icons = [].slice.call(panel.querySelectorAll('.rankbirdicon .thumb'));
      var font = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
      result.latestBirdIcons = icons.length === 2 && icons.every(function (icon) {
        var box = icon.getBoundingClientRect();
        return Math.abs(box.width - 56 * font) < 0.5
          && Math.abs(box.height - 56 * font) < 0.5;
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
      var labels = control.classList.contains('pressbtn')
        ? [control, control.querySelector('.presslabel')]
        : [].slice.call(control.querySelectorAll(':scope > .sortbtn'));
      if (labels.some(function (label) {
        return label && getComputedStyle(label).textDecorationLine !== 'none';
      })) problem.push('F902 button label must not be underlined');
      var expectedControlHeight = document.documentElement.getAttribute('data-a11y') === 'on'
        ? 44 : 30;
      if (Math.abs(cr.height - expectedControlHeight) > 0.5) {
        problem.push('SHARED CONTROL SIZE height ' + cr.height.toFixed(1) + 'px');
      }
      if (control.scrollWidth > control.clientWidth + 1) problem.push('content clipped: '
        + control.scrollWidth + ' into ' + control.clientWidth + ' (' + control.textContent.trim() + ')');
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
      ['excBtn'].forEach(function (at) {
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
    var alertEvidence = [];
    var patchHeader = null;
    if (label === 'sec-destBtn' || label === 'sec-excBtn' || label === 'sec-quickBtn') {
      var patchSection = document.getElementById(label), heading = patchSection.querySelector('h2');
      var next = heading.nextElementSibling;
      while (next && getComputedStyle(next).display === 'none') next = next.nextElementSibling;
      patchHeader = {
        toolbarNext: !!next && next.matches('.modeswitch'),
        actions: !!heading.querySelector('.docbtn') && !!heading.querySelector('.refreshbtn'),
        noBoilerplate: !patchSection.querySelector('.personalCoverageBox, #dayTripLoadNotice')
      };
    }
    var categoryFilter = null;
    if (label === '(F849 selected Mass Flock)') {
      var selected = document.querySelector('#surgeResults [data-count-kind="mass"]');
      var cards = [].slice.call(document.querySelectorAll('#surgeFeed > li'));
      var visibleCards = cards.filter(function (row) { return getComputedStyle(row).display !== 'none'; });
      categoryFilter = {
        pressed: selected.getAttribute('aria-pressed') === 'true',
        emphasized: selected.classList.contains('pressbtn')
          && getComputedStyle(selected.querySelector('.presslabel')).textDecorationLine === 'none',
        checkmark: getComputedStyle(selected, '::after').content.indexOf('\u2713') >= 0,
        onlyMass: visibleCards.length > 0 && visibleCards.every(function (row) {
          return row.getAttribute('data-alert-kind') === 'mass';
        }),
        otherKindsHidden: cards.some(function (row) {
          return row.getAttribute('data-alert-kind') !== 'mass' && getComputedStyle(row).display === 'none';
        })
      };
    }
    if (label === 'sec-surgeBtn') {
      [].forEach.call(document.querySelectorAll('#surgeFeed > li'), function (card) {
        var evidence = card.querySelector('template[data-surge-evidence]');
        if (!evidence || !evidence.content.querySelector('.surgefacts')) return;
        window.__app.showExcludedSheet('birdgen-alert-evidence', 'Alert evidence', '', evidence.innerHTML);
        var facts = document.querySelector('#appSheet .surgefacts');
        var extra = facts.closest('.surgeexplainextra');
        var style = getComputedStyle(facts);
        var extraStyle = extra && getComputedStyle(extra);
        var title = card.querySelector('.surgealerttitle');
        alertEvidence.push({
          belowHeadline: !!extra && extra.firstElementChild === facts
            && !facts.closest('.name'),
          matchesExtraStyle: !!extraStyle
            && ['fontSize','lineHeight','fontFamily','fontWeight','color'].every(function (key) {
              return style[key] === extraStyle[key];
            }),
          regularInlineEvidence: style.display === 'inline' && style.fontWeight === '400'
            && [].every.call(extra.querySelectorAll('*'), function (node) {
              var evidenceStyle = getComputedStyle(node);
              return evidenceStyle.fontWeight === '400'
                && evidenceStyle.fontSize === extraStyle.fontSize
                && evidenceStyle.display !== 'block' && evidenceStyle.display !== 'inline-block';
            }),
          selectiveHeadline: !!title && getComputedStyle(title).fontWeight === '400'
            && [].every.call(title.querySelectorAll('a'), function (link) {
              var named = link.matches('.splink,.hslink,.ppte-event-link')
                || link.closest('.surgebirdname');
              return getComputedStyle(link).fontWeight === (named ? '700' : '400')
                && getComputedStyle(link).textDecorationLine === 'none';
            })
            && [].every.call(title.querySelectorAll('.surgebirdname,.splink,.hslink,.ppte-event-link'), function (bird) {
              var birdStyle = getComputedStyle(bird);
              return birdStyle.fontWeight === '700'
                && birdStyle.color === getComputedStyle(card.querySelector('.name')).color;
            }),
          noInlineRarity: !card.querySelector('.surgebirdtag'),
          checklistLabeled: [].every.call(facts.querySelectorAll('.surgeabsolute a'), function (link) {
            var id = (link.getAttribute('data-href') || '').split('/').pop();
            return !!id && link.textContent.indexOf(id) >= 0;
          })
        });
        document.querySelector('#appSheet .sheetclose').click();
      });
    }
    var menuLayout = null;
    var menuList = document.getElementById('menuList');
    if (label === '(contents menu)' && menuList && menuList.getBoundingClientRect().width) {
      var menuBox = menuList.getBoundingClientRect();
      var fullRow = menuList.querySelector('.tocgroup').getBoundingClientRect();
      var birdGen = document.getElementById('recentBirdGen');
      var birdBox = birdGen && birdGen.getBoundingClientRect();
      var jargon = menuList.querySelector('.jargontip');
      var groups = [], menuOrder = [];
      [].forEach.call(menuList.children, function (li) {
        if (li.id === 'menuShortcutsTitle' || li.classList.contains('menuShortcut')
          || li.classList.contains('menuShortcutShelf')) return;
        if (li.classList.contains('tocgroup')) groups.push(li.textContent.trim());
        var link = li.querySelector('.toclink');
        if (link) menuOrder.push(link.dataset.at);
      });
      menuLayout = {
        groups: groups.slice(0, 2),
        order: menuOrder.slice(0, 7),
        gridWidth: menuBox.width,
        fullRowWidth: fullRow.width,
        birdWidth: birdBox && birdBox.width,
        leftDifference: birdBox && birdBox.left - menuBox.left,
        gridColumns: getComputedStyle(menuList).gridTemplateColumns,
        fullWidth: !!birdBox && Math.abs(birdBox.left - menuBox.left) <= 1
          && Math.abs(birdBox.width - menuBox.width) <= 1,
        regularTiles: [].every.call(menuList.querySelectorAll('.toclink'), function (link) {
          return getComputedStyle(link.closest('li')).gridColumnEnd === 'auto';
        }),
        shortcuts: Array.from(menuList.querySelectorAll('.menuShortcut .toclink')).map(function (button) {
          return button.dataset.at;
        }).join(',') === 'destBtn,refreshBtn',
        birdGenNormal: (function () {
          var bird = menuList.querySelector(':scope > li > .toclink[data-at="surgeBtn"]');
          var normal = menuList.querySelector(':scope > li > .toclink[data-at="destBtn"]');
          return !!bird && !!normal && !bird.querySelector('.menuPinnedIcon')
            && !!bird.querySelector('.tileicon')
            && Math.abs(bird.getBoundingClientRect().width - normal.getBoundingClientRect().width) <= .5;
        })(),
        jargonBetween: !!jargon && menuList.querySelectorAll('.jargontip').length === 1
          && jargon.previousElementSibling.querySelector('[data-at="favResults"]') !== null
          && jargon.nextElementSibling.textContent.trim() === 'Bird alerts'
      };
      window.__menuFirstGroupMargin = getComputedStyle(menuList.querySelector('.tocgroup')).marginTop;
    }
    var compactShortcuts = null, emptyShortcuts = null;
    if (label === '(F1036 compact shortcuts)') {
      compactShortcuts = (function () {
        var shelf = menuList.querySelector('.menuShortcutShelf');
        var items = shelf.querySelector('.menuShortcutItems');
        var shelfBox = shelf.getBoundingClientRect();
        var itemStyle = getComputedStyle(items);
        var columns = itemStyle.gridTemplateColumns.split(' ').filter(Boolean);
        var gap = parseFloat(itemStyle.columnGap);
        var scale = parseFloat(itemStyle.getPropertyValue('--s'));
        var expectedColumns = Math.max(1, Math.min(4, Math.floor(
          (items.getBoundingClientRect().width + gap + .01) / (64 * scale + gap))));
        var colourProbe = document.createElement('span');
        colourProbe.style.color = 'var(--safe-blue)';
        document.body.appendChild(colourProbe);
        var safeBlue = getComputedStyle(colourProbe).color;
        colourProbe.remove();
        var originalButtons = Array.from(menuList.querySelectorAll(':scope > li > .toclink'));
        var originalBorder = getComputedStyle(originalButtons[0]).borderColor;
        return {
          columns: columns.length,
          expectedColumns: expectedColumns,
          checks: {
            responsive: columns.length === expectedColumns,
            fourPins: items.children.length === 4,
            shown: !shelf.hidden && !document.getElementById('menuShortcutsTitle').hidden,
            contained: shelfBox.left >= menuList.getBoundingClientRect().left - .5
              && shelfBox.right <= menuList.getBoundingClientRect().right + .5,
            originalBorders: originalButtons.every(function (button) {
              return getComputedStyle(button).borderColor === originalBorder;
            })
          },
          tiles: Array.from(items.querySelectorAll('.toclink')).map(function (button) {
            var box = button.getBoundingClientRect();
            var labelNode = button.querySelector('.tilelabel'), labelBox = labelNode.getBoundingClientRect();
            var icon = button.querySelector('.tileicon'), style = getComputedStyle(button);
            var original = menuList.querySelector(':scope > li > .toclink[data-at="' + button.dataset.at + '"]');
            var wordsIntact = Array.from(labelNode.textContent.matchAll(/\\S+/g)).every(function (match) {
              var range = document.createRange();
              range.setStart(labelNode.firstChild, match.index);
              range.setEnd(labelNode.firstChild, match.index + match[0].length);
              return range.getClientRects().length === 1;
            });
            return {
              at: button.dataset.at,
              target: box.width >= 44 && box.height >= 44,
              titleInside: labelBox.left >= box.left && labelBox.right <= box.right
                && labelBox.bottom <= box.bottom - 2,
              wordsIntact: wordsIntact,
              contained: box.left >= shelfBox.left - .5 && box.right <= shelfBox.right + .5,
              iconSize: !!original && getComputedStyle(icon).fontSize
                === getComputedStyle(original.querySelector('.tileicon')).fontSize,
              vertical: style.flexDirection === 'column' && labelBox.top >= icon.getBoundingClientRect().bottom,
              border: style.borderStyle === 'dashed' && parseFloat(style.borderTopWidth) === 3,
              colour: style.borderColor === safeBlue,
              flat: style.boxShadow === 'none',
              subtitleHidden: getComputedStyle(button.querySelector('.tilesub')).display === 'none',
              pin: !!button.querySelector('.menuPinnedIcon'),
              noExtraBadge: !button.querySelector('.menuShortcutBadge')
            };
          })
        };
      })();
    }
    if (label === '(F1039 empty shortcuts)') {
      emptyShortcuts = (function () {
        var emptyHeading = document.getElementById('menuShortcutsTitle');
        var emptyShelf = menuList.querySelector('.menuShortcutShelf');
        var firstVisible = Array.from(menuList.children).find(function (row) {
          return getComputedStyle(row).display !== 'none';
        });
        return {
          headingHidden: emptyHeading.hidden && getComputedStyle(emptyHeading).display === 'none',
          shelfHidden: emptyShelf.hidden && getComputedStyle(emptyShelf).display === 'none',
          noTiles: !menuList.querySelector('.menuShortcut'),
          noGap: emptyHeading.getBoundingClientRect().height === 0 && emptyShelf.getBoundingClientRect().height === 0
            && getComputedStyle(firstVisible).marginTop === window.__menuFirstGroupMargin,
          originalTools: menuList.querySelectorAll(':scope > li > .toclink').length > 0,
          savedEmpty: localStorage.getItem('bc_menu_shortcuts_v1') === '[]'
        };
      })();
    }
    return {
      label: label, vw: vw, n: all.length,
      menuLayout: menuLayout,
      compactShortcuts: compactShortcuts,
      emptyShortcuts: emptyShortcuts,
      alertEvidence: alertEvidence,
      patchHeader: patchHeader,
      categoryFilter: categoryFilter,
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
    var savedShortcuts = localStorage.getItem('bc_menu_shortcuts_v1');
    localStorage.setItem('bc_menu_shortcuts_v1', JSON.stringify(['destBtn', 'refreshBtn', 'spLookupBtn', 'stakeHsBtn']));
    A.showMenu();
    out.push(scan('(F1036 compact shortcuts)'));
    localStorage.setItem('bc_menu_shortcuts_v1', '[]');
    A.showMenu();
    out.push(scan('(F1039 empty shortcuts)'));
    if (savedShortcuts === null) localStorage.removeItem('bc_menu_shortcuts_v1');
    else localStorage.setItem('bc_menu_shortcuts_v1', savedShortcuts);
    A.showMenu();
    var savedFavorites = A.getFavs();
    [false, true].forEach(function (saved) {
      A.setFavs(saved ? [{ id: 'L828', locId: 'L828', locName: 'Layout hotspot', region: 'US-WA' }] : []);
      A.showSection('sec-stakeHsBtn');
      A.renderStakeHs('L828', 'Crescent Lake Wildlife Area--Long wrapped hotspot title and river access',
        [], [], { lat: 47.7, lng: -122.1 }, undefined, 'loaded');
      var root = document.getElementById('stakeHsResults');
      var fav = root.querySelector('.stakeHsFav');
      var title = root.querySelector('.hscardhead').getBoundingClientRect();
      var qrNode = root.querySelector('.hscardhead > .qrbtn');
      var qr = qrNode && qrNode.getBoundingClientRect();
      var titleText = root.querySelector('.hscardhead > .ntext').getBoundingClientRect();
      var favorite = fav.getBoundingClientRect();
      var identity = root.querySelector('.stakeHsIdentity').getBoundingClientRect();
      var facts = root.querySelector('.stakeHsFacts').getBoundingClientRect();
      var actions = root.querySelector('.stakeHsIntroActions').getBoundingClientRect();
      var detailScan = scan('(F828 hotspot favorite ' + (saved ? 'Remove' : 'Add') + ')');
      detailScan.hotspotQr = {
        inHeading: !!qrNode,
        separated: !!qr && qr.left >= titleText.right,
        rightAligned: !!qr && Math.abs(qr.right - title.right) <= 1,
        sameHeader: !!qr && qr.top >= title.top - 1 && qr.bottom <= title.bottom + 1
      };
      detailScan.hotspotFavorite = {
        saved: saved, pressed: fav.getAttribute('aria-pressed'),
        titleBottom: title.bottom, favoriteTop: favorite.top, favoriteBottom: favorite.bottom,
        favoriteHeight: favorite.height, favoriteWidth: favorite.width,
        identityTop: identity.top, identityBottom: identity.bottom,
        summaryTop: facts.top, actionsTop: actions.top, actionsBottom: actions.bottom,
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
              spp: {region:'US-WA', metric:'spp', period:'2026', rows:[
                {rank:1,profileId:'F811A',name:'Leaderboard fixture one',species:356,checklists:484,
                  recent:'Black-throated Gray Warbler (Oct. 1, 2026)'},
                {rank:2,profileId:'F811B',name:'Leaderboard fixture two',species:300,checklists:400,
                  recent:'Marbled Godwit (Oct. 1, 2026)'}
              ]},
              cl: {region:'US-WA', metric:'cl', period:'2026', rows:[
                {rank:1,profileId:'F811C',name:'Other board fixture with a long wrapped name',species:200,checklists:800,
                  recent:'Marbled Godwit (Oct. 1, 2026)'},
                {rank:2,profileId:'F811A',name:'Leaderboard fixture one',species:356,checklists:484,
                  recent:'Black-throated Gray Warbler (Oct. 1, 2026)'}
              ]}
            },failures:{},stale:{},coverage:'Same-scope, same-period verified fixture boards.'};
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
              count: 2, when: stamp, time: +now, checklistId: 'S123456789',
              locId: 'L2', locName: 'Marymoor Park--Audubon Bird Loop'
            }], [{
              code: 'margod', name: 'Marbled Godwit', minCount: 600, maxCount: 750,
              evidenceCount: 3, supportingLowRows: 1, when: stamp, time: +now,
              locId: 'L257970', locName: 'Tokeland--marina', distanceMi: 125,
              found: { day: stamp.slice(0, 10), days: 0 },
              insideChase: false, checklistId: 'SFLOCK',
              locations: [
                { locId: 'L257970', locName: 'Tokeland--marina', count: 750 },
                { locId: 'L257976', locName: 'Tokeland--Graveyard Spit', count: 3 }
              ]
            }]);
            var massToggle = document.querySelector('#surgeResults [data-count-kind="mass"]');
            massToggle.click();
            out.push(scan('(F849 selected Mass Flock)'));
            massToggle.click();
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
      A.showSection('sec-rankBtn');
      localStorage.setItem(A.speciesCacheKey(A.getObsRegion()), JSON.stringify({
        t:Date.now(), rows:[
          {name:'Common Ringed Plover',code:'coripl'},
          {name:'American Golden-Plover',code:'amgplo'}
        ]
      }));
      A.renderRankings({rows:[
        {rank:1,name:'Birder with a long display name',species:356,checklists:484,
          recent:'Common Ringed Plover (Oct. 1, 2026)'},
        {rank:100,name:'Another birder',species:200,checklists:800,
          recent:'American Golden-Plover (Oct. 1, 2026)'}
      ]},'US-WA','https://ebird.org/top100','');
      out.push(scan('(F851 compact Top100)'));
      var previousIdentity=localStorage.getItem(A.IDENTITY_META_KEY);
      localStorage.setItem(A.IDENTITY_META_KEY,JSON.stringify({profileId:'F857-owner'}));
      var neighborRows=[220,219,217,215,213,209,208,207,205,204,202].map(function(species,i){
        return {rank:177+i,name:i===5?'You':'Representative birder '+i,species:species,
          profileId:i===5?'F857-owner':'F857-'+i,checklists:100};
      });
      neighborRows=[
        {rank:1,name:'Top birder',species:356,checklists:484,
          recent:'Common Ringed Plover (Oct. 1, 2026)'},
        {rank:100,name:'Cutoff birder',species:250,checklists:800,
          recent:'American Golden-Plover (Oct. 1, 2026)'}
      ].concat(neighborRows);
      A.renderRankPair({boards:{spp:{region:'US-WA',period:'2026',metric:'spp',
        rows:neighborRows,me:neighborRows[7],readAt:'2026-10-09T12:00:00Z'}},
        failures:{},stale:{},coverage:'REPRESENTATIVE DATA'},
        'US-WA','2026','You');
      document.querySelector('#rankResults [data-rank-metric="spp"]').click();
      var nearbyScan=scan('(F857 compact neighbor tables)');
      var neighborPanel=document.querySelector('.ranknearby');
      nearbyScan.nearbyRows=neighborPanel.querySelectorAll(
        '[aria-label="Five birders above and below you"] tbody tr').length;
      out.push(nearbyScan);
      if(previousIdentity===null) localStorage.removeItem(A.IDENTITY_META_KEY);
      else localStorage.setItem(A.IDENTITY_META_KEY,previousIdentity);
      A.showSection('sec-destBtn');
      var wrapCard=A.hotspotCard({n:1,locId:'L-WRAP',locName:'Representative patch',
        distMi:6.1,species:[],seenSpecies:[]});
      wrapCard.querySelector('.hslists').innerHTML=A.speciesListHtml([
        {code:'wesgre',comName:'Western Grebe',count:2,dateStr:'2026-10-07 14:00',
          tag:'<span class="watchflag">WATCH</span>'},
        {code:'amepip',comName:'American Pipit',count:3,dateStr:'2026-10-08 07:21',
          tag:'<span class="watchflag">WATCH</span>'},
        {code:'gresca',comName:'Greater Scaup',count:3,dateStr:'2026-10-08 13:18',
          tag:'<span class="watchflag">WATCH</span>'}
      ]);
      document.getElementById('destResults').replaceChildren(wrapCard);
      var wrapping=scan('(F865 patch unseen names)');
      wrapping.patchNames=[].map.call(wrapCard.querySelectorAll('.ntext > a.splink'),function(link){
        var range=document.createRange();range.selectNodeContents(link);
        var lines=new Set([].map.call(range.getClientRects(),function(r){return r.top;})).size;
        var style=getComputedStyle(link), canvas=document.createElement('canvas').getContext('2d');
        canvas.font=style.fontWeight+' '+style.fontSize+' '+style.fontFamily;
        return {name:link.textContent,display:style.display,lines:lines,
          required:canvas.measureText(link.textContent).width,
          available:link.parentNode.getBoundingClientRect().width};
      });
      out.push(wrapping);
      A.showSection('sec-myYearBody');
      var yearOwner = A.personalListOwner();
      var savedYear = localStorage.getItem(A.personalListKey(yearOwner));
      var yearRows = [
        {code:'amerob',name:'American Robin',observedAt:''},
        {code:'bktgwa',name:'Black-throated Gray Warbler',observedAt:''},
        {code:'lewwoo',name:"Lewis's Woodpecker",observedAt:''}
      ];
      localStorage.setItem(A.personalListKey(yearOwner),JSON.stringify({
        owner:yearOwner,coverage:'complete',declaredCount:3,unresolved:0,paginated:false,
        codes:yearRows.map(function(row){return row.code;}),rows:yearRows,
        readAt:new Date().toISOString(),readDate:A.todayStr()
      }));
      var priorWatch = A.getWatchlist();
      A.setWatchlist([{code:'amerob',name:'American Robin'}]);
      A.updateMyYear();
      var yearScan = scan('(F874 rightmost watch column)');
      var cardReadability = ${require('./card-readability').toString()};
      yearScan.watchActions=[].map.call(document.querySelectorAll('#myYearList .myYearWatchlist'),function(button){
        var card=button.closest('li'),photo=card.querySelector('.thumb');
        var rect=button.getBoundingClientRect(),image=photo.getBoundingClientRect();
        var style=getComputedStyle(button);
        return {label:button.textContent,width:rect.width,height:rect.height,
          pressed:button.getAttribute('aria-pressed'),textAlign:style.textAlign,
          background:style.backgroundColor,color:style.color,
          right:rect.right,left:rect.left,photoRight:image.right,
          primary:button.parentElement.classList.contains('spprimary'),
          title:cardReadability(card),clipped:cardReadability(card).actions.some(function(action){return action.clipped;}),
          wordBroken:cardReadability(card).wordBroken};
      });
      out.push(yearScan);
      A.setWatchlist(priorWatch);
      if(savedYear===null)localStorage.removeItem(A.personalListKey(yearOwner));
      else localStorage.setItem(A.personalListKey(yearOwner),savedYear);
      A.showSection('sec-lastNewBtn');
      localStorage.setItem('bc_lastnew_display_v1',JSON.stringify({sort:'date'}));
      var tickEarlier = new Date(); tickEarlier.setDate(tickEarlier.getDate()-20);
      A.renderLastNew({'Western Grebe':{birders:[
        {name:'Representative with a long contributor name',profileId:'F868',rank:120,date:A.todayStr()},
        {name:'Earlier representative',profileId:'F970',rank:2,date:tickEarlier.toISOString().slice(0,10)}
      ],latest:A.todayStr()}},
        {'Western Grebe':{code:'wesgre',obs:[]}},'US-WA',{});
      var tickScan=scan('(F868 compact ticks)');
      tickScan.tickPhoto=document.querySelector('#lastNewResults .thumb').getBoundingClientRect().width;
      var tickReference=document.createElement('ul');
      tickReference.className='obs big xl';
      tickReference.innerHTML=SpeciesCards.medium({name:'Shared medium image reference',
        icon:'<span class="thumb"></span>'});
      document.getElementById('sec-lastNewBtn').appendChild(tickReference);
      tickScan.tickSharedPhoto=tickReference.querySelector('.thumb').getBoundingClientRect().width;
      tickReference.remove();
      var tickPrimary=document.querySelector('#lastNewResults .spprimary');
      tickScan.tickPrimaryOffset=A.getDisplayProfile()==='high-visibility' ? null
        : tickPrimary.getBoundingClientRect().top
          -document.querySelector('#lastNewResults .thumb').getBoundingClientRect().top;
      out.push(tickScan);
      var tickRoster = document.querySelector('#lastNewResults details.tickwho');
      if (!tickRoster || tickRoster.open) throw new Error('F970 roster must start collapsed');
      tickRoster.querySelector('summary').click();
      var expandedTicks=scan('(F970 expanded contributors)');
      expandedTicks.tickContributors={
        open:tickRoster.open,
        ranks:[].map.call(tickRoster.querySelectorAll('[data-tick-birder-rank]'),function(row){
          return row.getAttribute('data-tick-birder-rank');
        }).join(','),
        recent:tickRoster.querySelectorAll('[data-tick-recent="true"]').length,
        total:tickRoster.querySelector('[data-tick-total]').getAttribute('data-tick-total'),
        tapHeight:tickRoster.querySelector('summary').getBoundingClientRect().height,
        visibleRows:[].every.call(tickRoster.querySelectorAll('.tickcontributors > li'),function(row){
          var rect=row.getBoundingClientRect();
          return rect.height>0 && rect.left>=0 && rect.right<=expandedTicks.vw+0.5;
        })
      };
      out.push(expandedTicks);
      document.querySelector('#lastNewSort [data-ticksort="count"]').click();
      var countRoster=document.querySelector('#lastNewResults details.tickwho');
      var countTicks=scan('(F974 Count contributors)');
      countTicks.tickRankOrder=[].map.call(countRoster.querySelectorAll('[data-tick-birder-rank]'),function(row){
        return row.getAttribute('data-tick-birder-rank');
      }).join(',');
      countTicks.tickRosterOpen=countRoster.open;
      countTicks.tickMetric=document.querySelector('#lastNewResults [data-tick-metric]').getAttribute('data-tick-metric');
      out.push(countTicks);
      document.querySelector('#lastNewSort [data-ticksort="date"]').click();
      A.showSection('sec-surgeBtn');
      document.getElementById('surgeResults').innerHTML='<ul id="surgeFeed" class="obs card-sm surgefeed">'
        + A.surgeAlertCard({kind:'need',icon:window.BirdIcons.photoSlot('Western Grebe','wesgre'),
          name:'Western Grebe',code:'wesgre',when:A.todayStr(),time:Date.now(),
          why:'Representative needed bird',where:'Representative location'},0)+'</ul>';
      var birdGenScan=scan('(F873 larger left bird image)');
      birdGenScan.birdPhoto=document.querySelector('#surgeFeed .thumb').getBoundingClientRect().width;
      birdGenScan.rightIcon=document.querySelector('#surgeFeed .surgekindtile').getBoundingClientRect().width;
      out.push(birdGenScan);
      var previewNow = Date.now();
      function previewStamp(minutes) {
        var date = new Date(previewNow - minutes * 60000);
        var pad = function (value) { return String(value).padStart(2, '0'); };
        return date.getFullYear() + '-' + pad(date.getMonth()+1) + '-' + pad(date.getDate())
          + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
      }
      A.renderSurge([], [], Array.from({length:7}, function (_, i) {
        return {loc:'Representative public patch '+i,locId:'LPREVIEW'+i,observers:9,
          ratio:4,reason:'surge',latest:previewStamp(i+1)};
      }), [], [], {
        mega:'notApplicable',observations:'ok',hotspots:'ok',
        twitchRows:[{code:'verfly',name:'Vermilion Flycatcher',firstAt:previewNow-50*60000,
          reports:3,lowerBound:true,unreviewed:true,
          latest:{dateStr:previewStamp(60),loc:'Representative rarity patch',
            locId:'LTWITCHPREVIEW',lat:47.75,lon:-122.16,subId:'SPREVIEW',count:1}}]
      });
      A.showMenu();
      var recentScan=scan('(F987 Recent Bird Gen)');
      var previewRows=[].slice.call(document.querySelectorAll('#recentBirdGenRows > li'));
      var recentHeading=getComputedStyle(document.querySelector('#recentBirdGen h2'));
      var menuHeading=getComputedStyle(document.querySelector('#menuList .tocgroup'));
      var headingScale=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s'));
      recentScan.recentBirdGen={
        five:previewRows.length===5,
        headingTypography:Math.abs(parseFloat(menuHeading.fontSize)-16*headingScale)<.2
          && ['fontSize','fontWeight','color','letterSpacing','textTransform'].every(function(property){
            return recentHeading[property]===menuHeading[property];
          }),
        newestFirst:previewRows.every(function(row,i){
          var place=row.querySelector('.hslink');
          return place && place.textContent==='Representative public patch '+i;
        }),
        iconOnly:document.getElementById('recentBirdGenRefresh').textContent.trim()==='↻'
          && document.getElementById('recentBirdGenRefresh').getAttribute('aria-label')==='Refresh full Bird Gen feed',
        listOnly:!document.querySelector('#recentBirdGen > p')
          && document.getElementById('recentBirdGenStatus').classList.contains('vh')
          && document.getElementById('recentBirdGenStatus').getAttribute('aria-live')==='polite',
        outcome:!document.getElementById('recentBirdGenFeedback')
          && document.querySelectorAll('.recent-birdgen-actions button').length===2,
        actionGeometry:['recentBirdGenOpen','recentBirdGenRefresh'].map(function(id){
          var button=document.getElementById(id);
          return {id:id,rect:button.getBoundingClientRect().toJSON(),label:button.getAttribute('aria-label')};
        }),
        compactActions:['recentBirdGenOpen','recentBirdGenRefresh'].every(function(id){
          var button=document.getElementById(id), rect=button.getBoundingClientRect();
          return document.querySelector('.recent-birdgen-head').contains(button)
            && rect.height>=44 && rect.width>=44
            && rect.width<document.getElementById('recentBirdGen').getBoundingClientRect().width-1
            && button.getAttribute('aria-label');
        }),
        contentSizedAges:previewRows.every(function(row,i){
          var age=row.querySelector('.recent-birdgen-time'), original=age.innerHTML;
          var labels=['1m','59m','2h','23h','Date only','Time unknown'];
          age.textContent=labels[i];
          var range=document.createRange();range.selectNodeContents(age);
          var box=age.getBoundingClientRect(), glyph=range.getBoundingClientRect();
          var sized=Math.abs(box.width-glyph.width)<1
            && Math.abs(box.right-row.querySelector(':scope > .name').getBoundingClientRect().right)<1
            && getComputedStyle(age).textAlign==='right';
          age.innerHTML=original;
          return sized;
        }),
        geometry:previewRows.every(function(row){
          var head=row.querySelector(':scope > .name'), icon=head.firstElementChild;
          var age=head.lastElementChild, tail=age.querySelector('small');
          var rect=head.getBoundingClientRect(), photo=icon.getBoundingClientRect();
          return head.children.length===3 && Math.abs(photo.width-42)<.5
            && Math.abs(photo.height-42)<.5 && rect.height>=44 && rect.left>=0
            && rect.right<=document.documentElement.clientWidth+.5
            && parseFloat(getComputedStyle(row).paddingTop)>=3
            && parseFloat(getComputedStyle(row).paddingBottom)>=3
            && parseFloat(getComputedStyle(age).fontWeight)>=700
            && tail && tail.textContent==='ago' && getComputedStyle(tail).display==='block';
        })
      };
      var categoryFeed=document.getElementById('surgeFeed');
      var originalRows=Array.from(categoryFeed.children);
      categoryFeed.innerHTML=['favorite','ppte','foy'].map(function(kind){
        return A.surgeAlertCard({kind:kind,name:'Representative bird',
          when:previewStamp(5),time:previewNow-300000},0);
      }).join('');
      A.updateRecentBirdGen();
      var originalTheme=document.documentElement.getAttribute('data-theme');
      recentScan.recentBirdGen.evidenceThemes=['light','dark'].every(function(theme){
        A.applyTheme(theme);
        var favorite=categoryFeed.querySelector('.surgekind-favorite');
        var star=getComputedStyle(favorite);
        var previewTag=document.querySelector('#recentBirdGenRows .surgebadge-ppte');
        var fullTag=categoryFeed.querySelector('.surgebadge-ppte');
        var ppte=getComputedStyle(previewTag), full=getComputedStyle(fullTag);
        return favorite.textContent.trim().length>0 && star.color==='rgb(107, 68, 0)'
          && star.color!==star.backgroundColor && star.borderTopStyle==='double'
          && ppte.borderTopWidth==='3px' && ppte.borderTopStyle==='solid'
          && ppte.borderTopColor===full.borderTopColor
          && ppte.backgroundColor===full.backgroundColor
          && previewTag.textContent==='PATAGONIA';
      });
      A.applyTheme(originalTheme || 'light');
      categoryFeed.replaceChildren.apply(categoryFeed,originalRows);
      A.updateRecentBirdGen();
      out.push(recentScan);
      document.querySelector('#surgeFeed [data-surge-details]').click();
      out.push(scan('(F991 Alert evidence)'));
      document.querySelector('#appSheet .sheetclose').click();
      A.showMenu();
      var brandScan=scan('(F875 main menu brand)');
      brandScan.brandSize=parseFloat(getComputedStyle(document.querySelector('header .brandtext h1')).fontSize);
      out.push(brandScan);
      var savedPeriod = localStorage.getItem(A.PERSONAL_PERIOD_KEY);
      var savedName = localStorage.getItem('ebird_display_name');
      var savedRanks = localStorage.getItem(A.RANK_CACHE_KEY);
      var sampleName = 'Sample Observer with a long display name';
      localStorage.setItem('ebird_display_name', sampleName);
      ['current', 'all', 'unavailable', 'current-short', 'all-short', 'unavailable-short'].forEach(function (mode) {
        var shortName = /-short$/.test(mode);
        mode = mode.replace(/-short$/, '');
        sampleName = shortName ? 'Birder Wyatt' : 'Sample Observer with a long display name';
        localStorage.setItem('ebird_display_name', sampleName);
        localStorage.setItem(A.PERSONAL_PERIOD_KEY, mode === 'all' ? 'all' : 'current');
        var period = A.personalBoardPeriod();
        if (mode === 'unavailable') localStorage.removeItem(A.RANK_CACHE_KEY);
        ['spp', 'cl'].forEach(function (metric) {
          if (mode === 'unavailable') return;
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
        var periodButton = document.getElementById('hdrPeriod');
        var periodBox = periodButton.getBoundingClientRect();
        var identity = document.getElementById('hdrId');
        var identityBox = identity.getBoundingClientRect();
        var headerNode = document.querySelector('header');
        var compactHeight = headerNode.getBoundingClientRect().height;
        var previousInlineStyle = headerNode.getAttribute('style');
        headerNode.style.rowGap = '4px';
        headerNode.style.paddingBottom = '8px';
        var spacedHeight = headerNode.getBoundingClientRect().height;
        if (previousInlineStyle == null) headerNode.removeAttribute('style');
        else headerNode.setAttribute('style', previousInlineStyle);
        var cells = [identity.querySelector('.hdrname')].concat(
          [].slice.call(identity.querySelector('.hdrstat').children));
        var cellBoxes = cells.map(function (cell) { return cell.getBoundingClientRect(); });
        header.personalHeader = {
          mode:mode, basis:periodButton.textContent,
          region:document.getElementById('hdrScope').textContent,
          separated:periodBox.right <= scope.left && periodBox.width >= 44
            && periodBox.height >= 44 && scope.width >= 44 && scope.height >= 44,
          rowGap:identityBox.top - Math.max(brand.bottom, scope.bottom, periodBox.bottom),
          headerHeight:compactHeight, spacingControlHeight:spacedHeight,
          topBorder:parseFloat(getComputedStyle(headerNode).borderTopWidth),
          spacingSaved:spacedHeight - compactHeight,
          twoRows:name.top >= Math.max(brand.bottom, scope.bottom, periodBox.bottom) - 1,
          nameWidth:name.width,
          nameClipped:identity.querySelector('.hdrname').scrollWidth > name.width + 1,
          displayName:sampleName,
          justified: getComputedStyle(identity).justifyContent === 'space-between',
          fullWidth: Math.abs(cellBoxes[0].left - identityBox.left) < 1
            && Math.abs(Math.max.apply(null,cellBoxes.map(function(b){return b.right;}))
              - identityBox.right) < 1,
          compact: getComputedStyle(document.querySelector('header')).paddingBottom === '0px'
            && getComputedStyle(document.querySelector('header')).rowGap === '0px',
          fullCounts:[].every.call(identity.querySelectorAll('.hdrcount span'), function (span) {
            return span.scrollWidth <= span.clientWidth + 1;
          }),
          periodFirst:document.querySelector('.quicksettings').children[1].classList.contains('periodpick'),
          controls:['hdrRankJump','hdrSpeciesJump','hdrChecklistJump'].filter(function (id) {
            return !!document.getElementById(id);
          }).map(function (id) {
            var button = document.getElementById(id), box = button.getBoundingClientRect();
            return {id:id, text:button.textContent, label:button.getAttribute('aria-label'),
              width:box.width, height:box.height, right:box.right,
              underlined:getComputedStyle(button).textDecorationLine.indexOf('underline') >= 0,
              bold:parseFloat(getComputedStyle(button).fontWeight) >= 700};
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
      A.showSection('sec-surgeBtn');
      A.renderSurge([], [], [], [], [], {
        mega:'notApplicable', observations:'ok', leaderboard:'notApplicable',
        hotspots:'notApplicable', favorites:'notApplicable', mass:'notApplicable',
        foy:'notApplicable'
      });
      document.querySelector('#surgeResults .lanehelp[data-lane="feed"]').click();
      var alertKey = document.querySelector('#appSheet [data-alert-type-key]');
      if (!alertKey) throw new Error('F933 Bird Gen information button did not open its key');
      var keyScan = scan('(F933 Bird Gen alert-type key)');
      keyScan.alertKey = {
        expected:Object.keys(window.BirdInfoDialogs.alertKinds).sort(),
        actual:[].map.call(alertKey.querySelectorAll('[data-alert-key-kind]'), function (row) {
          return row.getAttribute('data-alert-key-kind');
        }).sort(),
        clipped:[].some.call(alertKey.querySelectorAll('li'), function (row) {
          return row.scrollWidth > row.clientWidth + 1;
        })
      };
      out.push(keyScan);
      document.querySelector('#appSheet .sheetclose').click();
      var ppteDate = new Date(A.todayStr() + 'T12:00:00'); ppteDate.setDate(ppteDate.getDate() - 2);
      var ppteDay = ppteDate.getFullYear() + '-' + String(ppteDate.getMonth()+1).padStart(2,'0')
        + '-' + String(ppteDate.getDate()).padStart(2,'0');
      var ppteEvidence = [];
      ['verfly','swaspa'].forEach(function(code,bird) {
        [0,1].forEach(function(person) {
          ppteEvidence.push({kind:'Rarity',code:code,
            name:bird ? 'Swamp Sparrow' : 'Vermilion Flycatcher',
            obsId:'OBS-AUDIT-' + bird + person,subId:'S' + (81001+person),
            observer:'Sample reporter ' + person,dateStr:ppteDay+' '
              + String(9+person).padStart(2,'0') + ':00',
            loc:person ? '123 Sample St SE' : 'Sample Street SE',
            lat:47+person*.00018,lon:-122});
        });
      });
      var pptePrior = new Date(ppteDate); pptePrior.setDate(pptePrior.getDate()-1);
      var pptePriorDay = pptePrior.getFullYear() + '-' + String(pptePrior.getMonth()+1).padStart(2,'0')
        + '-' + String(pptePrior.getDate()).padStart(2,'0');
      ppteEvidence.push(Object.assign({},ppteEvidence[1],{
        obsId:'OBS-AUDIT-support',subId:'S81003',observer:'Sample reporter 2',dateStr:ppteDay+' 11:00'}));
      ppteEvidence.push(Object.assign({},ppteEvidence[0],{
        obsId:'OBS-AUDIT-earlier',subId:'S81004',dateStr:pptePriorDay+' 08:00'}));
      var ppteEvents = A.ppteEvents(ppteEvidence);
      if (ppteEvents.length !== 1 || ppteEvents[0].anchorSightings !== 4) {
        throw new Error('F943 PPTE fixture must establish one Celebrity-style event');
      }
      A.renderSurge([],[],[],[],[],{ppte:'ok',ppteRows:ppteEvents});
      var ppteScan = scan('(F931 Patagonia picnic table effect)');
      var ppteCard = document.querySelector('#surgeFeed [data-alert-kind="ppte"]');
      if (!ppteCard) throw new Error('F943 qualified PPTE fixture did not render');
      var ppteTitle = ppteCard.querySelector('.surgealerttitle');
      var ppteDetails = ppteCard.querySelector('template[data-surge-evidence]').content;
      var ppteTime = ppteDetails.querySelector('.ppte-evidence time');
      var ppteDistance = ppteCard.getAttribute('data-ppte-distance');
      var ppteDistanceText = ppteDetails.querySelector('[data-ppte-distance-text]');
      ppteScan.ppte = {
        cards:document.querySelectorAll('#surgeFeed [data-alert-kind="ppte"]').length,
        species:document.querySelectorAll('#surgeFeed .surgealerttitle .splink').length,
        fullNames:!!ppteTitle && ['Swamp Sparrow','Vermilion Flycatcher','Sample Street SE']
          .every(function(name) { return ppteTitle.textContent.indexOf(name) >= 0; }),
        rareTags:ppteCard.querySelectorAll('.surgealerttitle .surgebirdtag-rare').length,
        date:!!ppteTime && ppteTime.getAttribute('datetime') === ppteDay,
        reports:[].map.call(ppteDetails.querySelectorAll('[data-ppte-report-code]'), function(row) {
          return row.getAttribute('data-ppte-report-code') + ':' + row.getAttribute('data-ppte-report-count');
        }).join(','),
        distance:ppteDistance == null || ppteDistance === '' ? !ppteDistanceText
          : !!ppteDistanceText && ppteDistanceText.textContent === Number(ppteDistance).toFixed(1)+'mi away',
        composite:ppteCard.querySelectorAll('.ppte-bird-composite > .thumb').length,
        actions:[].map.call(ppteCard.querySelectorAll('.surgealerttitle a'), function(link) {
          var rect=link.getBoundingClientRect(), text=link.firstChild, words=/[A-Za-z]+/g, match, broken=false;
          while (text && (match=words.exec(text.textContent))) {
            var range=document.createRange();
            range.setStart(text,match.index); range.setEnd(text,match.index+match[0].length);
            if (range.getClientRects().length > 1) broken=true;
          }
          return {width:rect.width,height:rect.height,tabIndex:link.tabIndex,wordBroken:broken,
            underlined:document.defaultView.getComputedStyle(link).textDecorationLine !== 'none',
            clipped:rect.left < 0 || rect.right > ppteScan.vw + 0.5};
        })
      };
      out.push(ppteScan);
      A.renderSurge([],[],[],[],[],{ppte:'ok',ppteRows:[Object.assign({},ppteEvents[0],{
        latest:previewStamp(1)
      })]});
      A.showMenu();
      var pptePreviewScan=scan('(F1021 Recent PATAGONIA links)');
      var pptePreview=document.querySelector('#recentBirdGenRows [data-recent-kind="ppte"]');
      var previewLinks=pptePreview && Array.from(pptePreview.querySelectorAll('.surgealerttitle .splink'));
      var previewAge=pptePreview && pptePreview.querySelector('button.recent-birdgen-time');
      var previewAgeStyle=previewAge && getComputedStyle(previewAge);
      if (!previewLinks || previewLinks.length!==ppteScan.ppte.species
          || pptePreview.querySelector(':scope > .name').getAttribute('role')!=='group'
          || !previewAge || previewAge.getBoundingClientRect().height<44
          || previewAge.getBoundingClientRect().width<44
          || previewAge.classList.contains('refreshbtn')
          || parseFloat(previewAgeStyle.borderTopWidth)!==0
          || parseFloat(previewAgeStyle.borderRadius)!==0
          || previewAgeStyle.backgroundColor!=='rgba(0, 0, 0, 0)'
          || getComputedStyle(previewAge.querySelector('small')).display!=='block'
          || previewLinks.some(function(link){
            var rect=link.getBoundingClientRect();
            return link.tabIndex!==0 || link.getAttribute('role')!=='link'
              || !link.getAttribute('aria-label') || !link.getAttribute('data-sp')
              || rect.width<=0 || rect.left<0 || rect.right>pptePreviewScan.vw+.5;
          })) throw new Error('F1021/F1027 Recent PATAGONIA links or plain full-alert age failed real layout: '
            + JSON.stringify({profile:A.getDisplayProfile(),links:previewLinks && previewLinks.map(function(link){
              return {code:link.getAttribute('data-sp'),role:link.getAttribute('role'),
                tabIndex:link.tabIndex,label:link.getAttribute('aria-label'),
                rect:link.getBoundingClientRect().toJSON()};
            }),group:pptePreview && pptePreview.querySelector(':scope > .name').getAttribute('role'),
            age:previewAge && previewAge.getBoundingClientRect().toJSON()}));
      pptePreviewScan.pptePreviewLinks=previewLinks.length;
      out.push(pptePreviewScan);
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
        { speciesCode: 'verfly', comName: 'Vermilion Flycatcher',
          sciName: 'Pyrocephalus rubinus', category: 'species' },
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
          A.setWatchlist([{code:'shtsan', name:'Sharp-tailed Sandpiper'},
            {code:'solsan', name:'Solitary Sandpiper'}]);
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
          localStorage.setItem('ebird_rarity_filters_v1', JSON.stringify({year:'unseen',distance:'near'}));
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
              A.showSection('sec-refreshBtn');
              out.push(watchTagCheck('#results', '(F892 Twitches ' + profileName + ')'));
              A.showSection('sec-abaBtn');
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
            var foyPhotoGeometry = [];
            profiles.forEach(function (profileName) {
              A.setDisplayProfile(profileName);
              A.showSection(document.getElementById('refreshBtn').closest('section').id);
              var twitchPhoto = document.querySelector('#results li.twitchcard .thumb');
              var twitchBox = twitchPhoto.getBoundingClientRect();
              A.showSection('sec-foyBtn');
              A.renderFoy({snapshot:foySnapshot,record:null,saved:true,initial:true});
              var foyBox = document.querySelector('#foyBirds li.twitchcard .thumb').getBoundingClientRect();
              foyPhotoGeometry.push({profile:profileName,twitchWidth:twitchBox.width,
                foyWidth:foyBox.width,twitchHeight:twitchBox.height,foyHeight:foyBox.height});
            });
            A.setDisplayProfile(originalProfile);
            foy.foyGeometry = {
              rows:document.querySelectorAll('#foyResults li.twitchcard').length,
              mediumLists:document.querySelectorAll('#foyResults .card-md').length,
              largeLists:document.querySelectorAll('#foyResults .card-lg').length,
              photoParity:foyPhotoGeometry
            };
            if (foy.foyGeometry.rows !== 3
                || !/Date and location withheld/.test(document.getElementById('foyResults').textContent)) {
              foy.fixtureError = 'FOY layout fixture did not render dated and withheld evidence.';
            }
            if (foyPhotoGeometry.some(function (p) {
              return p.foyWidth <= 0 || Math.abs(p.foyWidth-p.twitchWidth)>1
                || Math.abs(p.foyHeight-p.twitchHeight)>1;
            })) foy.fixtureError = 'FOY photo dimensions differ from Twitches.';
            out.push(foy);
            A.showMenu();
            ['county', 'aba'].forEach(function (scopeMode) {
              if (scopeMode === 'county') A.setCountyView('US-WA-033');
              else A.setActiveReport('aba');
              A.headerScopeRefresh();
              var scoped = scan('(F853 ' + scopeMode + ' shortcuts)');
              var periodNode = document.getElementById('hdrPeriod');
              var regionNode = document.getElementById('hdrScope');
              var pb = periodNode.getBoundingClientRect(), rb = regionNode.getBoundingClientRect();
              scoped.scopeHeader = {
                region:regionNode.textContent,
                expected:scopeMode === 'county' ? 'US-WA-033' : 'ABA Area',
                separate:pb.right <= rb.left,
                touch:pb.width >= 44 && pb.height >= 44 && rb.width >= 44 && rb.height >= 44,
                within:rb.right <= document.documentElement.clientWidth
              };
              out.push(scoped);
            });
            A.setActiveReport('wa');
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
  function watchTagCheck(selector, label) {
    var host = document.querySelector(selector);
    var watch = host && host.querySelector('.tag.watchflag');
    var result = scan(label);
    result.watchTag = true;
    if (!watch) throw new Error(label + ': real WATCH control missing');
    var reference = document.createElement('span');
    reference.className = 'tag';
    reference.textContent = 'WATCH';
    watch.parentElement.appendChild(reference);
    var w = getComputedStyle(watch), r = getComputedStyle(reference);
    result.watchStyle = {font:w.fontSize, reference:r.fontSize,
      decoration:w.textDecorationLine, height:watch.getBoundingClientRect().height};
    reference.remove();
    if (result.watchStyle.font !== result.watchStyle.reference || w.textDecorationLine !== 'none'
        || watch.textContent !== 'WATCH' || !watch.getAttribute('aria-label')
        || watch.tagName !== 'SPAN' || watch.closest('a,button') || watch.hasAttribute('data-sec')) {
      throw new Error(label + ': WATCH must use compact tag typography and remain non-interactive: '
        + JSON.stringify(result.watchStyle));
    }
    return result;
  }
  async function stakeoutRegression(out) {
    var A = window.__app, logic = window.BirdLogic;
    var pause = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    function require(ok, message) { if (!ok) throw new Error('F891/F896 ' + message); }
    async function until(predicate, message) {
      for (var i = 0; i < 60; i++) {
        if (predicate()) return;
        await pause(50);
      }
      throw new Error('F891 ' + message);
    }
    function visible(host) {
      return [].filter.call(host.querySelectorAll('.cklcard-sm[data-ev-sub]'),
        function (row) { return !row.hidden && row.getBoundingClientRect().height; });
    }
    function placeAnchor(row) {
      var top = document.getElementById('navbar').getBoundingClientRect().bottom + 20;
      window.scrollTo(0, window.scrollY + row.getBoundingClientRect().top - top);
      return {id:row.dataset.evSub, top:row.getBoundingClientRect().top};
    }
    function retained(host, anchor, message) {
      var row = visible(host).find(function (item) { return item.dataset.evSub === anchor.id; });
      require(row && Math.abs(row.getBoundingClientRect().top - anchor.top) <= 2,
        message + ': reading anchor ' + anchor.id + ' moved from ' + anchor.top
        + ' to ' + (row && row.getBoundingClientRect().top));
    }
    var stamp = Date.now() - 86400000;
    function observation(i, newer) {
      return {speciesCode:'verfly', comName:'Vermilion Flycatcher',
        subId:'S891-AUDIT-' + (newer ? 'NEW-' : '') + i, locId:'L891-AUDIT',
        locName:'Synthetic public locality along the river and neighboring trails',
        lat:47.8, lng:-122.16,
        obsDt:new Date(stamp + (newer ? 3600000 : 0) - i * 60000).toISOString().slice(0,19),
        howMany:1, userDisplayName:'Synthetic observer with a wrapping name ' + i,
        obsValid:true, locationPrivate:false};
    }
    var rows = Array.from({length:60}, function (_, i) { return observation(i, false); });
    var newer = Array.from({length:6}, function (_, i) { return observation(i, true); });
    rows.concat(newer).forEach(function (row) {
      A.seedEbirdCache('product/checklist/view/' + row.subId,
        {obsDt:row.obsDt, numSpecies:3, durationHrs:1, obs:[]});
    });
    A.clearSpeciesLookup();
    A.setActiveReport('wa');
    A.setCountyView('');
    A.showSection('sec-spLookupBtn');
    A.setWatchlist([{code:'verfly', name:'Vermilion Flycatcher'}]);
    var profile = A.chaseProfile();
    A.seedChase(profile.slug, {t:Date.now(), rarity:false,
      fetchBaseKey:A.chaseFetchBaseKey(profile), geoNotableKm:logic.geoNotableDistKm(profile),
      speciesCodes:['verfly'], rows:{}, cv:{merged:logic.mergeSnapshot([
        {kind:'notable', src:'synthetic', rows:rows}])}});
    var release;
    A.seedEbirdCache(A.speciesLookupPath('US-WA','verfly',A.SP_LOOKUP_BACK),
      new Promise(function (resolve) { release = resolve; }));
    var lookup = A.lookupSpecies('verfly','Vermilion Flycatcher');
    A.setSpeciesLookupGrouped(false);
    await pause(500);
    var host = document.getElementById('spLookupRecent');
    require(visible(host).length >= 10, 'held evidence must render before the late species response');
    out.push(watchTagCheck('#spLookupResults', '(F892 Stakeout large)'));
    var first = visible(host)[0], main = first.querySelector('.ckmain');
    var date = main.querySelector('.ckdate').getBoundingClientRect();
    var lead = main.querySelector('.cklead'), range = document.createRange();
    range.selectNodeContents(lead);
    var wrapped = [].filter.call(range.getClientRects(), function (rect) {
      return rect.width > 0 && rect.top > date.bottom;
    });
    var mainRect = main.getBoundingClientRect();
    var indent = parseFloat(getComputedStyle(main).fontSize);
    require(main.firstElementChild.classList.contains('ckdate')
      && main.children[1] === lead && Math.abs(date.left - mainRect.left) <= 1
      && wrapped.length > 0
      && Math.abs(Math.min.apply(null, wrapped.map(function (r) { return r.left; }))
        - mainRect.left - indent) <= 1,
      'F898 timestamp-first hanging indent geometry failed');
    var hanging = scan('(F898 timestamp-first hanging indent)');
    hanging.stakeoutHanging = {indent:indent, wrapped:wrapped.length};
    out.push(hanging);
    var measurements = [];
    for (var pass = 0; pass < 2; pass++) {
      var before = visible(host), anchor = placeAnchor(before[before.length - 1]);
      await until(function () { return visible(host).length > before.length; },
        'automatic append did not run');
      retained(host, anchor, 'automatic append ' + pass);
      measurements.push({append:pass, before:before.length, after:visible(host).length});
    }
    var expanded = visible(host);
    document.documentElement.style.overflowAnchor = 'none';
    document.body.style.overflowAnchor = 'none';
    var loadedHero = document.querySelector('#spLookupResults [data-hero]');
    loadedHero.style.aspectRatio = '0.8';
    var anchor = placeAnchor(expanded[expanded.length - 3]);
    A.renderSpeciesLookup();
    retained(host, anchor, 'immediate unchanged refresh');
    require(visible(host).length >= expanded.length, 'refresh lost expanded rows');
    await new Promise(function (resolve) { requestAnimationFrame(resolve); });
    retained(host, anchor, 'next-frame unchanged refresh');
    var refreshedHero = document.querySelector('#spLookupResults [data-hero]');
    refreshedHero.style.aspectRatio = '0.8';
    retained(host, anchor, 'F903 portrait photo settling without browser scroll anchoring');
    require(refreshedHero === loadedHero, 'F904 loaded portrait photo was replaced');
    A.setWatchlist([]);
    A.renderSpeciesLookup();
    require(document.querySelector('#spLookupResults [data-hero]') === loadedHero,
      'F904 a changed species title replaced the loaded portrait photo');
    retained(host, anchor, 'F903 changed species metadata without browser scroll anchoring');
    release(newer.concat(rows));
    await lookup;
    retained(host, anchor, 'late source prepended newer reports');
    await pause(250);
    retained(host, anchor, 'settled late-source refresh');
    A.setSpeciesLookupGrouped(true);
    var more = host.querySelector('.stakeoutChecklistMore');
    require(more, 'grouped inner expansion control missing');
    more.click();
    expanded = visible(host);
    anchor = placeAnchor(expanded[expanded.length - 2]);
    A.renderSpeciesLookup();
    retained(host, anchor, 'grouped inner expansion refresh');
    require(visible(host).length >= expanded.length, 'grouped refresh hid expanded reports');
    A.showSection('sec-nvResults');
    require(!document.getElementById('sec-nvResults').hidden, 'intentional Watch List navigation failed');
    window.scrollTo(0,0);
    A.renderSpeciesLookup();
    require(window.scrollY === 0, 'hidden Stakeout refresh undid navigation');
    A.showSection('sec-stakeHsBtn');
    document.getElementById('stakeHsClear').click();
    var patch = rows.map(function (row) {
      return {subId:row.subId, isoObsDate:row.obsDt, numSpecies:3,
        userDisplayName:row.userDisplayName, durationHrs:1};
    });
    function renderPatch(lists) {
      A.renderStakeHs('L891-AUDIT','Synthetic patch',lists,[],{},false,'loaded');
    }
    renderPatch(patch);
    document.getElementById('stakeHsShowMore').click();
    host = document.getElementById('stakeHsResults');
    expanded = visible(host);
    anchor = placeAnchor(expanded[expanded.length - 2]);
    renderPatch(newer.map(function (row) {
      return {subId:row.subId, isoObsDate:row.obsDt, numSpecies:3, durationHrs:1};
    }).concat(patch));
    retained(host, anchor, 'Patch late-prepend refresh');
    require(visible(host).length >= expanded.length + newer.length, 'Patch lost expanded prefix');
    var personal = logic.mergeSnapshot([{kind:'notable',src:'synthetic',
      rows:rows.slice(0,36)}]).map(function (row, i) {
        return Object.assign({}, row, {subId:'S900AUDIT'+i, location_private:true,
          lat:47.8+i%3/1000, lon:-122.1, loc:'Synthetic personal source '+(i%3)});
      });
    personal.forEach(function (row) {
      A.seedEbirdCache('product/checklist/view/'+row.subId,
        {obsDt:row.dateStr,numSpecies:3,durationHrs:1,obs:[]});
    });
    function nearbyPatch(records) {
      A.renderStakeHs('L900-AUDIT','Synthetic public hotspot',patch.slice(0,4),[],
        {lat:47.8,lng:-122.1},false,'loaded',null,
        {rba:[],twitches:records,rbaStatus:'loaded',twitchesStatus:'loaded'});
    }
    nearbyPatch(personal);
    host = document.getElementById('stakeHsResults');
    for (var batch=0; batch<4; batch++) {
      var nearbyMore=host.querySelector('.stakeHsNearbyMore');
      if (!nearbyMore) break;
      nearbyMore.click();
    }
    await until(function () {
      return host.querySelectorAll('.stakeHsNearbyChecklists .cklcard-sm').length === 36;
    }, 'F900 manual progressive append did not finish');
    expanded = [].slice.call(host.querySelectorAll('.stakeHsNearbyChecklists .cklcard-sm'));
    require(expanded.length === 36, 'F900 all nearby checklist batches must be available');
    anchor = placeAnchor(expanded[expanded.length-2]);
    nearbyPatch(personal.concat(personal.slice(0,6).map(function (row,i) {
      return Object.assign({},row,{subId:'S900NEW'+i,dateStr:newer[i].obsDt});
    })));
    retained(host,anchor,'nearby personal Patch late-prepend refresh');
    require(host.querySelectorAll('.stakeHsNearbyChecklists .cklcard-sm').length === 42,
      'F900 nearby refresh lost expanded prefix');
    var nearbyResult = scan('(F900 nearby personal Patch evidence)');
    nearbyResult.nearbyPatch = true;
    out.push(nearbyResult);
    for (var prefix of ['spLookup','stakeHs']) {
      A.showSection(prefix === 'spLookup' ? 'sec-spLookupBtn' : 'sec-stakeHsBtn');
      document.getElementById(prefix + 'Clear').click();
      window.scrollTo(0,0);
      var go = document.getElementById(prefix + 'Btn').getBoundingClientRect();
      var clear = document.getElementById(prefix + 'Clear').getBoundingClientRect();
      var input = document.getElementById(prefix).getBoundingClientRect();
      require(Math.abs(go.top - clear.top) <= 1 && go.width >= 44 && go.height >= 44
        && clear.width >= 44 && clear.height >= 44 && clear.right <= window.innerWidth
        && input.width >= 44 && input.left >= 0, prefix + ' inline Go/Clear geometry failed: '
          + JSON.stringify({go:go.toJSON(), clear:clear.toJSON(), input:input.toJSON()}));
      out.push(scan('(F896 ' + prefix + ' inline Clear)'));
    }
    var readingResult = scan('(F891 production reading retention)');
    readingResult.stakeoutReading = true;
    readingResult.measurements = measurements;
    out.push(readingResult);
    var sourceRows = [
      {locId:'L1029-A',locName:'Public source Alpha',lat:47.8,lng:-122.16},
      {locId:'L1029-B',locName:'Public source Beta with a longer location name',lat:47.801,lng:-122.161},
      {locId:'P1029-A',locName:'Private source one',lat:47.802,lng:-122.162,locationPrivate:true},
      {locId:'P1029-B',locName:'Private source two',lat:47.803,lng:-122.163,locationPrivate:true},
      {locId:'P1029-C',locName:'Private source two',lat:47.803,lng:-122.163,locationPrivate:true}
    ].map(function(source,index){
      return Object.assign({speciesCode:'mallar3',comName:'Mallard',
        subId:'S1029-AUDIT-'+index,obsDt:new Date(Date.now()-index*60000).toISOString().slice(0,19),
        howMany:1,obsValid:true},source);
    });
    for (var scenario of ['group','public','private']) {
      var sourceFixture=scenario==='group' ? sourceRows
        : [sourceRows[scenario==='public' ? 0 : 2]];
      A.clearSpeciesLookup();
      A.seedEbirdCache(A.speciesLookupPath('US-WA','mallar3',A.SP_LOOKUP_BACK),sourceFixture);
      A.showSection('sec-spLookupBtn');
      await A.lookupSpecies('mallar3','Mallard');
      A.setSpeciesLookupWithinChase(false);
      A.setSpeciesLookupGrouped(true);
      A.setSpeciesLookupNotes(false);
      var card=document.querySelector('#spLookupRecent .spLookupPlaceList > .hscard-md');
      require(card,'F1029 '+scenario+' fixture must render');
      var checklist=card.querySelector('.stakeoutPlaceDetails .cklcard-sm');
      require(checklist && getComputedStyle(checklist,'::before').content.indexOf('•')>=0,
        'F1029 checklist bullets must be painted');
      var members=card.querySelector('.stakeoutIncludedLocations');
      if (scenario==='group') {
        require(members && members.querySelectorAll('.hscard-sm').length===4,
          'F1029 group must show four deduplicated source rows');
        var name=members.querySelector('.hslink');
        var checklistText=checklist.querySelector('.ckmain');
        require(Math.abs(name.getBoundingClientRect().left-checklistText.getBoundingClientRect().left)<=.5,
          'F1029 location and checklist text must have matching indentation');
        var locationHeading=getComputedStyle(members.querySelector('.rankhead'));
        var checklistHeading=getComputedStyle(card.querySelector('.stakeoutPlaceDetails .rankhead'));
        require(['fontSize','fontWeight','color'].every(function(property){
          return locationHeading[property]===checklistHeading[property];
        }),'F1029 section headings must share typography');
        require(getComputedStyle(members.querySelector('.hscard-sm'),'::before').content.indexOf('•')>=0,
          'F1029 source bullets must be painted');
      } else {
        require(!members && !card.querySelector('summary'),'F1029 singleton must not repeat Locations');
        var head=card.querySelector(':scope > .name');
        require(scenario==='public' ? !!head.querySelector('.hslink')
          : !head.querySelector('.hslink') && !!head.querySelector('.privateflag')
            && !!head.querySelector('.stakeoutSourceMap'),
          'F1029 singleton source actions must preserve privacy');
      }
      window.scrollTo(0,0);
      out.push(scan('(F1029 '+scenario+' source locations)'));
    }
  }
  async function twitchRegression(out) {
    var A = window.__app, logic = window.BirdLogic, errors = [], measurements = [];
    var profileName = ${JSON.stringify(PROFILE)};
    var result = {label:'(F908 production Twitches reading retention)', measurements:measurements};
    out.push(result);
    var pause = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    var painted = function () { return new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    }); };
    async function until(fn, label) {
      for (var i = 0; i < 100; i++) {
        if (fn()) return;
        await pause(30);
      }
      throw new Error('F908 timeout: ' + label);
    }
    function check(ok, label) { if (!ok) errors.push(label); }
    function cards(host) {
      return [].filter.call(host.children, function (row) { return !!row.querySelector('.thumb[data-code]'); });
    }
    function anchor(row, atEnd) {
      var top = document.getElementById('navbar').getBoundingClientRect().bottom + 20;
      window.scrollTo(0, window.scrollY + (atEnd
        ? row.getBoundingClientRect().bottom - window.innerHeight + 200
        : row.getBoundingClientRect().top - top));
      return {node:row, photo:row.querySelector('.thumb'), code:row.querySelector('.thumb').dataset.code,
        top:row.getBoundingClientRect().top, scrollY:window.scrollY,
        sectionTop:row.closest('section').getBoundingClientRect().top + window.scrollY,
        sectionHeight:row.closest('section').getBoundingClientRect().height};
    }
    function retained(host, saved, label, identity) {
      var row = cards(host).find(function (r) { return r.querySelector('.thumb').dataset.code === saved.code; });
      var top = row && row.getBoundingClientRect().top;
      measurements.push({event:label, before:saved.top, after:top, scrollY:window.scrollY,
        beforeSectionTop:saved.sectionTop, sectionTop:host.closest('section').getBoundingClientRect().top + window.scrollY,
        beforeSectionHeight:saved.sectionHeight, sectionHeight:host.closest('section').getBoundingClientRect().height,
        sameNode:row === saved.node, samePhoto:!!row && row.querySelector('.thumb') === saved.photo});
      check(!!row && Math.abs(top - saved.top) <= 2, label + ': anchor moved ' + saved.top + ' -> ' + top);
      if (identity) check(row === saved.node && row.querySelector('.thumb') === saved.photo,
        label + ': replaced existing row/photo');
    }
    A.setActiveReport('wa'); A.setCountyView('');
    A.setRarityFilter('year','all'); A.setRarityFilter('distance','near'); A.setRaritySort('date');
    document.documentElement.style.overflowAnchor = 'none';
    document.body.style.overflowAnchor = 'none';
    var stamp = Date.now() - 3600000;
    function obs(i, newer) {
      return {speciesCode:'f908bird' + i, comName:'Synthetic rarity ' + i,
        subId:'S908AUDIT' + i + mode, locId:'L908AUDIT', locName:'Synthetic public marsh',
        lat:47.8, lng:-122.16, howMany:1, userDisplayName:'Synthetic observer ' + i,
        obsDt:new Date(stamp + (newer ? 1800000 : -i * 60000)).toISOString().slice(0,19),
        obsValid:true, locationPrivate:false};
    }
    function snapshot(raw) {
      var profile = A.chaseProfile();
      var files = {'king-notable.json':raw}, codes = raw.map(function(r){return r.speciesCode;});
      return {t:Date.now(), rarity:false, fetchBaseKey:A.chaseFetchBaseKey(profile),
        geoNotableKm:logic.geoNotableDistKm(profile), speciesCodes:codes,
        rows:files, cv:A.computeChaseRows(profile,'wa',files,codes)};
    }
    for (var mode of ['list','grouped','week']) {
      var rows = Array.from({length:45}, function (_, i) { return obs(i, false); });
      rows.forEach(function (row) {
        A.seedEbirdCache('product/checklist/view/' + row.subId,
          {obsDt:row.obsDt, durationHrs:1, obs:[{speciesCode:row.speciesCode, comments:'Synthetic short note.'}]});
      });
      A.setRarityInflight(null);
      A.seedChase('wa',snapshot(rows));
      A.setTwitchView(mode === 'grouped' ? 'grouped' : 'list');
      var week = mode === 'week', host = document.getElementById(week ? 'activeResults' : 'results');
      var button = document.getElementById(week ? 'activeBtn' : 'refreshBtn');
      var load = week ? A.loadActiveRarities : A.refresh;
      A.showSection(week ? 'sec-activeBtn' : 'sec-refreshBtn');
      load();
      await until(function () { return !button.disabled && cards(host).length >= 10; }, mode + ' initial');
      var before = cards(host), saved = anchor(before[before.length - 1],true);
      await until(function () { return cards(host).length > before.length; }, mode + ' auto append');
      await painted();
      retained(host,saved,mode + ' automatic append',true);
      var expanded = cards(host).length;
      saved = anchor(cards(host)[expanded - 3]);
      load();
      await until(function () { return !button.disabled; }, mode + ' warm refresh');
      await painted();
      retained(host,saved,mode + ' warm refresh',true);
      check(cards(host).length >= expanded, mode + ': warm refresh lost expanded prefix');

      saved = anchor(cards(host)[6]);
      A.progressStage('Synthetic source progress with a long wrapped explanation. '.repeat(4),3,1,2);
      check(Math.abs(host.closest('section').getBoundingClientRect().top + window.scrollY
        - saved.sectionTop) > 20, mode + ': progress chrome did not change geometry');
      retained(host,saved,mode + ' progress chrome wraps',true);
      A.progressEnd();
      retained(host,saved,mode + ' progress chrome settles',true);

      // Hold the actual shared source promise across frames, not a synthetic DOM replacement.
      var release;
      A.setRarityInflight(new Promise(function (resolve) { release = resolve; }));
      saved = anchor(cards(host)[Math.min(6,cards(host).length - 1)]);
      A.onRarityEarly('wa');
      await pause(100);
      retained(host,saved,mode + ' source pending',true);
      saved = anchor(cards(host)[8]);
      await pause(50);
      var releaseNote;
      A.seedChecklistView(obs(90,true).subId, new Promise(function (resolve) { releaseNote = resolve; }));
      release(snapshot([obs(90,true),obs(91,true)].concat(rows)));
      await until(function () { return !button.disabled; }, mode + ' source release');
      await pause(100);
      retained(host,saved,mode + ' source prepend',true);

      var noteCard = cards(host)[0], detail = noteCard.querySelector('details');
      if (detail) detail.open = true;
      await pause(30);
      var noteRow = noteCard.matches('[data-ev-sub]') ? noteCard : noteCard.querySelector('[data-ev-sub]');
      check(!!noteRow, mode + ': note evidence missing');
      noteRow.dataset.evShowNotes = '1';
      var hydrate = A.hydrateChecklistEvidence(noteRow);
      saved = anchor(cards(host)[6]);
      await pause(50);
      var noteHeight = noteCard.getBoundingClientRect().height;
      releaseNote({durationHrs:2, obs:[{speciesCode:'f908bird90',
        comments:'Delayed synthetic checklist evidence with a detailed description. '.repeat(12)}]});
      await hydrate;
      await until(function () { return /Delayed synthetic/.test(noteRow.textContent); }, mode + ' note paint');
      await pause(80);
      check(noteCard.getBoundingClientRect().height > noteHeight + 20, mode + ': note did not change geometry');
      retained(host,saved,mode + ' delayed checklist note',true);

      if (!week) {
        saved = anchor(cards(host)[6]);
        A.setDisplayProfile(profileName === 'standard' ? 'high-visibility' : 'standard');
        await pause(100);
        retained(host,saved,mode + ' display repaint',false);
        A.setDisplayProfile(profileName);
        await pause(50);
        if (mode === 'grouped' || profileName === 'high-visibility') {
          var hero = cards(host)[0].querySelector('[data-hero]');
          saved = anchor(cards(host)[6]);
          await pause(50);
          window.BirdIcons.fitHeroFrame(hero,{classList:{contains:function(){return false;}},
            naturalWidth:800,naturalHeight:1000});
          await pause(80);
          check(parseFloat(hero.style.aspectRatio) === 0.8, mode + ': production portrait fitting did not run');
          retained(host,saved,mode + ' delayed portrait photo',true);
        }
      }
      var removed = cards(host)[6], removedCode = removed.querySelector('.thumb').dataset.code;
      saved = anchor(removed);
      var neighbors = [cards(host)[5],cards(host)[7]].sort(function (a,b) {
        return Math.abs(a.getBoundingClientRect().top - saved.top)
          - Math.abs(b.getBoundingClientRect().top - saved.top);
      });
      var neighbor = neighbors[0], neighborSaved = {node:neighbor,photo:neighbor.querySelector('.thumb'),
        code:neighbor.querySelector('.thumb').dataset.code,top:neighbor.getBoundingClientRect().top};
      A.setRarityInflight(null);
      A.seedChase('wa',snapshot(rows.filter(function (row) { return row.speciesCode !== removedCode; })));
      load();
      await until(function () { return !button.disabled; }, mode + ' removed row refresh');
      retained(host,neighborSaved,mode + ' removed anchor keeps neighbor',true);
      A.showSection('sec-nvResults'); window.scrollTo(0,0);
      load();
      await until(function () { return !button.disabled; }, mode + ' hidden repaint');
      check(window.scrollY === 0 && !document.getElementById('sec-nvResults').hidden,
        mode + ': hidden refresh undid navigation');
    }
    for (var groupedMode of ['grouped','week']) {
      A.setRarityInflight(null);
      A.setTwitchView('grouped');
      mode = 'expanded-' + groupedMode;
      var groupRows = Array.from({length:32}, function (_,i) {
        var row = obs(i,false);
        if (i < 20) { row.speciesCode = 'f908bird0'; row.comName = 'Synthetic rarity 0'; }
        return row;
      });
      A.seedChase('wa',snapshot(groupRows));
      var weekly = groupedMode === 'week';
      var groupHost = document.getElementById(weekly ? 'activeResults' : 'results');
      var groupBtn = document.getElementById(weekly ? 'activeBtn' : 'refreshBtn');
      var groupLoad = weekly ? A.loadActiveRarities : A.refresh;
      A.showSection(weekly ? 'sec-activeBtn' : 'sec-refreshBtn'); groupLoad();
      await until(function () { return !groupBtn.disabled && groupHost.querySelector('.ckmore'); },
        mode + ' collapsed group');
      var group = cards(groupHost)[0];
      if (weekly) group.querySelector('.ckall > summary').click();
      group.querySelector('.ckmore > summary').click();
      var sub = groupRows[18].subId;
      var evidence = group.querySelector('[data-ev-sub="' + sub + '"]');
      check(!!evidence, mode + ': expanded checklist absent');
      window.scrollTo(0, window.scrollY + evidence.getBoundingClientRect().top
        - document.getElementById('navbar').getBoundingClientRect().bottom - 20);
      await pause(50);
      var evidenceTop = evidence.getBoundingClientRect().top;
      var addition = Object.assign({},groupRows[0],{subId:'S908ADDED' + mode,
        obsDt:new Date(stamp + 1800000).toISOString().slice(0,19)});
      A.seedChase('wa',snapshot([addition].concat(groupRows)));
      groupLoad();
      await until(function () { return !groupBtn.disabled; }, mode + ' new report');
      await pause(50);
      var nextEvidence = groupHost.querySelector('[data-ev-sub="' + sub + '"]');
      check(nextEvidence === evidence, mode + ': replaced existing expanded checklist');
      check(!!nextEvidence && Math.abs(nextEvidence.getBoundingClientRect().top - evidenceTop) <= 2,
        mode + ': expanded checklist reading offset changed');
      measurements.push({event:mode + ' same-bird prepend',before:evidenceTop,
        after:nextEvidence && nextEvidence.getBoundingClientRect().top,sameNode:nextEvidence === evidence});
    }
    A.setRarityInflight(null);
    Object.assign(result,scan(result.label));
    result.twitchReading = true;
    if (errors.length) result.fixtureError = errors.join('; ');
  }
  async function finish(out) {
    if (!out.some(function (result) { return result.fixtureError; })) {
      try { await stakeoutRegression(out); }
      catch (error) { out.push({label:'(Stakeout regression)', fixtureError:String(error)}); }
    }
    if (!out.some(function (result) { return result.fixtureError; })) {
      try { await twitchRegression(out); }
      catch (error) { out.push({label:'(F908 regression)', fixtureError:String(error)}); }
    }
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
    if (!report.some((r) => r.menuLayout)) {
      bad++;
      console.log('   F985 FIXTURE missing Contents grid geometry');
    }
    if (!report.some((r) => r.compactShortcuts) || !report.some((r) => r.emptyShortcuts)) {
      bad++;
      console.log('   F1036/F1039 FIXTURE missing compact or empty shortcut geometry');
    }
    const twitch = report.find((r) => r.twitchReading);
    if (!twitch) {
      bad++;
      console.log('   F908 FIXTURE missing production Twitches reading coverage');
    } else {
      console.log('   F908 measurements ' + JSON.stringify(twitch.measurements));
    }
    if (!report.some((r) => r.stakeoutReading) || !report.some((r) => r.stakeoutHanging)
        || !report.some((r) => r.nearbyPatch) || report.filter((r) => r.watchTag).length < 4) {
      bad++;
      console.log('   F891/F892 FIXTURE missing production scroll or WATCH coverage');
    }
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
    if (report.filter((r) => r.personalHeader).length !== 6) {
      bad++;
      console.log('   F805/F812 FIXTURE missing Current year / All time header geometry');
    }
    if (report.filter((r) => r.ppte).length !== 1 || report.filter((r) => r.alertKey).length !== 1) {
      bad++;
      console.log('   F931/F933 FIXTURE missing PPTE or alert-type key coverage');
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
      if (r.scopeHeader && (r.scopeHeader.region !== r.scopeHeader.expected
          || !r.scopeHeader.separate || !r.scopeHeader.touch || !r.scopeHeader.within)) {
        bad++;
        console.log('   F853 scoped shortcut geometry failed: ' + JSON.stringify(r.scopeHeader));
      }
      if (r.personalHeader) {
        const header = r.personalHeader;
        console.log('   F852/F853 HEADER GEOMETRY ' + JSON.stringify(header));
        if (!header.twoRows || header.nameWidth <= 0 || !header.periodFirst
            || !header.justified || header.nameClipped || !header.fullWidth || !header.compact || !header.fullCounts
            || header.topBorder !== 0
            || header.basis !== (header.mode === 'all' ? 'All Time' : String(new Date().getFullYear()))
            || header.region !== 'US-WA' || !header.separated || Math.abs(header.rowGap) > 1
            || Math.abs(header.spacingSaved - 12) > 1
            || header.controls.length !== (header.mode === 'unavailable' ? 2 : 3)
            || header.controls.some((control) => control.width < 44 || control.height < 44
              || control.right > r.vw + 0.5 || control.underlined || !control.bold || !control.label)
            || !header.controls.find(control => control.id === 'hdrSpeciesJump').text.endsWith('sp.')
            || !header.controls.find(control => control.id === 'hdrChecklistJump').text.endsWith('cl.')) {
          bad++;
          console.log('   F805/F812 HEADER controls, basis or two-row geometry failed: '
            + JSON.stringify(header));
        }
      }
      if (r.alertKey && (r.alertKey.clipped
            || JSON.stringify(r.alertKey.actual) !== JSON.stringify(r.alertKey.expected))) {
        bad++;
        console.log('   F933 Bird Gen key is missing categories or clips: ' + JSON.stringify(r.alertKey));
      }
      if (r.ppte && (r.ppte.cards !== 1 || r.ppte.species !== 2 || !r.ppte.fullNames
          || r.ppte.rareTags !== 0 || !r.ppte.date || r.ppte.reports !== 'swaspa:2,verfly:3'
          || !r.ppte.distance || r.ppte.composite !== 2 || r.ppte.actions.length !== 3
          || r.ppte.actions.some(action => action.width <= 0 || action.height <= 0
            || action.tabIndex !== 0 || action.underlined || action.wordBroken || action.clipped))) {
        bad++;
        console.log('   F939/F944 PPTE headline, metadata or link geometry failed: ' + JSON.stringify(r.ppte));
      }
      if(r.patchNames){
        console.log('   F865 PATCH NAME FIT '+JSON.stringify(r.patchNames));
        if(r.patchNames.length!==3 || r.patchNames.some(p=>p.required<=p.available && p.lines!==1)){
          bad++;console.log('   F865 patch names wrap before using available width');
        }
      }
        if(r.watchActions){
          console.log('   F874 WATCH GEOMETRY '+JSON.stringify(r.watchActions));
          if(r.watchActions.length!==3 || r.watchActions.some(action=>
            !action.primary || action.width<44 || action.height<44 || action.right>r.vw+.5
            || action.left<action.photoRight || action.wordBroken || action.clipped || action.title.titleClipped
            || action.textAlign!=='center' || action.color!=='rgb(255, 255, 255)'
            || action.background!==(action.pressed==='true'?'rgb(161, 38, 34)':'rgb(33, 100, 61)'))){
            bad++;console.log('   F874 watch actions must remain readable in the rightmost column');
          }
        }
        if(r.tickContributors && (!r.tickContributors.open || r.tickContributors.ranks!=='120,2'
            || r.tickContributors.recent!==1 || r.tickContributors.total!=='2'
            || r.tickContributors.tapHeight<44 || !r.tickContributors.visibleRows)){
          bad++;console.log('   F970/F974 expanded contributors lost native disclosure, date order, scoped counts or readable rows');
        }
        if(r.tickRankOrder!=null && (r.tickRankOrder!=='2,120' || !r.tickRosterOpen || r.tickMetric!=='count')){
          bad++;console.log('   F974 Count must show rank-sorted contributors and preserve its opened roster');
        }
        if(r.tickPhoto!=null && (!(r.tickSharedPhoto>0) || Math.abs(r.tickPhoto-r.tickSharedPhoto)>.5)){
          bad++;console.log('   F977 tick photo differs from shared Twitches medium sizing: '
            +r.tickPhoto+' vs '+r.tickSharedPhoto);
        }
        if(r.tickPhoto!=null) console.log('   F868 PHOTO '+r.tickPhoto);
        if(r.tickPrimaryOffset!=null && Math.abs(r.tickPrimaryOffset)>.5){
          bad++;console.log('   F880 recent-birder count must align at the card header top: '+r.tickPrimaryOffset);
        }
        if(r.birdPhoto!=null){
          var expectedPhoto=PROFILE==='high-visibility' ? r.vw-32 : 64*Number(SCALE);
          console.log('   F873 PHOTO '+r.birdPhoto+' RIGHT ICON '+r.rightIcon);
          if((PROFILE!=='high-visibility' && Math.abs(r.birdPhoto-expectedPhoto)>.5)
              || Math.abs(r.rightIcon-56*Number(SCALE))>.5){
            bad++;console.log('   F873 must enlarge the left photo without changing the right icon');
          }
        }
        if(r.brandSize!=null && Math.abs(r.brandSize-24*Number(SCALE))>.5){
          bad++;console.log('   F875 brand title size failed: '+r.brandSize);
        }
        if(r.brandSize!=null) console.log('   F875 BRAND SIZE '+r.brandSize);
      if (r.label === '(contents menu)') {
        var menuWarnings = r.menuWarnings || [];
        if (menuWarnings.length !== 1 || menuWarnings.some(function (warning) {
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
      if (r.menuLayout) {
        var menu = r.menuLayout;
        console.log('   F987/F992 MENU GEOMETRY  ' + JSON.stringify(menu));
        if (!menu.fullWidth || !menu.regularTiles || !menu.jargonBetween || !menu.shortcuts || !menu.birdGenNormal
            || JSON.stringify(menu.groups) !== JSON.stringify(['Patches - Go birding', 'Bird alerts'])
            || JSON.stringify(menu.order) !== JSON.stringify([
              'destBtn', 'quickBtn', 'excBtn', 'iconicBtn', 'coldBtn', 'hotBtn', 'favResults'
            ])) {
          bad++;
          console.log('   F987/F992 MENU LAYOUT FAILED');
        }
      }
      if (r.recentBirdGen && Object.values(r.recentBirdGen).some(value => !value)) {
        bad++;
        console.log('   F987 RECENT FEED FAILED ' + JSON.stringify(r.recentBirdGen));
      }
      if (r.compactShortcuts) {
        console.log('   F1036 COMPACT SHORTCUTS  ' + JSON.stringify(r.compactShortcuts));
        if (Object.values(r.compactShortcuts.checks).some(value => !value)
          || r.compactShortcuts.tiles.some(tile => Object.values(tile).some(value => !value))) {
          bad++;
          console.log('   F1036 COMPACT SHORTCUTS FAILED');
        }
      }
      if (r.emptyShortcuts) {
        console.log('   F1039 EMPTY SHORTCUTS  ' + JSON.stringify(r.emptyShortcuts));
        if (Object.values(r.emptyShortcuts).some(value => !value)) {
          bad++;
          console.log('   F1039 EMPTY SHORTCUTS FAILED');
        }
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
      if (r.patchHeader && Object.values(r.patchHeader).some(value => !value)) {
        bad++;
        console.log('   F850 patch header must lead into the toolbar: ' + JSON.stringify(r.patchHeader));
      }
      if (r.label === '(F851 compact Top100)') {
        console.log('   F851 RANK GEOMETRY ' + JSON.stringify(layout && layout.rankColumns));
        if (!layout || !layout.rankColumns || layout.rankColumns.length !== 2
            || layout.rankColumns.some(row => row.reservedWidth > row.contentWidth + 0.5
              || row.decoration !== 'none')) {
          bad++;
          console.log('   F851 rank columns reserve excess space or bird names are underlined');
        }
      }
      if (r.categoryFilter && Object.values(r.categoryFilter).some(value => !value)) {
        bad++;
        console.log('   F849 selected Mass Flock must visibly select and hide other categories: '
          + JSON.stringify(r.categoryFilter));
      }
      if (r.alertEvidence && r.alertEvidence.some(evidence => Object.values(evidence).some(value => !value))) {
        bad++;
        console.log('   F954/F967 facts must match extra evidence; headlines use selective bird/place emphasis and labeled checklists: '
          + JSON.stringify(r.alertEvidence));
      }
      if (r.hotspotQr) {
        console.log('   F845 HOTSPOT QR GEOMETRY ' + JSON.stringify(r.hotspotQr));
        if (Object.values(r.hotspotQr).some(value => !value)) {
          bad++;
          console.log('   F845 hotspot QR must be right-aligned beside the title');
        }
      }
      if (r.hotspotFavorite) {
        var hf = r.hotspotFavorite;
        console.log('   F828 FAVORITE GEOMETRY ' + JSON.stringify(hf));
        if (hf.pressed !== String(hf.saved) || !hf.ownRow || !hf.noNavigation
            || hf.favoriteHeight < 44 || hf.favoriteWidth < 44
            || hf.favoriteTop < hf.titleBottom || hf.identityTop < hf.favoriteBottom
            || hf.actionsTop < hf.identityBottom || hf.summaryTop < hf.actionsBottom) {
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
      }
      if (r.foyGeometry) {
        console.log('   F861 ADAPTIVE CARDS ' + JSON.stringify(r.foyGeometry));
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
        if (r.nearbyRows != null && r.nearbyRows !== 11) {
          layoutProblems.push('F857 compact neighborhood lost its eleven source rows');
        }
        if (layout.latestBirdIcons === false) {
          layoutProblems.push('Top 100 latest-bird icons must match the readable 56px scaled size');
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
    if (bad) console.log('\nLayout failures: ' + bad);
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
