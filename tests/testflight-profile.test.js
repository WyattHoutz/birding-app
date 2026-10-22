'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('F1059 profile and exported app guards reject wrong identity, expiry, distribution and debug entitlement', () => {
  const script = `
import copy, importlib.util, sys
from datetime import datetime, timedelta, timezone
spec = importlib.util.spec_from_file_location("profile_guard", sys.argv[1])
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
uuid = "12345678-1234-1234-1234-123456789ABC"
entitlements = {
    "application-identifier": "TESTTEAM.com.example.bird",
    "com.apple.developer.team-identifier": "TESTTEAM",
    "get-task-allow": False, "beta-reports-active": True,
}
profile = {
    "TeamIdentifier": ["TESTTEAM"], "ApplicationIdentifierPrefix": ["TESTTEAM"],
    "Entitlements": entitlements, "UUID": uuid,
    "ExpirationDate": datetime.now(timezone.utc) + timedelta(days=1),
    "DeveloperCertificates": [b"synthetic-public-certificate"],
}
info = {"CFBundleIdentifier": "com.example.bird", "CFBundleShortVersionString": "1.168.0", "CFBundleVersion": "538.1"}
assert guard.profile_info(profile, "com.example.bird")["team"] == "TESTTEAM"
guard.verify_app(info, profile, entitlements, "com.example.bird", "1.168.0", "538.1", uuid)
def rejects(function):
    try:
        function()
    except ValueError:
        return
    raise AssertionError("invalid profile or app was accepted")
for field, value in [
    ("ExpirationDate", datetime.now(timezone.utc) - timedelta(days=1)),
    ("ProvisionedDevices", ["device"]), ("ProvisionsAllDevices", True),
    ("DeveloperCertificates", []), ("UUID", "../invalid"),
    ("TeamIdentifier", ["WRONGTEAM"]), ("ApplicationIdentifierPrefix", ["OTHER"]),
]:
    changed = copy.deepcopy(profile)
    changed[field] = value
    rejects(lambda: guard.profile_info(changed, "com.example.bird"))
for key, value in [("get-task-allow", True), ("beta-reports-active", False), ("application-identifier", "TESTTEAM.com.other")]:
    changed = copy.deepcopy(profile)
    changed["Entitlements"][key] = value
    rejects(lambda: guard.profile_info(changed, "com.example.bird"))
for key, value in [("CFBundleIdentifier", "com.other"), ("CFBundleShortVersionString", "1.167.0"), ("CFBundleVersion", "1")]:
    changed = {**info, key: value}
    rejects(lambda: guard.verify_app(changed, profile, entitlements, "com.example.bird", "1.168.0", "538.1", uuid))
for key, value in [("application-identifier", "WRONG"), ("com.apple.developer.team-identifier", "WRONG"), ("beta-reports-active", False), ("get-task-allow", True)]:
    changed = {**entitlements, key: value}
    rejects(lambda: guard.verify_app(info, profile, changed, "com.example.bird", "1.168.0", "538.1", uuid))
rejects(lambda: guard.verify_app(info, profile, entitlements, "com.example.bird", "1.168.0", "538.1", "another-uuid"))
print("profile and exported-app negative controls passed")
`;
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [
    '-B', '-c', script, path.join(__dirname, '..', 'assets', 'testflight-profile.py'),
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /negative controls passed/);
});
