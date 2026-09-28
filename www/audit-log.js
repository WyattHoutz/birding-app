(function (global) {
  'use strict';

  var SCHEMA = 'birdchaser.event/1';
  var SETTINGS_SCHEMA = 'birdchaser.settings/1';
  var DB_NAME = 'birdchaser-diagnostics';
  var STORE_NAME = 'sessions';
  var MAX_EVENTS = 1200;
  var MAX_SESSION_BYTES = 2 * 1024 * 1024;
  var MAX_SESSIONS = 3;
  var MAX_AGE_MS = 72 * 60 * 60 * 1000;
  var TAGS = {
    main: 1, settings: 1, twitches: 1, day_trip: 1, bird_gen: 1,
    nightly_migration: 1, leaderboard_ticks: 1, pro_patches: 1,
    recent_checklists: 1, navigation: 1, user_action: 1, setting: 1,
    network: 1, cache: 1, render: 1, photo: 1, progressive_render: 1,
    retry: 1, slow: 1, rate_limited: 1, offline: 1, stale: 1,
    partial: 1, error: 1, lifecycle: 1, privacy: 1, diagnostic: 1,
    performance: 1
  };
  var CATEGORIES = {
    navigation: 1, user_action: 1, data: 1, network: 1, cache: 1,
    render: 1, error: 1, lifecycle: 1, privacy: 1
  };
  var OUTCOMES = {
    start: 1, ok: 1, empty: 1, cancelled: 1, blocked: 1,
    timeout: 1, error: 1
  };
  var SENSITIVE_KEY = /(api.?key|token|authorization|cookie|password|passcode|username|display.?name|email|address|latitude|longitude|(^|_)lat($|_)|(^|_)lng($|_)|coordinate|aba.?sid|tide.?station|personal|seen.?list|response.?body|request.?body)/i;

  function text(value, max) {
    return String(value == null ? '' : value).slice(0, max || 160);
  }

  function cleanValue(value, depth) {
    if (depth > 3) return '[depth-limited]';
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value === 'string') return text(value, 240);
    if (Array.isArray(value)) {
      return value.slice(0, 30).map(function (item) {
        return cleanValue(item, depth + 1);
      });
    }
    if (typeof value === 'object') {
      var out = {};
      Object.keys(value).sort().slice(0, 40).forEach(function (key) {
        if (SENSITIVE_KEY.test(key) && !/_configured$/i.test(key)) return;
        out[text(key, 60)] = cleanValue(value[key], depth + 1);
      });
      return out;
    }
    return text(value, 120);
  }

  function cleanPage(value) {
    value = value || {};
    return {
      id: text(value.id || 'main', 48),
      view: text(value.view || 'default', 48),
      overlay: value.overlay ? text(value.overlay, 48) : null
    };
  }

  function cleanTags(values) {
    var seen = {};
    return (values || []).map(function (value) {
      return text(value, 48).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    }).filter(function (value) {
      if (!TAGS[value] || seen[value]) return false;
      seen[value] = true;
      return true;
    }).sort();
  }

  function sessionId(now, random) {
    return 's_' + now.toString(36) + '_' + Math.floor(random * 0xFFFFFF)
      .toString(36).padStart(5, '0');
  }

  function openDb(indexedDB) {
    if (!indexedDB || typeof indexedDB.open !== 'function') {
      return Promise.resolve(null);
    }
    return new Promise(function (resolve) {
      var request;
      try { request = indexedDB.open(DB_NAME, 1); }
      catch (error) { resolve(null); return; }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'session_id' });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { resolve(null); };
    });
  }

  function create(options) {
    options = options || {};
    var clock = options.clock || function () { return Date.now(); };
    var wallClock = options.wallClock || function () { return new Date().toISOString(); };
    var started = clock();
    var buildChannel = text(options.buildChannel || 'production', 24);
    var verbosePersistence = options.verbosePersistence == null
      ? buildChannel !== 'production' : !!options.verbosePersistence;
    var id = sessionId(started, (options.random || Math.random)());
    var events = [];
    var settings = [];
    var settingsRev = 0;
    var pageProvider = options.page || function () {
      return { id: 'main', view: 'menu', overlay: null };
    };
    var persistTimer = null;
    var dbPromise = openDb(options.indexedDB === undefined
      ? global.indexedDB : options.indexedDB);

    function persistentEvents() {
      if (verbosePersistence) return events.slice();
      return events.filter(function (row) {
        return row.category === 'error'
          || row.category === 'lifecycle'
          || (row.category === 'network' && row.outcome === 'error');
      });
    }

    function sessionRecord() {
      return {
        session_id: id,
        started_at: new Date(started).toISOString(),
        updated_at: wallClock(),
        app_version: text(options.appVersion || '', 40),
        build_channel: buildChannel,
        events: persistentEvents(),
        settings: verbosePersistence ? settings.slice() : []
      };
    }

    function trimEvents() {
      while (events.length > MAX_EVENTS) events.shift();
      while (events.length > 1
          && JSON.stringify({ events: events, settings: settings }).length
            > MAX_SESSION_BYTES) {
        events.shift();
      }
    }

    function prune(db) {
      return new Promise(function (resolve) {
        var transaction;
        try { transaction = db.transaction(STORE_NAME, 'readwrite'); }
        catch (error) { resolve(); return; }
        var store = transaction.objectStore(STORE_NAME);
        var request = store.getAll();
        request.onsuccess = function () {
          var rows = (request.result || []).sort(function (a, b) {
            return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
          });
          var cutoff = clock() - MAX_AGE_MS;
          var keptBytes = 0;
          rows.forEach(function (row, index) {
            var bytes = JSON.stringify(row).length;
            var old = Date.parse(row.updated_at || row.started_at || 0) < cutoff;
            if (old || index >= MAX_SESSIONS || keptBytes + bytes > MAX_SESSION_BYTES) {
              store.delete(row.session_id);
            } else {
              keptBytes += bytes;
            }
          });
        };
        transaction.oncomplete = function () { resolve(); };
        transaction.onerror = function () { resolve(); };
      });
    }

    function persistNow() {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      return dbPromise.then(function (db) {
        if (!db) return false;
        return new Promise(function (resolve) {
          var transaction;
          try { transaction = db.transaction(STORE_NAME, 'readwrite'); }
          catch (error) { resolve(false); return; }
          transaction.objectStore(STORE_NAME).put(sessionRecord());
          transaction.oncomplete = function () {
            prune(db).then(function () { resolve(true); });
          };
          transaction.onerror = function () { resolve(false); };
        });
      });
    }

    function schedulePersist() {
      if (persistTimer) return;
      persistTimer = setTimeout(persistNow, 500);
    }

    function event(name, values) {
      values = values || {};
      var category = CATEGORIES[values.category] ? values.category : 'data';
      var outcome = OUTCOMES[values.outcome] ? values.outcome : 'ok';
      var row = {
        schema: SCHEMA,
        seq: events.length ? events[events.length - 1].seq + 1 : 1,
        ts: wallClock(),
        elapsed_ms: Math.max(0, clock() - started),
        session_id: id,
        event: text(name, 80),
        category: category,
        outcome: outcome,
        tags: cleanTags(values.tags),
        page: cleanPage(values.page || pageProvider()),
        operation_id: values.operationId ? text(values.operationId, 80) : null,
        parent_id: values.parentId ? text(values.parentId, 80) : null,
        settings_rev: settingsRev,
        attrs: cleanValue(values.attrs || {}, 0)
      };
      events.push(row);
      trimEvents();
      if (verbosePersistence || category === 'error' || category === 'lifecycle'
          || (category === 'network' && outcome === 'error')) schedulePersist();
      return row;
    }

    function snapshotSettings(values, reason) {
      settingsRev++;
      var row = {
        schema: SETTINGS_SCHEMA,
        rev: settingsRev,
        ts: wallClock(),
        reason: text(reason || 'snapshot', 60),
        values: cleanValue(values || {}, 0)
      };
      settings.push(row);
      if (settings.length > 80) settings.shift();
      event('settings.snapshot', {
        category: 'user_action',
        tags: ['settings', 'setting'],
        attrs: { reason: row.reason, revision: settingsRev }
      });
      return row;
    }

    function changedSettings(before, after, reason) {
      before = cleanValue(before || {}, 0);
      after = cleanValue(after || {}, 0);
      var keys = {};
      Object.keys(before).forEach(function (key) { keys[key] = 1; });
      Object.keys(after).forEach(function (key) { keys[key] = 1; });
      var changed = Object.keys(keys).filter(function (key) {
        return JSON.stringify(before[key]) !== JSON.stringify(after[key]);
      });
      if (!changed.length) return [];
      snapshotSettings(after, reason || 'changed');
      return changed.map(function (key) {
        return event('setting.changed', {
          category: 'user_action',
          tags: ['settings', 'setting'],
          attrs: { key: key, from: before[key], to: after[key] }
        });
      });
    }

    function jsonl(rows) {
      return (rows || []).map(function (row) { return JSON.stringify(row); }).join('\n')
        + ((rows || []).length ? '\n' : '');
    }

    function bundle() {
      var persisted = events.slice();
      var manifest = {
        format: 'birdchaser-diagnostics/1',
        generated_at: wallClock(),
        session_id: id,
        app_version: text(options.appVersion || '', 40),
        build_channel: buildChannel,
        files: [
          'manifest.json', 'schema.json', 'settings.jsonl',
          'events.jsonl', 'errors.jsonl', 'summary.txt'
        ],
        redacted: [
          'credentials', 'cookies', 'account identity', 'exact coordinates',
          'addresses', 'personal lists', 'request and response bodies'
        ],
        counts: { events: persisted.length, settings: settings.length }
      };
      var pages = [], pageSeen = {};
      var outcomes = {}, requests = {};
      persisted.forEach(function (row) {
        var key = row.page.id + ':' + row.page.view;
        if (!pageSeen[key]) { pageSeen[key] = 1; pages.push(key); }
        outcomes[row.outcome] = (outcomes[row.outcome] || 0) + 1;
        if (row.category === 'network') {
          requests[row.outcome] = (requests[row.outcome] || 0) + 1;
        }
      });
      var errors = persisted.filter(function (row) {
        return row.category === 'error' || row.outcome === 'error';
      });
      var schema = {
        event_schema: SCHEMA,
        settings_schema: SETTINGS_SCHEMA,
        categories: Object.keys(CATEGORIES).sort(),
        outcomes: Object.keys(OUTCOMES).sort(),
        tags: Object.keys(TAGS).sort(),
        ordering: 'seq is authoritative; elapsed_ms is monotonic within the session'
      };
      var summary = [
        'Bird Chaser diagnostic package',
        'Session: ' + id,
        'Events: ' + persisted.length,
        'Settings revisions: ' + settings.length,
        'Pages in order: ' + (pages.join(' -> ') || 'none'),
        'Outcomes: ' + JSON.stringify(outcomes),
        'Network outcomes: ' + JSON.stringify(requests),
        'Errors: ' + errors.length,
        'Final settings revision: ' + settingsRev,
        'Elapsed milliseconds: ' + (persisted.length
          ? persisted[persisted.length - 1].elapsed_ms : 0),
        'All fields were sanitized before persistence.'
      ].join('\n') + '\n';
      return {
        manifest: manifest,
        files: {
          'manifest.json': JSON.stringify(manifest, null, 2) + '\n',
          'schema.json': JSON.stringify(schema, null, 2) + '\n',
          'settings.jsonl': jsonl(settings),
          'events.jsonl': jsonl(persisted),
          'errors.jsonl': jsonl(errors.map(function (row) {
            return {
              seq: row.seq, ts: row.ts, event: row.event,
              outcome: row.outcome, page: row.page, attrs: row.attrs
            };
          })),
          'summary.txt': summary
        }
      };
    }

    function clear() {
      events.length = 0;
      settings.length = 0;
      settingsRev = 0;
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = null;
      return dbPromise.then(function (db) {
        if (!db) return false;
        return new Promise(function (resolve) {
          var transaction = db.transaction(STORE_NAME, 'readwrite');
          transaction.objectStore(STORE_NAME).clear();
          transaction.oncomplete = function () { resolve(true); };
          transaction.onerror = function () { resolve(false); };
        });
      });
    }

    return {
      event: event,
      snapshotSettings: snapshotSettings,
      changedSettings: changedSettings,
      events: function () { return events.slice(); },
      settings: function () { return settings.slice(); },
      settingsRevision: function () { return settingsRev; },
      bundle: bundle,
      persistentEvents: persistentEvents,
      flush: persistNow,
      clear: clear,
      sessionId: id
    };
  }

  var API = {
    SCHEMA: SCHEMA,
    SETTINGS_SCHEMA: SETTINGS_SCHEMA,
    TAGS: Object.keys(TAGS).sort(),
    create: create
  };
  global.BirdAudit = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
}(typeof window !== 'undefined' ? window : globalThis));
