'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Persistence = require('../www/persistence.js');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { IDBFactory } = require('fake-indexeddb');

test('persistence JSON writes await the shared codec and durable backend', async () => {
  let release, stored = false, complete = false;
  const gate = new Promise(resolve => { release = resolve; });
  const persistence = Persistence.create({
    codec: {
      pack: async value => { await gate; return 'z:' + value.rows; },
      unpack: async value => value
    },
    text: { write: async (key, value) => {
      assert.equal(key, 'owner:cache');
      assert.equal(value, 'z:payload');
      stored = true;
      return true;
    } }
  });
  const pending = persistence.putJson('owner:cache', { rows: 'payload' }).then(result => {
    complete = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(stored, false);
  assert.equal(complete, false);
  release();
  assert.equal(await pending, true);
});

test('persistence rejects untagged codec output and reports failed durability', async () => {
  let writes = 0;
  const options = {
    codec: { pack: async () => '{"raw":true}' },
    text: { write: async () => { writes++; return true; } }
  };
  await assert.rejects(Persistence.create(options).putJson('cache', {}), /untagged/);
  assert.equal(writes, 0);
  options.codec.pack = async () => 'j:{}';
  options.text.write = async () => false;
  assert.equal(await Persistence.create(options).putJson('cache', {}), false);
  options.text.write = async () => { throw new Error('quota'); };
  await assert.rejects(Persistence.create(options).putJson('cache', {}), /quota/);
});

test('persistence removals preserve admission and backend CAS context while awaiting acknowledgment', async () => {
  let release, calls = 0, complete = false, received, rejected, pending;
  const context = { expectedRaw: 'retained-value' };
  const persistence = Persistence.create({ text: {
    remove: async (key, observed) => {
      calls++;
      assert.equal(key, 'owned-key');
      received = observed;
      await new Promise(resolve => { release = resolve; });
      return true;
    }
  } });
  try {
    rejected = persistence.remove('owned-key', { context, shouldWrite: () => false });
    await Promise.resolve();
    assert.equal(calls, 0, 'a rejected owner cannot allocate a removal');
    assert.equal(await rejected, false);
    pending = Promise.resolve(persistence.remove('owned-key', { context, shouldWrite: () => true }))
      .finally(() => { complete = true; });
    await Promise.resolve();
    assert.equal(calls, 1); assert.equal(complete, false);
    assert.equal(received?.expectedRaw, context.expectedRaw, 'removal must reach the backend with its original byte baseline');
    release(); assert.equal(await pending, true);
  } finally {
    if (release) release();
    await Promise.allSettled([rejected, pending].filter(value => value !== undefined));
  }
});

test('persistence erasure presence does not confuse empty or unreadable records with absence', () => {
  let raw = null;
  const persistence = Persistence.create({ text: { read: () => raw } });
  assert.equal(persistence.jsonStoragePresent('owned'), false);
  for (const residual of ['', 'j:null', 'z:invalid', 'malformed']) {
    raw = residual;
    assert.equal(persistence.jsonStoragePresent('owned'), true);
  }
  assert.throws(() => Persistence.create({ text: {
    read: () => Promise.resolve(null)
  } }).jsonStoragePresent('owned'), /synchronous backend/);
  assert.throws(() => Persistence.create({ text: {
    read: () => { throw new Error('unreadable backend'); }
  } }).jsonStoragePresent('owned'), /unreadable backend/);
});

test('persistence preserves legacy reads and cancels ownership before writing', async () => {
  let writes = 0;
  const persistence = Persistence.create({
    codec: { pack: async () => 'j:{}', unpack: async raw => JSON.parse(raw) },
    text: { read: async () => '{"legacy":true}', write: async () => { writes++; return true; } }
  });
  assert.deepEqual(await persistence.getJson('cache'), { legacy: true });
  assert.equal(await persistence.putJson('cache', {}, { shouldWrite: () => false }), false);
  assert.equal(writes, 0);
});

test('persistence admits only explicit legacy string choices and migrates them through native JSON', async () => {
  let raw = 'hide', writes = 0, migrated;
  const persistence = Persistence.create({ text: {
    read: () => raw,
    write: (key, value, context) => {
      assert.equal(context.expectedRaw, 'hide');
      raw = value; writes++; return true;
    }
  } });
  assert.equal(persistence.peekJson('preference'), null);
  assert.equal(await persistence.getJson('preference'), null);
  const options = { legacyStrings: ['show', 'hide'] };
  assert.equal(persistence.peekJson('preference', options), 'hide');
  assert.equal(await persistence.getJson('preference', {
    ...options, migrate: true, onMigrated: value => { migrated = value; }
  }), 'hide');
  assert.equal(raw, 'j:"hide"');
  assert.equal(migrated, raw);
  assert.equal(writes, 1);
  assert.equal(await persistence.getJson('preference'), 'hide');
  raw = 'unrecognized';
  assert.equal(persistence.peekJson('preference', options), null);
  assert.equal(await persistence.getJson('preference', options), null);
  assert.equal(writes, 1, 'unknown bare values cannot become migrated JSON strings');
});

test('persistence snapshots legacy choices and rejects open-ended or nonliteral dialects', async () => {
  let release, reads = 0, hold = true;
  const persistence = Persistence.create({ text: {
    read: () => {
      reads++;
      if (!hold) return 'hide';
      hold = false;
      return new Promise(resolve => { release = () => resolve('hide'); });
    }
  } });
  const values = ['show', 'hide'];
  const pending = persistence.getJson('preference', { legacyStrings: values });
  values[1] = 'unrecognized';
  release();
  assert.equal(await pending, 'hide', 'the admitted dialect cannot change during the asynchronous read');
  for (const legacyStrings of [[], ['*'], [true], ['show hide'], 'hide']) {
    const before = reads;
    await assert.rejects(persistence.getJson('preference', { legacyStrings }), /literal choices/);
    assert.equal(reads, before, 'invalid dialects must fail before consulting the backend');
    assert.throws(() => persistence.peekJson('preference', { legacyStrings }), /literal choices/);
  }
});

test('persistence projection versions bind to the same actual read as their decoded value', () => {
  let raw = 'j:{"count":1}', reads = 0, unchanged;
  const persistence = Persistence.create({ text: { read: () => {
    const observed = raw;
    if (++reads === 1) raw = 'j:{"count":2}';
    return observed;
  } } });
  const value = persistence.peekJson('snapshot', { onVersion: predicate => { unchanged = predicate; } });
  assert.deepEqual(value, { count: 1 });
  assert.equal(reads, 1, 'projecting and binding a version must not independently sample two records');
  assert.equal(typeof unchanged, 'function');
  assert.equal(unchanged(), false, 'a replaced record cannot certify the older decoded projection');
  assert.deepEqual(persistence.peekJson('snapshot'), { count: 2 });
});

test('persistence projection versions reject asynchronous backends without emitting a predicate', () => {
  let emitted = false;
  const persistence = Persistence.create({ text: { read: () => Promise.resolve('j:{}') } });
  assert.throws(() => persistence.peekJson('snapshot', {
    onVersion: () => { emitted = true; }
  }), /synchronous backend/);
  assert.equal(emitted, false);
});

test('persistence automatically migrates legacy JSON and keeps compressed reads unchanged', async () => {
  let raw = '{"rows":["legacy"]}', writes = 0;
  const persistence = Persistence.create({
    codec: {
      pack: async value => 'z:' + JSON.stringify(value),
      unpack: async value => JSON.parse(value.startsWith('z:') ? value.slice(2) : value)
    },
    text: {
      read: async () => raw,
      write: async (key, payload, context) => {
        assert.equal(context.expectedRaw, raw);
        raw = payload;
        writes++;
        return true;
      }
    }
  });
  assert.deepEqual(await persistence.getJson('cache', { migrate: true }), { rows: ['legacy'] });
  assert.equal(raw, 'z:{"rows":["legacy"]}');
  assert.deepEqual(await persistence.getJson('cache', { migrate: true }), { rows: ['legacy'] });
  assert.equal(writes, 1, 'already compressed data must not be rewritten');
});

test('persistence migration failures preserve readable legacy data without deleting it', async () => {
  for (const throws of [false, true]) {
    const raw = '{"rows":["last good"]}';
    const persistence = Persistence.create({
      codec: { pack: async () => 'z:new', unpack: async value => JSON.parse(value) },
      text: {
        read: async () => raw,
        write: async () => { if (throws) throw new Error('quota'); return false; }
      }
    });
    assert.deepEqual(await persistence.getJson('cache', { migrate: true }), { rows: ['last good'] });
    assert.equal(raw, '{"rows":["last good"]}');
  }
});

test('persistence readiness tracks durable snapshots, not stale memory or removed storage', async () => {
  let raw = null, blocked = false;
  const persistence = Persistence.create({
    codec: {
      pack: async value => 'j:' + JSON.stringify(value),
      unpack: async value => JSON.parse(value.slice(2))
    },
    text: {
      read: () => raw,
      write: (key, payload) => { if (blocked) return false; raw = payload; return true; }
    }
  });
  const old = { saved: 'old' }, fresh = { saved: 'fresh' };
  assert.equal(await persistence.putJson('cache', old, { track: true }), true);
  assert.equal(persistence.isJsonCurrent('cache', old), true);
  blocked = true;
  assert.equal(await persistence.putJson('cache', fresh, { track: true }), false);
  assert.equal(persistence.isJsonCurrent('cache', fresh), false);
  assert.equal(persistence.isJsonCurrent('cache', old), true);
  raw = null;
  assert.equal(persistence.isJsonCurrent('cache', old), false);
});

test('persistence migration carries compare-and-write and cancellation controls across compression', async () => {
  let raw = '{"old":true}', release, started;
  const held = new Promise(resolve => { release = resolve; });
  const packing = new Promise(resolve => { started = resolve; });
  let current = true, writes = 0;
  const persistence = Persistence.create({
    codec: {
      pack: async () => { started(); await held; return 'z:old'; },
      unpack: async value => JSON.parse(value)
    },
    text: {
      read: async () => raw,
      write: async (key, payload, context) => {
        writes++;
        if (context.expectedRaw !== raw) return false;
        raw = payload;
        return true;
      }
    }
  });
  const pending = persistence.getJson('cache', { migrate: true });
  await packing;
  raw = 'z:newer';
  release();
  assert.deepEqual(await pending, { old: true });
  assert.equal(raw, 'z:newer', 'a delayed migration must not overwrite newer data');
  assert.equal(writes, 1);
  raw = '{"old":true}';
  current = false;
  assert.deepEqual(await persistence.getJson('cache', {
    migrate: true, shouldWrite: () => current
  }), { old: true });
  assert.equal(writes, 1, 'cancelled ownership must prevent migration writes');
  assert.equal(raw, '{"old":true}');
});

test('persistence binary exception passes bytes unchanged without touching compression', async () => {
  const values = [new Blob(['image'], { type: 'image/png' }),
    new ArrayBuffer(4), new Uint8Array([1, 2, 3]), new DataView(new ArrayBuffer(4))];
  for (const value of values) {
    let saved;
    const persistence = Persistence.create({
      codec: { pack: () => { throw new Error('Binary must not reach compression.'); } },
      binary: {
        write: async (key, bytes) => { saved = bytes; return true; },
        read: async () => saved
      }
    });
    assert.equal(await persistence.putBinary('image', value), true);
    assert.equal(saved, value);
    assert.equal(await persistence.getBinary('image'), value);
    await assert.rejects(persistence.putJson('image', value), /putBinary/);
  }
});

test('persistence JSON versions invalidate optional memory without certifying a durable value', async () => {
  let raw = null;
  const persistence = Persistence.create({ text: {
    read: () => raw, write: (key, payload) => { raw = payload; return true; }
  } });
  const absent = persistence.versionJson('optional');
  assert.equal(absent(), true);
  assert.equal(persistence.isJsonCurrent('optional', null), false, 'absence is not a durable JSON snapshot');
  const value = { rows: ['saved'] };
  await persistence.putJson('optional', value, { track: true });
  assert.equal(absent(), false);
  const saved = persistence.versionJson('optional');
  assert.equal(saved(), true);
  raw = 'j:{"rows":["replacement"]}';
  assert.equal(saved(), false);
  const replacement = persistence.versionJson('optional');
  raw = null;
  assert.equal(replacement(), false);
  const asynchronous = Persistence.create({ text: { read: async () => raw } });
  assert.throws(() => asynchronous.versionJson('optional'), /synchronous backend/);
});

test('persistence storage byte metadata counts current encoded UTF-16 bytes without decoding payloads', () => {
  let raw = 'j:"\ud83d\ude00"', reads = 0;
  const persistence = Persistence.create({
    codec: { unpack: () => { throw new Error('Payload decoding is forbidden for byte metadata'); } },
    text: { read: key => { assert.equal(key, 'metadata'); reads++; return raw; } }
  });
  assert.equal(persistence.jsonStorageBytes('metadata'), 12);
  raw = 'z:encoded-bytes';
  assert.equal(persistence.jsonStorageBytes('metadata'), 30);
  raw = null;
  assert.equal(persistence.jsonStorageBytes('metadata'), 0);
  assert.equal(reads, 3, 'byte metadata observes actual backing bytes on every call');
});

test('persistence storage byte metadata rejects asynchronous or unavailable backends', () => {
  const asynchronous = Persistence.create({ text: { read: () => Promise.resolve('j:{}') } });
  assert.throws(() => asynchronous.jsonStorageBytes('metadata'), /synchronous backend/);
  assert.throws(() => Persistence.create({}).jsonStorageBytes('metadata'), /adapter is unavailable/);
});

test('persistence synchronous projections require matching stored bytes and cannot mutate saved JSON', async () => {
  let raw = null;
  const persistence = Persistence.create({ text: {
    read: () => raw, write: (key, payload) => { raw = payload; return true; }
  } });
  const value = { rows: Array.from({ length: 60 }, () => ({ name: 'Compressed directory' })) };
  await persistence.putJson('directory', value);
  assert.ok(raw.startsWith('z:'));
  value.rows.length = 0;
  const projected = persistence.peekJson('directory');
  assert.equal(projected.rows.length, 60);
  projected.rows.length = 0;
  assert.equal(persistence.peekJson('directory').rows.length, 60);
  const stored = raw;
  raw = null;
  assert.equal(persistence.peekJson('directory'), null, 'removed data cannot survive as a memory hit');
  raw = 'z:other';
  assert.equal(persistence.peekJson('directory'), null, 'foreign encoded bytes need an asynchronous read');
  raw = '{"legacy":true}';
  assert.deepEqual(persistence.peekJson('directory'), { legacy: true });
  assert.equal(raw, '{"legacy":true}', 'a projection does not claim an asynchronous migration committed');
  raw = stored;
  const restarted = Persistence.create({ text: { read: () => raw } });
  assert.equal(restarted.peekJson('directory'), null);
  await restarted.getJson('directory');
  assert.equal(restarted.peekJson('directory').rows.length, 60);
});

test('persistence envelopes compress before writing and expose only small synchronous metadata', async () => {
  let release, raw = null, writes = 0;
  const held = new Promise(resolve => { release = resolve; });
  const persistence = Persistence.create({
    codec: {
      pack: async value => { await held; return 'z:' + JSON.stringify(value); },
      unpack: async value => JSON.parse(value.slice(2))
    },
    text: {
      read: () => raw,
      write: (key, payload) => { raw = payload; writes++; return true; }
    }
  });
  const record = { d: '2026-10-10', m: 1, v: { comments: 'private structured payload' } };
  const pending = persistence.putJson('checklist', record, { payloadField: 'v' });
  await Promise.resolve();
  assert.equal(writes, 0, 'there must be no provisional raw write before compression');
  release();
  assert.equal(await pending, true);
  assert.equal(JSON.parse(raw).v, 'z:{"comments":"private structured payload"}');
  assert.deepEqual({ ...persistence.peekJsonMetadata('checklist', 'v') },
    { d: '2026-10-10', m: 1, v: true });
  assert.deepEqual({ ...await persistence.getJson('checklist', { payloadField: 'v' }) }, record);
  for (const metadata of [{ bypass: { raw: 'object' } }, { bypass: 'x'.repeat(257) }]) {
    await assert.rejects(persistence.putJson('checklist', { ...metadata, v: {} },
      { payloadField: 'v' }), /metadata/);
  }
  assert.equal(writes, 1, 'metadata must not provide another uncompressed payload channel');
});

test('persistence envelopes migrate legacy object payloads without changing freshness metadata', async () => {
  let raw = JSON.stringify({ d: '2026-10-10', m: 0, v: { rows: ['old'] } });
  const persistence = Persistence.create({
    codec: {
      pack: async value => 'z:' + JSON.stringify(value),
      unpack: async value => JSON.parse(value.slice(2))
    },
    text: {
      read: () => raw,
      write: (key, payload, context) => {
        assert.equal(context.expectedRaw, raw);
        raw = payload;
        return true;
      }
    }
  });
  const value = await persistence.getJson('checklist', { payloadField: 'v', migrate: true });
  assert.deepEqual({ ...value }, { d: '2026-10-10', m: 0, v: { rows: ['old'] } });
  assert.deepEqual(JSON.parse(raw), { d: '2026-10-10', m: 0, v: 'z:{"rows":["old"]}' });
});

test('persistence binary exception rejects JSON and does not acknowledge aborted writes', async () => {
  let writes = 0;
  const persistence = Persistence.create({ binary: {
    write: async () => { writes++; return false; }, read: async () => ({ raw: true })
  } });
  for (const value of [{ rows: [] }, [1, 2], 'binary', { type: 'image/png', size: 4 }, null]) {
    await assert.rejects(persistence.putBinary('image', value), /Blob, ArrayBuffer/);
  }
  assert.equal(writes, 0);
  assert.equal(await persistence.getBinary('image'), null);
  assert.equal(await persistence.putBinary('image', new Uint8Array([1])), false);
  assert.equal(await persistence.putBinary('image', new Uint8Array([1]),
    { shouldWrite: () => false }), false);
  assert.equal(writes, 1);
});

for (const keyPath of ['id', undefined]) test(
  'real IndexedDB JSON persistence migrates legacy records and rejects aborted replacements (' + (keyPath || 'out-of-line') + ')', async () => {
  const indexedDB = new IDBFactory();
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('json-persistence-control', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('json', keyPath ? { keyPath } : undefined);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const raw = key => new Promise((resolve, reject) => {
    const request = db.transaction('json').objectStore('json').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const legacy = { id: 'legacy', payload: 'a legitimate legacy field', rows: ['repeat '.repeat(400)] };
    await new Promise(resolve => {
      const tx = db.transaction('json', 'readwrite');
      tx.objectStore('json').put(legacy, ...(keyPath ? [] : [legacy.id]));
      tx.oncomplete = resolve;
    });
    const persistence = Persistence.create({ text: Persistence.indexedDb({
      database: db, store: 'json', keyPath
    }) });
    assert.deepEqual(await persistence.getJson('legacy', { migrate: true }), legacy);
    const saved = await raw('legacy');
    assert.equal(saved._persistence, 1);
    assert.ok(saved.payload.startsWith('z:'));
    assert.deepEqual(await persistence.listJson(), [legacy]);
    const backend = Persistence.indexedDb({ database: db, store: 'json', keyPath });
    await assert.rejects(backend.write('legacy', legacy), /encoded text/);
    assert.deepEqual(await raw('legacy'), saved,
      'an unencoded object must not reach the JSON IndexedDB backend');
    const abortingDb = { transaction(...args) {
      const tx = db.transaction(...args), objectStore = tx.objectStore.bind(tx);
      tx.objectStore = name => {
        const store = objectStore(name), put = store.put.bind(store);
        store.put = (...values) => { const request = put(...values); tx.abort(); return request; };
        return store;
      };
      return tx;
    } };
    const aborted = Persistence.create({ text: Persistence.indexedDb({
      database: abortingDb, store: 'json', keyPath
    }) });
    assert.equal(await aborted.putJson('legacy', { id: 'legacy', rows: ['new value'] }), false);
    assert.deepEqual(await raw('legacy'), saved, 'an aborted transaction must preserve the previous record');
    assert.equal(await persistence.remove('legacy'), true);
    assert.equal(await persistence.getJson('legacy'), null);
  } finally { db.close(); }
});

for (const keyPath of ['id', undefined]) test(
  'real IndexedDB migration compares the original inside its write transaction (' + (keyPath || 'out-of-line') + ')', async () => {
  const indexedDB = new IDBFactory();
  const db = await new Promise(resolve => {
    const request = indexedDB.open('json-migration-race', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('json', keyPath ? { keyPath } : undefined);
    request.onsuccess = () => resolve(request.result);
  });
  const seed = value => new Promise(resolve => {
    const tx = db.transaction('json', 'readwrite');
    tx.objectStore('json').put(value, ...(keyPath ? [] : [value.id]));
    tx.oncomplete = resolve;
  });
  try {
    await seed({ id: 'same', rows: ['old'] });
    let release, started;
    const held = new Promise(resolve => { release = resolve; });
    const packing = new Promise(resolve => { started = resolve; });
    const persistence = Persistence.create({
      text: Persistence.indexedDb({ database: db, store: 'json', keyPath }),
      codec: {
        pack: async () => { started(); await held; return 'j:' + JSON.stringify({ id: 'same', rows: ['old'] }); },
        unpack: async value => JSON.parse(value.startsWith('j:') ? value.slice(2) : value)
      }
    });
    const pending = persistence.getJson('same', { migrate: true });
    await packing;
    const newer = { id: 'same', rows: ['new'] };
    await seed(newer);
    release();
    assert.deepEqual(await pending, { id: 'same', rows: ['old'] });
    assert.deepEqual(await persistence.getJson('same'), newer);
    assert.equal(await persistence.clear(), true);
    assert.deepEqual(await persistence.listJson(), []);
  } finally { db.close(); }
});

test('real photo persistence backend acknowledges transaction completion and preserves image bytes', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  const functions = {};
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(script[1]) || /application\/(?:ld\+)?json/.test(script[1])) continue;
    const ast = acorn.parse(script[2], { ecmaVersion: 'latest' });
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'FunctionDeclaration' && /^idb(?:Read|Write)Raw$/.test(node.id.name)) {
        functions[node.id.name] = script[2].slice(node.start, node.end);
      }
      Object.values(node).forEach(child => {
        if (Array.isArray(child)) child.forEach(walk);
        else if (child && typeof child === 'object') walk(child);
      });
    }
    walk(ast);
  }
  const indexedDB = new IDBFactory();
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open('binary-persistence-control', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('img');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    const compile = (name, backend) => {
      assert.ok(functions[name], 'Actual production backend must exist: ' + name);
      return new Function('idb', 'IDB_STORE', functions[name] + '; return ' + name)(
        () => Promise.resolve(backend), 'img');
    };
    const write = compile('idbWriteRaw', db), read = compile('idbReadRaw', db);
    const persistence = Persistence.create({ binary: { write, read } });
    const image = new Blob([new Uint8Array([0, 17, 255, 42])], { type: 'image/png' });
    assert.equal(await persistence.putBinary('photo', image), true);
    const saved = await persistence.getBinary('photo');
    assert.equal(saved.type, image.type);
    assert.deepEqual(await saved.arrayBuffer(), await image.arrayBuffer());
    const abortingDb = { transaction(...args) {
      const tx = db.transaction(...args), objectStore = tx.objectStore.bind(tx);
      tx.objectStore = name => {
        const store = objectStore(name), put = store.put.bind(store);
        store.put = (...values) => { const request = put(...values); tx.abort(); return request; };
        return store;
      };
      return tx;
    } };
    const aborted = Persistence.create({ binary: {
      write: compile('idbWriteRaw', abortingDb), read
    } });
    assert.equal(await aborted.putBinary('aborted-photo', image), false);
    assert.equal(await persistence.getBinary('aborted-photo'), null);
  } finally { db.close(); }
});
