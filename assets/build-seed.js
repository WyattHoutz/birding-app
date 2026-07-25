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

if (!fs.existsSync(srcRoot)) {
  console.error('Source repo not found: ' + srcRoot);
  console.error('Pass the path to the birding pipeline repo as the first argument.');
  process.exit(1);
}

const codeToName = Object.create(null); // speciesCode -> common name (first wins)
const codes = Object.create(null);      // speciesCode -> 1 (union, incl. codes w/o a name)

function addCode(c) { if (c) codes[c] = 1; }

// Parse one birdlist-*.md export.
function parseBirdlist(text) {
  let m;
  // Canonical species links: /species/<code>/  or  /species/<code>/US-WA
  const spRe = /\/species\/([a-z0-9]+)\//g;
  while ((m = spRe.exec(text))) addCode(m[1]);
  // Hybrids / sp. groups only appear as ?spp=<code> / &spp=<code>
  const sppRe = /[?&]spp=([a-z0-9]+)/g;
  while ((m = sppRe.exec(text))) addCode(m[1]);
  // Common name → code from the markdown link text.
  const nameRe = /\[([^\]]+)\]\(\/species\/([a-z0-9]+)\//g;
  while ((m = nameRe.exec(text))) {
    const name = m[1].trim(), code = m[2];
    if (name && !codeToName[code]) codeToName[code] = name;
  }
}

const files = fs.readdirSync(srcRoot).filter(function (f) {
  return /^birdlist-.*\.md$/.test(f);
});
let usedFiles = [];
files.forEach(function (f) {
  const text = fs.readFileSync(path.join(srcRoot, f), 'utf8');
  if (!text.trim()) return; // skip empty stubs (e.g. birdlist-hi.md)
  parseBirdlist(text);
  usedFiles.push(f);
});

// seen_codes.txt — plain species codes, one per line (WA life "seen" union).
const scPath = path.join(srcRoot, 'seen_codes.txt');
if (fs.existsSync(scPath)) {
  fs.readFileSync(scPath, 'utf8').split(/\r?\n/).forEach(function (line) {
    const c = line.trim().toLowerCase();
    if (/^[a-z0-9]+$/.test(c)) addCode(c);
  });
  usedFiles.push('seen_codes.txt');
}

const codeList = Object.keys(codes).sort();
const nameList = Object.keys(codeToName)
  .map(function (c) { return codeToName[c]; })
  .filter(function (v, i, a) { return a.indexOf(v) === i; })
  .sort(function (a, b) { return a.localeCompare(b); });

const seed = {
  generated: new Date().toISOString(),
  source: 'eBird year-list exports: ' + usedFiles.join(', '),
  year: new Date().getFullYear(),
  seenField: 'speciesCode',
  codes: codeList,
  names: nameList
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
console.log('  codes:  ' + codeList.length);
console.log('  names:  ' + nameList.length);
