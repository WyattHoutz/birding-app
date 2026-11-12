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
  function createResources(providers, manifests, scope, options) {
    options = options || {};
    var registry = new Map(), consumers = new Map(), nodes = new Map(), queued = new Set();
    var sequence = 0, consumerSequence = 0, admissionSequence = 0, cancelled = false, draining = false;
    var now = options.now || Date.now;
    var clock = options.clock || (typeof performance === 'object'
      ? function () { return performance.now(); } : Date.now);
    var origin = clock();
    var priorities = ['current', 'reference', 'optional'];
    function immutable(value) {
      if (value == null || typeof value === 'string' || typeof value === 'boolean'
          || typeof value === 'number' && isFinite(value)) return value;
      if (Array.isArray(value)) return Object.freeze(value.map(immutable));
      if (typeof value !== 'object' || Object.prototype.toString.call(value) !== '[object Object]') {
        throw new Error('Resource data must be plain immutable data');
      }
      var copy = Object.create(null);
      Object.keys(value).forEach(function (key) { copy[key] = immutable(value[key]); });
      return Object.freeze(copy);
    }
    scope = immutable(scope);
    function live() {
      try { return !cancelled && (!options.current || options.current()); }
      catch (error) { return false; }
    }
    function owned(node) {
      return live() && !node.controller.signal.aborted
        && Array.from(node.owners.keys()).some(function (consumer) { return !consumer.cancelled; });
    }
    function report(event, node, consumer, state) {
      if (!options.trace) return;
      try {
        options.trace({ event: event, node: node ? node.number : 0,
          consumer: consumer ? consumer.number : 0, state: state || '',
          elapsed_ms: Math.max(0, clock() - origin) });
      } catch (error) { /* diagnostics cannot change acquisition */ }
    }
    providers.forEach(function (provider) {
      if (!provider || typeof provider.id !== 'string' || !provider.id
          || registry.has(provider.id) || !Number.isInteger(provider.revision) || provider.revision < 1
          || ['validate', 'identity', 'depends', 'read', 'acquire', 'verify'].some(function (name) {
            return typeof provider[name] !== 'function';
          })) throw new Error('Invalid or duplicate resource provider');
      registry.set(provider.id, Object.freeze(Object.assign({}, provider)));
    });
    function verified(node, evidence) {
      try {
        return !!evidence && readyStates.indexOf(evidence.state) >= 0
          && node.provider.verify(evidence, node.params, scope, now()) === true
          && Array.from(node.dependencies.values()).every(function (child) {
            return verified(child, child.evidence);
          });
      } catch (error) { return false; }
    }
    function reach(node, target, visited) {
      if (node === target) return true;
      if (visited.has(node)) return false;
      visited.add(node);
      return Array.from(node.dependencies.values()).some(function (child) {
        return reach(child, target, visited);
      });
    }
    function edge(parent, name, child) {
      if (reach(child, parent, new Set())) throw new Error('Resource dependency cycle');
      parent.dependencies.set(name, child);
      child.parents.add(parent);
    }
    function plan(ref, mode, generation, ancestors) {
      var provider = ref && registry.get(ref.provider);
      if (!provider) throw new Error('Unknown resource provider');
      var params = immutable(ref.params);
      if (!provider.validate(params)) throw new Error('Invalid resource parameters');
      var identity = provider.identity(params, scope);
      if (typeof identity !== 'string' || !identity) throw new Error('Invalid resource identity');
      var key = JSON.stringify([provider.id, provider.revision, identity,
        mode === 'fullRefresh' ? generation : null]);
      if (ancestors.has(key)) throw new Error('Resource dependency cycle');
      var existing = nodes.get(key);
      if (existing && !existing.controller.signal.aborted
          && (!existing.settled || verified(existing, existing.evidence))) {
        report(existing.settled ? 'reuse' : 'join', existing);
        return existing;
      }
      var resolve;
      var node = { number: ++sequence, provider: provider, params: params, mode: mode,
        generation: generation, normalKey: JSON.stringify([provider.id, provider.revision, identity, null]),
        dependencies: new Map(), parents: new Set(), owners: new Map(),
        controller: new AbortController(), promise: new Promise(function (done) { resolve = done; }),
        resolve: null, settled: false, activated: false, started: false, evidence: null };
      node.resolve = resolve;
      nodes.set(key, node);
      var path = new Set(ancestors); path.add(key);
      try {
        var dependencies = provider.depends(params, scope);
        Object.keys(dependencies).forEach(function (name) {
          edge(node, name, plan(dependencies[name], mode, generation, path));
        });
      } catch (error) {
        nodes.delete(key);
        node.dependencies.forEach(function (child) { child.parents.delete(node); });
        throw error;
      }
      return node;
    }
    function lease(node, consumer, priority) {
      var previous = node.owners.get(consumer);
      if (previous != null && previous <= priority) return;
      node.owners.set(consumer, priority);
      node.dependencies.forEach(function (child) { lease(child, consumer, priority); });
    }
    function finish(node, evidence) {
      if (node.settled) return;
      queued.delete(node);
      if (evidence && readyStates.indexOf(evidence.state) >= 0
          && Array.from(node.dependencies.values()).some(function (child) {
            return !verified(child, child.evidence);
          })) evidence = { state: 'blocked' };
      try { evidence = immutable(owned(node) ? evidence : { state: 'cancelled' }); }
      catch (error) { evidence = Object.freeze({ state: 'failed' }); }
      node.settled = true;
      node.evidence = evidence;
      if (node.mode === 'fullRefresh' && verified(node, evidence)) {
        nodes.set(node.normalKey, node);
      }
      report('settled', node, null, node.evidence.state);
      node.resolve(node.evidence);
    }
    function runtime(node) {
      var context = { scope: scope, signal: node.controller.signal, mode: node.mode,
        generation: node.generation, current: function () { return owned(node); } };
      context.work = options.work ? options.work(context) : { current: context.current };
      node.runtime = context;
      promoteWork(node);
      return context;
    }
    function promoteWork(node) {
      if (!node.runtime || !owned(node) || demand(node)[0] !== 0 || !options.promote) return;
      try { options.promote(node.runtime.work); }
      catch (error) { /* promotion cannot strand existing shared work */ }
    }
    function inputs(dependencies) {
      var result = Object.create(null);
      dependencies.forEach(function (node, name) {
        if (node.settled) result[name] = node.evidence;
      });
      return Object.freeze(result);
    }
    function rank(node, depths) {
      if (depths.has(node)) return depths.get(node);
      var depth = 0;
      node.parents.forEach(function (parent) {
        if (!parent.settled && owned(parent)) depth = Math.max(depth, 1 + rank(parent, depths));
      });
      depths.set(node, depth);
      return depth;
    }
    function demand(node) {
      var result = [1, priorities.length];
      node.owners.forEach(function (priority, consumer) {
        if (consumer.cancelled) return;
        var foreground = consumer.foreground ? 0 : 1;
        if (foreground < result[0] || foreground === result[0] && priority < result[1]) {
          result = [foreground, priority];
        }
      });
      return result;
    }
    function drain() {
      if (draining) return;
      draining = true;
      Promise.resolve().then(function () {
        draining = false;
        var depths = new Map();
        Array.from(queued).sort(function (a, b) {
          var ar = demand(a), br = demand(b);
          return ar[0] - br[0] || ar[1] - br[1]
            || rank(b, depths) - rank(a, depths) || a.admission - b.admission;
        }).forEach(function (node) {
          queued.delete(node);
          if (!owned(node)) { finish(node, { state: 'cancelled' }); return; }
          node.started = true;
          var context;
          report('read', node);
          Promise.resolve().then(function () {
            context = runtime(node);
            return node.provider.read(node.params, context);
          }).then(function (saved) {
            if (!owned(node)) return { state: 'cancelled' };
            if (verified(node, saved)) { report('cache', node); return saved; }
            report('acquire', node);
            context.require = function (ref, priority) {
              if (!owned(node)) return Promise.resolve({ state: 'cancelled' });
              if (priorities.indexOf(priority) < 0) return Promise.reject(new Error('Invalid resource priority'));
              var child = plan(ref, node.mode, node.generation, new Set());
              edge(node, 'dynamic:' + child.number, child);
              node.owners.forEach(function (inherited, consumer) {
                lease(child, consumer, Math.min(inherited, priorities.indexOf(priority)));
              });
              activate(child);
              return child.promise;
            };
            return node.provider.acquire(node.params, inputs(node.dependencies), context);
          }).then(function (evidence) {
            if (evidence && readyStates.indexOf(evidence.state) >= 0 && !verified(node, evidence)) {
              evidence = { state: 'failed', detail: 'Resource evidence could not be verified' };
            }
            finish(node, evidence && evidence.state ? evidence
              : { state: 'failed', detail: 'Resource acquisition returned no evidence' });
          }).catch(function (error) {
            var detail = error && ['Resource dependency cycle', 'Unknown resource provider',
              'Invalid resource parameters', 'Invalid resource priority'].indexOf(error.message) >= 0
              ? error.message : 'Resource acquisition failed';
            finish(node, { state: 'failed', detail: detail });
          });
        });
      });
    }
    function activate(node) {
      if (node.activated || node.settled) return;
      node.activated = true;
      node.dependencies.forEach(activate);
      Promise.all(Array.from(node.dependencies.values()).map(function (child) { return child.promise; }))
        .then(function () {
          if (!owned(node)) { finish(node, { state: 'cancelled' }); return; }
          if (Array.from(node.dependencies.values()).some(function (child) {
            return !verified(child, child.evidence);
          })) { finish(node, { state: 'blocked' }); return; }
          node.admission = ++admissionSequence;
          queued.add(node); report('queued', node); drain();
        });
    }
    function rootsVerified(consumer) {
      return Object.keys(consumer.needs).every(function (name) {
        var need = consumer.needs[name], node = consumer.roots.get(name);
        return need.requiredFor === 'optional' || node && verified(node, node.evidence);
      });
    }
    function publish(consumer) {
      if (!live() || consumer.cancelled) return;
      try {
        consumer.projection = immutable(consumer.manifest.project(inputs(consumer.roots), scope));
        if (!consumer.projection || typeof consumer.projection.usable !== 'boolean') {
          throw new Error('Invalid feature projection');
        }
      }
      catch (error) { consumer.projection = Object.freeze({ usable: false }); }
      report('projection', null, consumer, consumer.projection.usable ? 'usable' : 'pending');
      if (options.changed) {
        try { options.changed(consumer.manifest.id, consumer.state, consumer.projection); }
        catch (error) { /* presentation cannot change source acquisition */ }
      }
    }
    function retire(consumer) {
      consumer.cancelled = true;
      consumer.controller.abort();
      nodes.forEach(function (node) {
        node.owners.delete(consumer);
        if (!owned(node) && !node.settled) {
          node.controller.abort();
          finish(node, { state: 'cancelled' });
        }
      });
      consumer.state = 'cancelled';
    }
    function add(manifest) {
      if (!manifest || typeof manifest.id !== 'string' || !manifest.id || consumers.has(manifest.id)
          || !Array.isArray(manifest.sections)
          || ['label', 'enabled', 'needs', 'project', 'retainAndVerify'].some(function (name) {
            return typeof manifest[name] !== 'function';
          })) throw new Error('Invalid or duplicate feature manifest');
      if (!manifest.enabled(scope)) return null;
      manifest = Object.freeze(Object.assign({}, manifest, { sections: immutable(manifest.sections) }));
      var consumer = { number: ++consumerSequence, manifest: manifest,
        roots: new Map(), needs: immutable(manifest.needs(scope)), state: 'queued',
        projection: null, cancelled: false, foreground: false, pending: null,
        controller: new AbortController() };
      Object.keys(consumer.needs).forEach(function (name) {
        var need = consumer.needs[name];
        if (['usable', 'complete', 'optional'].indexOf(need.requiredFor) < 0
            || priorities.indexOf(need.priority) < 0) throw new Error('Invalid manifest need');
        plan(need.ref, 'normal', 0, new Set());
      });
      consumers.set(manifest.id, consumer);
      function perform(consumer, mode, generation) {
        consumer.mode = mode; consumer.generation = generation || 0;
        consumer.state = 'loading';
        Object.keys(consumer.needs).forEach(function (name) {
          var need = consumer.needs[name];
          if (need.requiredFor !== 'optional') {
            consumer.roots.set(name, plan(need.ref, mode, consumer.generation, new Set()));
          }
        });
        consumer.roots.forEach(function (node, name) {
          lease(node, consumer, priorities.indexOf(consumer.needs[name].priority));
        });
        publish(consumer);
        consumer.roots.forEach(function (node) {
          node.promise.then(function () { publish(consumer); });
          activate(node);
        });
        consumer.pending = Promise.all(Array.from(consumer.roots.values()).map(function (node) {
          return node.promise;
        })).then(function () {
          if (!live() || consumer.cancelled) return { state: 'cancelled' };
          if (!rootsVerified(consumer)) return { state: consumer.projection.usable ? 'partial' : 'blocked' };
          if (!consumer.projection.usable) return { state: 'failed' };
          var context = { scope: scope, mode: mode, generation: consumer.generation,
            signal: consumer.controller.signal,
            current: function () { return live() && !consumer.cancelled && rootsVerified(consumer); } };
          context.work = options.work ? options.work(context) : { current: context.current };
          return Promise.resolve(consumer.manifest.retainAndVerify(consumer.projection, context))
            .then(function (evidence) {
              return context.current() && evidence && readyStates.indexOf(evidence.state) >= 0
                && typeof evidence.acquiredAt === 'number' && evidence.acquiredAt > 0
                && isFinite(evidence.acquiredAt) && evidence.acquiredAt <= now()
                && typeof evidence.expiresAt === 'number' && isFinite(evidence.expiresAt)
                && evidence.expiresAt > now() && Object.prototype.hasOwnProperty.call(evidence, 'coverage')
                ? evidence : { state: context.current() ? 'failed' : 'cancelled' };
            });
        }).catch(function () { return { state: live() && !consumer.cancelled ? 'failed' : 'cancelled' }; })
          .then(function (evidence) {
            consumer.state = evidence.state;
            publish(consumer);
            return immutable(evidence);
          }).finally(function () { consumer.pending = null; });
        return consumer.pending;
      }
      var handle = {
        start: function (mode, generation) {
          mode = mode || 'normal';
          if (['normal', 'retryMissing', 'fullRefresh'].indexOf(mode) < 0
              || mode === 'fullRefresh' && (!Number.isInteger(generation) || generation < 1)) {
            return Promise.reject(new Error('Invalid resource action'));
          }
          if (!live() || consumer.cancelled) return Promise.resolve({ state: 'cancelled' });
          if (consumer.pending && (mode !== 'fullRefresh'
              || consumer.mode === mode && consumer.generation === generation)) return consumer.pending;
          if (consumer.mode) {
            retire(consumer);
            consumer = Object.assign({}, consumer, { roots: new Map(), pending: null,
              projection: null, cancelled: false, state: 'queued', controller: new AbortController() });
            consumers.set(manifest.id, consumer);
          }
          return perform(consumer, mode, generation);
        },
        optional: function (name) {
          var need = consumer.needs[name];
          if (!need || need.requiredFor !== 'optional' || !consumer.mode) {
            return Promise.reject(new Error('Invalid optional demand'));
          }
          var node = plan(need.ref, consumer.mode, consumer.generation, new Set());
          consumer.roots.set(name, node);
          lease(node, consumer, priorities.indexOf(need.priority));
          activate(node);
          return node.promise.then(function (evidence) { publish(consumer); return evidence; });
        },
        promote: function () {
          consumer.foreground = true;
          nodes.forEach(promoteWork);
          drain();
        },
        cancel: function () { retire(consumer); },
        snapshot: function () { return { state: consumer.state, projection: consumer.projection }; }
      };
      consumer.handle = handle;
      return handle;
    }
    manifests.forEach(add);
    return {
      add: add,
      catalog: function () {
        return immutable(Array.from(consumers.values()).map(function (consumer) {
          return { id: consumer.manifest.id, label: consumer.manifest.label(scope),
            sections: consumer.manifest.sections };
        }));
      },
      get: function (id) { return consumers.get(id) && consumers.get(id).handle; },
      remove: function (id) {
        var consumer = consumers.get(id);
        if (consumer) { retire(consumer); consumers.delete(id); }
      },
      run: function (mode, generation) {
        return Promise.all(Array.from(consumers.values()).map(function (consumer) {
          return consumer.handle.start(mode, generation);
        }));
      },
      promote: function (section) {
        consumers.forEach(function (consumer) {
          consumer.foreground = consumer.manifest.sections.indexOf(section) >= 0;
        });
        nodes.forEach(promoteWork);
        drain();
      },
      cancel: function () {
        cancelled = true;
        consumers.forEach(retire);
      }
    };
  }
  function formatDuration(ms) {
    var seconds = Math.ceil(ms / 1000);
    return Math.floor(seconds / 60) + 'm' + String(seconds % 60).padStart(2, '0') + 's';
  }
  function createEstimate(options) {
    var clock = options.clock || Date.now, changed = options.changed || function () {};
    var pace = options.paceMs, range = options.rangeMs.slice();
    var budget = range.map(function (ms) { return ms / pace; });
    var started = clock(), requests = new Set(), completed = 0, service = 0, samples = 0, live = true;
    function notify() {
      try { changed(); } catch (e) {}
    }
    return {
      begin: function () {
        if (!live) return null;
        var ticket = { activeAt: null };
        requests.add(ticket);
        notify();
        return ticket;
      },
      start: function (ticket) {
        if (live && requests.has(ticket)) ticket.activeAt = clock();
      },
      end: function (ticket, serviceMs) {
        if (!live || !requests.delete(ticket)) return;
        completed++;
        if (Number.isFinite(serviceMs) && serviceMs > 0) {
          service += serviceMs;
          samples++;
        }
        notify();
      },
      read: function (state) {
        if (!live) return null;
        if (state.settled) return { minMs: 0, maxMs: 0, prior: false };
        var step = Math.max(pace, state.paceMs || 0, samples ? service / samples : 0);
        requests.forEach(function (ticket) {
          if (ticket.activeAt !== null) step = Math.max(step, clock() - ticket.activeAt);
        });
        var known = requests.size ? Math.max(requests.size, state.pending || 0) : 0;
        var low = Math.max(known, budget[0] - completed);
        var high = Math.max(known, budget[1] - completed);
        if (high <= 0 || !known && (completed > 0 || clock() - started > range[1])) {
          return { phase: 'source-checks' };
        }
        var hold = Math.max(0, state.retryMs || 0);
        return { minMs: low * step + hold, maxMs: high * step + hold,
          prior: completed === 0 && step === pace && !hold && known <= budget[0] };
      },
      cancel: function () { live = false; requests.clear(); }
    };
  }
  return { create: create, createResources: createResources, createEstimate: createEstimate,
    formatDuration: formatDuration, readyStates: readyStates };
});
