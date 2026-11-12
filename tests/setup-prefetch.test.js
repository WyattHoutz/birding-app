'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const prefetch = require('../www/setup-prefetch.js');

test('F1330 remaining duration uses compact minutes and zero-padded seconds, rounded up', () => {
  assert.deepEqual([4000, 59000, 60000, 70000, 2407000, 1].map(prefetch.formatDuration),
    ['0m04s', '0m59s', '1m00s', '1m10s', '40m07s', '0m01s']);
});

test('F1330 request-work ETA revises for completion, unequal service, queue expansion and one retry hold', () => {
  let now = 0;
  const estimate = prefetch.createEstimate({ rangeMs: [60000, 120000], paceMs: 4000, clock: () => now });
  const state = { pending: 0 };
  assert.deepEqual(estimate.read(state), { minMs: 60000, maxMs: 120000, prior: true });
  const first = estimate.begin(), second = estimate.begin();
  now += 1000;
  assert.equal(estimate.read(state).minMs, 60000, 'wall time is not a fixed countdown');
  estimate.end(first, 2000);
  assert.equal(estimate.read(state).minMs, 56000, 'completed request work reduces the prior');
  estimate.end(first, 20000);
  assert.equal(estimate.read(state).minMs, 56000, 'a repeated completion cannot double-charge work');
  estimate.end(second, 14000);
  estimate.begin();
  assert.equal(estimate.read(state).minMs, 104000, 'unequal live service revises the pace upward');
  assert.equal(estimate.read({ pending: 40 }).maxMs, 320000, 'discovered shared queue work can exceed the prior');
  assert.equal(estimate.read({ pending: 40, retryMs: 10000 }).maxMs, 330000,
    'one retry hold is added once, not once per request or per source');
  assert.equal(estimate.read({ pending: 40, paceMs: 10000 }).maxMs, 400000,
    'the existing limiter spacing participates without changing its policy');
});

test('F1340 active latency revises remaining work; unknown phases and cancellation never imply zero', () => {
  let now = 0;
  const estimate = prefetch.createEstimate({ rangeMs: [4000, 8000], paceMs: 4000, clock: () => now });
  const request = estimate.begin();
  estimate.start(request);
  now = 4001;
  assert.deepEqual(estimate.read({ pending: 1 }), { minMs: 4001, maxMs: 8002, prior: false },
    'live service duration revises the projection instead of permanently suppressing it');
  now = 8000;
  assert.equal(estimate.read({ pending: 1 }).maxMs, 16000, 'slower work revises upward, not a fixed countdown');
  estimate.end(request, null);
  assert.deepEqual(estimate.read({ pending: 9 }), { phase: 'source-checks' },
    'only unrelated work remains; name the unknown source phase without inventing a duration');
  const next = estimate.begin();
  assert.equal(estimate.read({}).maxMs, 4000, 'unusable service measurements do not inflate the pace');
  estimate.end(next, null);
  assert.deepEqual(estimate.read({}), { phase: 'source-checks' }, 'exhausted prior is not zero');
  assert.deepEqual(estimate.read({ pending: 2 }), { phase: 'source-checks' },
    'unrelated requests cannot turn an unknown source into a known plan');
  estimate.begin();
  assert.equal(estimate.read({ pending: 2 }).minMs, 8000, 'newly discovered work restores a live forecast');
  assert.deepEqual(estimate.read({ settled: true }), { minMs: 0, maxMs: 0, prior: false });
  estimate.cancel();
  estimate.start(request); estimate.end(request, 90000);
  assert.equal(estimate.begin(), null);
  assert.equal(estimate.read({ pending: 9 }), null, 'retired acquisition owns no new estimate');
});

test('F1330 display-observer failure cannot interrupt request admission or settlement', () => {
  const estimate = prefetch.createEstimate({ rangeMs: [4000, 8000], paceMs: 4000,
    changed: () => { throw new Error('Synthetic display failure'); } });
  assert.doesNotThrow(() => {
    const ticket = estimate.begin();
    estimate.start(ticket);
    estimate.end(ticket, 1000);
    estimate.begin();
  }, 'display failures cannot change request admission or settlement');
  assert.equal(estimate.read({}).maxMs, 4000);
});

