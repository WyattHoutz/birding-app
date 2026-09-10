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
const CONTRACT = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests', 'fixtures', 'report-contract.json'), 'utf8'));
const WA_SEEN = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests', 'fixtures', 'wa-seen-2026-stub.json'), 'utf8'));
const MEGA_STAKEOUT = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests', 'fixtures', 'mega-stakeout.json'), 'utf8'));
const BIRD_ICON_DIR = path.join(WWW, 'assets', 'birds');
const BUNDLED_ICON_EXTENSIONS = {};
for (const ext of ['.jpg', '.png']) {
  for (const file of fs.readdirSync(BIRD_ICON_DIR).sort()) {
    if (path.extname(file).toLowerCase() !== ext) continue;
    const code = path.basename(file, ext);
    if (!BUNDLED_ICON_EXTENSIONS[code]) BUNDLED_ICON_EXTENSIONS[code] = ext;
  }
}

function fixtureIconPath(code, extensions = BUNDLED_ICON_EXTENSIONS) {
  const ext = extensions[code];
  if (!ext) throw new Error('no bundled fixture icon for ' + code);
  return 'assets/birds/' + code + ext;
}

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
const STUB_SPEC = {
  surgeBtn:       { kind: 'birdgen',       host: 'surgeResults' },
  wxBtn:          { kind: 'weather',       host: 'wxForecast' },
  dueBackBtn:     { kind: 'bird',          host: 'dueBackResults' },
  rankBtn:        { kind: 'ranking',       host: 'rankResults' },
  patchBtn:       { kind: 'patches',       host: 'patchResults',
    expects: ['#patchResults .hscard.hscard-md', '#patchResults .patchwho'] },
  destBtn:        { kind: 'hotspot',       host: 'destResults', map: 'destMap',
    report: 'hi' },
  excBtn:         { kind: 'hotspot',       host: 'excResults', map: 'excMap',
    report: 'hi' },
  fullDayBtn:     { kind: 'hotspot',       host: 'fullDayResults', map: 'fullDayMap',
    report: 'hi' },
  quickBtn:       { kind: 'hotspot',       host: 'quickResults', map: 'quickMap' },
  targetsBtn:     { kind: 'hotspot',       host: 'targetResults', map: 'closeMap' },
  spLookupBtn:    { kind: 'stakeout-merged', host: 'spLookupIdHelp', map: 'spLookupMap',
    maxHostHeight: 150,
    expects: ['#spLookupQueryHelp:empty',
      '#spLookupIdHelp .spuhpathsentence',
      '#spLookupIdHelp .spuhpathchip[data-spuh]',
      '#spLookupResults > li', '#spLookupIdHelp .spuhtaxnav',
      '#spLookupIdHelp .spuhcompactpath .spuhtaxlink',
      '#spLookupIdHelp details.spuhdetails',
      '#spLookupIdHelp .spuhtaxlevel[data-rank="species"]',
      '#spLookupResults .spLookupPlaceList > .hscard-sm'] },
  stakeHsBtn:     { kind: 'hotspot-search', host: 'stakeHsResults' },
  iconicBtn:      { kind: 'hotspot',       host: 'iconicResults' },
  hotBtn:         { kind: 'hotspot',       host: 'hotResults', map: 'hotMap' },
  coldBtn:        { kind: 'hotspot',       host: 'coldResults', map: 'coldMap' },
  refreshBtn:     { kind: 'bird',          host: 'results' },
  activeBtn:      { kind: 'bird',          host: 'activeResults' },
  abaBtn:         { kind: 'mega-index',    host: 'abaResults',
    expects: ['#abaScopePick [data-abascope="state"]',
      '#abaScopePick [data-abascope="aba"]',
      '#abaSortPick [data-abasort="date"]',
      '#abaSortPick [data-abasort="distance"]',
      '#abaResults li[data-mega-code][data-mega-view]',
      '#abaResults .megaphoto', '#abaResults .megajump',
      '#abaResults .spdist', '#abaResults .abadist'] },
  lastNewBtn:     { kind: 'bird',          host: 'lastNewResults' },
  cklBtn:         { kind: 'checklists',    host: 'cklResults', map: 'cklMap' },
  convoyBtn:      { kind: 'checklists',    host: 'convoyResults' },
  favResults:     { kind: 'hotspot',       host: 'favResults' },
  allUnseenBtn:   { kind: 'bird',          host: 'allUnseenResults' },
  easyBtn:        { kind: 'bird',          host: 'easyResults' },
  nvResults:      { kind: 'species-search', host: 'nvResults' },
  migBtn:         { kind: 'migration',     host: 'migFirstResults',
    expects: ['#migFirstResults .obs.big.xl.icon-sm > li', '#migFirstResults .spdist',
      '#migResults .obs.big.xl.icon-sm > li', '#migResults .spdist'] },
  bcBody:         { kind: 'birdcast',      host: 'bcBody' },
  todBtn:         { kind: 'bird',          host: 'todResults' },
  myYearBody:     { kind: 'bird',          host: 'myYearList' },
  settingsPanel:  { kind: 'static',        host: 'settingsPanel' },
  recordBody:     { kind: 'bird',          host: 'recordBody' },
  helpBody:       { kind: 'help',          host: 'helpBody' },
};

const SECTION_SHOTS = CONTRACT.menu.map((item) => {
  const spec = STUB_SPEC[item.at];
  const at = JSON.stringify(item.at);
  return {
    id: 'section-' + item.at,
    at: item.at,
    title: item.label + ' — ' + item.sub,
    kind: spec && spec.kind,
    host: spec && spec.host,
    map: spec && spec.map,
    scrollTo: spec && spec.scrollTo,
    maxHostHeight: spec && spec.maxHostHeight,
    expects: (spec && spec.expects) || [],
    prep: `var spec = ${JSON.stringify(spec || null)};
           A.setActiveReport((spec && spec.report) || 'wa');
           FIX.before(${at}, A, document);
           var anchor = document.getElementById(${at});
           var sec = anchor && anchor.closest ? anchor.closest('section') : null;
           if (!sec) throw new Error('no section for ' + ${at});
           A.showSection(sec.id);
           return FIX.prepare(${at}, spec, A, document, sec);`,
  };
});

const EXTRA_SHOTS = [
  { id: 'spuhcompare', at: 'spLookupBtn',
    title: 'Stakeout bird — compare possible birds',
    host: 'spLookupIdHelp',
    prep: `FIX.before('spLookupBtn', A, document);
           var anchor = document.getElementById('spLookupBtn');
           var sec = anchor.closest('section');
           A.showSection(sec.id);
           return FIX.prepareCompare(A, document, sec);` },
];

