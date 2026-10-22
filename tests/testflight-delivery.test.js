'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

async function deliveryFixture(failArchive) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bird-flight-delivery-'));
  const root = path.join(temp, 'app'), home = path.join(temp, 'home');
  const runner = path.join(temp, 'runner');
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'testflight.js'), 'utf8');
  const calls = [];
  const certificate = Buffer.from('synthetic public certificate');
  const identity = crypto.createHash('sha1').update(certificate).digest('hex').toUpperCase();
  const profile = { uuid: '12345678-1234-1234-1234-123456789ABC', team: 'TESTTEAM', certificateSha1: [identity] };
  const sha = 'a'.repeat(40);
  fs.mkdirSync(path.join(root, 'ios', 'App', 'App', 'public'), { recursive: true });
  fs.mkdirSync(runner, { recursive: true });
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const env = {
    PATH: 'synthetic-path', ASC_ISSUER_ID: 'synthetic-issuer', ASC_KEY_ID: 'TESTKEY',
    ASC_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    IOS_DISTRIBUTION_P12_BASE64: Buffer.from('synthetic-p12').toString('base64'),
    IOS_DISTRIBUTION_P12_PASSWORD: 'synthetic-password',
    IOS_APP_STORE_PROFILE_BASE64: Buffer.from('synthetic-profile').toString('base64'),
    GITHUB_RUN_ID: '123', GITHUB_RUN_NUMBER: '538', GITHUB_RUN_ATTEMPT: '1',
    TESTFLIGHT_SOURCE_SHA: sha, RUNNER_TEMP: runner,
  };
  let uploaded = false, processingReads = 0;
  const spawnSync = (program, args, options) => {
    calls.push({ program, args });
    for (const name of ['ASC_PRIVATE_KEY', 'IOS_DISTRIBUTION_P12_PASSWORD', 'IOS_APP_STORE_PROFILE_BASE64']) {
      assert.equal(options.env[name], undefined, 'a subprocess inherited signing material');
    }
    let stdout = '';
    if (program === 'git') stdout = sha;
    if (program === 'security' && args[0] === 'list-keychains') stdout = '"original.keychain"';
    if (program === 'security' && args[0] === 'create-keychain') fs.writeFileSync(args.at(-1), 'synthetic');
    if (program === 'security' && args[0] === 'find-identity') stdout = identity;
    if (program === 'python3' && args[1] === 'profile') stdout = JSON.stringify(profile);
    if (program === process.execPath) fs.writeFileSync(args[1], 'window.__BUILD_INFO__ = {"channel": "testflight"};');
    if (program === 'xcodebuild' && args.at(-1) === 'archive' && failArchive) {
      return { status: 1, stdout: '', stderr: '' };
    }
    if (program === 'xcodebuild' && args[0] === '-exportArchive') {
      const exported = args[args.indexOf('-exportPath') + 1];
      fs.mkdirSync(exported);
      fs.writeFileSync(path.join(exported, 'App.ipa'), 'synthetic-ipa');
    }
    if (program === 'unzip') {
      const app = path.join(args.at(-1), 'Payload', 'App.app');
      fs.mkdirSync(path.join(app, 'public'), { recursive: true });
      fs.copyFileSync(path.join(root, 'ios', 'App', 'App', 'public', 'build-info.js'),
        path.join(app, 'public', 'build-info.js'));
    }
    if (program === 'codesign' && args.some(arg => arg.startsWith('--extract-certificates='))) {
      fs.writeFileSync(args.find(arg => arg.startsWith('--extract-certificates=')).split('=')[1] + '0', certificate);
    }
    if (program === 'xcrun' && args.includes('--upload-app')) {
      const keys = path.join(options.cwd, 'private_keys');
      assert.ok(fs.existsSync(path.join(keys, 'AuthKey_TESTKEY.p8')));
      uploaded = true;
    }
    return { status: 0, stdout, stderr: '' };
  };
  const fetcher = async url => {
    const resource = url.pathname;
    let result;
    if (resource.endsWith('/apps')) result = { data: [{ id: 'app-id', attributes: { bundleId: 'com.example.bird' } }] };
    else if (resource.endsWith('/buildBetaDetail')) result = {
      data: { attributes: { internalBuildState: 'MISSING_EXPORT_COMPLIANCE' } },
    };
    else if (resource.endsWith('/betaGroups')) result = {
      data: [{ id: 'private-id', attributes: { isInternalGroup: true, name: 'private-name', publicLink: 'private-link' } }],
    };
    else result = {
      data: uploaded ? [{
        id: 'build-id', attributes: { version: '538.1', processingState: ++processingReads === 1 ? 'PROCESSING' : 'VALID' },
        relationships: { preReleaseVersion: { data: { id: 'release-id' } } },
      }] : [],
      included: [{ id: 'release-id', type: 'preReleaseVersions', attributes: { version: '1.168.0' } }],
    };
    return { ok: true, json: async () => result };
  };
  const customRequire = name => {
    if (name === 'node:child_process') return { spawnSync };
    if (name === 'node:os') return { ...os, homedir: () => home };
    if (name === '../package.json') return { version: '1.168.0' };
    if (name === '../capacitor.config.json') return { appId: 'com.example.bird' };
    if (name === './release-contract.json') return {};
    if (name === './verify-release-bundle.js') return {
      verifyBundle: () => { calls.push({ program: 'verifyBundle', args: [] }); },
    };
    return require(name);
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    require: customRequire, module, __dirname: path.join(root, 'assets'),
    process: { platform: 'darwin', env, execPath: process.execPath, stderr: { write() {} } },
    console: { log() {} }, Buffer, URL, AbortSignal, fetch: fetcher,
    setTimeout: callback => queueMicrotask(callback),
  });
  try {
    if (failArchive) await assert.rejects(module.exports.deliver(), /xcodebuild failed/);
    else await assert.doesNotReject(module.exports.deliver());
    assert.equal(fs.existsSync(path.join(runner, 'bird-chaser-signing-123-1')), false,
      'temporary private keys/keychain remained after delivery');
    assert.equal(fs.existsSync(path.join(home, 'Library', 'MobileDevice', 'Provisioning Profiles',
      profile.uuid + '.mobileprovision')), false, 'installed profile remained after delivery');
    const reportText = fs.readFileSync(path.join(root, 'testflight-status.json'), 'utf8');
    assert.doesNotMatch(reportText, /private-link|private-name|private-id|synthetic-password/);
    return { calls, report: JSON.parse(reportText), uploaded };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('F1059 delivery verifies signed contents before validation/upload, waits for Apple and preserves manual compliance state', async () => {
  const result = await deliveryFixture(false);
  assert.equal(result.uploaded, true);
  assert.equal(result.report.signatureVerified, true);
  assert.equal(result.report.processingState, 'VALID');
  assert.equal(result.report.internalBuildState, 'MISSING_EXPORT_COMPLIANCE');
  assert.equal(result.report.internalGroupCount, 1);
  assert.equal(result.report.commit, 'a'.repeat(40));
  const index = predicate => result.calls.findIndex(predicate);
  const signature = index(call => call.program === 'codesign' && call.args.includes('--verify'));
  const profile = index(call => call.program === 'python3' && call.args[1] === 'verify');
  const contents = index(call => call.program === 'verifyBundle');
  const validate = index(call => call.program === 'xcrun' && call.args.includes('--validate-app'));
  const upload = index(call => call.program === 'xcrun' && call.args.includes('--upload-app'));
  assert.ok(signature >= 0 && profile > signature && contents > profile && validate > contents && upload > validate);
  assert.ok(result.calls.some(call => call.program === 'security' && call.args[0] === 'delete-keychain'));
});

test('F1059 archive failure cannot upload and still removes the keychain, private files and installed profile', async () => {
  const result = await deliveryFixture(true);
  assert.equal(result.uploaded, false);
  assert.equal(result.report.signatureVerified, false);
  assert.equal(result.report.processingState, 'NOT_UPLOADED');
  assert.match(result.report.error, /xcodebuild failed/);
  assert.ok(result.calls.some(call => call.program === 'security' && call.args[0] === 'delete-keychain'));
});
