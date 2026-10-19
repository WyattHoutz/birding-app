(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'));
  else root.BirdGenNotifications = factory(root.BirdLogic);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (logic) {
  'use strict';
  var FRESH_MS = 30 * 60 * 1000;
  var REPEAT_MS = 7 * 24 * 60 * 60 * 1000;
  var MAX_ROWS = 1000;

  function validateBuild(info, now) {
    if (!info || typeof info.channel !== 'string') throw new Error('The native build identity is missing.');
    if (info.channel !== 'production') {
      var expires = Date.parse(info.expiresAt);
      if (!isFinite(expires) || !isFinite(now) || expires <= now) {
        throw new Error('This sideloaded build has expired. Install the current Bird Chaser release.');
      }
    }
    return true;
  }

  function event(kind, code, place, title, body, observedAt) {
    return {
      id: [code ? 'bird' : kind, code || '', place || ''].map(encodeURIComponent).join('|'),
      title: String(title || 'Bird Gen').slice(0, 120),
      body: String(body || '').slice(0, 240),
      observedAt: Number(observedAt) || 0
    };
  }

  function plan(profile, feeds) {
    if (!profile || !Array.isArray(profile.counties) || !profile.home ||
        !isFinite(profile.home.lat) || !isFinite(profile.home.lng) ||
        Math.abs(profile.home.lat) > 90 || Math.abs(profile.home.lng) > 180 ||
        !(profile.chaseMaxMi > 0)) {
      throw new Error('A saved home and county scope are required for notifications.');
    }
    var back = logic.SURGE.BASELINE_DAYS;
    var base = logic.planFeeds(profile, back);
    if (!base.length) throw new Error('A notification acquisition scope is required.');
    var codes = [];
    (feeds || []).forEach(function (f) {
      if (f.kind !== 'notable' && f.kind !== 'recent') return;
      (f.rows || []).forEach(function (r) {
        if (r && typeof r.speciesCode === 'string' && /^[a-z0-9]+$/.test(r.speciesCode)) codes.push({ code: r.speciesCode });
      });
    });
    var jobs = base.filter(function (j) { return j.kind === 'notable'; })
      .concat(base.filter(function (j) { return j.kind !== 'notable'; }))
      .concat(logic.planSpeciesFeeds(profile, logic.speciesTargetCodes(codes), back));
    return {
      baseFiles: base.map(function (j) { return j.file; }),
      truncated: logic.speciesTargetCodes(codes, 0).length > logic.speciesTargetCodes(codes).length,
      jobs: jobs.map(function (j) {
        var params = Object.assign({}, j.params, { maxResults: MAX_ROWS });
        return {
          file: j.file, kind: j.kind, src: j.src,
          path: j.path + '?' + Object.keys(params).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k]));
          }).join('&')
        };
      })
    };
  }

  function evaluate(profile, feeds, now) {
    now = Number(now);
    if (!isFinite(now)) throw new Error('Notification evaluation needs a valid clock.');
    var fresh = (feeds || []).filter(function (f) {
      return f && Array.isArray(f.rows) && isFinite(f.at) && f.at <= now &&
        now - f.at <= FRESH_MS;
    });
    var errors = [];
    fresh = fresh.map(function (f) {
      var bad = 0;
      var rows = f.rows.filter(function (r, index) {
        var valid = r && typeof r === 'object' && !Array.isArray(r)
          && typeof r.speciesCode === 'string' && /^[a-z0-9]+$/.test(r.speciesCode)
          && typeof r.comName === 'string' && r.comName.trim()
          && typeof r.obsDt === 'string' && logic.parseObsDt(r.obsDt);
        if (!valid) {
          bad++;
          if (errors.length < 20) errors.push({ file: f.file, index: index, reason: 'Invalid species/name/date row' });
        }
        return !!valid;
      });
      return Object.assign({}, f, { rows: rows, capped: !!f.capped || bad > 0 });
    });
    var wanted = plan(profile, fresh);
    var complete = !wanted.truncated && wanted.jobs.length > 0 && wanted.jobs.every(function (j) {
      return fresh.some(function (f) {
        return f.file === j.file && !f.failed && !f.capped;
      });
    });
    var allRecords = logic.annotateDistance(logic.applyExclusions(logic.mergeSnapshot(fresh), profile), profile.home);
    var records = allRecords.filter(function (r) {
        return r.location_private === false && r.locId && !r.coordinatesMissing &&
          isFinite(r.lat) && isFinite(r.lon) && isFinite(r.distMi) && r.distMi <= profile.chaseMaxMi &&
          logic.taxonKind(r.name, r.sciName) !== 'hybrid';
      });
    var rare = {};
    allRecords.forEach(function (r) { if (r.kind === 'Rarity') rare[r.code] = true; });
    var options = { now: now, seen: {}, maxMi: profile.chaseMaxMi };
    var events = logic.needNearby(records, options).map(function (g) {
      return event('need', g.code, g.latestLocId || g.locId,
        g.name + ' - Celebrity', (g.latestLocName || g.locName || '') + ' - ' + g.knownParties + ' known reporting parties', g.latest);
    });
    if (complete) {
      logic.surgeEvents(allRecords, { now: now, seen: {}, excludeCodes: Object.keys(rare) })
        .filter(function (g) {
          return logic.taxonKind(g.name, '') !== 'hybrid' && records.some(function (r) {
            return r.code === g.code && r.locId === g.locId && logic.isPublicPlace(r.loc);
          });
        })
        .forEach(function (g) {
          events.push(event('surge', g.code, g.latestLocId || g.locId,
            g.name + ' - Crowd', (g.loc || '') + ' - a qualifying Bird Gen crowd',
            Number(logic.parseObsDt(g.latest))));
        });
    }
    return { events: events, complete: complete, sources: fresh.length, planned: wanted.jobs.length, errors: errors };
  }

  function transition(ledger, events, now, baseline) {
    if (!isFinite(now)) throw new Error('Notification deduplication needs a valid clock.');
    var seen = {}, added = [], unique = {};
    Object.keys(ledger || {}).forEach(function (id) {
      var at = Number(ledger[id]);
      if (isFinite(at) && at <= now && now - at < REPEAT_MS) seen[id] = at;
    });
    (events || []).slice(0, 500).forEach(function (e) {
      if (!e || typeof e.id !== 'string' || !e.id || unique[e.id]) return;
      unique[e.id] = true;
      if (!Object.prototype.hasOwnProperty.call(seen, e.id) && !baseline) added.push(e);
      seen[e.id] = now;
    });
    var ids = Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a] || a.localeCompare(b); });
    var bounded = {};
    ids.slice(0, 1000).forEach(function (id) { bounded[id] = seen[id]; });
    return { ledger: bounded, added: added };
  }

  function diagnosticTrace(input) {
    var result = { available: input !== undefined, entries: [], rejected: 0, truncated: false };
    if (input === undefined) return result;
    if (!Array.isArray(input)) { result.rejected = 1; return result; }
    var stages = ['schedule', 'launch', 'acquisition', 'qualification', 'publication', 'completion', 'lifecycle', 'storage'];
    var outcomes = ['started', 'submitted', 'accepted', 'completed', 'cancelled', 'expired', 'failed', 'skipped',
      'baseline', 'noEvents', 'permissionBlocked', 'notConfigured', 'notRegistered', 'busy', 'partial', 'ok'];
    var countKeys = ['sources', 'planned', 'events', 'accepted', 'failures', 'rows', 'httpStatus', 'earliestMs', 'retryUntilMs'];
    result.truncated = input.length > 64;
    input.slice(-64).forEach(function (row) {
      if (!row || typeof row !== 'object' || stages.indexOf(row.stage) < 0 || outcomes.indexOf(row.outcome) < 0
          || typeof row.at !== 'number' || !isFinite(row.at) || row.at <= 0
          || typeof row.attempt !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.attempt)
          || typeof row.background !== 'boolean' || !row.counts || typeof row.counts !== 'object'
          || Array.isArray(row.counts)) { result.rejected++; return; }
      var counts = {};
      countKeys.forEach(function (key) {
        var value = row.counts[key];
        if (value === undefined) return;
        if (typeof value !== 'number' || !isFinite(value) || value < 0 || Math.floor(value) !== value
            || value > 9007199254740991) { result.rejected++; return; }
        counts[key] = value;
      });
      result.entries.push({ at: row.at, attempt: row.attempt, stage: row.stage, outcome: row.outcome,
        background: row.background, counts: counts });
    });
    return result;
  }

  return { validateBuild: validateBuild, event: event, plan: plan, evaluate: evaluate,
    transition: transition, diagnosticTrace: diagnosticTrace };
}));
