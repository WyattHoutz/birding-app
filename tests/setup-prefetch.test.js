'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const prefetch = require('../www/setup-prefetch.js');

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
