(function (global) {
  'use strict';

  var MILESTONES = {
    report_first_content: 1,
    report_primary_ready: 1,
    report_enrichment_complete: 1
  };

  function text(value, fallback) {
    value = String(value == null ? '' : value).trim();
    return value || fallback || '';
  }

  function percentile(values, fraction) {
    values = values.filter(Number.isFinite).sort(function (a, b) { return a - b; });
    if (!values.length) return null;
    return values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
  }

  function median(values) {
    values = values.filter(Number.isFinite).sort(function (a, b) { return a - b; });
    if (!values.length) return null;
    var mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  }

  function create(options) {
    options = options || {};
    var emit = options.emit || function () {};
    var clock = options.clock || function () {
      return global.performance && typeof global.performance.now === 'function'
        ? global.performance.now() : Date.now();
    };
    var random = options.random || Math.random;
    var wallClock = options.wallClock || function () { return new Date().toISOString(); };
    var appVersion = text(options.appVersion);
    var active = {};

    function id() {
      return 'load_' + Date.now().toString(36) + '_'
        + Math.floor(random() * 0xFFFFFF).toString(36);
    }

    function event(name, load, attrs, category, outcome) {
      attrs = Object.assign({}, load.meta, attrs || {}, {
        load_id: load.id,
        app_version: appVersion,
        section_id: load.meta.section_id,
        section_label: load.meta.section_label,
        report: load.meta.report,
        load_reason: load.meta.load_reason,
        cache_mode: load.meta.cache_mode,
        device: load.meta.device,
        settings_revision: load.meta.settings_revision,
        load_started_at: load.meta.load_started_at,
        elapsed_ms: Math.max(0, Math.round(clock() - load.started))
      });
      return emit(name, {
        category: category || 'render',
        outcome: outcome || 'ok',
        tags: ['performance', category === 'network' ? 'network' : 'render'],
        operationId: load.id,
        attrs: attrs
      });
    }

    function start(meta) {
      meta = meta || {};
      var load = {
        id: id(),
        started: clock(),
        meta: {
          section_id: text(meta.sectionId, 'unknown'),
          section_label: text(meta.sectionLabel, text(meta.sectionId, 'Unknown')),
          report: text(meta.report, 'unknown'),
          load_reason: text(meta.reason, 'open'),
          cache_mode: text(meta.cacheMode, 'unknown'),
          device: text(meta.device, 'unknown'),
          settings_revision: Number(meta.settingsRevision) || 0,
          load_started_at: wallClock()
        },
        milestones: {},
        network: { live: 0, cached: 0, retries: 0, timeouts: 0 }
      };
      active[load.id] = load;
      event('report_load_start', load, {}, 'render', 'start');
      return load.id;
    }

    function mark(loadId, name, attrs) {
      var load = active[loadId];
      if (!load || !MILESTONES[name] || load.milestones[name]) return null;
      load.milestones[name] = Math.max(0, Math.round(clock() - load.started));
      return event(name, load, attrs, 'render', 'ok');
    }

    function network(loadId, attrs) {
      var load = active[loadId];
      if (!load) return null;
      attrs = attrs || {};
      if (attrs.cached) load.network.cached++;
      else load.network.live++;
      if (attrs.retry) load.network.retries++;
      if (attrs.timeout) load.network.timeouts++;
      return event('report_request_end', load, attrs, 'network',
        attrs.error ? 'error' : attrs.cached ? 'ok' : 'ok');
    }

    function finish(loadId, attrs) {
      var load = active[loadId];
      if (!load) return null;
      mark(loadId, 'report_enrichment_complete', attrs);
      var row = event('report_load_complete', load, Object.assign({}, attrs || {}, {
        live_requests: load.network.live,
        cached_requests: load.network.cached,
        retries: load.network.retries,
        timeouts: load.network.timeouts
      }), 'render', 'ok');
      delete active[loadId];
      return row;
    }

    function end(loadId, kind, attrs) {
      var load = active[loadId];
      if (!load) return null;
      var cancelled = kind === 'cancelled';
      var name = cancelled ? 'report_load_cancelled' : 'report_load_failed';
      var row = event(name, load, Object.assign({}, attrs || {}, {
        live_requests: load.network.live,
        cached_requests: load.network.cached,
        retries: load.network.retries,
        timeouts: load.network.timeouts
      }), cancelled ? 'render' : 'error', cancelled ? 'cancelled' : 'error');
      delete active[loadId];
      return row;
    }

    return {
      start: start,
      mark: mark,
      network: network,
      source: function (loadId, attrs) {
        var load = active[loadId];
        return load ? event('report_source_settled', load, attrs) : null;
      },
      finish: finish,
      cancel: function (loadId, attrs) { return end(loadId, 'cancelled', attrs); },
      fail: function (loadId, attrs) { return end(loadId, 'failed', attrs); },
      active: function (loadId) { return !!active[loadId]; }
    };
  }

  function analyze(events, options) {
    options = options || {};
    var loads = {};
    (events || []).forEach(function (row) {
      if (!/^report_/.test(String(row.event || ''))) return;
      var attrs = row.attrs || {};
      var id = attrs.load_id || row.operation_id;
      if (!id) return;
      var load = loads[id] || (loads[id] = {
        load_id: id,
        app_version: attrs.app_version || '',
        section_id: attrs.section_id || '',
        section_label: attrs.section_label || attrs.section_id || '',
        report: attrs.report || '',
        load_reason: attrs.load_reason || '',
        cache_mode: attrs.cache_mode || '',
        device: attrs.device || 'unknown',
        settings_revision: attrs.settings_revision == null
          ? (row.settings_rev || 0) : attrs.settings_revision,
        started_at: attrs.load_started_at || row.ts || '',
        first_content_ms: null,
        primary_ready_ms: null,
        enrichment_complete_ms: null,
        live_requests: 0,
        cached_requests: 0,
        queued_ms: 0,
        network_ms: 0,
        suspended_ms: 0,
        retries: 0,
        timeouts: 0,
        slowest_request_ms: 0,
        slowest_request: '',
        outcome: 'incomplete'
      });
      if (row.event === 'report_first_content') load.first_content_ms = attrs.elapsed_ms;
      if (row.event === 'report_primary_ready') load.primary_ready_ms = attrs.elapsed_ms;
      if (row.event === 'report_enrichment_complete') {
        load.enrichment_complete_ms = attrs.elapsed_ms;
      }
      if (row.event === 'report_request_end') {
        if (attrs.cached) load.cached_requests++;
        else load.live_requests++;
        load.queued_ms += Number(attrs.queued_ms) || 0;
        load.network_ms += Number(attrs.network_ms) || 0;
        load.suspended_ms += Number(attrs.suspended_ms) || 0;
        var requestMs = (Number(attrs.queued_ms) || 0)
          + (Number(attrs.network_ms) || 0);
        if (requestMs >= load.slowest_request_ms) {
          load.slowest_request_ms = requestMs;
          load.slowest_request = attrs.path_kind || attrs.host || 'request';
        }
        if (attrs.retry) load.retries++;
        if (attrs.timeout) load.timeouts++;
      }
      if (row.event === 'report_load_complete') load.outcome = 'ok';
      if (row.event === 'report_load_cancelled') load.outcome = 'cancelled';
      if (row.event === 'report_load_failed') load.outcome = 'failed';
    });
    var samples = Object.keys(loads).map(function (key) { return loads[key]; });
    samples.forEach(function (sample) {
      sample.active_primary_ms = sample.primary_ready_ms == null ? null
        : Math.max(0, sample.primary_ready_ms - sample.suspended_ms);
      sample.active_enrichment_ms = sample.enrichment_complete_ms == null ? null
        : Math.max(0, sample.enrichment_complete_ms - sample.suspended_ms);
    });
    if (options.sectionId) samples = samples.filter(function (sample) {
      return sample.section_id === options.sectionId;
    });
    if (options.report) samples = samples.filter(function (sample) {
      return sample.report === options.report;
    });
    if (options.loadReason) samples = samples.filter(function (sample) {
      return sample.load_reason === options.loadReason;
    });
    if (options.cacheMode) samples = samples.filter(function (sample) {
      return sample.cache_mode === options.cacheMode;
    });
    if (options.device) samples = samples.filter(function (sample) {
      return sample.device === options.device;
    });
    if (options.since) samples = samples.filter(function (sample) {
      return !sample.started_at || sample.started_at.slice(0, 10) >= options.since;
    });
    if (options.until) samples = samples.filter(function (sample) {
      return !sample.started_at || sample.started_at.slice(0, 10) <= options.until;
    });
    var groups = {};
    samples.forEach(function (sample) {
      var key = [sample.app_version, sample.section_id, sample.report,
        sample.load_reason, sample.cache_mode, sample.device].join('|');
      var group = groups[key] || (groups[key] = {
        app_version: sample.app_version,
        section_id: sample.section_id,
        section_label: sample.section_label,
        report: sample.report,
        load_reason: sample.load_reason,
        cache_mode: sample.cache_mode,
        device: sample.device,
        samples: []
      });
      group.samples.push(sample);
    });
    var rows = Object.keys(groups).map(function (key) {
      var group = groups[key], rows = group.samples;
      var totalRequests = rows.reduce(function (sum, row) {
        return sum + row.live_requests + row.cached_requests;
      }, 0);
      var cachedRequests = rows.reduce(function (sum, row) {
        return sum + row.cached_requests;
      }, 0);
      return {
        app_version: group.app_version,
        section_id: group.section_id,
        section_label: group.section_label,
        report: group.report,
        load_reason: group.load_reason,
        cache_mode: group.cache_mode,
        device: group.device,
        sample_count: rows.length,
        median_primary_ms: median(rows.map(function (row) { return row.primary_ready_ms; })),
        median_active_primary_ms: median(rows.map(function (row) {
          return row.active_primary_ms;
        })),
        p90_primary_ms: percentile(rows.map(function (row) { return row.primary_ready_ms; }), 0.90),
        p95_primary_ms: percentile(rows.map(function (row) { return row.primary_ready_ms; }), 0.95),
        max_primary_ms: Math.max.apply(null,
          rows.map(function (row) { return row.primary_ready_ms; }).filter(Number.isFinite)
            .concat([0])),
        median_enrichment_ms: median(rows.map(function (row) {
          return row.enrichment_complete_ms;
        })),
        max_enrichment_ms: Math.max.apply(null,
          rows.map(function (row) { return row.enrichment_complete_ms; })
            .filter(Number.isFinite).concat([0])),
        live_requests: rows.reduce(function (sum, row) {
          return sum + row.live_requests;
        }, 0),
        cache_hit_percent: totalRequests
          ? Math.round(cachedRequests / totalRequests * 1000) / 10 : null,
        failure_percent: Math.round(rows.filter(function (row) {
          return row.outcome === 'failed';
        }).length / rows.length * 1000) / 10,
        cancellation_percent: Math.round(rows.filter(function (row) {
          return row.outcome === 'cancelled';
        }).length / rows.length * 1000) / 10,
        verdict: 'Not enough samples',
        delta_ms: null,
        delta_percent: null
      };
    });
    var versions = rows.map(function (row) { return row.app_version; })
      .filter(Boolean).filter(function (value, index, all) {
        return all.indexOf(value) === index;
      }).sort(function (a, b) {
        return String(b).localeCompare(String(a), undefined, { numeric: true });
      });
    var currentVersion = options.currentVersion || versions[0] || '';
    var baselineVersion = options.baselineVersion
      || versions.filter(function (version) { return version !== currentVersion; })[0] || '';
    rows.forEach(function (row) {
      var prior = rows.filter(function (candidate) {
        return candidate.section_id === row.section_id
          && candidate.report === row.report
          && candidate.load_reason === row.load_reason
          && candidate.cache_mode === row.cache_mode
          && candidate.device === row.device
          && candidate.app_version === baselineVersion
          && candidate.median_primary_ms != null;
      })[0];
      if (row.app_version !== currentVersion || !prior
          || row.sample_count < 5 || prior.sample_count < 5
          || row.median_primary_ms == null || !(prior.median_primary_ms > 0)) return;
      row.delta_ms = Math.round(row.median_primary_ms - prior.median_primary_ms);
      row.delta_percent = Math.round(row.delta_ms / prior.median_primary_ms * 1000) / 10;
      if (row.delta_ms >= 500 && row.delta_percent >= 20) row.verdict = 'Slower';
      else if (row.delta_ms <= -500 && row.delta_percent <= -20) row.verdict = 'Faster';
      else row.verdict = 'Stable';
    });
    rows.sort(function (a, b) {
      return (b.median_primary_ms || 0) - (a.median_primary_ms || 0)
        || a.section_label.localeCompare(b.section_label);
    });
    return {
      samples: samples,
      rows: rows,
      current_version: currentVersion,
      baseline_version: baselineVersion,
      versions: versions
    };
  }

  function csv(report) {
    var columns = [
      'app_version', 'section_label', 'report', 'load_reason', 'cache_mode', 'device',
      'sample_count', 'median_primary_ms', 'median_active_primary_ms',
      'p90_primary_ms', 'p95_primary_ms', 'max_primary_ms',
      'median_enrichment_ms', 'max_enrichment_ms', 'live_requests', 'cache_hit_percent',
      'failure_percent', 'cancellation_percent', 'verdict',
      'delta_ms', 'delta_percent'
    ];
    function cell(value) {
      value = value == null ? '' : String(value);
      return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
    }
    return [columns.join(',')].concat(report.rows.map(function (row) {
      return columns.map(function (column) { return cell(row[column]); }).join(',');
    })).join('\n') + '\n';
  }

  function html(report) {
    function esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"]/g, function (ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
      });
    }
    var rows = report.rows.map(function (row) {
      return '<tr><td>' + esc(row.section_label) + '</td><td>' + row.sample_count
        + '</td><td>' + esc(row.median_primary_ms) + '</td><td>'
        + [row.p90_primary_ms, row.p95_primary_ms, row.max_primary_ms]
          .map(esc).join(' / ') + '</td><td>'
        + [row.median_enrichment_ms, row.max_enrichment_ms].map(esc).join(' / ')
        + '</td><td>' + row.live_requests + '</td><td>'
        + esc(row.cache_hit_percent == null ? '' : row.cache_hit_percent + '%')
        + '</td><td><b>' + esc(row.verdict) + '</b></td></tr>';
    }).join('');
    return '<!doctype html><meta charset="utf-8"><title>Bird Chaser performance</title>'
      + '<style>body{font:16px system-ui;margin:24px;color:#16211b}'
      + 'table{border-collapse:collapse;width:100%}th,td{border:1px solid #777;'
      + 'padding:7px;text-align:left}th{background:#eaf7ff}</style>'
      + '<h1>Bird Chaser performance report</h1>'
      + '<p>Verdicts are printed directly; colour is not required.</p>'
      + '<p>Current version: <b>' + esc(report.current_version)
      + '</b> · baseline: <b>' + esc(report.baseline_version || 'none') + '</b>.</p>'
      + '<table><thead><tr><th>Report</th><th>Samples</th><th>Median primary ms</th>'
      + '<th>p90 / p95 / max primary ms</th><th>Median / max full ms</th><th>Live calls</th>'
      + '<th>Cache hit</th><th>Comparison</th></tr></thead><tbody>'
      + rows + '</tbody></table>';
  }

  function files(events, options) {
    var report = analyze(events, options);
    return {
      'performance-report.csv': csv(report),
      'performance-report.html': html(report),
      'performance-loads.jsonl': report.samples.map(function (row) {
        return JSON.stringify(row);
      }).join('\n') + (report.samples.length ? '\n' : '')
    };
  }

  var API = {
    create: create,
    analyze: analyze,
    csv: csv,
    html: html,
    files: files,
    median: median,
    percentile: percentile
  };
  global.BirdPerformance = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
}(typeof window !== 'undefined' ? window : globalThis));
