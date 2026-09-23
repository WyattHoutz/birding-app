const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ICON_DIR = path.join(ROOT, 'www', 'assets', 'birds');
const REPORT_PATH = path.join(ROOT, 'assets', 'icon-coverage.json');

function actualCoverage(speciesCodes) {
  const icons = new Set(fs.readdirSync(ICON_DIR)
    .filter((name) => /\.(jpg|png)$/i.test(name))
    .map((name) => path.parse(name).name));
  const credits = new Set(Array.from(
    fs.readFileSync(path.join(ICON_DIR, 'CREDITS.md'), 'utf8')
      .matchAll(/\|\s*`([a-z0-9]+)`\s*\|/g),
    (match) => match[1]));
  const species = new Set(speciesCodes);
  return {
    bundledIcons: speciesCodes.filter((code) => icons.has(code)).length,
    missingIcons: speciesCodes.filter((code) => !icons.has(code)).sort(),
    unattributedIcons: speciesCodes
      .filter((code) => icons.has(code) && !credits.has(code)).sort(),
  };
}

test('F446 icon coverage is taxonomy-derived, current, and fail-closed', () => {
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  assert.equal(report.source.taxonomy, 'eBird ref/taxonomy/ebird');
  assert.equal(report.source.taxonomySpecies,
    report.scopes.worldwide.speciesCodes.length,
    'the recorded species count must come from the taxonomy target set');
  assert.equal(report.source.taxonomyRows,
    report.source.taxonomySpecies
      + report.scopes.worldwide.nonSpeciesCodes.length,
    'species and separately reported non-species taxa must cover the taxonomy');
  assert.deepEqual(report.reachableExtensions, ['.jpg', '.png']);

  for (const [name, scope] of Object.entries(report.scopes)) {
    if (!scope.declaredComplete) continue;
    const actual = actualCoverage(scope.speciesCodes);
    assert.deepEqual(actual.missingIcons, [],
      `${name} is declared complete but lacks reachable icons`);
    assert.deepEqual(actual.unattributedIcons, [],
      `${name} is declared complete but lacks required attribution`);
  }

  for (const [name, scope] of Object.entries(report.scopes)) {
    assert.equal(scope.totalSpecies, scope.speciesCodes.length,
      `${name} species total drifted from its eBird target set`);
    const actual = actualCoverage(scope.speciesCodes);
    assert.equal(scope.bundledIcons, actual.bundledIcons,
      `${name} bundled count is stale`);
    assert.deepEqual(scope.missingIcons, actual.missingIcons,
      `${name} missing-icon report is stale`);
    assert.deepEqual(scope.unattributedIcons, actual.unattributedIcons,
      `${name} attribution report is stale`);
  }

  const wa = report.scopes.washington;
  for (const code of ['asspet', 'budger', 'dusthr2', 'rempar']) {
    assert.ok(wa.speciesCodes.includes(code), `${code} left the Washington target`);
    assert.ok(!wa.missingIcons.includes(code), `${code} still lacks a reachable icon`);
  }
  assert.ok(wa.nonSpeciesCodes.length > 0,
    'hybrids, slashes, and spuhs must be reported separately');
});
