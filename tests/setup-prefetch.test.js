'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const prefetch = require('../www/setup-prefetch.js');

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