// Review-only states do not increase the mandatory 34-shot release contract.
// They are available through --only when a change needs a focused image.
const REVIEW_SHOTS = [
  { id: 'onboardingregion', menuState: true,
    title: 'First run — choose or find a region',
    prep: `localStorage.removeItem('ebird_display_name');
           localStorage.removeItem('ebird_api_key');
           localStorage.setItem('ebird_region_setup_v1', JSON.stringify({
             status: 'denied',
             message: 'Location permission is off.'
           }));
           A.setActiveReport('');
           A.renderKeyBanner();
           if (!document.getElementById('regionChooseBtn')) {
             throw new Error('missing region chooser');
           }
           return true;` },
  { id: 'onboardinghome',
    title: 'First run — set an owned Home',
    prep: `A.setActiveReport('wa');
           localStorage.removeItem(A.homeKey('lat'));
           localStorage.removeItem(A.homeKey('lng'));
           localStorage.removeItem(A.homeKey('place'));
           localStorage.removeItem('ebird_display_name');
           localStorage.removeItem('ebird_api_key');
           localStorage.removeItem('ebird_region_setup_v1');
           A.renderMenuIdentity();
           A.renderKeyBanner();
           if (!document.getElementById('homeHereBtn')) {
             throw new Error('missing owned-Home setup');
           }
           return true;` },
  { id: 'birdgenloading', at: 'surgeBtn',
    title: 'Bird Gen — Mega source loading',
    host: 'surgeResults',
    prep: `FIX.before('surgeBtn', A, document);
           var anchor = document.getElementById('surgeBtn');
           var sec = anchor.closest('section');
           localStorage.removeItem('ebird_api_key');
           A.showSection(sec.id);
           localStorage.removeItem('ebird_mega_snapshot_v1');
           A.renderSurge([], [], [], [], [], {
             mega: 'partial', observations: 'ok',
             leaderboard: 'loading', hotspots: 'loading'
           });
           var host = document.getElementById('surgeResults');
           host.setAttribute('data-mock-data', 'true');
           host.setAttribute('aria-label', 'Representative stub data for Bird Gen loading');
           sec.dataset.mockAt = 'surgeBtn';
           sec.dataset.mockReady = 'true';
           return true;` },
  { id: 'hawaiiemptybirdgen', at: 'surgeBtn',
    title: 'Bird Gen — empty Hawaii seen list',
    host: 'surgeResults',
    prep: `A.setActiveReport('hi');
           var anchor = document.getElementById('surgeBtn');
           var sec = anchor.closest('section');
           A.showSection(sec.id);
           A.renderSurge([], [], [], [{
             code: 'sposan', name: 'Spotted Sandpiper',
             sightings: 3, nPlaces: 1,
             latestLocName: 'Pololu Valley',
             latestLocId: 'L-HI-SPOSAN',
             latestStr: '2026-08-22 15:20',
             latest: Date.parse('2026-08-22T15:20:00'),
             latestSubId: 'S-HI-SPOSAN'
           }], [], {
             mega: 'ok', observations: 'ok',
             leaderboard: 'ok', hotspots: 'ok'
           }, []);
           var host = document.getElementById('surgeResults');
           var spotted = host.querySelector('[data-species-code="sposan"]');
           if (!spotted || spotted.hidden || spotted.dataset.surgeSeen !== 'unseen') {
             throw new Error('empty Hawaii list did not keep Spotted Sandpiper unseen');
           }
           host.setAttribute('data-mock-data', 'true');
           host.setAttribute('aria-label', 'Empty Hawaii year-list Bird Gen control');
           sec.dataset.mockAt = 'surgeBtn';
           sec.dataset.mockReady = 'true';
           return true;` },
  { id: 'hawaiiemptyticks', at: 'myYearBody',
    title: 'My Ticks — empty Hawaii year list',
    host: 'myYearBody',
    prep: `A.setActiveReport('hi');
           var host = document.getElementById('myYearBody');
           var sec = host.closest('section');
           A.showSection(sec.id);
           A.updateMyYear();
           if (!/0 species in 2026/i.test(host.textContent)
               || /species logged/i.test(host.textContent)) {
             throw new Error('empty Hawaii list fell back to the combined sample total');
           }
           host.setAttribute('data-mock-data', 'true');
           host.setAttribute('aria-label', 'Empty Hawaii year-list My Ticks control');
           sec.dataset.mockAt = 'myYearBody';
           sec.dataset.mockReady = 'true';
           return true;` },
  { id: 'favoritesregion', at: 'favResults',
    title: 'Favorite patches — current region only',
    host: 'favResults',
    allowDisabled: ['.favup', '.favdown'],
    prep: `FIX.before('favResults', A, document);
           var spec = ${JSON.stringify(STUB_SPEC.favResults)};
           var host = document.getElementById('favResults');
           var sec = host.closest('section');
           A.showSection(sec.id);
           await FIX.prepare('favResults', spec, A, document, sec);
           A.setFavs([
             { id: 'wa-1', locId: 'L-WA-1', locName: 'Marymoor Park — Bird Loop',
               lat: 47.66, lng: -122.12, region: 'US-WA' },
             { id: 'hi-1', locId: 'L-HI-1', locName: 'Hawaii Volcanoes NP',
               lat: 19.42, lng: -155.29, region: 'US-HI' },
             { id: 'wa-2', locId: 'L-WA-2', locName: 'Cedar River Mouth',
               lat: 47.50, lng: -122.22, region: 'US-WA' }
           ]);
           A.renderFavs();
           host.setAttribute('data-mock-data', 'true');
           return true;` },
  { id: 'spuhcompact', at: 'spLookupBtn',
    title: 'Stakeout bird — peep sp. condensed',
    host: 'spLookupQueryHelp', scrollTo: '#spLookupQueryHelp',
    expects: ['#spLookupQueryHelp .spuhresulthero > .spuhresultcard',
      '#spLookupQueryHelp .spuhresulthero .thumb[data-bird]',
      '#spLookupQueryHelp .spuhhierarchyhead > h3',
      '#spLookupQueryHelp .spuhhierarchyinfo',
      '#spLookupQueryHelp .spuhresultpath .spuhpathchip[data-spuh]',
      '#spLookupQueryHelp .spuhresultpath .spuhpatharrow',
      '#spLookupQueryHelp .spuhresultpath .spuhpathalternate[aria-label="or"]',
      '#spLookupQueryHelp .spuhresultpath .spuhpathmarked[data-spuh]',
      '#spLookupQueryHelp .spuhcandidatecards > '
        + '.spuhcandidatecard[role="button"][tabindex="0"]'],
    prep: `FIX.before('spLookupBtn', A, document);
           var anchor = document.getElementById('spLookupBtn');
           var sec = anchor.closest('section');
           A.showSection(sec.id);
           await FIX.prepareBirdSp(A, document, sec, 'calidr');
           var host = document.getElementById('spLookupQueryHelp');
           if (!host.querySelector('.spuhcandidatecards .spuhcandidatecard')) {
             throw new Error('missing peep sp. candidate species cards');
           }
           var list = host.querySelector('.spuhcandidatecards');
           var bounds = list.getBoundingClientRect();
           var candidates = [].slice.call(list.querySelectorAll('.spuhcandidatecard'));
           if (candidates.some(function (card) {
             var rect = card.getBoundingClientRect();
             return rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5
               || card.scrollWidth > card.clientWidth + 0.5;
           })) {
             throw new Error('candidate species cards do not fit in the result');
           }
           if (A.fgProgressReset) A.fgProgressReset();
           host.setAttribute('data-mock-data', 'true');
           sec.dataset.mockAt = 'spLookupBtn';
           sec.dataset.mockReady = 'true';
           return true;` },
  { id: 'birdspcompact', at: 'spLookupBtn',
    title: 'Stakeout bird — bird sp. condensed',
    host: 'spLookupQueryHelp', scrollTo: '#spLookupQueryHelp',
    expects: ['#spLookupQueryHelp .spuhsummaryname',
      '#spLookupQueryHelp .spuhhierarchyhead > h3',
      '#spLookupQueryHelp .spuhresultpath',
      '#spLookupQueryHelp .spuhcandidatestatus',
      '#spLookupQueryHelp .spuhcandidatecards > '
        + '.spuhcandidatecard[role="button"][tabindex="0"]',
      '#spLookupQueryHelp .spuhcandidatemore'],
    prep: `FIX.before('spLookupBtn', A, document);
           var anchor = document.getElementById('spLookupBtn');
           var sec = anchor.closest('section');
           A.setActiveReport('wa');
           A.showSection(sec.id);
           await FIX.prepareBirdSp(A, document, sec);
           return true;` },
  { id: 'birdspdetail', at: 'spLookupBtn',
    title: 'Stakeout bird — bird sp. detailed',
    host: 'spLookupQueryHelp', scrollTo: '#spLookupQueryHelp',
    expects: ['#spLookupQueryHelp .spuhviewpick '
        + '[data-spuhview="detailed"][aria-pressed="true"]',
      '#spLookupQueryHelp .spuhresultdetails[open]',
    '#spLookupQueryHelp .spuhhierarchy',
    '#spLookupQueryHelp .spuhtaxsteps > .spuhtaxstep[data-rank="class"]'],
    prep: `FIX.before('spLookupBtn', A, document);
           var anchor = document.getElementById('spLookupBtn');
           var sec = anchor.closest('section');
           A.setActiveReport('wa');
           A.showSection(sec.id);
           await FIX.prepareBirdSp(A, document, sec);
           document.querySelector(
             '#spLookupQueryHelp [data-spuhview="detailed"]').click();
           FIX.assertDetailedHierarchyLayout(document);
           return true;` },
  { id: 'spuhdetail', at: 'spLookupBtn',
    title: 'Stakeout bird — peep sp. detailed',
    host: 'spLookupQueryHelp', scrollTo: '#spLookupQueryHelp',
    expects: ['#spLookupQueryHelp .spuhhierarchyhead > h3',
      '#spLookupQueryHelp .spuhhierarchyinfo',
      '#spLookupQueryHelp .spuhviewpick '
        + '[data-spuhview="detailed"][aria-pressed="true"]',
      '#spLookupQueryHelp .spuhresultdetails[open]',
      '#spLookupQueryHelp .spuhtaxsteps > .spuhtaxstep[data-rank="class"]',
      '#spLookupQueryHelp .spuhtaxsteps > .spuhtaxstep[data-rank="order"]',
      '#spLookupQueryHelp .spuhtaxsteps > .spuhtaxstep[data-rank="family"]',
      '#spLookupQueryHelp .spuhtaxsteps > .spuhtaxstep[data-rank="genus"]',
      '#spLookupQueryHelp .spuhtaxmarked[data-spuh="shoreb1"]',
      '#spLookupQueryHelp .spuhtaxmarked[data-spuh="largesh"]',
      '#spLookupQueryHelp .spuhtaxmarked[data-spuh="calidr"]',
      '#spLookupQueryHelp .spuhcandidatecards > '
        + '.spuhcandidatecard[role="button"][tabindex="0"]'],
    prep: `FIX.before('spLookupBtn', A, document);
           var anchor = document.getElementById('spLookupBtn');
           var sec = anchor.closest('section');
           A.showSection(sec.id);
           await FIX.prepareBirdSp(A, document, sec, 'calidr');
           document.querySelector(
             '#spLookupQueryHelp [data-spuhview="detailed"]').click();
           FIX.assertDetailedHierarchyLayout(document);
           if (A.fgProgressReset) A.fgProgressReset();
           document.getElementById('spLookupQueryHelp').setAttribute('data-mock-data', 'true');
           sec.dataset.mockAt = 'spLookupBtn';
           sec.dataset.mockReady = 'true';
           return true;` },
  { id: 'spuhinfo', at: 'spLookupBtn',
    title: 'Stakeout bird — taxonomic hierarchy information',
    host: 'appSheet',
    expects: ['#appSheet:not([hidden]) .sheettitle',
      '#appSheet:not([hidden]) .sheetsub',
      '#appSheet:not([hidden]) .sheetbody h4',
      '#appSheet:not([hidden]) .sheetbody p'],
    prep: `FIX.before('spLookupBtn', A, document);
           var anchor = document.getElementById('spLookupBtn');
           var sec = anchor.closest('section');
           A.showSection(sec.id);
           await FIX.prepareBirdSp(A, document, sec, 'calidr');
           document.querySelector('#spLookupQueryHelp .spuhhierarchyinfo').click();
           var host = document.getElementById('appSheet');
           if (!host || host.hidden) throw new Error('hierarchy information sheet did not open');
           if (A.fgProgressReset) A.fgProgressReset();
           host.setAttribute('data-mock-data', 'true');
           sec.dataset.mockAt = 'spLookupBtn';
           sec.dataset.mockReady = 'true';
           return true;` },
  { id: 'stakeoutdetail', at: 'spLookupBtn',
    title: 'Stakeout bird — Detailed view',
    host: 'spLookupIdHelp', scrollTo: '#spLookupIdHelp',
    prep: `FIX.before('spLookupBtn', A, document);
           var anchor = document.getElementById('spLookupBtn');
           var sec = anchor.closest('section');
           A.showSection(sec.id);
           await FIX.prepare('spLookupBtn', ${JSON.stringify(STUB_SPEC.spLookupBtn)}, A, document, sec);
           var detail = document.querySelector('#spLookupIdHelp details.spuhdetails');
           if (!detail) throw new Error('missing Stakeout Detailed view');
           detail.open = true;
           return true;` },
  { id: 'stakeoutreports', at: 'spLookupBtn',
    title: 'Stakeout bird — lazy-expanded recent hotspots',
    host: 'spLookupResults', scrollTo: '#spLookupResults',
    prep: `FIX.before('spLookupBtn', A, document);
           var anchor = document.getElementById('spLookupBtn');
           var sec = anchor.closest('section');
           A.showSection(sec.id);
           return FIX.prepareStakeoutReports(A, document, sec);` },
  { id: 'megaaba', at: 'abaBtn',
    title: 'Mega rarities — ABA area, Newest',
    host: 'abaResults',
    prep: `A.setActiveReport('wa');
           FIX.before('abaBtn', A, document);
           var spec = ${JSON.stringify(STUB_SPEC.abaBtn)};
           var anchor = document.getElementById('abaBtn');
           var sec = anchor.closest('section');
           A.showSection(sec.id);
           await FIX.prepare('abaBtn', spec, A, document, sec);
           document.querySelector('#abaScopePick [data-abascope="aba"]').click();
           return true;` },
  { id: 'meganearest', at: 'abaBtn',
    title: 'Mega rarities — Washington, Nearest',
    host: 'abaResults',
    prep: `A.setActiveReport('wa');
           FIX.before('abaBtn', A, document);
           var spec = ${JSON.stringify(STUB_SPEC.abaBtn)};
           var anchor = document.getElementById('abaBtn');
           var sec = anchor.closest('section');
           A.showSection(sec.id);
           await FIX.prepare('abaBtn', spec, A, document, sec);
           document.querySelector('#abaSortPick [data-abasort="distance"]').click();
           return true;` },
];

const SHOTS = [
  { id: 'menu', title: 'Contents menu', prep: 'return true;' },
].concat(SECTION_SHOTS, EXTRA_SHOTS);

function shotReadinessProblems(ready) {
  const problems = [];
  if (!ready || ready.error) problems.push((ready && ready.error) || 'missing readiness result');
  if (!ready || !ready.ready) problems.push('fixture not ready');
  if (ready && ready.expectedAt && ready.at !== ready.expectedAt) problems.push('wrong fixture');
  if (!ready || !ready.sectionVisible) problems.push('section hidden');
  if (!ready || !ready.hostVisible) problems.push('result host hidden');
  if (!ready || !ready.inCapture) problems.push('result host outside capture');
  if (ready && ready.maxHostHeight
      && ready.hostHeight > ready.maxHostHeight) {
    problems.push('oversized result host');
  }
  if (ready && ready.loading && ready.loading.length) problems.push('loading');
  if (ready && ready.globalLoading) problems.push('global loading');
  if (ready && ready.disabled && ready.disabled.length) problems.push('disabled controls');
  if (ready && ready.missing && ready.missing.length) problems.push('missing expected components');
  if (ready && !ready.mapReady) problems.push('map not ready');
  if (ready && ready.isStatic) {
    if (ready.text < 200 || ready.controls < 3) problems.push('blank static surface');
  } else if (!ready || !ready.data || ready.text < 30) {
    problems.push('blank data surface');
  }
  return problems;
}

