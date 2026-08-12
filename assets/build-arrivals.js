/*
 * Bundle GBIF arrival phenology into the app.
 *
 *   node assets/build-arrivals.js [path-to-birding-repo]
 *
 * WHY THIS EXISTS
 *
 * 📆 Due back soon (v1.3.0) sweeps the region's species list against GBIF on the
 * device: ~2 calls for a resident, ~4 for a migrant, so roughly a thousand calls
 * per phone. The answer is identical for every user in the state and comes from
 * an archive that lags about a year, so paying for it per device is the wrong
 * shape. Owner's call:
 *
 *     "we can also do all the calls now and look for patterns to reduce live
 *      calls later"
 *
 * birding/scripts/harvest_arrivals.py does exactly that, once, into
 * data/<region>/arrivals.json. This carries the result across.
 *
 * The device still keeps the live path: a species missing from the table -- a
 * first record for the region, or a region nobody has harvested -- is fetched
 * exactly as before. The bundle is a head start, not a replacement, which is
 * also why the two implementations are parity-tested against each other in
 * birding/tests/parity/test_arrivals.py.
 *
 * KEYED BY STATE, NOT BY REGION. GBIF's stateProvince is what the numbers were
 * gathered for, and two report regions can share one state -- `wa` and
 * `fort-casey` are both Washington, and harvesting Washington twice to file it
 * under two names would be a straight duplicate of 38 KB on a device that has
 * about five megabytes for everything.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const srcRoot = path.resolve(process.argv[2] || path.join(appRoot, '..', 'birding'));
const outJs = path.join(appRoot, 'www', 'arrivals.js');

if (!fs.existsSync(srcRoot)) {
  console.error('Source repo not found: ' + srcRoot);
  process.exit(1);
}

const dataRoot = path.join(srcRoot, 'data');
const found = [];

function walk(dir, depth) {
  if (depth > 2 || !fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch (e) { continue; }
    if (st.isDirectory()) walk(full, depth + 1);
    else if (name === 'arrivals.json') found.push(full);
  }
}
walk(dataRoot, 0);

const byState = Object.create(null);
for (const file of found) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { continue; }
  const state = j.state;
  if (!state || !j.arrivals) continue;
  // Two regions can supply the same state; take the one with more answers
  // rather than whichever the directory walk reached last.
  const prev = byState[state];
  const size = Object.keys(j.arrivals).length;
  if (prev && Object.keys(prev.a).length >= size) continue;
  byState[state] = {
    a: j.arrivals,                       // sci -> {c: code, d: "MM-DD", r, m}
    // Residents are the expensive half of the saving: they are the MAJORITY of
    // a region's list, and each one the device does not have to ask about is
    // two calls it does not make. Shipping only the dated species would leave
    // the phone re-discovering "no" 365 times.
    res: j.residents || [],
    share: j.share,
    generated: j.generated,
  };
}

const states = Object.keys(byState).sort();
if (!states.length) {
  console.error('No arrivals.json found under ' + dataRoot
    + ' - run birding/scripts/harvest_arrivals.py first');
  process.exit(1);
}

const bundle = { v: 1, generated: new Date().toISOString(), states: byState };
fs.writeFileSync(outJs, 'window.__ARRIVALS__ = ' + JSON.stringify(bundle) + ';\n');

console.log('Wrote ' + outJs);
for (const s of states) {
  const b = byState[s];
  console.log('  ' + s + ': ' + Object.keys(b.a).length + ' dated · '
    + b.res.length + ' residents');
}
console.log('  size: ' + (fs.statSync(outJs).size / 1024).toFixed(0) + ' KB');
