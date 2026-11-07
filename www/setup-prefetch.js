(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SetupPrefetch = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  var readyStates = ['ready', 'cached', 'empty', 'notApplicable'];
  function create(tasks, current, changed, trace) {
    var states = {}, values = {}, pending = {}, attempts = {}, started = {}, epoch = 0;
    var initialPromise = null;
    Object.keys(tasks).forEach(function (key) { states[key] = { state: 'queued' }; });
    function report(event, key, fields) {
      if (!trace) return;
      try {
        trace(Object.assign({ event: event, source: key || '', attempt: attempts[key] || 0 }, fields));
      } catch (error) { /* diagnostics must not change acquisition */ }
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
        acquisitionMs: started[key] ? Date.now() - started[key] : 0 });
      if (changed) changed();
    }
    function start(key, retry) {
      if (!current()) return Promise.resolve({ state: 'cancelled' });
      if (pending[key]) {
        report('join', key, { state: states[key].state });
        return pending[key];
      }
      if (readyStates.indexOf(states[key].state) >= 0) {
        report('reuse', key, { state: states[key].state });
        return Promise.resolve(states[key]);
      }
      if (!retry && states[key].state !== 'queued') return Promise.resolve(states[key]);
      var version = epoch;
      var task = tasks[key];
      var retrySource = retry && ['failed', 'partial', 'cancelled'].indexOf(states[key].state) >= 0;
      pending[key] = Promise.all((task.depends || []).map(function (dependency) {
        return start(dependency, retry);
      })).then(function (dependencies) {
        if (!current() || version !== epoch) return { state: 'cancelled' };
        if (dependencies.some(function (result) { return readyStates.indexOf(result.state) < 0; })) {
          report('blocked', key, { dependencies: (task.depends || []).filter(function (dependency, index) {
            return readyStates.indexOf(dependencies[index].state) < 0;
          }) });
          return { state: 'blocked', detail: 'Waiting for required data' };
        }
        attempts[key] = (attempts[key] || 0) + 1;
        started[key] = Date.now();
        report('acquire-start', key, { retry: !!retrySource });
        publish(key, { state: 'loading' });
        return task.acquire(retrySource, values);
      }).then(function (result) {
        if (!current() || version !== epoch) return { state: 'cancelled' };
        if (!result || readyStates.indexOf(result.state) < 0) {
          result = result && result.state ? result : { state: 'failed', detail: 'Data could not be verified' };
        } else {
          values[key] = result.value;
        }
        publish(key, result);
        return result;
      }).catch(function (error) {
        if (!current() || version !== epoch) {
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
        report('run-start', '', { retry: !!retry });
        return Promise.all(Object.keys(tasks).map(function (key) { return start(key, !!retry); }))
          .then(function (results) {
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
        report('initial-budget', '', { recoveryPasses: 1 });
        initialPromise = engine.run(false).then(function (results) {
          if (!current() || version !== epoch) return results;
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
          return Promise.all(selected.map(function (key) { return start(key, true); }))
            .then(function () {
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
      group: function (keys) {
        var results = keys.map(function (key) { return states[key]; });
        if (results.every(function (result) { return readyStates.indexOf(result.state) >= 0; })) {
          return results.every(function (result) { return result.state === 'notApplicable'; })
            ? 'notApplicable' : 'ready';
        }
        for (var state of ['failed', 'partial', 'cancelled', 'blocked', 'loading', 'queued']) {
          if (results.some(function (result) { return result.state === state; })) return state;
        }
        return 'failed';
      },
      cancel: function () { epoch++; report('cancel', ''); }
    };
  }
  return { create: create, readyStates: readyStates };
});
