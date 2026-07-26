'use strict';
/*
 * smoke-wiring.js — prove the app's data-layer glue matches the Markdown report.
 *
 * The cross-repo parity suite (birding/tests/parity) already proves
 * BirdLogic.computeChaseViews == the report. This smoke test proves the ONE bit
 * of glue the app adds on top: it fetches exactly the feeds planFeeds()
 * prescribes, keys them by plan file name, and hands the map to
 * computeChaseViews — the same map mergePlan() reads. If planFeeds and mergePlan
 * ever disagree on file names (so the app would drop a feed), or toRenderDest
 * mis-maps a cluster field, this fails.
 *
 * Uses the committed parity fixtures in the sibling birding repo. Override the
 * path with BIRDCHASER_FIXTURES for CI. Run: node assets/smoke-wiring.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const BL = require('../www/logic.js');

const FIX = process.env.BIRDCHASER_FIXTURES ||
  path.join(__dirname, '..', '..', 'birding', 'tests', 'parity', 'fixtures');

function load(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

// ---- 1. Every report: planFeeds and mergePlan agree on the feed file set. ----
// The app populates rowsByFile from planFeeds; computeChaseViews reads it via
// mergePlan. A mismatch would silently drop a county/geo feed in the app only.
BL.REGION_ORDER.forEach(function (slug) {
  const p = BL.profileFor(slug);
  const planSet = BL.planFeeds(p).map(function (f) { return f.file; }).sort();
  const mergeSet = BL.mergePlan(p).map(function (f) { return f.file; }).sort();
  ok(JSON.stringify(planSet) === JSON.stringify(mergeSet),
    slug + ': planFeeds/mergePlan file sets differ\n  plan=' + planSet + '\n  merge=' + mergeSet);
});

// ---- 2. toRenderDest maps every cluster field the report exposes. ----
const sampleCluster = {
  locId: 'L123', loc: 'Marymoor Park', lat: 47.66, lon: -122.11,
  score: 7, rareCount: 2, distMi: 3.4,
  species: [
    { code: 'buffle', name: 'Bufflehead', kind: 'Need' },
    { code: 'brant', name: 'Brant', kind: 'Rarity' }
  ]
};
const rd = BL.toRenderDest(sampleCluster);
ok(rd.locId === 'L123' && rd.locName === 'Marymoor Park', 'toRenderDest loc mapping');
ok(rd.lat === 47.66 && rd.lng === -122.11, 'toRenderDest lat/lng mapping (lon->lng)');
ok(rd.score === 7 && rd.rare === 2 && rd.dist === 3.4, 'toRenderDest score/rare/dist mapping');
ok(rd.species.length === 2 && rd.species[0].comName === 'Bufflehead' &&
   rd.species[1].rare === true && rd.species[0].rare === false, 'toRenderDest species mapping');
ok(BL.toRenderDest({ distMi: Infinity, species: [] }).dist === null, 'toRenderDest Infinity dist -> null');

// ---- 3. Full wired path over the WA fixtures == the golden-proven run_js path. -
// Build rowsByFile the APP way (planFeeds file names) and confirm the resulting
// destinations/excursions/new-arrivals equal what run_js.deriveJs() produces
// (which parity.test.js asserts equals the Markdown report's golden output).
const cfg = load(path.join(FIX, 'config.json'));
const profile = BL.profileFor(cfg.region);
const seen = {}; (cfg.seen || []).forEach(function (c) { seen[c] = 1; });

function rowsByFileApp(dateStr) {
  // Exactly what getChase() does: one entry per planFeeds() feed, keyed by file.
  const map = {};
  BL.planFeeds(profile).forEach(function (f) {
    const fp = path.join(FIX, 'wa', dateStr, f.file);
    map[f.file] = fs.existsSync(fp) ? load(fp) : [];
  });
  return map;
}

const cv = BL.computeChaseViews(profile, {
  rowsToday: rowsByFileApp(cfg.snapshotDate),
  rowsPrior: rowsByFileApp(cfg.priorDate),
  seen: seen, ownName: cfg.ownName, snapshotDate: cfg.snapshotDate,
  home: cfg.home, dailyDriveMi: Number(cfg.dailyDriveMi)
});

// Compare against the golden expected projections directly.
const expDest = load(path.join(FIX, '..', 'expected', 'destinations.json'));
const expArr = load(path.join(FIX, '..', 'expected', 'new-arrivals.json'));

function destProj(c) {
  return {
    loc: c.loc, score: c.score, rareCount: c.rareCount, distMi: c.distMi,
    species: c.species.map(function (s) { return { code: s.code, kind: s.kind }; })
      .sort(function (a, b) { return a.code < b.code ? -1 : (a.code > b.code ? 1 : 0); })
  };
}
const gotDest = cv.destinations.map(destProj);
ok(JSON.stringify(gotDest) === JSON.stringify(expDest),
  'wired destinations != golden\n  got=' + JSON.stringify(gotDest) + '\n  exp=' + JSON.stringify(expDest));

const gotArr = cv.newArrivals.map(function (r) {
  return { code: r.code, obsId: r.obsId, distMi: r.distMi, dateStr: r.dateStr };
});
ok(JSON.stringify(gotArr) === JSON.stringify(expArr),
  'wired new-arrivals != golden\n  got=' + JSON.stringify(gotArr) + '\n  exp=' + JSON.stringify(expArr));

// Every rendered destination is a fully-formed app render object.
cv.destinations.map(BL.toRenderDest).forEach(function (d) {
  ok(d.locName && typeof d.lat === 'number' && typeof d.lng === 'number' &&
     Array.isArray(d.species) && typeof d.score === 'number', 'render dest well-formed: ' + d.locName);
});

console.log('smoke-wiring: OK (' + checks + ' checks; ' + cv.destinations.length +
  ' destinations, ' + cv.excursions.length + ' excursions, ' + cv.newArrivals.length + ' new arrivals)');