function resourceFixture(config = {}) {
  const time = { now: 1000 }, calls = [], events = [], projections = [];
  const scope = { owner: 'synthetic-owner', region: 'synthetic-region', date: 'fixture-day' };
  const owner = scope.owner;
  const ref = key => ({ provider: 'fixture', params: { key } });
  const evidence = (key, state = 'ready') => ({
    state, value: key, coverage: { key, owner },
    acquiredAt: time.now, expiresAt: time.now + 100,
  });
  const provider = {
    id: 'fixture', revision: 1,
    validate: params => params && typeof params.key === 'string' && !!params.key,
    identity: (params, owner) => JSON.stringify([owner.owner, owner.region, owner.date, params.key]),
    depends: params => Object.fromEntries((config.depends?.[params.key] || []).map(key => [key, ref(key)])),
    read: (params, context) => config.read?.(params.key, context) || null,
    acquire: (params, inputs, context) => {
      calls.push(params.key);
      return config.acquire ? config.acquire(params.key, inputs, context, evidence) : evidence(params.key);
    },
    verify: (result, params, owner, now) => !!result?.coverage
      && result.coverage.key === params.key && result.coverage.owner === owner.owner
      && result.acquiredAt > 0 && result.acquiredAt <= now && result.expiresAt > now,
  };
  function feature(id, required = [id], extra = {}) {
    return {
      id, label: () => 'Synthetic ' + id, sections: [id], enabled: () => true,
      needs: () => Object.fromEntries(required.map(key => [key, {
        ref: ref(key), requiredFor: 'usable', priority: 'current',
      }])),
      project: inputs => ({ usable: required.some(key => inputs[key]?.state === 'ready'),
        value: Object.keys(inputs) }),
      retainAndVerify: () => evidence(id),
      ...extra,
    };
  }
  const graph = prefetch.createResources([provider], (config.features || []).map(id => feature(id)),
    scope, { now: () => time.now, clock: () => time.now,
      trace: row => events.push(row),
      changed: (id, state, projection) => projections.push({ id, state, projection }),
      ...config.options });
  return { graph, provider, feature, ref, evidence, calls, events, projections, time, scope };
}
const resourceTick = () => new Promise(resolve => setImmediate(resolve));

test('F1310 manifests share one pending resource, remain independently removable and reuse verified results', async () => {
  let release, signal;
  const f = resourceFixture({ acquire: (key, inputs, context, evidence) => {
    signal = context.signal;
    return new Promise(resolve => { release = () => resolve(evidence(key)); });
  } });
  const first = f.graph.add(f.feature('first', ['shared']));
  const second = f.graph.add(f.feature('second', ['shared']));
  assert.deepEqual(JSON.parse(JSON.stringify(f.graph.catalog())), [
    { id: 'first', label: 'Synthetic first', sections: ['first'] },
    { id: 'second', label: 'Synthetic second', sections: ['second'] },
  ]);
  assert.ok(Object.isFrozen(f.graph.catalog()[0].sections));
  const pending = f.graph.run();
  await resourceTick();
  assert.deepEqual(f.calls, ['shared']);
  f.graph.remove('first');
  assert.equal(signal.aborted, false, 'removing one lease cannot cancel another consumer');
  release();
  const results = await pending;
  assert.deepEqual(results.map(row => row.state), ['cancelled', 'ready']);
  assert.equal(second.snapshot().state, 'ready');
  const third = f.graph.add(f.feature('third', ['shared']));
  assert.deepEqual(f.graph.catalog().map(row => row.id), ['second', 'third']);
  assert.equal((await third.start()).state, 'ready');
  assert.deepEqual(f.calls, ['shared'], 'adding a manifest cannot require a scheduler edit or extra fetch');
  assert.equal(first.snapshot().state, 'cancelled');
  assert.ok(f.events.every(row => !JSON.stringify(row).includes('synthetic-owner')
    && !Object.hasOwn(row, 'params') && !Object.hasOwn(row, 'identity')));
});

test('F1310 removing exclusive demand aborts only its last lease and rejects late publication', async () => {
  const held = {};
  const f = resourceFixture({ acquire: (key, inputs, context, evidence) => new Promise(resolve => {
    held[key] = { signal: context.signal, release: () => resolve(evidence(key)) };
  }) });
  f.graph.add(f.feature('first', ['shared', 'exclusive']));
  const survivor = f.graph.add(f.feature('second', ['shared']));
  const pending = f.graph.run();
  await resourceTick();
  f.graph.remove('first');
  assert.equal(held.exclusive.signal.aborted, true);
  assert.equal(held.shared.signal.aborted, false);
  held.shared.release(); held.exclusive.release();
  await pending;
  assert.equal(survivor.snapshot().state, 'ready');
  assert.deepEqual(f.calls.sort(), ['exclusive', 'shared']);
});

