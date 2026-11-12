'use strict';
const fs = require('node:fs');
const { MAX_AGE_MS, WAIT_MS, waitForTests, githubGet } = require('./ci-test-gate.js');

function identity(run, repository, now) {
  const started = Date.parse(run.run_started_at || run.created_at);
  if (!Number.isFinite(now) || !/^[\w.-]+\/[\w.-]+$/.test(repository)
      || run.repository?.full_name !== repository
      || run.head_repository?.full_name !== repository
      || run.path !== '.github/workflows/ios-build.yml'
      || run.event !== 'push' || run.head_branch !== 'main'
      || !/^[a-f0-9]{40}$/.test(run.head_sha)
      || !Number.isSafeInteger(run.id) || run.id <= 0
      || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0
      || !['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'].includes(run.status)
      || (run.status === 'completed' && !['success', 'failure'].includes(run.conclusion))
      || (run.status !== 'completed' && run.conclusion !== null)
      || !Number.isFinite(started) || started > now || now - started >= MAX_AGE_MS) {
    throw new Error('Prepared signing source is not a fresh trusted main-push run');
  }
  return { sha: run.head_sha, runId: String(run.id), attempt: String(run.run_attempt) };
}

function project(run, jobs, artifacts, repository, now, manual = false) {
  const source = identity(run, repository, now);
  if (!Array.isArray(jobs) || !Array.isArray(artifacts))
    throw new Error('Prepared source inventory is invalid');
  const builds = jobs.filter(job => job.name === 'build');
  if (builds.length > 1) throw new Error('Prepared source build is ambiguous');
  const build = builds[0];
  if (!build || build.status !== 'completed') return null;
  if (build.conclusion !== 'success' || build.run_id !== run.id
      || build.run_attempt !== run.run_attempt || build.head_sha !== source.sha)
    throw new Error('Prepared source build did not succeed on this exact source');
  const name = `BirdChaser-ios-project-${source.attempt}`;
  let matches = artifacts.filter(artifact => artifact.name === name);
  if (!matches.length && manual && run.status === 'completed' && run.conclusion === 'success') {
    require('./testflight.js').sourceRun(run, repository);
    matches = artifacts.filter(artifact => artifact.name === 'BirdChaser-ios-project');
  }
  if (matches.length > 1) throw new Error('Prepared project artifact is ambiguous');
  if (!matches.length) return null;
  const artifact = matches[0], created = Date.parse(artifact.created_at);
  const expires = Date.parse(artifact.expires_at);
  if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0
      || artifact.expired !== false || !Number.isFinite(created) || !Number.isFinite(expires)
      || created < Date.parse(run.run_started_at || run.created_at)
      || created > now || expires <= now
      || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0) {
    throw new Error('Prepared project artifact is expired or has invalid identity');
  }
  return { ...source, artifactId: String(artifact.id), artifactName: artifact.name };
}

function github(repository, token, fetcher = fetch) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error('Existing workflow authorization and repository are required');
  return async resource => {
    const response = await githubGet(fetcher, new URL(`https://api.github.com/repos/${repository}/${resource}`), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Prepared source lookup: HTTP ${response.status}`);
    return response.json();
  };
}

async function inspect(api, repository, runId, now, manual) {
  const run = await api(`actions/runs/${runId}`);
  const source = identity(run, repository, now());
  if (source.runId !== runId) throw new Error('Prepared source run identity changed');
  const [jobs, artifacts] = await Promise.all([
    api(`actions/runs/${runId}/attempts/${source.attempt}/jobs?per_page=100`),
    api(`actions/runs/${runId}/artifacts?per_page=100`),
  ]);
  return project(run, jobs.jobs, artifacts.artifacts, repository, now(), manual);
}

async function resolve(env, options = {}) {
  if (!/^[1-9]\d*$/.test(env.UNSIGNED_RUN_ID || '')) throw new Error('Invalid source run ID');
  const now = options.now || Date.now;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const api = github(env.GITHUB_REPOSITORY, env.GH_TOKEN, options.fetcher);
  const deadline = now() + WAIT_MS;
  while (now() < deadline) {
    if (env.MANUAL_SOURCE === 'true') {
      require('./testflight.js').sourceRun(
        await api(`actions/runs/${env.UNSIGNED_RUN_ID}`), env.GITHUB_REPOSITORY);
    }
    const source = await inspect(api, env.GITHUB_REPOSITORY, env.UNSIGNED_RUN_ID,
      now, env.MANUAL_SOURCE === 'true');
    if (source) return source;
    await sleep(30000);
  }
  throw new Error('Prepared project did not settle within its bounded wait');
}

function captured(env) {
  const source = {
    sha: env.TESTFLIGHT_SOURCE_SHA, runId: env.TESTFLIGHT_SOURCE_RUN_ID,
    attempt: env.TESTFLIGHT_SOURCE_ATTEMPT, artifactId: env.TESTFLIGHT_SOURCE_ARTIFACT_ID,
    artifactName: env.TESTFLIGHT_SOURCE_ARTIFACT_NAME,
  };
  if (!/^[a-f0-9]{40}$/.test(source.sha || '')
      || ![source.runId, source.attempt, source.artifactId].every(value =>
        /^[1-9]\d*$/.test(value || '') && Number.isSafeInteger(Number(value)))
      || ![ `BirdChaser-ios-project-${source.attempt}`, 'BirdChaser-ios-project' ]
        .includes(source.artifactName)) {
    throw new Error('Captured prepared-source identity is incomplete');
  }
  return source;
}

async function authorize(env, options = {}) {
  const expected = captured(env), repository = env.GITHUB_REPOSITORY;
  const now = options.now || Date.now;
  const api = github(repository, env.GH_TOKEN, options.fetcher);
  const manual = expected.artifactName === 'BirdChaser-ios-project';
  async function current() {
    const actual = await inspect(api, repository, expected.runId, now, manual);
    if (!actual || Object.keys(expected).some(key => actual[key] !== expected[key]))
      throw new Error('Prepared source, attempt or artifact changed before upload');
  }
  await current();
  const tests = await waitForTests(repository, expected.sha, env.GH_TOKEN, {
    ...options,
    fetcher: async (...args) => {
      const run = await api(`actions/runs/${expected.runId}`);
      const actual = identity(run, repository, now());
      if (actual.sha !== expected.sha || actual.attempt !== expected.attempt
          || actual.runId !== expected.runId)
        throw new Error('Prepared source attempt changed while awaiting tests');
      return (options.fetcher || fetch)(...args);
    },
  });
  await current();
  return { ...expected, testRunId: tests.id };
}

async function sourceBuildNumber(env, options = {}) {
  const expected = captured(env);
  const api = github(env.GITHUB_REPOSITORY, env.GH_TOKEN, options.fetcher);
  const run = await api(`actions/runs/${expected.runId}`);
  const actual = identity(run, env.GITHUB_REPOSITORY, (options.now || Date.now)());
  if (Object.keys(actual).some(key => actual[key] !== expected[key])) {
    throw new Error('Prepared source identity changed before selecting the Apple build number');
  }
  return require('./testflight.js').buildNumber(run.run_number, run.run_attempt);
}

module.exports = { identity, project, resolve, captured, authorize, sourceBuildNumber };

if (require.main === module) {
  resolve(process.env).then(source => {
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      `sha=${source.sha}\nrun_id=${source.runId}\nattempt=${source.attempt}\n`
      + `artifact_id=${source.artifactId}\nartifact_name=${source.artifactName}\n`);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
