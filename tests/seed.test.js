// F1075 retires personal Watch defaults; preserve the reference-data guards.
// The historical failures below explain why generation still needs proof.
// The seed is DATA, and data can be wrong in ways code cannot: silently, and
// without ever throwing. Both bugs found on 2026-08-07 were of that shape —
// the owner reported a Yellow-headed Blackbird filed under "already on your
// year list" in the WASHINGTON report, and two independent causes turned up.
//
//   1. seen_codes.txt was a RATCHET. analyze.py persisted a union back to it
//      every WA run, so a code could enter the seen set and never leave. It had
//      accreted 89 codes from other regions' exports and 4 Washington birds
//      from a previous year: 93 species hidden from the chase lists.
//
//   2. build-seed.js's watchlist parser only matched NUMBERED lines. The file
//      had since been converted to bullets and analyze.py updated with it; this
//      parser was not. It matched nothing, so the app subtracted an EMPTY
//      watchlist while the report subtracted 18 species.
//
// Neither raised an error. Both produced a plausible-looking seed. So these
// assert the seed's own internal consistency, which is the only signal a data
// file gives you before a human notices a wrong bird on a card.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const WWW = path.join(__dirname, '..', 'www');
const SEED = JSON.parse(
  fs.readFileSync(path.join(WWW, 'seed-birdlist.json'), 'utf8'));
const BUILDER = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'build-seed.js'), 'utf8');
const RELEASE_CONTRACT = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'release-contract.json'), 'utf8'));

test('F1075 bundled Watch is empty without dropping taxonomy or year-list references', () => {
  assert.deepStrictEqual(SEED.watchlist, []);
  assert.doesNotMatch(SEED.source, /needsverification/);
  for (const [slug, report] of Object.entries(SEED.seenByReport)) {
    assert.deepStrictEqual(report.watchHeld, [], slug + ' still subtracts personal Watch entries');
    assert.ok(Array.isArray(report.yearList), slug + ' lost its year-list reference');
  }
  assert.ok(Object.keys(SEED.reportAsParents).length >= 4000);
});

