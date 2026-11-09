'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Audit = require('../www/audit-log.js');

test('F609 audit events are versioned JSONL with page, tags, and settings revision', () => {
  let now = Date.parse('2026-09-27T22:00:00Z');
  const audit = Audit.create({
    appVersion: '1.2.3',
    buildChannel: 'beta',
    indexedDB: null,
    random: () => 0.25,
    clock: () => now,
    wallClock: () => new Date(now).toISOString(),
    page: () => ({ id: 'day_trip', view: 'results', overlay: null }),
  });
  audit.snapshotSettings({
    theme: 'dark',
    chase_distance_miles: 40,
    api_key_configured: true,
  }, 'startup');
  now += 125;
  const row = audit.event('photo.queue', {
    category: 'render',
    outcome: 'ok',
    tags: ['photo', 'day_trip', 'photo', 'not-a-real-tag'],
    operationId: 'op_12',
    attrs: { visible_slots: 8, newly_queued: 8 },
  });
  assert.equal(row.schema, 'birdchaser.event/1');
  assert.equal(row.seq, 2);
  assert.equal(row.elapsed_ms, 125);
  assert.deepEqual(row.tags, ['day_trip', 'photo']);
  assert.deepEqual(row.page, { id: 'day_trip', view: 'results', overlay: null });
  assert.equal(row.settings_rev, 1);
  const parsed = audit.bundle().files['events.jsonl'].trim().split('\n').map(JSON.parse);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].operation_id, 'op_12');
  assert.ok(audit.bundle().files['schema.json']);
  assert.ok(audit.bundle().files['errors.jsonl'] !== undefined);
});

test('F609 production persistence keeps failures but excludes verbose actions', () => {
  const audit = Audit.create({
    indexedDB: null, buildChannel: 'production', random: () => 0.3,
  });
  audit.event('control.activate', {
    category: 'user_action', tags: ['user_action'], attrs: { control: 'rankBtn' },
  });
  audit.event('network.request_end', {
    category: 'network', outcome: 'error', tags: ['network', 'error'],
    attrs: { host: 'api.ebird.org', status: 503 },
  });
  assert.deepEqual(audit.persistentEvents().map((row) => row.event),
    ['network.request_end']);
});

test('F609 in-memory event ring is bounded', () => {
  const audit = Audit.create({ indexedDB: null, buildChannel: 'sideload' });
  for (let i = 0; i < 1300; i++) {
    audit.event('render.progress', {
      category: 'render', tags: ['render'], attrs: { completed: i },
    });
  }
  assert.equal(audit.events().length, 1200);
  assert.equal(audit.events()[0].attrs.completed, 100);
});

test('F1285 setup timing survives ordinary ring churn in the real bundle and production persistence', () => {
  const audit = Audit.create({ indexedDB: null, buildChannel: 'production' });
  audit.event('setup.timing', { category: 'lifecycle', tags: ['performance'], attrs: {
    run: 1, source: 'birdcast', pass: 1, elapsed_ms: 1500.25,
    apiKey: 'SECRET-timing', coordinates: [14.752341, -165.164352]
  } });
  for (let row = 0; row < 1400; row++) {
    audit.event('render.progress', { category: 'render', attrs: { completed: row } });
  }
  assert.equal(audit.events().length, 1200);
  assert.equal(audit.events()[0].event, 'setup.timing');
  assert.equal(audit.events().at(-1).attrs.completed, 1399);
  assert.equal(audit.persistentEvents()[0].attrs.elapsed_ms, 1500.25);
  const content = audit.bundle().files['events.jsonl'];
  assert.match(content, /"source":"birdcast"/);
  assert.match(content, /1500\.25/);
  assert.doesNotMatch(content, /SECRET|14\.752341|-165\.164352|coordinates/);
});

test('F1285 retained timing rows remain bounded and do not displace the latest ordinary events', () => {
  const audit = Audit.create({ indexedDB: null });
  for (let run = 0; run < 200; run++) {
    audit.event('setup.timing', { category: 'lifecycle', attrs: { run: run, source: 'taxonomy' } });
  }
  for (let row = 0; row < 1400; row++) {
    audit.event('render.progress', { category: 'render', attrs: { completed: row } });
  }
  const timings = audit.events().filter(row => row.event === 'setup.timing');
  assert.equal(timings.length, 128);
  assert.equal(timings[0].attrs.run, 72);
  assert.equal(timings.at(-1).attrs.run, 199);
  assert.equal(audit.events().length, 1200);
  assert.equal(audit.events().at(-1).attrs.completed, 1399);
});

