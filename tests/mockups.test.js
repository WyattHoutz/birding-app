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
const alertSource = fs.readFileSync(
  path.join(ROOT, 'assets', 'mockup-alertfeed.js'), 'utf8');
const workflow = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'ios-build.yml'), 'utf8');
const mockups = require(path.join(ROOT, 'assets', 'mockups.js'));
const waSeen = require(path.join(
  ROOT, 'tests', 'fixtures', 'wa-seen-2026-stub.json'));

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
    ['stakeoutreports'],
    'focused review states stay available without inflating the release contract');
});

test('every menu section declares representative fixture data or an intentional static surface', () => {
  const expected = mockups.CONTRACT.menu.map((item) => item.at).sort();
  const declared = Object.keys(mockups.STUB_SPEC).sort();
  assert.deepEqual(declared, expected,
    'a new menu entry must choose a stub kind before the release gallery passes');

  const allowed = new Set([
    'birdgen', 'weather', 'bird', 'ranking', 'hotspot', 'species-search',
    'spuh', 'hotspot-search', 'stakeout-species', 'patches',
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
    mapReady: true,
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
    ...ready, missing: ['#easyResults .hscard'],
  }), ['missing expected components'],
  'a generic card cannot replace the production shape a shot promises');
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
  assert.match(source, /shotLooksBlank\(seen, !!shot\.at\)/,
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
  assert.match(source, /Washington seen fixture did not reach getReportSeen/,
    'the renderer never behaviorally verifies seen/unseen state');
});

test('Bird Gen mockups use the measured September 3 alert snapshot', () => {
  const setup = source.slice(source.indexOf("if (at === 'surgeBtn')"),
    source.indexOf('\n  function wait(', source.indexOf("if (at === 'surgeBtn')")));
  const paint = source.slice(source.indexOf("if (spec.kind === 'birdgen')"),
    source.indexOf("} else if (spec.kind === 'spuh')"));
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

  assert.equal(mockups.STUB_SPEC.spLookupBtn.kind, 'stakeout-species');
  assert.equal(mockups.STUB_SPEC.spLookupBtn.host, 'spLookupIdHelp',
    'the capture anchor is the visible taxonomy path, while component checks guard the card');
  assert.deepEqual(mockups.STUB_SPEC.spLookupBtn.expects, [
    '#spLookupResults > li',
    '#spLookupIdHelp .spuhtaxnav',
    '#spLookupIdHelp .spuhtaxlevel[data-rank="species"]',
    '#spLookupResults .spLookupPlaceList > .hscard-sm',
  ]);
  assert.match(source, /await A\.lookupSpecies\('semsan', 'Semipalmated Sandpiper'\)/,
    'Stakeout bird must run its real medium-card + places renderer');
  assert.doesNotMatch(source, /spLookupHero|details\.spuhshell|renderSpuhStakeoutShell/,
    'the release fixture must not preserve the removed duplicate hero or collapsed shell');
  assert.match(source, /detail\.querySelector\('details\.spuhcompare'\)/,
    'the comparison shot opens the control inside the visible navigator');
  assert.match(source, /prepareStakeoutReports[\s\S]*more\.click\(\)/,
    'the focused Stakeout review shot does not exercise the real lazy append');
  assert.match(source, /ready\.missing\.length/,
    'the capture must fail if a section-specific production shape is absent');
  assert.match(source, /Bird Gen toggle pairs wrapped at the exact mockup width/,
    'the exact 393px/402px release render does not guard the requested one-line controls');
  assert.match(source, /A\.fgProgressReset\(\)/,
    'mock-only suppressed lazy calls cannot leave a fake global loading bar in the image');
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

test('the release workflow requires both mockup widths and attaches one combined archive', () => {
  const start = workflow.indexOf('- name: Generate the UI mockups');
  const end = workflow.indexOf('- name: Create the Release', start);
  assert.ok(start > 0 && end > start,
    'the mockup and release steps still bound this workflow section');
  const step = workflow.slice(start, end);
  assert.doesNotMatch(step, /continue-on-error:\s*true/,
    'mockup failure must fail the release instead of becoming a warning');
  assert.match(step, /node assets\/mockups\.js --width 393[\s\S]*--out [^\r\n]*393/,
    'the release must render the exact 393px gallery into its own directory');
  assert.match(step, /node assets\/mockups\.js --width 402[\s\S]*--out [^\r\n]*402/,
    'the release must render the exact 402px gallery into its own directory');
  assert.match(step, /zip -r BirdChaser-mockups\.zip mockups/,
    'both galleries must be packed into one deterministic archive');

  const create = workflow.slice(end);
  assert.match(create, /gh release create[\s\S]{0,500}BirdChaser-mockups\.zip/,
    'the combined mockup archive must be attached to the GitHub Release');
  assert.doesNotMatch(create, /\bEXTRA=|\bMOCKUPS=/,
    'a mandatory artifact must not be conditionally omitted');
  const release = workflow.slice(workflow.indexOf('\n  release:'));
  const checkStart = release.indexOf('- name: Has this version already been released?');
  const checkEnd = release.indexOf('- name: Download the IPA this run built', checkStart);
  const releaseCheck = release.slice(checkStart, checkEnd);
  assert.match(releaseCheck,
    /node assets\/check-release-tag\.js "\$\{\{ steps\.ver\.outputs\.tag \}\}" "\$GITHUB_SHA"/,
    'the fail-closed tag identity checker is not run');
  assert.doesNotMatch(releaseCheck, /gh release view/,
    'the workflow still treats every Release lookup failure as an absent Release');
  assert.match(release,
    /gh release upload[\s\S]{0,300}BirdChaser-unsigned\.ipa[\s\S]{0,200}BirdChaser-mockups\.zip[\s\S]{0,100}--clobber/,
    'rerunning the tagged commit must repair both required assets');
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
