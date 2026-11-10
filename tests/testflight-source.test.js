'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const source = require('../assets/testflight-source.js');
const repository = 'owner/app', sha = 'a'.repeat(40);
const now = Date.parse('2026-11-09T12:00:00Z');
const run = {
  id: 25, run_attempt: 2, repository: { full_name: repository },
  head_repository: { full_name: repository }, head_sha: sha, head_branch: 'main',
  path: '.github/workflows/ios-build.yml', event: 'push',
  status: 'in_progress', conclusion: null, run_started_at: '2026-11-09T11:00:00Z',
};
const build = { name: 'build', run_id: 25, run_attempt: 2, head_sha: sha,
  status: 'completed', conclusion: 'success' };
const artifact = { id: 55, name: 'BirdChaser-ios-project-2', expired: false,
  created_at: '2026-11-09T11:05:00Z', expires_at: '2026-11-10T11:05:00Z',
  size_in_bytes: 100 };
const expected = { sha, runId: '25', attempt: '2', artifactId: '55', artifactName: artifact.name };
const env = { GITHUB_REPOSITORY: repository, GH_TOKEN: 'synthetic',
  UNSIGNED_RUN_ID: '25', TESTFLIGHT_SOURCE_SHA: sha, TESTFLIGHT_SOURCE_RUN_ID: '25',
  TESTFLIGHT_SOURCE_ATTEMPT: '2', TESTFLIGHT_SOURCE_ARTIFACT_ID: '55',
  TESTFLIGHT_SOURCE_ARTIFACT_NAME: artifact.name };

function fixture() {
  const state = { run: structuredClone(run), builds: [structuredClone(build)],
    artifacts: [structuredClone(artifact)], clock: now, tests: [{
      ...run, id: 90, path: '.github/workflows/tests.yml',
      status: 'completed', conclusion: 'success',
    }], testReads: 0 };
  state.options = {
    now: () => state.clock,
    sleep: async ms => { state.clock += ms; state.afterSleep?.(); },
    fetcher: async url => {
      let data;
      if (url.pathname.endsWith('/actions/workflows/tests.yml/runs')) {
        state.testReads++;
        state.onTests?.();
        data = { workflow_runs: state.tests };
      } else if (url.pathname.endsWith('/attempts/2/jobs')) data = { jobs: state.builds };
      else if (url.pathname.endsWith('/artifacts')) data = { artifacts: state.artifacts };
      else if (url.pathname.endsWith('/actions/runs/25')) data = state.run;
      else throw new Error('Unexpected fixture request: ' + url.pathname);
      return { ok: true, json: async () => structuredClone(data) };
    },
  };
  return state;
}

test('F1313 prepared signing requires trusted fresh main-push identity, not arbitrary active runs', () => {
  assert.deepEqual(source.identity(run, repository, now), { sha, runId: '25', attempt: '2' });
  for (const change of [
    { repository: { full_name: 'fork/app' } }, { head_repository: { full_name: 'fork/app' } },
    { head_sha: 'not-a-sha' }, { head_branch: 'feature' }, { event: 'workflow_dispatch' },
    { path: '.github/workflows/other.yml' }, { id: -1 }, { run_attempt: 0 },
    { status: 'completed', conclusion: 'cancelled' },
    { conclusion: 'cancelled' }, { status: 'mystery' },
    { run_started_at: '2026-11-08T11:00:00Z' },
    { run_started_at: '2026-11-09T13:00:00Z' },
  ]) assert.throws(() => source.identity({ ...run, ...change }, repository, now));
  assert.throws(() => source.identity(run, repository, NaN));
});

