'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const HTML = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const INLINE_JS = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).join('\n');
const CONTRACT = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'report-contract.json'), 'utf8'));
const SECTION_DOCS = JSON.parse(
  fs.readFileSync(path.join(WWW, 'section-docs.json'), 'utf8')).docs;
const INFO = require(path.join(WWW, 'info-dialogs.js'));
const BL = require(path.join(WWW, 'logic.js'));
const GENERATOR = require(path.join(ROOT, 'assets', 'generate-info-catalog.js'));

function literalCalls(name) {
  const found = [];
  const re = new RegExp(`\\b${name}\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
  let match;
  while ((match = re.exec(HTML))) found.push(match[1]);
  return found;
}

function sorted(values) {
  return [...values].sort();
}

test('every popup primitive is cataloged or explicitly excluded', () => {
  const infoCalls = literalCalls('showInfoSheet');
  const excludedSheetCalls = literalCalls('showExcludedSheet');
  const confirmationCalls = literalCalls('confirmAction');
  assert.ok(infoCalls.length >= 2,
    'the info-call scan found too little to prove coverage');
  assert.ok(excludedSheetCalls.length >= 4,
    'the excluded-sheet scan found too little to prove classification');
  assert.ok(confirmationCalls.length >= 3,
    'the confirmation scan found too little to prove classification');

  assert.deepEqual(sorted(new Set(infoCalls)), sorted(Object.keys(INFO.catalog)),
    'a real informational sheet lacks a catalog entry, or a catalog entry has no real trigger');
  assert.deepEqual(
    sorted(new Set(excludedSheetCalls)),
    sorted(Object.entries(INFO.excluded)
      .filter(([, entry]) => entry.surface === 'sheet')
      .map(([id]) => id)),
    'every non-catalog sheet must carry a named exclusion and reason');
  assert.deepEqual(
    sorted(new Set(confirmationCalls)),
    sorted(Object.entries(INFO.excluded)
      .filter(([, entry]) => entry.surface === 'confirmation')
      .map(([id]) => id)),
    'every native confirmation must carry a named exclusion and reason');
  assert.equal((HTML.match(/\bshowInfoSheet\s*\(/g) || []).length,
    infoCalls.length + 1,
    'every showInfoSheet call must use a literal catalog id');
  assert.equal((HTML.match(/\bshowExcludedSheet\s*\(/g) || []).length,
    excludedSheetCalls.length + 1,
    'every excluded sheet call must use a literal classified id');
  assert.equal((HTML.match(/\bconfirmAction\s*\(/g) || []).length,
    confirmationCalls.length + 1,
    'every confirmation call must use a literal classified id');

  // showSheet and window.confirm are the primitives. Only the two classified
  // wrappers may call the first, and only confirmAction may call the second.
  // A new direct popup therefore fails before anyone has to notice it is
  // absent from the catalog.
  assert.equal((HTML.match(/\bshowSheet\s*\(/g) || []).length, 3,
    'showSheet must appear only as its definition and the two classified wrappers');
  assert.equal((HTML.match(/\bwindow\.confirm\s*\(/g) || []).length, 1,
    'window.confirm must appear only inside confirmAction');
  assert.equal((HTML.match(/role="dialog"/g) || []).length, 1,
    'the shared classified sheet is the only dialog primitive');
  assert.doesNotMatch(HTML, /<dialog\b/i,
    'a second dialog primitive bypasses the catalog coverage guard');
  assert.doesNotMatch(INLINE_JS, /\b(?:window\.)?(?:alert|prompt)\s*\(/,
    'native alert/prompt bypasses the catalog coverage guard');
  assert.doesNotMatch(INLINE_JS, /\bshowModal\s*\(/i,
    'an unclassified modal or popover primitive bypasses the catalog guard');
  assert.doesNotMatch(HTML, /\bpopover(?:target)?=/i,
    'an unclassified popover primitive bypasses the catalog guard');
});

test('popup prose is read from separate shared sources', () => {
  assert.ok(
    HTML.indexOf('<script src="info-dialogs.js"></script>')
      > HTML.indexOf('<script src="logic.js"></script>'),
    'info-dialogs.js loads after the constants its prose interpolates');
  assert.match(HTML, /BirdInfoDialogs\.laneDocs\(BL\)/,
    'the app does not read the separate Bird Gen source');
  assert.match(HTML, /BirdInfoDialogs\.renderSectionDocHtml/,
    'the app and generator do not share the section-doc renderer');
  assert.doesNotMatch(HTML, /Continent-level rarities/,
    'Bird Gen prose was copied back into index.html');
  assert.doesNotMatch(HTML, /Example candidate images come from Wikipedia\/Wikimedia/,
    'Spuh explanation prose was copied back into index.html');

  const birdGen = INFO.renderSample('bird-gen-feed', {
    BirdLogic: BL,
    escapeHtml: (value) => String(value),
  });
  assert.match(birdGen.bodyHtml,
    new RegExp(`${BL.NEED_MIN_SIGHTINGS} or more independent sightings`),
    'the sample stopped reading the live Celebrity threshold');
  assert.match(birdGen.bodyHtml,
    new RegExp(`${BL.CASCADE.MIN_BIRDERS}\\+ of the top 100 within `
      + `${BL.CASCADE.WINDOW_DAYS} days`),
    'the sample stopped reading the live Cascade thresholds');
  assert.match(birdGen.bodyHtml, /Current feed:.*3 active alerts.*3h ago/s,
    'the conditional sample is not visibly represented');

  const spuh = INFO.render('spuh-explanation', {
    name: 'sample sp.',
    definition: '<script>not prose</script>',
  }, { BirdLogic: BL });
  assert.doesNotMatch(spuh.bodyHtml, /<script>/,
    'dynamic taxonomy prose is inserted without escaping');
  assert.match(spuh.bodyHtml, /&lt;script&gt;/,
    'dynamic taxonomy prose is visibly preserved after escaping');
});

test('the generated catalog has exact bidirectional section and sheet coverage', () => {
  const data = GENERATOR.inventory();
  assert.equal(data.sections.length, 33, 'enabled section-information surfaces');
  assert.equal(data.dialogs.length, 2, 'informational bottom-sheet families');
  assert.equal(data.sections.length + data.dialogs.length, 35,
    'total in-scope informational surfaces');
  assert.equal(data.excluded.length, 7, 'classified out-of-scope popup types');
  assert.deepEqual(data.inactiveDocs, ['scoutBtn', 'tripBtn'],
    'only the two non-menu section docs stay outside the real-popup catalog');

  const expected = [
    ...CONTRACT.menu.map((entry) => `section:${entry.at}`),
    ...Object.keys(INFO.catalog).map((id) => `dialog:${id}`),
  ].sort();
  const generated = GENERATOR.buildCatalog();
  const actual = [...generated.matchAll(/data-catalog-id="([^"]+)"/g)]
    .map((match) => match[1]).sort();
  assert.equal(new Set(actual).size, actual.length, 'catalog ids are unique');
  assert.deepEqual(actual, expected,
    'every real informational popup has one entry and no generated entry is orphaned');

  const excluded = [...generated.matchAll(/data-excluded-id="([^"]+)"/g)]
    .map((match) => match[1]).sort();
  assert.deepEqual(excluded, Object.keys(INFO.excluded).sort(),
    'the generated scope appendix drifted from the classified exclusions');

  for (const entry of CONTRACT.menu) {
    assert.ok(SECTION_DOCS[entry.at], `${entry.at} has no authored source`);
  }
  assert.match(generated, /Conditional live note — sample truncated checklist window/,
    'conditional section warnings are not labelled as samples');
  assert.match(generated, /Sample dynamic context — the title and first paragraph/,
    'dynamic bottom-sheet content is not labelled');
});

test('the committed catalog is deterministic and works as a local searchable page', () => {
  const committed = fs.readFileSync(GENERATOR.OUTPUT_PATH, 'utf8');
  const generated = GENERATOR.buildCatalog();
  assert.equal(committed, generated,
    'docs/info-dialogs.html is stale; run npm run info-catalog');
  assert.doesNotMatch(committed, /(?:src|href)="https?:/i,
    'the local catalog must not depend on a network resource');
  assert.match(committed, /#0072B2/);
  assert.match(committed, /#E69F00/);
  assert.match(committed, /aria-live="polite"/);
  assert.match(committed, /Skip to catalog/);

  const dom = new JSDOM(committed, { runScripts: 'dangerously' });
  const document = dom.window.document;
  const entries = [...document.querySelectorAll('.catalog-entry')];
  assert.equal(entries.length, 35);
  const input = document.getElementById('catalogSearch');
  input.value = 'cascade';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const visible = entries.filter((entry) => !entry.hidden);
  assert.ok(visible.length > 0 && visible.length < entries.length,
    'search does not narrow the catalog');
  visible.forEach((entry) => {
    assert.match(entry.textContent, /cascade/i);
    assert.equal(entry.open, true, 'a search match opens for immediate review');
  });
  assert.match(document.getElementById('matchCount').textContent,
    new RegExp(`Showing ${visible.length} of 35`));

  document.getElementById('collapseAll').click();
  visible.forEach((entry) => assert.equal(entry.open, false));
  document.getElementById('expandAll').click();
  visible.forEach((entry) => assert.equal(entry.open, true));
  dom.window.close();
});
