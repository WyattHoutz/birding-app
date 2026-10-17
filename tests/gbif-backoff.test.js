'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(process.env.BIRDCHASER_WWW
  || path.join(__dirname, '..', 'www'), 'index.html'), 'utf8');
const start = html.indexOf('var GBIF_BUCKET =');
const end = html.indexOf('// MATCHED ON SHAPE', start);
assert.ok(start >= 0 && end > start);

function harness(header = '3') {
  let now = 0, nextTimer = 0;
  const timers = [], starts = [];
  class Clock extends Date { static now() { return now; } }
  const api = vm.runInNewContext(html.slice(start, end)
    + '\n({ gbifJson, gbifRetryAfterMs });', {
    Date: Clock, _gbifInflight: {}, dbg() {},
    setTimeout(fn, delay) {
      timers.push({ fn, at: now + delay, id: ++nextTimer });
      return nextTimer;
    },
    fetch(url) {
      starts.push({ url, at: now });
      const refused = url === 'refused';
      return Promise.resolve({
        status: refused ? 429 : 200, ok: !refused,
        headers: { get: () => header },
        json: () => Promise.resolve({ count: 7 }),
      });
    },
  });
  async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
  async function advance(to) {
    await flush();
    for (let i = 0; i < 1000; i++) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      if (!timers.length || timers[0].at > to) { now = to; await flush(); return; }
      const timer = timers.shift();
      now = timer.at;
      timer.fn();
      await flush();
    }
    throw new Error('Scheduler did not settle within the bounded synthetic trace.');
  }
  return { api, starts, flush, advance };
}

test('F989 a GBIF refusal pauses unrelated work and every retry shares the cooldown', async () => {
  const h = harness();
  const refused = h.api.gbifJson('refused');
  const inFlight = h.api.gbifJson('already-in-flight');
  await h.flush();
  const next = h.api.gbifJson('queued-neighbor');
  await h.flush();
  assert.equal(h.starts.filter(row => row.url === 'queued-neighbor').length, 0);
  await h.advance(2999);
  assert.equal(h.starts.filter(row => row.url === 'queued-neighbor').length, 0);
  await h.advance(3000);
  assert.equal(h.starts.find(row => row.url === 'queued-neighbor').at, 3000);
  assert.equal((await next).count, 7);
  assert.equal((await inFlight).count, 7, 'already dispatched requests are not cancelled');
  await h.advance(6000);
  assert.equal(await refused, null, 'bounded retries do not invent an empty successful response');
  assert.deepEqual(h.starts.filter(row => row.url === 'refused').map(row => row.at),
    [0, 3000, 6000]);
  const afterFinalRefusal = h.api.gbifJson('after-terminal-refusal');
  await h.advance(8999);
  assert.equal(h.starts.filter(row => row.url === 'after-terminal-refusal').length, 0,
    'even the final refused attempt must protect neighboring queued work');
  await h.advance(9000);
  assert.equal((await afterFinalRefusal).count, 7);
  assert.equal(h.starts.find(row => row.url === 'after-terminal-refusal').at, 9000);
});

test('F989 Retry-After accepts HTTP dates and does not shorten a server cooldown', () => {
  const h = harness();
  function delay(value) { return h.api.gbifRetryAfterMs({ headers: { get: () => value } }); }
  assert.equal(delay('Thu, 01 Jan 1970 00:00:03 GMT'), 3000);
  assert.equal(delay('90'), 90000);
  assert.equal(delay('0'), 0);
  assert.ok(delay(null) > 0);
  assert.ok(delay('invalid') > 0);
});