function shotLooksBlank(seen, hasSection) {
  const minText = hasSection ? 30 : 200;
  const minNodes = hasSection ? 5 : 100;
  return !seen || (seen.text || 0) < minText || (seen.nodes || 0) < minNodes;
}

// ------------------------------------------------------------------ harness
//
// Injected into the app document BEFORE its own scripts run, so the app boots
// against a stub instead of the network and against a known localStorage.
const BOOTSTRAP = `
<script>
(function () {
  window.__BC_MOCKUP_MODE__ = true;
  var WA_SEEN_STUB = ${JSON.stringify(WA_SEEN)};
  var MEGA_STAKEOUT = ${JSON.stringify(MEGA_STAKEOUT)};
  var BIRD_ICON_EXT = ${JSON.stringify(BUNDLED_ICON_EXTENSIONS)};
  var fixtureIconPath = ${fixtureIconPath.toString()};
  var RealDate = Date;
  var MOCK_NOW = RealDate.parse('2026-09-02T18:00:00-07:00');
  window.Date = class MockDate extends RealDate {
    constructor() {
      var args = Array.prototype.slice.call(arguments);
      super(...(args.length ? args : [MOCK_NOW]));
    }
    static now() { return MOCK_NOW; }
  };
  function applyWaSeenSeed(seed) {
    if (!seed || !seed.seenByReport) return seed;
    var known = WA_SEEN_STUB.birds.filter(function (bird) { return bird.seen; });
    var codes = known.map(function (bird) { return bird.code; });
    var names = known.map(function (bird) { return bird.name; });
    var yearList = known.map(function (bird) {
      return {
        code: bird.code, name: bird.name, date: bird.firstSeen || '',
        subId: '', loc: '', locUrl: ''
      };
    });
    while (codes.length < WA_SEEN_STUB.speciesObserved) {
      var n = codes.length + 1;
      codes.push('stubseen' + String(n).padStart(3, '0'));
      names.push('Other seen species ' + n);
      yearList.push({
        code: codes[codes.length - 1], name: names[names.length - 1],
        date: '', subId: '', loc: '', locUrl: ''
      });
    }
    seed.seenByReport.wa = {
      codes: codes, names: names, watchHeld: [], yearList: yearList
    };
    seed.codes = codes.slice();
    seed.names = names.slice();
    seed.watchlist = [];
    return seed;
  }
  var seedValue;
  Object.defineProperty(window, '__SEED_BIRDLIST__', {
    configurable: true,
    get: function () { return seedValue; },
    set: function (seed) { seedValue = applyWaSeenSeed(seed); }
  });
  try {
    localStorage.clear();
    localStorage.setItem('ebird_report', 'wa');
    localStorage.setItem('ebird_api_key', 'mockupmockup');
    localStorage.setItem('ebird_seen_field', 'speciesCode');
    localStorage.setItem('ebird_seen_meta', JSON.stringify({
      source: 'seed',
      count: WA_SEEN_STUB.speciesObserved,
      rows: WA_SEEN_STUB.speciesObserved,
      year: 2026,
      yearCount: WA_SEEN_STUB.speciesObserved
    }));
    // ⚠️ BLURRED TO 2 dp ON PURPOSE. This repo is PUBLIC, and the home-privacy
    // guard rejects any 4+ dp coordinate within 2 km of the real anchor — it
    // caught this file. A mockup needs a plausible home, not a real one.
    localStorage.setItem('ebird_home_lat', '47.75');
    localStorage.setItem('ebird_home_lng', '-122.16');
    localStorage.setItem('ebird_display_name', 'Sample Birder');
    localStorage.setItem('ebird_ui_scale', '__SCALE__');
    // THE BIRD ICON NEEDS THE SPECIES INDEX. rankLastNewHTML resolves a
    // species NAME to a CODE through the cached region index, and renders no
    // photo slot when it cannot — correct behaviour that makes the icon
    // silently absent in an offline mockup. Seeded so the shot shows what the
    // device shows; found by the owner reading the first render.
    localStorage.setItem('ebird_species_v2:US-WA', JSON.stringify({
      t: Date.now(),
      rows: WA_SEEN_STUB.birds.map(function (bird) {
        return {
          name: bird.name, code: bird.code, sci: bird.sci,
          alpha: bird.alpha, bandingCodes: bird.alpha
        };
      })
    }));
  } catch (e) {}
  // Never settles: loaders start, spinners paint, nothing arrives and nothing
  // errors. Same stub the DOM suite boots against.
  var HANG = function () { return new Promise(function () {}); };
  window.fetch = HANG;
  window.XMLHttpRequest = function () {
    this.open = function () {}; this.setRequestHeader = function () {};
    this.send = function () {}; this.addEventListener = function () {};
  };
  function ensureMockStyle(document) {
    if (document.getElementById('releaseMockStyle')) return;
    var style = document.createElement('style');
    style.id = 'releaseMockStyle';
    style.textContent =
      '.mockfixture{border:2px solid var(--ink);border-radius:12px;padding:10px;background:var(--card)}'
      + '.mocklabel{font-size:calc(11px * var(--s));font-weight:800;letter-spacing:.06em;margin:8px 0}'
      + '.mockrow{border-top:1px solid var(--line);padding:9px 2px;'
      + 'font-size:calc(14px * var(--s));line-height:1.45}'
      + '.mockrow:first-of-type{border-top:0}.mockrow b{display:block;font-size:calc(16px * var(--s))}'
      + '.mockmap{height:calc(190px * var(--s));border:2px solid var(--safe-blue);border-radius:11px;'
      + 'background:linear-gradient(135deg,var(--card) 0 48%,var(--note-bg) 48% 52%,var(--card) 52%);'
      + 'display:grid;place-items:center;text-align:center;font-weight:800;margin:8px 0}'
      + '.mockstate{display:inline-block;border:2px dashed var(--warn);border-radius:6px;'
      + 'padding:2px 6px;font-size:calc(11px * var(--s));font-weight:800;margin-left:5px}';
    document.head.appendChild(style);
  }
  function mockPhoto(code) {
    return '<span class="thumb"><img class="birdpic" src="'
      + fixtureIconPath(code, BIRD_ICON_EXT) + '" alt=""></span>';
  }
  function fixtureStatus(sec, label) {
    var status = sec.querySelector('.status');
    if (status) {
      status.hidden = false;
      status.textContent = 'REPRESENTATIVE STUB DATA · ' + label;
      status.removeAttribute('aria-busy');
    }
    [].forEach.call(sec.querySelectorAll('button:disabled'), function (button) {
      button.disabled = false;
    });
  }
  function markHost(host, label) {
    host.setAttribute('data-mock-data', 'true');
    host.setAttribute('aria-label', 'Representative stub data for ' + label);
  }
  function speciesRows(window, at) {
    var SC = window.SpeciesCards;
    function stubBird(code) {
      return WA_SEEN_STUB.birds.filter(function (bird) {
        return bird.code === code;
      })[0] || {};
    }
    var cfg = {
      dueBackBtn: ['Western Sandpiper', 'wessan', 'Calidris mauri',
        'DUE IN 6 DAYS', 'Usually returns Sep 8 · 1,084 archived records'],
      refreshBtn: ['Sharp-tailed Sandpiper', 'shtsan', 'Calidris acuminata',
        'RARITY · REVIEWED', 'Latest today 8:14 AM · 3 reports'],
      activeBtn: ['Sharp-tailed Sandpiper', 'shtsan', 'Calidris acuminata',
        'ACTIVE 3 DAYS', '5 recent checklists · latest today'],
      abaBtn: ['Nazca Booby', 'nazboo1', 'Sula granti',
        'ABA CODE 4', 'First state record · 2 independent reports'],
      lastNewBtn: ['Northern Waterthrush', 'norwat', 'Parkesia noveboracensis',
        'NEW TICK', '2 of the Top 100 added it this week'],
      allUnseenBtn: ['Semipalmated Sandpiper', 'semsan', 'Calidris pusilla',
        'NEEDED', '3 places · latest Sep 1 at 5:10 PM'],
      easyBtn: ['Semipalmated Sandpiper', 'semsan', 'Calidris pusilla',
        'COMMON MISS', 'Reported on 18 of 30 days · 7 spots'],
      nvResults: ['Semipalmated Sandpiper', 'semsan', 'Calidris pusilla',
        'NEEDS PROOF', 'Still counted by eBird · remains a chase target'],
      migBtn: ['Western Sandpiper', 'wessan', 'Calidris mauri',
        'ARRIVING', 'Rising this week · expected peak Sep 12'],
      todBtn: ['Solitary Sandpiper', 'solsan', 'Tringa solitaria',
        'DAWN SPECIALIST', '63% of records before 8 AM'],
      myYearBody: ["Lewis's Woodpecker", 'lewwoo', 'Melanerpes lewis',
        'RECENT CHECKLIST', 'Year bird #216 · included in the completed first paint'],
      recordBody: ['Nazca Booby', 'nazboo1', 'Sula granti',
        'OVERDUE RECORD', 'Best historical window: late Aug–Sep'],
      spLookupBtn: ['Solitary Sandpiper', 'solsan', 'Tringa solitaria',
        '12 PLACES', '28 reports in the last 30 days']
    }[at] || ['Semipalmated Sandpiper', 'semsan', 'Calidris pusilla',
      'NEEDED', '3 places · latest Sep 1 at 5:10 PM'];
    var secondTag = at === 'myYearBody' ? 'SEEN' : 'NEW REPORT';
    var secondSub = at === 'myYearBody'
      ? 'Year bird #214 · added Aug 23'
      : '2 checklists · one report unreviewed';
    var secondCode = at === 'myYearBody' ? 'fragul' : 'solsan';
    var secondBird = stubBird(secondCode);
    var firstBird = stubBird(cfg[1]);
    return [
      SC.medium({ sci: cfg[2], icon: mockPhoto(cfg[1]),
        name: cfg[0], code: cfg[1], alpha: firstBird.alpha || '',
        tags: '<span class="mockstate">' + cfg[3] + '</span>', distMi: 8.4,
        sub: cfg[4] }),
      SC.medium({ sci: secondBird.sci || 'Tringa solitaria', icon: mockPhoto(secondCode),
        name: secondBird.name || 'Solitary Sandpiper', code: secondCode,
        alpha: secondBird.alpha || '',
        tags: '<span class="mockstate">' + secondTag + '</span>', distMi: 17.2,
        sub: secondSub })
    ];
  }
  function fillSpeciesHost(host, window, label, at) {
    var rows = speciesRows(window, at);
    if (host.tagName === 'UL') {
      host.className = 'obs big xl mockfixture';
      host.innerHTML = rows.join('');
    } else {
      host.innerHTML = window.SpeciesCards.list('medium', rows, 'mockfixture');
    }
    markHost(host, label);
  }
  function hotspotRows(window, at) {
    var HC = window.HotspotCards;
    var examples = {
      destBtn: [
        { name: 'Kealakehe WTP', distance: 23.0,
          sub: 'fresh today · 1 target' },
        { name: 'Waikoloa Village hotspot', distance: 2.5,
          sub: 'Older evidence · last report 3 days ago · 2 targets' },
        { name: 'Puako Petroglyph trail', distance: 4.1,
          sub: 'Older evidence · last report 5 days ago · 1 target' },
        { name: 'Holoholokai Beach Park', distance: 4.8,
          sub: 'Older evidence · last report 4 days ago · 1 target' },
        { name: 'Puʻu Lāʻau / Palila Discovery Trail', distance: 19.0,
          sub: 'Older evidence · last report 6 days ago · 1 target' }
      ],
      excBtn: [
        { name: "Pu'u O'o Trail / Kipuka Ainahou", distance: 36.8,
          sub: 'half day · fresh today · 10 targets' },
        { name: 'Laupahoehoe Point County Park', distance: 42.0,
          sub: 'half day · Older evidence · last report 8 days ago · 7 targets' },
        { name: 'Offshore Honokōhau Marina', distance: 29.6,
          sub: 'half day · boat trip · fresh today · 1 target' }
      ],
      fullDayBtn: [
        { name: 'Hilo gardens', distance: 49.4,
          sub: 'full day · Older evidence · last report 3 days ago' },
        { name: 'Volcano Steam Vents', distance: 49.4,
          sub: 'full day · Older evidence · last report 4 days ago' }
      ]
    }[at];
    var facts = {
      destBtn: ['14 target species · rarity-weighted score 21',
        '9 target species · rarity-weighted score 14'],
      quickBtn: ['8 minutes from Home · 12 targets',
        '17 minutes from Home · 9 targets'],
      targetsBtn: ['Nearest report of Western Sandpiper',
        'Nearest report of Solitary Sandpiper'],
      stakeHsBtn: ['42 checklists across 18 days · 11 regulars',
        '31 checklists across 14 days · 8 regulars'],
      iconicBtn: ['Western Kingbird · 12.4× its county rate',
        'Yellow-breasted Chat · 8.7× its county rate'],
      hotBtn: ['16 observers · 3.1× its recent norm',
        '11 observers · 2.7× its recent norm'],
      coldBtn: ['214 all-time species · quiet for 5 days',
        '187 all-time species · quiet for 7 days'],
      favResults: ['SAVED · 14 target species',
        'SAVED · 9 target species']
    }[at] || ['14 target species · 62 recent reports',
      '9 target species · unusually active today'];
    if (examples) {
      return examples.map(function (row, i) {
        return HC.medium({
          num: i + 1, name: row.name, distance: row.distance, sub: row.sub
        });
      });
    }
    return [
      HC.medium({ num: 1, name: 'Marymoor Park — Bird Loop',
        distance: 8.4, sub: facts[0] }),
      HC.medium({ num: 2, name: 'Cedar River Mouth',
        distance: 17.2, sub: facts[1] })
    ];
  }
  function fillHotspotHost(host, window, label, at) {
    var rows = hotspotRows(window, at);
    if (host.tagName === 'UL') {
      host.className = 'obs hscards hscards-medium mockfixture';
      host.innerHTML = rows.join('');
    } else {
      host.innerHTML = window.HotspotCards.list('medium', rows, 'mockfixture');
    }
    markHost(host, label);
  }
  function fillChecklistHost(host, window, label, at) {
    var CC = window.ChecklistCards;
    var second = at === 'convoyBtn'
      ? 'Shared route · Marymoor → Union Bay'
      : 'Two independent parties';
    var rows = [
      CC.medium({ num: 1, place: 'Marymoor Park — Bird Loop',
        species: 62, date: 'Sep 2 8:14 AM', who: 'Sample Birder' }),
      CC.medium({ num: 2, place: 'Union Bay Natural Area',
        species: 48, date: 'Sep 2 7:42 AM', who: second })
    ];
    if (host.tagName === 'UL') {
      host.className = 'cklcards cklcards-md mockfixture';
      host.innerHTML = rows.join('');
    } else {
      host.innerHTML = CC.list('medium', rows, 'mockfixture');
    }
    markHost(host, label);
  }
  async function fillStakeoutSpecies(A, document, label, placeCount, options) {
    options = options || {};
    var code = options.code || 'semsan';
    var name = options.name || 'Semipalmated Sandpiper';
    var W = document.defaultView;
    var previousFetch = W.fetch;
    W.fetch = function (url) {
      if (String(url).indexOf('/data/obs/US-WA/recent/' + code) >= 0) {
        var n = placeCount || 2;
        var names = options.places || ['Marymoor Park', 'Cedar River Mouth'];
        var rows = Array.from({ length: n }, function (_, i) {
          return {
            speciesCode: code, comName: name,
            locId: 'L' + (i + 1),
            locName: names[i] || 'Representative hotspot ' + (i + 1),
            lat: 47.70 + i / 100, lng: -122.16,
            obsDt: '2026-09-' + (i % 2 ? '01' : '02') + ' 08:'
              + String(i).padStart(2, '0'),
            howMany: (i % 4) + 1, subId: 'S' + (i + 1), obsValid: true
          };
        });
        return Promise.resolve({
          ok: true, status: 200,
          json: function () { return Promise.resolve(rows); },
          text: function () { return Promise.resolve(JSON.stringify(rows)); }
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: function () { return Promise.resolve({}); },
        text: function () { return Promise.resolve('{}'); }
      });
    };
    try {
      await A.lookupSpecies(code, name, null, null, null,
        options.finderContext || null);
      await new Promise(function (resolve) { setTimeout(resolve, 75); });
    } finally {
      W.fetch = previousFetch;
    }
    if (A.fgProgressReset) A.fgProgressReset();
    markHost(document.getElementById('spLookupIdHelp'), label);
  }
  function megaFixture(code, name, sci) {
    var f = JSON.parse(JSON.stringify(MEGA_STAKEOUT));
    function convert(row) {
      row.speciesCode = code;
      row.comName = name;
      if (row.sciName) row.sciName = sci;
      return row;
    }
    f.species = { code: code, name: name, sciName: sci };
    f.alertRows = f.alertRows.map(convert);
    f.stateRows = f.stateRows.map(convert);
    f.wideRows = f.wideRows.map(convert);
    f.finderChecklist.obs = f.finderChecklist.obs.map(convert);
    return f;
  }
  function seedMegaFixture(A, f) {
    localStorage.setItem('ebird_aba_sid', f.sid);
    var gbif = {};
    gbif[f.species.sciName + '|Washington'] = {
      at: Date.now(),
      v: {
        records: f.gbif.records, years: f.gbif.years,
        first: f.gbif.first, last: f.gbif.last,
        wide: f.gbif.wide, states: f.gbif.states,
        topState: f.gbif.topState, topPct: f.gbif.topPct
      }
    };
    gbif['edge|Washington'] = { at: Date.now(), v: f.gbif.edge };
    localStorage.setItem('ebird_gbif_v1', JSON.stringify(gbif));
    var wiki = {};
    wiki[f.species.name] = {
      title: f.species.name,
      extract: f.wikipedia.extract.replace(/white wagtail/ig,
        f.species.name.toLowerCase())
    };
    localStorage.setItem('ebird_birdinfo_v2', JSON.stringify(wiki));
    A.abaArchiveAdd(f.region, [f.sentinelArchiveRow].concat(f.stateRows));
  }
  function fillMegaIndex(A, document, label, code, name, sci) {
    var f = megaFixture(code || 'nazboo1', name || 'Nazca Booby', sci || 'Sula granti');
    var second = megaFixture('solsan', 'Solitary Sandpiper', 'Tringa solitaria');
    second.alertRows.concat(second.stateRows, second.wideRows).forEach(function (row) {
      row.obsDt = '2026-09-02 12:00';
      row.lat = 47.66;
      row.lng = -122.12;
    });
    var alertRows = f.alertRows.concat(second.alertRows);
    var url = 'https://ebird.org/alert/summary?sid=' + f.sid;
    var meta = {
      reportSlug: f.reportSlug, region: f.region, sid: f.sid, scope: f.scope,
      wideRowsByCode: (function () {
        var out = {};
        out[f.species.code] = f.wideRows;
        out[second.species.code] = second.wideRows;
        return out;
      }())
    };
    localStorage.removeItem(A.ABA_ARCHIVE_KEY);
    seedMegaFixture(A, f);
    A.abaArchiveAdd(f.region, second.stateRows);
    A.setAbaScope('state');
    A.setAbaSort('date');
    function repaint() {
      A.renderAbaAlert(alertRows, url, true, A.abaScope() === 'aba', meta, repaint);
      markHost(document.getElementById('abaResults'), label);
    }
    repaint();
    return f;
  }
  function fillRankingHost(host, label) {
    host.innerHTML = '<div class="ranktable mockfixture">'
      + '<div class="rankrow rankhdr"><span class="rk">#</span>'
      + '<span class="who">Birder</span><span class="mv"></span>'
      + '<span class="n">Species</span></div>'
      + '<div class="rankrow"><span class="rk">1</span>'
      + '<span class="who"><span class="wholine">Ada Lovelace</span></span>'
      + '<span class="mv up">▲ 3</span><span class="n">1,204</span></div>'
      + '<div class="rankrow rankme"><span class="rk">182</span>'
      + '<span class="who"><span class="wholine">Sample Birder '
      + '<span class="star">you</span></span></span>'
      + '<span class="mv">—</span><span class="n">209</span></div></div>';
    markHost(host, label);
  }
  function fillMapHost(map, label) {
    if (!map) return;
    map.innerHTML = '<div class="mockmap">MAP FIXTURE · ' + label
      + '<br><span>① near · ② farther</span></div>';
    map.setAttribute('data-mock-map', 'true');
  }
  function fillWeather(document, host, label) {
    var sun = document.getElementById('wxSun');
    var tides = document.getElementById('wxTides');
    if (sun) sun.innerHTML = '<div class="mockrow"><b>☀ Sunrise 6:31 AM</b>'
      + 'Civil light begins 5:58 AM · sunset 7:42 PM</div>';
    if (tides) tides.innerHTML = '<table class="wxtable"><caption>'
      + 'Representative tide windows</caption><tbody>'
      + '<tr><th scope="row">8:10 AM</th><td>⬆ Rising tide</td><td>3.2 ft</td></tr>'
      + '<tr><th scope="row">10:35 AM</th><td>High tide</td><td>8.7 ft</td></tr>'
      + '</tbody></table>';
    host.innerHTML = '<div class="mockfixture"><div class="mockrow">'
      + '<b>63°F · light southwest wind</b>'
      + 'GOOD WINDOW · daylight and incoming tide overlap</div></div>';
    markHost(host, label);
  }
  function fillBirdcast(host, label, A) {
    A.renderBirdcast(new Date('2026-09-09T19:00:00Z'));
    var note = host.ownerDocument.createElement('div');
    note.className = 'mocklabel';
    note.textContent = 'REPRESENTATIVE LINK-ONLY VIEW · ' + label
      + ' · no BirdCast data is fetched';
    host.insertBefore(note, host.firstChild);
    markHost(host, label);
  }
  function fillHelp(host, label) {
    host.innerHTML = '<div class="mockfixture">'
      + '<div class="mocklabel">REPRESENTATIVE STUB DATA · ' + label + '</div>'
      + '<details class="helpitem" open><summary><span class="helpglyph">🔔</span>'
      + '<span class="helpname">Bird gen</span>'
      + '<span class="helpone">Fresh bird news in one ranked feed</span></summary>'
      + '<div class="helpdoc"><p><b>Reads:</b> recent alerts, leaderboard and hotspot activity.</p>'
      + '<p><b>Limit:</b> incomplete sources are labelled rather than treated as empty.</p>'
      + '</div></details><details class="helpitem"><summary>'
      + '<span class="helpglyph">🥚</span><span class="helpname">Nemesis birds</span>'
      + '<span class="helpone">Common birds you still need</span>'
      + '</summary></details></div>';
    markHost(host, label);
  }
  function fixtureBefore(at, A, document) {
    if (at === 'spLookupBtn') {
      A.setSpuhModel(document.defaultView.Spuh.createFromTaxonomy(window.FIX.spuhRows));
      if (A.setSpuhRandom) A.setSpuhRandom(function () { return 0; });
    }
    if (at === 'surgeBtn') {
      var speciesSeed = localStorage.getItem('ebird_species_v2:US-WA');
      if (speciesSeed) {
        localStorage.setItem('ebird_species_v2:' + A.getObsRegion(), speciesSeed);
      }
      localStorage.setItem('ebird_aba_archive_v1', JSON.stringify({
        'US-WA': {
          'nazboo1|S386937523': {
            speciesCode: 'nazboo1', comName: 'Nazca Booby',
            obsDt: '2026-08-25 15:00', locName: 'Smith Island',
            locId: 'L7706326', subId: 'S386937523',
            lat: 48.318233, lng: -122.8410187
          },
          'nazboo1|S388997009': {
            speciesCode: 'nazboo1', comName: 'Nazca Booby',
            obsDt: '2026-09-01 17:50', locName: 'Smith Island',
            locId: 'L7706326', subId: 'S388997009',
            lat: 48.318233, lng: -122.8410187
          },
          'ruff|S364231306': {
            speciesCode: 'ruff', comName: 'Ruff',
            obsDt: '2026-06-27 15:39', locName: 'Boe Road',
            locId: 'L4983233', subId: 'S364231306',
            lat: 48.2104382, lng: -122.3513031
          },
          'ruff|S387190304': {
            speciesCode: 'ruff', comName: 'Ruff',
            obsDt: '2026-08-26 12:37', locName: 'Hoquiam STP',
            locId: 'L264861', subId: 'S387190304',
            lat: 46.9732093, lng: -123.9165354
          },
          'ruff|S387782679': {
            speciesCode: 'ruff', comName: 'Ruff',
            obsDt: '2026-08-28 15:50', locName: 'Hoquiam STP',
            locId: 'L264861', subId: 'S387782679',
            lat: 46.9732093, lng: -123.9165354
          }
        }
      }));
      localStorage.setItem('ebird_mega_snapshot_v1', JSON.stringify({
        at: Date.now(), region: 'US-WA', sid: 'SN10489',
        rows: [
          { speciesCode: 'nazboo1', comName: 'Nazca Booby',
            obsDt: '2026-09-01 17:50', locName: 'Smith Island',
            locId: 'L7706326', subId: 'S388997009',
            lat: 48.318233, lng: -122.8410187 },
          { speciesCode: 'ruff', comName: 'Ruff',
            obsDt: '2026-08-28 15:50', locName: 'Hoquiam STP',
            locId: 'L264861', subId: 'S387782679',
            lat: 46.9732093, lng: -123.9165354 }
        ]
      }));
    }
  }
  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
  async function waitFor(find, label) {
    for (var i = 0; i < 50; i++) {
      var found = find();
      if (found) return found;
      await wait(20);
    }
    throw new Error('fixture timed out waiting for ' + label);
  }
  async function fixturePrepare(at, spec, A, document, sec) {
    ensureMockStyle(document);
    if (Date.now() !== MOCK_NOW) throw new Error('Release mock clock is not frozen');
    if (A.progressEnd) A.progressEnd();
    if (!spec || !spec.kind || !spec.host) throw new Error('no fixture spec for ' + at);
    delete sec.dataset.mockReady;
    delete sec.dataset.mockStatic;
    sec.dataset.mockAt = at;
    var label = (sec._label || at).replace(/^\\S+\\s+/, '');
    var host = document.getElementById(spec.host);
    if (!host || (host !== sec && !sec.contains(host))) {
      throw new Error('fixture host ' + spec.host + ' is not inside ' + at);
    }
    host.removeAttribute('data-mock-data');
    fixtureStatus(sec, label);
    if (spec.kind === 'static') {
      if (A.fgProgressReset) A.fgProgressReset();
      sec.dataset.mockReady = 'true';
      sec.dataset.mockStatic = 'true';
      return true;
    }
    host.innerHTML = '';
    if (spec.kind === 'birdgen') {
      var reportSeen = A.getReportSeen();
      if (!reportSeen.baisan || reportSeen.amgplo) {
        throw new Error('Washington seen fixture did not reach getReportSeen');
      }
      if (window.__SEED_BIRDLIST__.seenByReport.wa.yearList.length
          !== WA_SEEN_STUB.speciesObserved) {
        throw new Error('Washington year-list fixture total is not 215');
      }
      localStorage.setItem('ebird_hotspots_v2:US-WA', JSON.stringify({
        at: Date.now(),
        rows: [
          { locId: 'LHOT', name: 'Cedar River mouth', lat: 47.49, lng: -122.22 }
        ]
      }));
      A.renderSurge(
        [], [
          { species: 'Common Tern', code: 'comter', alpha: 'COTE',
            birders: [
              { name: 'Mike & MerryLynn Denny', rank: 33 },
              { name: 'RJ Baltierra', rank: 61 }
            ],
            latest: '2026-09-02 14:19',
            recent: [
              { obsDt: '2026-09-02 14:19',
                locName: 'Seattle-Winslow Ferry (Kitsap Co.)',
                locId: 'LFERRY', lat: 47.61, lng: -122.43, subId: 'S389100001' }
            ] }
        ], [
          { loc: 'Cedar River mouth', locId: 'LHOT', observers: 8, ratio: 14,
            reason: 'surge', latest: '2026-09-02 15:40',
            eventAt: Date.parse('2026-09-02T15:40:00-07:00') }
        ], [
          { code: 'amgplo', name: 'American Golden-Plover', sightings: 4,
            nPlaces: 4, distMi: 21.9, locName: 'Tulalip Bay',
            locId: 'L802523', lat: 48.0545637, lon: -122.2884498,
            subId: 'S389016661', latestSubId: 'S389016661',
            latestStr: '2026-09-01 17:10',
            latestLocName: 'Tulalip Bay', latestLocId: 'L802523',
            latestLat: 48.0545637, latestLon: -122.2884498, latestDistMi: 21.9 },
          { code: 'vesspa', name: 'Vesper Sparrow', sightings: 12,
            nPlaces: 12, distMi: 14.3, locName: 'Jefferson Park, Seattle',
            locId: 'L14245785', lat: 47.5704544, lon: -122.310873,
            subId: 'S389010339', latestSubId: 'S389010339',
            latestStr: '2026-09-01 16:12',
            latestLocName: 'Jefferson Park, Seattle', latestLocId: 'L14245785',
            latestLat: 47.5704544, latestLon: -122.310873, latestDistMi: 14.3 }
        ], [],
        { mega: 'ok', observations: 'ok', leaderboard: 'ok', hotspots: 'ok' },
        [
          { locId: 'LPATCH', locName: 'Marymoor Park', lat: 47.66, lng: -122.12,
            dist: 8.4, score: 18, rare: 2, band: 'high yield',
            species: [
              { code: 'shtsan', comName: 'Sharp-tailed Sandpiper', rare: true,
                count: 1, dateStr: '2026-09-02 16:05', subId: 'SP1' },
              { code: 'norwat', comName: 'Northern Waterthrush', rare: true,
                count: 1, dateStr: '2026-09-02 15:20', subId: 'SP2' }
            ] }
        ]);
      var alertRows = Array.prototype.slice.call(
        document.querySelectorAll('#surgeFeed > [data-species-code]'));
      var visibleCodes = alertRows.filter(function (row) {
        return !row.hidden;
      }).map(function (row) { return row.getAttribute('data-species-code'); });
      var hiddenCodes = alertRows.filter(function (row) {
        return row.hidden;
      }).map(function (row) { return row.getAttribute('data-species-code'); });
      if (visibleCodes.join(',') !== 'nazboo1,amgplo,vesspa,comter'
          || hiddenCodes.join(',') !== 'ruff') {
        throw new Error('Bird Gen fixture species/filter state drifted: visible='
          + visibleCodes.join(',') + ' hidden=' + hiddenCodes.join(','));
      }
      var megaAge = document.querySelector(
        '#surgeFeed > [data-species-code="nazboo1"] .surgeage');
      if (!megaAge || megaAge.textContent.trim() !== '24hr ago') {
        throw new Error('Bird Gen fixture age drifted: expected 24hr ago, got '
          + (megaAge ? megaAge.textContent.trim() : 'no age'));
      }
      var toggleGroups = document.querySelectorAll('#surgeResults .surgesortrow .sortpick');
      if (toggleGroups.length !== 2
          || Math.abs(toggleGroups[0].getBoundingClientRect().top
            - toggleGroups[1].getBoundingClientRect().top) > 1) {
        throw new Error('Bird Gen toggle pairs wrapped at the exact mockup width');
      }
      if (document.querySelector('[data-surge-notes], .surgenotesrow, .surgenote')) {
        throw new Error('Bird Gen release fixture still contains the removed Notes UI');
      }
      if (document.querySelector('#surgeFeed details')) {
        throw new Error('Bird Gen release fixture still contains a report drawer');
      }
      if (/Who added it/i.test(document.getElementById('surgeFeed').textContent)) {
        throw new Error('Bird Gen release fixture still uses Who added it');
      }
      if (/&amp;/.test(document.getElementById('surgeFeed').textContent)) {
        throw new Error('Bird Gen release fixture displays an encoded HTML entity');
      }
      if (!document.querySelector('#surgeFeed [data-alert-kind="hotspot"]')
          || !document.querySelector('#surgeFeed [data-alert-kind="patch"]')) {
        throw new Error('Bird Gen release fixture is missing HOTSPOT or TOP PATCH');
      }
      var cards = Array.prototype.slice.call(document.querySelectorAll('#surgeFeed > li'));
      if (!cards.length || cards.some(function (row) {
        return !row.querySelector(':scope > .name > .ntext > .sub > .surgefacts')
          || !row.querySelector(':scope > .surgeexplain > b');
      })) throw new Error('Bird Gen release fixture lost its second or third line');
      var mega = document.querySelector('#surgeFeed [data-species-code="nazboo1"]');
      var megaFacts = mega && mega.querySelector('.surgefacts');
      if (!megaFacts || megaFacts.textContent.replace(/\\s+/g, ' ').trim()
          !== 'NABO x1 - Smith Island - 9/1 5:50p') {
        throw new Error('Bird Gen MEGA fact line drifted from the approved markup: '
          + (megaFacts ? megaFacts.textContent.replace(/\\s+/g, ' ').trim() : 'missing')
          + ' HTML=' + (megaFacts ? megaFacts.innerHTML : 'missing'));
      }
      if (!mega.querySelector(':scope > .surgeexplain > .surgebadge')
          || mega.querySelector(':scope > .surgeexplain > .surgebadge').textContent.trim()
            !== 'MEGA'
          || !mega.querySelector('.surgeexplain > b')
          || mega.querySelector('.surgeexplain > b').textContent.trim()
            !== 'An unseen ABA Code 3+ is within a day trip!') {
        throw new Error('Bird Gen MEGA explanation drifted from the approved markup');
      }
      if (mega.querySelector(':scope > .name .surgebadge')) {
        throw new Error('Bird Gen category badge returned beside the bird name');
      }
      if (mega.querySelector('[data-sec="sec-abaBtn"]')) {
        throw new Error('Bird Gen still links to All Mega rarities');
      }
      if (document.querySelector('#surgeResults [data-sec="sec-lastNewBtn"]')) {
        throw new Error('Bird Gen still links to Leader Board Ticks');
      }
      if (document.querySelector('#surgeFeed .rarebadge')) {
        throw new Error('Bird Gen still displays the R rare-bird marker');
      }
      if (getComputedStyle(megaFacts.querySelector('.spalpha')).marginLeft !== '0px') {
        throw new Error('Bird Gen bird code keeps inherited leading space');
      }
      markHost(host, label);
    } else if (at === 'rankBtn') {
      localStorage.setItem('ebird_rankhist:US-WA', JSON.stringify([
        { d: '2026-08-20', rank: 170, species: 206 },
        { d: '2026-08-28', rank: 170, species: 208 },
        { d: '2026-09-02', rank: 178, species: 209 }
      ]));
      A.renderRankings(window.FIX.rankings, 'US-WA',
        'https://ebird.org/top100', 'Sample Birder');
      var seasonBest = document.querySelector('#rankSummary .rankbest');
      if (!seasonBest
          || seasonBest.textContent.replace(/\\s+/g, ' ').trim()
            !== 'Season best #170 · first reached Aug 20') {
        throw new Error('Top 100 release fixture lost the first season-best date: '
          + (seasonBest
            ? seasonBest.textContent.replace(/\\s+/g, ' ').trim()
            : 'missing'));
      }
      markHost(host, label);
    } else if (spec.kind === 'patches') {
      A.loadChoicePatches();
      fixtureStatus(sec, label);
      markHost(host, label);
    } else if (spec.kind === 'mega-index') {
      fillMegaIndex(A, document, label);
    } else if (spec.kind === 'stakeout-merged') {
      await prepareBirdFinderMerged(A, document, sec);
    } else if (spec.kind === 'migration') {
      localStorage.setItem(A.firstYearKey('US-WA', 2026), JSON.stringify({
        day: A.todayStr(), region: 'US-WA', year: 2026, declared: 2,
        rows: [
          {
            code: 'nazboo1', name: 'Nazca Booby', sci: 'Sula granti',
            count: 1, sensitive: false, date: '2026-08-25',
            observedAt: '2026-08-25 15:00', subId: 'S386937523',
            observer: 'Carrington Stephenson', locId: 'L7706326',
            locName: 'Smith Island', county: 'Island', isPrivate: false
          },
          {
            code: 'gyrfal', name: 'Gyrfalcon', sci: 'Falco rusticolus',
            count: 1, sensitive: true, date: '', observedAt: '', subId: '',
            observer: '', locId: '', locName: '', county: '', isPrivate: false
          }
        ]
      }));
      localStorage.setItem('ebird_mig_wa', JSON.stringify({
        samples: { 'wa|2025-09-03': ['semsan'] },
        names: { semsan: 'Semipalmated Sandpiper' },
        updated: '2026-09-02T18:00:00-07:00'
      }));
      localStorage.setItem('ebird_species_v2:US-WA', JSON.stringify({
        at: Date.now(),
        rows: [
          { code: 'semsan', name: 'Semipalmated Sandpiper',
            sci: 'Calidris pusilla', alpha: 'sesa' },
          { code: 'shtsan', name: 'Sharp-tailed Sandpiper',
            sci: 'Calidris acuminata', alpha: 'stsa' }
        ]
      }));
      localStorage.setItem(A.dueBackKey('US-WA', 'Washington'), JSON.stringify({
        at: Date.now(),
        done: {
          'Calidris pusilla': { day: '09-05', records: 2400, months: 5 },
          'Calidris acuminata': { day: '09-07', records: 420, months: 4 }
        }
      }));
      await A.loadMigration();
      await waitFor(function () {
        var firstText = document.getElementById('migFirstResults').textContent;
        var forecastText = document.getElementById('migResults').textContent;
        return /Nazca Booby/.test(firstText) && /Gyrfalcon/.test(firstText)
          && /Semipalmated Sandpiper/.test(forecastText)
          && /Sharp-tailed Sandpiper/.test(forecastText)
          && /county history/.test(forecastText)
          && /bundled GBIF/.test(forecastText);
      }, 'On passage first reports and both forecast sources');
      markHost(host, label);
    } else if (spec.kind === 'bird') {
      fillSpeciesHost(host, document.defaultView, label, at);
    } else if (spec.kind === 'hotspot' || spec.kind === 'hotspot-search') {
      fillHotspotHost(host, document.defaultView, label, at);
    } else if (spec.kind === 'species-search') {
      fillSpeciesHost(host, document.defaultView, label, at);
    } else if (spec.kind === 'checklists') {
      fillChecklistHost(host, document.defaultView, label, at);
    } else if (spec.kind === 'ranking') {
      fillRankingHost(host, label);
    } else if (spec.kind === 'weather') {
      fillWeather(document, host, label);
    } else if (spec.kind === 'birdcast') {
      fillBirdcast(host, label, A);
    } else if (spec.kind === 'help') {
      fillHelp(host, label);
    } else {
      throw new Error('unsupported fixture kind ' + spec.kind + ' for ' + at);
    }
    if (at === 'fullDayBtn') {
      sec.querySelector('.status').textContent =
        '2 full-day options · 18 counties · all 36 recent/notable feeds checked';
    } else if (at === 'myYearBody') {
      sec.querySelector('.status').textContent =
        'Recent checklist check complete · newly harvested birds included';
    }
    fillMapHost(spec.map ? document.getElementById(spec.map) : null, label);
    if (A.fgProgressReset) A.fgProgressReset();
    else if (A.progressEnd) A.progressEnd();
    await wait(25);
    sec.dataset.mockReady = 'true';
    return true;
  }
  async function prepareCompare(A, document, sec) {
    ensureMockStyle(document);
    fixtureStatus(sec, 'Stakeout bird comparison');
    await fillStakeoutSpecies(A, document, 'Stakeout bird comparison');
    var detail = await waitFor(function () {
      return document.querySelector('#spLookupIdHelp .spuhtaxnav');
    }, 'Stakeout taxonomy navigator');
    var compare = await waitFor(function () {
      return detail.querySelector('details.spuhcompare');
    }, 'Spuh comparison disclosure');
    var path = detail.querySelector('details.spuhtaxdetails');
    if (!path) throw new Error('missing collapsed identification path');
    path.open = true;
    compare.open = true;
    compare.dispatchEvent(new document.defaultView.Event('toggle'));
    var query = await waitFor(function () {
      return compare.querySelector('.spuhcompareq');
    }, 'Spuh comparison input');
    query.value = 'Solitary Sandpiper';
    compare.querySelector('.spuhcompareadd').click();
    var add = await waitFor(function () {
      return compare.querySelector('[data-add="solsan"]');
    }, 'Solitary Sandpiper candidate');
    add.click();
    await waitFor(function () {
      return compare.querySelector('.spuhcompareresult .spuhbest');
    }, 'shared Spuh result');
    fillMapHost(document.getElementById('spLookupMap'), 'Stakeout bird comparison');
    var host = document.getElementById('spLookupIdHelp');
    markHost(host, 'Stakeout bird comparison');
    sec.dataset.mockAt = 'spLookupBtn';
    sec.dataset.mockReady = 'true';
    return true;
  }
  async function prepareStakeoutReports(A, document, sec) {
    ensureMockStyle(document);
    fixtureStatus(sec, 'Stakeout bird recent hotspots');
    await fillStakeoutSpecies(A, document, 'Stakeout bird recent hotspots', 30);
    var more = await waitFor(function () {
      return document.querySelector('#spLookupResults .spLookupMore');
    }, 'Stakeout Show more control');
    more.click();
    await waitFor(function () {
      return document.querySelectorAll(
        '#spLookupResults .spLookupPlaceList > .hscard-sm').length === 30;
    }, 'expanded Stakeout hotspot rows');
    if (A.fgProgressReset) A.fgProgressReset();
    var host = document.getElementById('spLookupResults');
    markHost(host, 'Stakeout bird recent hotspots');
    sec.dataset.mockAt = 'spLookupBtn';
    sec.dataset.mockReady = 'true';
    return true;
  }
  async function prepareBirdFinderMerged(A, document, sec) {
    ensureMockStyle(document);
    fixtureStatus(sec, 'Stakeout bird merged proposal');
    await prepareBirdSp(A, document, sec, 'calidr');
    await fillStakeoutSpecies(A, document, 'Stakeout bird selected candidate', 2, {
      code: 'wessan',
      name: 'Western Sandpiper',
      places: ['Smith Island', 'Crockett Lake'],
      finderContext: {
        query: 'peep sp.',
        code: 'wessan',
        name: 'Western Sandpiper'
      }
    });
    if (document.getElementById('spLookup').value !== 'Western Sandpiper') {
      throw new Error('selected Stakeout mock still shows the peep sp. query');
    }
    fillMapHost(document.getElementById('spLookupMap'),
      'Western Sandpiper recent places');
    markHost(document.getElementById('spLookupIdHelp'),
      'Stakeout bird merged proposal');
    sec.dataset.mockAt = 'spLookupBtn';
    sec.dataset.mockReady = 'true';
    return true;
  }
  async function prepareBirdSp(A, document, sec, nodeCode) {
    ensureMockStyle(document);
    nodeCode = nodeCode || 'bird1';
    var examples = [
      ['amerob', 'American Robin', 'Turdus migratorius'],
      ['amecro', 'American Crow', 'Corvus brachyrhynchos'],
      ['mallar3', 'Mallard', 'Anas platyrhynchos'],
      ['cangoo', 'Canada Goose', 'Branta canadensis'],
      ['sonspa', 'Song Sparrow', 'Melospiza melodia'],
      ['bkcchi', 'Black-capped Chickadee', 'Poecile atricapillus'],
      ['eursta', 'European Starling', 'Sturnus vulgaris'],
      ['glwgul', 'Glaucous-winged Gull', 'Larus glaucescens'],
      ['spotow', 'Spotted Towhee', 'Pipilo maculatus'],
      ['annhum', 'Anna\\'s Hummingbird', 'Calypte anna'],
      ['norfli', 'Northern Flicker', 'Colaptes auratus'],
      ['daejun', 'Dark-eyed Junco', 'Junco hyemalis'],
      ['houfin', 'House Finch', 'Haemorhous mexicanus'],
      ['bewwre', 'Bewick\\'s Wren', 'Thryomanes bewickii'],
      ['amegfi', 'American Goldfinch', 'Spinus tristis'],
      ['whcspa', 'White-crowned Sparrow', 'Zonotrichia leucophrys'],
      ['killde', 'Killdeer', 'Charadrius vociferus'],
      ['cedwax', 'Cedar Waxwing', 'Bombycilla cedrorum'],
      ['baleag', 'Bald Eagle', 'Haliaeetus leucocephalus'],
      ['osprey', 'Osprey', 'Pandion haliaetus'],
      ['stejay', 'Steller\\'s Jay', 'Cyanocitta stelleri'],
      ['bushti', 'Bushtit', 'Psaltriparus minimus'],
      ['rethaw', 'Red-tailed Hawk', 'Buteo jamaicensis'],
      ['calgul', 'California Gull', 'Larus californicus'],
      ['ribgul', 'Ring-billed Gull', 'Larus delawarensis'],
      ['wooduc', 'Wood Duck', 'Aix sponsa'],
      ['wessan', 'Western Sandpiper', 'Calidris mauri'],
      ['sposan', 'Spotted Sandpiper', 'Actitis macularius'],
      ['norsho', 'Northern Shoveler', 'Spatula clypeata'],
      ['semsan', 'Semipalmated Sandpiper', 'Calidris pusilla']
    ];
    var taxonomy = examples.map(function (row, index) {
      var scolop = row[0] === 'wessan' || row[0] === 'semsan'
        || row[0] === 'sposan';
      var gull = row[0] === 'calgul' || row[0] === 'ribgul';
      var plover = row[0] === 'killde';
      var charadriiform = scolop || gull || plover;
      return {
        speciesCode: row[0], comName: row[1], sciName: row[2],
        category: 'species',
        order: charadriiform ? 'Charadriiformes' : 'Aves',
        familySciName: scolop ? 'Scolopacidae'
          : (gull ? 'Laridae' : (plover ? 'Charadriidae' : 'Aves')),
        familyComName: scolop ? 'Sandpipers and Allies'
          : (gull ? 'Gulls, Terns, and Skimmers'
            : (plover ? 'Plovers and Lapwings' : 'Birds')),
        taxonOrder: index + 1
      };
    });
    var peepExtras = [
      ['leasan', 'Least Sandpiper', 'Calidris minutilla'],
      ['baisan', 'Baird\\'s Sandpiper', 'Calidris bairdii'],
      ['whrsan', 'White-rumped Sandpiper', 'Calidris fuscicollis'],
      ['pecsan', 'Pectoral Sandpiper', 'Calidris melanotos'],
      ['shtsan', 'Sharp-tailed Sandpiper', 'Calidris acuminata'],
      ['dunlin', 'Dunlin', 'Calidris alpina'],
      ['sander', 'Sanderling', 'Calidris alba'],
      ['cursan', 'Curlew Sandpiper', 'Calidris ferruginea'],
      ['stisan', 'Stilt Sandpiper', 'Calidris himantopus'],
      ['rocsan', 'Rock Sandpiper', 'Calidris ptilocnemis'],
      ['pursan', 'Purple Sandpiper', 'Calidris maritima'],
      ['bubsan', 'Buff-breasted Sandpiper', 'Calidris subruficollis'],
      ['redkno', 'Red Knot', 'Calidris canutus'],
      ['grekno', 'Great Knot', 'Calidris tenuirostris'],
      ['brbsan', 'Broad-billed Sandpiper', 'Calidris falcinellus'],
      ['litsti', 'Little Stint', 'Calidris minuta'],
      ['temsti', 'Temminck\\'s Stint', 'Calidris temminckii'],
      ['lotsti', 'Long-toed Stint', 'Calidris subminuta'],
      ['rensti', 'Red-necked Stint', 'Calidris ruficollis'],
      ['spbsan1', 'Spoon-billed Sandpiper', 'Calidris pygmaea'],
      ['ruff', 'Ruff', 'Calidris pugnax'],
      ['surfbi', 'Surfbird', 'Calidris virgata']
    ];
    taxonomy = taxonomy.concat(peepExtras.map(function (row, index) {
      return {
        speciesCode: row[0], comName: row[1], sciName: row[2],
        category: 'species', order: 'Charadriiformes',
        familySciName: 'Scolopacidae',
        familyComName: 'Sandpipers and Allies',
        taxonOrder: examples.length + index + 1
      };
    }));
    for (var familyIndex = 0; familyIndex < 73; familyIndex++) {
      taxonomy.push({
        speciesCode: 'scofix' + familyIndex,
        comName: 'Scolopacidae fixture ' + (familyIndex + 1),
        sciName: 'Scolopfixture' + familyIndex + ' species',
        category: 'species', order: 'Charadriiformes',
        familySciName: 'Scolopacidae',
        familyComName: 'Sandpipers and Allies',
        taxonOrder: 2000 + familyIndex
      });
    }
    for (var orderIndex = 0; orderIndex < 291; orderIndex++) {
      taxonomy.push({
        speciesCode: 'charfix' + orderIndex,
        comName: 'Charadriiformes fixture ' + (orderIndex + 1),
        sciName: 'Charfixture' + orderIndex + ' species',
        category: 'species', order: 'Charadriiformes',
        familySciName: 'Charfamily' + orderIndex,
        familyComName: 'Charadriiformes family ' + (orderIndex + 1),
        taxonOrder: 3000 + orderIndex
      });
    }
    for (var avesIndex = 0; avesIndex < 10751; avesIndex++) {
      taxonomy.push({
        speciesCode: 'avesfix' + avesIndex,
        comName: 'Aves fixture ' + (avesIndex + 1),
        sciName: 'Avesfixture' + avesIndex + ' species',
        category: 'species', order: 'Otherorder' + avesIndex,
        familySciName: 'Otherfamily' + avesIndex,
        familyComName: 'Other family ' + (avesIndex + 1),
        taxonOrder: 4000 + avesIndex
      });
    }
    taxonomy = taxonomy.concat([
      {
        speciesCode: 'bird1', comName: 'bird sp.', sciName: 'Aves sp.',
        category: 'spuh', order: '', familySciName: '',
        familyComName: '', taxonOrder: 1000
      },
      {
        speciesCode: 'shoreb1', comName: 'shorebird sp.',
        sciName: 'Charadriiformes sp. (shorebird sp.)', category: 'spuh',
        order: 'Charadriiformes', familySciName: '',
        familyComName: '', taxonOrder: 1002
      },
      {
        speciesCode: 'largesh', comName: 'large shorebird sp.',
        sciName: 'Charadriiformes sp. (large shorebird sp.)', category: 'spuh',
        order: 'Charadriiformes', familySciName: '',
        familyComName: '', taxonOrder: 1002.5
      },
      {
        speciesCode: 'scolop2', comName: 'Scolopacidae sp.',
        sciName: 'Scolopacidae sp.', category: 'spuh',
        order: 'Charadriiformes', familySciName: 'Scolopacidae',
        familyComName: 'Sandpipers and Allies', taxonOrder: 1003
      },
      {
        speciesCode: 'calsp', comName: 'Calidris sp.',
        sciName: 'Calidris sp.', category: 'spuh',
        order: 'Charadriiformes', familySciName: 'Scolopacidae',
        familyComName: 'Sandpipers and Allies', taxonOrder: 1004
      },
      {
        speciesCode: 'calidr', comName: 'peep sp.',
        sciName: 'Calidris sp. (peep sp.)', category: 'spuh',
        order: 'Charadriiformes', familySciName: 'Scolopacidae',
        familyComName: 'Sandpipers and Allies', taxonOrder: 1005
      }
    ]);
    localStorage.setItem('ebird_species_v2:US-WA', JSON.stringify({
      at: Date.now(),
      rows: examples.map(function (row) {
        return { code: row[0], name: row[1], sci: row[2] };
      })
    }));
    var commonness = examples.map(function (row) {
      return { speciesCode: row[0] };
    });
    var oldFetch = document.defaultView.fetch;
    document.defaultView.fetch = function (url) {
      if (/data\\/obs\\/US-WA\\/recent\\?back=30&maxResults=10000/.test(String(url))) {
        return Promise.resolve({
          ok: true, status: 200,
          headers: { get: function () { return null; } },
          json: function () { return Promise.resolve(commonness); },
          text: function () { return Promise.resolve(JSON.stringify(commonness)); }
        });
      }
      return oldFetch.apply(this, arguments);
    };
    A.setSpuhModel(document.defaultView.Spuh.createFromTaxonomy(taxonomy));
    document.getElementById('spLookup').value =
      nodeCode === 'calidr' ? 'peep sp.' : 'bird sp.';
    try {
      await A.renderSpuhNode(nodeCode);
    } finally {
      document.defaultView.fetch = oldFetch;
    }
    var host = document.getElementById('spLookupQueryHelp');
    var list = host.querySelector('.spuhcandidatecards');
    var more = host.querySelector('.spuhcandidatemore');
    var expectedRows = nodeCode === 'calidr' ? 2 : 25;
    if (!list || list.children.length !== expectedRows) {
      throw new Error((nodeCode === 'calidr' ? 'peep sp.' : 'bird sp.')
        + ' did not paint its regional bird list');
    }
    if (/\b\d+ recent reports?\b|Most reported/i.test(host.textContent)) {
      throw new Error('Stakeout candidate presence became a false report count');
    }
    if (nodeCode === 'calidr' ? !!more
        : (!more || more.textContent.trim() !== 'Show 5 more of 30 birds')) {
      throw new Error((nodeCode === 'calidr' ? 'peep sp.' : 'bird sp.')
        + ' has the wrong Show-more state');
    }
    if (nodeCode === 'calidr'
        && !/11,167 birds in its published set[\\s\\S]*392 birds in its published set[\\s\\S]*98 birds in its published set[\\s\\S]*24 birds in its published set/.test(
          host.querySelector('.spuhresultdetails').textContent)) {
      throw new Error('peep sp. does not reproduce its measured taxonomic backbone');
    }
    markHost(host, 'Stakeout bird regional '
      + (nodeCode === 'calidr' ? 'peep sp.' : 'bird sp.') + ' candidates');
    sec.dataset.mockAt = 'spLookupBtn';
    sec.dataset.mockReady = 'true';
    return true;
  }
  function assertDetailedHierarchyLayout(document) {
    var root = document.querySelector(
      '#spLookupQueryHelp .spuhresultdetails[open] .spuhtaxsteps');
    var levels = root ? [].slice.call(root.querySelectorAll(
      ':scope > .spuhtaxstep')) : [];
    if (!levels.length) throw new Error('detailed hierarchy has no visible levels');
    levels.forEach(function (level) {
      var marker = level.querySelector(':scope > .spuhtaxmarker');
      var content = level.querySelector(':scope > .spuhtaxstepbody');
      if (!marker || !content) {
        throw new Error('detailed hierarchy level is missing its marker or label');
      }
      var markerRect = marker.getBoundingClientRect();
      var contentRect = content.getBoundingClientRect();
      if (markerRect.right > contentRect.left - 5) {
        throw new Error('detailed hierarchy marker overlaps a label: marker right '
          + markerRect.right.toFixed(1) + ', label left '
          + contentRect.left.toFixed(1));
      }
      if (content.scrollWidth > content.clientWidth + 0.5) {
        throw new Error('detailed hierarchy label overflows its column');
      }
    });
    var heading = document.querySelector('#spLookupQueryHelp .spuhhierarchyhead h3');
    if (!heading || heading.scrollWidth > heading.clientWidth + 0.5
        || heading.getClientRects().length > 1) {
      throw new Error('taxonomic hierarchy heading wraps or clips');
    }
  }
  window.FIX = {
    before: fixtureBefore,
    prepare: fixturePrepare,
    prepareCompare: prepareCompare,
    prepareStakeoutReports: prepareStakeoutReports,
    prepareBirdFinderMerged: prepareBirdFinderMerged,
    prepareBirdSp: prepareBirdSp,
    assertDetailedHierarchyLayout: assertDetailedHierarchyLayout,
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
    },
    spuhRows: (function () {
      function s(code, name, sci, order, family, n, familyCom) {
        return { speciesCode: code, comName: name, sciName: sci,
          category: 'species', order: order, familySciName: family,
          familyComName: familyCom || family, taxonOrder: n };
      }
      function u(code, name, sci, order, family, n, familyCom) {
        return { speciesCode: code, comName: name, sciName: sci,
          category: 'spuh', order: order, familySciName: family,
          familyComName: familyCom || family, taxonOrder: n };
      }
      return [
        s('semsan', 'Semipalmated Sandpiper', 'Calidris pusilla',
          'Charadriiformes', 'Scolopacidae', 1, 'Sandpipers and Allies'),
        s('wessan', 'Western Sandpiper', 'Calidris mauri',
          'Charadriiformes', 'Scolopacidae', 2, 'Sandpipers and Allies'),
        s('solsan', 'Solitary Sandpiper', 'Tringa solitaria',
          'Charadriiformes', 'Scolopacidae', 3, 'Sandpipers and Allies'),
        s('lesyel', 'Lesser Yellowlegs', 'Tringa flavipes',
          'Charadriiformes', 'Scolopacidae', 4, 'Sandpipers and Allies'),
        s('ribgul', 'Ring-billed Gull', 'Larus delawarensis',
          'Charadriiformes', 'Laridae', 5),
        s('calgul', 'California Gull', 'Larus californicus',
          'Charadriiformes', 'Laridae', 6),
        s('mallar3', 'Mallard', 'Anas platyrhynchos',
          'Anseriformes', 'Anatidae', 7, 'Ducks, Geese, and Waterfowl'),
        u('bird1', 'bird sp.', 'Aves sp.', '', '', 100),
        u('charad', 'Charadriiformes sp.', 'Charadriiformes sp.',
          'Charadriiformes', '', 101),
        u('shoreb1', 'shorebird sp.', 'Charadriiformes sp. (shorebird sp.)',
          'Charadriiformes', '', 102),
        u('largesh', 'large shorebird sp.',
          'Charadriiformes sp. (large shorebird sp.)',
          'Charadriiformes', '', 102.5),
        u('scolop2', 'Scolopacidae sp.', 'Scolopacidae sp.',
          'Charadriiformes', 'Scolopacidae', 103, 'Sandpipers and Allies'),
        u('calsp', 'Calidris sp.', 'Calidris sp.',
          'Charadriiformes', 'Scolopacidae', 104),
        u('calidr', 'peep sp.', 'Calidris sp. (peep sp.)',
          'Charadriiformes', 'Scolopacidae', 105),
        u('trinsp', 'Tringa sp.', 'Tringa sp.',
          'Charadriiformes', 'Scolopacidae', 106),
        u('larsp', 'Larus sp.', 'Larus sp.',
          'Charadriiformes', 'Laridae', 107)
      ];
    }())
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

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' timed out after ' + ms + 'ms')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
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

  let cleaned = false;
  const kill = () => {
    if (cleaned) return;
    if (process.platform === 'win32') {
      try { spawnSync('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
      try {
        spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
          "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
          + "Where-Object { $_.CommandLine -like '*" + path.basename(profile)
          + "*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force "
          + "-ErrorAction Stop } catch {} }"], { stdio: 'ignore' });
      } catch (e) {}
    } else {
      try { process.kill(-ch.pid, 'SIGKILL'); }
      catch (e) { try { ch.kill('SIGKILL'); } catch (e2) {} }
      try { spawnSync('pkill', ['-9', '-f', path.basename(profile)], { stdio: 'ignore' }); }
      catch (e) {}
    }
    for (let i = 0; i < 10 && fs.existsSync(profile); i++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
      if (fs.existsSync(profile)) {
        const until = Date.now() + 200;
        while (Date.now() < until) { /* wait for Windows file handles */ }
      }
    }
    cleaned = !fs.existsSync(profile);
    if (!cleaned) {
      console.error('MOCKUP CHROME LEAK: profile still exists at ' + profile);
    }
  };
  process.once('exit', kill);

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
  await c.send('Emulation.setTimezoneOverride', {
    timezoneId: 'America/Los_Angeles',
  }, sessionId);
  await c.send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/__harness' }, sessionId);
  await new Promise((r) => setTimeout(r, 2500));

  const shots = ONLY.length
    ? SHOTS.concat(REVIEW_SHOTS).filter((s) => ONLY.includes(s.id)) : SHOTS;
  const made = [], blank = [];
  for (const shot of shots) {
    let measuredHostHeight = null;
    // Everything runs INSIDE the iframe, which is the box with the real width.
    // ⚠️ Do NOT declare a local named `document` here: `var` hoists, so the
    // first line would dereference the local (undefined) rather than the outer
    // document, and the whole expression throws before it starts.
    const expr = `(async function () {
      var frame = window.document.getElementById('f');
      if (!frame) return 'no iframe';
      var w = frame.contentWindow;
      var A = w.__app, doc = w.document;
      if (!A) return 'no __app seam (the app did not boot)';
      try { await (async function (document, FIX) { ${shot.prep} })(doc, w.FIX); }
      catch (e) { return 'prep: ' + (e && e.message || e); }
      var scrollTarget = ${JSON.stringify(shot.scrollTo || '')}
        ? doc.querySelector(${JSON.stringify(shot.scrollTo || '')}) : null;
      if (scrollTarget && scrollTarget.scrollIntoView) {
        var scrollY = scrollTarget.getBoundingClientRect().top + w.scrollY;
        w.scrollTo(0, Math.max(0, scrollY - 180));
      } else {
        w.scrollTo(0, 0);
      }
      return 'ok';
    })()`;
    const r = await withTimeout(
      c.send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: true
      }, sessionId),
      15000,
      shot.id + ' preparation'
    );
    const verdict = r.result && r.result.value;
    if (verdict !== 'ok') {
      console.error('  !! ' + shot.id + ': ' + verdict);
      continue;
    }
    await new Promise((r2) => setTimeout(r2, 700));
    if (shot.at) {
      const readyProbe = await c.send('Runtime.evaluate', {
        expression: `(function () {
          var d = document.getElementById('f').contentDocument;
          var anchor = d.getElementById(${JSON.stringify(shot.at)});
          var sec = anchor && anchor.closest ? anchor.closest('section') : null;
          if (!sec) return JSON.stringify({ error: 'missing section' });
          var host = d.getElementById(${JSON.stringify(shot.host || '')});
          if (!host) return JSON.stringify({ error: 'missing result host' });
          function visible(el) {
            if (!el || el.hidden) return false;
            var s = el.ownerDocument.defaultView.getComputedStyle(el);
            var r = el.getBoundingClientRect();
            return s.display !== 'none' && s.visibility !== 'hidden'
              && r.width > 0 && r.height > 0;
          }
          var hr = host.getBoundingClientRect();
          var globalLoading = visible(d.getElementById('loadBar'));
          var loading = [].slice.call(sec.querySelectorAll(
            '.status,.hint,[aria-busy="true"]')).filter(function (el) {
              return visible(el)
                && /^\\s*(loading|reading|ranking|sampling|scanning|collecting|finding|looking|refreshing)\\b/i
                  .test(el.textContent || '');
            }).map(function (el) { return (el.textContent || '').trim().slice(0, 80); });
          var allowedDisabled = ${JSON.stringify(shot.allowDisabled || [])};
          var disabled = [].slice.call(sec.querySelectorAll('button:disabled'))
            .filter(function (el) {
              return visible(el) && !allowedDisabled.some(function (selector) {
                return el.matches(selector);
              });
            }).map(function (el) { return el.id || el.textContent.trim(); });
          var map = ${JSON.stringify(shot.map || '')}
            ? d.getElementById(${JSON.stringify(shot.map || '')}) : null;
          var expected = ${JSON.stringify(shot.expects || [])};
          var missing = expected.filter(function (selector) {
            return !d.querySelector(selector);
          });
          return JSON.stringify({
            at: sec.dataset.mockAt || '',
            ready: sec.dataset.mockReady === 'true',
            isStatic: sec.dataset.mockStatic === 'true',
            sectionVisible: visible(sec),
            hostVisible: visible(host),
            data: host.getAttribute('data-mock-data') === 'true',
            hostHeight: +hr.height.toFixed(1),
            text: (host.innerText || '').replace(/\\s+/g, ' ').trim().length,
            controls: host.querySelectorAll('button,input,select,a[href],details').length,
            inCapture: hr.bottom > 0 && hr.top < ${HEIGHT},
            globalLoading: globalLoading,
            loading: loading,
            disabled: disabled,
            missing: missing,
            mapReady: !map || (visible(map) && map.getAttribute('data-mock-map') === 'true'),
            signature: host.innerHTML.length + ':' + host.childElementCount
          });
        })()`, returnByValue: true }, sessionId);
      const ready = JSON.parse(readyProbe.result.value || '{}');
      ready.expectedAt = shot.at;
      ready.maxHostHeight = shot.maxHostHeight || 0;
      measuredHostHeight = ready.hostHeight;
      const readinessProblems = shotReadinessProblems(ready);
      if (readinessProblems.length) {
        console.error('  !! ' + shot.id + ': STUB NOT READY — '
          + readinessProblems.join(', ') + ' · ' + JSON.stringify(ready)
          + '. The active section, not the footer, must '
          + 'carry representative data.');
        blank.push(shot.id);
        continue;
      }
      await new Promise((r2) => setTimeout(r2, 150));
      const stableProbe = await c.send('Runtime.evaluate', {
        expression: `(function () {
          var d = document.getElementById('f').contentDocument;
          var host = d.getElementById(${JSON.stringify(shot.host || '')});
          return host ? host.innerHTML.length + ':' + host.childElementCount : '';
        })()`, returnByValue: true }, sessionId);
      if (stableProbe.result.value !== ready.signature) {
        console.error('  !! ' + shot.id + ': FIXTURE CHANGED AFTER READY — '
          + ready.signature + ' -> ' + stableProbe.result.value);
        blank.push(shot.id);
        continue;
      }
    }
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
    // ⚠️ F248. A GENERATOR THAT SILENTLY EMITS A BLANK PAGE IS WORSE THAN
    // NONE — it is the F197 failure in picture form: a check that reports
    // success by never looking. A shot can go blank without any error at all
    // (a prep that no longer matches the DOM, a section that renders empty
    // offline), and a folder of white rectangles would be trusted exactly as
    // much as a folder of real ones.
    //
    // Measured on the surface, not on the file: PNG size is a poor proxy —
    // an all-white 393x1400 image compresses to a few KB, but so does a
    // legitimately sparse screen. What distinguishes them is CONTENT, so the
    // page is asked how much it actually painted.
    const probe = await c.send('Runtime.evaluate', {
      expression: `(function () {
        var d = document.getElementById('f').contentDocument;
        if (!d || !d.body) return JSON.stringify({ text: 0, nodes: 0 });
        var root = ${JSON.stringify(shot.at || '')}
          ? (function () {
              var a = d.getElementById(${JSON.stringify(shot.at || '')});
              return a && a.closest ? a.closest('section') : null;
            }())
          : d.getElementById('menuPanel');
        if (!root) return JSON.stringify({ text: 0, nodes: 0 });
        return JSON.stringify({
          text: (root.innerText || '').replace(/\\s+/g, ' ').trim().length,
          nodes: root.querySelectorAll('*').length
        });
      })()`, returnByValue: true }, sessionId);
    const seen = JSON.parse(probe.result.value || '{}');
    // The menu is a large grid; a section may intentionally be compact. The
    // stricter per-host readiness check above carries the data guarantee.
    if (shotLooksBlank(seen, !!shot.at || !!shot.menuState)) {
      console.error('  !! ' + shot.id + ': BLANK — only ' + (seen.text || 0)
        + ' chars and ' + (seen.nodes || 0) + ' elements painted. The shot was '
        + 'NOT written; fix the prep rather than shipping a white rectangle.'
        + ' (A previous good PNG is left in place — the run exits non-zero and'
        + ' says so, because destroying good output to record a failure would'
        + ' lose both.)');
      blank.push(shot.id);
      continue;
    }
    fs.writeFileSync(path.join(OUT, name), Buffer.from(png.data, 'base64'));
    made.push({ name, title: shot.title, h });
    console.log('  ' + name.padEnd(28) + WIDTH + 'x' + h
      + (shot.maxHostHeight ? ' · result host ' + measuredHostHeight + 'px' : ''));
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
  if (blank.length) {
    console.error('BLANK SHOTS: ' + blank.join(', ')
      + ' — a mockup folder you cannot trust is worse than none.');
  }
  process.exit(made.length === shots.length ? 0 : 1);
}

module.exports = {
  CONTRACT, STUB_SPEC, SECTION_SHOTS, EXTRA_SHOTS, REVIEW_SHOTS, SHOTS,
  fixtureIconPath, shotReadinessProblems, shotLooksBlank, withTimeout
};

if (require.main === module) {
  main().catch((e) => {
    console.error('mockups: ' + (e && e.message || e));
    process.exit(1);
  });
}
