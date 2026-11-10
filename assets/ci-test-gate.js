'use strict';

const WORKFLOW = '.github/workflows/tests.yml';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const WAIT_MS = 65 * 60 * 1000;

function selectRun(runs, repository, sha, now = Date.now()) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('CI gate requires an exact repository and source SHA');
  }
  if (!Array.isArray(runs)) throw new Error('CI workflow inventory is invalid');
  const eligible = runs.filter(run => run.path === WORKFLOW
    && run.repository?.full_name === repository
    && run.head_repository?.full_name === repository
    && run.head_sha === sha && run.head_branch === 'main' && run.event === 'push');
  if (!eligible.length) return null;
  if (eligible.some(run => !Number.isSafeInteger(run.id) || run.id <= 0)) {
    throw new Error('CI workflow run identity is invalid');
  }
  const started = run => Date.parse(run.run_started_at || run.created_at);
  if (eligible.some(run => !Number.isFinite(started(run)))) {
    throw new Error('Authoritative CI result has an invalid timestamp');
  }
  const latest = eligible.sort((a, b) => started(b) - started(a) || b.id - a.id)[0];
  const created = started(latest);
  if (!Number.isFinite(created) || now - created < 0 || now - created >= MAX_AGE_MS) {
    throw new Error('Authoritative CI result is stale or has an invalid timestamp');
  }
  if (latest.status !== 'completed') {
    if (!['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(latest.status)) {
      throw new Error('Authoritative CI status is invalid');
    }
    return null;
  }
  if (latest.conclusion !== 'success') {
    throw new Error('Latest authoritative test run did not pass');
  }
  return { id: latest.id, sha: latest.head_sha };
}

async function waitForTests(repository, sha, token, options = {}) {
  if (!token) throw new Error('Existing workflow authorization is required');
  const fetcher = options.fetcher || fetch;
  const now = options.now || Date.now;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  selectRun([], repository, sha, now());
  const deadline = now() + WAIT_MS;
  while (now() < deadline) {
    const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/tests.yml/runs`);
    url.search = new URLSearchParams({ head_sha: sha, branch: 'main', event: 'push', per_page: '100' });
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`CI gate inventory: HTTP ${response.status}`);
    const data = await response.json();
    const result = selectRun(data.workflow_runs, repository, sha, now());
    if (result) return result;
    await sleep(30000);
  }
  throw new Error('Authoritative CI gate did not settle within its bounded wait');
}

module.exports = { selectRun, waitForTests, MAX_AGE_MS, WAIT_MS };

if (require.main === module) {
  console.log('Waiting for the authoritative tests and layout checks on this exact source.');
  waitForTests(process.env.GITHUB_REPOSITORY, process.env.GITHUB_SHA, process.env.GH_TOKEN)
    .then(result => console.log(`Authoritative tests passed: run=${result.id} sha=${result.sha}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
