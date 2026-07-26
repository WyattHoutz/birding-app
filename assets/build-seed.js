#!/usr/bin/env node
/*
 * build-seed.js — generate www/seed-birdlist.json from the private report
 * pipeline's eBird year-list exports.
 *
 * The birding-app ships a snapshot of the owner's eBird 2026 year lists as
 * bundled sample data so every panel (Targets, Top destinations, My year, …)
 * has something to chew on before an eBird "Download My Data" CSV is imported.
 * The app matches by eBird `speciesCode`, which is exactly what these exports
 * carry, so matching is exact and locale-independent.
 *
 * Source files live in the sibling `birding` repo (private):
 *   birdlist-*.md   — eBird year-list HTML→Markdown exports
 *                     (entries like `##### [American Robin](/species/amerob/US-WA)`)
 *   seen_codes.txt  — flat list of eBird species codes (one per line)
 *
 * Usage:
 *   node assets/build-seed.js [path-to-birding-repo]
 * Default source: ../birding relative to the birding-app repo root.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const srcRoot = path.resolve(process.argv[2] || path.join(appRoot, '..', 'birding'));
const outPath = path.join(appRoot, 'www', 'seed-birdlist.json');

// The report registry (which birdlist + seen_from_region drives each report)
// lives in the shared BirdLogic module, so the seed and the app agree on scope.
const BirdLogic = require(path.join(appRoot, 'www', 'logic.js'));

if (!fs.existsSync(srcRoot)) {
  console.error('Source repo not found: ' + srcRoot);
  console.error('Pass the path to the birding pipeline repo as the first argument.');
  process.exit(1);
}

// eBird obsDt/name normalization matching analyze._norm (lower, collapse ws).
function normName(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

// Parse one birdlist-*.md export → { codes:Set, codeToName:{code:name},
// nameToCode:{normName:code} }. Mirrors analyze._parse_birdlist link shapes.
function parseBirdlist(text) {
  const codes = Object.create(null), codeToName = Object.create(null), nameToCode = Object.create(null);
  let m;
  const spRe = /\/species\/([a-z0-9]+)\//g;               // /species/<code>/  or  /US-WA
  while ((m = spRe.exec(text))) codes[m[1]] = 1;
  const sppRe = /[?&]spp=([a-z0-9]+)/g;                    // hybrids / sp. groups
  while ((m = sppRe.exec(text))) codes[m[1]] = 1;
  const nameRe = /\[([^\]]+)\]\(\/species\/([a-z0-9]+)\//g; // link text → code
  while ((m = nameRe.exec(text))) {
    const name = m[1].trim(), code = m[2];
    if (name && !codeToName[code]) codeToName[code] = name;
    if (name && !nameToCode[normName(name)]) nameToCode[normName(name)] = code;
  }
  return { codes: codes, codeToName: codeToName, nameToCode: nameToCode };
}

// --- parse every birdlist-<slug>.md, keyed by its file slug -----------------
const listBySlug = Object.create(null);   // 'wa'|'lower48'|'hi'… → parsed birdlist
const codeToNameAll = Object.create(null);
const nameToCodeAll = Object.create(null);
const usedFiles = [];
fs.readdirSync(srcRoot).filter(function (f) { return /^birdlist-.*\.md$/.test(f) && f !== 'birdlist-needsverification.md'; })
  .forEach(function (f) {
    const text = fs.readFileSync(path.join(srcRoot, f), 'utf8');
    const slug = f.replace(/^birdlist-/, '').replace(/\.md$/, '');
    const parsed = parseBirdlist(text);
    listBySlug[slug] = parsed;
    Object.keys(parsed.codeToName).forEach(function (c) { if (!codeToNameAll[c]) codeToNameAll[c] = parsed.codeToName[c]; });
    Object.keys(parsed.nameToCode).forEach(function (n) { if (!nameToCodeAll[n]) nameToCodeAll[n] = parsed.nameToCode[n]; });
    if (text.trim()) usedFiles.push(f);
  });

// seen_codes.txt — plain species codes, one per line (WA "seen" union; the
// report treats it as authoritative for the WA report ONLY).
const scCodes = Object.create(null);
const scPath = path.join(srcRoot, 'seen_codes.txt');
if (fs.existsSync(scPath)) {
  fs.readFileSync(scPath, 'utf8').split(/\r?\n/).forEach(function (line) {
    const c = line.trim().toLowerCase();
    if (/^[a-z0-9]+$/.test(c)) scCodes[c] = 1;
  });
  usedFiles.push('seen_codes.txt');
}

// needsverification.md — a numbered list of NAMES (a watchlist). The report
// SUBTRACTS these from every region's seen set so they resurface as targets.
// Resolve each name to a code via the union of all birdlist name→code maps.
const nvCodes = Object.create(null);
const nvPath = path.join(srcRoot, 'birdlist-needsverification.md');
if (fs.existsSync(nvPath)) {
  fs.readFileSync(nvPath, 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = /^\s*\d+\.\s*(.+?)\s*$/.exec(line);
    if (!m) return;
    const code = nameToCodeAll[normName(m[1])];
    if (code) nvCodes[code] = 1;
  });
  usedFiles.push('birdlist-needsverification.md');
}

// --- per-report seen set: seen = (seen_bl ∪ sc_wa) − watchlist --------------
// Keyed by REPORT slug so the app looks the set up directly by selected report.
// The seen source birdlist follows Region.seen_from_region (resolved in
// BirdLogic.seenSlugFor: mo/ks/az/ca→lower48, fort-casey→wa, else own).
function birdlistSlugToKey(slug) { return slug; } // birdlist files already keyed by slug ('hi' for waikoloa)
const seenByReport = Object.create(null);
BirdLogic.REGION_ORDER.forEach(function (reportSlug) {
  const profile = BirdLogic.REPORTS[reportSlug];
  const seenSrcSlug = BirdLogic.seenSlugFor(profile);        // birdlist slug supplying "seen"
  const srcList = listBySlug[birdlistSlugToKey(seenSrcSlug)] || { codes: {}, codeToName: {} };
  const set = Object.create(null);
  Object.keys(srcList.codes).forEach(function (c) { set[c] = 1; });
  if (reportSlug === 'wa') Object.keys(scCodes).forEach(function (c) { set[c] = 1; }); // WA-only
  Object.keys(nvCodes).forEach(function (c) { delete set[c]; });                       // watchlist resurfaces
  // Display names come from the report's OWN year list (birdlistSlug).
  const ownList = listBySlug[profile.birdlistSlug] || { codeToName: {} };
  const names = Object.keys(ownList.codeToName)
    .map(function (c) { return ownList.codeToName[c]; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; })
    .sort(function (a, b) { return a.localeCompare(b); });
  seenByReport[reportSlug] = { codes: Object.keys(set).sort(), names: names };
});

// Combined union (backwards-compatible "seen anywhere" fallback for applySeed).
const codeUnion = Object.create(null);
Object.keys(listBySlug).forEach(function (slug) {
  Object.keys(listBySlug[slug].codes).forEach(function (c) { codeUnion[c] = 1; });
});
Object.keys(scCodes).forEach(function (c) { codeUnion[c] = 1; });
const codeList = Object.keys(codeUnion).sort();
const nameList = Object.keys(codeToNameAll)
  .map(function (c) { return codeToNameAll[c]; })
  .filter(function (v, i, a) { return a.indexOf(v) === i; })
  .sort(function (a, b) { return a.localeCompare(b); });

const seed = {
  generated: new Date().toISOString(),
  source: 'eBird year-list exports: ' + usedFiles.join(', '),
  year: new Date().getFullYear(),
  seenField: 'speciesCode',
  codes: codeList,
  names: nameList,
  seenByReport: seenByReport
};

fs.writeFileSync(outPath, JSON.stringify(seed) + '\n');

// The app loads the data via a plain <script> global rather than fetch(): a
// bundled file is served from the app origin, which CapacitorHttp may try to
// route natively. A script tag is handled by the webview loader, so it is
// reliable offline with no network/CORS surprises.
const jsPath = path.join(appRoot, 'www', 'seed-birdlist.js');
fs.writeFileSync(jsPath, 'window.__SEED_BIRDLIST__ = ' + JSON.stringify(seed) + ';\n');

console.log('Wrote ' + outPath);
console.log('Wrote ' + jsPath);
console.log('  files:  ' + usedFiles.join(', '));
console.log('  codes:  ' + codeList.length + ' (combined union)');
console.log('  watchlist subtracted: ' + Object.keys(nvCodes).length);
console.log('  seenByReport:');
BirdLogic.REGION_ORDER.forEach(function (slug) {
  console.log('    ' + slug + ': ' + seenByReport[slug].codes.length + ' seen · ' + seenByReport[slug].names.length + ' names');
});
