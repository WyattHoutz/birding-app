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

const WWW = path.join(__dirname, '..', 'www');
const SEED = JSON.parse(
  fs.readFileSync(path.join(WWW, 'seed-birdlist.json'), 'utf8'));
const BUILDER = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'build-seed.js'), 'utf8');

test('the watchlist really came off — an empty one is indistinguishable from a broken parser', () => {
  const held = [];
  for (const slug of Object.keys(SEED.seenByReport)) {
    held.push([slug, (SEED.seenByReport[slug].watchHeld || []).length]);
  }
  const any = held.some(([, n]) => n > 0);
  assert.ok(any,
    'no report holds back a single watchlist species: ' + JSON.stringify(held)
    + ' — either the authored list is genuinely empty, or the parser stopped '
    + 'matching it. Those look identical from here, which is why this fails '
    + 'loudly rather than shipping a seed that marks every unverified bird seen');

  // A watchlist species must not ALSO be in the seen set, or it can never
  // resurface as a target — which is the entire point of the list.
  for (const slug of Object.keys(SEED.seenByReport)) {
    const rep = SEED.seenByReport[slug];
    const seen = new Set((rep.codes || []).map((c) => String(c).toLowerCase()));
    for (const c of rep.watchHeld || []) {
      assert.ok(!seen.has(String(c).toLowerCase()),
        slug + ': ' + c + ' is held back AND marked seen');
    }
  }
});

test('the watchlist parser accepts the format the file is actually written in', () => {
  // analyze.py takes "1." or "-"/"*"/"+"; the app must take the same set, or
  // the two repos disagree about who is a target the moment the file is
  // reformatted. This is the drift that actually happened.
  const m = BUILDER.match(/const m = (\/\^[^\n]*\/)\.exec\(line\)/);
  assert.ok(m, 'the watchlist line pattern is still recognisable in build-seed.js');
  const re = new RegExp(m[1].slice(1, m[1].lastIndexOf('/')));
  for (const line of ['1. American Pipit', '- American Pipit',
                      '* American Pipit', '+ American Pipit',
                      '  12. Western Grebe']) {
    assert.ok(re.test(line), 'the parser must accept ' + JSON.stringify(line));
  }
  assert.ok(!re.test('# Birds Requiring Additional Verification'),
    'and must not swallow the heading as a species');
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