test('F1313 an immutable project belongs to the successful native job and exact attempt', () => {
  assert.deepEqual(source.project(run, [build], [artifact], repository, now), expected);
  assert.equal(source.project(run, [{ ...build, status: 'in_progress' }], [], repository, now), null);
  assert.equal(source.project(run, [build], [
    { ...artifact, name: 'BirdChaser-ios-project-1' },
  ], repository, now), null, 'an earlier attempt cannot be borrowed');
  for (const changed of [
    { conclusion: 'failure' }, { run_id: 26 }, { run_attempt: 1 }, { head_sha: 'b'.repeat(40) },
  ]) assert.throws(() => source.project(run, [{ ...build, ...changed }], [artifact], repository, now));
  for (const changed of [
    { expired: true }, { expires_at: '2026-11-09T11:59:00Z' },
    { created_at: '2026-11-09T10:59:00Z' }, { id: 0 }, { size_in_bytes: undefined },
  ]) assert.throws(() => source.project(run, [build], [{ ...artifact, ...changed }], repository, now));
  assert.throws(() => source.project(run, [build, build], [artifact], repository, now));
  const legacy = { ...artifact, name: 'BirdChaser-ios-project' };
  assert.equal(source.project(run, [build], [legacy], repository, now), null);
  assert.deepEqual(source.project({ ...run, status: 'completed', conclusion: 'success' },
    [build], [legacy], repository, now, true), { ...expected, artifactName: legacy.name });
});

test('F1313 project waiting is bounded, fail-closed and uses the captured attempt', async () => {
  const f = fixture();
  f.builds[0].status = 'in_progress';
  f.afterSleep = () => { f.builds[0].status = 'completed'; };
  assert.deepEqual(await source.resolve(env, f.options), expected);
  await assert.rejects(source.resolve({ ...env, UNSIGNED_RUN_ID: '../25' }, f.options));
  await assert.rejects(source.resolve(env, {
    ...f.options, fetcher: async () => ({ ok: false, status: 403 }),
  }), /HTTP 403/);
  f.builds = [];
  f.afterSleep = () => { f.clock += 66 * 60 * 1000; };
  await assert.rejects(source.resolve(env, f.options), /bounded wait/);
  await assert.rejects(source.resolve({ ...env, MANUAL_SOURCE: 'true' }, fixture().options),
    /successful main-push/);
});

test('F1313 signed preparation can precede publication, but upload waits for actual authoritative tests', async () => {
  const f = fixture();
  f.tests[0].status = 'in_progress';
  f.tests[0].conclusion = null;
  f.afterSleep = () => { f.tests[0].status = 'completed'; f.tests[0].conclusion = 'success'; };
  assert.deepEqual(await source.authorize(env, f.options), { ...expected, testRunId: 90 });
  assert.equal(f.testReads, 2);
  f.run.status = 'completed';
  f.run.conclusion = 'failure';
  assert.deepEqual(await source.authorize(env, f.options), { ...expected, testRunId: 90 },
    'unsigned publication failure is independent of successful tests and the native project');
});

test('F1313 rejected authoritative tests never authorize an Apple upload', async () => {
  const f = fixture();
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out']) {
    f.tests[0].conclusion = conclusion;
    await assert.rejects(source.authorize(env, f.options), /did not pass/);
  }
  f.tests[0].conclusion = 'success';
  f.tests[0].run_started_at = '2026-11-08T11:00:00Z';
  await assert.rejects(source.authorize(env, f.options), /stale/);
  f.tests[0].run_started_at = run.run_started_at;
  f.tests.push({ ...f.tests[0], id: 91, conclusion: 'failure' });
  await assert.rejects(source.authorize(env, f.options), /did not pass/);
});

test('F1313 cancellation, reruns and changed artifacts cannot use a captured upload authorization', async () => {
  for (const alter of [
    f => { f.run.status = 'completed'; f.run.conclusion = 'cancelled'; },
    f => { f.run.run_attempt++; },
    f => { f.artifacts[0].id++; },
    f => { f.artifacts[0].expired = true; },
  ]) {
    const f = fixture();
    f.onTests = () => alter(f);
    await assert.rejects(source.authorize(env, f.options));
  }
  const f = fixture();
  f.tests[0].status = 'in_progress';
  f.tests[0].conclusion = null;
  f.afterSleep = () => { f.run.status = 'completed'; f.run.conclusion = 'cancelled'; };
  await assert.rejects(source.authorize(env, f.options));
  await assert.rejects(source.authorize({ ...env, TESTFLIGHT_SOURCE_ARTIFACT_ID: '' }, f.options),
    /identity is incomplete/);
});
