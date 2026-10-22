'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verifyBundle } = require('./verify-release-bundle.js');

const SECRET_NAMES = [
  'ASC_ISSUER_ID', 'ASC_KEY_ID', 'ASC_PRIVATE_KEY',
  'IOS_DISTRIBUTION_P12_BASE64', 'IOS_DISTRIBUTION_P12_PASSWORD',
  'IOS_APP_STORE_PROFILE_BASE64',
];

function buildNumber(run, attempt) {
  if (!/^[1-9]\d{0,3}$/.test(String(run)) || !/^[1-9]\d?$/.test(String(attempt))) {
    throw new Error('Build number requires run 1-9999 and attempt 1-99');
  }
  return `${run}.${attempt}`;
}

function token(env, now = Math.floor(Date.now() / 1000)) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' });
  const payload = encode({
    iss: env.ASC_ISSUER_ID, iat: now, exp: now + 300, aud: 'appstoreconnect-v1',
  });
  const input = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(input), {
    key: env.ASC_PRIVATE_KEY, dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${input}.${signature}`;
}

function client(env, fetcher = fetch) {
  async function get(resource, query = {}) {
    const url = new URL(`https://api.appstoreconnect.apple.com/v1/${resource}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token(env)}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      const error = new Error(`App Store Connect ${resource}: HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  return {
    async app(bundleId) {
      const result = await get('apps', { 'filter[bundleId]': bundleId, limit: '2' });
      if (!Array.isArray(result.data) || result.data.length !== 1
          || result.data[0].attributes?.bundleId !== bundleId) {
        throw new Error('App Store Connect did not identify exactly one matching bundle ID');
      }
      return result.data[0].id;
    },
    async build(appId, number, version) {
      const result = await get('builds', {
        'filter[app]': appId, 'filter[version]': number,
        include: 'preReleaseVersion', limit: '2',
      });
      if (!Array.isArray(result.data) || result.data.length > 1) {
        throw new Error('App Store Connect returned ambiguous build identity');
      }
      if (!result.data.length) return null;
      const build = result.data[0];
      const releaseId = build.relationships?.preReleaseVersion?.data?.id;
      const release = (result.included || []).find(row =>
        row.type === 'preReleaseVersions' && row.id === releaseId);
      if (build.attributes?.version !== number || release?.attributes?.version !== version) {
        throw new Error('Apple build or marketing version does not match this upload');
      }
      return build;
    },
    betaDetail: id => get(`builds/${encodeURIComponent(id)}/buildBetaDetail`),
    groups: id => get(`builds/${encodeURIComponent(id)}/betaGroups`, { limit: '200' }),
  };
}

async function waitForBuild(api, appId, number, version, {
  attempts = 60, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  progress = () => {},
} = {}) {
  for (let i = 0; i < attempts; i++) {
    let build;
    try {
      build = await api.build(appId, number, version);
    } catch (error) {
      if (!(error instanceof TypeError) || error.message !== 'fetch failed') throw error;
      progress({ processingState: 'STATUS_UNAVAILABLE', processingReadError: error.message });
      if (i + 1 < attempts) await sleep(30000);
      continue;
    }
    const state = build?.attributes?.processingState || 'NOT_YET_VISIBLE';
    progress({ buildId: build?.id || null, processingState: state });
    if (state === 'VALID') return build;
    if (state === 'FAILED' || state === 'INVALID') {
      throw new Error(`Apple rejected build processing: ${state}`);
    }
    if (state !== 'PROCESSING' && state !== 'NOT_YET_VISIBLE') {
      throw new Error(`Unknown Apple processing state: ${state}`);
    }
    if (i + 1 < attempts) await sleep(30000);
  }
  throw new Error('Apple processing is not verified after 30 minutes; inspect the uploaded build, do not assume availability');
}