test('F1310 dynamic candidate children join shared detail and cycles between pending nodes fail explicitly', async () => {
  let detectedCycle = '';
  const f = resourceFixture({ acquire: async (key, inputs, context, evidence) => {
    if (key === 'first' || key === 'second') {
      const child = await context.require(f.ref('detail'), 'reference');
      assert.equal(child.state, 'ready');
    }
    return evidence(key);
  }, features: ['first', 'second'] });
  assert.deepEqual((await f.graph.run()).map(row => row.state), ['ready', 'ready']);
  assert.equal(f.calls.filter(key => key === 'detail').length, 1);
  const cycle = resourceFixture({ acquire: async (key, inputs, context, evidence) => {
    if (key === 'a') await context.require(cycle.ref('b'), 'current');
    if (key === 'b') {
      try { context.require(cycle.ref('a'), 'current'); }
      catch (error) { detectedCycle = error.message; throw error; }
    }
    return evidence(key);
  }, features: ['a', 'b'] });
  const results = await cycle.graph.run();
  assert.ok(results.every(row => !prefetch.readyStates.includes(row.state)));
  assert.equal(detectedCycle, 'Resource dependency cycle',
    'the pending-edge cycle must be rejected explicitly, not merely become blocked');
  assert.ok(cycle.events.some(row => row.state === 'failed'));
  assert.equal(cycle.calls.length, 2, 'a cycle must settle, not start duplicate nodes or hang');
});

test('F1310 invalid references, disabled consumers and static cycles admit no provider work', () => {
  const f = resourceFixture();
  assert.throws(() => f.graph.add(f.feature('unknown', [], { needs: () => ({
    missing: { ref: { provider: 'missing', params: {} }, requiredFor: 'usable', priority: 'current' },
  }) })), /Unknown resource provider/);
  assert.throws(() => f.graph.add(f.feature('invalid', [], { needs: () => ({
    invalid: { ref: { provider: 'fixture', params: { key: '' } },
      requiredFor: 'usable', priority: 'current' },
  }) })), /Invalid resource parameters/);
  assert.equal(f.graph.add(f.feature('disabled', ['never'], { enabled: () => false })), null);
  assert.throws(() => resourceFixture({ features: ['a'], depends: { a: ['b'], b: ['a'] } }),
    /Resource dependency cycle/);
  assert.deepEqual(f.calls, []);
});

test('F1310 an expired transitive child invalidates a still-fresh aggregate before reuse', async () => {
  const f = resourceFixture({
    depends: { aggregate: ['middle'], middle: ['leaf'] },
    acquire: (key, inputs, context, evidence) => ({
      ...evidence(key), expiresAt: f.time.now + (key === 'leaf' ? 100 : 1000),
    }),
  });
  const handle = f.graph.add(f.feature('display', ['aggregate']));
  assert.equal((await handle.start()).state, 'ready');
  f.time.now += 101;
  assert.equal((await handle.start()).state, 'ready');
  assert.equal(f.calls.filter(key => key === 'leaf').length, 2,
    'expired transitive source must reacquire despite a fresh parent receipt');
  assert.equal(f.calls.filter(key => key === 'aggregate').length, 2);
});

test('F1310 base data paints before references, while partial or failed readback cannot become ready', async () => {
  let release, retained = 0;
  const f = resourceFixture({ acquire: (key, inputs, context, evidence) =>
    key === 'reference' ? new Promise(resolve => { release = () => resolve(evidence(key, 'partial')); })
      : evidence(key) });
  const handle = f.graph.add(f.feature('display', ['base'], {
    needs: () => ({
      base: { ref: f.ref('base'), requiredFor: 'usable', priority: 'current' },
      reference: { ref: f.ref('reference'), requiredFor: 'complete', priority: 'reference' },
      annotation: { ref: f.ref('optional'), requiredFor: 'optional', priority: 'optional' },
    }),
    retainAndVerify: () => { retained++; return f.evidence('display'); },
  }));
  const pending = handle.start();
  await resourceTick();
  assert.equal(handle.snapshot().state, 'loading');
  assert.equal(handle.snapshot().projection.usable, true, 'usable is not the final readiness milestone');
  assert.equal(retained, 0);
  assert.deepEqual(f.calls, ['base', 'reference'], 'optional demand is not speculative acquisition');
  release();
  assert.equal((await pending).state, 'partial');
  assert.equal(retained, 0, 'incomplete roots cannot call retainAndVerify');
  const failure = f.graph.add(f.feature('save-failure', ['base'], {
    retainAndVerify: () => ({ state: 'failed' }),
  }));
  assert.equal((await failure.start()).state, 'failed');
});

