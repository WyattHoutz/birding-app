'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const gate = require('../assets/ci-test-gate.js');

const repository = 'owner/app', sha = 'a'.repeat(40);
const now = Date.parse('2026-11-07T12:00:00Z');
const passed = {
  id: 10, path: '.github/workflows/tests.yml',
  repository: { full_name: repository }, head_repository: { full_name: repository, fork: false },
  run_attempt: 1,
  head_sha: sha, head_branch: 'main', event: 'push',
  status: 'completed', conclusion: 'success', created_at: '2026-11-07T11:00:00Z',
};
function successfulJobs(run = passed) {
  return Object.entries(gate.REQUIRED_JOBS).map(([name, steps], number) => ({
    id: 20 + number, name, head_sha: sha, run_attempt: run.run_attempt,
    status: 'completed', conclusion: 'success', labels: ['ubuntu-latest'],
    steps: steps.map(name => ({ name, status: 'completed', conclusion: 'success' })),
  }));
}

test('F1108 CI accepts only the authoritative successful trusted exact-source main push', () => {
  assert.deepEqual(gate.selectRun([passed], repository, sha, now), { id: 10, sha });
  for (const change of [
    { path: '.github/workflows/other.yml' }, { head_sha: 'b'.repeat(40) },
    { head_branch: 'feature' }, { event: 'pull_request' },
    { repository: { full_name: 'fork/app' } }, { head_repository: { full_name: 'fork/app' } },
  ]) assert.equal(gate.selectRun([{ ...passed, ...change }], repository, sha, now), null);
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', null]) {
    assert.throws(() => gate.selectRun([{ ...passed, conclusion }], repository, sha, now),
      /did not pass/);
  }
  for (const change of [
    { id: -1 }, { created_at: 'invalid' }, { created_at: '2026-11-06T11:00:00Z' },
    { created_at: '2026-11-07T13:00:00Z' },
  ]) assert.throws(() => gate.selectRun([{ ...passed, ...change }], repository, sha, now));
});

test('F1108 a newer failed or pending test run cannot borrow an older success', () => {
  const failed = { ...passed, id: 11, conclusion: 'failure' };
  assert.throws(() => gate.selectRun([passed, failed], repository, sha, now), /did not pass/);
  assert.equal(gate.selectRun([passed, { ...failed, status: 'in_progress', conclusion: null }],
    repository, sha, now), null);
  assert.throws(() => gate.selectRun([passed, {
    ...failed, id: 9, run_started_at: '2026-11-07T11:30:00Z',
  }], repository, sha, now), /did not pass/);
  assert.deepEqual(gate.selectRun([{
    ...passed, created_at: '2026-11-01T11:00:00Z',
    run_started_at: '2026-11-07T11:30:00Z',
  }], repository, sha, now), { id: 10, sha });
});

test('F1108 bounded CI waiting requires a real success and fails closed on authorization errors', async () => {
  let clock = now, calls = 0;
  const jobs = successfulJobs();
  const options = {
    now: () => clock,
    sleep: async ms => { clock += ms; },
    fetcher: async url => {
      calls++;
      if (url.pathname.endsWith('/jobs')) {
        assert.match(url.pathname, /\/runs\/10\/attempts\/1\/jobs$/);
        return { ok: true, json: async () => ({ total_count: jobs.length, jobs }) };
      }
      assert.equal(url.searchParams.get('head_sha'), sha);
      const rows = calls === 1 ? [] : [passed];
      return { ok: true, json: async () => ({ total_count: rows.length, workflow_runs: rows }) };
    },
  };
  assert.deepEqual(await gate.waitForTests(repository, sha, 'synthetic', options), { id: 10, sha });
  assert.equal(calls, 4);
  await assert.rejects(gate.waitForTests(repository, sha, 'synthetic', {
    ...options, fetcher: async () => ({ ok: false, status: 403 }),
  }), /HTTP 403/);
  await assert.rejects(gate.waitForTests(repository, sha, 'synthetic', {
    ...options, sleep: async () => { clock += 66 * 60 * 1000; },
    fetcher: async () => ({ ok: true, json: async () => ({ total_count: 0, workflow_runs: [] }) }),
  }), /bounded wait/);
});

test('F1316 unsigned authorization recovers a transient read without borrowing coverage', async () => {
  let calls = 0;
  const jobs = successfulJobs();
  const options = {
    now: () => now,
    fetcher: async url => {
      if (++calls === 1) throw new TypeError('fetch failed');
      return { ok: true, json: async () => url.pathname.endsWith('/jobs')
        ? { total_count: jobs.length, jobs }
        : { total_count: 1, workflow_runs: [passed] } };
    },
  };
  await assert.doesNotReject(async () => {
    assert.deepEqual(await gate.waitForTests(repository, sha, 'synthetic', options), { id: 10, sha });
  });
  assert.equal(calls, 4);
  calls = 0;
  jobs[0].conclusion = 'failure';
  await assert.rejects(gate.waitForTests(repository, sha, 'synthetic', options), /did not pass/);
});

test('F1316 transport retries are bounded, share the original timeout and exclude writes', async () => {
  const signal = AbortSignal.timeout(60000), seen = [];
  await assert.rejects(gate.githubGet(async (url, init) => {
    seen.push(init.signal);
    throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
  }, new URL('https://api.github.com/'), { signal }), /fetch failed after 3 attempts \(ECONNRESET\)/);
  assert.equal(seen.length, 3);
  assert.ok(seen.every(value => value === signal), 'retrying must not restart the request deadline');
  let writes = 0;
  await assert.rejects(gate.githubGet(async () => { writes++; }, new URL('https://api.github.com/'),
    { signal, method: 'POST' }), /read-only GET/);
  assert.equal(writes, 0);
});

