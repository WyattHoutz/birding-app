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
const fs = require('node:fs');

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

// ── A FIELD TRIP IS A CONVOY THAT NEVER DRIVES ANYWHERE ────────────────────
// Reported from the device: "birder convoys didnt get the group of people at
// cedar mouth today, there were about 20 people together around 6-10am and many
// of them reported the rare yellow headed blackbird."
//
// Driven by the REAL morning, captured verbatim from eBird into
// tests/fixtures/convoy-cedar-river-2026-08-22.json, because the owner asked
// for exactly that: "save these checklists and rare bird reports to build a
// test". A synthetic six-person group would have proved the code does what it
// was just written to do; this proves it does what that morning needed.
//
// MEASURED in the fixture: 18 checklists, 16 observers, and of those 16 exactly
// ONE birded a second location that day — so ZERO pairs share two stops and the
// two-stop rule is unreachable however many people are standing there.
const CEDAR = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'convoy-cedar-river-2026-08-22.json'), 'utf8'));

test('the Cedar River field trip is a convoy, though it never left the site', () => {
  // The fixture must still be the case it was captured for.
  assert.equal(CEDAR._measured.pairsSharingTwoLocations, 0,
    'the fixture no longer contains the defect it was captured to prove');
  assert.ok(CEDAR.siteLists.length >= 15, 'the captured morning lost its checklists');

  const day = new Date('2026-08-22T23:00:00');
  const routes = BL.convoyDetect(CEDAR.siteLists, day, 'Birder Wyatt');
  assert.ok(routes.length >= 1,
    'the ~20-person field trip at Cedar River mouth is still invisible — this is '
    + 'the exact report the fixture was captured for');

  const trip = routes.slice().sort((a, b) => b.members.length - a.members.length)[0];
  assert.ok(trip.members.length >= 5,
    'the detected group is smaller than a tour: ' + trip.members.join(', '));
  // The six who shared ONE list at 07:09 with 28 species.
  ['Jordan Juranek', 'Connie Daugherty', 'Denning Gillespie',
   'Casey Herrick', 'Cindy Riskin', 'Erin Chase'].forEach((who) => {
    assert.ok(trip.members.indexOf(who) >= 0,
      who + ' shared the 07:09 checklist but is not in the detected group');
  });
  assert.equal(trip.stops.length, 1, 'this group has exactly one stop — which is '
    + 'the whole point: it qualified WITHOUT a second one');
  assert.ok(trip.shared, 'the group is not flagged as a shared-checklist trip, so '
    + 'the card cannot explain why a one-stop group counts');
  // ...and the reader is not told about a couple of friends who birded
  // together once. A large group is what makes it a tour.
  assert.ok(!routes.some((r) => r.stops.length === 1 && r.members.length < 5),
    'a one-stop group below CONVOY_SHARED_MIN was reported; a pair or a carload '
    + 'sharing one list is friends birding together, not a tour');
});

// ── CELEBRITY BIRDS NEEDS THE SAME GRACE AS TODAY'S TWITCHES ──────────────
// "Celebrity birds 24 hour look back needs same grace period as the today's
//  twitches since checklists may start hours before the bird was sighted."
//
// `recTime` reads `obsDt`, which is the checklist's START (F169), so a bird
// found at the end of a long morning is stamped hours before anyone saw it.
// MEASURED across live checklists: median 1.07 h, max 5.23 h, 27% run ≥4 h.
//
// Driven by the real Cedar River morning rather than synthetic rows, because
// this lane also demands notability, validity, a public place and FOUR
// independent events — a hand-built row misses one of those and gets dropped
// for a reason that has nothing to do with the window, which is exactly what
// happened on the first attempt at this test.
test('Celebrity birds keeps a bird whose checklist started before the window', () => {
  const rows = CEDAR.notable.map((o) => ({
    code: o.speciesCode, name: o.comName, kind: 'Rarity', rare: true,
    dateStr: o.obsDt, loc: o.locName, locName: o.locName, locId: o.locId,
    subId: o.subId, observer: o.userDisplayName, userDisplayName: o.userDisplayName,
    lat: o.lat, lon: o.lng, distMi: 8, valid: o.obsValid, count: o.howMany,
  }));
  const find = (when) => {
    const out = BL.needNearby(rows, { now: Date.parse(when), seen: {}, maxMi: 50 });
    return out.find((x) => x.code === 'yehbla') || null;
  };
  // The morning ran 05:28-15:29 on 22 Aug. Asked on the 23rd at 09:00, a hard
  // 24 h cut-off lands at 09:00 on the 22nd and excludes every report before
  // it — including the 07:09 shared checklist six people filed.
  assert.ok(find('2026-08-23T09:00'),
    'the Yellow-headed Blackbird is dropped 26 h on, though its checklists '
    + 'STARTED early and the bird was seen later — this is the reported bug');
  assert.ok(find('2026-08-22T22:00'), 'dropped on the evening of the same day');
  // ...and the grace is a grace, not an unbounded window.
  assert.ok(!find('2026-08-23T23:00'),
    'a genuinely stale bird survived 40 h, so the window is not closing at all');
  assert.equal(BL.NOTABLE_GRACE_H, 5,
    'the grace is no longer the measured 5 h');
});

