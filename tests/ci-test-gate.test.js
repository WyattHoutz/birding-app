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
  repository: { full_name: repository }, head_repository: { full_name: repository },
  head_sha: sha, head_branch: 'main', event: 'push',
  status: 'completed', conclusion: 'success', created_at: '2026-11-07T11:00:00Z',
};

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
  const options = {
    now: () => clock,
    sleep: async ms => { clock += ms; },
    fetcher: async url => {
      assert.equal(url.searchParams.get('head_sha'), sha);
      calls++;
      return { ok: true, json: async () => ({ workflow_runs: calls === 1 ? [] : [passed] }) };
    },
  };
  assert.deepEqual(await gate.waitForTests(repository, sha, 'synthetic', options), { id: 10, sha });
  assert.equal(calls, 2);
  await assert.rejects(gate.waitForTests(repository, sha, 'synthetic', {
    ...options, fetcher: async () => ({ ok: false, status: 403 }),
  }), /HTTP 403/);
  await assert.rejects(gate.waitForTests(repository, sha, 'synthetic', {
    ...options, sleep: async () => { clock += 66 * 60 * 1000; },
    fetcher: async () => ({ ok: true, json: async () => ({ workflow_runs: [] }) }),
  }), /bounded wait/);
});

test('F1108/F1313 one full CI catalog and layout gate authorizes unsigned publication', () => {
  const root = path.join(__dirname, '..', '.github', 'workflows');
  const tests = fs.readFileSync(path.join(root, 'tests.yml'), 'utf8');
  const ios = fs.readFileSync(path.join(root, 'ios-build.yml'), 'utf8');
  const commandCount = text => (text.match(/^\s*run:\s*npm test\s*$/gm) || []).length;
  assert.equal(commandCount(tests), 1);
  assert.equal(commandCount(ios), 0);
  assert.match(tests, /run:\s*npm run test:layout/);
  assert.match(ios, /run:\s*node assets\/ci-test-gate\.js/);
  assert.doesNotMatch(ios, /^\s*build:\s*\n\s*needs:/m);
  assert.match(ios, /needs:\s*\[build, gate\]/);
  assert.match(ios, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
});