test('F1316 aborts and non-transport errors are never retried', async () => {
  for (const failure of [new Error('authorization failed'), new SyntaxError('invalid JSON')]) {
    let calls = 0;
    await assert.rejects(gate.githubGet(async () => { calls++; throw failure; },
      new URL('https://api.github.com/'), { signal: AbortSignal.timeout(60000) }),
    error => error === failure);
    assert.equal(calls, 1);
  }
  const controller = new AbortController();
  const failure = new TypeError('fetch failed');
  let calls = 0;
  await assert.rejects(gate.githubGet(async () => {
    calls++;
    controller.abort();
    throw failure;
  }, new URL('https://api.github.com/'), { signal: controller.signal }), error => error === failure);
  assert.equal(calls, 1);
});

test('F1309 every required job and coverage step must succeed; parallel skips cannot bless publication', () => {
  const required = { catalog: ['Install dependencies', 'Unit, syntax and DOM suites'],
    layout: ['Install dependencies', 'Layout \u2014 nothing may overflow the screen'] };
  const jobs = Object.entries(required).map(([name, steps], index) => ({
    id: 20 + index, name, head_sha: sha, run_attempt: 1, status: 'completed',
    conclusion: 'success', labels: ['ubuntu-latest'],
    steps: steps.map(name => ({ name, status: 'completed', conclusion: 'success' })),
  }));
  const payload = { total_count: 2, jobs };
  assert.deepEqual(gate.checkJobs(payload, passed, required), { catalog: 20, layout: 21 });
  for (const index of [0, 1]) {
    for (const change of [
      { conclusion: 'failure' }, { conclusion: 'skipped' }, { conclusion: 'cancelled' },
      { status: 'in_progress' }, { head_sha: 'b'.repeat(40) }, { run_attempt: 2 },
      { labels: ['self-hosted'] }, { name: 'optional' },
    ]) {
      const altered = structuredClone(payload);
      Object.assign(altered.jobs[index], change);
      assert.throws(() => gate.checkJobs(altered, passed, required));
    }
    for (const conclusion of ['failure', 'skipped', 'cancelled']) {
      const altered = structuredClone(payload);
      altered.jobs[index].steps[1].conclusion = conclusion;
      assert.throws(() => gate.checkJobs(altered, passed, required), /coverage/);
    }
  }
  assert.throws(() => gate.checkJobs({ total_count: 2, jobs: jobs.slice(1) }, passed, required));
  assert.throws(() => gate.checkJobs({ total_count: 1, jobs: jobs.slice(1) }, passed, required));
  assert.throws(() => gate.checkJobs({ total_count: 2, jobs: [jobs[0], jobs[0]] }, passed, required));
});

test('F1309 a rerun during required-job verification cannot inherit an earlier pass', async () => {
  let histories = 0;
  await assert.rejects(gate.waitForTests(repository, sha, 'synthetic', {
    now: () => now,
    fetcher: async url => {
      let data;
      if (url.pathname.endsWith('/jobs')) {
        const jobs = successfulJobs();
        data = { total_count: jobs.length, jobs };
      } else {
        histories++;
        data = { total_count: 1, workflow_runs: [{ ...passed, run_attempt: histories }] };
      }
      return { ok: true, json: async () => data };
    },
  }), /attempt changed/);
});

test('F1309 actual unsigned waiting inspects required jobs and complete history', async () => {
  const jobs = successfulJobs();
  let total = 1;
  const options = {
    now: () => now,
    fetcher: async url => ({ ok: true, json: async () => url.pathname.endsWith('/jobs')
      ? { total_count: jobs.length, jobs }
      : { total_count: total, workflow_runs: [passed] } }),
  };
  for (const job of jobs) {
    for (const conclusion of ['failure', 'skipped', 'cancelled']) {
      job.conclusion = conclusion;
      await assert.rejects(gate.waitForTests(repository, sha, 'synthetic', options), /did not pass/);
    }
    job.conclusion = 'success';
  }
  total = 99;
  await assert.rejects(gate.waitForTests(repository, sha, 'synthetic', options), /incomplete/);
});

test('F1108/F1313 one full CI catalog and layout gate authorizes unsigned publication', () => {
  const root = path.join(__dirname, '..', '.github', 'workflows');
  const tests = fs.readFileSync(path.join(root, 'tests.yml'), 'utf8');
  const ios = fs.readFileSync(path.join(root, 'ios-build.yml'), 'utf8');
  const commandCount = text => (text.match(/^\s*run:\s*npm test\s*$/gm) || []).length;
  assert.equal(commandCount(tests), 1);
  const [, jobSection] = tests.split(/^jobs:\r?$/m);
  assert.ok(jobSection);
  const jobs = [...jobSection.matchAll(/^  (\w+):\s*$/gm)].map(match => match[1]);
  assert.deepEqual(jobs, Object.keys(gate.REQUIRED_JOBS));
  assert.deepEqual(new Set(jobs), new Set(['catalog', 'layout']));
  assert.doesNotMatch(tests, /^    (?:if|needs):/m);
  assert.doesNotMatch(tests, /benchmark_mode/);
  assert.match(tests, /^  push:\s*\n    branches:\s*\[\s*main\s*\]/m);
  assert.equal(commandCount(ios), 0);
  assert.match(tests, /run:\s*npm run test:layout/);
  assert.match(ios, /run:\s*node assets\/ci-test-gate\.js/);
  assert.doesNotMatch(ios, /^\s*build:\s*\n\s*needs:/m);
  assert.match(ios, /needs:\s*\[build, gate\]/);
  assert.match(ios, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
});