test('F1310 optional failure does not invalidate required readiness and poisoned/expired evidence reacquires', async () => {
  const f = resourceFixture({ read: key => ({ state: 'ready', value: key }),
    acquire: (key, inputs, context, evidence) => evidence(key, key === 'optional' ? 'failed' : 'ready') });
  const handle = f.graph.add(f.feature('display', ['base'], {
    needs: () => ({
      base: { ref: f.ref('base'), requiredFor: 'usable', priority: 'current' },
      optional: { ref: f.ref('optional'), requiredFor: 'optional', priority: 'optional' },
    }),
  }));
  assert.equal((await handle.start()).state, 'ready');
  assert.equal((await handle.optional('optional')).state, 'failed');
  assert.equal(handle.snapshot().state, 'ready');
  assert.equal((await handle.start()).state, 'ready');
  assert.equal(f.calls.filter(key => key === 'base').length, 1, 'fresh evidence reuses the original result');
  f.time.now += 101;
  assert.equal((await handle.start()).state, 'ready');
  assert.equal(f.calls.filter(key => key === 'base').length, 2);
});

test('F1310 retry missing preserves healthy roots; deliberate refresh generations never join pre-action work', async () => {
  let failed = true;
  const f = resourceFixture({ features: ['healthy', 'failure'],
    acquire: (key, inputs, context, evidence) => evidence(key, key === 'failure' && failed ? 'failed' : 'ready') });
  await f.graph.run();
  failed = false;
  assert.deepEqual((await f.graph.run('retryMissing')).map(row => row.state), ['ready', 'ready']);
  assert.deepEqual(f.calls, ['healthy', 'failure', 'failure']);
  await f.graph.run('fullRefresh', 1);
  assert.deepEqual(f.calls.slice(3), ['healthy', 'failure']);
  await f.graph.run();
  assert.equal(f.calls.length, 5, 'normal readers can use verified post-force evidence');
  await f.graph.run('fullRefresh', 2);
  assert.equal(f.calls.length, 7, 'a later deliberate refresh has a separate acquisition generation');

  const held = [];
  const g = resourceFixture({ features: ['source'], acquire: (key, inputs, context, evidence) =>
    new Promise(resolve => { held.push({ signal: context.signal, release: () => resolve(evidence(key)) }); }) });
  const handle = g.graph.get('source'), normal = handle.start();
  await resourceTick();
  const forced = handle.start('fullRefresh', 1);
  await resourceTick();
  assert.equal(held.length, 2);
  assert.equal(held[0].signal.aborted, true);
  assert.equal((await normal).state, 'cancelled');
  held[0].release(); held[1].release();
  assert.equal((await forced).state, 'ready');
});

test('F1310 a later normal consumer sees the verified post-force evidence, not the pre-force answer', async () => {
  const f = resourceFixture({ acquire: (key, inputs, context, evidence) =>
    ({ ...evidence(key), value: context.mode + ':' + context.generation }) });
  const handle = f.graph.add(f.feature('display', ['base'], {
    project: inputs => ({ usable: !!inputs.base, value: inputs.base?.value }),
  }));
  await handle.start();
  assert.equal(handle.snapshot().projection.value, 'normal:0');
  await handle.start('fullRefresh', 1);
  assert.equal(handle.snapshot().projection.value, 'fullRefresh:1');
  await handle.start();
  assert.equal(handle.snapshot().projection.value, 'fullRefresh:1',
    'ordinary reuse must not resurrect the older graph result after a successful force');
  assert.equal(f.calls.length, 2);
});

test('F1310 captured scope, parameters and evidence are immutable; obsolete async saves cannot publish Ready', async () => {
  let release, captured, current = true, writes = 0;
  const f = resourceFixture({ options: { current: () => current },
    acquire: (key, inputs, context, evidence) => {
      captured = context.scope;
      return evidence(key);
    } });
  const manifest = f.feature('display', ['base'], {
    project: inputs => {
      if (inputs.base) {
        assert.ok(Object.isFrozen(inputs.base.coverage));
        assert.throws(() => { inputs.base.coverage.key = 'changed'; }, TypeError);
      }
      return { usable: !!inputs.base };
    },
    retainAndVerify: (projection, context) => new Promise(resolve => {
      release = () => {
        if (context.current()) writes++;
        resolve(f.evidence('display'));
      };
    }),
  });
  const handle = f.graph.add(manifest), pending = handle.start();
  f.scope.owner = 'changed-after-capture';
  await resourceTick();
  assert.ok(Object.isFrozen(captured), 'the captured scope must be immutable');
  assert.equal(captured.owner, 'synthetic-owner', 'later mutations cannot alter the captured context');
  current = false;
  f.graph.cancel();
  release();
  assert.equal((await pending).state, 'cancelled');
  assert.equal(writes, 0);
  assert.equal(handle.snapshot().state, 'cancelled');
});

