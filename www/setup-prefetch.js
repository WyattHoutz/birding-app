(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SetupPrefetch = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  var readyStates = ['ready', 'cached', 'empty', 'notApplicable'];
  function create(tasks, current, changed, trace, options) {
    options = options || {};
    var hasMonotonicClock = typeof performance === 'object' && typeof performance.now === 'function';
    var clock = options.clock || (hasMonotonicClock ? function () { return performance.now(); } : Date.now);
    var clockName = options.clock ? 'controlled-monotonic' : hasMonotonicClock ? 'performance.now' : 'Date.now-fallback';
    var wallClock = options.wallClock || Date.now, origin = clock(), lastElapsed = 0;
    var states = {}, values = {}, pending = {}, attempts = {}, started = {}, epoch = 0;
    var timing = {}, latestTiming = {}, journal = [], scheduledAttempts = {}, pass = 0;
    var groups = (options.groups || []).map(function (group) { return [group[0], group[1].slice()]; });
    var initialPromise = null;
    Object.keys(tasks).forEach(function (key) { states[key] = { state: 'queued' }; });
    function report(event, key, fields) {
      if (!trace) return;
      try {
        trace(Object.assign({ event: event, source: key || '', attempt: attempts[key] || 0 }, fields));
      } catch (error) { /* diagnostics must not change acquisition */ }
    }
    function elapsed() {
      lastElapsed = Math.max(lastElapsed, clock() - origin);
      return lastElapsed;
    }
    function record(row) {
      row.clock = clockName;
      row.sleep_attribution = 'unclassified';
      journal.push(row);
      if (journal.length > 128) journal.shift();
      report('timing', row.source, row);
    }
    function finishTiming(key, state) {
      var row = timing[key];
      if (!row) return;
      delete timing[key];
      row.ended_at_ms = elapsed();
      row.wall_ended_at_ms = wallClock();
      row.state = ['ready', 'cached', 'empty', 'notApplicable', 'failed', 'partial', 'blocked', 'cancelled'].indexOf(state) >= 0
        ? state : 'failed';
      row.elapsed_ms = Math.max(0, row.ended_at_ms - row.queued_at_ms);
      row.dependency_wait_ms = Math.max(0, (row.acquisition_started_at_ms == null
        ? row.ended_at_ms : row.acquisition_started_at_ms) - row.queued_at_ms);
      row.acquisition_ms = row.acquisition_started_at_ms == null ? 0
        : Math.max(0, row.ended_at_ms - row.acquisition_started_at_ms);
      row.verified_prior = !!(states[key] && states[key].verifiedPrior === true
        && readyStates.indexOf(state) >= 0);
      row.reuse = state === 'cached' ? 'durable-cache'
        : row.verified_prior ? 'verified-prior-work' : 'not-established';
      latestTiming[key] = row;
      record(row);
    }
    function groupState(keys) {
      var results = keys.map(function (key) { return states[key]; });
      if (results.every(function (result) { return readyStates.indexOf(result.state) >= 0; })) {
        return results.every(function (result) { return result.state === 'notApplicable'; })
          ? 'notApplicable' : 'ready';
      }
      for (var state of ['loading', 'queued']) {
        if (results.some(function (result) { return result.state === state; })) return state;
      }
      if (results.some(function (result) {
        return readyStates.indexOf(result.state) >= 0 || result.state === 'partial';
      })) return 'partial';
      for (var state of ['failed', 'cancelled', 'blocked']) {
        if (results.some(function (result) { return result.state === state; })) return state;
      }
      return 'failed';
    }
    function recordGroups(budget, final) {
      groups.forEach(function (group) {
        var terminal = null;
        var end = group[1].reduce(function (latest, key) {
          var row = latestTiming[key];
          if (row && row.ended_at_ms >= latest) {
            terminal = row;
            return row.ended_at_ms;
          }
          return latest;
        }, budget.started);
        record({ type: 'group', source: group[0], pass: budget.pass,
          phase: final ? 'initial-final' : budget.phase,
          queued_at_ms: budget.started, ended_at_ms: end,
          wall_queued_at_ms: budget.wall_started,
          wall_ended_at_ms: terminal ? terminal.wall_ended_at_ms : budget.wall_started,
          elapsed_ms: Math.max(0, end - budget.started),
          state: current() && budget.epoch === epoch ? groupState(group[1]) : 'cancelled' });
      });
      var passEnd = elapsed();
      record({ type: 'pass', source: '', pass: budget.pass,
        phase: final ? 'initial-final' : budget.phase,
        queued_at_ms: budget.started, ended_at_ms: passEnd,
        wall_queued_at_ms: budget.wall_started, wall_ended_at_ms: wallClock(),
        elapsed_ms: Math.max(0, passEnd - budget.started),
        state: !current() || budget.epoch !== epoch ? 'cancelled' : complete() ? 'ready' : 'partial' });
    }
    function beginPass(retry) {
      return { pass: ++pass, epoch: epoch, started: elapsed(), wall_started: wallClock(),
        phase: retry ? 'recovery' : pass === 1 ? 'first-pass' : 'follow-up' };
    }
    function complete() {
      return current() && Object.keys(states).every(function (key) {
        return readyStates.indexOf(states[key].state) >= 0;
      });
    }
    function settled() {
      return current() && Object.keys(states).every(function (key) {
        return ['queued', 'loading'].indexOf(states[key].state) < 0;
      });
    }
    function publish(key, result) {
      if (!current()) return;
      states[key] = result;
      report('state', key, { state: result.state,
        acquisitionMs: started[key] == null ? 0 : Math.max(0, elapsed() - started[key]) });
      if (result.state !== 'loading') finishTiming(key, result.state);
      if (changed) changed();
    }
    function start(key, retry) {
      if (!current()) return Promise.resolve({ state: 'cancelled' });
      if (pending[key]) {
        if (timing[key]) timing[key].joins++;
        report('join', key, { state: states[key].state });
        return pending[key];
      }
      if (readyStates.indexOf(states[key].state) >= 0) {
        report('reuse', key, { state: states[key].state });
        record({ type: 'reuse', source: key, pass: pass, state: states[key].state,
          reuse: 'within-run', elapsed_ms: 0, at_ms: elapsed() });
        return Promise.resolve(states[key]);
      }
      if (!retry && states[key].state !== 'queued') return Promise.resolve(states[key]);
      var version = epoch;
      var task = tasks[key];
      var retrySource = retry && ['failed', 'partial', 'cancelled'].indexOf(states[key].state) >= 0;
      delete started[key];
      scheduledAttempts[key] = (scheduledAttempts[key] || 0) + 1;
      timing[key] = { type: 'task', source: key, pass: pass, attempt: scheduledAttempts[key],
        retry: !!retrySource, queued_at_ms: elapsed(), wall_queued_at_ms: wallClock(),
        acquisition_started_at_ms: null, joins: 0 };
      pending[key] = Promise.all((task.depends || []).map(function (dependency) {
        return start(dependency, retry);
      })).then(function (dependencies) {
        if (!current() || version !== epoch) {
          finishTiming(key, 'cancelled');
          return { state: 'cancelled' };
        }
        if (dependencies.some(function (result) { return readyStates.indexOf(result.state) < 0; })) {
          report('blocked', key, { dependencies: (task.depends || []).filter(function (dependency, index) {
            return readyStates.indexOf(dependencies[index].state) < 0;
          }) });
          return { state: 'blocked', detail: 'Waiting for required data' };
        }
        attempts[key] = (attempts[key] || 0) + 1;
        started[key] = elapsed();
        timing[key].acquisition_started_at_ms = started[key];
        timing[key].wall_acquisition_started_at_ms = wallClock();
        timing[key].acquisition_attempt = attempts[key];
        report('acquire-start', key, { retry: !!retrySource });
        publish(key, { state: 'loading' });
        return task.acquire(retrySource, values);
      }).then(function (result) {
        if (!current() || version !== epoch) {
          finishTiming(key, 'cancelled');
          return { state: 'cancelled' };
        }
        if (!result || readyStates.indexOf(result.state) < 0) {
          result = result && result.state ? result : { state: 'failed', detail: 'Data could not be verified' };
        } else {
          values[key] = result.value;
        }
        publish(key, result);
        return result;
      }).catch(function (error) {
        if (!current() || version !== epoch) {
          finishTiming(key, 'cancelled');
          report('obsolete', key);
          return { state: 'cancelled' };
        }
        var result = { state: error && error.queueCancelled ? 'cancelled' : 'failed',
          detail: error && error.message || 'Data could not be verified' };
        publish(key, result);
        return result;
      }).finally(function () { delete pending[key]; });
      return pending[key];
    }
    return {
      states: states,
      run: function (retry) {
        var version = epoch;
        var budget = beginPass(!!retry);
        report('run-start', '', { retry: !!retry });
        return Promise.all(Object.keys(tasks).map(function (key) { return start(key, !!retry); }))
          .then(function (results) {
            recordGroups(budget, false);
            if (current() && version === epoch) report('run-settled', '', {
              complete: complete(), settled: settled(),
              unavailable: Object.keys(states).filter(function (key) {
                return readyStates.indexOf(states[key].state) < 0;
              })
            });
            return results;
          });
      },
      initial: function () {
        if (initialPromise) return initialPromise;
        var version = epoch, engine = this;
        var initialBudget = { pass: 0, epoch: epoch, started: elapsed(), wall_started: wallClock(), phase: 'initial' };
        report('initial-budget', '', { recoveryPasses: 1 });
        initialPromise = engine.run(false).then(function (results) {
          if (!current() || version !== epoch) {
            recordGroups(initialBudget, true);
            return results;
          }
          function recoverable(key) {
            var state = states[key].state;
            return readyStates.indexOf(state) >= 0 || state === 'failed'
              || state === 'blocked' && (tasks[key].depends || []).every(recoverable);
          }
          var selected = Object.keys(states).filter(function (key) {
            return states[key].state === 'failed'
              || states[key].state === 'blocked' && recoverable(key);
          });
          report('automatic-retry-selected', '', { sources: selected,
            recoveryPasses: 1, remainingPasses: selected.length ? 0 : 1 });
          var recovery = selected.length ? beginPass(true) : null;
          return Promise.all(selected.map(function (key) { return start(key, true); }))
            .then(function () {
              if (recovery) recordGroups(recovery, false);
              recordGroups(initialBudget, true);
              if (current() && version === epoch) report('initial-settled', '', {
                complete: complete(), settled: settled(), remainingPasses: selected.length ? 0 : 1,
                unavailable: Object.keys(states).filter(function (key) {
                  return readyStates.indexOf(states[key].state) < 0;
                })
              });
              return Object.keys(states).map(function (key) { return states[key]; });
            });
        });
        return initialPromise;
      },
      promote: function promote(key) {
        if (!tasks[key]) return Promise.resolve();
        (tasks[key].depends || []).forEach(promote);
        if (tasks[key].promote) tasks[key].promote();
        return start(key, false);
      },
      complete: complete,
      settled: settled,
      group: groupState,
      timings: function () {
        return journal.map(function (row) { return Object.assign({}, row); });
      },
      cancel: function () {
        epoch++;
        Object.keys(timing).forEach(function (key) { finishTiming(key, 'cancelled'); });
        report('cancel', '');
      }
    };
  }
  return { create: create, readyStates: readyStates };
});
