#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

function combined(result) {
  return String((result && result.stdout) || '')
    + '\n' + String((result && result.stderr) || '');
}

function resourceExists(label, result) {
  if (result && result.status === 0) return true;
  const text = combined(result);
  if (/\bHTTP(?:\/[0-9.]+)?\s+404\b|\(HTTP 404\)/i.test(text)) return false;
  throw new Error(`Could not determine whether ${label} exists: ${text.trim()}`);
}

function refExists(result) {
  return resourceExists('tag', result);
}

function runGh(args) {
  return spawnSync('gh', args, { encoding: 'utf8' });
}

function checkTag(tag, currentSha, run) {
  run = run || runGh;
  const repo = process.env.GITHUB_REPOSITORY || 'owner/repo';
  const ref = run(['api', '--include', `repos/${repo}/git/ref/tags/${tag}`]);
  if (!refExists(ref)) return { exists: false };

  const commit = run(['api', `repos/${repo}/commits/${tag}`, '--jq', '.sha']);
  if (!commit || commit.status !== 0) {
    throw new Error('Could not resolve tagged commit: ' + combined(commit).trim());
  }
  const tagSha = String(commit.stdout || '').trim();
  if (!tagSha) throw new Error('Could not resolve tagged commit: empty SHA');
  if (tagSha.toLowerCase() !== String(currentSha || '').trim().toLowerCase()) {
    throw new Error(`${tag} already points to ${tagSha}, not ${currentSha}. `
      + 'Bump package.json before shipping another commit.');
  }
  return { exists: true, sha: tagSha };
}

function checkReleaseState(tag, currentSha, run) {
  run = run || runGh;
  const repo = process.env.GITHUB_REPOSITORY || 'owner/repo';
  const tagState = checkTag(tag, currentSha, run);
  if (!tagState.exists) return { tagExists: false, releaseExists: false };

  const release = run(['api', '--include', `repos/${repo}/releases/tags/${tag}`]);
  return {
    tagExists: true,
    releaseExists: resourceExists('Release', release),
    sha: tagState.sha,
  };
}

if (require.main === module) {
  try {
    const result = checkReleaseState(process.argv[2] || '', process.argv[3] || '');
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT,
        `exists=${result.releaseExists ? 'true' : 'false'}\n`);
    }
    console.log(result.releaseExists
      ? `${process.argv[2]} already has a Release for this commit`
      : (result.tagExists
          ? `${process.argv[2]} points to this commit but has no Release yet`
          : `${process.argv[2]} does not exist yet`));
  } catch (error) {
    console.error(`::error::${error.message || error}`);
    process.exit(1);
  }
}

module.exports = { checkReleaseState, checkTag, refExists, resourceExists };
