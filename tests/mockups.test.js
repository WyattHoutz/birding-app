'use strict';
/*
 * F280 — release mockups cover the actual Contents contract.
 *
 * The first generator named eight screenshots by hand. A new menu section
 * could therefore ship with no mockup, and a blank data panel still passed
 * because the navbar/footer made the whole page nonempty. These guards derive
 * the expected shots from the same contract the app menu uses.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'assets', 'mockups.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8');
const sectionsSource = fs.readFileSync(path.join(ROOT, 'www', 'sections.html'), 'utf8');
const alertSource = fs.readFileSync(
  path.join(ROOT, 'assets', 'mockup-alertfeed.js'), 'utf8');
const workflow = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'ios-build.yml'), 'utf8');
const postWorkflowPath = path.join(
  ROOT, '.github', 'workflows', 'post-release.yml');
const postWorkflow = fs.existsSync(postWorkflowPath)
  ? fs.readFileSync(postWorkflowPath, 'utf8')
  : '';
const pkg = require(path.join(ROOT, 'package.json'));
const mockups = require(path.join(ROOT, 'assets', 'mockups.js'));
const waSeen = require(path.join(
  ROOT, 'tests', 'fixtures', 'wa-seen-2026-stub.json'));

test('F359 mockup preparation timeout rejects a hung fixture by shot name', async () => {
  await assert.rejects(
    mockups.withTimeout(new Promise(() => {}), 5, 'section-spLookupBtn preparation'),
    /section-spLookupBtn preparation timed out after 5ms/
  );
});

test('F830 Twitches preparation acquires exact personal membership before rendering', () => {
  const twitch = source.slice(source.indexOf('async function prepareTwitches('),
    source.indexOf('async function waitFor(', source.indexOf('async function prepareTwitches(')));
  assert.match(twitch, /await preparePersonalFixture\(A, document\.defaultView,/);
  assert.ok(twitch.indexOf('await preparePersonalFixture(') < twitch.indexOf('A.refresh()'));
  assert.doesNotMatch(twitch, /disabled\s*=\s*false|allowDisabled/);
  assert.equal(typeof mockups.preparePersonalFixture, 'function');
  const birdGen = source.slice(source.indexOf("if (spec.kind === 'birdgen')"),
    source.indexOf("} else if (at === 'rankBtn')"));
  assert.match(birdGen, /await preparePersonalFixture\(A, document\.defaultView,/);
  const rank = source.slice(source.indexOf("} else if (at === 'rankBtn')"),
    source.indexOf("} else if (spec.kind === 'patches')"));
  assert.match(rank, /A\.bcProfile\(\), A\.identityRevision\(\), 'Sample Birder'/);
  assert.match(rank, /'ebird_rankhist:' \+ historyOwner/);
  assert.match(rank, /'bc_board_v1:' \+ historyOwner/);
  assert.match(rank, /A\.renderRankPair\(\{boards:\{spp:speciesBoard,cl:checklistBoard\}/);
  assert.match(rank, /Top 100 gallery lost production dual-board controls/);
});

test('release mockups include exactly one section shot per visible menu entry', () => {
  const expected = mockups.CONTRACT.menu.map((item) => item.at).sort();
  const actual = mockups.SECTION_SHOTS.map((shot) => shot.at).sort();
  assert.deepEqual(actual, expected,
    'the screenshot set must derive from report-contract.json, not a hand list');
  assert.equal(new Set(actual).size, actual.length, 'no menu section is rendered twice');
  assert.equal(mockups.SHOTS.length,
    1 + mockups.CONTRACT.menu.length + mockups.EXTRA_SHOTS.length,
    'Contents + every section + explicit extra states');
  assert.deepEqual(mockups.REVIEW_SHOTS.map((shot) => shot.id),
    ['nearby-competitors-f857', 'nuthatch-icons-f829', 'stakeoutreachable-f389', 'stakeoutdistance-f389',
    'stakeoutchecklists-progressive', 'stakeoutmixed-f634', 'stakeoutpins-f837',
    'stakeoutspts-notes-off', 'stakeoutspts-notes-on', 'stakeoutnotes-popup',
      'onboardingregion', 'onboardinghome',
      'birdgenloading', 'hawaiiemptybirdgen', 'hawaiiemptyticks',
      'abayearrefresh', 'favoritesregion', 'spuhcompact', 'birdspcompact',
      'birdspdetail', 'spuhdetail', 'spuhinfo',
      'stakeoutreports', 'megaaba', 'meganearest',
      'f629-nightly', 'f629-birdgen', 'f630-birdgen-top'],
    'focused review states stay available without inflating the release contract');
  assert.equal(mockups.REVIEW_SHOTS.find((shot) => shot.id === 'spuhcompact')
    .maxHostHeight, undefined,
  'the approved medium-card peep result is still capped by the superseded layout');
});

test('F506 release mockups require the full Stakeout card with Notes off and on', () => {
  const notesOff = mockups.SECTION_SHOTS.find((item) => item.at === 'spLookupBtn');
  const notesOn = mockups.EXTRA_SHOTS.find((item) => item.id === 'stakeoutdetail');
  assert.ok(notesOff && notesOn, 'both mandatory Stakeout Notes states are registered');
  assert.ok(notesOff.expects.includes(
    '#spLookupResults.stakeoutSpeciesCard-details > li'));
  assert.ok(notesOn.expects.includes(
    '#spLookupResults.stakeoutSptsMock.stakeoutSpeciesCard-details'));
  assert.ok(notesOn.expects.includes('#spLookupResults .bchero'));
  assert.equal(notesOn.fullPage, true,
    'Notes on must capture its complete evidence and Iconic-hotspot page');
  assert.equal(notesOn.freshApp, true,
    'Notes on must not inherit Notes-off lookup state in the release gallery');
  assert.match(source, /Sharp-tailed Sandpiper Stakeout/);
  assert.match(source, /userDisplayName: 'Kellie Sagen'/);
  assert.match(source, /durationHrs: 1 \+ 14 \/ 60/);
  assert.match(source, /observationComments:/);
  assert.match(source, /prepareStakeoutSpts\(A, document, sec, true\)/);
  const mockStyle = source.slice(
    source.indexOf('function ensureMockStyle'),
    source.indexOf('function mockPhoto'));
  assert.doesNotMatch(mockStyle, /stakeoutSpeciesCard|bchero|stakeoutPlaceDetails/,
    'release fixtures must not restyle the production species/checklist cards');
  assert.match(postWorkflow,
    /for VARIANT in iphone-11 iphone-17-pro iphone-17-pro-large iphone-17-pro-max-magnification/,
    'post-release must verify every required device variant');
  assert.doesNotMatch(indexSource, /stakeoutSpeciesCard-compact/,
    'the removed top-level Compact Stakeout card is still shipped');
  assert.match(indexSource, /#spLookupMap \{ aspect-ratio: 16 \/ 7; \}/);
});

test('every menu section declares representative fixture data or an intentional static surface', () => {
  const expected = mockups.CONTRACT.menu.map((item) => item.at).sort();
  const declared = Object.keys(mockups.STUB_SPEC).sort();
  assert.deepEqual(declared, expected,
    'a new menu entry must choose a stub kind before the release gallery passes');

  const allowed = new Set([
    'birdgen', 'weather', 'bird', 'ranking', 'hotspot', 'favorites', 'species-search',
    'hotspot-search', 'stakeout-merged', 'mega-index', 'patches',
    'checklists', 'birdcast', 'help', 'migration', 'foy', 'static',
  ]);
  for (const shot of mockups.SECTION_SHOTS) {
    assert.ok(allowed.has(shot.kind),
      `${shot.at} has no supported representative fixture kind`);
    assert.ok(shot.host, `${shot.at} has no real result host`);
    assert.match(shot.prep, /FIX\.before\(/, `${shot.at} skips fixture setup`);
    assert.match(shot.prep, /FIX\.prepare\(/, `${shot.at} never paints fixture data`);
  }
  const staticAts = mockups.SECTION_SHOTS
    .filter((shot) => shot.kind === 'static').map((shot) => shot.at).sort();
  assert.deepEqual(staticAts, ['settingsPanel'],
    'only genuinely data-free documentation/settings surfaces may skip stub rows');
});

test('F607 BirdCast mockups seed the production level and county-count surfaces', () => {
  assert.doesNotMatch(source, /18,400 birds\/km|HIGH migration|northwest winds 7 mph/,
    'the release gallery must not retain old fabricated BirdCast copy');
  assert.doesNotMatch(sectionsSource, /42,000 birds\/km|Peak 01:00|mostly NNE/,
    'the section catalog still claims unsupported BirdCast detail');
  assert.match(source, /forecast:\s*\{\s*level:\s*'High'/,
    'the mockup does not seed the representative official forecast level');
  assert.match(source, /birds:\s*1825700/,
    'the mockup does not seed the representative county total');
  assert.match(source, /A\.renderBirdcast\(new Date\('2026-09-09T19:00:00Z'\), snapshot\)/,
    'the mockup does not render the production BirdCast surface with deterministic data');
  assert.doesNotMatch(indexSource, /Tonight\\u2019s forecast|Tonight’s forecast/);
  assert.doesNotMatch(indexSource, /Lights Out guidance|birdcast\.org\/lights-out/);
  assert.match(indexSource, /Live migration map/);
  assert.match(source, /migrants:\s*\[/,
    'the mockup does not seed representative expected migrants');
  assert.match(indexSource, /Migration watch/);
  assert.match(indexSource, /migration-event-proof/);
  assert.match(indexSource, /SpeciesCards\.list\('small'/,
    'expected migrants do not use the shared small species card renderer');
  assert.match(source, /REPRESENTATIVE BIRDCAST DATA/);
  assert.match(indexSource, /class="birdcast-alert-icon"/);
  assert.match(indexSource, /class="birdcast-alert-count"/);
});

test('F207/F318 review mockups render the actual missing-region and missing-Home steps', () => {
  const region = mockups.REVIEW_SHOTS.find((shot) => shot.id === 'onboardingregion');
  const home = mockups.REVIEW_SHOTS.find((shot) => shot.id === 'onboardinghome');
  assert.equal(region.menuState, true,
    'a legitimate sparse first-run menu uses the explicit menu-state threshold');
  assert.match(region.prep, /A\.setActiveReport\(''\)/);
  assert.match(region.prep, /regionChooseBtn/);
  assert.match(home.prep, /A\.homeKey\('lat'\)/);
  assert.match(home.prep, /homeHereBtn/);
});

test('blank detection inspects the active section and requires its data marker', () => {
  assert.match(source, /sec\.dataset\.mockReady === 'true'/,
    'the active section must declare that its fixture finished');
  assert.match(source, /host\.getAttribute\('data-mock-data'\) === 'true'/,
    'the configured real result host must contain representative data');
  assert.match(source, /problems\.push\('blank static surface'\)/,
    'footer/navbar text cannot make a thin static section pass');
  assert.match(source, /problems\.push\('blank data surface'\)/,
    'footer/navbar text cannot make an unmarked data section pass');
  assert.match(source, /problems\.push\('loading'\)/,
    'visible loading states fail the shot');
  assert.match(source, /problems\.push\('global loading'\)/,
    'the app-wide progress bar cannot remain visible in a finished shot');
  const staticStart = source.indexOf("if (spec.kind === 'static')");
  const staticEnd = source.indexOf('host.innerHTML', staticStart);
  assert.ok(staticStart > 0 && staticEnd > staticStart,
    'the static fixture branch is bracketed by stable setup statements');
  assert.match(source.slice(staticStart, staticEnd), /A\.fgProgressReset\(\)/,
    'the static Settings fixture does not clear work left by earlier gallery shots');
  assert.match(source.slice(staticStart, staticEnd),
    /A\.LOADERS\[at\].*await A\.LOADERS\[at\]\.fn\(\)/s,
    'a loader-backed static surface is marked ready before its authored content is painted');
  assert.match(source, /problems\.push\('disabled controls'\)/,
    'visible disabled-loader states fail the shot');
  assert.match(source, /FIXTURE CHANGED AFTER READY/,
    'a later asynchronous overwrite is detected');
  assert.match(source, /STUB NOT READY/,
    'a missing fixture exits as a named failure rather than writing a blank PNG');
});

test('blank-shot decisions reject missing data instead of merely existing in source', () => {
  const ready = {
    at: 'easyBtn', expectedAt: 'easyBtn', ready: true, isStatic: false,
    sectionVisible: true, hostVisible: true, data: true, text: 120,
    controls: 2, inCapture: true, loading: [], disabled: [], missing: [],
    mapReady: true, globalLoading: false,
  };
  assert.deepEqual(mockups.shotReadinessProblems(ready), [],
    'a populated data section is ready');
  assert.deepEqual(mockups.shotReadinessProblems({ ...ready, data: false }),
    ['blank data surface'],
    'a navbar/footer cannot make an unmarked result host pass');
  assert.deepEqual(mockups.shotReadinessProblems({
    ...ready, loading: ['Loading recent reports…'],
  }), ['loading'], 'a visible loading state cannot be captured as finished');
  assert.deepEqual(mockups.shotReadinessProblems({
    ...ready, globalLoading: true,
  }), ['global loading'],
  'the app-wide eBird progress bar cannot be captured as finished');
  assert.deepEqual(mockups.shotReadinessProblems({
    ...ready, missing: ['#easyResults .hscard'],
  }), ['missing expected components'],
  'a generic card cannot replace the production shape a shot promises');
  assert.deepEqual(mockups.shotReadinessProblems({
    ...ready, hostHeight: 341, maxHostHeight: 340,
  }), ['oversized result host'],
  'a default result host that grows beyond its measured release cap fails');
  assert.deepEqual(mockups.shotReadinessProblems({
    ...ready, isStatic: true, data: false, text: 199, controls: 3, minControls: 3,
  }), ['blank static surface'],
  'a static screen still needs enough authored content');
  assert.deepEqual(mockups.shotReadinessProblems({
    ...ready, isStatic: true, data: false, text: 745, controls: 0, minControls: 0,
  }), [], 'a configured read-only static screen passes on authored content alone');

  assert.equal(mockups.shotLooksBlank({ text: 29, nodes: 20 }, true), true);
  assert.equal(mockups.shotLooksBlank({ text: 80, nodes: 4 }, true), true);
  assert.equal(mockups.shotLooksBlank({ text: 30, nodes: 5 }, true), false);
  assert.equal(mockups.shotLooksBlank({ text: 199, nodes: 120 }, false), true);
  assert.equal(mockups.shotLooksBlank({ text: 200, nodes: 100 }, false), false);

  assert.match(source, /shotReadinessProblems\(ready\)/,
    'the generator does not use the readiness decision the guard drives');
  assert.match(source, /shotLooksBlank\(seen, !!shot\.at \|\| !!shot\.menuState\)/,
    'the generator does not use the blank-pixel decision the guard drives');
});

test('fixture families use shared card components and accessible state labels', () => {
  assert.match(source, /window\.SpeciesCards/,
    'bird fixtures exercise the real shared species card');
  assert.match(source, /window\.HotspotCards/,
    'hotspot fixtures exercise the real shared hotspot card');
  assert.match(source, /window\.ChecklistCards/,
    'checklist fixtures exercise the real shared checklist card');
  assert.match(source, /REPRESENTATIVE STUB DATA/,
    'stub content labels itself rather than resembling live data');
  assert.match(source, /NEEDED|NEW REPORT/,
    'fixture states are written in words, not encoded by colour alone');
  assert.match(source, /border:2px dashed var\(--warn\)/,
    'the state also carries a non-colour border-style channel');
});

test('F504-F509 release fixtures show the current Twitches and Nemesis card contract', () => {
  const speciesFixture = source.slice(
    source.indexOf('function speciesRows('),
    source.indexOf('function fillSpeciesHost('));
  assert.match(speciesFixture, /reportTags\(at === 'refreshBtn', true\)/,
    'Twitches does not show NEW, RARE, and confirmed review state inline');
  assert.match(speciesFixture, /reportTags\(false, false\)/,
    'Nemesis does not show NEW and pending review state inline');
  assert.match(speciesFixture, /spmetricstack[\s\S]*spmetric-age[\s\S]*spmetric-distance/,
    'the release fixture does not exercise the age-first two-metric stack');
  const reportTagFixture = speciesFixture.slice(
    speciesFixture.indexOf('function reportTags('),
    speciesFixture.indexOf('function stubBird('));
  assert.doesNotMatch(reportTagFixture, /RECENT/,
    'the removed RECENT tag returned to the release fixture');
});

test('F551 Mega rarity mockups exercise the current direct photo slot and controls', () => {
  assert.equal(mockups.STUB_SPEC.abaBtn.kind, 'mega-index');
  assert.deepEqual(mockups.STUB_SPEC.abaBtn.expects, [
    '#abaControls.raritycontrols > #abaViewPick.twitchviewbar',
    '#abaViewPick + #abaStatus',
    '#abaStatus + .abascoperow',
    '#abaViewPick [data-megaview="list"][aria-pressed="true"]',
    '#abaScopePick.pressbtn[data-abascope]',
    '#abaSortPick [data-abasort="date"]',
    '#abaSortPick [data-abasort="distance"]',
    '#abaResults li[data-mega-code][data-mega-view]',
    '#abaResults li[data-mega-code] .thumb',
    '#abaResults .megajump',
    '#abaResults .spmetric-age',
    '#abaResults .spmetric-distance',
  ]);
  const setup = source.slice(source.indexOf('function fillMegaIndex('),
    source.indexOf('function fillRankingHost('));
  assert.match(setup, /A\.renderAbaAlert\(/,
    'the gallery must drive the production Mega renderer, not hand-roll its rows');
  assert.match(setup, /A\.setAbaScope\('state'\)/);
  assert.match(setup, /A\.setAbaSort\('date'\)/);
  assert.match(setup,
    /A\.renderAbaAlert\(alertRows, url, true, A\.abaScope\(\) === 'aba', meta, repaint\)/,
    'scope and sort review states must repaint the same fixture without starting a fetch');
  assert.match(setup,
    /row\.obsDt = '2026-09-02 12:00'[\s\S]*row\.lat = 47\.66[\s\S]*row\.lng = -122\.12/,
    'the Nearest review needs a genuinely closer, older row so its order visibly changes');
});

test('F797 Mega fixture status updates preserve its persistent control wrapper', () => {
  const helper = source.slice(source.indexOf('function fixtureStatus('),
    source.indexOf('function markHost('));
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(indexSource);
  try {
    const document = dom.window.document;
    const controls = document.getElementById('abaControls');
    const status = document.getElementById('abaStatus');
    const section = controls.closest('section');
    const button = document.getElementById('abaBtn');
    button.disabled = true;
    status.setAttribute('aria-busy', 'true');
    const update = new Function(helper + '; return fixtureStatus;')();
    update(section, 'Mega');
    assert.equal(document.getElementById('abaControls'), controls,
      'fixture status updates must preserve the production persistent wrapper');
    assert.equal(document.getElementById('abaStatus'), status);
    assert.match(status.textContent, /REPRESENTATIVE STUB DATA.*Mega/);
    assert.equal(status.hasAttribute('aria-busy'), false);
    assert.equal(button.disabled, false);

    const ordinary = document.createElement('section');
    ordinary.innerHTML = '<div class="status" hidden aria-busy="true">Loading</div>';
    update(ordinary, 'Other report');
    assert.match(ordinary.textContent, /REPRESENTATIVE STUB DATA.*Other report/);
    assert.equal(ordinary.querySelector('.status').hidden, false);
    assert.equal(ordinary.querySelector('.status').hasAttribute('aria-busy'), false);
  } finally {
    dom.window.close();
  }
  const preparation = source.slice(source.indexOf("} else if (spec.kind === 'mega-index')"),
    source.indexOf("} else if (spec.kind === 'stakeout-merged')"));
  assert.match(preparation, /await fillFixturePhotos\(host, document\)/,
    'the section capture must await its bundled photos, not just the extra shots');
});

test('Hawaii patch fallback mockups render in the Hawaii report', () => {
  assert.equal(mockups.STUB_SPEC.destBtn.report, 'hi');
  assert.equal(mockups.STUB_SPEC.excBtn.report, 'hi');
  for (const at of ['destBtn', 'excBtn']) {
    const shot = mockups.SECTION_SHOTS.find((item) => item.at === at);
    assert.ok(shot, `${at} release shot is missing`);
    assert.match(shot.prep,
      /A\.setActiveReport\(\(spec && spec\.report\) \|\| 'wa'\)/,
      `${at} paints Hawaii rows without switching the visible report`);
  }
  const rows = source.slice(source.indexOf('destBtn: ['),
    source.indexOf('excBtn: [', source.indexOf('destBtn: [')));
  assert.equal((rows.match(/^        \{ name:/gm) || []).length, 5,
    'Today’s patches review still shows fewer than the five useful Hawaii choices');
  const dayRows = source.slice(source.indexOf('excBtn: ['),
    source.indexOf('    }[at]', source.indexOf('excBtn: [')));
  assert.equal((dayRows.match(/\{ name:/g) || []).length, 3,
    'Day trip review does not show the two measured land localities plus the routed offshore trip');
  assert.match(dayRows, /North Pacific Ocean/);
  assert.match(dayRows, /round trip · special trip · boat required · fresh today/);
  assert.match(dayRows, /Pu'u O'o Trail/);
  assert.match(dayRows, /Laupahoehoe Point County Park/);
  assert.match(dayRows, /Older evidence · last report 8 days ago/);
  assert.doesNotMatch(rows, /North Pacific Ocean/,
    'the F389 named-ocean control leaked back into Today’s patches');
  const f389Review = mockups.REVIEW_SHOTS.filter((shot) =>
    /stakeout(?:reachable|distance)-f389/.test(shot.id));
  assert.equal(f389Review.length, 2,
    'Reachable and Distance no longer have paired F389 review states');
  assert.match(source, /Captain Zodiac pelagic—C/);
  assert.match(source, /subnational2Code: 'US-HI-007'/);
  assert.match(source, /Distance did not preserve all regional evidence/);
});

test('F329/F342/F345 release mockups show the completed new facts', () => {
  const rank = source.slice(source.indexOf("} else if (at === 'rankBtn')"),
    source.indexOf("} else if (spec.kind === 'patches')"));
  assert.match(rank, /'ebird_rankhist:' \+ historyOwner/);
  assert.match(rank, /rank:\s*170/);
  assert.match(rank, /Season best #170 · first reached Aug 20/,
    'the Top 100 release shot does not prove the earliest tied best date');

  const year = source.slice(source.indexOf("else if (at === 'myYearBody') {"),
    source.indexOf("} else if (spec.kind === 'favorites')"));
  assert.match(year, /Lewis's Woodpecker/);
  assert.match(year, /preparePersonalFixture/);
  assert.match(source, /Exact personal membership prepared · representative Year List/,
    'the My List shot must state its representative source');

  assert.match(source,
    /3 under 3h options · 1 county · all recent\/notable feeds checked/,
    'the unified Day trip release shot does not identify its selected range and completed plan');
});

test('F867 leaderboard fixture restores its synthetic profile proof before later sections', () => {
  const rank=source.slice(source.indexOf("} else if (at === 'rankBtn')"),
    source.indexOf("var metricButtons ="));
  assert.match(rank,/var priorIdentity=localStorage\.getItem\(A\.IDENTITY_META_KEY\)/);
  assert.match(rank,/if\(priorIdentity===null\) localStorage\.removeItem\(A\.IDENTITY_META_KEY\)/);
  assert.match(rank,/else localStorage\.setItem\(A\.IDENTITY_META_KEY,priorIdentity\)/);
  assert.ok(rank.indexOf('A.renderRankPair(')<rank.indexOf('if(priorIdentity===null)'),
    'restore only after the production renderer has consumed the temporary proof');
});

test('F868 and F870 gallery fixtures use production Ticks and resolved FOY taxonomy', () => {
  const ticks = source.slice(source.indexOf("else if (at === 'lastNewBtn') {"),
    source.indexOf("else if (at === 'myYearBody') {"));
  assert.match(ticks, /A\.renderLastNew\(groups,info,'US-WA',\{\}\)/);
  assert.match(ticks, /Recent birders: 2/);
  assert.match(ticks, /profileId:'tick-second-'/);
  assert.match(ticks, /await fillFixturePhotos\(host,document\)/);
  const foy = source.slice(source.indexOf("} else if (spec.kind === 'foy') {"),
    source.indexOf("} else if (spec.kind === 'bird') {"));
  assert.match(foy, /await preparePersonalFixture/);
  assert.match(foy, /await A\.loadFoy\(\)/);
  assert.match(foy, /await fillFixturePhotos\(host, document\)/);
});

test('F856 gallery guards require visible checklist evidence and scaled 56px bird icons', () => {
  assert.match(source, /renderScale = Number\(document\.defaultView\.getComputedStyle\([\s\S]*?getPropertyValue\('--s'\)\)/,
    'geometry must use the selected app profile, not the legacy renderer argument');
  const birdGen = source.slice(source.indexOf("if (spec.kind === 'birdgen')"),
    source.indexOf("} else if (at === 'rankBtn')"));
  assert.match(birdGen, /NABO x1 - Smith Island - 9\/1 5:50p · S388997009/);
  assert.match(birdGen, /megaChecklist\.getAttribute\('data-href'\) !== 'https:\/\/ebird\.org\/checklist\/S388997009'/);
  assert.match(birdGen, /deferPhotos: true/);
  assert.match(birdGen, /await fillFixturePhotos\(host, document\)/);
  const rank = source.slice(source.indexOf("} else if (at === 'rankBtn')"),
    source.indexOf("} else if (spec.kind === 'patches')"));
  for (const dimension of ['width', 'height']) {
    assert.ok(rank.includes(`Math.abs(recentThumbBox.${dimension} - 56 * renderScale) > 1`),
      `gallery does not measure ${dimension} against the scaled F851 icon size`);
  }
  assert.match(rank, /compactRowLimit = 86 \+ recentThumbBox\.height - 18 \* renderScale/);
});

test('F628 Top 100 compact-height guard allows deliberate Huge-text reflow', () => {
  const rank = source.slice(source.indexOf("} else if (at === 'rankBtn')"),
    source.indexOf("} else if (spec.kind === 'patches')"));
  assert.match(rank, /if \(renderScale <= 1 && firstRowRect\.height > compactRowLimit\)/,
    'the normal-size compact-row ceiling still rejects intentional Huge-text wrapping');
  assert.match(source,
    /async function fixturePrepare\(at, spec, A, document, sec, renderScale\)/,
    'the fixture preparation seam does not accept the gallery text scale');
  assert.match(source,
    /FIX\.prepare\(\$\{at\}, spec, A, document, sec,[\s\S]*\$\{JSON\.stringify\(SCALE\)\}\)/,
    'the browser-side fixture does not receive the requested gallery text scale');
});

test('F686 release preparation follows compact Top 100 and owns Stakeout work', () => {
  const rank = source.slice(source.indexOf("} else if (at === 'rankBtn')"),
    source.indexOf("} else if (spec.kind === 'patches')"));
  assert.doesNotMatch(rank, /visually prominent|rank-to-content gutter/,
    'the gallery still enforces F680\'s retired dominant-rank presentation');
  assert.match(rank, /compact rank column is too wide/);
  assert.match(rank, /compact column gutter is not 10px/);

  const stakeout = source.slice(source.indexOf('async function prepareStakeoutSpts'),
    source.indexOf('async function prepareBirdFinderMerged'));
  assert.match(stakeout,
    /A\.fgCancelAll\('Starting deterministic Stakeout fixture'\)/,
    'Stakeout preparation can still queue behind unrelated startup hydration');
  assert.match(stakeout, /A\.fgProgressReset\(\)/,
    'the deterministic Stakeout fixture does not clear inherited progress state');
  assert.match(source,
    /A\.seedEbirdCache\(A\.speciesLookupPath\(region, code, A\.SP_LOOKUP_BACK\),[\s\S]*sightingRows\)/,
    'Stakeout preparation can still queue its deterministic sighting behind unrelated work');
  assert.match(stakeout, /A\.seedChecklistView\(row\.subId, detail\)/,
    'Stakeout checklist hydration can still queue behind unrelated foreground work');
  assert.match(source,
    /prepTimeoutMs: item\.at === 'spLookupBtn' \? 45000 : undefined/,
    'the mandatory Stakeout capture still uses the generic 15-second preparation budget');
  assert.match(source,
    /id: 'stakeoutdetail'[\s\S]*?prepTimeoutMs: 45000/,
    'the detailed Stakeout capture still uses the generic 15-second preparation budget');
});

test('F384/F385 release mockups expose row actions and regional watch scope', () => {
  const year = source.slice(source.indexOf("else if (at === 'myYearBody') {"),
    source.indexOf("} else if (spec.kind === 'favorites')"));
  assert.match(year, /A\.updateMyYear\(\)/,
    'My List must use production rendering, not invented card fields');
  assert.match(year, /\.yrnum/);
  assert.match(year, /\.myYearWatchlist\[aria-pressed="false"\]/);
  assert.match(year, /\.myYearWatchlist\[aria-pressed="true"\]/,
    'the My Ticks release fixture does not show both watchlist states');

  const scope = source.slice(source.indexOf("if (at === 'nvResults')"),
    source.indexOf("} else {", source.indexOf("if (at === 'nvResults')")));
  assert.match(scope, /code: 'baisan'/);
  assert.match(scope, /code: 'hawama'/,
    'the Needs proof release fixture lost its preserved cross-region control');
  assert.match(scope, /scopeButtons\.length !== 1/);
  assert.match(scope, /scopeLabel\.textContent\.trim\(\) !== 'Region'/);
  assert.match(scope, /scopeButtons\[0\]\.getAttribute\('aria-pressed'\) !== 'true'/);
  assert.match(scope, /\/Hawaii Amakihi\/\.test\(host\.textContent\)/,
    'the release fixture does not reject a cross-region bird leaking into the default view');
  assert.match(scope, /1 of 2 species awaiting verification/,
    'the default Needs proof screenshot no longer discloses its hidden stored row');
  assert.deepEqual(mockups.STUB_SPEC.nvResults.allowDisabled, [],
    'Watch list no longer contains reorder controls');
});

test('F839 a captured but unreadable shot still fails the gallery run', () => {
  const {mockupRunPassed} = require('../assets/mockups');
  assert.equal(mockupRunPassed(1, 1, []), true);
  assert.equal(mockupRunPassed(1, 1, ['internal card readability']), false);
  assert.equal(mockupRunPassed(0, 1, []), false);
});

test('F372 review mockups prove empty Hawaii stays empty on both reported surfaces', () => {
  const birdGen = mockups.REVIEW_SHOTS.find((item) => item.id === 'hawaiiemptybirdgen');
  const ticks = mockups.REVIEW_SHOTS.find((item) => item.id === 'hawaiiemptyticks');
  assert.ok(birdGen, 'the empty-Hawaii Bird Gen review shot is missing');
  assert.ok(ticks, 'the empty-Hawaii My Ticks review shot is missing');
  assert.match(birdGen.prep, /A\.setActiveReport\('hi'\)/);
  assert.match(birdGen.prep, /dataset\.surgeSeen !== 'unseen'/);
  assert.match(birdGen.prep, /spotted\.hidden/);
  assert.match(ticks.prep, /A\.setActiveReport\('hi'\)/);
  assert.match(ticks.prep, /0 species in 2026/);
  assert.match(ticks.prep, /species logged/);
});

test('F373 review mockup proves ABA My Ticks uses the account year list', () => {
  const ticks = mockups.REVIEW_SHOTS.find((item) => item.id === 'abayearrefresh');
  assert.ok(ticks, 'the refreshed ABA My Ticks review shot is missing');
  assert.match(ticks.prep, /A\.setActiveReport\('aba'\)/);
  assert.match(ticks.prep, /ebird_own_seen:aba/);
  assert.match(ticks.prep, /ABA year-list refresh complete/);
  assert.match(ticks.prep, /no county scan/);
  assert.match(ticks.prep, /Ruby-throated Hummingbird/);
});

test('fixture photos use the extension of the bundled icon they render', () => {
  assert.equal(mockups.fixtureIconPath('semsan'), 'assets/birds/semsan.png',
    'Semipalmated Sandpiper is a PNG and must not render a broken JPG');
  assert.equal(mockups.fixtureIconPath('wessan'), 'assets/birds/wessan.jpg',
    'JPG fixtures keep their existing bundled source');
  assert.throws(() => mockups.fixtureIconPath('not-a-real-bird'),
    /no bundled fixture icon for not-a-real-bird/,
    'a missing fixture asset fails the generator instead of producing a broken image');
  assert.match(source, /fixtureIconPath\(code, BIRD_ICON_EXT\)/,
    'the browser fixture must use the same extension-aware resolver the test drives');
});

test('Washington mock data follows the owner-provided September 2 seen snapshot', () => {
  assert.equal(waSeen.region, 'US-WA');
  assert.equal(waSeen.asOf, '2026-09-02');
  assert.equal(waSeen.speciesObserved, 215);
  const byCode = Object.fromEntries(waSeen.birds.map((bird) => [bird.code, bird]));
  for (const code of ['baisan', 'ruff', 'sposan', 'solsan', 'wessan']) {
    assert.equal(byCode[code].seen, true, `${code} was already on the supplied list`);
  }
  for (const code of ['nazboo1', 'shtsan', 'semsan', 'norwat', 'whiwag']) {
    assert.equal(byCode[code].seen, false, `${code} was absent from the supplied list`);
  }
  assert.equal(byCode.corplo.alpha, 'CRPL',
    'Common Ringed Plover uses the eBird taxonomy code, not the invalid coripl fixture');
  assert.ok(!byCode.coripl);
  assert.match(source, /wa-seen-2026-stub\.json/,
    'the release gallery stopped reading the sanitized seen snapshot');
  assert.match(alertSource, /wa-seen-2026-stub\.json/,
    'the dedicated Bird Gen mock stopped sharing the same seen snapshot');
  assert.doesNotMatch(source, /length:\s*209/,
    'the header count is still the obsolete invented total');
  assert.match(source, /Object\.defineProperty\(window, '__SEED_BIRDLIST__'/,
    'the fixture is not injected through the seed object production actually reads');
  assert.match(source, /ebird_seen_meta[\s\S]*source:\s*'seed'/,
    'release mockups must explicitly opt into sample data now that clean installs stay empty');
  assert.match(source, /Washington seen fixture did not reach getReportSeen/,
    'the renderer never behaviorally verifies seen/unseen state');
});

test('Bird Gen mockups use the measured September 3 alert snapshot', () => {
  const setup = source.slice(source.indexOf("if (at === 'surgeBtn')"),
    source.indexOf('\n  function wait(', source.indexOf("if (at === 'surgeBtn')")));
  const paint = source.slice(source.indexOf("if (spec.kind === 'birdgen')"),
    source.indexOf("} else if (at === 'rankBtn')"));
  for (const fact of [
    'nazboo1', 'Smith Island', 'S388997009', '2026-08-25 15:00',
    'ruff', 'Hoquiam STP', 'S387782679',
  ]) {
    assert.ok(setup.includes(fact), `Bird Gen setup lost measured fact ${fact}`);
  }
  for (const fact of [
    'amgplo', 'Tulalip Bay', 'S389016661',
    'L802523', 'vesspa', 'Jefferson Park, Seattle', 'S389010339', 'L14245785',
  ]) {
    assert.ok(paint.includes(fact), `Bird Gen paint lost measured fact ${fact}`);
  }
  assert.doesNotMatch(paint, /wessan|Western Sandpiper/,
    'the current Bird Gen shot still uses the superseded invented rows');
  assert.match(alertSource, /NABO\/nazboo1|fixtureBird\('nazboo1'\)/,
    'the dedicated review mock lost the corrected NABO identifier');
  assert.match(alertSource, /fixtureBird\('amgplo'\)[\s\S]*fixtureBird\('vesspa'\)/,
    'the dedicated review mock does not include both current unseen birds');
  assert.match(source, /class MockDate extends RealDate/,
    'fixed alert dates still age against the wall clock');
  assert.match(source, /Date\.now\(\) !== MOCK_NOW/,
    'the renderer never verifies that its fixed dates use the frozen clock');
  const timezone = source.indexOf('Emulation.setTimezoneOverride');
  const navigate = source.indexOf("Page.navigate");
  assert.ok(timezone >= 0 && navigate > timezone,
    'the browser timezone is not pinned before the mockup page loads');
  assert.match(source, /timezoneId:\s*'America\/Los_Angeles'/,
    'the release fixture no longer renders in the Washington timezone');
  assert.match(source, /Bird Gen fixture age drifted[\s\S]{0,120}24hr ago/,
    'the release renderer does not behaviorally guard its approved relative age');
  assert.match(source, /visibleCodes\.join\(','\) !== 'comter,baisan,nazboo1,amgplo,vesspa'/,
    'the release gate does not assert its exact visible Bird Gen species');
  assert.match(source, /\|\| hiddenCodes\.length/,
    'the release gate no longer proves that Bird Gen hides no species');
});

test('F302 Bird Gen mockup shows the approved three-line cards', () => {
  const paint = source.slice(source.indexOf("if (spec.kind === 'birdgen')"),
    source.indexOf("} else if (spec.kind === 'spuh')"));
  for (const fact of [
    'comter', 'Common Tern', 'NABO x1 - Smith Island - 9/1 5:50p',
    'An unseen ABA Code 3+ is within a day trip!',
    'Cedar River mouth', 'Marymoor Park', 'high yield',
  ]) {
    assert.ok(paint.includes(fact), `F302 Bird Gen mockup lost ${fact}`);
  }
  assert.match(paint,
    /:scope > \.name > \.ntext > \.sub > \.surgefacts[\s\S]*:scope > \.surgeexplain > b/,
    'the release fixture does not verify the name-cell and full-width rows');
  assert.match(paint, /Bird Gen still displays the R rare-bird marker/,
    'the release fixture does not reject the removed R marker');
  assert.match(paint, /category badge returned beside the bird name/,
    'the release fixture does not pin the category badge to the explanation row');
  assert.match(paint, /bird code keeps inherited leading space/,
    'the release fixture does not pin the bird code flush-left');
  assert.match(paint, /querySelector\('#surgeFeed details'\)/,
    'the release fixture does not fail if a report drawer returns');
  assert.match(source, /visibleCodes\.join\(','\) !== 'comter,baisan,nazboo1,amgplo,vesspa'/,
    'the release gate does not assert the new Cascade row');
  assert.match(paint, /still links to All Mega rarities/,
    'the release fixture does not fail if the removed Mega link returns');
  assert.match(paint, /still links to Leader Board Ticks/,
    'the release fixture does not fail if the removed leaderboard link returns');
  assert.doesNotMatch(source, /prepareBirdGenCompact|birdgencompact/,
    'the mockup suite still carries a second Notes state that no longer exists');
});

test('F366/F369 Stakeout mockups pin the representative and presence evidence', () => {
  assert.match(source,
    /if \(A\.setSpuhRandom\) A\.setSpuhRandom\(function \(\) \{ return 0; \}\);/,
    'release mockups leave the random spuh representative nondeterministic');
  const start = source.indexOf(
    'async function prepareBirdSp(A, document, sec, nodeCode)');
  const end = source.indexOf('window.FIX =', start);
  const fixture = source.slice(start, end);
  assert.match(fixture,
    /var commonness = examples\.map\(function \(row\) \{\s*return \{ speciesCode: row\[0\] \};/,
    'the regional snapshot fixture still manufactures report frequencies');
  assert.match(fixture,
    /Stakeout candidate presence became a false report count/,
    'the release renderer does not reject invented candidate report counts');
});

test('fixture specs point at real hosts and maps in index.html', () => {
  const html = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8');
  for (const [at, spec] of Object.entries(mockups.STUB_SPEC)) {
    assert.match(html, new RegExp('id="' + spec.host + '"'),
      `${at} points at missing result host ${spec.host}`);
    if (spec.map) {
      assert.match(html, new RegExp('id="' + spec.map + '"'),
        `${at} points at missing map host ${spec.map}`);
    }
  }
  assert.match(html, /window\.__BC_MOCKUP_MODE__/,
    'the app must suppress normal autoloaders while deterministic fixtures paint');
});

test('Pro patches and Stakeout bird exercise their production component shapes', () => {
  assert.equal(mockups.STUB_SPEC.patchBtn.kind, 'patches');
  assert.deepEqual(mockups.STUB_SPEC.patchBtn.expects,
    ['#patchResults .hscard.hscard-md', '#patchResults .patchwho']);
  assert.match(source, /A\.loadChoicePatches\(\)/,
    'Pro patches must run its real loader instead of receiving a generic rank table');

  assert.equal(mockups.STUB_SPEC.spLookupBtn.kind, 'stakeout-merged');
  assert.equal(mockups.STUB_SPEC.spuhBtn, undefined,
    'the removed Spuh menu surface still owns a release fixture');
  assert.equal(mockups.STUB_SPEC.spLookupBtn.maxHostHeight, undefined,
    'the redesigned full Stakeout page is still clipped to the old hierarchy height');
  assert.equal(mockups.STUB_SPEC.spLookupBtn.host, 'sec-spLookupBtn',
    'the release capture is not anchored to the full Stakeout page');
  assert.deepEqual(mockups.STUB_SPEC.spLookupBtn.expects, [
    '#spLookupQueryHelp:empty',
    '#spLookupResults.stakeoutSpeciesCard-details > li',
    '#spLookupResults .thumb',
    '#spLookupSortRow:not([hidden])',
    '#spLookupMap .mockmap',
    '#spLookupRecent .spLookupPlaceList > .hscard-md',
    '#spLookupRecent .stakeoutPlaceDetails .cklcard-sm',
    '#spLookupEvidenceDetails .stakeoutrarity[data-kind="mega"]',
    '#spLookupIdHelp .spuhpathsentence',
    '#spLookupIdHelp .spuhpathchip[data-spuh]',
    '#spLookupIdHelp .spuhtaxnav',
    '#spLookupIdHelp .spuhcompactpath .spuhtaxlink',
    '#spLookupIdHelp details.spuhdetails',
    '#spLookupIdHelp .spuhtaxlevel[data-rank="species"]',
  ]);
  assert.match(source, /prepareBirdFinderMerged[\s\S]*fillStakeoutSpecies/,
    'the release shot does not continue a spuh candidate into species evidence');
  assert.match(source, /candidate species cards do not fit in the result/,
    'the peep mock does not reject clipped shared species cards');
  assert.match(source,
    /spuhresulthero[\s\S]*spuhcandidatecards[\s\S]*spuhcandidatecard\[role="button"\]\[tabindex="0"\]/,
  'the peep mock does not require the medium hero and keyboard-clickable small cards');
  assert.match(indexSource,
    /\.spuhresultcard\.spuhdetailopen \.spuhresultpath\s*\{[^}]*display:\s*none/,
    'expanded Detailed view still duplicates the condensed hierarchy sentence');
  assert.doesNotMatch(indexSource,
    /\.spuhdetailopen[^{}]*\.spuhcandidatelane[^{}]*\{[^}]*display:\s*none/,
    'expanded Detailed view hides the shared regional bird list');
  assert.doesNotMatch(indexSource,
    /ToggleControls\.pressed\(\{[\s\S]*id: 'spuhViewPick'[\s\S]*label: 'Compact'/,
    'the removed Compact hierarchy control is still shipped');
  assert.match(source,
    /id: 'birdspcompact'[\s\S]*id: 'birdspdetail'/,
    'the focused review set does not render both hierarchy-view selections');
  for (const id of ['spuhcompact', 'spuhdetail', 'birdspcompact', 'birdspdetail']) {
    assert.match(source, new RegExp("id: '" + id + "'"),
      id + ' is missing from the four-state hierarchy review set');
  }
  assert.match(source,
    /assertDetailedHierarchyLayout[\s\S]*marker overlaps a label/,
    'the detailed hierarchy mock does not reject a jumbled marker/label layout');
  assert.match(source,
    /spuhhierarchyhead > h3[\s\S]*spuhhierarchyinfo[\s\S]*spuhpathalternate/,
    'the peep review does not require the heading, info control, and alternatives');
  assert.match(source,
    /spuhtaxsteps > \.spuhtaxstep\[data-rank="class"\][\s\S]*data-rank="genus"/,
    'the detailed peep review does not require every numbered backbone level');
  const birdSpFixtureStart = source.indexOf(
    'async function prepareBirdSp(A, document, sec, nodeCode)');
  const birdSpFixtureEnd = source.indexOf('window.FIX =', birdSpFixtureStart);
  assert.ok(birdSpFixtureStart >= 0 && birdSpFixtureEnd > birdSpFixtureStart,
    'the regional bird-sp fixture is missing');
  const birdSpFixture = source.slice(birdSpFixtureStart, birdSpFixtureEnd);
  assert.doesNotMatch(birdSpFixture, /fixtureStatus\(/,
    'the bird-sp review mock still prints the redundant representative-stub sentence');
  assert.match(birdSpFixture, /24 birds in its published set/,
    'the peep review does not verify the measured Calidris backbone count');
  assert.doesNotMatch(birdSpFixture,
    /comName:\s*'Charadriiformes sp\.'/,
    'the mock taxonomy invents a Charadriiformes sp. node absent from the live export');
  assert.match(source, /fillStakeoutSpecies[\s\S]*A\.lookupSpecies/,
    'the merged shot hand-rolls evidence instead of exercising the real lookup');
  assert.doesNotMatch(source, /spLookupHero|details\.spuhshell|renderSpuhStakeoutShell/,
    'the release fixture must not preserve the removed duplicate hero or collapsed shell');
  assert.match(source, /detail\.querySelector\('details\.spuhtaxdetails'\)[\s\S]*path\.open = true/,
    'the comparison shot must deliberately expand the shared Detailed view');
  assert.match(source, /detail\.querySelector\('details\.spuhcompare'\)/,
    'the comparison shot opens the control inside the expanded navigator');
  assert.match(source, /prepareStakeoutReports[\s\S]*more\.click\(\)/,
    'the focused Stakeout review shot does not exercise the real lazy append');
  const reportsStart = source.indexOf('async function prepareStakeoutReports');
  const reportsEnd = source.indexOf(
    'async function prepareBirdFinderMerged', reportsStart);
  assert.ok(reportsStart > 0 && reportsEnd > reportsStart,
    'the Stakeout reports fixture is bracketed by named functions');
  assert.match(source.slice(reportsStart, reportsEnd), /A\.fgProgressReset\(\)/,
    'the lazy-expanded Stakeout fixture leaves its app-wide loading bar visible');
  assert.match(source, /ready\.missing\.length/,
    'the capture must fail if a section-specific production shape is absent');
  assert.match(source, /Bird Gen release fixture restored the removed order controls/,
    'the exact release-device renders do not guard Buzz-only ordering');
  assert.match(source, /A\.fgProgressReset\(\)/,
    'mock-only suppressed lazy calls cannot leave a fake global loading bar in the image');
  const compareStart = source.indexOf('async function prepareCompare');
  const compareEnd = source.indexOf('async function prepareStakeoutReports', compareStart);
  const compareFixture = source.slice(compareStart, compareEnd);
  assert.match(compareFixture,
    /A\.fgCancelAll\('Mock comparison complete'\)[\s\S]*A\.fgProgressReset\(\)[\s\S]*bar\.hidden[\s\S]*mockReady = 'true'/,
    'the comparison shot declares readiness before clearing its mock-only global loading state');
  const mergedStart = source.indexOf('async function prepareBirdFinderMerged');
  const mergedEnd = source.indexOf('async function prepareBirdSp', mergedStart);
  assert.ok(mergedStart > 0 && mergedEnd > mergedStart,
    'the merged Stakeout fixture is bracketed by named functions');
  const mergedFixture = source.slice(mergedStart, mergedEnd);
  assert.match(mergedFixture, /await prepareBirdSp\(A, document, sec, 'calidr'\)/,
    'the release Stakeout state bypasses the fixture that owns regional '
    + 'species/commonness data and can wait forever on the offline fetch stub');
  assert.doesNotMatch(mergedFixture, /await A\.renderSpuhNode\('calidr'\)/,
    'the release state calls the network-dependent spuh render directly');
  assert.match(source, /function withTimeout\(promise, ms, label\)/,
    'mockup preparation has no outer deadline when an in-page promise never settles');
  assert.match(source,
    /withTimeout\(\s*c\.send\('Runtime\.evaluate'[\s\S]*shot\.id \+ ' preparation'/,
    'each CDP preparation is not bounded by the shared timeout helper');

  assert.equal(mockups.STUB_SPEC.abaBtn.kind, 'mega-index');
  assert.deepEqual(mockups.STUB_SPEC.abaBtn.expects, [
    '#abaControls.raritycontrols > #abaViewPick.twitchviewbar',
    '#abaViewPick + #abaStatus',
    '#abaStatus + .abascoperow',
    '#abaViewPick [data-megaview="list"][aria-pressed="true"]',
    '#abaScopePick.pressbtn[data-abascope]',
    '#abaSortPick [data-abasort="date"]',
    '#abaSortPick [data-abasort="distance"]',
    '#abaResults li[data-mega-code][data-mega-view]',
    '#abaResults li[data-mega-code] .thumb',
    '#abaResults .megajump',
    '#abaResults .spmetric-age',
    '#abaResults .spmetric-distance',
  ]);
  assert.match(source, /fillMegaIndex[\s\S]*A\.renderAbaAlert\(/,
    'the Mega release shot must use the production list renderer');
  for (const id of ['megalist', 'twitcheslist']) {
    const shot = mockups.EXTRA_SHOTS.find((item) => item.id === id);
    assert.ok(shot, id + ' profile comparison is absent from the release gallery');
    assert.match(shot.prep, /high-visibility/);
    assert.match(shot.prep, /\.hero/);
  }
});

test('F795 Favorite mockup guards Remove placement and its 44px hit target', () => {
  assert.deepEqual(mockups.STUB_SPEC.favResults.expects, [
    '#favMap .leaflet-marker-icon',
    '#favResults .favoritecard > .name > .ntext',
    '#favResults .favoritecard > .name > .favctl > .favdel',
    '#favResults .favoritecard > .name > .favctl + .hsdist',
  ]);
  const preparation = source.slice(
    source.indexOf("} else if (spec.kind === 'favorites')"),
    source.indexOf("} else if (spec.kind === 'hotspot-search')")
  );
  assert.match(preparation, /controls\.nextElementSibling !== distance/);
  assert.match(preparation, /DOCUMENT_POSITION_FOLLOWING/);
  assert.match(preparation, /style\.minHeight !== '44px'/);
  assert.match(preparation, /style\.paddingTop !== '0px'/);
  assert.match(preparation, /style\.paddingBottom !== '0px'/);
});

test('Stakeout checklist mockup uses the unified shared small-card list', () => {
  const shot = mockups.REVIEW_SHOTS.find(
    (item) => item.id === 'stakeoutchecklists-progressive'
  );
  assert.ok(shot);
  assert.deepEqual(shot.expects, [
    '#spLookupRecent.stakeoutChecklistMock',
    '#spLookupRecent .spLookupPlaceList .cklcard-sm',
  ]);
  assert.match(indexSource,
    /function spLookupPlaceCards[\s\S]*ChecklistCards\.list\('small', rows, 'stakeoutPlaceChecklists'\)/);
  assert.doesNotMatch(indexSource, /function megaHistoryHtml/,
    'Stakeout reintroduced the second Mega-only place list');
});

test('F642 Migration mockup exercises tonight, observed arrival, and departure lanes', () => {
  const spec = mockups.STUB_SPEC.bcBody;
  assert.equal(spec.kind, 'birdcast');
  assert.equal(spec.host, 'bcBody');
  const start = source.indexOf('function fillBirdcast');
  const end = source.indexOf('function prepareF629Nightly', start);
  assert.ok(start >= 0 && end > start, 'the merged Migration fixture exists');
  const fixture = source.slice(start, end);
  for (const fact of [
    'Common Nighthawk', 'Semipalmated Sandpiper', 'American Crow',
    'firstYearKey', 'ebird_mig_wa', 'migrants:',
  ]) {
    assert.ok(fixture.includes(fact), `Migration mockup lost ${fact}`);
  }
  assert.match(fixture, /A\.renderBirdcast\(/,
    'the fixture must run the production merged renderer');
});

test('F642 Migration mockup seeds repeated county weeks instead of one-off noise', () => {
  const start = source.indexOf('function fillBirdcast');
  const end = source.indexOf('function prepareF629Nightly', start);
  const fixture = source.slice(start, end);
  assert.match(fixture, /2024-09-11[\s\S]*2025-09-10[\s\S]*amecro/,
    'the departure fixture lacks the repeated weeks required by the model');
  assert.match(fixture, /2024-09-18[\s\S]*2025-09-17[\s\S]*semsan/,
    'the arrival fixture lacks the repeated weeks required by the model');
});

test('F340 mockups and artifact checks run after, never inside, the IPA release path', () => {
  assert.equal(pkg.scripts.mockups, 'node assets/mockups.js',
    'the explicit local mockup command was removed');
  assert.doesNotMatch(workflow, /^\s{2}mockups:\s*$/m,
    'mockups moved back into the IPA workflow');
  const packageAt = workflow.indexOf('- name: Package .app into an unsigned .ipa');
  const verifyAt = workflow.indexOf('- name: Verify packaged IPA contents');
  const uploadAt = workflow.indexOf('- name: Upload IPA artifact');
  assert.ok(packageAt >= 0 && verifyAt > packageAt && uploadAt > verifyAt,
    'the built IPA is not contract-checked before it is uploaded');
  const preflight = workflow.slice(verifyAt, uploadAt);
  assert.match(preflight, /verify-release-bundle\.js/,
    'the pre-upload check does not run the shared bundle contract');
  assert.match(preflight, /require\('\.\/package\.json'\)\.version/,
    'the pre-upload check does not use the release-driving package version');

  const release = workflow.slice(workflow.indexOf('\n  release:'));
  assert.match(release, /^\s{4}needs:\s*build\s*$/m,
    'the Release should wait for the IPA build only');
  assert.doesNotMatch(release, /BirdChaser-mockups|needs:[^\r\n]*mockups/,
    'the installable Release waits for or publishes mockup artifacts');

  assert.ok(fs.existsSync(postWorkflowPath),
    'the independent post-release workflow is missing');
  assert.match(postWorkflow,
    /workflow_run:[\s\S]*workflows:\s*\["Build unsigned iOS IPA"\][\s\S]*types:\s*\[completed\]/,
    'post-release checks are not triggered after the IPA workflow completes');
  assert.match(postWorkflow,
    /workflow_run\.conclusion\s*==\s*'success'[\s\S]*workflow_run\.event\s*==\s*'push'[\s\S]*workflow_run\.head_branch\s*==\s*'main'/,
    'failed, manual, or non-main builds can publish release artifacts');
  const checkoutCount = (postWorkflow.match(/uses:\s*actions\/checkout@v4/g) || []).length;
  const exactCheckoutCount = (postWorkflow.match(
    /uses:\s*actions\/checkout@v4\s*\n\s*with:\s*\n\s*ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/g
  ) || []).length;
  assert.equal(checkoutCount, 3,
    'the post-release workflow should check out both jobs and the Pages branch');
  assert.equal(exactCheckoutCount, 2,
    'the production checkouts must use the exact released commit');
  assert.match(postWorkflow,
    /uses:\s*actions\/checkout@v4\s*\n\s*with:\s*\n\s*ref:\s*gh-pages\s*\n\s*path:\s*pages-site/,
    'the browsable gallery does not preserve the existing Pages history');
  assert.match(postWorkflow,
    /check-release-tag\.js[\s\S]*workflow_run\.head_sha/,
    'the Release is not identity-checked against the triggering commit');
  assert.match(postWorkflow,
    /gh release download[\s\S]*BirdChaser-unsigned\.ipa[\s\S]*verify-release-assets\.js[\s\S]*verify-release-bundle\.js/,
    'the published IPA is not re-downloaded and checked through both contracts');
  assert.match(postWorkflow,
    /EXPECTED=.*BirdChaser-unsigned\.ipa[\s\S]*ACTUAL=.*sha256sum published\/BirdChaser-unsigned\.ipa[\s\S]*test "\$ACTUAL" = "\$EXPECTED"/,
    'the re-downloaded IPA bytes are not compared with GitHub\'s recorded digest');
  assert.match(postWorkflow,
    /^\s{2}mockups:[\s\S]*^\s{4}needs:\s*verify\s*$/m,
    'mockups do not wait for the fast post-release integrity check');
  assert.match(postWorkflow,
    /mockups\.js --width 414 --out mockups\/iphone-11[\s\S]*mockups\.js --width 402 --out mockups\/iphone-17-pro[\s\S]*mockups\.js --width 402 --scale 1\.3[\s\S]*mockups\/iphone-17-pro-large[\s\S]*mockups\.js --width 402 --scale 1\.75[\s\S]*mockups\/iphone-17-pro-max-magnification/,
    'the Standard, Large, and High visibility report galleries are not all rendered');
  assert.match(postWorkflow,
    /SHOTS\.length[\s\S]*BirdChaser-mockups\.zip[\s\S]*gh release upload[\s\S]*--clobber/,
    'the gallery count, archive, and idempotent Release attachment are incomplete');
  assert.match(postWorkflow,
    /verify-release-assets\.js[\s\S]*BirdChaser-unsigned\.ipa,BirdChaser-beta-guide\.txt,BirdChaser-mockups\.zip[\s\S]*BirdChaser-unsigned\.ipa,BirdChaser-mockups\.zip[\s\S]*BirdChaser-unsigned\.ipa,BirdChaser-beta-guide\.txt,BirdChaser-mockups\.zip/,
    'the Release inventory does not allow the beta guide while requiring the IPA and mockup ZIP');
  assert.match(postWorkflow,
    /EXPECTED_DIGEST=.*BirdChaser-mockups\.zip[\s\S]*ACTUAL_DIGEST=.*sha256sum published\/BirdChaser-mockups\.zip[\s\S]*test "\$ACTUAL_DIGEST" = "\$EXPECTED_DIGEST"/,
    'the re-downloaded gallery bytes are not compared with GitHub\'s recorded digest');
  assert.match(postWorkflow,
    /build-mockup-gallery\.js[\s\S]*--input published\/mockups\/mockups[\s\S]*--version "\$\{\{ needs\.verify\.outputs\.version \}\}"[\s\S]*git push origin HEAD:gh-pages/,
    'the digest-verified release gallery is not published as versioned browsable HTML');
  assert.doesNotMatch(postWorkflow, /continue-on-error:/,
    'the independent workflow hides its own failures instead of reporting them');
  assert.doesNotMatch(postWorkflow, /repository:\s*WyattHoutz\/birding(?:\s|$)/,
    'the public workflow tries to read private source');

  const checkStart = release.indexOf('- name: Has this version already been released?');
  const checkEnd = release.indexOf('- name: Download the IPA this run built', checkStart);
  const releaseCheck = release.slice(checkStart, checkEnd);
  assert.match(releaseCheck,
    /node assets\/check-release-tag\.js "\$\{\{ steps\.ver\.outputs\.tag \}\}" "\$GITHUB_SHA"/,
    'the fail-closed tag identity checker is not run');
  assert.doesNotMatch(releaseCheck, /gh release view/,
    'the workflow still treats every Release lookup failure as an absent Release');
  assert.match(release,
    /gh release upload[\s\S]{0,300}BirdChaser-unsigned\.ipa[\s\S]{0,100}--clobber/,
    'rerunning the tagged commit must repair the required IPA');
  assert.match(release,
    /gh release create[\s\S]{0,500}BirdChaser-unsigned\.ipa/,
    'a new Release must attach the IPA');
});

test('release state lookup fails closed except for an explicit HTTP 404', () => {
  const helperPath = path.join(ROOT, 'assets', 'check-release-tag.js');
  assert.ok(fs.existsSync(helperPath), 'the release tag decision helper is missing');
  const releaseCheck = require(helperPath);
  const fake = (results) => {
    let i = 0;
    return () => results[i++];
  };
  assert.deepEqual(releaseCheck.checkReleaseState('v1.66.0', 'abc', fake([
    { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' },
  ])), { tagExists: false, releaseExists: false });
  assert.deepEqual(releaseCheck.checkReleaseState('v1.66.0', 'abc', fake([
    { status: 0, stdout: 'HTTP/2 200 OK', stderr: '' },
    { status: 0, stdout: 'abc\n', stderr: '' },
    { status: 0, stdout: 'HTTP/2 200 OK', stderr: '' },
  ])), { tagExists: true, releaseExists: true, sha: 'abc' });
  assert.deepEqual(releaseCheck.checkReleaseState('v1.66.0', 'abc', fake([
    { status: 0, stdout: 'HTTP/2 200 OK', stderr: '' },
    { status: 0, stdout: 'abc\n', stderr: '' },
    { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' },
  ])), { tagExists: true, releaseExists: false, sha: 'abc' });
  assert.throws(() => releaseCheck.checkReleaseState('v1.66.0', 'def', fake([
    { status: 0, stdout: 'HTTP/2 200 OK', stderr: '' },
    { status: 0, stdout: 'abc\n', stderr: '' },
  ])), /already points to abc, not def/);
  const failures = [
    { status: 1, stdout: '', stderr: 'gh: HTTP 401: Bad credentials' },
    { status: 1, stdout: '', stderr: 'connection reset by peer' },
    { status: 1, stdout: '', stderr: 'gh: HTTP 500: server error' },
  ];
  for (const failure of failures) {
    assert.throws(() => releaseCheck.checkReleaseState('v1.66.0', 'abc', fake([failure])),
      /Could not determine whether tag/,
      'a non-404 tag lookup failure was treated as tag absent');
    assert.throws(() => releaseCheck.checkReleaseState('v1.66.0', 'abc', fake([
      { status: 0, stdout: 'HTTP/2 200 OK', stderr: '' },
      { status: 0, stdout: 'abc\n', stderr: '' },
      failure,
    ])), /Could not determine whether Release/,
    'a non-404 Release lookup failure was treated as Release absent');
  }
  assert.match(fs.readFileSync(helperPath, 'utf8'), /GITHUB_OUTPUT/,
    'the helper does not publish its fail-closed Release decision to later workflow steps');
});
