(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PersonalListBackup = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  var FORMAT = 'birdchaser-personal-lists';
  var KINDS = ['watch', 'favorites'];
  function object(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(function (key) { return allowed.indexOf(key) < 0; })) {
      throw new Error(label + ' contains unsupported fields or is not an object.');
    }
  }
  function parse(text) {
    var value;
    try { value = JSON.parse(text); }
    catch (error) { throw new Error('The file is not valid JSON. Nothing was saved.'); }
    object(value, ['format', 'version', 'watch', 'favorites'], 'Backup');
    if (value.format !== FORMAT || value.version !== 1) {
      throw new Error('Unsupported personal-list backup format or version.');
    }
    if (!KINDS.some(function (kind) { return Object.hasOwn(value, kind); })) {
      throw new Error('The file contains no supported personal lists.');
    }
    KINDS.forEach(function (kind) {
      if (Object.hasOwn(value, kind) && !Array.isArray(value[kind])) {
        throw new Error(kind + ' must be an array, including an intentional empty list.');
      }
    });
    return value;
  }
  function normalize(kind, rows, resolve) {
    if (!Array.isArray(rows)) throw new Error(kind + ' is not a readable list.');
    return rows.map(function (row, index) {
      var label = kind + ' entry ' + (index + 1);
      if (kind === 'watch') {
        object(row, ['code', 'name'], label);
        if (typeof row.code !== 'string' || typeof row.name !== 'string'
            || row.code && !/^[a-z0-9]+$/i.test(row.code)
            || !row.code && !row.name.trim()) throw new Error(label + ' lacks a usable bird identity.');
        var bird = { code: row.code.toLowerCase(), name: row.name };
        return resolve ? resolve(bird) : bird;
      }
      object(row, ['id', 'locId', 'locName', 'lat', 'lng', 'region'], label);
      function coordinate(value, max) {
        if (!(typeof value === 'number' || typeof value === 'string'
              && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
            || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > max) {
          throw new Error(label + ' has invalid coordinates.');
        }
        return value;
      }
      var lat = coordinate(row.lat, 90), lng = coordinate(row.lng, 180);
      if (row.locId != null && typeof row.locId !== 'string'
          || row.id != null && typeof row.id !== 'string') {
        throw new Error(label + ' has an invalid location identity.');
      }
      var locId = String(row.locId || '').toUpperCase();
      if (locId && !/^L\d+$/.test(locId)) throw new Error(label + ' has an invalid hotspot ID.');
      if (typeof row.locName !== 'string' || row.region != null && typeof row.region !== 'string') {
        throw new Error(label + ' has invalid saved place metadata.');
      }
      var id = String(row.id || (locId || lat + ',' + lng));
      if (locId) {
        if (id.toUpperCase() !== locId) throw new Error(label + ' has conflicting location identities.');
        id = locId;
      } else {
        var pair = id.split(',');
        if (pair.length !== 2 || !pair.every(function (value) { return value.trim(); })
            || Number(pair[0]) !== Number(lat) || Number(pair[1]) !== Number(lng)) {
          throw new Error(label + ' has conflicting coordinate-only identity.');
        }
      }
      return { id: id, locId: locId, locName: row.locName,
        lat: lat, lng: lng, region: row.region || '' };
    });
  }
  function encode(current, selected) {
    var out = { format: FORMAT, version: 1 };
    KINDS.forEach(function (kind) {
      if (selected[kind]) out[kind] = normalize(kind, current[kind]);
    });
    if (Object.keys(out).length === 2) throw new Error('Choose at least one personal list.');
    return JSON.stringify(out, null, 2);
  }
  function plan(current, incoming, selected, mode, resolve) {
    var next = {}, stats = {};
    if (mode !== 'merge' && mode !== 'replace') throw new Error('Choose Merge or Replace.');
    KINDS.forEach(function (kind) {
      if (!selected[kind] || !Object.hasOwn(incoming, kind)) return;
      var before = normalize(kind, current[kind]);
      var imported = normalize(kind, incoming[kind], kind === 'watch' ? resolve : null);
      var identity = function (row) { return kind === 'watch' ? row.code || row.name : row.id; };
      var existing = new Map(before.map(function (row) { return [identity(row), row]; }));
      var unique = new Map(), duplicates = 0, conflicts = 0, added = 0;
      imported.forEach(function (row) {
        var key = identity(row);
        if (unique.has(key)) { duplicates++; return; }
        unique.set(key, row);
        if (!existing.has(key)) added++;
        else if (JSON.stringify(existing.get(key)) !== JSON.stringify(row)) conflicts++;
      });
      next[kind] = mode === 'replace' ? Array.from(unique.values())
        : before.concat(Array.from(unique.values()).filter(function (row) {
          return !existing.has(identity(row));
        }));
      stats[kind] = { before: before.length, incoming: imported.length, after: next[kind].length,
        added: added, removed: mode === 'replace' ? before.filter(function (row) {
          return !unique.has(identity(row));
        }).length : 0, duplicates: duplicates, conflicts: conflicts };
    });
    if (!Object.keys(next).length) throw new Error('Select a list contained in this file.');
    return { mode: mode, next: next, stats: stats };
  }
  return { parse: parse, normalize: normalize, encode: encode, plan: plan, kinds: KINDS };
});
