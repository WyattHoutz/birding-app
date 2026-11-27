'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { gunzipSync, gzipSync } = require('node:zlib');
const { analyzeSwift } = require('../assets/check-persistence.js');
if (process.env.BIRDGEN_REQUIRE_NATIVE_PERSISTENCE === '1') {
  assert.equal(process.platform, 'darwin', 'required native proofs must execute on macOS, not skip');
}

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'native', 'ios', 'BirdGenNotifications.swift'), 'utf8')
  .replace(/\r\n/g, '\n');
const start = source.indexOf('enum BirdNotificationPersistence {');
const end = source.indexOf('\n\nprivate let birdGenNotificationPendingOpenKey', start);
const traceStart = source.indexOf('final class BirdNotificationTrace {');
const traceEnd = source.indexOf('private struct BirdNotificationFeed:', traceStart);
assert.ok(start >= 0 && end > start && traceStart > end && traceEnd > traceStart);
const adapter = source.slice(start, end);
const recorder = source.slice(traceStart, traceEnd);
const fixture = { rows: Array.from({ length: 60 }, (_, i) => ({ code: 'bird-' + i, count: i % 4 })) };
const nativeFixture = Buffer.concat([Buffer.from('BCP1z:'), gzipSync(JSON.stringify(fixture))]).toString('base64');

test('F247 native persistence gate limits physical IO to the exact reviewed adapter', () => {
  const file = 'native/ios/BirdGenNotifications.swift';
  assert.deepEqual(analyzeSwift(source, file), []);
  assert.deepEqual(analyzeSwift(source.replace(/\n/g, '\r\n'), file), []);
  assert.ok(analyzeSwift(source, 'native/ios/Other.swift').length > 0);
  for (const [before, after] of [
    ['json.count >= 256', 'json.count >= 2560'],
    ['compressed.count < json.count', 'true'],
    ['guard defaults.data(forKey: key) == data', 'guard true'],
    ['guard try Data(contentsOf: url) == data', 'guard true'],
    ['.atomic, .completeFileProtectionUntilFirstUserAuthentication', '.atomic'],
    ['properties.isExcludedFromBackup = true', 'properties.isExcludedFromBackup = false']
  ]) {
    assert.ok(source.includes(before), before);
    assert.ok(analyzeSwift(source.replace(before, after), file)
      .some(row => row.operation === 'unreviewed-native-persistence-adapter'), before);
  }
  for (const extra of [
    'func extra() { try Data(payload.utf8).write(to: url) }',
    'func extra() { let raw = defaults.data(forKey: key) }',
    'func extra() { defaults.set(payload, forKey: key) }',
    'func extra() { return try Data(contentsOf: url) }'
  ]) assert.ok(analyzeSwift(source + '\n' + extra, file).length > 0, extra);
});

test('F247 IPA preparation requires actual macOS native proofs rather than skipped tests', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ios-build.yml'), 'utf8');
  const nativeCommand = 'run: node --test tests/native-persistence.test.js tests/birdgen-trace.test.js';
  function verify(text) {
    const native = text.indexOf(nativeCommand);
    assert.ok(native > text.indexOf('run: npm ci') && native < text.indexOf('run: npx cap add ios'));
    const step = text.slice(text.lastIndexOf('- name:', native), native);
    assert.match(step, /BIRDGEN_REQUIRE_NATIVE_PERSISTENCE: '1'/);
    assert.match(text.slice(text.lastIndexOf('  build:', native), native), /runs-on: xcode-27/);
  }
  verify(workflow);
  for (const changed of [
    workflow.replace(nativeCommand, ''),
    workflow.replace("BIRDGEN_REQUIRE_NATIVE_PERSISTENCE: '1'", "BIRDGEN_REQUIRE_NATIVE_PERSISTENCE: '0'"),
    workflow.replace('runs-on: xcode-27', 'runs-on: ubuntu-latest')
  ]) assert.throws(() => verify(changed), { code: 'ERR_ASSERTION' });
});