test('a shared checklist counts as ONE party in the busy-hotspot lane', () => {
  // Six people on one list is one decision to visit, not six. Before this,
  // Cedar River mouth's 16 observers counted as 16 independent parties and
  // inflated the very "unusually busy" claim the lane exists to make.
  const party = BL.buildParties(CEDAR.siteLists);
  const groups = {};
  CEDAR.siteLists.forEach((r) => {
    groups[party(String(r.userDisplayName || '').trim().toLowerCase())] = 1;
  });
  const nParties = Object.keys(groups).length;
  const nPeople = new Set(CEDAR.siteLists.map((r) => r.userDisplayName)).size;
  assert.ok(nParties < nPeople,
    'every observer is still its own party (' + nParties + ' of ' + nPeople
    + '), so the 07:09 shared list is counted six times over');
  assert.ok(nParties <= nPeople - 5,
    'the six-person shared list did not collapse to one party: ' + nParties
    + ' parties from ' + nPeople + ' people');
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

test('computeChaseViews: the rarity view is a rolling 24 hours, one row per checklist', () => {
  const wa = BL.profileFor('wa');
  const SNAP = '2026-01-15';
  // Pinned to just after midnight — the exact moment the old calendar-day
  // filter emptied the section. "when it hits midnight, the list goes blank
  // and every morning I see no rare birds in the app."
  const NOW = Date.parse('2026-01-15T00:30:00');
  const today = waSnapshot({
    'king-notable.json': [
      OBS({ obsId: 'o-a', subId: 'S1', speciesCode: 'buffle', comName: 'Bufflehead', obsDt: '2026-01-15 00:10' }),
      OBS({ obsId: 'o-b', subId: 'S2', speciesCode: 'buffle', comName: 'Bufflehead', obsDt: '2026-01-14 23:50' }),
      OBS({ obsId: 'o-c', subId: 'S3', speciesCode: 'gadwal', comName: 'Gadwall', obsDt: '2026-01-14 06:00' }),
      OBS({ obsId: 'o-d', subId: 'S4', speciesCode: 'gadwal', comName: 'Gadwall', obsDt: '2026-01-13 12:00' })
    ]
  });
  const cv = BL.computeChaseViews(wa, {
    rowsToday: today, rowsPrior: waSnapshot({}), nowMs: NOW,
    seen: {}, ownName: 'Nobody', snapshotDate: SNAP, home: wa.home, dailyDriveMi: wa.dailyDriveMi
  });
  const subs = cv.notableToday.map((r) => r.subId);

  // THE POINT: last night's birds survive midnight. Under the old rule S2 and
  // S3 both vanished at 00:00 and the reader saw one row, or none.
  assert.deepEqual(subs, ['S1', 'S2', 'S3'], 'everything from the last 24 h, newest first');
  assert.ok(!subs.includes('S4'), 'and nothing older than the window');

  // Deduped by CHECKLIST, not species: S1 and S2 are both Bufflehead and both
  // stand, because two observers reporting the same bird are two places you
  // could drive to.
  assert.equal(subs.filter((s) => s === 'S1').length, 1, 'one row per checklist');

  // The boundary is the window, not the date: same rows, a day later, gone.
  const later = BL.computeChaseViews(wa, {
    rowsToday: today, rowsPrior: waSnapshot({}), nowMs: NOW + 36 * 3600000,
    seen: {}, ownName: 'Nobody', snapshotDate: SNAP, home: wa.home, dailyDriveMi: wa.dailyDriveMi
  });
  assert.deepEqual(later.notableToday.map((r) => r.subId), [],
    'the window really is rolling, not a date comparison in disguise');
});

// The old calendar-day helper is KEPT, and still means one calendar day. An
// archived report is a dated document: re-reading 2026-01-15 should show what
// was around on the 15th, not what is around now.
test('notableToday still means one calendar day, for dated documents', () => {
  const mk = (d, s) => ({ kind: 'Rarity', dateStr: d, subId: s });
  const rows = [mk('2026-01-15 00:10', 'A'), mk('2026-01-14 23:50', 'B')];
  assert.deepEqual(BL.notableToday(rows, '2026-01-15').map((r) => r.subId), ['A'],
    'only the named day');
  assert.equal(BL.NOTABLE_WINDOW_H, 24, 'and the live window is a named constant');
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

// --- F9: phase-2 per-species feeds ----------------------------------------
// The per-county `recent` feed collapses to ONE observation per species, so a
// needed bird contributed a single location however many places reported it:
// every "closest spot" ranking was ranking a sample. Measured on live WA data
// the day this shipped: 41 unseen species went from 66 distinct locations to
// 945, and Common Loon alone went from 1 location to 49.
test('F9: species targets are deduped, sorted and capped', () => {
  const recs = [{ code: 'wesmea' }, { code: 'amerob' }, { code: 'wesmea' },
                { code: '' }, {}, { code: 'bkcchi' }];
  assert.deepEqual(BL.speciesTargetCodes(recs),
    ['amerob', 'bkcchi', 'wesmea'],
    'deduped and sorted — the list IS the fetch plan, so it cannot depend on ' +
    'iteration order or it could not be proven equal across two languages');
  assert.deepEqual(BL.speciesTargetCodes(recs, 2), ['amerob', 'bkcchi'],
    'capped — the cap is what stops a big unseen list turning into a 200-call run');
  assert.equal(BL.SPECIES_FEED_MAX, 60, 'the shipped cap is 60');
  assert.deepEqual(BL.speciesTargetCodes([]), [], 'no needs, no calls');
});

test('F9: the species feed is scoped to the STATE, not the counties', () => {
  // Measured before choosing: Western Kingbird returned 317 records at state
  // scope, 2 at county scope, 0 at hotspot scope. Fanning out per county would
  // be 3x the calls for strictly less data.
  const wa = BL.profileFor('wa');
  assert.equal(BL.speciesFeedRegion(wa), 'US-WA', 'state code wins');
  const feeds = BL.planSpeciesFeeds(wa, ['comloo'], 7);
  assert.equal(feeds.length, 1, 'one call per species, not one per county');
  assert.equal(BL.requestUrl(feeds[0]),
    'data/obs/US-WA/recent/comloo?back=7&detail=full&includeProvisional=true');
  assert.equal(feeds[0].file, 'sp-comloo.json');
  assert.equal(feeds[0].src, 'Sp:comloo');
  assert.deepEqual(BL.planSpeciesFeeds(wa, [], 7), [], 'no codes, no feeds');
  assert.deepEqual(BL.planSpeciesFeeds({ counties: [] }, ['comloo'], 7), [],
    'no region to scope to, no feeds');
  assert.equal(BL.speciesFeedRegion({ counties: [{ code: 'US-WA-033' }] }),
    'US-WA-033', 'falls back to the first county when there is no state code');
});

test('F9: species feeds merge LAST and only ADD locations', () => {
  const wa = BL.profileFor('wa');
  const plan = BL.mergePlan(wa, ['comloo', 'amerob']);
  const files = plan.map((f) => f.file);
  assert.deepEqual(files.slice(-2), ['sp-comloo.json', 'sp-amerob.json'],
    'phase 2 is appended, so merge order — and therefore which row becomes the ' +
    'base row for a duplicated obsId — is unchanged for everything phase 1 had');
  assert.deepEqual(BL.mergePlan(wa).map((f) => f.file),
    files.slice(0, files.length - 2),
    'passing no codes reproduces the phase-1 plan exactly');

  const p1 = [{ obsId: 'A', speciesCode: 'comloo', comName: 'Common Loon',
                locId: 'L1', locName: 'One', lat: 47.5, lng: -122.3,
                obsDt: '2026-07-30 08:00', subId: 'S1' }];
  const p2 = [p1[0], { obsId: 'B', speciesCode: 'comloo', comName: 'Common Loon',
                locId: 'L2', locName: 'Two', lat: 47.6, lng: -122.4,
                obsDt: '2026-07-30 09:00', subId: 'S2' }];
  const base = BL.mergeFromFiles(wa, { 'king-recent.json': p1 });
  const grown = BL.mergeFromFiles(wa, { 'king-recent.json': p1, 'sp-comloo.json': p2 },
    ['comloo']);
  assert.equal(base.length, 1, 'phase 1 alone sees the one location it was told about');
  assert.equal(grown.length, 2, 'phase 2 finds the second location');
  const a = grown.find((r) => r.obsId === 'A');
  assert.equal(a.locId, 'L1', 'the phase-1 row keeps its own location');
  assert.equal(a.kind, base[0].kind, 'the phase-1 row keeps its own kind');
});

test('F9: a phase-2 row of a notable species is still a rarity', () => {
  // The notable feed also collapses per species, so a rarity at five places
  // arrives as ONE flagged row; phase 2 brings the other four in through a feed
  // that carries no rarity flag at all. Without inheritance the section that
  // exists to say "a rare bird is HERE" would point at one of five spots.
  const wa = BL.profileFor('wa');
  const row = (id, locId) => ({ obsId: id, speciesCode: 'brnboo', comName: 'Brown Booby',
    locId: locId, locName: locId, lat: 47.5, lng: -122.3,
    obsDt: '2026-07-30 08:00', subId: 'S' + id });
  const out = BL.mergeFromFiles(wa, {
    'king-notable.json': [row('A', 'L1')],
    'sp-brnboo.json': [row('A', 'L1'), row('B', 'L2')]
  }, ['brnboo']);
  assert.equal(out.length, 2, 'both locations survive');
  out.forEach((r) => assert.equal(r.kind, 'Rarity',
    r.obsId + ' is a rarity — the species was flagged notable, so every place ' +
    'it turned up is a rarity report'));

  const ordinary = BL.mergeFromFiles(wa, {
    'king-recent.json': [row('A', 'L1')],
    'sp-brnboo.json': [row('A', 'L1'), row('B', 'L2')]
  }, ['brnboo']);
  ordinary.forEach((r) => assert.equal(r.kind, 'Need',
    'inheritance only fires when some notable feed actually flagged the species'));
});

// --- F1: travel zones — what a ferry costs ---------------------------------
// Port Townsend is ~33 mi from home as the crow flies and about two and a
// quarter hours away. These guard the mechanism AND, more importantly, the rule
// that keeps it safe: the penalty ranks and labels, it never filters.
const TZ = require(path.join(__dirname, '..', 'www', 'travel-zones.json'));

const HOME = [47.76, -122.14];
const KINGSTON = [47.7970, -122.4960];
const MURDEN = [47.6470, -122.4950];   // Bainbridge — ferry-gated
const OCEAN = [46.9260, -124.1710];    // Ocean Shores — plain mainland
const MARYMOOR = [47.6585, -122.1180];

test('travel zones: real places land in the zone they belong to', () => {
  const cases = [
    ['Marymoor', MARYMOOR, 'mainland'],
    // The straight line from home crosses Puget Sound but I-5 drives around the
    // south end, which is the case that killed the crossing-segment design.
    ['Nisqually NWR', [47.0720, -122.7100], 'mainland'],
    // Island COUNTY, reached by a bridge — free.
    ['Camano Island', [48.2100, -122.4800], 'mainland'],
    ['Ocean Shores', OCEAN, 'mainland'],
    ['Murden Cove', MURDEN, 'bainbridge'],
    ['Point No Point', [47.9120, -122.5260], 'kitsap'],
    // Split out of kitsap 2026-08-05. Manchester is 1.6 km from Bainbridge's
    // south tip but on the mainland, and drives round the Narrows with no boat.
    ['Manchester SP', [47.5780, -122.5450], 'kitsap-south'],
    ['Bremerton', [47.5670, -122.6300], 'kitsap-south'],
    ['Crockett Lake', [48.1900, -122.6600], 'whidbey'],
    ['Port Townsend', [48.1120, -122.7600], 'olympic'],
    ['Vashon Island', [47.4180, -122.4600], 'vashon'],
    ['Gig Harbor', [47.3290, -122.5800], 'gig']
  ];
  cases.forEach(([name, pt, want]) => {
    assert.equal(BL.travelZoneOf(TZ, pt[0], pt[1]), want,
      name + ' is drawn into the wrong zone — a boundary error is silent, it ' +
      'shows up as one town being mysteriously cheap');
  });
});

test('travel zones: Camano is free and Vashon is not, so no per-county table works', () => {
  // Island County holds Whidbey (ferry) AND Camano (bridge); King County holds
  // home AND Vashon (ferry). A per-county penalty is wrong in both directions.
  assert.equal(BL.travelHopMinutes(TZ, HOME[0], HOME[1], 48.2100, -122.4800), 0,
    'Camano is reached by a bridge and must cost nothing');
  assert.ok(BL.travelHopMinutes(TZ, HOME[0], HOME[1], 47.4180, -122.4600) > 0,
    'Vashon is in King County like home, but needs a ferry');
});

test('travel zones: the penalty is between two POINTS, not a hotspot property', () => {
  // Standing in Kingston, Kitsap is free and the Olympic peninsula is one
  // bridge rather than a boat and a bridge. A `ferry: true` flag on the
  // hotspot could never express that.
  assert.equal(BL.travelHopMinutes(TZ, KINGSTON[0], KINGSTON[1], 47.9120, -122.5260), 0,
    'from Kitsap, Point No Point is free');
  const fromKingston = BL.travelHopMinutes(TZ, KINGSTON[0], KINGSTON[1], 48.1120, -122.7600);
  const fromHome = BL.travelHopMinutes(TZ, HOME[0], HOME[1], 48.1120, -122.7600);
  assert.ok(fromKingston > 0 && fromKingston < fromHome,
    'Port Townsend must be cheaper from Kingston (' + fromKingston + ') than ' +
    'from home (' + fromHome + ')');
});

test('travel zones: hops are symmetric', () => {
  const a = BL.travelHopMinutes(TZ, HOME[0], HOME[1], MURDEN[0], MURDEN[1]);
  const b = BL.travelHopMinutes(TZ, MURDEN[0], MURDEN[1], HOME[0], HOME[1]);
  assert.equal(a, b, 'a crossing costs the same both ways');
});

test('travel zones: THE PENALTY MUST NEVER FILTER (F1 decision 5)', () => {
  // The test that matters most. An Arctic Tern was available at Murden Cove
  // (17 mi, ferry-gated) and Ocean Shores (110 mi, no boat). Murden Cove was
  // chosen. If the penalty ever reaches an inclusion test the chosen bird
  // disappears — and because rarities arrive through the geo feed, it
  // disappears silently rather than merely ranking lower.
  const straightMurden = 17.3;
  const effMurden = BL.travelEffectiveMi(TZ, straightMurden, HOME[0], HOME[1], MURDEN[0], MURDEN[1]);

  assert.ok(straightMurden <= 35,
    'Murden Cove is inside a 35 mi straight-line radius and must stay there');
  assert.ok(effMurden > 35,
    'Murden Cove is beyond 35 EFFECTIVE miles — if this ever stops being true ' +
    'the test has stopped testing anything and must be re-derived');

  // Ranking — the thing the penalty is actually for — still prefers what was
  // chosen. A ferry is a cost, not a veto.
  const effOcean = BL.travelEffectiveMi(TZ, 110.2, HOME[0], HOME[1], OCEAN[0], OCEAN[1]);
  assert.ok(effMurden < effOcean,
    'ranking must prefer Murden Cove (' + effMurden.toFixed(0) + ') over Ocean ' +
    'Shores (' + effOcean.toFixed(0) + '), as the reader did');
});

test('travel zones: the label is the shape of the day, not the mileage (F1 decision 6)', () => {
  const effMurden = BL.travelEffectiveMi(TZ, 17.3, HOME[0], HOME[1], MURDEN[0], MURDEN[1]);
  const effOcean = BL.travelEffectiveMi(TZ, 110.2, HOME[0], HOME[1], OCEAN[0], OCEAN[1]);
  assert.equal(BL.travelDayBand(TZ, effMurden).id, 'half',
    'Murden Cove was worth "an excursion"');
  assert.equal(BL.travelDayBand(TZ, effOcean).id, 'trip',
    'Ocean Shores is over two hours each way — "I would not do a day trip". '
    + 'Anything beyond an excursion becomes a trip, which this project already '
    + 'models (regions.Region.kind === "trip": Fort Casey, Waikoloa)');
  assert.equal(BL.travelDayBand(TZ, 7).id, 'quick', 'Marymoor is a quick outing');

  const note = BL.travelNote(TZ, 17.3, HOME[0], HOME[1], MURDEN[0], MURDEN[1]);
  assert.ok(!/round trip|\d\s*h\b/.test(note),
    'the note must NOT print an hour figure. Travel time varies "significantly '
    + 'due to rush hour and peak season", so an estimate is a promise the model '
    + 'cannot keep — while the mileage every section already shows does not vary '
    + 'and can be checked on a map. The band absorbs the variance; a number '
    + 'advertises precision that is not there.');
  assert.match(note, /half day|full day|a trip/,
    'it says the shape of the day, which is the part that survives traffic');
  assert.match(note, /half day/);
  assert.match(note, /ferry/, 'and says how you would cross');
  assert.equal(BL.travelNote(TZ, 7, HOME[0], HOME[1], MARYMOOR[0], MARYMOOR[1]), '',
    'a place with no water in the way stays uncluttered');
});

test('travel zones: half-hour formatting avoids the round-half-to-even trap', () => {
  // Python rounds half to EVEN and JS toFixed does not, so a formatted float
  // is a silent cross-language parity failure waiting for the first x.5 value.
  assert.equal(BL.travelHalfHours(3), '3');
  assert.equal(BL.travelHalfHours(3.25), '3½');
  assert.equal(BL.travelHalfHours(2.5), '2½');
  assert.equal(BL.travelHalfHours(3.5), '3½');
  assert.equal(BL.travelHalfHours(0), '0');
});

test('travel zones: a missing or empty config degrades to no penalty', () => {
  // The badge is an enhancement. An app that ranks Port Townsend a little too
  // kindly is better than one that throws while drawing a list.
  assert.equal(BL.travelZoneOf({}, MURDEN[0], MURDEN[1]), 'mainland');
  assert.equal(BL.travelHopMinutes({}, HOME[0], HOME[1], MURDEN[0], MURDEN[1]), 0);
  assert.equal(BL.travelEffectiveMi({}, 17.3, HOME[0], HOME[1], MURDEN[0], MURDEN[1]), 17.3);
  assert.equal(BL.travelNote({}, 17.3, HOME[0], HOME[1], MURDEN[0], MURDEN[1]), '');
  assert.equal(BL.travelZoneOf(TZ, null, undefined), 'mainland');
});

// A SEASONAL GATE. The zone mechanism is not water-specific -- it is a fixed
// time cost between two zones with a human-readable reason, so a mountain pass,
// a border crossing, a toll road or a flight fit it as well as a ferry. Puget
// Sound's gates happen to be ferries; other regions have other kinds.
//
// The one thing a fixed cost CANNOT express is a gate that shuts, and that is
// not hypothetical even here: SR-20 over Rainy and Washington Passes closes
// roughly November to May every year, Chinook Pass with it.
//
// Mirrors travel.hop_minutes / travel.hop_via, so the app and the report cannot
// disagree about whether you can get somewhere this month.
test('travel zones: a gate can be shut for the season', () => {
  const cfg = JSON.parse(JSON.stringify(TZ));
  const home = [47.76, -122.14];
  const kitsap = [47.9120, -122.5260];

  const open = BL.travelHopMinutes(cfg, home[0], home[1], kitsap[0], kitsap[1], 7);
  cfg.hops['mainland|kitsap'].closed_months = [11, 12, 1, 2, 3, 4];

  assert.equal(BL.travelHopMinutes(cfg, home[0], home[1], kitsap[0], kitsap[1], 7), open,
    'an open month is unaffected by the closure list');

  const shut = BL.travelHopMinutes(cfg, home[0], home[1], kitsap[0], kitsap[1], 1);
  assert.ok(shut > open,
    `a shut gate must cost more than an open one (got ${shut} vs ${open})`);
  assert.ok(shut >= 400,
    'a shut gate must dominate every band, or somewhere unreachable until May '
    + 'reads as a normal day out');

  const via = BL.travelHopVia(cfg, home[0], home[1], kitsap[0], kitsap[1], 1);
  assert.match(via, /closed/i,
    '"closed until May" is the most useful thing the app can say about such a place');
});

/* ---------------------------------------------------------------- waypoints
 * "often rare bird observations will contain waypoints, so id primarily like
 *  to highlight comments with waypoints because they clarify chasing. todays
 *  lark sparrow had a waypoint that pointed to a helipad in union bay hotspot"
 *
 * The fixture below is the REAL comment from that bird, pulled from
 * product/checklist/view/S380897123 on 2026-08-07. Union Bay Natural Area is
 * ~100 acres; the hotspot pin puts you in the car park and the waypoint puts
 * you at the helipad.
 */
const LARK = '47.65798\u00b0 N, 122.29830\u00b0 W thanks Alec and Louis! Continuing '
  + 'sparrow with reddish well defined streaks on head.  Foraging on far side of '
  + 'helipad, viewable from parking lot side of helipad. Photos';
const UNION_BAY = { lat: 47.6580, lng: -122.2980 };

test('a waypoint is read out of a real rare-bird comment', () => {
  const w = BL.waypointFrom(LARK, UNION_BAY);
  assert.ok(w, 'the coordinates are found inside the prose');
  assert.ok(Math.abs(w.lat - 47.65798) < 1e-6, 'latitude');
  // The trap: the longitude is written POSITIVE with a W. Taken at face value
  // this is Kazakhstan.
  assert.ok(Math.abs(w.lng - -122.29830) < 1e-6,
    'the W is honoured, so the longitude is negative');
  assert.ok(!w.repaired, 'a well-formed waypoint is not "repaired" into something else');
});

test('a backwards or unsigned waypoint is repaired, but only against the sighting', () => {
  // "sometimes waypoints are backwards, so they may need to be flipped so they
  //  dont point to china by accident"
  const cases = [
    ['47.65798, 122.29830', 'sign'],          // the minus was eaten -> Heilongjiang
    ['-122.29830, 47.65798', 'swapped'],      // longitude typed first
    ['122.29830, 47.65798', 'swapped + sign'],
  ];
  for (const [text, fix] of cases) {
    const w = BL.waypointFrom(text, UNION_BAY);
    assert.ok(w, 'a repairable pair still yields a waypoint: ' + text);
    assert.ok(Math.abs(w.lat - 47.65798) < 1e-6, 'lat for ' + text);
    assert.ok(Math.abs(w.lng - -122.29830) < 1e-6, 'lng for ' + text);
    assert.equal(w.repaired, fix, 'and says how it was read: ' + text);
  }

  // The oracle is what makes any of that safe. A coordinate that is nowhere
  // near the bird is REJECTED rather than bent until it fits.
  assert.equal(BL.waypointFrom('40.7128, -74.0060', UNION_BAY), null,
    'Manhattan is not a waypoint for a bird at Union Bay');
  // ...and with no oracle, nothing is guessed at all.
  const blind = BL.waypointFrom('47.65798, 122.29830', null);
  assert.ok(blind && blind.lng > 0,
    'with nothing to check against, the literal reading stands rather than a guess');
});

test('an explicitly labelled pair is never reordered', () => {
  // N/S/E/W says which number is which. Only an UNLABELLED pair is ambiguous,
  // so only an unlabelled pair may be swapped.
  const w = BL.waypointFrom('47.65798\u00b0 N, 122.29830\u00b0 W', UNION_BAY);
  assert.ok(w && !w.repaired, 'the labels are believed as written');
  assert.equal(BL.waypointFrom('12.0\u00b0 N, 34.0\u00b0 E', UNION_BAY), null,
    'and a labelled pair that lands far away is dropped, not swapped into range');
});

test('DMS and plain prose', () => {
  const w = BL.waypointFrom('47\u00b039\u203228.7"N 122\u00b017\u203254.0"W', UNION_BAY);
  assert.ok(w, 'degrees/minutes/seconds parse');
  assert.ok(Math.abs(w.lat - 47.6580) < 0.01 && Math.abs(w.lng - -122.2983) < 0.01, 'and land at the site');
  assert.equal(BL.waypointFrom('Foraging by the helipad, no coords', UNION_BAY), null,
    'prose with no numbers is not a waypoint');
  assert.equal(BL.waypointFrom('2 birds, 1.5 hours', UNION_BAY), null,
    'and counts are not coordinates');
});

test('on a rare bird the NOTE badge is noise, the WAYPOINT badge is signal', () => {
  // "rare birds require comments in observations, so all rare bird observations
  //  are not interesting, but some have chasing details like waypoints"
  //
  // eBird demands details on a flagged species, so every rarity row has a
  // comment. A mark that is always present is not a mark.
  const plain = BL.checklistDetail(
    { comments: 'Harlequin pattern of rusty brown and white. Thanks Alec!!! Lifer' },
    UNION_BAY);
  const wp = BL.checklistDetail({ comments: LARK, mediaCounts: { P: 4 } }, UNION_BAY);

  assert.ok(BL.checklistIcons(plain).includes(BL.COMMENT_ICON),
    'an ordinary list still marks that a note exists');
  assert.ok(!BL.checklistIcons(plain, { noteRequired: true })
    .includes(BL.COMMENT_ICON),
    'but where a note is MANDATORY the badge says nothing and is dropped');
  assert.ok(BL.checklistIcons(wp, { noteRequired: true })
    .includes(BL.WAYPOINT_ICON),
    'a waypoint is never dropped — it is the one somebody chose to give you');
  assert.ok(BL.checklistIcons(wp, { noteRequired: true })
    .includes(BL.MEDIA_ICON),
    'and the photo mark survives alongside it');
  assert.ok(!BL.checklistIcons(wp).includes(BL.COMMENT_ICON),
    'a waypoint REPLACES the generic note badge rather than doubling it');
});

test('photo, video and audio are three marks, not two', () => {
  const ic = (m) => BL.checklistIcons({ m: m });
  assert.equal(ic('P'), BL.MEDIA_ICON, 'photo');
  assert.equal(ic('V'), BL.VIDEO_ICON, 'video is no longer collapsed into the camera');
  assert.equal(ic('A'), BL.AUDIO_ICON, 'audio');
  assert.notEqual(BL.VIDEO_ICON, BL.MEDIA_ICON, 'and the glyphs differ');
  const all = ic('APV');
  for (const g of [BL.MEDIA_ICON, BL.VIDEO_ICON, BL.AUDIO_ICON]) {
    assert.ok(all.includes(g), 'a checklist with everything shows everything');
  }
});

test('a note has to be a note', () => {
  assert.ok(!BL.hasNote('2'), 'a bare count is not a note');
  assert.ok(!BL.hasNote(''), 'nor is nothing');
  assert.ok(!BL.hasNote('++'), 'nor punctuation');
  assert.ok(BL.hasNote('heard only'), 'but ten characters of English is');
  assert.ok(BL.hasNote('in willows'), 'and so is a place');
});


// ---- how long a cached checklist stays believable -------------------------
//
// "checklists are sometimes posted and then later updated with media, but then
// they do not change very often. so they are good candidates to cache, esp if
// they have media attached already. durable between app restarts."
//
// The cache was scoped to the DAY, and the boot-time prune deleted everything
// not written today — so the store was durable and the policy was not, and
// every checklist was re-bought each morning at ~2.7s of token budget each.
test('a settled checklist is cached for a month, a fresh one for a day', () => {
  const T = '2026-08-08';
  const ttl = (e) => BL.checklistCacheTtl(e, T);

  // Filed today: still settling. Species get added, photos are still going up.
  assert.equal(ttl({ o: '2026-08-08', m: 0 }), 1, 'today is volatile');
  assert.equal(ttl({ o: '2026-08-08', m: 1 }), 1,
    'and media already present does NOT settle a checklist filed this morning '
    + '— more can follow the same day');

  // Old and already carrying media: the one thing the short TTL was waiting
  // for has HAPPENED. Re-buying it cannot change the mark it produced.
  assert.equal(ttl({ o: '2026-07-30', m: 1 }), 30, 'settled, with the media in');
  // Old and still silent: media can still arrive late, so not a month.
  assert.equal(ttl({ o: '2026-07-30', m: 0 }), 7, 'settled, but still able to speak');

  // An unknown or future date is treated as BRAND NEW, never as old. Guessing
  // "old" would hand the longest TTL to the rows most likely to change.
  assert.equal(ttl({ o: '', m: 1 }), 1, 'no date is not permission to trust it');
  assert.equal(ttl({ o: '2026-09-01', m: 1 }), 1, 'nor is a date in the future');
});

test('a cached checklist survives restarts, but never outlives its TTL', () => {
  const T = '2026-08-08', v = { obs: [] };
  const fresh = (e) => BL.checklistCacheFresh(e, T);

  // THE BUG THIS EXISTS TO PREVENT. Fetched three weeks ago, filed before that,
  // media already attached — the old policy threw this away at the next launch
  // and paid 2.7s to fetch a byte-identical answer.
  assert.ok(fresh({ d: '2026-07-19', o: '2026-07-10', m: 1, v }),
    'three weeks old, settled, still believed');
  assert.ok(!fresh({ d: '2026-06-29', o: '2026-07-10', m: 1, v }),
    'but a month is the limit — a checklist can be edited or withdrawn, and a '
    + 'cache with no expiry is one you can never correct');

  assert.ok(fresh({ d: '2026-08-03', o: '2026-07-10', m: 0, v }), 'silent: 7 days');
  assert.ok(!fresh({ d: '2026-07-30', o: '2026-07-10', m: 0, v }), 'silent: not 9');

  assert.ok(!fresh({ d: T, o: T, m: 1 }), 'an entry with no payload is not a hit');
  assert.ok(!fresh(null, T), 'nor is a missing one');
  // Travel and DST move the clock. A negative age must not read as fresh.
  assert.ok(!fresh({ d: '2026-08-09', o: T, m: 1, v }, T),
    'a stamp from the future is refetched, not trusted');
});

// The letters the notable feed hands over for free, and what each one means.
// Measured on 400 live WA notable rows: 254 P, 8 A, 3 V, 135 None — every row
// answered, which is why no call is needed to mark a checklist row.
test('evidence letters become one mark each, and video is not a camera', () => {
  const ic = (r) => BL.recordIcons(r);
  assert.equal(ic({ evidence: 'P' }), '\u{1F4F7}', 'photo');
  assert.equal(ic({ evidence: 'A' }), '\u{1F50A}', 'audio');
  assert.equal(ic({ evidence: 'V' }), '\u{1F3A5}',
    'VIDEO GETS ITS OWN GLYPH. It used to fold into the camera, throwing away a '
    + 'distinction the feed carries for free — and making a row change glyph '
    + 'when the slower checklist pass upgraded it, because checklistIcons has '
    + 'always split them');
  assert.equal(ic({ evidence: 'None' }), '', '"None" is an answer, not a mark');
  assert.equal(ic({ evidence: '' }), '', 'and silence stays silent');

  // The note field is spelled both ways: raw feed rows say hasComments, records
  // built by makeRecords say has_comments. Reading one is how a mark vanishes.
  assert.equal(ic({ evidence: '', hasComments: true }), '🧾', 'feed spelling');
  assert.equal(ic({ evidence: '', has_comments: true }), '🧾', 'record spelling');
  // ...and never on a rarity, where eBird makes the comment compulsory, so the
  // badge would be a column of identical glyphs. Mirrors report.py exactly.
  assert.equal(ic({ evidence: '', has_comments: true, kind: 'Rarity' }), '',
    'a mark that is always there is not a mark');
});

// The field was being DROPPED at the point records are built, which is what
// made checklist rows slow: the media mark had to be recovered later with one
// call per row. analyze.py has carried it for as long as the report has had
// evidence marks; the app simply never copied the line.
test('mergeSnapshot keeps the evidence the notable feed paid for', () => {
  const recs = BL.mergeSnapshot([{ src: 'notable', kind: 'notable', rows: [{
    obsId: 'OBS1', speciesCode: 'larspa', comName: 'Lark Sparrow',
    obsDt: '2026-08-07 11:39', locName: 'Union Bay', locId: 'L1',
    lat: 47.6, lng: -122.3, subId: 'S1', userDisplayName: 'A Birder',
    evidence: 'P', hasComments: true,
  }] }]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].evidence, 'P', 'the letter survives into the record');
  assert.equal(recs[0].has_comments, true, 'and so does the note flag');

  // 'None' means "asked and answered: nothing", and normalising it to '' is
  // what lets absence read as absence rather than as an unknown.
  const none = BL.mergeSnapshot([{ src: 'notable', kind: 'notable', rows: [{
    obsId: 'OBS2', speciesCode: 'x', comName: 'X', obsDt: '2026-08-07 11:39',
    locName: 'L', lat: 1, lng: 2, subId: 'S2', evidence: 'None',
  }] }]);
  assert.equal(none[0].evidence, '', '"None" is stored as empty');
});


// ── THE FLOOR THAT WAS MISSING ───────────────────────────────────────────
// Reported from eBird's own Iconic Birds panel at Bolt Creek Burn: American
// Dipper "130x more frequent than regional average. Observed 1/1 years."
// Measured in GBIF, that number is built on TWO records at a site with one
// year of data. The 200-record floor guards the DENOMINATOR; nothing guarded
// the numerator, so a well-birded box could still hand back a spectacular
// ratio off three sightings.
test('an iconic multiplier is refused when the SPECIES has too little evidence', () => {
  // Bolt Creek Burn, all months, measured: 374 records in the box clears the
  // box floor, King County has 7,858,724. The House Wren has THREE.
  assert.equal(BL.iconicMultiplier(3, 374, 1200, 7858724), null,
    'three records produced a number — this is the 82x artifact the owner spotted');
  assert.equal(BL.iconicMultiplier(1, 10415, 1200, 1981885), null,
    'one record produced a number');

  // ...and the real ones survive. Mann Rd, Sultan (all months): box 10,415,
  // Snohomish County 1,981,885. Western Kingbird has 57 records over 3 years —
  // the bird that opened F11.
  const weki = BL.iconicMultiplier(57, 10415, 1050, 1981885);
  assert.ok(weki > 5, 'the Western Kingbird at Mann Rd was silenced: ' + weki);
  // Fobes: Eastern Kingbird, 367 records over 17 years. eBird says 68x.
  assert.ok(BL.iconicMultiplier(367, 24609, 1400, 1981885) > 5,
    'the Fobes Eastern Kingbird was silenced');

  // The gap is wide on purpose: every real pairing measured had 28+ records,
  // every artifact had 3 or fewer. A threshold sitting in that gap cannot be
  // knocked over by one more sighting either way.
  assert.ok(BL.ICONIC_MIN_SP_RECORDS > 3 && BL.ICONIC_MIN_SP_RECORDS < 28,
    'the species floor moved out of the measured gap between signal and noise');

  // The box floor still does its own job.
  assert.equal(BL.iconicMultiplier(50, 45, 1200, 7858724), null,
    'a box with 45 records has no norm to compare against');
});

// Switching the iconic window to ALL MONTHS is what makes a June bird visible
// at all — but it costs the seasonal answer unless the row says when.
test('an iconic row can say WHICH MONTHS its records fall in', () => {
  assert.equal(BL.monthSpanLabel([5, 6, 7]), 'May\u2013Jul');
  assert.equal(BL.monthSpanLabel([5]), 'May', 'a single month is not a span');
  // Gaps are kept: "May, Aug" is a different claim from "May-Aug". This is the
  // measured Bolt Creek American Dipper (months 5 and 8).
  assert.equal(BL.monthSpanLabel([5, 8]), 'May, Aug');
  // A winter bird must read as ONE span, not "Jan, Feb, Nov, Dec".
  assert.equal(BL.monthSpanLabel([1, 2, 11, 12]), 'Nov\u2013Feb');
  // A year-round bird has no seasonal claim to make, so it says nothing rather
  // than printing "Jan-Dec", which would be noise on every row.
  assert.equal(BL.monthSpanLabel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), '');
  assert.equal(BL.monthSpanLabel([]), '');
  assert.equal(BL.monthSpanLabel(null), '');
});

// ── CELEBRITY BIRDS: 4+ SIGHTINGS AT ONE PLACE, NOT 4 ACROSS A STATE ─────
// Four rounds of device feedback, ending with the spec: "a celebrity bird is
// one that has 4+ obs at the same hotspot (make sure its not just a convoy of
// 5)". The shipped lane failed it three separate ways at once, and each is
// asserted here.
test('a celebrity bird needs 4 independent sightings at ONE place, in range', () => {
  const at = (mi, locId, loc, lat, lon, dateStr, who) => ({
    code: 'norwat', name: 'Northern Waterthrush', kind: 'Rarity', valid: true,
    locId, loc, lat, lon, distMi: mi, dateStr, subId: 'S' + who, userDisplayName: who,
  });
  const opts = { now: Date.parse('2026-08-20T18:00:00Z'), seen: {}, maxMi: 40, hours: 48 };

  // 1. TWO PLACES FIVE MILES APART ARE TWO BIRDS. Reported verbatim: the row
  //    said "2 locs · 2 obs" over Juanita Bay (4.6 mi) and Union Bay (9.3 mi),
  //    one sighting each. Region-wide counting made that look like a crowd.
//    FOUR rows on purpose, split 2+2: region-wide counting reaches the
//    threshold, per-place counting does not. A 3-row fixture would pass this
//    assertion even with clustering removed, and did — the mutation that
//    deleted clustering went green until this was widened.
  const split = BL.needNearby([
    at(4.6, 'L1', 'Juanita Bay Park', 47.70, -122.21, '2026-08-20 10:15', 'a'),
    at(4.6, 'L1', 'Juanita Bay Park', 47.70, -122.21, '2026-08-20 12:30', 'c'),
    at(9.3, 'L2', 'Union Bay Natural Area', 47.65, -122.29, '2026-08-20 11:46', 'b'),
    at(9.3, 'L2', 'Union Bay Natural Area', 47.65, -122.29, '2026-08-20 13:02', 'd'),
  ], opts);
  assert.equal(split.length, 0,
    'sightings at unrelated places were added into a crowd that exists nowhere you can drive to');

  // 2. FOUR AT ONE PLACE QUALIFIES, and the row describes THAT place.
  const real = BL.needNearby([
    at(4.6, 'L1', 'Juanita Bay Park', 47.70, -122.21, '2026-08-20 08:15', 'a'),
    at(4.6, 'L1', 'Juanita Bay Park', 47.70, -122.21, '2026-08-20 09:20', 'b'),
    at(4.6, 'L1', 'Juanita Bay Park', 47.70, -122.21, '2026-08-20 10:15', 'c'),
    at(4.6, 'L1', 'Juanita Bay Park', 47.70, -122.21, '2026-08-20 11:40', 'd'),
    at(246, 'L9', 'Koppel Farm', 46.20, -119.10, '2026-08-20 07:40', 'e'),
  ], opts);
  assert.equal(real.length, 1, 'four independent sightings at one hotspot is the whole point');
  assert.equal(real[0].locName, 'Juanita Bay Park');
  assert.equal(real[0].sightings, 4, 'the count must describe the qualifying place');
  assert.ok(real[0].distMi < 5, 'the row must carry the qualifying place, not the farthest report');

  // 3. THREE IS NOT FOUR, and "it was reviewed" is no longer an escape hatch.
  //    That bypass exempted every reviewed rarity — nearly all of them — so the
  //    threshold was decorative, which is how a Red Crossbill with ONE
  //    observation reached the lane.
  assert.equal(BL.needNearby([
    at(4.6, 'L1', 'Juanita Bay Park', 47.70, -122.21, '2026-08-20 08:15', 'a'),
    at(4.6, 'L1', 'Juanita Bay Park', 47.70, -122.21, '2026-08-20 09:20', 'b'),
    at(4.6, 'L1', 'Juanita Bay Park', 47.70, -122.21, '2026-08-20 10:15', 'c'),
  ], opts).length, 0, 'three sightings passed a four-sighting gate');
  assert.equal(BL.needNearby([
    { code: 'redcro2', name: 'Red Crossbill', kind: 'Rarity', valid: true, locId: 'L3',
      loc: 'Carkeek Park', lat: 47.71, lon: -122.37, distMi: 10.6,
      dateStr: '2026-08-20 08:22', subId: 'S1', userDisplayName: 'a' },
  ], opts).length, 0, 'a single reviewed observation is still a single observation');

  // 4. A CONVOY IS ONE SIGHTING. Jetty Island S384988779 carries numObservers=5;
  //    when such a party SHARES, each member files at the same place and minute.
  //    Counts deliberately differ here — party members disagree about flock
  //    size all the time, and a key that includes the count would split them
  //    back into five "independent" reports.
  const convoy = ['v', 'w', 'x', 'y', 'z'].map((who, i) => {
    const r = at(4.6, 'L1', 'Juanita Bay Park', 47.70, -122.21, '2026-08-20 10:02', who);
    r.count = 5 + i; r.howMany = 5 + i;
    return r;
  });
  assert.equal(BL.needNearby(convoy, opts).length, 0,
    'a party of five filing one sighting was counted as five independent confirmations');

  // 5. IN RANGE, and a distance that never resolved does not get the benefit of
  //    the doubt — that hole is how a 246-mile report reached a lane about tonight.
  const far = ['a', 'b', 'c', 'd'].map((who, i) =>
    at(246, 'L9', 'Koppel Farm', 46.20, -119.10, '2026-08-20 0' + (i + 1) + ':00', who));
  assert.equal(BL.needNearby(far, opts).length, 0, 'a crowd 246 miles away is not happening near you');
  const nodist = ['a', 'b', 'c', 'd'].map((who, i) => {
    const r = at(4.6, 'L1', 'Juanita Bay Park', 47.70, -122.21, '2026-08-20 0' + (i + 1) + ':00', who);
    r.distMi = null; return r;
  });
  assert.equal(BL.needNearby(nodist, opts).length, 0,
    'a place whose distance never resolved cannot be shown to be in range');

  // 6. ADJACENT HOTSPOTS ARE ONE SITE — "the same hotspot or adjacent hotspots".
  //    Two pins ~300 m apart are one stakeout you walk between.
  const adjacent = [
    at(4.6, 'L1', 'Juanita Bay Park', 47.7000, -122.2100, '2026-08-20 08:15', 'a'),
    at(4.7, 'L2', 'Juanita Bay Park--boardwalk', 47.7025, -122.2100, '2026-08-20 09:20', 'b'),
    at(4.6, 'L1', 'Juanita Bay Park', 47.7000, -122.2100, '2026-08-20 10:15', 'c'),
    at(4.7, 'L2', 'Juanita Bay Park--boardwalk', 47.7025, -122.2100, '2026-08-20 11:40', 'd'),
  ];
  assert.equal(BL.needNearby(adjacent, opts).length, 1,
    'two pins you could walk between were treated as two different birds');
});

// ── IS THIS RARITY CONFIRMED? ─────────────────────────────────────────────
// Owner, 2026-08-23: "indicate whether a rare bird is confirmed on twitch.
// its in the aba feeds".
//
// The state that matters most here is the THIRD one. `valid` folds an absent
// field into `true`, which is right for its own job and catastrophic for a
// badge: it would print "Confirmed" for a row whose feed never carried the
// field, which is every row of the scraped ABA alert.
test('review status is three states, and an absent field is never "confirmed"', () => {
  assert.equal(BL.reviewState({ obsReviewed: true, obsValid: true }), 'confirmed');
  assert.equal(BL.reviewState({ obsReviewed: false, obsValid: false }), 'pending');

  // THE ONE THAT COULD TELL THE USER SOMETHING UNTRUE.
  assert.equal(BL.reviewState({}), 'unknown',
    'a feed that never carried the fields knows nothing — it must not claim confirmed');
  assert.equal(BL.reviewState({ comName: 'Ruff', subId: 'S1' }), 'unknown',
    'an ABA-alert row carries no review fields and must stay unknown');
  assert.equal(BL.reviewState(null), 'unknown');

  // Fails towards WITHHOLDING a confirmation, never towards inventing one.
  // This pair does not occur in a public feed (0 of 1,053 measured), but if
  // eBird ever emits it, "not confirmed" is the only safe reading.
  assert.equal(BL.reviewState({ obsReviewed: true, obsValid: false }), 'pending',
    'reviewed-and-rejected must never read as confirmed');

  // Only one field present: believe it rather than guessing the other.
  assert.equal(BL.reviewState({ obsValid: true }), 'confirmed');
  assert.equal(BL.reviewState({ obsValid: false }), 'pending');
});

test('the merged projection carries review status onto every row', () => {
  const rows = BL.mergeSnapshot([{ kind: 'notable', src: 'N', rows: [
    { speciesCode: 'ruff', comName: 'Ruff', locId: 'L1', locName: 'Spot',
      obsDt: '2026-08-23 08:00', subId: 'S1', lat: 47, lng: -122,
      obsReviewed: true, obsValid: true },
    { speciesCode: 'eleter', comName: 'Elegant Tern', locId: 'L2', locName: 'Marina',
      obsDt: '2026-08-23 09:00', subId: 'S2', lat: 47, lng: -122,
      obsReviewed: false, obsValid: false },
  ] }]);
  const by = {};
  rows.forEach((r) => { by[r.code] = r; });
  assert.equal(by.ruff.reviewState, 'confirmed');
  assert.equal(by.eleter.reviewState, 'pending');
  // ...and the older flag keeps its own meaning, so nothing downstream shifts.
  assert.equal(by.eleter.valid, false);
});
// "maybe reduce the number of required uniq observers. Maybe 3 uniq
// observations at the same hotspot, so long as it is not a convoy"
//
// The two halves have to ship together. Lowering the bar WITHOUT the convoy
// rule fills the lane with group outings — a carload of birders is one
// decision to go somewhere, wearing three or four names. So `n` counts
// PARTIES: people seen together at CONVOY_MIN_STOPS+ locations on the same
// day collapse into one.
//
// THE FIXTURE IS SIZED FROM THE RULE, NOT FROM A LITERAL. This guard was
// written around "three independent birders" and started failing the moment
// the owner raised the bar to five — the code was right and the test was
// stale, which is the same "pins the shape, not the property" failure that
// has now bitten six guards in this repo. `MIN` is read from the shipped
// constant, so moving the bar again cannot invalidate the behaviour claim.
const MIN = BL.CONVERGE.MIN_OBSERVERS;
const WHO = (n) => Array.from({ length: n }, (_, i) => 'birder' + i);

test('hotspotConvergence: independent birders fire, one carload does not', () => {
  // A quiet spot with a real norm, so the ratio is measurable in both cases.
  const norm = (loc) => {
    const r = [];
    for (let d = 2; d < 14; d++) {
      r.push({ locId: loc, locName: loc, userDisplayName: 'patcher', subId: loc + 'P' + d, obsDt: DAY(d) });
    }
    return r;
  };

  // CASE 1 — MIN people who each turned up on their own. This is the signal.
  const solo = norm('L1').concat(WHO(MIN).map((who, i) => (
    { locId: 'L1', locName: 'Cedar River Mouth', userDisplayName: who, subId: 'A' + i, obsDt: DAY(0, 7 + i) }
  )));
  const outSolo = BL.hotspotConvergence(solo, { now: NOW });
  assert.equal(outSolo.length, 1,
    MIN + ' independent birders should fire — this is the whole point of the change');
  assert.equal(outSolo[0].observers, MIN, MIN + ' separate parties');

  // One BELOW the bar must stay silent, or the threshold is decorative.
  const under = norm('L1b').concat(WHO(MIN - 1).map((who, i) => (
    { locId: 'L1b', locName: 'Cedar River Mouth', userDisplayName: who, subId: 'U' + i, obsDt: DAY(0, 7 + i) }
  )));
  assert.deepEqual(BL.hotspotConvergence(under, { now: NOW }), [],
    (MIN - 1) + ' parties is below the bar and must not fire');

  // CASE 2 — the SAME names, but they toured together: two shared stops on the
  // same day. That is one decision, so the hotspot must NOT fire.
  const convoy = norm('L2')
    .concat(WHO(MIN).map((who, i) => (
      { locId: 'L2', locName: 'Cedar River Mouth', userDisplayName: who, subId: 'B' + i, obsDt: DAY(0, 7) }
    )))
    // ...and the other stop on their route, which is what exposes them.
    .concat(WHO(MIN).map((who, i) => (
      { locId: 'LX', locName: 'Stop two', userDisplayName: who, subId: 'C' + i, obsDt: DAY(0, 9) }
    )));
  assert.deepEqual(BL.hotspotConvergence(convoy, { now: NOW }), [],
    'a carload that birded two stops together is ONE decision, not ' + MIN);
});

test('hotspotConvergence: party membership is transitive, and one shared stop is a coincidence', () => {
  const norm = (loc) => {
    const r = [];
    for (let d = 2; d < 14; d++) {
      r.push({ locId: loc, locName: loc, userDisplayName: 'patcher', subId: loc + 'P' + d, obsDt: DAY(d) });
    }
    return r;
  };

  // ONE shared stop is not a convoy — two birders bumping into each other at a
  // hotspot is the ordinary case, and collapsing them would silence the lane.
  // Everyone here meets exactly once, at the hotspot itself.
  const bumped = norm('L3').concat(WHO(MIN).map((who, i) => (
    { locId: 'L3', locName: 'Spot', userDisplayName: who, subId: 'A' + i, obsDt: DAY(0, 7) }
  )));
  assert.equal(BL.hotspotConvergence(bumped, { now: NOW }).length, 1,
    'meeting once at one place is a coincidence, not a convoy');

  // TRANSITIVE: each birder rode with the next, so the whole chain is one car
  // even though the ends never shared a stop beyond the hotspot itself.
  const chain = norm('L4').concat(WHO(MIN).map((who, i) => (
    { locId: 'L4', locName: 'Spot', userDisplayName: who, subId: 'A' + i, obsDt: DAY(0, 7) }
  )));
  for (let i = 0; i < MIN - 1; i++) {
    chain.push({ locId: 'LNK' + i, locName: 'link stop ' + i, userDisplayName: 'birder' + i, subId: 'L' + i + 'a', obsDt: DAY(0, 9 + i) });
    chain.push({ locId: 'LNK' + i, locName: 'link stop ' + i, userDisplayName: 'birder' + (i + 1), subId: 'L' + i + 'b', obsDt: DAY(0, 9 + i) });
  }
  assert.deepEqual(BL.hotspotConvergence(chain, { now: NOW }), [],
    'if A rode with B and B rode with C, all of them are one car');
});

// The lane's numbers are published in docs/HAPPENING-NOW.md, and for a whole
// release the doc said 5/3x while the code shipped 3/3 — two copies of one
// rule, drifting in the direction that made the lane noisier than its spec.
// Nothing compared them, so nothing caught it. This does.
test('the busy-hotspot lane matches the numbers its documentation publishes', () => {
  const fs = require('fs');
  const path = require('path');
  const doc = path.join(__dirname, '..', '..', 'birding', 'docs', 'HAPPENING-NOW.md');
  if (!fs.existsSync(doc)) return; // the private repo is not always checked out beside us
  const txt = fs.readFileSync(doc, 'utf8');
  const lines = txt.split(/\r?\n/);
  // The doc publishes these as a table row: | `CONVERGE_MIN_OBSERVERS` | **5** |
  // Anchor on the table row specifically — the same names also appear in prose
  // further down ("...is exactly the CONVERGE_MIN_RATIO boundary"), and a
  // looser match would read a number out of the wrong sentence.
  const num = (name) => {
    const row = lines.find((l) => new RegExp('^\\s*\\|\\s*`' + name + '`').test(l));
    assert.ok(row, 'HAPPENING-NOW.md no longer states ' + name + ' in its table — the guard cannot check what it cannot find');
    const m = /\*\*([0-9]+(?:\.[0-9]+)?)/.exec(row);
    assert.ok(m, 'HAPPENING-NOW.md states ' + name + ' without a number: ' + row);
    return Number(m[1]);
  };
  assert.equal(num('CONVERGE_MIN_OBSERVERS'), BL.CONVERGE.MIN_OBSERVERS,
    'the documented birder minimum and the shipped one disagree');
  assert.equal(num('CONVERGE_MIN_RATIO'), BL.CONVERGE.MIN_RATIO,
    'the documented ratio and the shipped one disagree');
});

// ── F169: a checklist's obsDt is its START, so freshness is understated ────
// "the checklists are at 6am but they last 4 hours" — measured in King County
// 2026-08-22 over 22 notable checklists: median 1.07h, mean 2.06h, max 5.23h,
// with 27% running four hours or more.
//
// eBird publishes no per-observation time, so a bird found at the END of a
// long walk is judged by a timestamp hours earlier and reads as STALER than it
// is. The error only ever points one way, which is why a grace is the right
// shape: it can rescue a fresh row and cannot invent one.
//
// The reported case: a Northern Waterthrush on a 4h20m count at Union Bay,
// 27h old by its start and ~22.6h by the end of the walk, dropped from a 24h
// window it belonged in.
test('a long count is not treated as stale at the moment it started', () => {
  const now = Date.parse('2026-08-22T10:00:00');
  const at = (h) => ({
    kind: 'Rarity', code: 'norwat', subId: 'S' + h,
    dateStr: new Date(now - h * 3600000).toISOString().slice(0, 16).replace('T', ' '),
  });

  assert.ok(BL.NOTABLE_GRACE_H > 0, 'the grace is gone — long counts read as stale again');
  // Rounded DOWN from the measured 5.23h maximum, so "reported in the last
  // day" stays a defensible claim rather than stretching to fit the tail.
  assert.ok(BL.NOTABLE_GRACE_H <= 6,
    `a ${BL.NOTABLE_GRACE_H}h grace is wider than any measured count — that is not slack, it is a different window`);

  const codes = (rows) => BL.notableRecent(rows, now).length;
  assert.equal(codes([at(20)]), 1, 'a plainly fresh row still shows');
  // 26h: outside the 24h window by its start, inside once you allow for the
  // walk it came from. This is the exact row that was reported missing.
  assert.equal(codes([at(26)]), 1,
    'a row 26h old by its START is inside a day once the count length is allowed for');
  assert.equal(codes([at(40)]), 0,
    'but genuinely old rows stay out — a grace is not a wider window');
  // The grace is one-sided on purpose: a future date is a clock fault, not a
  // long walk, and widening that edge would admit it.
  assert.equal(codes([at(-30)]), 0, 'a future-dated row is still rejected');
});
