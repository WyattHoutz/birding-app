'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const api = require(path.join(process.env.BIRDCHASER_WWW
  || path.join(__dirname, '..', 'www'), 'birdgen-twitches.js'));
const logic = require('../www/logic.js');
const now = new Date(2026, 9, 17, 12).getTime();
const options = {
  now, today: '2026-10-17', home: { lat: 47, lng: -122 }, radius: 35,
  complete: true, acquired: true, membership: () => false, watch: {},
};
const bird = {
  kind: 'Rarity', code: 'verfly', name: 'Vermilion Flycatcher',
  dateStr: '2026-10-17 11:00', lat: 47.01, lon: -122, locId: 'L1', subId: 'S1',
};
function baseline(rows = [], opts = options) { return api.evaluate(null, rows, opts).journal; }

test('F990 first complete reads and lost or invalid journals baseline silently', () => {
  for (const journal of [null, {}, { version: 1, known: ['verfly'], episodes: [] }]) {
    const result = api.evaluate(journal, [bird], options);
    assert.equal(result.status, 'baseline');
    assert.deepEqual(result.alerts, []);
    assert.equal(api.validJournal(result.journal), true);
    assert.deepEqual(api.evaluate(result.journal, [bird], options).added, []);
  }
  assert.equal(api.evaluate(null, [bird], { ...options, complete: false }).journal, null);
  assert.equal(api.evaluate(null, [bird], { ...options, acquired: false }).journal, null);
});

test('F990 one new-today unseen in-range rarity qualifies without a Celebrity threshold', () => {
  const result = api.evaluate(baseline(), [bird], options);
  assert.deepEqual(result.added, ['verfly']);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].reports, 1);
  assert.equal(result.alerts[0].lowerBound, true, 'latest-only feeds support known lower bounds, not total claims');
  const continued = api.evaluate(result.journal, [bird, {
    ...bird, dateStr: '2026-10-17 11:30', subId: 'S2',
  }], { ...options, now: now + 60000 });
  assert.deepEqual(continued.added, []);
  assert.equal(continued.alerts[0].reports, 2);
  assert.equal(continued.alerts[0].firstAt, result.alerts[0].firstAt);
  assert.equal(continued.alerts[0].when, result.alerts[0].when, 'new reports do not reset the original opportunity age');
});

test('F990 seen, unknown, WATCH, old, future, out-of-range and non-species evidence cannot create alerts', () => {
  const cases = [
    [[bird], { membership: () => true }],
    [[bird], { membership: () => null }],
    [[bird], { watch: { verfly: true } }],
    [[bird], { complete: false }],
    [[bird], { acquired: false }],
    [[bird], { home: null }],
    [[{ ...bird, dateStr: '2026-10-16 11:00' }], {}],
    [[{ ...bird, dateStr: '2026-10-17 13:00' }], {}],
    [[{ ...bird, lat: 48 }], {}],
    [[{ ...bird, lat: null, coordinatesMissing: true }], {}],
    [[{ ...bird, name: 'Gull sp.' }], {}],
    [[{ ...bird, name: 'Mallard x Gadwall' }], {}],
    [[{ ...bird, kind: 'Recent' }], {}],
    [[{ ...bird, obsReviewed: true, obsValid: false }], {}],
    [[{ ...bird, reviewed: true, valid: false }], {}],
  ];
  for (const [rows, changes] of cases) {
    assert.deepEqual(api.evaluate(baseline(), rows, { ...options, ...changes }).added, [],
      JSON.stringify(changes) + ' / ' + rows[0].name);
  }
  const distance = logic.haversineMi(47, -122, bird.lat, bird.lon);
  assert.equal(api.evaluate(baseline([], { ...options, radius: distance }), [bird],
    { ...options, radius: distance }).alerts.length, 1, 'the exact radius boundary is included');
});