const harness = `
struct Payload: Codable, Equatable {
    struct Row: Codable, Equatable { let code: String; let count: Int }
    let rows: [Row]
}
func check(_ value: @autoclosure () throws -> Bool, _ label: String) throws {
    if try !value() { fatalError("ASSERTION: " + label) }
}
func rejects(_ label: String, _ operation: () throws -> Void) {
    do { try operation() } catch { return }
    fatalError("ASSERTION: " + label)
}
let imported = Data(base64Encoded: "${nativeFixture}")!
let value = try BirdNotificationPersistence.unpack(imported, as: Payload.self)
try check(value.rows.count == 60 && value.rows[59].code == "bird-59", "independent gzip input")
let packed = try BirdNotificationPersistence.pack(value)
try check(packed.starts(with: Data("BCP1z:".utf8)), "profitable gzip")
try check(try BirdNotificationPersistence.unpack(packed, as: Payload.self) == value, "gzip round trip")
let tiny = Payload(rows: [])
let small = try BirdNotificationPersistence.pack(tiny)
try check(small.starts(with: Data("BCP1j:".utf8)), "tiny tagged JSON")
try check(try BirdNotificationPersistence.pack(String(repeating: "x", count: 200))
          .starts(with: Data("BCP1j:".utf8)), "compression floor")
var seed: UInt64 = 123456789
let random = String((0..<253).map { _ -> Character in
    seed = seed &* 6364136223846793005 &+ 1
    return Character(UnicodeScalar(33 + UInt32((seed >> 32) % 90))!)
})
let noisy = try BirdNotificationPersistence.pack(random)
try check(noisy.starts(with: Data("BCP1j:".utf8)), "unprofitable gzip stays JSON")
let legacy = try JSONEncoder().encode(value)
try check(try BirdNotificationPersistence.unpack(legacy, as: Payload.self) == value, "legacy JSON")
for bad in [
    Data("BCP2z:unknown".utf8), Data("BCP1j:{".utf8),
    Data(packed.dropLast()), packed + Data([1]), Data("BCP1z:broken".utf8)
] {
    rejects("damaged or unknown format") { _ = try BirdNotificationPersistence.unpack(bad, as: Payload.self) }
}
var corrupt = packed
corrupt[corrupt.count - 5] ^= 0xff
rejects("gzip checksum") { _ = try BirdNotificationPersistence.unpack(corrupt, as: Payload.self) }
let suite = "birdgen-persistence-" + UUID().uuidString
let defaults = UserDefaults(suiteName: suite)!
defer { defaults.removePersistentDomain(forName: suite) }
try check(try BirdNotificationPersistence.readDefaults(defaults, key: "missing", as: Payload.self) == nil,
          "missing defaults")
defaults.set(legacy, forKey: "legacy")
try check(try BirdNotificationPersistence.readDefaults(defaults, key: "legacy", as: Payload.self) == value,
          "legacy defaults read")
try check(defaults.data(forKey: "legacy")!.starts(with: Data("BCP1z:".utf8)), "legacy defaults migration")
try BirdNotificationPersistence.writeDefaults(tiny, to: defaults, key: "tiny")
try check(try BirdNotificationPersistence.readDefaults(defaults, key: "tiny", as: Payload.self) == tiny,
          "defaults write and reload")
defaults.set("invalid", forKey: "wrong-type")
rejects("wrong physical defaults type") {
    _ = try BirdNotificationPersistence.readDefaults(defaults, key: "wrong-type", as: Payload.self)
}
final class RejectingDefaults: UserDefaults {
    override func set(_ value: Any?, forKey defaultName: String) {}
}
let refusing = RejectingDefaults(suiteName: suite)!
defaults.set(legacy, forKey: "migration-refused")
var migrationFailed = false
try check(try BirdNotificationPersistence.readDefaults(refusing, key: "migration-refused", as: Payload.self,
    onMigrationFailure: { migrationFailed = true }) == value, "failed migration remains readable")
try check(migrationFailed, "failed migration is reported")
try check(defaults.data(forKey: "migration-refused") == legacy, "failed migration preserves source")
rejects("silent defaults write failure") {
    try BirdNotificationPersistence.writeDefaults(value, to: refusing, key: "refused")
}
final class ReplacingDefaults: UserDefaults {
    override func data(forKey defaultName: String) -> Data? { Data("replacement".utf8) }
}
let replacing = ReplacingDefaults(suiteName: suite)!
rejects("replaced defaults readback") {
    try BirdNotificationPersistence.writeDefaults(value, to: replacing, key: "replaced")
}
let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: directory) }
let file = directory.appendingPathComponent("state.json")
try check(try BirdNotificationPersistence.readFile(file, as: Payload.self) == nil, "missing file")
try legacy.write(to: file)
try check(try BirdNotificationPersistence.readFile(file, as: Payload.self) == value, "legacy file read")
try check(try Data(contentsOf: file).starts(with: Data("BCP1z:".utf8)), "legacy file migration")
try check(try file.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true,
          "excluded from backup")
try BirdNotificationPersistence.writeFile(tiny, to: file)
try check(try BirdNotificationPersistence.readFile(file, as: Payload.self) == tiny, "atomic replacement")
rejects("unwritable file") {
    try BirdNotificationPersistence.writeFile(value, to: directory.appendingPathComponent("missing/state"))
}
try Data("BCP1z:broken".utf8).write(to: file)
rejects("corrupt file is not missing") { _ = try BirdNotificationPersistence.readFile(file, as: Payload.self) }
let locked = directory.appendingPathComponent("readable-legacy")
try FileManager.default.createDirectory(at: locked, withIntermediateDirectories: true)
let lockedFile = locked.appendingPathComponent("cache.json")
try legacy.write(to: lockedFile)
try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: locked.path)
defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: locked.path) }
var fileMigrationFailed = false
try check(try BirdNotificationPersistence.readFile(lockedFile, as: Payload.self,
    onMigrationFailure: { fileMigrationFailed = true }) == value, "failed file migration remains readable")
let retainedLegacy = try Data(contentsOf: lockedFile)
try check(fileMigrationFailed && retainedLegacy == legacy,
          "failed file migration reports failure and preserves bytes")
let trace = BirdNotificationTrace(defaults: defaults)
for _ in 0..<80 { trace.record(.acquisition, .ok, background: true, counts: [.rows: 500]) }
try check(!trace.storageFailed && trace.snapshot().count == 64, "actual trace receipt and bound")
try check(defaults.data(forKey: "birdgen-stage-trace-v1")?.starts(with: Data("BCP1z:".utf8)) == true,
          "actual trace gzip")
try check(BirdNotificationTrace(defaults: defaults).snapshot().count == 64, "actual trace restore")
defaults.set(try JSONSerialization.data(withJSONObject: trace.snapshot()), forKey: "birdgen-stage-trace-v1")
let failedMigrationTrace = BirdNotificationTrace(defaults: refusing)
try check(failedMigrationTrace.snapshot().count == 64 && failedMigrationTrace.storageFailed,
          "actual trace retains readable history and migration failure")
let failedTrace = BirdNotificationTrace(defaults: refusing)
failedTrace.record(.acquisition, .ok, background: false)
try check(failedTrace.storageFailed, "actual trace failure status")
print("PACKED:" + packed.base64EncodedString())
print("native persistence OK")
`;

