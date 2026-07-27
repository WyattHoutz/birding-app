'use strict';
/*
 * normalize.test.js — the app half of the section-parity normalisation contract.
 *
 * The Markdown report and the app render the same content in different markup.
 * To diff them we project both through identical normalisation rules:
 *
 *   birding/parity_dump.py     normalize()   / entry_key()
 *   www/index.html             pdNormalize() / pdEntryKey()
 *
 * Both are asserted against tests/fixtures/normalize-cases.json, so a change
 * to one implementation that isn't mirrored in the other fails CI in one repo
 * or the other. birding/tests/parity/test_normalize.py is the Python half.
 *
 * pdNormalize needs a DOM (it decodes entities with a <textarea>), so the
 * functions are lifted out of index.html and evaluated against jsdom rather
 * than booting the whole app.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const CASES = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'normalize-cases.json'), 'utf8')
).cases;

// Pull just the parity-dump helpers out of the inline script: everything from
// the regex table down to the end of pdEntryKey.
function extractHelpers() {
  const start = HTML.indexOf('var _PD_IMG =');
  assert.ok(start > 0, 'found the _PD_* regex table in index.html');
  const endMark = HTML.indexOf('var _PD_ISO =', start);
  assert.ok(endMark > start, 'found the end of the pdEntryKey block');
  return HTML.slice(start, endMark);
}

function makeSandbox() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const src = extractHelpers() + '\nreturn { pdNormalize: pdNormalize, pdEntryKey: pdEntryKey };';
  const fn = new Function('document', 'window', src);
  return fn(dom.window.document, dom.window);
}

test('pdNormalize/pdEntryKey match the shared fixture', () => {
  const { pdNormalize, pdEntryKey } = makeSandbox();
  assert.ok(CASES.length >= 10, 'fixture has a meaningful number of cases');
  for (const c of CASES) {
    assert.equal(pdNormalize(c.in), c.text, 'text — ' + c.why);
    assert.equal(pdEntryKey(c.in), c.key, 'key — ' + c.why);
  }
});

test('normalisation is idempotent', () => {
  const { pdNormalize } = makeSandbox();
  for (const c of CASES) {
    const once = pdNormalize(c.in);
    assert.equal(pdNormalize(once), once, 'stable — ' + c.why);
  }
});
