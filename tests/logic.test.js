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
  ['merged', 'unseen', 'near', 'destinations', 'excursions', 'notableToday']
    .forEach((k) => assert.ok(Array.isArray(cv[k]), 'cv.' + k + ' is an array'));
  const unseenCodes = cv.unseen.map((r) => r.code);
  assert.ok(unseenCodes.includes('buffle'), 'unseen keeps the un-seen Need bird');
  assert.ok(!unseenCodes.includes('mallar3'), 'unseen drops the already-seen bird');
  const rare = cv.merged.find((r) => r.obsId === 'o-rare');
  assert.equal(rare.kind, 'Rarity', 'notable-feed obs flagged Rarity');
  const need = cv.merged.find((r) => r.obsId === 'o-need');
  assert.equal(need.kind, 'Need', 'recent-only obs flagged Need');
});

test('computeChaseViews: notableToday keeps one row per checklist, newest first', () => {
  const wa = BL.profileFor('wa');
  const SNAP = '2026-01-15';
  const today = waSnapshot({
    'king-notable.json': [
      OBS({ obsId: 'o-a', subId: 'S1', speciesCode: 'buffle', comName: 'Bufflehead', obsDt: SNAP + ' 08:30' }),
      OBS({ obsId: 'o-b', subId: 'S2', speciesCode: 'buffle', comName: 'Bufflehead', obsDt: SNAP + ' 11:00' }),
      OBS({ obsId: 'o-c', subId: 'S3', speciesCode: 'gadwal', comName: 'Gadwall', obsDt: '2026-01-14 08:30' })
    ]
  });
  const cv = BL.computeChaseViews(wa, {
    rowsToday: today, rowsPrior: waSnapshot({}),
    seen: {}, ownName: 'Nobody', snapshotDate: SNAP, home: wa.home, dailyDriveMi: wa.dailyDriveMi
  });
  const subs = cv.notableToday.map((r) => r.subId);
  assert.deepEqual(subs, ['S2', 'S1'], 'both of today\'s checklists kept, newest first');
  assert.ok(!subs.includes('S3'), 'yesterday\'s rarity is not in today\'s report');
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

// --- surge detection -------------------------------------------------------
// Reproduces the two events that motivated this: ~20 birders on a Tufted
// Puffin at the Edmonds waterfront in one day, and a Terek Sandpiper mega at
// the Stanwood treatment ponds that cascaded through the WA leaderboard.
const REC = (o) => ({
  code: o.code, name: o.name || o.code, kind: o.kind || 'Rarity',
  dateStr: o.dateStr, observer: o.observer, subId: o.subId || ('S' + Math.random()),
  locId: o.locId || 'L1', loc: o.loc || 'Edmonds Waterfront',
  lat: o.lat == null ? 47.811 : o.lat, lon: o.lon == null ? -122.394 : o.lon,
});
// 2026-07-27 12:00 local, the day of the puffin twitch.
const NOW = new Date(2026, 6, 27, 18, 0).getTime();
const DAY = (n, hh) => {
  const d = new Date(2026, 6, 27 - n, hh == null ? 9 : hh);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:00`;
};

test('surgeEvents: 20 birders on one puffin in a day fires; a lone daily regular does not', () => {
  const recs = [];
  for (let i = 0; i < 20; i++) {
    recs.push(REC({ code: 'tufpuf', name: 'Tufted Puffin', dateStr: DAY(0, 7 + (i % 10)), observer: 'birder' + i }));
  }
  // The puffin is locally REGULAR here — that is the whole point of the crowd
  // gate, since no rarity feed would surface it. Give it the trailing norm a
  // regular bird has, or it fires as "novel" and proves nothing about crowds.
  for (let d = 2; d < 14; d++) {
    recs.push(REC({ code: 'tufpuf', name: 'Tufted Puffin', kind: 'Need', dateStr: DAY(d), observer: 'ferry regular' }));
  }
  // A bird one person reports every single day is normal, not news.
  for (let d = 0; d < 14; d++) {
    recs.push(REC({ code: 'gbhher', name: 'Great Blue Heron', kind: 'Need', dateStr: DAY(d), observer: 'same person', locId: 'L2', lat: 47.9, lon: -122.2 }));
  }
  const ev = BL.surgeEvents(recs, { now: NOW });
  assert.equal(ev.length, 1, 'exactly one event fires');
  assert.equal(ev[0].code, 'tufpuf');
  assert.equal(ev[0].observers, 20, 'counts distinct observers');
  assert.equal(ev[0].reason, 'crowd', 'a bird with a norm fires by blowing past it');
  assert.match(ev[0].loc, /Edmonds/);
});

test('surgeEvents: counts observers, not checklists — one birder cannot fake a crowd', () => {
  const recs = [];
  // Same person, ten checklists at the stakeout in one day.
  for (let i = 0; i < 10; i++) {
    recs.push(REC({ code: 'tufpuf', name: 'Tufted Puffin', dateStr: DAY(0, 7 + i), observer: 'Solo Birder' }));
  }
  assert.deepEqual(BL.surgeEvents(recs, { now: NOW }), [],
    'ten lists from one observer is one person, so nothing fires');
});

test('surgeEvents: a mega fires on its SECOND independent report, not its twentieth', () => {
  // Terek Sandpiper: nothing in the trailing window, then two observers.
  const recs = [
    REC({ code: 'tersan', name: 'Terek Sandpiper', dateStr: DAY(0, 8), observer: 'Ryan Merrill', locId: 'L9', loc: 'Stanwood STP', lat: 48.24, lon: -122.37 }),
    REC({ code: 'tersan', name: 'Terek Sandpiper', dateStr: DAY(0, 11), observer: 'Bruce LaBar', locId: 'L9', loc: 'Stanwood STP', lat: 48.24, lon: -122.37 }),
  ];
  const ev = BL.surgeEvents(recs, { now: NOW });
  assert.equal(ev.length, 1, 'two observers of an otherwise-absent species is enough');
  assert.equal(ev[0].reason, 'novel');
  assert.equal(ev[0].novel, true);
  // ...but a single observer is not: one report is a claim, not an event.
  assert.deepEqual(BL.surgeEvents([recs[0]], { now: NOW }), []);
});

test('surgeEvents: two names on ONE shared checklist is one observation, not two', () => {
  // eBird returns a row per participant, so a couple birding together looks
  // like two independent reports of everything they saw. On real data this
  // fired "novel" for Fox Sparrow, Cassin's Finch, Mountain Chickadee and
  // American Goshawk simultaneously — all from a single dawn walk up a
  // mountain, all from checklist S377184798 at 6:46 am. Four bogus alerts
  // from one outing is how a chase detector teaches you to ignore it.
  const shared = [
    REC({ code: 'moucha', name: 'Mountain Chickadee', dateStr: DAY(0, 6), observer: 'Ann', subId: 'S377184798', locId: 'L77', loc: 'Windy Gap' }),
    REC({ code: 'moucha', name: 'Mountain Chickadee', dateStr: DAY(0, 6), observer: 'Bob', subId: 'S377184798', locId: 'L77', loc: 'Windy Gap' }),
  ];
  assert.deepEqual(BL.surgeEvents(shared, { now: NOW }), [],
    'both observers filed the same list, so there is only one sighting');

  // Split them onto their own checklists at the same spot and it is a real
  // second report — two people who independently found the bird.
  const split = [
    REC({ ...shared[0], subId: 'S1' }),
    REC({ ...shared[1], subId: 'S2' }),
  ];
  assert.equal(BL.surgeEvents(split, { now: NOW }).length, 1,
    'independent checklists corroborate; a shared one only echoes');
});

test('surgeEvents: six people at six lakes is a movement, not a stakeout you can drive to', () => {
  const recs = [];
  for (let i = 0; i < 6; i++) {
    recs.push(REC({
      code: 'rednec', name: 'Red-necked Phalarope', dateStr: DAY(0, 8 + i),
      observer: 'birder' + i, locId: 'L' + i, loc: 'Lake ' + i,
      lat: 47.5 + i * 0.4, lon: -122.3 - i * 0.4,
    }));
  }
  assert.deepEqual(BL.surgeEvents(recs, { now: NOW }), [],
    'spatially scattered reports never form one cluster, so no chaseable event');
});

test('surgeEvents: stale reports outside the window do not fire', () => {
  const recs = [];
  for (let i = 0; i < 20; i++) {
    recs.push(REC({ code: 'tufpuf', name: 'Tufted Puffin', dateStr: DAY(6, 7 + (i % 10)), observer: 'birder' + i }));
  }
  assert.deepEqual(BL.surgeEvents(recs, { now: NOW }), [],
    'a crowd six days ago is history, not a chase');
});

test('surgeEvents: reports whether you still need the bird, without filtering on it', () => {
  const recs = [];
  for (let i = 0; i < 6; i++) {
    recs.push(REC({ code: 'tufpuf', name: 'Tufted Puffin', dateStr: DAY(0, 7 + i), observer: 'birder' + i }));
  }
  const ev = BL.surgeEvents(recs, { now: NOW, seen: { tufpuf: 1 } });
  assert.equal(ev.length, 1, 'a mob on a bird you already have is still an event');
  assert.equal(ev[0].seen, true, 'but it says so, so the caller can rank it down');
});

test('tickCascades: three of the top 100 adding the same bird in days is a mega', () => {
  const parse = (s) => {
    const m = /^(.*?)\s*\(([A-Za-z]{3}\.?\s+\d{1,2},\s*\d{4})\)\s*$/.exec(String(s).trim());
    if (!m) return null;
    const d = new Date(m[2].replace('.', '') + ' 00:00:00');
    return { species: m[1].trim(), date: isNaN(d) ? '' : d.toISOString().slice(0, 10) };
  };
  const rows = [
    { name: 'Brian Pendleton', rank: 3, recent: 'Terek Sandpiper (Jul 19, 2026)' },
    { name: 'Liam Hutcheson', rank: 4, recent: 'Terek Sandpiper (Jul 18, 2026)' },
    { name: 'Bruce LaBar', rank: 8, recent: 'Terek Sandpiper (Jul 19, 2026)' },
    { name: 'Calvin Bobek', rank: 10, recent: 'Terek Sandpiper (Jul 19, 2026)' },
    // Two birders, so below the threshold.
    { name: 'Greg Harrington', rank: 6, recent: 'American Three-toed Woodpecker (Jul 27, 2026)' },
    { name: 'Peter Erickson', rank: 93, recent: 'American Three-toed Woodpecker (Jul 26, 2026)' },
  ];
  const out = BL.tickCascades(rows, parse);
  assert.equal(out.length, 1, 'only the four-birder species is a cascade');
  assert.equal(out[0].species, 'Terek Sandpiper');
  assert.equal(out[0].birders.length, 4);
  assert.equal(out[0].birders[0].rank, 3, 'birders are listed best-ranked first');
});

test('tickCascades: the same bird added months apart is not a cascade', () => {
  const parse = (s) => {
    const m = /^(.*?)\s*\((\d{4}-\d{2}-\d{2})\)$/.exec(s);
    return m ? { species: m[1], date: m[2] } : null;
  };
  const rows = [
    { name: 'A', rank: 1, recent: 'Gray Catbird (2026-05-01)' },
    { name: 'B', rank: 2, recent: 'Gray Catbird (2026-06-15)' },
    { name: 'C', rank: 3, recent: 'Gray Catbird (2026-07-22)' },
  ];
  assert.deepEqual(BL.tickCascades(rows, parse), [],
    'ticks spread over months are a common bird, not a twitch');
});

test('tickCascades: one birder listed twice counts once', () => {
  const parse = (s) => ({ species: s, date: '2026-07-19' });
  const rows = [
    { name: 'Birder Wyatt', rank: 211, recent: 'Terek Sandpiper' },
    { name: 'Birder Wyatt', rank: 211, recent: 'Terek Sandpiper' },
    { name: 'Someone Else', rank: 4, recent: 'Terek Sandpiper' },
  ];
  assert.deepEqual(BL.tickCascades(rows, parse), [],
    'the board appends your own row after the hundredth; it is still one person');
});

test('surgeEvents: the baseline divisor is measured from the data, not assumed', () => {
  // The regression this guards: dividing by the CONFIGURED 14 days when the
  // feed only carries 7 understates the baseline ~2.3x, so an ordinary busy
  // day clears MIN_RATIO and the section fills with non-events.
  // Seven days of data in which a common bird is seen by 3 people a day.
  const recs = [];
  for (let d = 2; d < 7; d++) {
    for (let i = 0; i < 3; i++) {
      recs.push(REC({ code: 'norfli', name: 'Northern Flicker', kind: 'Need', dateStr: DAY(d, 8 + i), observer: 'b' + d + '-' + i }));
    }
  }
  // ...and 5 people today. Busier, but nothing like a twitch.
  for (let i = 0; i < 5; i++) {
    recs.push(REC({ code: 'norfli', name: 'Northern Flicker', kind: 'Need', dateStr: DAY(0, 8 + i), observer: 'today' + i }));
  }
  assert.equal(BL.baselineDays(new Date(2026, 6, 27 - 6, 9).getTime(), NOW, BL.SURGE).toFixed(1), '4.9',
    'divisor is the span actually present (6.4 d) minus the hot window, not 12.5');
  assert.deepEqual(BL.surgeEvents(recs, { now: NOW }), [],
    'five observers against a real baseline of ~3.3/day is ratio 1.5 — not a surge');
});

test('surgeEvents: a longer feed cannot dilute the baseline past the config', () => {
  // The cap matters in the other direction: 60 days of history divided by 60
  // would make any species look absent, so novelty is judged over BASELINE_DAYS.
  const old = new Date(2026, 6, 27 - 60, 9).getTime();
  assert.equal(BL.baselineDays(old, NOW, BL.SURGE), 14 - 1.5);
});

test('hotspotConvergence: a crowd at one spot flags the twitch before you know the bird', () => {
  const rows = [];
  for (let i = 0; i < 8; i++) {
    rows.push({ locId: 'L1', locName: 'Edmonds Waterfront', userDisplayName: 'birder' + i, subId: 'S' + i, obsDt: DAY(0, 7 + i) });
  }
  // Its own norm: one regular, once a day. Starts at d=2 because the hot
  // window is 36 h and would otherwise reach back into yesterday's visit.
  for (let d = 2; d < 14; d++) {
    rows.push({ locId: 'L1', locName: 'Edmonds Waterfront', userDisplayName: 'local patcher', subId: 'P' + d, obsDt: DAY(d) });
  }
  // A busy park that is always busy must NOT fire.
  for (let d = 0; d < 14; d++) {
    for (let i = 0; i < 8; i++) {
      rows.push({ locId: 'L2', locName: 'Discovery Park', userDisplayName: 'p' + d + '-' + i, subId: 'D' + d + i, obsDt: DAY(d, 8) });
    }
  }
  const out = BL.hotspotConvergence(rows, { now: NOW });
  assert.equal(out.length, 1, 'only the spot that broke its own norm fires');
  assert.equal(out[0].locId, 'L1');
  assert.equal(out[0].observers, 8);
});

test('hotspotConvergence: no trailing history means no claim, not an infinite one', () => {
  // The real feed is `product/lists`, which returns the most recent 200
  // checklists per county — about 1.3 DAYS in King County. The 36 h hot
  // window swallows nearly all of it, so almost no location has any cold
  // data. Treating that as ratio=Infinity passed every busy park through and
  // printed "new": Magnuson, Marymoor and Montlake Fill, three of Seattle's
  // most heavily birded spots, were reported as unprecedented under a
  // heading promising "an always-busy park is not news".
  const rows = [];
  for (let i = 0; i < 9; i++) {
    rows.push({ locId: 'L9', locName: 'Marymoor Park', userDisplayName: 'birder' + i, subId: 'S' + i, obsDt: DAY(0, 7 + i) });
  }
  assert.deepEqual(BL.hotspotConvergence(rows, { now: NOW }), [],
    'a busy day with nothing to compare it against is not an event');

  // Give the same spot a real norm and it becomes measurable again — and
  // then 9 observers against ~1/day is a genuine convergence.
  for (let d = 2; d < 14; d++) {
    rows.push({ locId: 'L9', locName: 'Marymoor Park', userDisplayName: 'regular', subId: 'R' + d, obsDt: DAY(d) });
  }
  const out = BL.hotspotConvergence(rows, { now: NOW });
  assert.equal(out.length, 1, 'with a baseline it can fire');
  assert.ok(out[0].ratio > 0 && isFinite(out[0].ratio),
    'and the ratio it reports is a real number, never null or Infinity');
});

test('a section never claims a window its feed cannot cover', () => {
  // product/lists is capped at CONVOY_MAX_RESULTS *per county*, so it is not
  // a date range at all — it is "however far back 200 checklists happen to
  // reach". Measured on live data that is 2 days in King County, under
  // sections that announce 7. The window has to be measured, not assumed.
  const shallow = [
    { subId: 'S1', isoObsDate: '2026-07-27 08:00' },
    { subId: 'S2', isoObsDate: '2026-07-28 09:00' }
  ];
  const deep = [
    { subId: 'S1', isoObsDate: '2026-07-21 08:00' },
    { subId: 'S2', isoObsDate: '2026-07-28 09:00' }
  ];

  assert.equal(BL.feedSpanDays(shallow), 2, 'Jul 27-28 is 2 days, inclusive');
  assert.equal(BL.feedSpanDays(deep), 8, 'Jul 21-28 is 8 days');
  assert.equal(BL.feedSpanDays([]), null, 'an empty feed has no span');
  assert.equal(BL.feedSpanDays([{ subId: 'S1' }]), null, 'nor an undated one');

  assert.equal(BL.feedWindow(shallow, 7).days, 2,
    'a 7-day section on a 2-day feed is a 2-day section');
  assert.ok(/2 days, not 7/.test(BL.feedWindow(shallow, 7).warning),
    'and it says so, naming both the real window and the claimed one');

  // Just as important: a feed that DOES cover its window must stay silent,
  // or the banner becomes wallpaper and stops being read.
  assert.equal(BL.feedWindow(deep, 7).days, 7, 'a deep feed keeps its claim');
  assert.equal(BL.feedWindow(deep, 7).warning, '', 'and raises no warning');

  // An empty feed is its own visible symptom ("none found"); reporting it as
  // truncation as well would point at the wrong cause.
  assert.equal(BL.feedWindow([], 7).warning, '',
    'an empty feed is not reported as a truncated one');
});

test('a hotspot norm is remembered across sessions, not re-derived each run', () => {
  // The feed cannot supply this baseline: product/lists is capped at 200
  // checklists per county, so it reaches back 2-3 days and the 36 h hot window
  // eats most of that. Only 32 of 229 live locations had ANY trailing data.
  // The hourly job already reads this feed every hour — the history was simply
  // being discarded between runs, so remembering it costs no extra API calls.
  const rows = [];
  for (let i = 0; i < 9; i++) {
    rows.push({ locId: 'L9', locName: 'Marymoor Park', userDisplayName: 'birder' + i, subId: 'S' + i, obsDt: DAY(0, 7 + i) });
  }
  assert.deepEqual(BL.hotspotConvergence(rows, { now: NOW }), [],
    'with no memory there is still nothing to compare against');

  const hist = {};
  hist.L9 = {};
  for (let d = 2; d < 14; d++) hist.L9[DAY(d).slice(0, 10)] = ['regular' + d];
  const out = BL.hotspotConvergence(rows, { now: NOW, history: hist });
  assert.equal(out.length, 1, 'a remembered norm makes the spot measurable');

  // 12 observer-days over 12 days is a norm of ~1/day. Divided by the feed's
  // own 1-day span it would read as 12/day and the ratio would collapse from
  // 9x to 0.75x — so a remembered baseline would fire LESS than none at all.
  assert.ok(Math.abs(out[0].baseline - 1) < 0.35,
    'and the divisor grows with the memory (got ' + out[0].baseline + ')');

  // Settled days arrive as a plain count; both storage forms must agree.
  const counts = { L9: {} };
  Object.keys(hist.L9).forEach((d) => { counts.L9[d] = hist.L9[d].length; });
  const out2 = BL.hotspotConvergence(rows, { now: NOW, history: counts });
  assert.ok(Math.abs(out2[0].baseline - out[0].baseline) < 1e-9,
    'named days and settled counts give the same answer');

  // The hourly job re-reads an overlapping feed, so merging must be
  // idempotent: a birder seen in three runs counts once, not three times.
  const feed = [{ locId: 'L9', userDisplayName: 'ann', subId: 'S1', obsDt: DAY(0, 8) }];
  const m1 = BL.mergeHotspotHistory({}, feed, NOW);
  const m2 = BL.mergeHotspotHistory(m1, feed, NOW);
  assert.deepEqual(m2.L9[DAY(0).slice(0, 10)], ['ann'],
    're-running the same feed does not duplicate an observer');

  // Merging must not mutate the tally it was handed.
  assert.deepEqual(m1.L9[DAY(0).slice(0, 10)], ['ann'], 'the input is not mutated');

  const old = BL.mergeHotspotHistory({}, [{ locId: 'L8', userDisplayName: 'x', subId: 'S8', obsDt: DAY(40) }], NOW);
  assert.equal(old.L8, undefined, 'days past the retention window are pruned');

  const settled = BL.mergeHotspotHistory({}, [{ locId: 'L7', userDisplayName: 'x', subId: 'S7', obsDt: DAY(9) }], NOW);
  assert.equal(settled.L7[DAY(9).slice(0, 10)], 1,
    'a settled day collapses from names to a count');
});
