'use strict';
/*
 * logic.test.js — self-contained unit tests for BirdLogic (www/logic.js).
 *
 * Runs under Node's built-in test runner (`node --test`), no jest / no network
 * / no external fixtures — so it works in the public birding-app CI without the
 * private `birding` repo. It guards the pure logic the whole app is built on:
 * the report registry, the eBird request plan, the merge/scoping contracts, and
 * the section transforms (time-of-day, convoys, chase views).
 *
 * The CROSS-LANGUAGE parity suite (birding/tests/parity) additionally proves
 * these same functions reproduce the Markdown report byte-for-byte; that runs in
 * the birding repo's CI where the fixtures + Python report code live.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const BL = require(path.join(__dirname, '..', 'www', 'logic.js'));

// --- report registry -------------------------------------------------------
test('registry: REGION_ORDER matches REPORTS keys (no orphans)', () => {
  const keys = Object.keys(BL.REPORTS).sort();
  const order = BL.REGION_ORDER.slice().sort();
  assert.deepEqual(order, keys, 'every ordered slug has a report and vice-versa');
  assert.equal(BL.REGION_ORDER.length, 9, 'ships 9 reports');
});

test('registry: every profile carries the fields the app relies on', () => {
  BL.REGION_ORDER.forEach((slug) => {
    const p = BL.profileFor(slug);
    assert.equal(p.slug, slug, slug + ': slug round-trips');
    assert.ok(typeof p.label === 'string' && p.label, slug + ': has label');
    assert.ok(Array.isArray(p.counties), slug + ': counties is an array');
    p.counties.forEach((c) => {
      assert.ok(c.slug && c.code && c.label, slug + ': county has slug/code/label');
      assert.match(c.code, /^US-[A-Z]{2}-\d+$/, slug + ': county code is US-XX-nnn (' + c.code + ')');
    });
    assert.equal(typeof p.tideStation, 'string', slug + ': tideStation is a string ("" if inland)');
    assert.equal(typeof p.isRarityTracker, 'boolean', slug + ': isRarityTracker flag present');
  });
});

test('registry: rarity trackers have no counties; regions do', () => {
  assert.equal(BL.profileFor('lower48').counties.length, 0, 'lower48 has no counties');
  assert.equal(BL.profileFor('aba').counties.length, 0, 'aba has no counties');
  assert.ok(BL.profileFor('lower48').isRarityTracker, 'lower48 is a rarity tracker');
  assert.ok(BL.profileFor('wa').counties.length >= 1, 'wa has counties');
  assert.equal(BL.profileFor('wa').tideStation, '9447130', 'wa keeps its NOAA tide station');
  assert.equal(BL.profileFor('mo').tideStation, '', 'inland mo has no tide station');
});

// --- request plan (eBird endpoint contract) --------------------------------
test('planFeeds: per-county recent+notable then geo, with correct paths', () => {
  const wa = BL.profileFor('wa');
  const feeds = BL.planFeeds(wa);
  const king = wa.counties.find((c) => c.slug === 'king');
  const recent = feeds.find((f) => f.file === 'king-recent.json');
  assert.ok(recent, 'king recent feed exists');
  assert.equal(recent.path, 'data/obs/' + king.code + '/recent');
  const url = BL.requestUrl(recent);
  assert.ok(url.startsWith('data/obs/' + king.code + '/recent?'), 'url keeps path');
  assert.match(url, /back=7/, 'default back=7');
  assert.match(url, /detail=full/, 'detail=full');
  // geo feeds present because wa has a home + geoFeed
  assert.ok(feeds.some((f) => f.file === 'geo-recent.json'), 'geo recent present');
  assert.ok(feeds.some((f) => f.file === 'geo-notable.json'), 'geo notable present');
});

test('planFeeds / mergePlan agree on the feed file set for ALL reports', () => {
  BL.REGION_ORDER.forEach((slug) => {
    const p = BL.profileFor(slug);
    const plan = BL.planFeeds(p).map((f) => f.file).sort();
    const merge = BL.mergePlan(p).map((f) => f.file).sort();
    assert.deepEqual(plan, merge, slug + ': planFeeds vs mergePlan file sets differ');
  });
});

test('mergePlan: recents before notables (merge order the report relies on)', () => {
  const kinds = BL.mergePlan(BL.profileFor('wa')).map((f) => f.kind);
  const firstNotable = kinds.indexOf('notable');
  const lastRecent = kinds.lastIndexOf('recent');
  assert.ok(firstNotable > lastRecent, 'all recents come before any notable');
});

test('planConvoyFeeds: per-county product/lists; empty for rarity trackers', () => {
  const mo = BL.profileFor('mo');
  const feeds = BL.planConvoyFeeds(mo);
  assert.equal(feeds.length, mo.counties.length, 'one convoy feed per county');
  feeds.forEach((f, i) => {
    assert.equal(f.path, 'product/lists/' + mo.counties[i].code);
    assert.match(BL.requestUrl(f), /maxResults=200/, 'convoy feed caps results');
  });
  assert.equal(BL.planConvoyFeeds(BL.profileFor('aba')).length, 0, 'aba: no convoy feeds');
});

test('requestUrl: params sorted, null-dropped, path preserved', () => {
  assert.equal(
    BL.requestUrl({ path: 'x/y', params: { b: 2, a: 1, z: null } }),
    'x/y?a=1&b=2', 'keys sorted, null dropped');
  assert.equal(BL.requestUrl({ path: 'x/y', params: {} }), 'x/y', 'no query when empty');
});

// --- geometry --------------------------------------------------------------
test('haversineMi: 0 for same point; plausible Seattle->Marymoor miles', () => {
  assert.equal(BL.haversineMi(47.6, -122.3, 47.6, -122.3), 0);
  const d = BL.haversineMi(47.6062, -122.3321, 47.6588, -122.113);
  assert.ok(d > 9 && d < 12, 'plausible miles: ' + d);
});

// --- time-of-day (mirror time_of_day.py) -----------------------------------
test('todBuildHours: dedups by (subId, speciesCode) and extracts the hour', () => {
  const rows = [
    { speciesCode: 'gbhe', subId: 'S1', obsDt: '2026-01-15 06:30', comName: 'Great Blue Heron' },
    { speciesCode: 'gbhe', subId: 'S1', obsDt: '2026-01-15 06:45', comName: 'Great Blue Heron' }, // dup sub -> dropped
    { speciesCode: 'gbhe', subId: 'S2', obsDt: '2026-01-15 20:15', comName: 'Great Blue Heron' },
    { speciesCode: 'nopo', subId: 'S3', obsDt: '2026-01-15', comName: 'No Time' } // too short -> ignored
  ];
  const built = BL.todBuildHours(rows);
  assert.deepEqual(built.hours.gbhe, [6, 20], 'two distinct checklists -> [6,20]');
  assert.equal(built.hours.nopo, undefined, 'dateless obs ignored');
  assert.equal(built.names.gbhe, 'Great Blue Heron');
});

test('todSpecialists: classifies dawn/dusk and exposes the render fields', () => {
  const hours = {
    owl: [20, 21, 22, 20, 23, 19],   // all late -> night specialist
    pipit: [5, 6, 5, 4, 6, 5],       // all early -> dawn specialist
    robin: [9, 10, 11, 12]           // n < MIN_OBS(5) -> excluded
  };
  const names = { owl: 'Barred Owl', pipit: 'American Pipit' };
  const sp = BL.todSpecialists(hours, names, BL.CONST.TOD_MIN_OBS);
  const owl = sp.night.find((e) => e.code === 'owl');
  const pipit = sp.dawn.find((e) => e.code === 'pipit');
  assert.ok(owl, 'owl is a night specialist');
  assert.ok(pipit, 'pipit is a dawn specialist');
  assert.equal(sp.dawn.find((e) => e.code === 'robin'), undefined, 'robin excluded (too few obs)');
  ['code', 'name', 'n', 'early_pct', 'late_pct', 'median_hour', 'min_hour', 'max_hour']
    .forEach((k) => assert.ok(k in owl, 'night entry exposes ' + k));
  assert.equal(owl.name, 'Barred Owl', 'name carried from names map');
  assert.ok(owl.late_pct >= BL.CONST.TOD_NIGHT_TH, 'owl over night threshold');
  assert.ok(pipit.early_pct >= BL.CONST.TOD_DAWN_TH, 'pipit over dawn threshold');
});

// --- convoys (mirror section_birder_convoys) -------------------------------
test('convoyDetect: >=2 birders sharing >=2 stops in a day; excludes own', () => {
  const day = '2026-01-15';
  const chk = (subId, who, locId) => ({ subId, userDisplayName: who, locId, isoObsDate: day + ' 08:00' });
  const lists = [
    chk('S1', 'Ann', 'LA'), chk('S2', 'Bo', 'LA'),   // shared stop LA
    chk('S3', 'Ann', 'LB'), chk('S4', 'Bo', 'LB'),   // shared stop LB -> convoy (2 stops)
    chk('S5', 'Me', 'LA'),                            // own -> excluded
    chk('S6', 'Cy', 'LC')                             // lone -> no convoy
  ];
  const routes = BL.convoyDetect(lists, new Date(day + 'T12:00:00'), 'Me');
  assert.equal(routes.length, 1, 'exactly one convoy');
  assert.deepEqual(routes[0].members, ['Ann', 'Bo'], 'members sorted, own excluded');
  assert.equal(routes[0].stops.length, 2, 'two shared stops');
  assert.equal(routes[0].day, day);
});

test('convoyDetect: a single shared stop is not a convoy (MIN_STOPS=2)', () => {
  const day = '2026-01-15';
  const chk = (subId, who, locId) => ({ subId, userDisplayName: who, locId, isoObsDate: day + ' 08:00' });
  const routes = BL.convoyDetect([chk('S1', 'Ann', 'LA'), chk('S2', 'Bo', 'LA')],
    new Date(day + 'T12:00:00'), 'Me');
  assert.equal(routes.length, 0, 'one stop -> below CONVOY_MIN_STOPS');
});

// --- chase views (end-to-end over a tiny synthetic snapshot) ---------------
function waSnapshot(rowsByFile) {
  // Fill in every wa plan file so unlisted feeds are empty arrays.
  const wa = BL.profileFor('wa');
  const map = {};
  BL.planFeeds(wa).forEach((f) => { map[f.file] = rowsByFile[f.file] || []; });
  return map;
}
const OBS = (o) => ({
  obsId: o.obsId, speciesCode: o.speciesCode, comName: o.comName || o.speciesCode,
  locId: o.locId || 'L1', locName: o.locName || 'Marymoor Park',
  lat: o.lat == null ? 47.658 : o.lat, lng: o.lng == null ? -122.113 : o.lng,
  obsDt: o.obsDt, userDisplayName: o.userDisplayName || 'Dana Lee', subId: o.subId || 'S1'
});

test('computeChaseViews: returns the section arrays and excludes seen birds', () => {
  const wa = BL.profileFor('wa');
  const SNAP = '2026-01-15';
  const rowsToday = waSnapshot({
    'king-recent.json': [
      OBS({ obsId: 'o-need', speciesCode: 'buffle', comName: 'Bufflehead', obsDt: SNAP + ' 08:30' }),
      OBS({ obsId: 'o-seen', speciesCode: 'mallar3', comName: 'Mallard', obsDt: SNAP + ' 08:30' })
    ],
    'king-notable.json': [
      OBS({ obsId: 'o-rare', speciesCode: 'brnboo', comName: 'Brown Booby', obsDt: SNAP + ' 08:30' })
    ]
  });
  const cv = BL.computeChaseViews(wa, {
    rowsToday, rowsPrior: waSnapshot({}),
    seen: { mallar3: 1 }, ownName: 'Nobody', snapshotDate: SNAP,
    home: wa.home, dailyDriveMi: wa.dailyDriveMi
  });
  ['merged', 'unseen', 'near', 'destinations', 'excursions', 'notableToday', 'newArrivals']
    .forEach((k) => assert.ok(Array.isArray(cv[k]), 'cv.' + k + ' is an array'));
  const unseenCodes = cv.unseen.map((r) => r.code);
  assert.ok(unseenCodes.includes('buffle'), 'unseen keeps the un-seen Need bird');
  assert.ok(!unseenCodes.includes('mallar3'), 'unseen drops the already-seen bird');
  const rare = cv.merged.find((r) => r.obsId === 'o-rare');
  assert.equal(rare.kind, 'Rarity', 'notable-feed obs flagged Rarity');
  const need = cv.merged.find((r) => r.obsId === 'o-need');
  assert.equal(need.kind, 'Need', 'recent-only obs flagged Need');
});

test('computeChaseViews: newArrivals = today\'s near birds not present the prior day', () => {
  const wa = BL.profileFor('wa');
  const SNAP = '2026-01-15';
  const today = waSnapshot({
    'king-recent.json': [
      OBS({ obsId: 'o-fresh', speciesCode: 'buffle', comName: 'Bufflehead', obsDt: SNAP + ' 08:30' }),
      OBS({ obsId: 'o-old', speciesCode: 'gadwal', comName: 'Gadwall', obsDt: SNAP + ' 08:30' })
    ]
  });
  const prior = waSnapshot({
    'king-recent.json': [
      OBS({ obsId: 'p-old', speciesCode: 'gadwal', comName: 'Gadwall', obsDt: '2026-01-14 08:30' })
    ]
  });
  const cv = BL.computeChaseViews(wa, {
    rowsToday: today, rowsPrior: prior,
    seen: {}, ownName: 'Nobody', snapshotDate: SNAP, home: wa.home, dailyDriveMi: wa.dailyDriveMi
  });
  const arrivals = cv.newArrivals.map((r) => r.code);
  assert.ok(arrivals.includes('buffle'), 'buffle is new today');
  assert.ok(!arrivals.includes('gadwal'), 'gadwall present yesterday -> not a new arrival');
});

// --- render adapter --------------------------------------------------------
test('toRenderDest: maps cluster fields (lon->lng) and Infinity dist -> null', () => {
  const rd = BL.toRenderDest({
    locId: 'L123', loc: 'Marymoor Park', lat: 47.66, lon: -122.11,
    score: 7, rareCount: 2, distMi: 3.4,
    species: [{ code: 'buffle', name: 'Bufflehead', kind: 'Need' },
      { code: 'brant', name: 'Brant', kind: 'Rarity' }]
  });
  assert.equal(rd.locName, 'Marymoor Park');
  assert.equal(rd.lng, -122.11, 'lon mapped to lng');
  assert.equal(rd.score, 7);
  assert.equal(rd.rare, 2);
  assert.equal(rd.dist, 3.4);
  assert.equal(rd.species[0].comName, 'Bufflehead');
  assert.equal(rd.species[1].rare, true, 'Rarity -> rare true');
  assert.equal(rd.species[0].rare, false, 'Need -> rare false');
  assert.equal(BL.toRenderDest({ distMi: Infinity, species: [] }).dist, null, 'Infinity -> null');
});

// --- constants -------------------------------------------------------------
test('CONST: thresholds the app + report share are present and sane', () => {
  const c = BL.CONST;
  assert.equal(c.TOD_MIN_OBS, 5);
  assert.equal(c.TOD_DAWN_TH, 0.5);
  assert.equal(c.TOD_NIGHT_TH, 0.3);
  assert.equal(c.CONVOY_LOOKBACK_DAYS, 7);
  assert.equal(c.CONVOY_MIN_STOPS, 2);
  assert.equal(c.CUTOFF_DAYS, 2);
});