test('F1283 the latest native snapshot survives churn without accumulating or reducing setup retention', () => {
  const audit = Audit.create({ indexedDB: null, buildChannel: 'production' });
  for (let run = 0; run < 128; run++) {
    audit.event('setup.timing', { category: 'lifecycle', attrs: { run } });
  }
  for (let sequence = 1; sequence <= 200; sequence++) {
    audit.event('native.lifecycle', { category: 'lifecycle', attrs: {
      native_observed: true, events: [{ sequence, phase: 'foreground', at_ms: 2000 + sequence, uptime_ms: sequence }]
    } });
  }
  for (let row = 0; row < 1400; row++) {
    audit.event('render.progress', { category: 'render', attrs: { completed: row } });
  }
  const rows = audit.bundle().files['events.jsonl'].trim().split('\n').map(JSON.parse);
  const native = rows.filter(row => row.event === 'native.lifecycle');
  assert.equal(native.length, 1);
  assert.equal(native[0].attrs.events[0].sequence, 200);
  assert.equal(rows.filter(row => row.event === 'setup.timing').length, 128);
  assert.equal(audit.persistentEvents().filter(row => row.event === 'native.lifecycle').length, 1);
  assert.equal(rows.length, 1200);
  assert.equal(rows.at(-1).attrs.completed, 1399);
  assert.ok(rows.every((row, index) => !index || row.seq > rows[index - 1].seq));
});

test('F609 redacts sensitive fields before they enter the event buffer', () => {
  const audit = Audit.create({ indexedDB: null, random: () => 0.5 });
  const row = audit.event('network.request_end', {
    category: 'network',
    tags: ['network'],
    attrs: {
      host: 'api.ebird.org',
      status: 200,
      apiKey: 'secret',
      authorization: 'Bearer secret',
      latitude: 47.75,
      nested: { cookie: 'secret', rows: 8 },
    },
  });
  const text = JSON.stringify(row);
  assert.doesNotMatch(text, /secret|47\.75|authorization|apiKey|latitude|cookie/);
  assert.equal(row.attrs.host, 'api.ebird.org');
  assert.equal(row.attrs.status, 200);
  assert.equal(row.attrs.nested.rows, 8);
});

test('F1259 raw data is omitted while numeric coverage and actual configured flags survive', () => {
  const audit = Audit.create({ indexedDB: null });
  const row = audit.event('source.outcome', { attrs: {
    rows: 500, parsed: 500, retained: 100, acquisition_ms: 153,
    nested: { rows: [{ name: 'PRIVATE_ROSTER_SENTINEL' }], codes: ['privatebird'] },
    data: [{ name: 'PRIVATE_DATA_SENTINEL' }],
    api_key_configured: true, account_configured: 'PRIVATE_FLAG_SENTINEL'
  } });
  assert.doesNotMatch(JSON.stringify(row),
    /PRIVATE_ROSTER_SENTINEL|PRIVATE_DATA_SENTINEL|privatebird|PRIVATE_FLAG_SENTINEL/);
  assert.equal(row.attrs.rows, 500);
  assert.equal(row.attrs.retained, 100);
  assert.equal(row.attrs.acquisition_ms, 153);
  assert.equal(row.attrs.api_key_configured, true);
});

test('F609 settings changes create a new revision without secret settings', () => {
  const audit = Audit.create({ indexedDB: null, random: () => 0.75 });
  const before = {
    theme: 'system', home_configured: false, api_key_configured: false,
    displayName: 'Private Birder', home_latitude: 47.75,
  };
  const after = {
    theme: 'dark', home_configured: true, api_key_configured: true,
    displayName: 'Private Birder', home_latitude: 47.75,
  };
  audit.snapshotSettings(before, 'startup');
  const changed = audit.changedSettings(before, after, 'settings-menu');
  assert.deepEqual(changed.map((row) => row.attrs.key),
    ['api_key_configured', 'home_configured', 'theme']);
  const exported = audit.bundle().files['settings.jsonl'];
  assert.doesNotMatch(exported, /Private Birder|47\.75|displayName|home_latitude/);
});
