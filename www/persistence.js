(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(globalThis);
  else root.BirdPersistence = factory(root);
}(typeof window !== 'undefined' ? window : globalThis, function (environment) {
  'use strict';

  var MIN_BYTES = 256;
  function bytesToB64(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i += 0x8000) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
    }
    return environment.btoa(parts.join(''));
  }
  function packJson(value) {
    var json;
    try { json = JSON.stringify(value); } catch (error) { return Promise.reject(error); }
    if (json.length < MIN_BYTES || typeof environment.CompressionStream !== 'function'
        || typeof environment.Response !== 'function') return Promise.resolve('j:' + json);
    try {
      var body = new environment.Response(json).body;
      if (!body || typeof body.pipeThrough !== 'function') return Promise.resolve('j:' + json);
      return new environment.Response(body.pipeThrough(new environment.CompressionStream('gzip'))).arrayBuffer()
        .then(function (buffer) {
          var packed = 'z:' + bytesToB64(new Uint8Array(buffer));
          return packed.length < json.length + 2 ? packed : 'j:' + json;
        }).catch(function () { return 'j:' + json; });
    } catch (error) { return Promise.resolve('j:' + json); }
  }
  function unpackJson(payload) {
    if (typeof payload !== 'string' || !payload) return Promise.resolve(null);
    if (payload.slice(0, 2) !== 'z:') {
      try { return Promise.resolve(JSON.parse(payload.slice(0, 2) === 'j:' ? payload.slice(2) : payload)); }
      catch (error) { return Promise.resolve(null); }
    }
    if (typeof environment.DecompressionStream !== 'function'
        || typeof environment.Response !== 'function') return Promise.resolve(null);
    try {
      var encoded = environment.atob(payload.slice(2)), bytes = new Uint8Array(encoded.length);
      for (var i = 0; i < encoded.length; i++) bytes[i] = encoded.charCodeAt(i);
      var body = new environment.Response(bytes).body;
      if (!body || typeof body.pipeThrough !== 'function') return Promise.resolve(null);
      return new environment.Response(body.pipeThrough(new environment.DecompressionStream('gzip'))).text()
        .then(function (json) { try { return JSON.parse(json); } catch (error) { return null; } })
        .catch(function () { return null; });
    } catch (error) { return Promise.resolve(null); }
  }
  var nativeCodec = { pack: packJson, unpack: unpackJson };

  function binary(value) {
    if (typeof environment.Blob === 'function' && value instanceof environment.Blob) return true;
    if (ArrayBuffer.isView(value)) return true;
    try {
      ArrayBuffer.prototype.slice.call(value, 0, 0);
      return true;
    } catch (error) { return false; }
  }

  function indexedDb(options) {
    if (!options || options.keyPath != null && (typeof options.keyPath !== 'string'
        || !options.keyPath || /^(?:payload|_persistence)$/.test(options.keyPath))) {
      throw new TypeError('IndexedDB JSON storage requires a non-reserved scalar key path.');
    }
    function payload(row) {
      return row == null ? null : row._persistence === 1 && typeof row.payload === 'string'
        ? row.payload : JSON.stringify(row);
    }
    async function read(key) {
      var db = await options.database;
      if (!db) return null;
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(options.store, 'readonly');
        var request = tx.objectStore(options.store).get(key);
        request.onsuccess = function () { resolve(payload(request.result)); };
        request.onerror = function () { reject(request.error); };
      });
    }
    async function list() {
      var db = await options.database;
      if (!db) return [];
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(options.store, 'readonly');
        var request = tx.objectStore(options.store).getAllKeys();
        request.onsuccess = function () {
          resolve((request.result || []).map(function (key) { return { key: key }; }));
        };
        request.onerror = function () { reject(request.error); };
      });
    }
    async function mutate(key, value, context, operation) {
      var db = await options.database;
      if (!db) return false;
      return new Promise(function (resolve) {
        var tx;
        try {
          tx = db.transaction(options.store, 'readwrite');
          var store = tx.objectStore(options.store), accepted = true;
          tx.oncomplete = function () { resolve(accepted); };
          tx.onerror = tx.onabort = function () { resolve(false); };
          function commit() {
            if (operation === 'clear') store.clear();
            else if (operation === 'remove') store.delete(key);
            else {
              var row = { _persistence: 1, payload: value };
              if (options.keyPath) {
                row[options.keyPath] = key;
                store.put(row);
              } else store.put(row, key);
            }
          }
          if (context && Object.prototype.hasOwnProperty.call(context, 'expectedRaw')) {
            var request = store.get(key);
            request.onsuccess = function () {
              if (payload(request.result) !== context.expectedRaw) accepted = false;
              else commit();
            };
          } else commit();
        } catch (error) {
          if (tx) try { tx.abort(); } catch (_) {}
          resolve(false);
        }
      });
    }
    return {
      read: read, list: list,
      write: function (key, value, context) {
        if (typeof value !== 'string') return Promise.reject(new TypeError('IndexedDB JSON payloads must be encoded text.'));
        return mutate(key, value, context, 'write');
      },
      remove: function (key) { return mutate(key, null, null, 'remove'); },
      clear: function () { return mutate(null, null, null, 'clear'); }
    };
  }

  function create(options) {
    options = options || {};
    var codec = options.codec || nativeCodec, text = options.text, bytes = options.binary;
    var snapshots = Object.create(null), decoded = Object.create(null);
    function remember(key, payload, value) {
      decoded[key] = { payload: payload, value: JSON.stringify(value) };
    }
    function adapter(store, method) {
      if (!store || typeof store[method] !== 'function') {
        throw new Error('Persistence adapter is unavailable: ' + method);
      }
      return store[method];
    }
    function legacyStringChoices(values) {
      if (values == null) return [];
      if (!Array.isArray(values) || !values.length || values.length > 16
          || values.some(function (value) {
            return typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
          })) throw new TypeError('Legacy strings require a finite list of literal choices.');
      return values.slice();
    }
    function metadata(record, field) {
      if (!record || typeof record !== 'object' || Array.isArray(record)
          || !Object.prototype.hasOwnProperty.call(record, field)) {
        throw new TypeError('JSON envelopes require an object with a payload field.');
      }
      var result = Object.create(null);
      Object.keys(record).forEach(function (name) {
        if (name === field) return;
        if (record[name] !== null && !/^(?:string|number|boolean)$/.test(typeof record[name])) {
          throw new TypeError('JSON envelope metadata must contain only scalars.');
        }
        result[name] = record[name];
      });
      if (JSON.stringify(result).length > 256) throw new TypeError('JSON envelope metadata exceeds 256 characters.');
      return result;
    }
    async function putJson(key, value, controls) {
      controls = controls || {};
      if (binary(value)) throw new TypeError('Use putBinary for binary persistence.');
      if (!codec || typeof codec.pack !== 'function') throw new Error('Persistence compression codec is unavailable.');
      var field = controls.payloadField, header = field ? metadata(value, field) : null;
      if (field && binary(value[field])) throw new TypeError('Use putBinary for binary persistence.');
      var payload = await codec.pack(field ? value[field] : value);
      if (typeof payload !== 'string' || !/^[jz]:/.test(payload)) {
        throw new Error('Persistence codec returned an untagged payload.');
      }
      if (header) {
        header[field] = payload;
        payload = JSON.stringify(header);
      }
      if (controls.onPacked) controls.onPacked(payload);
      if (controls.beforeWrite) await controls.beforeWrite();
      if (controls.shouldWrite && !controls.shouldWrite()) return false;
      var stored = await adapter(text, 'write')(key, payload, controls.context) === true;
      if (stored) remember(key, payload, value);
      if (stored && controls.track) snapshots[key] = { value: value, payload: payload };
      return stored;
    }
    async function getJson(key, controls) {
      controls = controls || {};
      var legacyStrings = legacyStringChoices(controls.legacyStrings);
      var payload = await adapter(text, 'read')(key);
      if (controls.onRead) controls.onRead(payload);
      if (payload == null) return null;
      if (!codec || typeof codec.unpack !== 'function') throw new Error('Persistence decompression codec is unavailable.');
      var field = controls.payloadField, encoded = payload, header = null;
      if (field) {
        var record = JSON.parse(payload);
        header = metadata(record, field);
        encoded = record[field];
      }
      var value = legacyStrings.indexOf(encoded) >= 0 ? encoded
        : field && typeof encoded !== 'string' ? encoded : await codec.unpack(encoded);
      if (header) { header[field] = value; value = header; }
      remember(key, payload, value);
      if (controls.track) snapshots[key] = { value: value, payload: payload };
      if (controls.migrate && value != null
          && (typeof encoded !== 'string' || encoded.slice(0, 2) !== 'z:')) {
        try {
          var migratedPayload;
          var migrated = await putJson(key, value, {
            shouldWrite: controls.shouldWrite,
            payloadField: field,
            track: controls.track,
            context: { expectedRaw: payload },
            onPacked: function (packed) {
              migratedPayload = packed;
              if (controls.onPacked) controls.onPacked(packed);
            }
          });
          if (migrated && controls.onMigrated) controls.onMigrated(migratedPayload);
        } catch (error) {
          if (controls.onMigrationError) controls.onMigrationError(error);
        }
      }
      return value;
    }
    function peekJson(key, controls) {
      var legacyStrings = legacyStringChoices(controls && controls.legacyStrings);
      var payload = adapter(text, 'read')(key);
      if (controls && controls.onVersion) {
        if (payload && typeof payload.then === 'function') {
          throw new TypeError('JSON projection versions require a synchronous backend.');
        }
        controls.onVersion(function () {
          try { return adapter(text, 'read')(key) === payload; }
          catch (error) { return false; }
        });
      }
      if (typeof payload !== 'string') return null;
      if (legacyStrings.indexOf(payload) >= 0) return payload;
      var saved = decoded[key];
      if (saved && saved.payload === payload) return JSON.parse(saved.value);
      if (payload.slice(0, 2) === 'z:') return null;
      try { return JSON.parse(payload.slice(0, 2) === 'j:' ? payload.slice(2) : payload); }
      catch (error) { return null; }
    }
    function peekJsonMetadata(key, field) {
      try {
        var payload = adapter(text, 'read')(key);
        if (typeof payload !== 'string') return null;
        var record = JSON.parse(payload), header = metadata(record, field);
        header[field] = !!record[field];
        return header;
      } catch (error) { return null; }
    }
    function isJsonCurrent(key, value) {
      var saved = snapshots[key];
      if (!saved || saved.value !== value) return false;
      // Only a synchronous backend can certify a synchronous readiness check.
      try { return adapter(text, 'read')(key) === saved.payload; }
      catch (error) { return false; }
    }
    function versionJson(key) {
      var payload = adapter(text, 'read')(key);
      if (payload && typeof payload.then === 'function') {
        throw new TypeError('JSON version checks require a synchronous backend.');
      }
      return function () {
        try { return adapter(text, 'read')(key) === payload; }
        catch (error) { return false; }
      };
    }
    function jsonStorageBytes(key) {
      var payload = adapter(text, 'read')(key);
      if (payload && typeof payload.then === 'function') {
        throw new TypeError('JSON storage byte counts require a synchronous backend.');
      }
      return typeof payload === 'string' ? payload.length * 2 : 0;
    }
    function jsonStoragePresent(key) {
      var payload = adapter(text, 'read')(key);
      if (payload && typeof payload.then === 'function') {
        throw new TypeError('JSON storage presence checks require a synchronous backend.');
      }
      // Empty or unreadable records still prevent verified erasure.
      return payload != null;
    }
    async function putBinary(key, value, controls) {
      if (!binary(value)) throw new TypeError('Binary persistence requires a Blob, ArrayBuffer, or typed array.');
      controls = controls || {};
      if (controls.shouldWrite && !controls.shouldWrite()) return false;
      return await adapter(bytes, 'write')(key, value, controls.context) === true;
    }
    async function getBinary(key) {
      var value = await adapter(bytes, 'read')(key);
      return value == null || !binary(value) ? null : value;
    }
    async function listJson(controls) {
      var keys = await adapter(text, 'list')();
      var values = await Promise.all(keys.map(function (entry) { return getJson(entry.key, controls); }));
      return values.filter(function (value) { return value != null; });
    }
    return { putJson: putJson, getJson: getJson, peekJson: peekJson, isJsonCurrent: isJsonCurrent,
      versionJson: versionJson,
      jsonStorageBytes: jsonStorageBytes,
      jsonStoragePresent: jsonStoragePresent,
      peekJsonMetadata: peekJsonMetadata,
      listJson: listJson,
      remove: function (key, controls) {
        controls = controls || {};
        if (controls.shouldWrite && !controls.shouldWrite()) return false;
        return adapter(text, 'remove')(key, controls.context);
      },
      clear: function () { return adapter(text, 'clear')(); },
      putBinary: putBinary, getBinary: getBinary };
  }

  return { create: create, indexedDb: indexedDb, packJson: packJson, unpackJson: unpackJson };
}));
