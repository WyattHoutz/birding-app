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
    ['onboardingregion', 'onboardinghome',
      'birdgenloading', 'hawaiiemptybirdgen', 'hawaiiemptyticks',
      'favoritesregion', 'spuhcompact', 'birdspcompact', 'birdspdetail',
      'spuhdetail', 'spuhinfo', 'stakeoutdetail', 'stakeoutreports', 'megaaba',
      'meganearest'],
    'focused review states stay available without inflating the release contract');
  assert.equal(mockups.REVIEW_SHOTS.find((shot) => shot.id === 'spuhcompact')
    .maxHostHeight, undefined,
  'the approved medium-card peep result is still capped by the superseded layout');
});

test('every menu section declares representative fixture data or an intentional static surface', () => {
  const expected = mockups.CONTRACT.menu.map((item) => item.at).sort();
  const declared = Object.keys(mockups.STUB_SPEC).sort();
  assert.deepEqual(declared, expected,
    'a new menu entry must choose a stub kind before the release gallery passes');

  const allowed = new Set([
    'birdgen', 'weather', 'bird', 'ranking', 'hotspot', 'species-search',
    'hotspot-search', 'stakeout-merged', 'mega-index', 'patches',
    'checklists', 'birdcast', 'help', 'migration', 'static',
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

test('F322 BirdCast mockups disclose a link-only surface and invent no migration values', () => {
  assert.doesNotMatch(source, /18,400 birds\/km|HIGH migration|northwest winds 7 mph/,
    'the release gallery still fabricates BirdCast values the app never fetched');
  assert.doesNotMatch(sectionsSource, /42,000 birds\/km|Peak 01:00|mostly NNE/,
    'the section catalog still claims numeric BirdCast data that does not exist');
  assert.match(source, /A\.renderBirdcast\(new Date\('2026-09-09T19:00:00Z'\)\)/,
    'the mockup does not render the production link-only BirdCast surface');
  assert.match(indexSource, /Forecast maps/);
  assert.match(indexSource, /Live migration maps/);
  assert.match(source, /no BirdCast data is fetched/i);
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
    ...ready, isStatic: true, data: false, text: 199, controls: 3,
  }), ['blank static surface'],
  'a static screen still needs enough authored content');

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

test('Mega rarity mockups exercise the real scope and sort controls', () => {
  assert.equal(mockups.STUB_SPEC.abaBtn.kind, 'mega-index');
  assert.deepEqual(mockups.STUB_SPEC.abaBtn.expects, [
    '#abaScopePick [data-abascope="state"]',
    '#abaScopePick [data-abascope="aba"]',
    '#abaSortPick [data-abasort="date"]',
    '#abaSortPick [data-abasort="distance"]',
    '#abaResults li[data-mega-code][data-mega-view]',
    '#abaResults .megaphoto',
    '#abaResults .megajump',
    '#abaResults .spdist',
    '#abaResults .abadist',
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

test('Hawaii patch fallback mockups render in the Hawaii report', () => {
  assert.equal(mockups.STUB_SPEC.destBtn.report, 'hi');
  assert.equal(mockups.STUB_SPEC.excBtn.report, 'hi');
  assert.equal(mockups.STUB_SPEC.fullDayBtn.report, 'hi');
  for (const at of ['destBtn', 'excBtn', 'fullDayBtn']) {
    const shot = mockups.SECTION_SHOTS.find((item) => item.at === at);
    assert.ok(shot, `${at} release shot is missing`);
    assert.match(shot.prep,
      /A\.setActiveReport\(\(spec && spec\.report\) \|\| 'wa'\)/,
      `${at} paints Hawaii rows without switching the visible report`);
  }
  const rows = source.slice(source.indexOf('destBtn: ['),
    source.indexOf('excBtn: [', source.indexOf('destBtn: [')));
  assert.equal((rows.match(/\{ name:/g) || []).length, 5,
    'Today’s patches review still shows fewer than the five useful Hawaii choices');
  const halfRows = source.slice(source.indexOf('excBtn: ['),
    source.indexOf('fullDayBtn: [', source.indexOf('excBtn: [')));
  assert.equal((halfRows.match(/\{ name:/g) || []).length, 3,
    'Half-day review does not show the two measured land localities plus the routed offshore trip');
  assert.match(halfRows, /Offshore Honokōhau Marina/);
  assert.match(halfRows, /half day · boat trip · fresh today/);
  assert.match(halfRows, /Pu'u O'o Trail/);
  assert.match(halfRows, /Laupahoehoe Point County Park/);
  assert.match(halfRows, /Older evidence · last report 8 days ago/);
  assert.doesNotMatch(rows, /Offshore Honokōhau Marina/,
    'the F353 boat-trip control leaked back into Today’s patches');
});

test('F329/F342/F345 release mockups show the completed new facts', () => {
  const rank = source.slice(source.indexOf("} else if (at === 'rankBtn')"),
    source.indexOf("} else if (spec.kind === 'patches')"));
  assert.match(rank, /ebird_rankhist:US-WA/);
  assert.match(rank, /rank:\s*170/);
  assert.match(rank, /Season best #170 · first reached Aug 20/,
    'the Top 100 release shot does not prove the earliest tied best date');

  const year = source.slice(source.indexOf('myYearBody: ['),
    source.indexOf('recordBody: ['));
  assert.match(year, /Lewis's Woodpecker/);
  assert.match(year, /included in the completed first paint/);
  assert.match(source, /Recent checklist check complete · newly harvested birds included/,
    'the My Ticks shot can still look like a silently stale first paint');

  assert.match(source,
    /2 full-day options · 18 counties · all 36 recent\/notable feeds checked/,
    'the Full-day release shot does not identify the measured completed cold plan');
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
  assert.match(source, /visibleCodes\.join\(','\) !== 'nazboo1,amgplo,vesspa,comter'/,
    'the release gate does not assert its exact visible Bird Gen species');
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
  assert.match(source, /visibleCodes\.join\(','\) !== 'nazboo1,amgplo,vesspa,comter'/,
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
  assert.equal(mockups.STUB_SPEC.spLookupBtn.maxHostHeight, 150,
    'the release guard allows the hierarchy sentence to grow back into a card');
  assert.equal(mockups.STUB_SPEC.spLookupBtn.host, 'spLookupIdHelp',
    'the release capture is not anchored to the selected bird hierarchy');
  assert.deepEqual(mockups.STUB_SPEC.spLookupBtn.expects, [
    '#spLookupQueryHelp:empty',
    '#spLookupIdHelp .spuhpathsentence',
    '#spLookupIdHelp .spuhpathchip[data-spuh]',
    '#spLookupResults > li',
    '#spLookupIdHelp .spuhtaxnav',
    '#spLookupIdHelp .spuhcompactpath .spuhtaxlink',
    '#spLookupIdHelp details.spuhdetails',
    '#spLookupIdHelp .spuhtaxlevel[data-rank="species"]',
    '#spLookupResults .spLookupPlaceList > .hscard-sm',
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
  assert.match(indexSource,
    /ToggleControls\.group\(\{[\s\S]*id: 'spuhViewPick'[\s\S]*label: 'Condensed'[\s\S]*label: 'Detailed'/,
    'bird sp. does not reuse the shared segmented-toggle template');
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
  assert.match(source, /Bird Gen toggle pairs wrapped at the exact mockup width/,
    'the exact 393px/402px release render does not guard the requested one-line controls');
  assert.match(source, /A\.fgProgressReset\(\)/,
    'mock-only suppressed lazy calls cannot leave a fake global loading bar in the image');
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
    '#abaScopePick [data-abascope="state"]',
    '#abaScopePick [data-abascope="aba"]',
    '#abaSortPick [data-abasort="date"]',
    '#abaSortPick [data-abasort="distance"]',
    '#abaResults li[data-mega-code][data-mega-view]',
    '#abaResults .megaphoto',
    '#abaResults .megajump',
    '#abaResults .spdist',
    '#abaResults .abadist',
  ]);
  assert.match(source, /fillMegaIndex[\s\S]*A\.renderAbaAlert\(/,
    'the Mega release shot must use the production list renderer');
});

test('F268 On passage mockup exercises first reports and both forecast sources', () => {
  const spec = mockups.STUB_SPEC.migBtn;
  assert.equal(spec.kind, 'migration',
    'On passage cannot use the generic one-card bird fixture');
  assert.equal(spec.host, 'migFirstResults');
  assert.deepEqual(spec.expects, [
    '#migFirstResults .obs.big.xl.icon-sm > li',
    '#migFirstResults .spdist',
    '#migResults .obs.big.xl.icon-sm > li',
    '#migResults .spdist',
  ], 'capture readiness requires both F268 lanes and their prominent timing columns');

  const start = source.indexOf("spec.kind === 'migration'");
  const end = source.indexOf("} else if (spec.kind === 'bird')", start);
  assert.ok(start >= 0 && end > start, 'the dedicated migration fixture branch exists');
  const fixture = source.slice(start, end);
  for (const fact of [
    'Nazca Booby', 'Gyrfalcon', 'Semipalmated Sandpiper',
    'Sharp-tailed Sandpiper', 'county history', 'bundled GBIF',
  ]) {
    assert.ok(fixture.includes(fact), `On passage mockup lost ${fact}`);
  }
  assert.match(fixture, /A\.loadMigration\(\)/,
    'the fixture must run the real F268 renderer rather than hand-roll cards');
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
  assert.equal(checkoutCount, 2,
    'the post-release workflow should have one checkout in each job');
  assert.equal(exactCheckoutCount, checkoutCount,
    'every post-release checkout must use the exact released commit');
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
    /mockups\.js --width 393[\s\S]*mockups\.js --width 402/,
    'both exact release widths are not rendered');
  assert.match(postWorkflow,
    /SHOTS\.length[\s\S]*BirdChaser-mockups\.zip[\s\S]*gh release upload[\s\S]*--clobber/,
    'the gallery count, archive, and idempotent Release attachment are incomplete');
  assert.match(postWorkflow,
    /verify-release-assets\.js[\s\S]*BirdChaser-unsigned\.ipa,BirdChaser-mockups\.zip[\s\S]*BirdChaser-unsigned\.ipa,BirdChaser-mockups\.zip/,
    'the final Release inventory does not require exactly the IPA and mockup ZIP');
  assert.match(postWorkflow,
    /EXPECTED_DIGEST=.*BirdChaser-mockups\.zip[\s\S]*ACTUAL_DIGEST=.*sha256sum published\/BirdChaser-mockups\.zip[\s\S]*test "\$ACTUAL_DIGEST" = "\$EXPECTED_DIGEST"/,
    'the re-downloaded gallery bytes are not compared with GitHub\'s recorded digest');
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
