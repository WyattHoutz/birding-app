(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'));
  else root.BirdGenTwitches = factory(root.BirdLogic);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (logic) {
  'use strict';
  var DAY_MS = 24 * 60 * 60 * 1000;

  function validJournal(value) {
    return !!value && value.version === 1 && typeof value.footprint === 'string'
      && Array.isArray(value.known) && value.known.every(function (code) {
        return typeof code === 'string' && /^[a-z0-9]+$/.test(code);
      }) && value.episodes && typeof value.episodes === 'object'
      && !Array.isArray(value.episodes) && Object.keys(value.episodes).every(function (code) {
        var episode = value.episodes[code];
        return /^[a-z0-9]+$/.test(code) && episode
          && Number.isFinite(episode.firstAt) && episode.firstAt > 0
          && typeof episode.when === 'string' && !!logic.parseObsDt(episode.when)
          && typeof episode.locId === 'string'
          && (episode.recovered === undefined || typeof episode.recovered === 'boolean')
          && Number.isFinite(episode.lat) && Number.isFinite(episode.lon);
      });
  }

  function evaluate(previous, records, options) {
    options = options || {};
    var now = options.now, today = options.today;
    if (!Number.isFinite(now) || !/^\d{4}-\d\d-\d\d$/.test(today)
        || typeof options.membership !== 'function') {
      throw new Error('TWITCH evaluation requires a clock, calendar day and explicit personal membership.');
    }
    var home = options.home, radius = options.radius;
    var hasOrigin = home && Number.isFinite(home.lat) && Number.isFinite(home.lng)
      && Math.abs(home.lat) <= 90 && Math.abs(home.lng) <= 180
      && Number.isFinite(radius) && radius > 0;
    var footprint = JSON.stringify(hasOrigin ? [home.lat, home.lng, radius] : []);
    var valid = validJournal(previous), baseline = !valid || previous.footprint !== footprint;
    var known = Object.create(null), episodes = Object.create(null);
    if (valid) {
      previous.known.forEach(function (code) { known[code] = true; });
      Object.keys(previous.episodes).forEach(function (code) {
        episodes[code] = Object.assign({}, previous.episodes[code]);
      });
    }
    var rare = Object.create(null);
    (records || []).forEach(function (row) {
      if (row && row.kind === 'Rarity' && /^[a-z0-9]+$/.test(row.code || '')) rare[row.code] = true;
    });
    var byCode = Object.create(null);
    (records || []).forEach(function (row) {
      if (!hasOrigin || !row || !rare[row.code] || row.coordinatesMissing
          || row.obsReviewed === true && row.obsValid === false
          || row.reviewed === true && row.valid === false
          || !Number.isFinite(row.lat) || !Number.isFinite(row.lon)
          || Math.abs(row.lat) > 90 || Math.abs(row.lon) > 180
          || logic.taxonKind(row.name, row.exoticCategory) !== 'species') return;
      var when = logic.parseObsDt(row.dateStr), time = when && when.getTime();
      if (!time || time > now) return;
      var distance = logic.haversineMi(home.lat, home.lng, row.lat, row.lon);
      if (distance > radius) return;
      (byCode[row.code] || (byCode[row.code] = [])).push(row);
    });
    var canAdvance = options.complete === true && options.acquired === true;
    var diagnostics = { usableSpecies: Object.keys(byCode).length, knownNeverAlerted: 0,
      seen: 0, unknown: 0, watch: 0, earlierDay: 0, outside24h: 0, alreadyAlerted: 0, recovered: 0 };
    var added = [];
    Object.keys(byCode).sort().forEach(function (code) {
      var rows = byCode[code];
      var wasKnown = !!known[code], watched = !!(options.watch && options.watch[code]);
      var membership = options.membership(code, rows[0].name);
      var earlierDay = rows.some(function (row) { return row.dateStr.slice(0, 10) !== today; });
      var freshRows = rows.filter(function (row) {
        return now - logic.parseObsDt(row.dateStr).getTime() <= DAY_MS;
      });
      var recovery = options.recoverNeverAlerted === true && (wasKnown || earlierDay);
      if (wasKnown && !episodes[code]) diagnostics.knownNeverAlerted++;
      if (episodes[code]) diagnostics.alreadyAlerted++;
      if (watched) diagnostics.watch++;
      if (membership === true) diagnostics.seen++;
      else if (membership !== false) diagnostics.unknown++;
      if (earlierDay) diagnostics.earlierDay++;
      if (!freshRows.length) diagnostics.outside24h++;
      if (!canAdvance) return;
      var isNew = !baseline && !episodes[code]
        && (!wasKnown || recovery);
      known[code] = true;
      if (!isNew || watched || membership !== false
          || (recovery ? !freshRows.length : earlierDay)) return;
      var latest = (recovery ? freshRows : rows).slice().sort(function (a, b) {
        return b.dateStr.localeCompare(a.dateStr)
          || String(a.locId || '').localeCompare(String(b.locId || ''));
      })[0];
      episodes[code] = {
        firstAt: now, when: latest.dateStr, locId: String(latest.locId || ''),
        lat: latest.lat, lon: latest.lon, recovered: recovery
      };
      if (recovery) diagnostics.recovered++;
      added.push(code);
    });
    var alerts = [];
    if (!baseline) Object.keys(episodes).forEach(function (code) {
      var episode = episodes[code], rows = byCode[code] || [];
      if (episode.firstAt > now || now - episode.firstAt > DAY_MS
          || options.watch && options.watch[code]
          || !rows.length || options.membership(code, rows[0].name) !== false) return;
      var clustered = logic.needClusters(rows.concat([{
        code: code, locId: episode.locId, lat: episode.lat, lon: episode.lon, twitchAnchor: true
      }])).find(function (group) {
        return group.rows.some(function (row) { return row.twitchAnchor; });
      });
      var recent = (clustered ? clustered.rows : []).filter(function (row) {
        if (row.twitchAnchor) return false;
        var time = logic.parseObsDt(row.dateStr).getTime();
        return now - time <= DAY_MS;
      });
      if (!recent.length) return;
      var latest = recent.slice().sort(function (a, b) {
        return b.dateStr.localeCompare(a.dateStr);
      })[0];
      alerts.push({
        code: code, name: latest.name, firstAt: episode.firstAt,
        recovered: episode.recovered === true,
        when: episode.when, latest: latest,
        reports: logic.chaseConfidence(recent.map(function (row) {
          return Object.assign({}, row, { locId: episode.locId || 'twitch-locality' });
        }), { nowMs: now }).events,
        lowerBound: options.exhaustive !== true || !options.complete,
        unreviewed: recent.some(function (row) {
          return row.reviewState === 'pending' || row.obsReviewed === false
            || row.reviewed === false || row.obsValid === false;
        })
      });
    });
    alerts.sort(function (a, b) { return b.firstAt - a.firstAt || a.code.localeCompare(b.code); });
    return {
      journal: canAdvance ? { version: 1, footprint: footprint, known: Object.keys(known).sort(), episodes: episodes }
        : valid ? previous : null,
      alerts: alerts, added: added, diagnostics: diagnostics,
      status: baseline ? canAdvance ? 'baseline' : 'baseline-pending' : 'tracking'
    };
  }

  return { evaluate: evaluate, validJournal: validJournal, DAY_MS: DAY_MS };
}));
