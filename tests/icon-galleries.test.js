const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const coverage = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'assets', 'icon-coverage.json'), 'utf8'));
const numbers = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'assets', 'icon-review-numbers.json'), 'utf8'));

test('F446 worldwide icon review numbers are unique and stable across scopes', () => {
  const species = new Set(Object.values(coverage.scopes).flatMap(scope => scope.speciesCodes));
  assert.equal(Object.keys(numbers).length, species.size);
  assert.equal(new Set(Object.values(numbers)).size, species.size);
  assert.deepEqual(
    [...Object.values(numbers)].sort((a, b) => a - b),
    Array.from({ length: species.size }, (_, index) => index + 1));
  for (const scope of Object.values(coverage.scopes)) {
    for (const code of scope.speciesCodes) {
      assert.ok(Number.isInteger(numbers[code]),
        `${code} lacks a stable worldwide review number`);
    }
  }
});
