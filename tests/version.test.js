'use strict';
/*
 * version.test.js — the shipped build must not be mislabeled.
 *
 * The version is shown in the footer and in the debug console header, and it's
 * how a sideloaded build is identified when diagnosing a bug from a screenshot.
 * index.html holds the single source of truth (APP_VERSION); this asserts
 * package.json agrees, so bumping one without the other fails CI.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('APP_VERSION in index.html matches package.json', () => {
  const html = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const m = html.match(/var APP_VERSION = '([^']+)'/);
  assert.ok(m, 'index.html declares APP_VERSION');
  assert.equal(m[1], pkg.version,
    'index.html APP_VERSION and package.json version must be bumped together');
});

test('the version is not hard-coded anywhere else in the UI', () => {
  const html = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8');
  const literals = html.match(/v\d+\.\d+\.\d+/g) || [];
  assert.deepEqual(literals, [],
    'render the version from APP_VERSION instead of repeating it: ' + literals.join(', '));
});
