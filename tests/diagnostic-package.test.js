'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Diagnostics = require('../www/diagnostic-package.js');
const Audit = require('../www/audit-log.js');
const Performance = require('../www/performance-report.js');

function productionScrubber() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  const start = html.indexOf('function scrubText(value)');
  const end = html.indexOf('function cleanEntry(', start);
  assert.ok(start >= 0 && end > start, 'the actual shared privacy functions must be loaded');
  return vm.runInNewContext(html.slice(start, end) + '\nscrubText;', {
    URL, window: { localStorage: { getItem: () => null } }
  });
}

for (const [format, input] of [
  ['double-pipe cache tuples', 'cache=scope||14.752341||-165.164352'],
  ['polygon query remnants',
    'https://api.gbif.org/v1/occurrence/search?geometry=POLYGON((14.752341 -165.164352,14.987654 -165.678912,14.752341 -165.164352))'],
  ['truncated location fragments', '[URL redacted; host=api.gbif.org] -165.678912']
]) {
  test('F1282 actual shared scrubber and package omit ' + format, () => {
    const scrub = productionScrubber(), before = globalThis.__dbg;
    try {
      globalThis.__dbg = { scrubText: scrub };
      for (const raw of [input, encodeURIComponent(input),
        encodeURIComponent(encodeURIComponent(input)), '%ZZ ' + input]) {
        const metrics = ' received=224 elapsedMs=1500.25 queuedMs=12.75';
        const clean = scrub(scrub(raw + metrics));
        assert.doesNotMatch(clean, /14\.752341|-165\.164352|14\.987654|-165\.678912/);
        assert.ok(clean.endsWith(metrics), 'non-location decimal metrics must survive');
        const audit = Audit.create({ indexedDB: null });
        audit.event('network.request_end', { category: 'network', attrs: {
          stage: raw, received_rows: 224, elapsed_ms: 1500.25
        } });
        const packed = Diagnostics.packageFiles(audit.bundle(), {
          environment: { stage: raw, elapsed_ms: 1500.25 }
        });
        const zip = Buffer.from(Diagnostics.zip(packed.files)).toString('utf8');
        assert.match(zip, /network\.request_end/);
        assert.match(zip, /1500\.25/);
        assert.doesNotMatch(zip, /14\.752341|-165\.164352|14\.987654|-165\.678912/);
      }
      assert.equal(scrub('received=224 elapsedMs=1500.25 queuedMs=12.75'),
        'received=224 elapsedMs=1500.25 queuedMs=12.75');
    } finally {
      if (before === undefined) delete globalThis.__dbg;
      else globalThis.__dbg = before;
    }
  });
}

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
    apiKey: 'SECRET-API-KEY', latitude: 10.12345, displayName: 'Private Birder',
  }, 'test');
  audit.event('network.request_end', {
    category: 'network', tags: ['network'],
    attrs: {
      host: 'api.ebird.org', status: 200,
      authorization: 'Bearer SECRET-TOKEN', longitude: 20.12345,
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
    /SECRET-API-KEY|SECRET-TOKEN|Private Birder|10\.12345|20\.12345/);
  assert.equal(bundle.manifest.screenshot_included, false);
});

test('F1259 package metadata applies the same privacy policy outside event files', () => {
  const audit = Audit.create({ indexedDB: null });
  const packed = Diagnostics.packageFiles(audit.bundle(), {
    environment: {
      platform: 'ios', received_rows: 500, queue_delay_ms: 44262,
      accountName: 'Prior Account Sentinel', profileLabel: 'Private Profile Sentinel',
      homeLatitude: 47.751234, homeLongitude: -122.164321,
      requestUrl: 'https://api.ebird.org/v2/data/obs/geo/recent?lat=47.751234&lng=-122.164321',
      searchText: 'Private Search Sentinel', rows: [{ name: 'Private Roster Sentinel' }]
    },
    storageInventory: { cache_entries: 12, latitude: 47.751234 }
  });
  const text = Buffer.from(Diagnostics.zip(packed.files)).toString('utf8');
  assert.doesNotMatch(text, /Prior Account Sentinel|Private Profile Sentinel|Private Search Sentinel|Private Roster Sentinel|47\.751234|-122\.164321|data\/obs\/geo/);
  assert.equal(packed.manifest.environment.received_rows, 500);
  assert.equal(packed.manifest.environment.queue_delay_ms, 44262);
  assert.equal(packed.manifest.storage_inventory.cache_entries, 12);
});