test('F1310 eligible work uses live demand, longest unfinished downstream chain and FIFO ties', async () => {
  const f = resourceFixture({ features: ['short', 'long', 'tie-first', 'tie-second'],
    depends: { long: ['middle'], middle: ['leaf'], short: ['short-leaf'] } });
  await f.graph.run();
  assert.deepEqual(f.calls.slice(0, 4), ['leaf', 'short-leaf', 'tie-first', 'tie-second']);
  const promoted = resourceFixture({ features: ['long', 'foreground'],
    depends: { long: ['middle'], middle: ['leaf'] } });
  promoted.graph.promote('foreground');
  await promoted.graph.run();
  assert.equal(promoted.calls[0], 'foreground', 'foreground class takes precedence over chain depth');
});

test('F1310 section promotion reaches the existing shared work without restarting its acquisition', async () => {
  let release, work;
  const promoted = [];
  const f = resourceFixture({ options: {
    work: context => ({ current: context.current, marker: 'synthetic-owned-work' }),
    promote: owner => promoted.push(owner),
  }, acquire: (key, inputs, context, evidence) => {
    work = context.work;
    return new Promise(resolve => { release = () => resolve(evidence(key)); });
  } });
  f.graph.add(f.feature('first', ['shared']));
  f.graph.add(f.feature('second', ['shared']));
  const pending = f.graph.run();
  await resourceTick();
  assert.equal(promoted.length, 0);
  f.graph.promote('second');
  assert.ok(promoted.includes(work), 'the transport adapter must receive the already owned shared work');
  assert.equal(work.current(), true);
  assert.deepEqual(f.calls, ['shared']);
  release();
  await pending;
});

test('F1310 rejected graph expansion cannot leave a partial node reusable as valid demand', async () => {
  let malformed = true, calls = 0;
  const f = resourceFixture();
  const provider = { ...f.provider, depends: params => params.key === 'parent' && malformed
    ? { missing: { provider: 'unregistered', params: {} } } : {},
    acquire: params => { calls++; return f.evidence(params.key); } };
  const graph = prefetch.createResources([provider], [], f.scope, { now: () => f.time.now });
  assert.throws(() => graph.add(f.feature('failed', ['parent'])), /Unknown resource provider/);
  assert.equal(calls, 0);
  malformed = false;
  assert.equal((await graph.add(f.feature('valid', ['parent'])).start()).state, 'ready');
  assert.equal(calls, 1);
});

test('F1310 expired roots during retention and invalid completion timestamps cannot produce Ready', async () => {
  let release;
  const f = resourceFixture();
  const held = f.graph.add(f.feature('held', ['base'], {
    retainAndVerify: () => new Promise(resolve => { release = () => resolve(f.evidence('held')); }),
  }));
  const pending = held.start();
  await resourceTick();
  f.time.now += 101;
  release();
  assert.notEqual((await pending).state, 'ready', 'completion rechecks required source freshness');
  const invalid = f.graph.add(f.feature('invalid', ['base'], {
    retainAndVerify: () => ({ ...f.evidence('invalid'), expiresAt: Infinity }),
  }));
  assert.equal((await invalid.start()).state, 'failed');
});

test('F1310 unsupported successful evidence settles safely instead of stranding its pending readers', async () => {
  const f = resourceFixture({ features: ['unsupported'],
    acquire: (key, inputs, context, evidence) => ({ ...evidence(key), value: new Date() }) });
  assert.equal((await f.graph.run())[0].state, 'blocked');
});

test('F1269 a fast failed child cannot hide pending group work or retained partial availability', async () => {
  let release;
  const engine = prefetch.create({
    failed: { acquire: () => ({ state: 'failed' }) },
    pending: { acquire: () => new Promise(resolve => { release = resolve; }) }
  }, () => true);
  assert.equal(engine.group(['failed', 'pending']), 'queued');
  const attempt = engine.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.states.failed.state, 'failed');
  assert.equal(engine.group(['failed', 'pending']), 'loading');
  release({ state: 'cached' });
  await attempt;
  assert.equal(engine.group(['failed', 'pending']), 'partial');
  assert.equal(engine.group(['failed']), 'failed');
  assert.equal(engine.settled(), true);
  assert.equal(engine.complete(), false);
});

