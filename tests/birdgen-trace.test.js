'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const notifications = require('../www/birdgen-notifications.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'native', 'ios', 'BirdGenNotifications.swift'), 'utf8');

test('F1010 exported native stages are bounded, correlated and allowlisted without raw payload', () => {
  const row = { at: 1800000000000, attempt: '00000000-0000-0000-0000-000000000001',
    stage: 'acquisition', outcome: 'ok', background: true,
    counts: { rows: 500, apiKey: 'SECRET', home: 'PRIVATE' }, profile: 'PRIVATE', url: 'SECRET' };
  const output = notifications.diagnosticTrace(Array.from({ length: 80 }, () => row));
  assert.equal(output.entries.length, 64);
  assert.equal(output.truncated, true);
  assert.equal(output.rejected, 0);
  assert.deepEqual(output.entries[0].counts, { rows: 500 });
  assert.doesNotMatch(JSON.stringify(output), /SECRET|PRIVATE|apiKey|profile|home|url/);
  for (const invalid of [false, 0, 'SECRET', null, { ...row, stage: 'SECRET' }, { ...row, attempt: 'PRIVATE' }]) {
    const rejected = notifications.diagnosticTrace([invalid]);
    assert.equal(rejected.entries.length, 0);
    assert.equal(rejected.rejected, 1);
  }
  assert.equal(notifications.diagnosticTrace(false).rejected, 1);
  assert.equal(notifications.diagnosticTrace(undefined).available, false);
  assert.equal(notifications.diagnosticTrace([{ ...row, counts: { rows: -1 } }]).rejected, 1);
});

function body(name, next) {
  const start = source.indexOf(name), end = source.indexOf(next, start + name.length);
  assert.ok(start >= 0 && end > start, 'native boundary must exist: ' + name);
  return source.slice(start, end);
}

test('F1010 native stage calls sit at real scheduling, launch, acquisition and publication boundaries', () => {
  const schedule = body('private func schedule()', 'private func cancelNotifications()');
  assert.ok(schedule.indexOf('BGTaskScheduler.shared.submit(request)') < schedule.indexOf('record(.schedule, .submitted'));
  assert.match(schedule, /record\(\.schedule, \.failed/);
  assert.match(schedule, /\.earliestMs:/);
  const launch = body('private func start(', 'private func refresh()');
  for (const outcome of ['started', 'busy', 'expired', 'cancelled', 'failed', 'completed']) {
    assert.match(launch, new RegExp('record\\(\\.(?:launch|completion), \\.' + outcome));
  }
  const acquire = body('private func refresh()', 'fileprivate func takeOpen()');
  assert.ok(acquire.indexOf('session.data(for: request)') < acquire.indexOf('record(.acquisition, .ok'));
  assert.match(acquire, /record\(\.acquisition, \.failed/);
  assert.match(acquire, /record\(\.qualification, result\.complete/);
  const publish = body('private func publish(', 'private func start(');
  assert.ok(publish.indexOf('UNNotificationRequest(identifier:') < publish.indexOf('record(.publication, .accepted'));
  assert.match(publish, /record\(\.publication, \.failed/);
  assert.match(publish, /baseline \? \.baseline : fresh\.isEmpty \? \.noEvents/);
  assert.match(source, /"trace": diagnostics\.snapshot\(\)/);
  assert.match(source, /return \[\.banner, \.sound\]/);
});

test('F1010 blocked or skipped work and terminal publication errors remain distinguishable', () => {
  const acquire = body('private func refresh()', 'fileprivate func takeOpen()');
  for (const outcome of ['notConfigured', 'cancelled', 'skipped', 'permissionBlocked']) {
    assert.match(acquire, new RegExp('record\\(\\.acquisition, \\.' + outcome));
  }
  assert.match(acquire, /\.retryUntilMs: Int\(retry\)/);
  const publish = body('private func publish(', 'private func start(');
  assert.match(publish, /record\(\.publication, \.permissionBlocked/);
  const terminal = publish.slice(publish.lastIndexOf('} catch is CancellationError'));
  assert.match(terminal, /record\(\.publication, \.cancelled/);
  assert.match(terminal, /record\(\.publication, \.failed/);
  assert.match(terminal, /throw CancellationError\(\)/);
  assert.match(terminal, /throw error/);
  assert.ok(publish.indexOf('try write(state, config, "state")') < publish.indexOf('} catch is CancellationError'),
    'ledger persistence errors must reach the terminal publication trace too');
});

test('F1010 production Foundation recorder persists a bounded redacted trace', { skip: process.platform !== 'darwin' }, () => {
  const start = source.indexOf('final class BirdNotificationTrace {');
  const end = source.indexOf('private struct BirdNotificationFeed:', start);
  assert.ok(start >= 0 && end > start);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'birdgen-trace-'));
  try {
    const file = path.join(directory, 'trace.swift');
    fs.writeFileSync(file, 'import Foundation\n' + source.slice(start, end) + `
let suite = "birdgen-trace-test-" + UUID().uuidString
let defaults = UserDefaults(suiteName: suite)!
defer { defaults.removePersistentDomain(forName: suite) }
let recorder = BirdNotificationTrace(defaults: defaults)
recorder.beginAttempt()
for _ in 0..<80 { recorder.record(.acquisition, .ok, background: true, counts: [.rows: 500]) }
precondition(recorder.snapshot().count == 64)
precondition(!recorder.storageFailed)
let restored = BirdNotificationTrace(defaults: defaults)
precondition(restored.snapshot().count == 64)
precondition(restored.snapshot().last!["attempt"] as? String == recorder.snapshot().last!["attempt"] as? String)
let data = try JSONSerialization.data(withJSONObject: restored.snapshot())
let text = String(data: data, encoding: .utf8)!
precondition(!text.contains("apiKey") && !text.contains("profile") && !text.contains("context"))
precondition(text.contains("acquisition") && text.contains("500"))
print("native trace persistence OK")
`);
    const result = spawnSync('swift', [file], { encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /native trace persistence OK/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
