'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Boundaries = require('../www/region-boundary-loader');
const Persistence = require('../www/persistence');
const Logic = require('../www/logic');

function document(properties = { PRUID: '59', PRENAME: 'British Columbia' }) {
  const ring = (west, south, east, north) =>
    [[west, south], [east, south], [east, north], [west, north], [west, south]];
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties,
    geometry: { type: 'MultiPolygon', coordinates: [
      [ring(-130, 48, -120, 60), ring(-126, 50, -125, 51)],
      [ring(-134, 50, -133, 51)]
    ] } }] };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(options = {}) {
  const store = options.store || new Map(), calls = [];
  const state = { owner: 'profile|0|CA-BC', now: Date.now() };
  const persistence = Persistence.create({ codec: options.codec, text: {
    read: key => store.get(key) || null,
    write: (key, value) => { store.set(key, value); return true; }
  } });
  const resolver = Boundaries.create({
    persistence, owner: () => state.owner, now: () => state.now,
    timeoutMs: options.timeoutMs,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return options.fetch ? options.fetch(url, init)
        : { ok: true, json: async () => document() };
    }
  });
  return { ...resolver, state, store, calls, persistence };
}

test('on-demand sources use verified province/state/county IDs and never guess Canadian subregions', async () => {
  const requests = [
    ['CA-BC', 'CA-BC', '/0/query', "PRUID='59'"],
    ['CA-ON', 'CA-ON', '/0/query', "PRUID='35'"],
    ['US-KS', 'US-KS', '/4/query', "GEOID='20'"],
    ['US-KS', 'US-KS-173', '/5/query', "GEOID='20173'"]
  ];
  for (const [parent, code, path, where] of requests) {
    const request = Boundaries.requestFor(parent, code), url = new URL(request.url);
    assert.ok(url.pathname.endsWith(path));
    assert.equal(url.searchParams.get('where'), where);
    assert.equal(url.searchParams.get('outSR'), '4326');
  }
  const f = fixture();
  for (const [parent, code] of [
    ['CA-BC', 'CA-BC-CP'], ['US-KS', 'US-KS-17'], ['US-WA', 'US-KS'],
    ['XX-XX', 'XX-XX'], ['CA-XX', 'CA-XX'], ['aba', 'aba']
  ]) assert.equal(await f.load(parent, code), null);
  assert.equal(f.calls.length, 0, 'unsupported or mismatched identities must not launch guessed requests');
});

test('one requested polygon preserves islands and holes through compressed cache and offline restart', async () => {
  const f = fixture(), boundary = await f.load('CA-BC', 'CA-BC');
  assert.equal(f.calls.length, 1, 'no prefetch of other regions or counties');
  assert.equal(boundary.code, 'CA-BC');
  assert.equal(Logic.regionReachability({ lat: 49, lng: -123 }, boundary, 0).state, 'reachable');
  assert.equal(Logic.regionReachability({ lat: 50.5, lng: -133.5 }, boundary, 0).state, 'reachable');
  assert.equal(Logic.regionReachability({ lat: 50.5, lng: -125.5 }, boundary, 0).state, 'unreachable');
  assert.equal(Logic.regionReachability({ lat: 47.6, lng: -122.3 }, boundary, 0).state, 'unreachable');
  const raw = f.store.get(Boundaries.cacheKey('CA-BC'));
  assert.ok(raw.startsWith('z:'));
  const decoded = await Persistence.unpackJson(raw);
  assert.deepEqual(decoded.boundary.geometry, document().features[0].geometry);
  const offline = fixture({ store: f.store, fetch: async () => { throw new Error('offline'); } });
  assert.deepEqual(await offline.load('CA-BC', 'CA-BC'), boundary);
  assert.equal(offline.calls.length, 0);
});

test('identified U.S. state and county polygons retain exact source and version provenance', async () => {
  for (const [code, properties] of [
    ['US-KS', { GEOID: '20', STUSAB: 'KS', BASENAME: 'Kansas' }],
    ['US-KS-173', { GEOID: '20173', STATE: '20', COUNTY: '173', BASENAME: 'Sedgwick' }]
  ]) {
    const f = fixture({ fetch: async () => ({ ok: true, json: async () => document(properties) }) });
    const boundary = await f.load('US-KS', code);
    assert.equal(boundary.code, code);
    assert.equal(boundary.sourceId, properties.GEOID);
    assert.equal(boundary.sourceUrl, f.calls[0].url);
    assert.equal(boundary.boundaryVersion, Boundaries.requestFor('US-KS', code).version);
    assert.equal(new URL(boundary.sourceUrl).searchParams.has('maxAllowableOffset'), false,
      'runtime queries must not introduce unmeasured geometric simplification');
    assert.deepEqual(boundary.geometry, document(properties).features[0].geometry);
  }
});