test('F1249 shares pending prerequisites and waits for verified persisted results', async () => {
  let release, calls = 0, writes = 0;
  const engine = prefetch.create({
    shared: { acquire: () => {
      calls++;
      return new Promise(resolve => { release = () => {
        writes++;
        resolve({ state: 'cached', value: ['verified'] });
      }; });
    } },
    first: { depends: ['shared'], acquire: (retry, values) => {
      assert.equal(writes, 1);
      assert.deepEqual(values.shared, ['verified']);
      return { state: 'empty', value: [] };
    } },
    second: { depends: ['shared'], acquire: () => ({ state: 'notApplicable' }) }
  }, () => true);
  const first = engine.run();
  const joined = engine.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(engine.complete(), false);
  release();
  await Promise.all([first, joined]);
  assert.equal(engine.complete(), true);
  assert.equal(engine.group(['first', 'second']), 'ready');
  await engine.run();
  assert.equal(calls, 1, 'a warm run must not download successful data again');
});

test('F1249 null/partial failures block readiness; explicit retry retains successes and retries failed sources only', async () => {
  let success = 0, failure = 0, dependent = 0;
  const engine = prefetch.create({
    success: { acquire: () => { success++; return { state: 'ready' }; } },
    failure: { acquire: retry => {
      failure++;
      return retry ? { state: 'ready' } : null;
    } },
    dependent: { depends: ['failure'], acquire: retry => {
      assert.equal(retry, false, 'a previously blocked source has not failed acquisition');
      dependent++;
      return { state: 'ready' };
    } }
  }, () => true);
  await engine.run();
  assert.equal(engine.states.failure.state, 'failed');
  assert.equal(engine.states.dependent.state, 'blocked');
  assert.equal(dependent, 0);
  assert.equal(engine.complete(), false);
  await engine.run();
  assert.equal(failure, 1, 'rendering must not silently retry a failed request');
  await engine.run(true);
  assert.equal(engine.complete(), true);
  assert.deepEqual([success, failure, dependent], [1, 2, 1]);
});

test('F1249 rejects obsolete completions after an owner-context change', async () => {
  let current = true, release, painted = 0;
  const engine = prefetch.create({
    source: { acquire: () => new Promise(resolve => { release = resolve; }) }
  }, () => current, () => { painted++; });
  const pending = engine.run();
  await new Promise(resolve => setImmediate(resolve));
  current = false;
  const before = painted;
  release({ state: 'ready', value: 'obsolete' });
  await pending;
  assert.equal(painted, before);
  assert.equal(engine.complete(), false);
  assert.notEqual(engine.states.source.state, 'ready');
});

test('F1249 explicit cancellation rejects a pending completion even while its context is current', async () => {
  let release;
  const engine = prefetch.create({
    source: { acquire: () => new Promise(resolve => { release = resolve; }) }
  }, () => true);
  const pending = engine.run();
  await new Promise(resolve => setImmediate(resolve));
  engine.cancel();
  release({ state: 'ready', value: 'cancelled work' });
  await pending;
  assert.equal(engine.complete(), false);
  assert.notEqual(engine.states.source.state, 'ready');
});

test('F1260 partial initial attempts settle without pretending readiness or requiring a retry', async () => {
  let failedCalls = 0, blockedCalls = 0;
  const events = [];
  const engine = prefetch.create({
    ready: { acquire: () => ({ state: 'cached', value: 'retained' }) },
    failed: { acquire: () => { failedCalls++; throw new Error('Synthetic failure'); } },
    blocked: { depends: ['failed'], acquire: () => { blockedCalls++; return { state: 'ready' }; } }
  }, () => true, null, event => events.push(event));
  assert.equal(engine.settled(), false);
  await engine.run();
  assert.equal(engine.settled(), true);
  assert.equal(engine.complete(), false);
  assert.equal(engine.states.ready.state, 'cached');
  assert.equal(engine.states.blocked.state, 'blocked');
  assert.deepEqual([failedCalls, blockedCalls], [1, 0]);
  assert.ok(events.some(event => event.event === 'acquire-start'
    && event.source === 'failed' && event.attempt === 1));
  assert.deepEqual(events.find(event => event.event === 'blocked').dependencies, ['failed']);
  assert.ok(events.some(event => event.event === 'run-settled'
    && event.settled && !event.complete));
  await engine.run(false);
  assert.equal(failedCalls, 1);
});

