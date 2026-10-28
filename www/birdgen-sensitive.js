(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BirdGenSensitive = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var DAY_MS = 86400000;
  var MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;

  function validBird(bird, region) {
    return !!bird && /^[a-z0-9]+$/.test(bird.code || '')
      && typeof bird.name === 'string' && !!bird.name.trim()
      && bird.region === region;
  }

  function validJournal(value, region) {
    if (!value || value.version !== 1 || value.region !== region
        || !MONTH.test(value.month || '') || typeof value.blocked !== 'boolean'
        || !Number.isFinite(value.lastAcquiredAt) || value.lastAcquiredAt < 0
        || !Array.isArray(value.entries)) return false;
    var used = Object.create(null);
    return value.entries.every(function (entry) {
      if (!validBird(entry, region) || used[entry.code]
          || !Number.isFinite(entry.acquiredAt) || entry.acquiredAt <= 0
          || entry.acquiredAt > value.lastAcquiredAt
          || !(entry.firstDetectedAt === null && entry.expiresAt === null
            || entry.firstDetectedAt === entry.acquiredAt
              && entry.expiresAt === entry.firstDetectedAt + DAY_MS)) return false;
      used[entry.code] = true;
      return true;
    });
  }

  function visible(journal, options) {
    if (!validJournal(journal, options.region)
        || journal.month !== options.monthAt(options.now)) return [];
    return journal.entries.filter(function (entry) {
      return entry.firstDetectedAt !== null && entry.firstDetectedAt <= options.now
        && options.now < entry.expiresAt;
    }).map(function (entry) {
      return Object.assign({}, entry, {sourceMonth:journal.month,
        notificationKey:'sensitive:' + journal.region + ':' + journal.month + ':' + entry.code});
    });
  }

  function evaluate(previous, source, options) {
    options = options || {};
    if (!Number.isFinite(options.now) || typeof options.monthAt !== 'function'
        || !MONTH.test(options.monthAt(options.now))
        || typeof options.region !== 'string' || !options.region
        || typeof options.owner !== 'string' || !options.owner) {
      throw new Error('Sensitive alerts require a clock, source-local calendar, region and owner.');
    }
    var month = options.monthAt(options.now);
    var valid = validJournal(previous, options.region);
    var baseline = !valid;
    var journal = valid ? {
      version:1, region:previous.region, month:previous.month, blocked:previous.blocked,
      lastAcquiredAt:previous.lastAcquiredAt, entries:previous.entries.slice()
    } : {
      version:1, region:options.region, month:month, blocked:previous != null,
      lastAcquiredAt:0, entries:[]
    };
    if (valid && month < journal.month) {
      return {journal:previous, alerts:[], changed:false};
    }
    if (valid && month > journal.month) {
      journal.month = month;
      journal.blocked = false;
      journal.lastAcquiredAt = 0;
      journal.entries = [];
    }
    var acquired = source && source.source === 'highCountPage'
      && source.sourceOwner === options.owner && source.sourceRegion === options.region
      && source.state === 'ok' && source.acquired === true && source.inventoryComplete === true
      && source.sourceMonth === month
      && Number.isFinite(source.acquiredAt) && source.acquiredAt > 0
      && source.acquiredAt <= options.now && source.acquiredAt > journal.lastAcquiredAt
      && options.monthAt(source.acquiredAt) === month
      && Array.isArray(source.sensitiveRows)
      && source.sensitiveRows.every(function (bird) { return validBird(bird, options.region); });
    if (acquired) {
      var known = Object.create(null);
      journal.entries.forEach(function (entry) { known[entry.code] = true; });
      source.sensitiveRows.forEach(function (bird) {
        if (known[bird.code]) return;
        known[bird.code] = true;
        // Existing monthly presence has no recoverable first-detection date on initial setup.
        var first = baseline || journal.blocked ? null : source.acquiredAt;
        journal.entries.push({code:bird.code, name:bird.name.trim(), region:options.region,
          acquiredAt:source.acquiredAt, firstDetectedAt:first,
          expiresAt:first === null ? null : first + DAY_MS});
      });
      journal.lastAcquiredAt = source.acquiredAt;
    }
    if (!valid && !acquired) return {journal:null, alerts:[], changed:false};
    return {journal:journal, alerts:visible(journal, options),
      changed:JSON.stringify(journal) !== JSON.stringify(previous)};
  }

  return {DAY_MS:DAY_MS, validJournal:validJournal, evaluate:evaluate, visible:visible};
}));