test('F1075 seed generator never consults the retired archive and retains reference species', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'birding-seed-f1075-'));
  const app = path.join(temporary, 'app'), source = path.join(temporary, 'birding');
  try {
    for (const directory of [path.join(app, 'assets'), path.join(app, 'www'), path.join(source, '.cache')]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    const builder = path.join(app, 'assets', 'build-seed.js');
    fs.writeFileSync(builder, BUILDER);
    fs.copyFileSync(path.join(__dirname, '..', 'assets', 'taxonomy-aliases.js'),
      path.join(app, 'assets', 'taxonomy-aliases.js'));
    fs.copyFileSync(path.join(WWW, 'logic.js'), path.join(app, 'www', 'logic.js'));
    fs.writeFileSync(path.join(source, 'birdlist-wa.md'),
      '### Native and Naturalized (1)\n1. ##### [American Robin](/species/amerob/US-WA)\n'
      + '[23 Oct 2026](/checklist/S1075)\n');
    fs.writeFileSync(path.join(source, 'birdlist-needsverification.md'), '1. American Robin\n');
    fs.writeFileSync(path.join(source, '.cache', 'taxonomy-en.json'), JSON.stringify([
      { speciesCode: 'amerob', comName: 'American Robin', category: 'species' },
      { speciesCode: 'rocpig', comName: 'Rock Pigeon', category: 'species' },
      { speciesCode: 'rocpig2', comName: 'Rock Pigeon (Feral)', category: 'form', reportAs: 'rocpig' },
    ]));
    const probe = `
      const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
      for (const operation of ['readFileSync', 'existsSync']) {
        const original = fs[operation];
        fs[operation] = function(file, ...args) {
          assert.notEqual(path.basename(String(file)), 'birdlist-needsverification.md',
            'reference generation consulted the retired personal Watch archive');
          return original.call(this, file, ...args);
        };
      }
      process.argv = [process.execPath, ${JSON.stringify(builder)}, ${JSON.stringify(source)}];
      require(${JSON.stringify(builder)});
    `;
    const run = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(run.status, 0, run.stderr || String(run.error || 'generator failed'));
    const generated = JSON.parse(fs.readFileSync(path.join(app, 'www', 'seed-birdlist.json'), 'utf8'));
    assert.deepStrictEqual(generated.watchlist, []);
    assert.deepStrictEqual(generated.seenByReport.wa.watchHeld, []);
    assert.deepStrictEqual(generated.seenByReport.wa.codes, ['amerob']);
    assert.strictEqual(generated.seenByReport.wa.yearList[0].code, 'amerob');
    assert.strictEqual(generated.reportAsParents.rocpig2, 'rocpig');
    assert.doesNotMatch(generated.source, /needsverification/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('no report claims to have seen a bird its own year list never names', () => {
  // The seen_codes.txt ratchet, asserted as a PROPERTY so that unioning "one
  // more source" in future cannot quietly reintroduce it.
  //
  // `codes` and `names` legitimately come from different lists — a Missouri
  // trip chases against the Lower 48 list (Region.seen_from_region) — so this
  // checks the reports where the two ARE the same list: wa and lower48.
  const selfScoped = ['wa', 'lower48'];
  for (const slug of selfScoped) {
    const rep = SEED.seenByReport[slug];
    const yearCodes = new Set((rep.yearList || []).map((e) => String(e.code).toLowerCase()));
    if (!yearCodes.size) continue;
    const seen = (rep.codes || []).map((c) => String(c).toLowerCase());
    // The year list names species; `codes` also carries hybrid/sp. group codes
    // (spp=) that have no year-list entry, so the check is on the RATIO rather
    // than exact equality: a set half again as large as the list it came from
    // is not rounding, it is another list mixed in.
    const stray = seen.filter((c) => !yearCodes.has(c));
    assert.ok(stray.length < yearCodes.size * 0.25,
      slug + ': ' + stray.length + ' of ' + seen.length + ' seen codes are on '
      + 'no year-list entry (' + stray.slice(0, 8).join(', ') + '). That is the '
      + 'shape of another region\'s list unioned in');
  }
});

test('seen_codes.txt is not read by the seed builder', () => {
  assert.ok(!/fs\.(readFileSync|existsSync)\([^)]*seen_codes/.test(BUILDER),
    'build-seed.js must not read the retired ratchet file');
  assert.ok(!/scCodes\)/.test(BUILDER.replace(/\/\/[^\n]*/g, '')),
    'and must not union it into any set');
});

test('F416 reportAs aliases preserve forms while satisfying parent species', () => {
  const helperPath = path.join(
    __dirname, '..', 'assets', 'taxonomy-aliases.js');
  assert.ok(fs.existsSync(helperPath),
    'the taxonomy-derived reportAs alias helper exists');
  if (!fs.existsSync(helperPath)) return;
  const { reportAsParents } = require(helperPath);
  const derived = reportAsParents([
    { speciesCode: 'redjun1', category: 'domestic', reportAs: 'redjun' },
    { speciesCode: 'mallar2', category: 'domestic', reportAs: 'mallar3' },
    { speciesCode: 'rocpig2', category: 'form', reportAs: 'rocpig' },
    { speciesCode: 'hawama2', category: 'issf', reportAs: 'hawama' },
    { speciesCode: 'missingparent', category: 'domestic' },
  ]);
  assert.deepEqual(derived, {
    hawama2: 'hawama',
    mallar2: 'mallar3',
    redjun1: 'redjun',
    rocpig2: 'rocpig',
  }, 'every child that eBird reports as a parent species qualifies');

  const aliases = SEED.reportAsParents || {};
  assert.ok(Object.keys(aliases).length >= 4000,
    'the bundled map covers the taxonomy rather than a hand-picked form list');
  assert.deepEqual(
    {
      redjun1: aliases.redjun1,
      rocpig1: aliases.rocpig1,
      musduc3: aliases.musduc3,
      mallar2: aliases.mallar2,
      rinphe37: aliases.rinphe37,
      hawama2: aliases.hawama2,
    },
    {
      redjun1: 'redjun',
      rocpig1: 'rocpig',
      musduc3: 'musduc',
      mallar2: 'mallar3',
      rinphe37: 'rinphe1',
      hawama2: 'hawama',
    },
    'domestic and named subspecific forms keep eBird’s exact parent codes');
  assert.equal(aliases.rocpig2, 'rocpig',
    'a named form satisfies its species parent without losing its own code');
  assert.match(BUILDER, /reportAsParents\(taxonomyRows\(\)\)/,
    'the generated seed is wired to the taxonomy-derived helper');
  assert.ok(RELEASE_CONTRACT.requiredFiles.includes('seed-birdlist.js')
    && RELEASE_CONTRACT.requiredFiles.includes('seed-birdlist.json'),
  'the IPA contract requires both reportAs-alias seed forms');
  assert.ok(
    (RELEASE_CONTRACT.requiredText['seed-birdlist.js'] || [])
      .includes('"reportAsParents"')
    && (RELEASE_CONTRACT.requiredText['seed-birdlist.json'] || [])
      .includes('"reportAsParents"'),
  'the IPA contract verifies the current reportAs alias key');
  assert.ok((RELEASE_CONTRACT.requiredText['index.html'] || [])
    .includes('finishReportSeen'),
  'the IPA contract requires the runtime seen-set expansion');
});