test('F1260 initial recovery has one pass, joins repeated callers and never refetches ready or partial sources', async () => {
  const calls = {}, events = [];
  const engine = prefetch.create({
    ready: { acquire: () => { calls.ready = (calls.ready || 0) + 1; return { state: 'cached' }; } },
    partial: { acquire: () => { calls.partial = (calls.partial || 0) + 1; return { state: 'partial' }; } },
    transient: { acquire: retry => {
      calls.transient = (calls.transient || 0) + 1;
      return { state: retry ? 'ready' : 'failed' };
    } },
    permanent: { acquire: () => {
      calls.permanent = (calls.permanent || 0) + 1; throw new Error('Synthetic permanent failure');
    } },
    dependent: { depends: ['transient'], acquire: () => {
      calls.dependent = (calls.dependent || 0) + 1; return { state: 'ready' };
    } }
  }, () => true, null, event => events.push(event));
  const first = engine.initial();
  assert.equal(engine.initial(), first);
  await first;
  await engine.initial();
  assert.deepEqual(calls, { ready: 1, partial: 1, transient: 2, permanent: 2, dependent: 1 });
  assert.equal(engine.states.transient.state, 'ready');
  assert.equal(engine.states.dependent.state, 'ready');
  assert.equal(engine.settled(), true);
  assert.equal(engine.complete(), false);
  assert.ok(events.some(event => event.event === 'automatic-retry-selected'
    && event.remainingPasses === 0 && event.sources.includes('permanent')));
  assert.ok(events.some(event => event.event === 'initial-settled'
    && event.settled && !event.complete));
});

test('F1260 cancelling initial work cannot launch its automatic recovery pass', async () => {
  let release, calls = 0;
  const engine = prefetch.create({
    source: { acquire: () => {
      calls++;
      return new Promise(resolve => { release = resolve; });
    } }
  }, () => true);
  const pending = engine.initial();
  await new Promise(resolve => setImmediate(resolve));
  engine.cancel();
  release({ state: 'failed' });
  await pending;
  assert.equal(calls, 1);
  assert.equal(engine.settled(), false);
});

test('F1259 cancelled late failures cannot publish or turn an obsolete attempt into settled setup', async () => {
  let reject, published = 0;
  const engine = prefetch.create({
    source: { acquire: () => new Promise((resolve, fail) => { reject = fail; }) }
  }, () => true, () => { published++; });
  const pending = engine.run();
  await new Promise(resolve => setImmediate(resolve));
  const before = published;
  engine.cancel();
  reject(new Error('Synthetic late failure'));
  await pending;
  assert.equal(published, before);
  assert.equal(engine.settled(), false);
  assert.equal(engine.complete(), false);
});

test('F1285 monotonic task partitions and group settlement exclude unrelated overlapping work', async () => {
  let now = 0, sharedDone, dependentDone, otherDone;
  const engine = prefetch.create({
    shared: { acquire: () => new Promise(resolve => { sharedDone = resolve; }) },
    dependent: { depends: ['shared'], acquire: () => new Promise(resolve => { dependentDone = resolve; }) },
    other: { acquire: () => new Promise(resolve => { otherDone = resolve; }) }
  }, () => true, null, null, {
    clock: () => now, wallClock: () => 1700000000000 + now,
    groups: [['Shared view', ['shared', 'dependent']], ['Other view', ['other']]]
  });
  const pending = engine.run();
  await new Promise(resolve => setImmediate(resolve));
  now = 100; sharedDone({ state: 'ready' });
  await new Promise(resolve => setImmediate(resolve));
  now = 140; dependentDone({ state: 'ready' });
  await new Promise(resolve => setImmediate(resolve));
  now = 250; otherDone({ state: 'ready' });
  await pending;
  const rows = engine.timings(), dependent = rows.find(row => row.type === 'task' && row.source === 'dependent');
  assert.equal(dependent.queued_at_ms, 0);
  assert.equal(dependent.acquisition_started_at_ms, 100);
  assert.equal(dependent.dependency_wait_ms, 100);
  assert.equal(dependent.acquisition_ms, 40);
  assert.equal(dependent.elapsed_ms, 140);
  assert.equal(dependent.wall_ended_at_ms, 1700000000140);
  const shared = rows.find(row => row.type === 'task' && row.source === 'shared');
  assert.ok(shared.joins > 0, 'the existing owned source join must be retained');
  const group = rows.find(row => row.type === 'group' && row.source === 'Shared view');
  assert.equal(group.ended_at_ms, 140);
  assert.equal(group.wall_queued_at_ms, 1700000000000);
  assert.equal(group.wall_ended_at_ms, 1700000000140);
  assert.equal(group.elapsed_ms, 140, 'group elapsed is neither summed task duration nor the unrelated 250ms');
  assert.equal(rows.find(row => row.type === 'group' && row.source === 'Other view').elapsed_ms, 250);
  assert.equal(dependent.clock, 'controlled-monotonic');
  assert.equal(dependent.sleep_attribution, 'unclassified');
});