test('concurrent consumers share one request but cache-only administrative preparation never joins it', async () => {
  const response = deferred(), f = fixture({ fetch: () => response.promise });
  const first = f.load('CA-BC', 'CA-BC'), second = f.load('CA-BC', 'CA-BC');
  assert.equal(first, second);
  const cached = await Promise.race([
    f.load('CA-BC', 'CA-BC', { cacheOnly: true }),
    new Promise(resolve => setTimeout(() => resolve('blocked'), 100))
  ]);
  assert.equal(cached, null, 'a pending geometry download must not block known-code filtering');
  response.resolve({ ok: true, json: async () => document() });
  assert.equal((await first).code, 'CA-BC');
  assert.equal(f.calls.length, 1);
});

test('foreign identities, invalid rings, coordinates, CRS and ambiguous replies stay unknown and uncached', async () => {
  const variants = [
    doc => { doc.features[0].properties.PRUID = '48'; },
    doc => { doc.features.push(doc.features[0]); },
    doc => { doc.features[0].geometry.type = 'LineString'; },
    doc => { doc.features[0].geometry.coordinates[0][0][0][0] = 999; },
    doc => { doc.features[0].geometry.coordinates[0][0].pop(); },
    doc => { doc.features[0].geometry.coordinates = []; },
    doc => { doc.crs = { properties: { name: 'EPSG:3857' } }; }
  ];
  for (const alter of variants) {
    const doc = document(); alter(doc);
    const f = fixture({ fetch: async () => ({ ok: true, json: async () => doc }) });
    assert.equal(await f.load('CA-BC', 'CA-BC'), null);
    assert.equal(f.store.size, 0, 'rejected geometry must never become a persisted answer');
  }
  const f = fixture({ fetch: async () => ({ ok: true,
    json: async () => document({ GEOID: '20001', STATE: '20', COUNTY: '001' }) }) });
  assert.equal(await f.load('US-KS', 'US-KS-173'), null);
  assert.equal(f.store.size, 0, 'a different county is not the requested county');
});

test('corrupt or expired cache is not accepted as known geometry', async () => {
  const f = fixture();
  await f.load('CA-BC', 'CA-BC');
  const key = Boundaries.cacheKey('CA-BC'), original = f.store.get(key);
  const row = await Persistence.unpackJson(original);
  row.boundary.bounds.minX = 0;
  f.store.set(key, await Persistence.packJson(row));
  const corrupt = fixture({ store: f.store, fetch: async () => { throw new Error('offline'); } });
  assert.equal(await corrupt.load('CA-BC', 'CA-BC'), null);
  assert.equal(corrupt.calls.length, 1);
  f.store.set(key, original);
  const expired = fixture({ store: f.store, fetch: async () => { throw new Error('offline'); } });
  expired.state.now += 366 * 86400 * 1000;
  assert.equal(await expired.load('CA-BC', 'CA-BC'), null);
});

test('native compression is awaited and obsolete profile, region or erasure work cannot write or paint', async () => {
  for (const change of ['', 'profile', 'region', 'erasure']) {
    const started = deferred(), release = deferred();
    const f = fixture({ codec: {
      unpack: Persistence.unpackJson,
      pack: async value => {
        const packed = await Persistence.packJson(value);
        started.resolve(); await release.promise; return packed;
      }
    } });
    let finished = false;
    const pending = f.load('CA-BC', 'CA-BC').then(value => { finished = true; return value; });
    await started.promise;
    assert.equal(finished, false);
    assert.equal(f.store.size, 0, 'no raw-first allocation before compression finishes');
    if (change) f.state.owner += '|' + change;
    release.resolve();
    const value = await pending;
    if (change) {
      assert.equal(value, null);
      assert.equal(f.store.size, 0);
    } else {
      assert.equal(value.code, 'CA-BC');
      assert.ok(f.store.get(Boundaries.cacheKey('CA-BC')).startsWith('z:'));
    }
  }
});

test('owner changes during the provider request reject its result without persisting it', async () => {
  const response = deferred(), started = deferred();
  const f = fixture({ fetch: () => { started.resolve(); return response.promise; } });
  const pending = f.load('CA-BC', 'CA-BC');
  await started.promise;
  f.state.owner = 'another geographic owner';
  response.resolve({ ok: true, json: async () => document() });
  assert.equal(await pending, null);
  assert.equal(f.store.size, 0);
});

test('timeouts abort the provider and a failed lookup remains retryable', async () => {
  let ready = false, signal;
  const f = fixture({ timeoutMs: 5, fetch: (url, init) => {
    signal = init.signal;
    return ready ? { ok: true, json: async () => document() } : new Promise(() => {});
  } });
  assert.equal(await f.load('CA-BC', 'CA-BC'), null);
  assert.equal(signal.aborted, true);
  assert.equal(f.store.size, 0);
  ready = true;
  assert.equal((await f.load('CA-BC', 'CA-BC')).code, 'CA-BC');
  assert.equal(f.calls.length, 2);
});
