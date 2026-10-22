'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const flight = require('../assets/testflight.js');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const vm = require('node:vm');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const env = { ASC_KEY_ID: 'TESTKEY', ASC_ISSUER_ID: 'test-issuer', ASC_PRIVATE_KEY: privateKey };
const build = state => ({
  id: 'build-id', type: 'builds', attributes: { version: '538.1', processingState: state },
  relationships: { preReleaseVersion: { data: { id: 'release-id' } } },
});
const included = [{ type: 'preReleaseVersions', id: 'release-id', attributes: { version: '1.168.0' } }];

test('F1059 signing accepts only the exact successful main-push source repository and workflow', () => {
  const source = {
    id: 123, head_sha: 'a'.repeat(40), repository: { full_name: 'owner/app' },
    path: '.github/workflows/ios-build.yml', head_branch: 'main', event: 'push', conclusion: 'success',
  };
  assert.deepEqual(flight.sourceRun(source, 'owner/app'), { sha: 'a'.repeat(40), runId: '123' });
  for (const change of [
    { repository: { full_name: 'someone/fork' } }, { path: '.github/workflows/other.yml' },
    { head_branch: 'feature' }, { event: 'pull_request' }, { conclusion: 'failure' },
    { head_sha: 'not-a-sha' }, { id: -1 },
  ]) assert.throws(() => flight.sourceRun({ ...source, ...change }, 'owner/app'), /successful main-push/);
});

test('F1059 Apple build numbers advance with workflow attempts and obey component limits', () => {
  assert.equal(flight.buildNumber(538, 1), '538.1');
  assert.equal(flight.buildNumber(538, 2), '538.2');
  for (const values of [[0, 1], [10000, 1], [1, 100], ['../1', 1], [1, undefined]]) {
    assert.throws(() => flight.buildNumber(...values), /Build number requires/);
  }
});