function configureAppSigning(root, profile, identity, bundleId) {
  const file = path.join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  const project = require('xcode').project(file);
  project.parseSync();
  const unquote = value => String(value || '').replace(/^"(.*)"$/, '$1');
  const targets = Object.values(project.pbxNativeTargetSection() || {}).filter(target =>
    target?.isa === 'PBXNativeTarget' && unquote(target.name) === 'App'
      && unquote(target.productType) === 'com.apple.product-type.application');
  if (targets.length !== 1) throw new Error('Signing requires exactly one App application target');
  const list = project.pbxXCConfigurationList()?.[targets[0].buildConfigurationList];
  const configurations = project.pbxXCBuildConfigurationSection() || {};
  const release = (list?.buildConfigurations || []).map(ref => configurations[ref.value])
    .filter(config => config?.isa === 'XCBuildConfiguration' && unquote(config.name) === 'Release');
  if (release.length !== 1 || unquote(release[0].buildSettings?.PRODUCT_BUNDLE_IDENTIFIER) !== bundleId) {
    throw new Error('Signing requires the App Release configuration with the exact bundle ID');
  }
  Object.assign(release[0].buildSettings, {
    CODE_SIGNING_ALLOWED: 'YES', CODE_SIGNING_REQUIRED: 'YES',
    CODE_SIGN_STYLE: 'Manual', DEVELOPMENT_TEAM: profile.team,
    CODE_SIGN_IDENTITY: identity, PROVISIONING_PROFILE_SPECIFIER: profile.uuid,
  });
  fs.writeFileSync(file, project.writeSync());
}

function archiveArgs(root, work, version, number) {
  return [
    '-project', path.join(root, 'ios', 'App', 'App.xcodeproj'),
    '-scheme', 'App', '-configuration', 'Release', '-sdk', 'iphoneos',
    '-destination', 'generic/platform=iOS',
    '-derivedDataPath', path.join(work, 'derived'),
    '-archivePath', path.join(work, 'BirdChaser.xcarchive'),
    `OTHER_CODE_SIGN_FLAGS=--keychain "${path.join(work, 'signing.keychain-db')}"`,
    `MARKETING_VERSION=${version}`, `CURRENT_PROJECT_VERSION=${number}`, 'archive',
  ];
}

function exportOptions(profile, identity, bundleId) {
  return {
    method: 'app-store-connect', destination: 'export', signingStyle: 'manual',
    teamID: profile.team, signingCertificate: identity,
    provisioningProfiles: { [bundleId]: profile.uuid },
    manageAppVersionAndBuildNumber: false, stripSwiftSymbols: true, uploadSymbols: true,
  };
}

function commandEnv(env) {
  const clean = { ...env };
  for (const name of SECRET_NAMES) delete clean[name];
  return clean;
}

function betaSummary(detail, groups) {
  if (!detail.data?.attributes?.internalBuildState) {
    throw new Error('Apple internal-testing eligibility response is incomplete');
  }
  const summary = {
    internalBuildState: detail.data.attributes.internalBuildState,
    externalBuildState: detail.data.attributes.externalBuildState || 'UNKNOWN',
  };
  if (groups) {
    if (!Array.isArray(groups.data)) throw new Error('Apple beta-group response is incomplete');
    summary.internalGroupCount = groups.data.filter(row => row.attributes?.isInternalGroup === true).length;
    summary.groupResultsTruncated = Boolean(groups.links?.next);
  }
  return summary;
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    env: commandEnv(process.env), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options,
  });
  if (result.error || result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stderr.write(result.stdout);
    throw new Error(`${path.basename(program)} failed (${result.status ?? 'could not start'})`);
  }
  return result.stdout || '';
}

function keychainList(text) {
  return [...text.matchAll(/"([^"]+)"/g)].map(match => match[1]);
}

function signingDirectory(env) {
  if (!env.RUNNER_TEMP || !path.isAbsolute(env.RUNNER_TEMP)
      || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID || '')
      || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT || '')) {
    throw new Error('Signing cleanup requires an absolute runner temp path and numeric workflow identity');
  }
  return path.join(env.RUNNER_TEMP, `bird-chaser-signing-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`);
}

