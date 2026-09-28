'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Diagnostics = require('../www/diagnostic-package.js');
const Audit = require('../www/audit-log.js');

test('F608 production builds have no expiry while sideload beta expires exactly', () => {
  const productionSource = fs.readFileSync(
    path.join(__dirname, '..', 'www', 'build-info.js'), 'utf8');
  assert.match(productionSource, /channel:\s*"production"/);
  assert.match(productionSource, /expiresAt:\s*null/);
  const now = Date.parse('2026-09-27T00:00:00Z');
  assert.deepEqual(Diagnostics.expiryState({
    channel: 'production', expiresAt: '2020-01-01T00:00:00Z',
  }, now), {
    beta: false, expired: false, expiresAt: null, daysRemaining: null,
  });
  assert.equal(Diagnostics.expiryState({
    channel: 'sideload', expiresAt: '2026-09-28T00:00:00Z',
  }, now).daysRemaining, 1);
  assert.equal(Diagnostics.expiryState({
    channel: 'sideload', expiresAt: '2026-09-27T00:00:00Z',
  }, now).expired, true);
});

test('F608 diagnostic ZIP contains bounded documented files and no secrets', () => {
  const audit = Audit.create({ indexedDB: null, random: () => 0.1 });
  audit.snapshotSettings({
    api_key_configured: true, home_configured: true, theme: 'dark',
    apiKey: 'SECRET-API-KEY', latitude: 47.75123, displayName: 'Private Birder',
  }, 'test');
  audit.event('network.request_end', {
    category: 'network', tags: ['network'],
    attrs: {
      host: 'api.ebird.org', status: 200,
      authorization: 'Bearer SECRET-TOKEN', longitude: -122.12345,
    },
  });
  const bundle = Diagnostics.packageFiles(audit.bundle(), {
    buildInfo: {
      channel: 'sideload', buildId: 'test-1',
      expiresAt: '2026-10-27T00:00:00Z',
    },
    environment: { platform: 'ios', locale: 'en-US' },
    storageInventory: { cache_entries: 12, approximate_bytes: 4096 },
    random: () => 0.2,
  });
  const zip = Diagnostics.zip(bundle.files);
  const text = Buffer.from(zip).toString('utf8');
  for (const name of ['README.txt', 'manifest.json', 'events.jsonl',
    'settings.jsonl', 'errors.jsonl', 'schema.json', 'summary.txt']) {
    assert.match(text, new RegExp(name.replace('.', '\\.')));
  }
  assert.doesNotMatch(text,
    /SECRET-API-KEY|SECRET-TOKEN|Private Birder|47\.75123|-122\.12345/);
  assert.equal(bundle.manifest.screenshot_included, false);
});

test('F608 screenshot is packaged only after explicit inclusion', () => {
  const audit = Audit.create({ indexedDB: null });
  const without = Diagnostics.packageFiles(audit.bundle(), {});
  assert.equal(without.files['screenshot.jpg'], undefined);
  const withShot = Diagnostics.packageFiles(audit.bundle(), {
    screenshotBase64: Buffer.from('jpeg bytes').toString('base64'),
  });
  assert.equal(Buffer.from(withShot.files['screenshot.jpg']).toString(), 'jpeg bytes');
});