test('F1059 signed native assets use the TestFlight channel and a 90-day stamp', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bird-flight-stamp-'));
  try {
    const output = path.join(temp, 'build-info.js');
    const before = Date.now();
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'assets', 'stamp-build-info.js'),
      output, 'testflight', '123.1', '90',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(output, 'utf8'), context);
    const info = context.window.__BUILD_INFO__;
    assert.equal(info.channel, 'testflight');
    assert.equal(info.buildId, '123.1');
    assert.ok(Math.abs(Date.parse(info.expiresAt) - before - 90 * 86400000) < 5000);
    const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'testflight.js'), 'utf8');
    assert.match(source, /'testflight', `\$\{env\.GITHUB_RUN_ID\}\.\$\{env\.GITHUB_RUN_ATTEMPT\}`, '90'/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('F1059 Apple JWTs are short-lived verifiable ES256 signatures, never printed', () => {
  const jwt = flight.token(env, 1000);
  const [header, payload, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: 'TESTKEY', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), {
    iss: 'test-issuer', iat: 1000, exp: 1300, aud: 'appstoreconnect-v1',
  });
  assert.equal(crypto.verify('sha256', Buffer.from(`${header}.${payload}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
});

test('F1059 Apple app and build lookups pin bundle, build and marketing identities', async () => {
  const calls = [];
  const api = flight.client(env, async (url, options) => {
    calls.push(url);
    assert.match(options.headers.Authorization, /^Bearer /);
    return { ok: true, json: async () => url.pathname.endsWith('/apps')
      ? { data: [{ id: 'app-id', attributes: { bundleId: 'com.example.bird' } }] }
      : { data: [build('VALID')], included } };
  });
  assert.equal(await api.app('com.example.bird'), 'app-id');
  assert.equal((await api.build('app-id', '538.1', '1.168.0')).id, 'build-id');
  assert.equal(calls[0].searchParams.get('filter[bundleId]'), 'com.example.bird');
  assert.equal(calls[1].searchParams.get('filter[app]'), 'app-id');
  assert.equal(calls[1].searchParams.get('filter[version]'), '538.1');
  await assert.rejects(api.build('app-id', '538.1', '1.169.0'), /version does not match/);
  await assert.rejects(api.build('app-id', '539.1', '1.168.0'), /version does not match/);
  await assert.rejects(api.app('com.example.wrong'), /matching bundle ID/);
});

test('F1059 an absent build is pending, but auth failures and ambiguous identities fail explicitly', async () => {
  const api = flight.client(env, async () => ({ ok: true, json: async () => ({ data: [] }) }));
  assert.equal(await api.build('app-id', '538.1', '1.168.0'), null);
  await assert.rejects(api.app('com.example.bird'), /matching bundle ID/);
  const denied = flight.client(env, async () => ({ ok: false, status: 401 }));
  await assert.rejects(denied.build('app-id', '538.1', '1.168.0'), /HTTP 401/);
  const ambiguous = flight.client(env, async () => ({
    ok: true, json: async () => ({ data: [build('VALID'), build('VALID')], included }),
  }));
  await assert.rejects(ambiguous.build('app-id', '538.1', '1.168.0'), /ambiguous build identity/);
});

test('F1059 upload success is not processing success; only Apple VALID ends polling', async () => {
  const sequence = [null, build('PROCESSING'), build('VALID')];
  const seen = [], sleeps = [];
  const result = await flight.waitForBuild({ build: async () => sequence.shift() },
    'app-id', '538.1', '1.168.0', {
      attempts: 3, sleep: async ms => sleeps.push(ms), progress: state => seen.push(state.processingState),
    });
  assert.equal(result.attributes.processingState, 'VALID');
  assert.deepEqual(seen, ['NOT_YET_VISIBLE', 'PROCESSING', 'VALID']);
  assert.deepEqual(sleeps, [30000, 30000]);
});

test('F1059 processing rejection, unknown state, timeout and transport errors never become available', async () => {
  for (const state of ['INVALID', 'FAILED', 'SURPRISE']) {
    await assert.rejects(flight.waitForBuild({ build: async () => build(state) }, 'app', '538.1', '1.168.0'),
      /rejected build processing|Unknown Apple processing state/);
  }
  await assert.rejects(flight.waitForBuild({ build: async () => build('PROCESSING') },
    'app', '538.1', '1.168.0', { attempts: 1 }), /not verified after 30 minutes/);
  await assert.rejects(flight.waitForBuild({ build: async () => { throw new Error('network failed'); } },
    'app', '538.1', '1.168.0'), /network failed/);
});

test('F1059 only the measured processing-read transport failure retries the same build within the existing budget', async () => {
  const seen = [], sleeps = [], identities = [];
  let reads = 0;
  const result = await flight.waitForBuild({
    build: async (...identity) => {
      identities.push(identity);
      if (++reads === 1) throw new TypeError('fetch failed');
      return build(reads === 2 ? 'PROCESSING' : 'VALID');
    },
  }, 'app-id', '538.1', '1.168.0', {
    attempts: 3, sleep: async ms => sleeps.push(ms), progress: state => seen.push(state),
  });
  assert.equal(result.attributes.processingState, 'VALID');
  assert.deepEqual(seen.map(row => row.processingState), ['STATUS_UNAVAILABLE', 'PROCESSING', 'VALID']);
  assert.equal(seen[0].processingReadError, 'fetch failed');
  assert.deepEqual(sleeps, [30000, 30000]);
  assert.deepEqual(identities, Array.from({ length: 3 }, () => ['app-id', '538.1', '1.168.0']));
});

test('F1059 exhausted transport reads remain unverified; permanent, auth and programming errors fail immediately', async () => {
  const seen = [], sleeps = [];
  let reads = 0;
  await assert.rejects(flight.waitForBuild({
    build: async () => { reads++; throw new TypeError('fetch failed'); },
  }, 'app', '538.1', '1.168.0', {
    attempts: 2, sleep: async ms => sleeps.push(ms), progress: state => seen.push(state.processingState),
  }), /not verified after 30 minutes/);
  assert.equal(reads, 2);
  assert.deepEqual(sleeps, [30000]);
  assert.deepEqual(seen, ['STATUS_UNAVAILABLE', 'STATUS_UNAVAILABLE']);
  for (const error of [
    new Error('fetch failed'), new TypeError('invalid build data'),
    Object.assign(new Error('HTTP 401'), { status: 401 }),
    Object.assign(new Error('HTTP 403'), { status: 403 }),
    new Error('Apple build or marketing version does not match this upload'),
  ]) {
    let calls = 0;
    await assert.rejects(flight.waitForBuild({
      build: async () => { calls++; throw error; },
    }, 'app', '538.1', '1.168.0', {
      sleep: async () => assert.fail('permanent errors must not retry'),
      progress: () => assert.fail('permanent errors must not become pending status'),
    }), candidate => candidate === error);
    assert.equal(calls, 1);
  }
});

test('F1059 archive leaves target-specific signing out of global overrides; export pins identity and build numbers', () => {
  const profile = { team: 'TESTTEAM', uuid: 'profile-uuid' };
  const args = flight.archiveArgs('root', 'work', '1.168.0', '538.1');
  for (const arg of [
    'MARKETING_VERSION=1.168.0',
    'CURRENT_PROJECT_VERSION=538.1', 'archive',
  ]) assert.ok(args.includes(arg), `missing ${arg}`);
  assert.equal(args.some(arg => /^(PROVISIONING_PROFILE|CODE_SIGN|DEVELOPMENT_TEAM)/.test(arg)),
    false, 'global signing overrides leak the app profile/settings into Swift package targets');
  assert.ok(args.find(arg => arg.startsWith('OTHER_CODE_SIGN_FLAGS=')).includes('signing.keychain-db'));
  const options = flight.exportOptions(profile, 'certificate-hash', 'com.example.bird');
  assert.equal(options.method, 'app-store-connect');
  assert.equal(options.signingStyle, 'manual');
  assert.equal(options.signingCertificate, 'certificate-hash');
  assert.deepEqual(options.provisioningProfiles, { 'com.example.bird': 'profile-uuid' });
  assert.equal(options.manageAppVersionAndBuildNumber, false);
});

test('F1059 subprocesses do not inherit signing secrets; public reports omit group links and identities', () => {
  const input = Object.fromEntries([
    'ASC_ISSUER_ID', 'ASC_KEY_ID', 'ASC_PRIVATE_KEY', 'IOS_DISTRIBUTION_P12_BASE64',
    'IOS_DISTRIBUTION_P12_PASSWORD', 'IOS_APP_STORE_PROFILE_BASE64',
  ].map(key => [key, 'synthetic-secret']));
  input.PATH = 'tool-path';
  assert.deepEqual(flight.commandEnv(input), { PATH: 'tool-path' });
  assert.equal(input.ASC_PRIVATE_KEY, 'synthetic-secret');
  assert.deepEqual(flight.betaSummary({
    data: { attributes: { internalBuildState: 'MISSING_EXPORT_COMPLIANCE', externalBuildState: 'PROCESSING' } },
  }, { data: [
    { id: 'private-group', attributes: { isInternalGroup: true, name: 'private-name', publicLink: 'private-link' } },
    { attributes: { isInternalGroup: false } },
  ] }), {
    internalBuildState: 'MISSING_EXPORT_COMPLIANCE', externalBuildState: 'PROCESSING',
    internalGroupCount: 1, groupResultsTruncated: false,
  });
  assert.throws(() => flight.betaSummary({ data: {} }, { data: [] }), /incomplete/);
});

test('F1059 cleanup targets only this numeric workflow identity inside the runner temp directory', () => {
  const temp = path.resolve('runner-temp');
  assert.equal(flight.signingDirectory({
    RUNNER_TEMP: temp, GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '2',
  }), path.join(temp, 'bird-chaser-signing-1234-2'));
  for (const changed of [
    { RUNNER_TEMP: 'relative' }, { GITHUB_RUN_ID: '../../other' }, { GITHUB_RUN_ATTEMPT: '' },
  ]) assert.throws(() => flight.signingDirectory({
    RUNNER_TEMP: temp, GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '2', ...changed,
  }), /absolute runner temp path and numeric workflow identity/);
});

test('F1059 independent signed delivery cannot gate the unsigned Release or its galleries', () => {
  const root = path.join(__dirname, '..');
  const unsigned = fs.readFileSync(path.join(root, '.github', 'workflows', 'ios-build.yml'), 'utf8');
  const signed = fs.readFileSync(path.join(root, '.github', 'workflows', 'testflight.yml'), 'utf8');
  assert.match(unsigned, /name: BirdChaser-ios-project/);
  assert.match(unsigned, /path: ios\//);
  assert.match(unsigned, /CODE_SIGNING_ALLOWED=NO/);
  assert.doesNotMatch(unsigned, /run: node assets\/testflight\.js/);
  assert.match(signed, /workflow_run:/);
  assert.match(signed, /workflows: \[Build unsigned iOS IPA\]/);
  assert.match(signed, /run: node assets\/testflight\.js source/);
  assert.match(signed, /ref: \$\{\{ steps\.source\.outputs\.sha \}\}/);
  assert.match(signed, /run-id: \$\{\{ steps\.source\.outputs\.run_id \}\}/);
  assert.match(signed, /run: node assets\/testflight\.js/);
  assert.match(signed, /if: always\(\)\s+run: node assets\/testflight\.js cleanup/);
  assert.doesNotMatch(signed, /contents: write/);
});