function cleanupSigning(env, state) {
  const work = signingDirectory(env);
  if (!fs.existsSync(work)) return;
  const journal = path.join(work, 'cleanup.json');
  const owned = state || (fs.existsSync(journal) ? JSON.parse(fs.readFileSync(journal, 'utf8')) : null);
  const failures = [];
  const cleanup = operation => { try { operation(); } catch (error) { failures.push(error.message); } };
  if (owned) {
    if (owned.profile) {
      const profileDir = path.join(os.homedir(), 'Library', 'MobileDevice', 'Provisioning Profiles');
      if (path.dirname(owned.profile) !== profileDir
          || !/^[A-Fa-f0-9-]{36}\.mobileprovision$/.test(path.basename(owned.profile))) {
        throw new Error('Cleanup refused a profile outside the owned provisioning-profile path');
      }
      cleanup(() => { if (fs.existsSync(owned.profile)) fs.unlinkSync(owned.profile); });
    }
    if (Array.isArray(owned.keychains)) {
      cleanup(() => run('security', ['list-keychains', '-d', 'user', '-s', ...owned.keychains]));
    }
  }
  const keychain = path.join(work, 'signing.keychain-db');
  cleanup(() => { if (fs.existsSync(keychain)) run('security', ['delete-keychain', keychain]); });
  cleanup(() => fs.rmSync(work, { recursive: true, force: true }));
  if (failures.length) throw new Error(`Signing cleanup failed: ${failures.join('; ')}`);
}

function sourceRun(run, repository) {
  if (run.repository?.full_name !== repository || run.path !== '.github/workflows/ios-build.yml'
      || run.head_branch !== 'main' || run.event !== 'push' || run.conclusion !== 'success'
      || !/^[a-f0-9]{40}$/.test(run.head_sha) || !Number.isSafeInteger(run.id) || run.id <= 0) {
    throw new Error('Signing requires a successful main-push IPA run from this repository');
  }
  return { sha: run.head_sha, runId: String(run.id) };
}