test('F990 continuing, previously known and already-alerted species do not reset on reload or midnight', () => {
  const old = { ...bird, dateStr: '2026-10-16 11:00' };
  assert.deepEqual(api.evaluate(baseline([old]), [bird], options).added, []);
  assert.deepEqual(api.evaluate(baseline(), [old, bird], options).added, [],
    'a newly learned continuing report is not a new-today opportunity');
  const first = api.evaluate(baseline(), [bird], options);
  const reload = JSON.parse(JSON.stringify(first.journal));
  const next = { ...bird, dateStr: '2026-10-18 08:00' };
  const tomorrow = { ...options, now: new Date(2026, 9, 18, 9).getTime(), today: '2026-10-18' };
  assert.deepEqual(api.evaluate(reload, [next], tomorrow).added, []);
  assert.equal(api.evaluate(reload, [next], tomorrow).alerts[0].firstAt, now);
  assert.deepEqual(api.evaluate(reload, [], { ...tomorrow, complete: false }).added, []);
  const expired = api.evaluate(reload, [next], { ...tomorrow, now: now + 25 * 3600000 });
  assert.deepEqual(expired.alerts, []);
  assert.deepEqual(expired.added, [], 'no unproven disappearance/reappearance rearming');
  const changed = api.evaluate(reload, [bird], { ...options, radius: 50 });
  assert.equal(changed.status, 'baseline');
  assert.deepEqual(changed.added, [], 'a larger radius is not a new arrival');
});

test('F1007 only explicit recovery admits known but never-alerted species and persists its meaning', () => {
  const previous = baseline([bird]);
  const saved = JSON.stringify(previous);
  assert.deepEqual(api.evaluate(previous, [bird], options).added, []);
  assert.deepEqual(api.evaluate(previous, [bird], { ...options, recoverNeverAlerted: 'true' }).added, []);
  const result = api.evaluate(previous, [bird], { ...options, recoverNeverAlerted: true });
  assert.deepEqual(result.added, ['verfly']);
  assert.equal(result.alerts[0].recovered, true);
  assert.equal(result.journal.episodes.verfly.recovered, true);
  assert.deepEqual(result.journal.known, previous.known, 'recovery does not clear source history');
  assert.equal(JSON.stringify(previous), saved, 'the input journal is not mutated');
  assert.equal(result.diagnostics.knownNeverAlerted, 1);
  assert.equal(result.diagnostics.recovered, 1);
  assert.equal(api.validJournal(result.journal), true);
  const reload = api.evaluate(JSON.parse(JSON.stringify(result.journal)), [bird],
    { ...options, now: now + 60000, recoverNeverAlerted: true });
  assert.deepEqual(reload.added, []);
  assert.equal(reload.alerts[0].firstAt, now);
  assert.equal(reload.alerts[0].recovered, true);
  assert.equal(reload.diagnostics.recovered, 0);
  const later = { ...options, now: now + 25 * 3600000,
    today: '2026-10-18', recoverNeverAlerted: true };
  const next = { ...bird, dateStr: '2026-10-18 12:30' };
  assert.deepEqual(api.evaluate(reload.journal, [next], later).added, [],
    'an expired or previously alerted opportunity cannot be rearmed by Refresh');
});

test('F1007 explicit recovery preserves silent baselines and every eligibility gate', () => {
  const recover = { ...options, recoverNeverAlerted: true };
  for (const previous of [null, {}, { version: 1, known: [], episodes: [] }]) {
    assert.deepEqual(api.evaluate(previous, [bird], recover).added, []);
  }
  const previous = baseline([bird]);
  const cases = [
    [[bird], { radius: 50 }],
    [[bird], { complete: false }],
    [[bird], { acquired: false }],
    [[bird], { membership: () => true }],
    [[bird], { membership: () => null }],
    [[bird], { watch: { verfly: true } }],
    [[bird], { home: null }],
    [[{ ...bird, dateStr: '2026-10-16 11:00' }], {}],
    [[{ ...bird, dateStr: '2026-10-17 13:00' }], {}],
    [[{ ...bird, lat: 48 }], {}],
    [[{ ...bird, lat: null, coordinatesMissing: true }], {}],
    [[{ ...bird, name: 'Gull sp.' }], {}],
    [[{ ...bird, kind: 'Recent' }], {}],
    [[{ ...bird, obsReviewed: true, obsValid: false }], {}],
    [[{ ...bird, reviewed: true, valid: false }], {}],
  ];
  for (const [rows, changes] of cases) {
    assert.deepEqual(api.evaluate(previous, rows, { ...recover, ...changes }).added, [],
      'recovery cannot bypass ' + JSON.stringify(changes) + ' / ' + rows[0].dateStr);
  }
  const invalid = JSON.parse(JSON.stringify(api.evaluate(previous, [bird], recover).journal));
  invalid.episodes.verfly.recovered = 'true';
  assert.equal(api.validJournal(invalid), false, 'recovery metadata is typed persisted evidence');
});

