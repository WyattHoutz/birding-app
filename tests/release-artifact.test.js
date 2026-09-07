'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const bundleVerifierPath = path.join(ROOT, 'assets', 'verify-release-bundle.js');
const assetsVerifierPath = path.join(ROOT, 'assets', 'verify-release-assets.js');

test('F340 the extracted release bundle contract fails closed on exact mutations', () => {
  assert.ok(fs.existsSync(bundleVerifierPath),
    'the release bundle verifier is missing');
  const { verifyBundle } = require(bundleVerifierPath);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'birdchaser-release-'));
  const contract = {
    requiredFiles: ['index.html', 'logic.js'],
    forbiddenFiles: ['.env'],
    requiredText: {
      'index.html': ["APP_VERSION = '${version}'", 'required-marker'],
    },
    forbiddenText: {
      'index.html': ['removed-marker'],
    },
  };
  try {
    fs.writeFileSync(path.join(root, 'index.html'),
      "APP_VERSION = '1.84.0';\nrequired-marker\n");
    fs.writeFileSync(path.join(root, 'logic.js'), "'use strict';\n");
    assert.doesNotThrow(() => verifyBundle(root, '1.84.0', contract));

    fs.rmSync(path.join(root, 'logic.js'));
    assert.throws(() => verifyBundle(root, '1.84.0', contract),
      /required file.*logic\.js/i);
    fs.writeFileSync(path.join(root, 'logic.js'), "'use strict';\n");

    assert.throws(() => verifyBundle(root, '9.9.9', contract),
      /required text.*APP_VERSION/i);
    fs.writeFileSync(path.join(root, 'index.html'),
      "APP_VERSION = '1.84.0';\nremoved-marker\n");
    assert.throws(() => verifyBundle(root, '1.84.0', contract),
      /missing required text.*required-marker/i);
    fs.writeFileSync(path.join(root, 'index.html'),
      "APP_VERSION = '1.84.0';\nrequired-marker\nremoved-marker\n");
    assert.throws(() => verifyBundle(root, '1.84.0', contract),
      /forbidden text.*removed-marker/i);
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=no\n');
    assert.throws(() => verifyBundle(root, '1.84.0', contract),
      /forbidden file.*\.env/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('F340 release asset verification binds names, digest, tag, and commit', () => {
  assert.ok(fs.existsSync(assetsVerifierPath),
    'the release asset verifier is missing');
  const { verifyReleaseAssets } = require(assetsVerifierPath);
  const digest = 'sha256:' + 'a'.repeat(64);
  const release = {
    tagName: 'v1.84.0',
    targetCommitish: 'abc123',
    assets: [
      { name: 'BirdChaser-unsigned.ipa', size: 42, digest },
    ],
  };
  const options = {
    tag: 'v1.84.0',
    sha: 'abc123',
    required: ['BirdChaser-unsigned.ipa'],
    allowed: ['BirdChaser-unsigned.ipa', 'BirdChaser-mockups.zip'],
  };
  assert.deepEqual(verifyReleaseAssets(release, options), {
    'BirdChaser-unsigned.ipa': digest,
  });
  assert.throws(() => verifyReleaseAssets(
    { ...release, tagName: 'v9.9.9' }, options), /tag/i);
  assert.throws(() => verifyReleaseAssets(
    { ...release, targetCommitish: 'wrong' }, options), /commit/i);
  assert.throws(() => verifyReleaseAssets(
    { ...release, assets: [] }, options), /required asset/i);
  assert.throws(() => verifyReleaseAssets({
    ...release,
    assets: release.assets.concat({ name: 'surprise.txt', size: 1, digest }),
  }, options), /unexpected asset/i);
  assert.throws(() => verifyReleaseAssets({
    ...release,
    assets: [{ name: 'BirdChaser-unsigned.ipa', size: 42, digest: null }],
  }, options), /digest/i);
});
