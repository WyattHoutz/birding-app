(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SetupPrefetch = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  var readyStates = ['ready', 'cached', 'empty', 'notApplicable'];
  function create(tasks, current, changed) {
    var states = {}, values = {}, pending = {}, epoch = 0;
    Object.keys(tasks).forEach(function (key) { states[key] = { state: 'queued' }; });
    function publish(key, result) {
      if (!current()) return;
      states[key] = result;
      if (changed) changed();
    }
    function start(key, retry) {
      if (!current()) return Promise.resolve({ state: 'cancelled' });
      if (pending[key]) return pending[key];
      if (readyStates.indexOf(states[key].state) >= 0) return Promise.resolve(states[key]);
      if (!retry && states[key].state !== 'queued') return Promise.resolve(states[key]);
      var version = epoch;
      var task = tasks[key];
      var retrySource = retry && ['failed', 'partial', 'cancelled'].indexOf(states[key].state) >= 0;
      pending[key] = Promise.all((task.depends || []).map(function (dependency) {
        return start(dependency, retry);
      })).then(function (dependencies) {
        if (!current() || version !== epoch) return { state: 'cancelled' };
        if (dependencies.some(function (result) { return readyStates.indexOf(result.state) < 0; })) {
          return { state: 'blocked', detail: 'Waiting for required data' };
        }
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
        return Promise.all(Object.keys(tasks).map(function (key) { return start(key, !!retry); }));
      },
      promote: function promote(key) {
        if (!tasks[key]) return Promise.resolve();
        (tasks[key].depends || []).forEach(promote);
        if (tasks[key].promote) tasks[key].promote();
        return start(key, false);
      },
      complete: function () {
        return current() && Object.keys(states).every(function (key) {
          return readyStates.indexOf(states[key].state) >= 0;
        });
      },
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
      cancel: function () { epoch++; }
    };
  }
  return { create: create, readyStates: readyStates };
});