test('F1259 a missing shared privacy policy prevents creating a diagnostic package', () => {
  const privacy = globalThis.BirdAudit, audit = Audit.create({ indexedDB: null });
  try {
    delete globalThis.BirdAudit;
    assert.throws(() => Diagnostics.packageFiles(audit.bundle()), /privacy rules are unavailable/);
  } finally { globalThis.BirdAudit = privacy; }
});

test('F1259 package preserves validated native stages without raw payload or membership entries', () => {
  const previous = globalThis.BirdGenNotifications;
  try {
    globalThis.BirdGenNotifications = require('../www/birdgen-notifications.js');
    const packed = Diagnostics.packageFiles(Audit.create({ indexedDB: null }).bundle(), {
      environment: {
        entries: [{ name: 'Private membership sentinel' }],
        bird_gen_notifications: {
          stage_trace: {
            available: true, rejected: 2, truncated: true, entries: [{
              at: Date.now(), attempt: '00000000-0000-0000-0000-000000001010',
              stage: 'publication', outcome: 'accepted', background: true,
              counts: { accepted: 1, apiKey: 'Private native key sentinel' },
              raw: 'Private native payload sentinel'
            }]
          }
        }
      }
    });
    const trace = packed.manifest.environment.bird_gen_notifications.stage_trace;
    assert.equal(trace.entries.length, 1);
    assert.equal(trace.entries[0].stage, 'publication');
    assert.equal(trace.entries[0].counts.accepted, 1);
    assert.equal(trace.rejected, 2);
    assert.equal(trace.truncated, true);
    assert.doesNotMatch(JSON.stringify(packed.manifest), /Private membership|Private native|apiKey|raw/);
  } finally { globalThis.BirdGenNotifications = previous; }
});

test('F608 screenshot is packaged only after explicit inclusion', () => {
  const audit = Audit.create({ indexedDB: null });
  const without = Diagnostics.packageFiles(audit.bundle(), {});
  assert.equal(without.files['screenshot.jpg'], undefined);
  const withShot = Diagnostics.packageFiles(audit.bundle(), {
    screenshotBase64: Buffer.from('jpeg bytes').toString('base64'),
  });

  test('F623 diagnostic package carries labelled HTML, CSV, and source load rows', () => {
    const audit = Audit.create({ indexedDB: null, buildChannel: 'sideload' });
    const tracker = Performance.create({
      appVersion: '1.131.1',
      emit: (name, values) => audit.event(name, values),
    });
    const id = tracker.start({
      sectionId: 'sec-destBtn', sectionLabel: 'Today’s patches',
      report: 'wa', reason: 'open', cacheMode: 'cold',
    });
    tracker.mark(id, 'report_first_content');
    tracker.mark(id, 'report_primary_ready');
    tracker.finish(id);
    const auditBundle = audit.bundle();
    Object.assign(auditBundle.files, Performance.files(audit.events()));
    const packed = Diagnostics.packageFiles(auditBundle, {});
    for (const name of ['performance-report.html', 'performance-report.csv',
      'performance-loads.jsonl']) {
      assert.ok(packed.files[name], `${name} is missing from the diagnostic package`);
    }
    assert.match(packed.files['performance-report.html'], /Comparison/);
    assert.match(packed.files['performance-report.csv'], /verdict/);
  });
  assert.equal(Buffer.from(withShot.files['screenshot.jpg']).toString(), 'jpeg bytes');
});