async function resolveSource() {
  const env = process.env;
  if (!/^[1-9]\d*$/.test(env.UNSIGNED_RUN_ID || '')) throw new Error('Invalid source run ID');
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.UNSIGNED_RUN_ID}`, {
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(60000),
    });
  if (!response.ok) throw new Error(`Source-run lookup failed: HTTP ${response.status}`);
  const source = sourceRun(await response.json(), env.GITHUB_REPOSITORY);
  fs.appendFileSync(env.GITHUB_OUTPUT, `sha=${source.sha}\nrun_id=${source.runId}\n`);
}

async function deliver() {
  if (process.platform !== 'darwin') throw new Error('Signed delivery requires a macOS Xcode runner');
  for (const name of SECRET_NAMES) {
    if (!process.env[name]) throw new Error(`Required signing/upload secret is missing: ${name}`);
  }
  const env = process.env;
  const root = path.resolve(__dirname, '..');
  const version = require('../package.json').version;
  const bundleId = require('../capacitor.config.json').appId;
  if (!/^[a-f0-9]{40}$/.test(env.TESTFLIGHT_SOURCE_SHA || '')
      || run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim() !== env.TESTFLIGHT_SOURCE_SHA) {
    throw new Error('Signed checkout does not match the verified unsigned source commit');
  }
  const number = buildNumber(env.GITHUB_RUN_NUMBER, env.GITHUB_RUN_ATTEMPT);
  const api = client(env);
  const appId = await api.app(bundleId);
  if (await api.build(appId, number, version)) {
    throw new Error('This Apple build number already exists; rerun the workflow for a new run attempt');
  }
  const reportPath = path.join(root, 'testflight-status.json');
  const report = {
    version, number, bundleId, appId, commit: env.TESTFLIGHT_SOURCE_SHA,
    url: `https://appstoreconnect.apple.com/apps/${appId}/testflight/ios`,
    processingState: 'NOT_UPLOADED', signatureVerified: false,
  };
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  save();
  const work = signingDirectory(env);
  fs.mkdirSync(work, { mode: 0o700 });
  const keychain = path.join(work, 'signing.keychain-db');
  const owned = { keychains: null, profile: null };
  let originalFailure = null;
  try {
    owned.keychains = keychainList(run('security', ['list-keychains', '-d', 'user']));
    const journal = () => fs.writeFileSync(path.join(work, 'cleanup.json'), JSON.stringify(owned), { mode: 0o600 });
    journal();
    fs.chmodSync(work, 0o700);
    const p12 = path.join(work, 'identity.p12');
    const profileFile = path.join(work, 'profile.mobileprovision');
    const profilePlist = path.join(work, 'profile.plist');
    fs.writeFileSync(p12, Buffer.from(env.IOS_DISTRIBUTION_P12_BASE64, 'base64'), { mode: 0o600 });
    fs.writeFileSync(profileFile, Buffer.from(env.IOS_APP_STORE_PROFILE_BASE64, 'base64'), { mode: 0o600 });
    run('security', ['cms', '-D', '-i', profileFile, '-o', profilePlist]);
    const profile = JSON.parse(run('python3', [
      path.join(root, 'assets', 'testflight-profile.py'), 'profile', profilePlist, bundleId,
    ]));
    const password = crypto.randomBytes(32).toString('base64url');
    console.log(`::add-mask::${password}`);
    run('security', ['create-keychain', '-p', password, keychain]);
    run('security', ['set-keychain-settings', '-lut', '3600', keychain]);
    run('security', ['unlock-keychain', '-p', password, keychain]);
    run('security', ['import', p12, '-k', keychain, '-P', env.IOS_DISTRIBUTION_P12_PASSWORD,
      '-T', '/usr/bin/codesign', '-T', '/usr/bin/security']);
    run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:',
      '-s', '-k', password, keychain]);
    run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...owned.keychains]);
    const identities = run('security', ['find-identity', '-v', '-p', 'codesigning', keychain]);
    const matching = profile.certificateSha1.filter(hash => identities.includes(hash));
    if (matching.length !== 1) throw new Error('No unique valid signing identity matches the profile');
    const identity = matching[0];
    const profileDir = path.join(os.homedir(), 'Library', 'MobileDevice', 'Provisioning Profiles');
    fs.mkdirSync(profileDir, { recursive: true });
    const targetProfile = path.join(profileDir, `${profile.uuid}.mobileprovision`);
    fs.writeFileSync(targetProfile, fs.readFileSync(profileFile), { flag: 'wx', mode: 0o600 });
    owned.profile = targetProfile;
    journal();

    run(process.execPath, [path.join(root, 'assets', 'stamp-build-info.js'),
      path.join(root, 'ios', 'App', 'App', 'public', 'build-info.js'),
      'testflight', `${env.GITHUB_RUN_ID}.${env.GITHUB_RUN_ATTEMPT}`, '90']);
    run(process.execPath, [
      path.join(root, 'native', 'ios', 'install-hidden-window-diagnostics.js'), root,
    ], { stdio: 'inherit' });
    configureAppSigning(root, profile, identity, bundleId);
    run('xcodebuild', archiveArgs(root, work, version, number), { stdio: 'inherit' });
    const optionsJson = path.join(work, 'export-options.json');
    const optionsPlist = path.join(work, 'export-options.plist');
    fs.writeFileSync(optionsJson, JSON.stringify(exportOptions(profile, identity, bundleId)));
    run('plutil', ['-convert', 'xml1', '-o', optionsPlist, optionsJson]);
    const exported = path.join(work, 'exported');
    run('xcodebuild', ['-exportArchive', '-archivePath', path.join(work, 'BirdChaser.xcarchive'),
      '-exportOptionsPlist', optionsPlist, '-exportPath', exported], { stdio: 'inherit' });
    const ipas = fs.readdirSync(exported).filter(file => file.endsWith('.ipa'));
    if (ipas.length !== 1) throw new Error('Export did not produce exactly one signed IPA');
    const ipa = path.join(root, 'BirdChaser-TestFlight.ipa');
    fs.copyFileSync(path.join(exported, ipas[0]), ipa);
    const unpacked = path.join(work, 'verified');
    run('unzip', ['-q', ipa, '-d', unpacked]);
    const apps = fs.readdirSync(path.join(unpacked, 'Payload')).filter(file => file.endsWith('.app'));
    if (apps.length !== 1) throw new Error('Signed IPA does not contain exactly one app');
    const app = path.join(unpacked, 'Payload', apps[0]);
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
    const entitlements = path.join(work, 'signed-entitlements.plist');
    fs.writeFileSync(entitlements, run('codesign', ['-d', '--entitlements', ':-', app]));
    const embedded = path.join(work, 'embedded.plist');
    run('security', ['cms', '-D', '-i', path.join(app, 'embedded.mobileprovision'), '-o', embedded]);
    run('python3', [path.join(root, 'assets', 'testflight-profile.py'), 'verify',
      path.join(app, 'Info.plist'), embedded, entitlements, bundleId, version, number, profile.uuid]);
    const certPrefix = path.join(work, 'signed-certificate');
    run('codesign', ['-d', `--extract-certificates=${certPrefix}`, app]);
    const signedIdentity = crypto.createHash('sha1').update(fs.readFileSync(`${certPrefix}0`))
      .digest('hex').toUpperCase();
    if (signedIdentity !== identity) throw new Error('Exported IPA signature uses a different certificate');
    verifyBundle(path.join(app, 'public'), version,
      require('./release-contract.json'));
    const stamp = fs.readFileSync(path.join(app, 'public', 'build-info.js'), 'utf8');
    if (!stamp.includes('"channel": "testflight"')) throw new Error('Signed IPA has the wrong delivery channel');
    report.signatureVerified = true;
    report.ipaSha256 = crypto.createHash('sha256').update(fs.readFileSync(ipa)).digest('hex');
    save();

    const keys = path.join(work, 'private_keys');
    fs.mkdirSync(keys, { mode: 0o700 });
    if (!/^[A-Za-z0-9]+$/.test(env.ASC_KEY_ID)) throw new Error('Invalid App Store Connect key ID');
    fs.writeFileSync(path.join(keys, `AuthKey_${env.ASC_KEY_ID}.p8`), env.ASC_PRIVATE_KEY, { mode: 0o600 });
    const auth = ['--apiKey', env.ASC_KEY_ID, '--apiIssuer', env.ASC_ISSUER_ID];
    run('xcrun', ['altool', '--validate-app', '--type', 'ios', '--file', ipa, ...auth],
      { cwd: work, stdio: 'inherit' });
    run('xcrun', ['altool', '--upload-app', '--type', 'ios', '--file', ipa, ...auth],
      { cwd: work, stdio: 'inherit' });
    report.processingState = 'UPLOADED';
    save();
    const build = await waitForBuild(api, appId, number, version, {
      progress: state => { Object.assign(report, state); save(); },
    });
    report.buildId = build.id;
    const eligibility = {};
    for (const [key, load] of [
      ['betaDetail', () => api.betaDetail(build.id)],
      ['betaGroups', () => api.groups(build.id)],
    ]) {
      try {
        eligibility[key] = await load();
      } catch (error) {
        if (error.status !== 403) throw error;
        report[`${key}Unavailable`] = { status: error.status, message: error.message };
      }
    }
    if (eligibility.betaDetail) {
      Object.assign(report, betaSummary(eligibility.betaDetail, eligibility.betaGroups));
    }
    save();
    console.log(`Apple processed ${version} (${number}): VALID. Internal-testing eligibility is recorded separately.`);
  } catch (error) {
    originalFailure = error;
    report.error = error.message;
    save();
    throw error;
  } finally {
    try {
      cleanupSigning(env, owned);
    } catch (error) {
      throw new Error(`${originalFailure ? originalFailure.message + '; ' : ''}${error.message}`);
    }
  }
}

if (require.main === module) {
  (process.argv[2] === 'source' ? resolveSource()
    : process.argv[2] === 'cleanup' ? Promise.resolve().then(() => cleanupSigning(process.env))
      : deliver())
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = {
  buildNumber, token, client, waitForBuild, configureAppSigning, archiveArgs, exportOptions, sourceRun,
  commandEnv, betaSummary,
  signingDirectory,
  deliver,
};
