#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONTRACT = path.join(__dirname, 'release-contract.json');

function safePath(root, relative) {
  const rel = String(relative || '').replace(/\\/g, '/');
  if (!rel || path.isAbsolute(rel) || rel.split('/').includes('..')) {
    throw new Error(`Invalid release-contract path: ${relative}`);
  }
  const resolved = path.resolve(root, ...rel.split('/'));
  const base = path.resolve(root) + path.sep;
  if (!resolved.startsWith(base)) {
    throw new Error(`Release-contract path escapes the bundle: ${relative}`);
  }
  return resolved;
}

function withVersion(value, version) {
  return String(value).split('${version}').join(String(version));
}

function verifyBundle(root, version, contract) {
  if (!root || !fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Release public directory does not exist: ${root}`);
  }
  if (!version) throw new Error('Expected release version is empty');
  if (!contract || typeof contract !== 'object') {
    throw new Error('Release contract is missing or invalid');
  }

  const checked = { files: 0, requiredText: 0, forbiddenText: 0 };
  for (const relative of contract.requiredFiles || []) {
    const file = safePath(root, relative);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Missing required file: ${relative}`);
    }
    checked.files++;
  }
  for (const relative of contract.forbiddenFiles || []) {
    const file = safePath(root, relative);
    if (fs.existsSync(file)) throw new Error(`Found forbidden file: ${relative}`);
  }

  for (const [relative, markers] of Object.entries(contract.requiredText || {})) {
    const file = safePath(root, relative);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Missing required text file: ${relative}`);
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const marker of markers) {
      const expected = withVersion(marker, version);
      if (!text.includes(expected)) {
        throw new Error(`Missing required text in ${relative}: ${expected}`);
      }
      checked.requiredText++;
    }
  }
  for (const [relative, markers] of Object.entries(contract.forbiddenText || {})) {
    const file = safePath(root, relative);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const marker of markers) {
      const forbidden = withVersion(marker, version);
      if (text.includes(forbidden)) {
        throw new Error(`Found forbidden text in ${relative}: ${forbidden}`);
      }
      checked.forbiddenText++;
    }
  }
  return checked;
}

if (require.main === module) {
  const root = process.argv[2];
  const version = process.argv[3];
  const contractPath = process.argv[4] || DEFAULT_CONTRACT;
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const checked = verifyBundle(root, version, contract);
  console.log(`release bundle OK - ${checked.files} files, `
    + `${checked.requiredText} required markers, `
    + `${checked.forbiddenText} forbidden markers absent`);
}

module.exports = { safePath, verifyBundle, withVersion };
