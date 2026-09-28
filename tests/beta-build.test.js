'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

test('F608 CI stamps a 30-day sideload expiry and writes a matching tester guide', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bird-beta-'));
  const infoPath = path.join(temp, 'build-info.js');
  const ipaPath = path.join(temp, 'BirdChaser-unsigned.ipa');
  const guidePath = path.join(temp, 'BirdChaser-beta-guide.txt');
  fs.writeFileSync(ipaPath, 'synthetic ipa');
  const before = Date.now();
  childProcess.execFileSync(process.execPath, [
    path.join(ROOT, 'assets', 'stamp-build-info.js'),
    infoPath, 'sideload', '123.4', '30',
  ], { cwd: ROOT });
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(infoPath, 'utf8'), sandbox);
  const info = sandbox.window.__BUILD_INFO__;
  assert.equal(info.channel, 'sideload');
  assert.equal(info.buildId, '123.4');
  assert.ok(Date.parse(info.expiresAt) - before >= 30 * 86400000 - 5000);

  childProcess.execFileSync(process.execPath, [
    path.join(ROOT, 'assets', 'write-beta-guide.js'),
    ipaPath, infoPath, guidePath,
  ], { cwd: ROOT });
  const guide = fs.readFileSync(guidePath, 'utf8');
  const checksum = crypto.createHash('sha256')
    .update(fs.readFileSync(ipaPath)).digest('hex');
  assert.ok(guide.includes(checksum));
  assert.ok(guide.includes(info.expiresAt));
});

test('F608 native bridge shares ZIPs and captures screenshots only on request', () => {
  const swift = fs.readFileSync(
    path.join(ROOT, 'native', 'ios', 'ViewController.swift'), 'utf8');
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'ios-build.yml'), 'utf8');
  assert.match(swift, /CAPPluginMethod\(name: "captureDiagnosticScreenshot"/);
  assert.match(swift, /CAPPluginMethod\(name: "shareDiagnosticPackage"/);
  assert.match(swift, /Data\(base64Encoded: encoded\)/);
  assert.match(swift, /"completed": completed/);
  assert.match(workflow,
    /stamp-build-info\.js www\/build-info\.js sideload "\$BUILD_ID" 30/);
  assert.match(workflow, /BirdChaser-beta-guide\.txt/);
});
