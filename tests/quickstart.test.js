'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const QUICKSTART = path.join(ROOT, 'docs', 'QUICKSTART.md');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const text = fs.readFileSync(QUICKSTART, 'utf8');
const imageDir = path.join(ROOT, 'docs', 'images', 'quickstart');

test('the first-run Quickstart covers every required setup boundary', () => {
  for (const phrase of [
    'Sideloadly',
    'Developer Mode',
    'VPN & Device Management',
    'Test & save',
    'eBird display name',
    'MyEBirdData.csv',
    'Washington (`US-WA`)',
    'seven-day',
  ]) {
    assert.ok(text.includes(phrase), `Quickstart lost ${phrase}`);
  }
  assert.match(README, /\[Bird Chaser first-time setup\]\(docs\/QUICKSTART\.md\)/,
    'the illustrated guide must be reachable from the repository front page');
  assert.doesNotMatch(text, /IMG_\d+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/,
    'the public guide must not name raw personal screenshots or email addresses');
});

test('every sanitized Quickstart image is committed and referenced once', () => {
  const refs = [...text.matchAll(/\]\((images\/quickstart\/[^)]+\.png)\)/g)]
    .map((match) => match[1]);
  assert.equal(refs.length, 5, 'the guide should show the five measured setup surfaces');
  assert.equal(new Set(refs).size, refs.length, 'a screenshot is not repeated as filler');

  const files = fs.readdirSync(imageDir).filter((name) => name.endsWith('.png')).sort();
  assert.deepEqual(files, refs.map((ref) => path.basename(ref)).sort(),
    'no unreviewed or unreferenced screenshot may enter the public folder');
  for (const ref of refs) {
    const file = path.join(ROOT, 'docs', ref);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 10000, `${ref} is unexpectedly empty`);
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG',
      `${ref} is not a PNG despite its extension`);
  }
});
