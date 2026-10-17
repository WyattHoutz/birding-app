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