test('F1285 first pass, selective recovery, durable evidence and later in-run reuse remain distinct', async () => {
  let now = 0, wall = 1700000000000, cachedCalls = 0, failedCalls = 0;
  const engine = prefetch.create({
    failed: { acquire: retry => {
      failedCalls++; now += 10; wall -= 3600000;
      return { state: retry ? 'ready' : 'failed', detail: 'SECRET-error-body' };
    } },
    cached: { acquire: () => { cachedCalls++; return { state: 'cached', value: { token: 'SECRET-value' } }; } },
    dependent: { depends: ['failed', 'cached'], acquire: () => { now += 5; return { state: 'ready' }; } }
  }, () => true, null, null, { clock: () => now, wallClock: () => wall,
    groups: [['Combined', ['failed', 'cached', 'dependent']]] });
  await engine.initial();
  const rows = engine.timings(), attempts = rows.filter(row => row.type === 'task' && row.source === 'failed');
  assert.deepEqual(attempts.map(row => [row.pass, row.attempt, row.state, row.retry]),
    [[1, 1, 'failed', false], [2, 2, 'ready', true]]);
  assert.equal(rows.find(row => row.type === 'task' && row.source === 'cached').reuse, 'durable-cache');
  assert.ok(rows.some(row => row.type === 'reuse' && row.source === 'cached' && row.reuse === 'within-run'));
  assert.deepEqual(rows.filter(row => row.type === 'group').map(row => [row.phase, row.state]),
    [['first-pass', 'partial'], ['recovery', 'ready'], ['initial-final', 'ready']]);
  for (const row of rows.filter(row => row.type === 'task')) {
    assert.equal(row.elapsed_ms, row.dependency_wait_ms + row.acquisition_ms);
    assert.ok(row.elapsed_ms >= 0, 'a wall-clock change must not corrupt monotonic durations');
  }
  assert.doesNotMatch(JSON.stringify(rows), /SECRET|token|detail/);
  await engine.run();
  assert.deepEqual([cachedCalls, failedCalls], [1, 2]);
  assert.equal(engine.timings().filter(row => row.type === 'pass').at(-1).phase, 'follow-up');
});

test('F1285 cancellation and obsolete owners retain timing without publishing late ready results', async () => {
  for (const obsolete of [false, true]) {
    let now = 0, current = true, release, dependentCalls = 0;
    const engine = prefetch.create({
      source: { acquire: () => new Promise(resolve => { release = resolve; }) },
      dependent: { depends: ['source'], acquire: () => { dependentCalls++; return { state: 'ready' }; } }
    }, () => current, null, null, { clock: () => now,
      groups: [['Combined', ['source', 'dependent']]] });
    const pending = engine.initial();
    await new Promise(resolve => setImmediate(resolve));
    now = 25;
    if (obsolete) current = false;
    else {
      engine.cancel();
      assert.equal(engine.timings().filter(row => row.type === 'task' && row.state === 'cancelled').length, 2,
        'cancellation must retain both active acquisition and prerequisite waiting immediately');
    }
    now = 50; release({ state: 'ready', value: 'SECRET-late-value' });
    await pending;
    assert.equal(dependentCalls, 0);
    assert.notEqual(engine.states.source.state, 'ready');
    const tasks = engine.timings().filter(row => row.type === 'task');
    assert.deepEqual(tasks.map(row => row.state), ['cancelled', 'cancelled']);
    assert.equal(tasks.find(row => row.source === 'dependent').acquisition_ms, 0);
    assert.equal(engine.timings().filter(row => row.type === 'group').at(-1).state, 'cancelled');
    assert.doesNotMatch(JSON.stringify(engine.timings()), /SECRET/);
  }
});

test('F1285 timing observers cannot change acquisition and retained journals are bounded', async () => {
  let calls = 0;
  const engine = prefetch.create({
    source: { acquire: () => { calls++; return { state: 'ready', value: 'SECRET-value' }; } }
  }, () => true, null, () => { throw new Error('Synthetic observer failure'); });
  for (let run = 0; run < 150; run++) await engine.run();
  assert.equal(calls, 1);
  assert.equal(engine.complete(), true);
  assert.ok(engine.timings().length <= 128);
  assert.doesNotMatch(JSON.stringify(engine.timings()), /SECRET|Synthetic/);
});
