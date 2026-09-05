#!/usr/bin/env node
/*
 * build-seed.js — generate www/seed-birdlist.json from the private report
 * pipeline's eBird year-list exports.
 *
 * The birding-app ships a snapshot of the owner's eBird 2026 year lists as
 * bundled sample data so every panel (Targets, Top destinations, My Ticks, …)
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

// seen_codes.txt is RETIRED and deliberately not read — see the long note in
// analyze.py::set_region. It was a union persisted every run, so a code could
// enter the WA "seen" set but never leave it. Measured 2026-08-07: it had
// accreted 89 codes from other regions' lists (Blue Jay, Baltimore Oriole,
// Bridled Titmouse — trip birds, not Washington birds) plus 4 real WA birds
// from a PREVIOUS year, and it hid 93 species from the chase lists of a report
// whose whole job is finding birds you still need. It bought nothing: it was a
// strict superset of birdlist-wa.md.

// needsverification.md — a numbered list of NAMES (a watchlist). The report
// SUBTRACTS these from every region's seen set so they resurface as targets.
// Resolve each name to a code via the union of all birdlist name→code maps,
// then — for anything left — the full eBird taxonomy.
//
// That fallback is not optional, and analyze.py has always had it: the
// watchlist is the one list that names birds you have NEVER recorded. A
// tentative ID you want to refind is, by definition, often not on any year
// list, so the birdlist union cannot resolve it and the entry shipped with
// `code: ''`. Caught 2026-08-11 adding Red-necked Phalarope, which is on none
// of the nine birdlists: the report resolved it to `renpha` and the app
// shipped it codeless, so it could never match a sighting and the Watchlist
// section would simply never mention the bird the owner had just asked to
// track. Same two-repos-disagree shape as the numbered/bulleted drift below,
// and just as silent.
const nvCodes = Object.create(null);
// The ORDER is the user's — it is a hand-maintained numbered list, not a set —
// so it ships as a sequence, and a name that resolves to no code ships too
// rather than disappearing between the report and the app.
const nvEntries = [];
const nvUnresolved = [];
// Lazily read, because it is a 6 MB file that most runs never need. It lives
// in the SOURCE repo's gitignored cache, which is the same "run this beside
// the private repo" assumption every birdlist read above already makes; when
// it is missing we say so rather than quietly shipping empty codes.
let taxNameToCode = null;
function taxonomyLookup(normalised) {
  if (taxNameToCode === null) {
    taxNameToCode = Object.create(null);
    const taxPath = path.join(srcRoot, '.cache', 'taxonomy-en.json');
    if (fs.existsSync(taxPath)) {
      try {
        JSON.parse(fs.readFileSync(taxPath, 'utf8')).forEach(function (t) {
          const k = normName(t.comName || '');
          if (k && !taxNameToCode[k]) taxNameToCode[k] = t.speciesCode;
        });
      } catch (e) {
        console.warn('[warn] taxonomy cache unreadable (' + e.message + ')');
      }
    } else {
      console.warn('[warn] no taxonomy cache at ' + taxPath
        + ' — run any report in the birding repo once to populate it; '
        + 'watchlist birds absent from every birdlist cannot resolve without it');
    }
  }
  return taxNameToCode[normalised];
}
const nvPath = path.join(srcRoot, 'birdlist-needsverification.md');
if (fs.existsSync(nvPath)) {
  fs.readFileSync(nvPath, 'utf8').split(/\r?\n/).forEach(function (line) {
    // Numbered "1." or bulleted "-" both count, mirroring
    // analyze.py::set_region. The list is a SET of species whose order means
    // nothing, so the hand-maintained numbers were dropped — and this parser
    // was not updated with it. It silently matched NOTHING from that moment on,
    // so the app subtracted an empty watchlist while the report subtracted 18
    // species: every bird awaiting verification was marked "already seen" in
    // the app and correctly shown as a target in the Markdown. Found
    // 2026-08-07 while fixing the seen_codes.txt ratchet — the same class of
    // bug, a parser and its file drifting apart with nothing asserting they
    // still agree.
    const m = /^\s*(?:\d+\.|[-*+])\s*(.+?)\s*$/.exec(line);
    if (!m) return;
    const key = normName(m[1]);
    const code = nameToCodeAll[key] || taxonomyLookup(key);
    if (code) nvCodes[code] = 1;
    else nvUnresolved.push(m[1]);
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
  // The WA-only seen_codes.txt union used to be applied here and is gone with
  // the file — see the note above and analyze.py::set_region.
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
  // "My Ticks" can show what the report's Year List section shows instead of
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
if (nvUnresolved.length) {
  // Loud, and mirroring analyze.py's own [warn] line, because the failure is
  // otherwise invisible: the entry still ships, just with no code, and a
  // codeless watchlist bird can never match a sighting.
  console.warn('[warn] could not resolve ' + nvUnresolved.length
    + ' watchlist name(s): ' + JSON.stringify(nvUnresolved)
    + ' — check the spelling against the eBird common name');
}
console.log('  seenByReport:');
BirdLogic.REGION_ORDER.forEach(function (slug) {
  console.log('    ' + slug + ': ' + seenByReport[slug].codes.length + ' seen · ' +
    seenByReport[slug].names.length + ' names · ' +
    seenByReport[slug].yearList.length + ' year-list entries');
});
