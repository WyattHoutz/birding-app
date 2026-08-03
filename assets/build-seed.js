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
// nameToCode:{normName:code}, entries:[...] }. Mirrors analyze._parse_birdlist
// link shapes.
function parseBirdlist(text) {
  const codes = Object.create(null), codeToName = Object.create(null), nameToCode = Object.create(null);
  let m;
  // eBird writes the species link BOTH ways — "/species/moublu/US-WA" on some
  // exports and a bare "/species/moublu)" on others. Requiring the trailing
  // slash made a bare-form export parse as ZERO species, which is not a
  // visible failure: the seed just silently loses a whole region's year list.
  // Both forms are accepted here and in report.py::_parse_lower48_year_list.
  const spRe = /\/species\/([a-z0-9]+)[/)]/g;
  while ((m = spRe.exec(text))) codes[m[1]] = 1;
  const sppRe = /[?&]spp=([a-z0-9]+)/g;                    // hybrids / sp. groups
  while ((m = sppRe.exec(text))) codes[m[1]] = 1;
  const nameRe = /\[([^\]]+)\]\(\/species\/([a-z0-9]+)[/)]/g; // link text → code
  while ((m = nameRe.exec(text))) {
    const name = m[1].trim(), code = m[2];
    if (name && !codeToName[code]) codeToName[code] = name;
    if (name && !nameToCode[normName(name)]) nameToCode[normName(name)] = code;
  }
  return {
    codes: codes, codeToName: codeToName, nameToCode: nameToCode,
    entries: parseYearEntries(text)
  };
}

// Pull the per-species year-list rows out of an export. Each numbered entry
// looks like:
//
//   1.  ##### [Terek Sandpiper](/species/tersan/US-WA)
//       [19 Jul 2026](/checklist/S374073865)
//       [Stanwood Water Treatment Plant](/lifelist?r=L343249&…) | [Washington](/lifelist?r=US-WA&…)
//
// which carries everything the report's "🐦 {year} Year List" section shows.
// Mirrors report.py::_parse_lower48_year_list exactly: entries are scoped to
// their `### <Section>` heading (ignoring `### Date: …` sort headers) and only
// the "Native…" sections count, which is what section_year_list renders and
// counts. Export order is eBird's "Date: Newest First" and the report renders
// newest-first too, so entry order is preserved as-is.
function parseYearEntries(text) {
  const src = String(text);
  const secRe = /^###[ \t]+(?!Date:)([^\n]+)$/gm;
  const bounds = [];
  let s;
  while ((s = secRe.exec(src))) bounds.push({ at: s.index, label: s[1].trim().replace(/\s*\(\d+\)\s*$/, '') });
  bounds.push({ at: src.length, label: '' });

  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < bounds.length - 1; i++) {
    if (!/^native/i.test(bounds[i].label)) continue;
    const chunk = src.slice(bounds[i].at, bounds[i + 1].at);
    const entryRe = /^(\d+)\.[ \t]+#####[ \t]+(.+?)$/gm;
    const heads = [];
    let e;
    while ((e = entryRe.exec(chunk))) heads.push({ at: e.index, n: +e[1], head: e[2].trim() });
    heads.forEach(function (h, j) {
      const block = chunk.slice(h.at, j + 1 < heads.length ? heads[j + 1].at : chunk.length);
      const sp = /^\[([^\]]+)\]\(\/species\/([a-z0-9]+)[/)]/.exec(h.head);
      if (!sp) return;                 // sp./hybrid groups have no species link
      const code = sp[2];
      if (seen[code]) return;          // an export can repeat a species; keep the first (newest)
      seen[code] = 1;
      const ck = /\[(\d+\s+\w+\s+\d{4})\]\(\/checklist\/([^)]+)\)/.exec(block);
      const lc = /\[([^\]]+)\]\((\/lifelist\?r=L[^)]+)\)\s*\|\s*\[([^\]]+)\]\((\/lifelist\?r=[^)]+)\)/.exec(block);
      out.push({
        code: code,
        name: sp[1].trim(),
        date: ck ? ck[1].trim() : '',
        subId: ck ? ck[2] : '',
        loc: lc ? lc[1].trim() : '',
        locUrl: lc ? ('https://ebird.org' + lc[2]) : ''
      });
    });
  }
  return out;
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
// The ORDER is the user's — it is a hand-maintained numbered list, not a set —
// so it ships as a sequence, and a name that resolves to no code ships too
// rather than disappearing between the report and the app.
const nvEntries = [];
const nvPath = path.join(srcRoot, 'birdlist-needsverification.md');
if (fs.existsSync(nvPath)) {
  fs.readFileSync(nvPath, 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = /^\s*\d+\.\s*(.+?)\s*$/.exec(line);
    if (!m) return;
    const code = nameToCodeAll[normName(m[1])];
    if (code) nvCodes[code] = 1;
    nvEntries.push({ code: code || '', name: m[1] });
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
  // Which watchlist codes this report actually HOLDS back — i.e. birds that
  // would be "seen" here if they were not awaiting verification. Editing the
  // watchlist on device has to be able to put them back, and only these are
  // eligible: dropping a species you have never recorded must not invent a
  // tick.
  const watchHeld = Object.keys(nvCodes).filter(function (c) { return set[c]; }).sort();
  Object.keys(nvCodes).forEach(function (c) { delete set[c]; });                       // watchlist resurfaces
  // Display names come from the report's OWN year list (birdlistSlug).
  const ownList = listBySlug[profile.birdlistSlug] || { codeToName: {}, entries: [] };
  const names = Object.keys(ownList.codeToName)
    .map(function (c) { return ownList.codeToName[c]; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; })
    .sort(function (a, b) { return a.localeCompare(b); });
  // The full year list (newest first, with first-seen date + checklist), so
  // "My year" can show what the report's Year List section shows instead of
  // just a total.
  seenByReport[reportSlug] = {
    codes: Object.keys(set).sort(),
    names: names,
    watchHeld: watchHeld,
    yearList: (ownList.entries || []).slice()
  };
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
  watchlist: nvEntries,
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
console.log('  watchlist subtracted: ' + Object.keys(nvCodes).length + ' of ' + nvEntries.length + ' entries');
console.log('  seenByReport:');
BirdLogic.REGION_ORDER.forEach(function (slug) {
  console.log('    ' + slug + ': ' + seenByReport[slug].codes.length + ' seen · ' +
    seenByReport[slug].names.length + ' names · ' +
    seenByReport[slug].yearList.length + ' year-list entries');
});