function runNative(text, directory, name) {
  const file = path.join(directory, name + '.swift');
  fs.writeFileSync(file, 'import Foundation\nimport zlib\n' + text + '\n' + harness);
  return spawnSync('swift', [file], { encoding: 'utf8', timeout: 120000 });
}

test('F247 production Swift codec, physical backends and trace receipts interoperate with independent gzip',
  { skip: process.platform !== 'darwin' }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'birdgen-persistence-'));
    try {
      const result = runNative(adapter + '\n' + recorder, directory, 'forward');
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /native persistence OK/);
      const data = Buffer.from(/^PACKED:(.+)$/m.exec(result.stdout)[1], 'base64');
      assert.equal(data.subarray(0, 6).toString(), 'BCP1z:');
      assert.deepEqual(JSON.parse(gunzipSync(data.subarray(6))), fixture);
      for (const [name, before, after] of [
        ['compression', 'return gzipTag + compressed', 'return jsonTag + json'],
        ['tiny', 'json.count >= 256', 'json.count >= 0'],
        ['legacy-defaults',
          'if !isTagged(data) {\n            do { try writeDefaults(value, to: defaults, key: key) }\n            catch { onMigrationFailure?() }\n        }', ''],
        ['legacy-files',
          'if !isTagged(data) {\n            do { try writeFile(value, to: url) }\n            catch { onMigrationFailure?() }\n        }', ''],
        ['migration-status',
          'do { try writeDefaults(value, to: defaults, key: key) }\n            catch { onMigrationFailure?() }',
          'do { try writeDefaults(value, to: defaults, key: key) }\n            catch {}'],
        ['defaults-receipt', 'guard defaults.data(forKey: key) == data', 'guard true'],
        ['file-codec',
          'static func writeFile<T: Encodable>(_ value: T, to url: URL) throws {\n        let data = try pack(value)',
          'static func writeFile<T: Encodable>(_ value: T, to url: URL) throws {\n        let data = try JSONEncoder().encode(value)'],
        ['trace-write', 'try BirdNotificationPersistence.writeDefaults(entries, to: defaults, key: key)', ''],
        ['trace-read', 'entries = Array(stored.suffix(64))', '_ = stored'],
        ['trace-status',
          '} catch {\n            storageFailed = true\n        }\n        if (storageFailed)',
          '} catch {\n            storageFailed = false\n        }\n        if (storageFailed)']
      ]) {
        const production = adapter + '\n' + recorder;
        assert.ok(production.includes(before), name + ': mutation must apply');
        const mutated = runNative(production.replace(before, after), directory, name);
        assert.notEqual(mutated.status, 0, name + ': mutation survived');
        assert.match(mutated.stdout + mutated.stderr, /ASSERTION:/, name + ': must reach intended assertion');
      }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
