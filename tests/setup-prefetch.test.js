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
