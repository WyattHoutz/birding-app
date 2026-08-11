#!/usr/bin/env node
// Keep docs/WORK-ITEMS.md honest.
//
// A tracker nobody verifies is a tracker that is wrong within a week, and this
// project has been bitten repeatedly by two things that were supposed to agree
// and quietly stopped. So every column that references something real is
// checked against the thing it references:
//
//   ID       unique, sequential, no gaps
//   Release  a version that actually shipped (git history + package.json)
//   Guard    a test that actually exists in tests/dom.test.js
//   F        a feature that actually exists in the report repo's BACKLOG.md
//
// Run directly to validate and list what is still open:
//   node scripts/work-items.js
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'WORK-ITEMS.md');
const TESTS = path.join(ROOT, 'tests', 'dom.test.js');

// The features live in the OTHER repo. It is a sibling checkout in practice and
// absent on a CI runner that only cloned this one, so a missing BACKLOG.md
// skips the F check rather than failing the build — the same rule the parity
// suite uses for a missing app checkout.
const BACKLOG_CANDIDATES = [
  process.env.BIRDING_BACKLOG,
  path.join(ROOT, '..', 'birding', 'docs', 'BACKLOG.md'),
].filter(Boolean);

function readRows(md, heading) {
  const from = md.indexOf('## ' + heading);
  if (from < 0) return [];
  const rest = md.slice(from + 3);
  const end = rest.indexOf('\n## ');
  const block = end < 0 ? rest : rest.slice(0, end);
  return block.split('\n')
    .filter((l) => /^\|\s*W\d+\s*\|/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

function shippedVersions() {
  const out = new Set();
  // TAGS FIRST. They are written by the release workflow, so they are the
  // authority — and this check immediately proved why that matters: the commit
  // that shipped 1.0.84 has a subject reading "v1.0.83" (a typo at the time),
  // and 1.0.82's subject does not start with its version at all. A subject line
  // is a human sentence; a tag is what was actually published.
  try {
    execSync('git tag -l "v*"', { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      .split('\n').forEach((t) => {
        const m = /^v(\d+\.\d+\.\d+)$/.exec(t.trim());
        if (m) out.add(m[1]);
      });
  } catch (e) { /* no git, or a clone without tags: the fallbacks below apply */ }
  // Subjects as a fallback, for a shallow CI clone that fetched no tags.
  try {
    const log = execSync('git log --pretty=format:%s', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    log.split('\n').forEach((s) => {
      const m = /^v(\d+\.\d+\.\d+)\b/.exec(s.trim());
      if (m) out.add(m[1]);
    });
  } catch (e) { /* fall through to package.json alone */ }
  // ...and the version about to ship, which has neither yet.
  try {
    out.add(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
  } catch (e) { /* nothing to add */ }
  return out;
}

function testNames() {
  const src = fs.readFileSync(TESTS, 'utf8');
  return new Set([...src.matchAll(/^test\(\s*(['"`])([\s\S]*?)\1\s*,/gm)].map((m) => m[2]));
}

function featureIds() {
  for (const p of BACKLOG_CANDIDATES) {
    if (!p || !fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    return new Set([...src.matchAll(/^### (F\d+)\b/gm)].map((m) => m[1]));
  }
  return null;   // not available here; the F column is not checked
}

function validate() {
  const md = fs.readFileSync(DOC, 'utf8');
  const open = readRows(md, 'Open');
  const shipped = readRows(md, 'Shipped');
  const problems = [];

  // ---- IDs: unique and sequential across BOTH tables ---------------------
  const all = [...open.map((r) => r[0]), ...shipped.map((r) => r[0])]
    .map((id) => parseInt(id.replace(/^W/, ''), 10))
    .sort((a, b) => a - b);
  const seen = new Set();
  all.forEach((n) => {
    if (seen.has(n)) problems.push(`W${n} is used twice`);
    seen.add(n);
  });
  for (let i = 1; i <= (all[all.length - 1] || 0); i++) {
    if (!seen.has(i)) problems.push(`W${i} is missing — ids are sequential, so a gap means a lost row`);
  }

  // ---- Release: a version that really shipped ----------------------------
  const versions = shippedVersions();
  shipped.forEach((r) => {
    const id = r[0], rel = r[4];
    if (!rel) { problems.push(`${id} is under Shipped with no release`); return; }
    if (!versions.has(rel)) problems.push(`${id} claims release ${rel}, which is not in the git history`);
  });
  open.forEach((r) => {
    if (r.length > 4 && r[4]) problems.push(`${r[0]} is under Open but names a release`);
  });

  // ---- Guard: a test that really exists ----------------------------------
  const names = testNames();
  shipped.forEach((r) => {
    const id = r[0], guard = r[5];
    if (!guard || guard === '\u2014') return;      // em dash = no guard, said out loud
    if (!names.has(guard)) problems.push(`${id} names guard "${guard}", which is not a test in dom.test.js`);
  });

  // ---- F: a feature that really exists -----------------------------------
  const feats = featureIds();
  if (feats) {
    [...open, ...shipped].forEach((r) => {
      const f = r[2];
      if (!f) return;
      f.split(/[,\s]+/).filter(Boolean).forEach((one) => {
        if (!feats.has(one)) problems.push(`${r[0]} links ${one}, which is not a feature in BACKLOG.md`);
      });
    });
  }

  return { open, shipped, problems, checkedFeatures: !!feats };
}

module.exports = { validate };

if (require.main === module) {
  const { open, shipped, problems, checkedFeatures } = validate();
  console.log(`${shipped.length} shipped · ${open.length} open`
    + (checkedFeatures ? '' : ' · F column not checked (BACKLOG.md not found)'));
  if (open.length) {
    console.log('\nStill open:');
    open.forEach((r) => console.log(`  ${r[0].padEnd(4)} ${r[1]}${r[2] ? '  [' + r[2] + ']' : ''}`));
  }
  const noGuard = shipped.filter((r) => !r[5] || r[5] === '\u2014');
  if (noGuard.length) console.log(`\n${noGuard.length} shipped items have no guard: ` + noGuard.map((r) => r[0]).join(', '));
  if (problems.length) {
    console.error('\nPROBLEMS:');
    problems.forEach((p) => console.error('  ' + p));
    process.exit(1);
  }
  console.log('\nWORK-ITEMS.md is consistent.');
}
