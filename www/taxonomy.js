(function (global) {
  'use strict';
  function editionKey(value) {
    var key = String(value == null ? '' : value);
    if (/^\d{4}$/.test(key)) key += '.0';
    if (!/^\d{4}\.\d+$/.test(key)) throw new Error('Unreadable taxonomy edition.');
    return key;
  }
  function latestEdition(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('Unreadable taxonomy version catalogue.');
    var latest = rows.filter(function (row) { return row && row.latest === true; });
    if (latest.length !== 1) throw new Error('No unambiguous latest official taxonomy edition.');
    return editionKey(latest[0].authorityVer);
  }
  function create(rows, edition) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('Empty taxonomy.');
    var byCode = {}, parents = {};
    rows.forEach(function (row) {
      if (!row || typeof row.speciesCode !== 'string' || !/^[a-z0-9]+$/.test(row.speciesCode)
          || typeof row.comName !== 'string' || !row.comName.trim()
          || byCode[row.speciesCode]
          || row.sciName != null && typeof row.sciName !== 'string'
          || row.category != null && typeof row.category !== 'string'
          || row.reportAs != null && typeof row.reportAs !== 'string') {
        throw new Error('Unreadable or duplicate taxonomy row.');
      }
      var parent = row.reportAs || '';
      if (parent && !/^[a-z0-9]+$/.test(parent)) throw new Error('Unreadable taxonomy parent.');
      byCode[row.speciesCode] = {
        name: row.comName, sci: row.sciName || '', parent: parent,
        category: row.category || 'species',
        alpha: [].concat(row.bandingCodes || [], row.comNameCodes || []).join(' ').toLowerCase()
      };
      if (parent) parents[row.speciesCode] = parent;
    });
    Object.keys(parents).forEach(function (code) {
      var visited = {}, current = code;
      while (parents[current]) {
        if (visited[current] || !byCode[parents[current]]) throw new Error('Broken taxonomy parent chain.');
        visited[current] = true;
        current = parents[current];
      }
    });
    return { schema: 1, edition: editionKey(edition), byCode: byCode, parents: parents };
  }
  function impact(previous, next, codes) {
    var out = { stable: [], renamed: [], unresolved: [] };
    Array.from(new Set(codes || [])).sort().forEach(function (code) {
      var before = previous && Object.prototype.hasOwnProperty.call(previous.byCode, code)
        ? previous.byCode[code] : null;
      var after = Object.prototype.hasOwnProperty.call(next.byCode, code) ? next.byCode[code] : null;
      if (!before || !after || before.parent !== after.parent
          || before.category !== after.category || before.sci !== after.sci) {
        out.unresolved.push(code);
      } else if (before.name !== after.name) out.renamed.push(code);
      else out.stable.push(code);
    });
    return out;
  }
  function validate(model, edition) {
    if (!model || model.schema !== 1 || model.edition !== editionKey(edition)
        || !model.byCode || !model.parents || !Object.keys(model.byCode).length) {
      throw new Error('Unreadable cached canonical taxonomy.');
    }
    Object.keys(model.byCode).forEach(function (code) {
      var row = model.byCode[code];
      if (!/^[a-z0-9]+$/.test(code) || !row || typeof row.name !== 'string'
          || !row.name.trim() || typeof row.sci !== 'string'
          || typeof row.category !== 'string' || !row.category
          || typeof row.alpha !== 'string' || typeof row.parent !== 'string'
          || (model.parents[code] || '') !== row.parent) {
        throw new Error('Unreadable cached taxonomy identity.');
      }
      var visited = {}, current = code;
      while (model.parents[current]) {
        if (visited[current] || !model.byCode[model.parents[current]]) {
          throw new Error('Broken cached taxonomy parent chain.');
        }
        visited[current] = true;
        current = model.parents[current];
      }
    });
    Object.keys(model.parents).forEach(function (code) {
      if (!model.byCode[code] || !model.parents[code]) {
        throw new Error('Unreadable cached taxonomy parent index.');
      }
    });
    return model;
  }
  function locales(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('Empty naming locale catalogue.');
    var seen = {};
    return rows.map(function (row) {
      if (!row || !/^[a-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})*$/.test(row.code || '')
          || !row.name || seen[row.code]) throw new Error('Unreadable naming locale catalogue.');
      seen[row.code] = true;
      return { code: row.code, name: String(row.name), lastUpdate: row.lastUpdate || '' };
    });
  }
  function names(rows, model) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('Empty localized taxonomy.');
    var map = {}, seen = {};
    rows.forEach(function (row) {
      if (!row || !Object.prototype.hasOwnProperty.call(model.byCode, row.speciesCode) || seen[row.speciesCode]) {
        throw new Error('Localized taxonomy does not match the selected canonical edition.');
      }
      seen[row.speciesCode] = true;
      if (typeof row.comName === 'string' && row.comName.trim()) map[row.speciesCode] = row.comName;
    });
    if (!Object.keys(map).length) throw new Error('No readable localized common names.');
    return map;
  }
  var api = {
    editionKey: editionKey, latestEdition: latestEdition, create: create,
    impact: impact, validate: validate, locales: locales, names: names
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.BirdTaxonomy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
