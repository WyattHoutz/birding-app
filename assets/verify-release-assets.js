#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

function list(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function verifyReleaseAssets(release, options) {
  options = options || {};
  if (!release || typeof release !== 'object') {
    throw new Error('Release metadata is missing or invalid');
  }
  if (release.tagName !== options.tag) {
    throw new Error(`Release tag is ${release.tagName}, not ${options.tag}`);
  }
  if (String(release.targetCommitish || '').toLowerCase()
      !== String(options.sha || '').toLowerCase()) {
    throw new Error(`Release commit is ${release.targetCommitish}, not ${options.sha}`);
  }
  if (!Array.isArray(release.assets)) throw new Error('Release assets are missing');

  const required = new Set(options.required || []);
  const allowed = new Set(options.allowed || options.required || []);
  const found = {};
  for (const asset of release.assets) {
    const name = String((asset && asset.name) || '');
    if (!name) throw new Error('Release contains an unnamed asset');
    if (Object.prototype.hasOwnProperty.call(found, name)) {
      throw new Error(`Release contains duplicate asset: ${name}`);
    }
    if (!allowed.has(name)) throw new Error(`Release contains unexpected asset: ${name}`);
    if (!(Number(asset.size) > 0)) throw new Error(`Release asset is empty: ${name}`);
    const digest = String(asset.digest || '').toLowerCase();
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`Release asset has no valid SHA-256 digest: ${name}`);
    }
    found[name] = digest;
  }
  for (const name of required) {
    if (!Object.prototype.hasOwnProperty.call(found, name)) {
      throw new Error(`Release is missing required asset: ${name}`);
    }
  }
  return found;
}

if (require.main === module) {
  const release = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const result = verifyReleaseAssets(release, {
    tag: process.argv[3],
    sha: process.argv[4],
    required: list(process.argv[5]),
    allowed: list(process.argv[6]),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { verifyReleaseAssets };