test('F1007 explicit recovery uses actual rolling-24-hour evidence, not a new-arrival claim', () => {
  const recover = { ...options, recoverNeverAlerted: true };
  const previous = baseline([bird]);
  const old = { ...bird, dateStr: '2026-10-16 11:00', subId: 'S-OLD' };
  const mixed = api.evaluate(previous, [old, bird], recover);
  assert.deepEqual(mixed.added, ['verfly'], 'older source history cannot veto a currently qualifying recovered opportunity');
  assert.equal(mixed.alerts[0].recovered, true);
  assert.equal(mixed.alerts[0].latest.dateStr, bird.dateStr);
  assert.equal(mixed.alerts[0].reports, 1, 'older-than-24-hour evidence is not counted as fresh corroboration');
  assert.deepEqual(api.evaluate(previous, [old, { ...bird, lat: 48 }], recover).added, [],
    'fresh out-of-range evidence cannot rescue a stale nearby report');
  const newlyLearned = api.evaluate(baseline(), [old, bird], recover);
  assert.equal(newlyLearned.alerts[0].recovered, true,
    'a continuing report learned on explicit Refresh is recovery, not a new arrival');
  for (const [stamp, qualifies] of [['2026-10-16 12:00', true], ['2026-10-16 11:59', false]]) {
    const result = api.evaluate(previous, [{ ...bird, dateStr: stamp }], recover);
    assert.equal(result.added.length, qualifies ? 1 : 0, 'exact 24-hour boundary: ' + stamp);
  }
});

test('F1007 bounded eligibility diagnostics distinguish overlapping exclusions without personal details', () => {
  const result = api.evaluate(baseline([bird]), [bird, {
    ...bird, dateStr: '2026-10-16 11:00', observer: 'Private fixture observer',
  }], { ...options, membership: () => null, watch: { verfly: true } });
  assert.deepEqual(result.diagnostics, { usableSpecies: 1, knownNeverAlerted: 1,
    seen: 0, unknown: 1, watch: 1, earlierDay: 1, outside24h: 0, alreadyAlerted: 0, recovered: 0 });
  assert.ok(Object.values(result.diagnostics).every(Number.isFinite));
  assert.doesNotMatch(JSON.stringify(result.diagnostics), /verfly|Private|47|122/);
});

test('F990 report counts deduplicate parties and feeds and exclude unrelated localities and stale reports', () => {
  const rows = [
    bird, { ...bird }, { ...bird, locId: 'L-alias', subId: 'S-shared', observer: 'Shared party' },
    { ...bird, dateStr: '2026-10-17 11:15', subId: 'S2', obsReviewed: false },
    { ...bird, lat: 47.2, locId: 'L-remote', dateStr: '2026-10-17 10:00', subId: 'S3' },
  ];
  const result = api.evaluate(baseline(), rows, options);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].reports, 2);
  assert.equal(result.alerts[0].unreviewed, true);
  const partial = api.evaluate(result.journal, rows, { ...options, complete: false });
  assert.equal(partial.alerts[0].lowerBound, true);
  assert.deepEqual(partial.added, []);
  const boundary = { ...options, now: now + 24 * 3600000, today: '2026-10-18' };
  const anchored = api.evaluate(result.journal, [bird, {
    ...bird, dateStr: '2026-10-18 12:00', subId: 'S-new',
  }], boundary);
  assert.equal(anchored.alerts.length, 1, 'an alert at exactly 24 hours remains eligible');
  assert.equal(anchored.alerts[0].reports, 1, 'report counts have their own strict rolling 24-hour window');
});
