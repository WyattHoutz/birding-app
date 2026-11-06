'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const children = require('node:child_process');
const nativeSpawnSync = children.spawnSync;
// Keep native temp-directory semantics before simulating Windows below.
require('node:os');
const profiles = new Set();
const mkdir = fs.mkdtempSync;
const remove = fs.rmSync;
fs.mkdtempSync = (...args) => {
  const profile = mkdir(...args);
  profiles.add(profile);
  return profile;
};
let faultReported = false;
fs.rmSync = (target, options) => {
  if (profiles.has(target) && process.env.AUDIT_LIFECYCLE_CLEANUP === 'fail') {
    if (!faultReported) console.log('FORCED_PROFILE_CLEANUP_FAILURE');
    faultReported = true;
    throw Object.assign(new Error('controlled profile lock'), { code: 'EBUSY' });
  }
  return remove(target, options);
};
process.on('exit', () => {
  for (const profile of profiles) remove(profile, { recursive: true, force: true });
});
let clock = Date.now();
Date.now = () => (clock += 1000);
const helperMode = process.env.AUDIT_LIFECYCLE_HELPERS || 'ok';
if (helperMode.startsWith('windows-')) {
  Object.defineProperty(process, 'platform', { value: 'win32' });
}
process.kill = () => true;
children.spawn = () => {
  console.log('BROWSER_SPAWN');
  return { pid: process.pid, kill: () => true };
};
children.spawnSync = (program, args, options) => {
  console.log('HELPER_TIMEOUT=' + options.timeout);
  if (helperMode === 'fail' || program === 'taskkill' && helperMode === 'windows-tree-timeout') {
    return { status: null, error: Object.assign(new Error('controlled helper timeout'), { code: 'ETIMEDOUT' }) };
  }
  if (helperMode.startsWith('windows-') && program === 'powershell') {
    const command = args.at(-1);
    if (helperMode.startsWith('windows-native-')) {
      const mode = helperMode.slice('windows-native-'.length);
      const profile = [...profiles].at(-1).replace(/'/g, "''");
      const fixture = `
$script:mode='${mode}'; $script:dead=$${mode === 'exited' ? 'true' : 'false'};
$script:exitWatch=$null; $script:inventoryDelay=50;
$script:lateDead=$false; $script:inventorySpent=0;
function Get-CimInstance {
  if ($script:mode -eq 'inventory') { throw 'fixture inventory denied' }
  if ($script:mode -in @('delayed-exit','late-owned')) {
    Start-Sleep -Milliseconds $script:inventoryDelay
    $script:inventorySpent += $script:inventoryDelay
  }
  [pscustomobject]@{ProcessId=90123451;CommandLine='--user-data-dir="${profile}"'}
  if ($script:mode -eq 'late-owned' -and $script:dead -and -not $script:lateDead) {
    [pscustomobject]@{ProcessId=90123453;CommandLine='--user-data-dir="${profile}"'}
  }
  [pscustomobject]@{ProcessId=90123452;CommandLine='--user-data-dir="${profile}-ordinary"'}
}
function Get-Process {
  [CmdletBinding()]param([int]$Id)
  if ($Id -ne 90123451 -and -not ($script:mode -eq 'late-owned' -and $Id -eq 90123453)) {
    throw 'ordinary PID was queried'
  }
  if ($script:mode -eq 'denied') { throw 'fixture process access denied' }
  if ($script:mode -eq 'missing') {
    $record=[System.Management.Automation.ErrorRecord]::new(
      [ArgumentException]::new('fixture missing'), 'NoProcessFoundForGivenId',
      [System.Management.Automation.ErrorCategory]::ObjectNotFound, $Id)
    $PSCmdlet.ThrowTerminatingError($record)
  }
  $dead=if ($Id -eq 90123453) { $script:lateDead } else { $script:dead }
  $process=[pscustomobject]@{HasExited=$dead;Handle=1;FixtureId=$Id}
  $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {
    param([int]$wait)
    if ($script:mode -eq 'late-owned') {
      if ($wait -gt ${Number(process.env.AUDIT_TIMEOUT_MS || 120000)} - $script:inventorySpent) {
        throw 'fixture cleanup budget reset'
      }
      if ($this.FixtureId -eq 90123453) { return $script:lateDead }
    }
    if ($script:mode -eq 'delayed-exit') {
      if ($wait -gt ${Number(process.env.AUDIT_TIMEOUT_MS || 120000)} - $script:inventoryDelay) {
        throw 'fixture cleanup budget reset'
      }
      $remaining=[Math]::Max(0,500-$script:exitWatch.ElapsedMilliseconds)
      Start-Sleep -Milliseconds ([Math]::Min($remaining,$wait))
      $script:dead=$script:exitWatch.ElapsedMilliseconds -ge 500
    }
    return $script:dead
  }
  return $process
}
function Stop-Process {
  [CmdletBinding()]param([int]$Id,[switch]$Force)
  if ($script:mode -eq 'late-owned' -and $Id -eq 90123453) {
    'FIXTURE_KILL_OWNED'
    $script:lateDead=$true
    return
  }
  if ($Id -ne 90123451) { throw 'ordinary PID was stopped' }
  if ($script:mode -eq 'stop-denied') { throw 'fixture stop denied' }
  if ($script:mode -eq 'exit-race') { $script:dead=$true; throw 'fixture exited during stop' }
  if ($script:dead) { throw 'fixture attempted stop after exit' }
  'FIXTURE_KILL_OWNED'
  if ($script:mode -eq 'delayed-exit') { $script:exitWatch=[Diagnostics.Stopwatch]::StartNew() }
  elseif ($script:mode -ne 'survivor') { $script:dead=$true }
}
`;
      return nativeSpawnSync(program, [...args.slice(0, -1), fixture + command],
        {...options, encoding:'utf8'});
    }
    if (command.includes('Stop-Process')) {
      if (helperMode === 'windows-clean') return { status: 0 };
      return { status: 1, stdout: helperMode === 'windows-unknown-initial'
        ? 'UNKNOWN_CLEANUP_STATE\n' : 'SURVIVING_OWNED_PID=1234\n',
      error: helperMode === 'windows-initial-error' ? new Error('controlled initial error') : undefined,
      stderr: helperMode === 'windows-initial-stderr' ? 'controlled permission error' : '' };
    }
    console.log('FINAL_OWNED_PROFILE_CHECK');
    assert.ok(command.includes('Get-CimInstance') && command.includes('-ErrorAction Stop'));
    assert.ok([...profiles].some(profile => command.includes(path.basename(profile))),
      'the final inventory must use this fixture browser profile');
    assert.doesNotMatch(command, /Stop-Process|taskkill|Remove-Item/,
      'the final confirmation must be read-only');
    if (helperMode === 'windows-persistent') return { status: 1, stdout: 'SURVIVING_OWNED_PID=1234\n' };
    if (helperMode === 'windows-inventory-error') {
      return { status: 1, stderr: 'controlled inventory denial' };
    }
    if (helperMode === 'windows-inventory-timeout') {
      return { status: null, error: new Error('controlled inventory timeout') };
    }
    if (helperMode === 'windows-inventory-throw') throw new Error('controlled inventory exception');
    if (helperMode === 'windows-recreated-profile') fs.mkdirSync([...profiles].at(-1));
    return { status: 0, stdout: helperMode === 'windows-no-proof' ? ''
      : helperMode === 'windows-extra-output' ? 'UNKNOWN\nOWNED_PROFILE_CLEAR\n' : 'OWNED_PROFILE_CLEAR\n',
    stderr: helperMode === 'windows-final-stderr' ? 'controlled inventory warning' : '' };
  }
  return { status: 0 };
};
http.createServer = (handler) => ({
  address: () => ({ port: 1 }),
  close() {},
  listen(port, host, ready) {
    ready();
    if (process.env.AUDIT_LIFECYCLE_REPORT !== 'none') setImmediate(() => {
      const request = new EventEmitter();
      request.method = 'POST';
      request.url = '/__audit';
      handler(request, { writeHead() {}, end() {} });
      request.emit('data', process.env.AUDIT_LIFECYCLE_REPORT === 'overflow'
        ? JSON.stringify([{label:'controlled overflow',vw:393,n:1,text:1,
          maxRight:413,docScrollW:413,over:20,items:[]}]) : '[]');
      request.emit('end');
    });
  },
});

const mutation = process.env.AUDIT_LIFECYCLE_MUTATION;
const compile = Module.prototype._compile;
Module.prototype._compile = function(source, filename) {
  if (mutation && filename.endsWith(path.join('assets', 'audit-overflow.js'))) {
    source = source.replace(/\r/g, '');
    const choices = {
      layoutliveness: [
        'try { return -not (Get-Process -Id $ownedPid -ErrorAction Stop).HasExited }',
        'try { return $true }',
      ],
      layoutmissing: [
        "if ($_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId,*') { return $false }; throw",
        "if ($_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId,*') { throw }; throw",
      ],
      layoutdenied: [
        "if ($_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId,*') { return $false }; throw",
        "if ($_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId,*') { return $false }; return $false",
      ],
      layoutowner: [
        'Where-Object { $_.CommandLine -match $pattern }',
        'Where-Object { $true }',
      ],
      layoutrace: [
        'catch { if (Test-LivePid $ownedPid) { throw } }',
        'catch { throw }',
      ],
      report: ['clearTimeout(timer);\n    cleanupOrFail();', 'clearTimeout(timer);\n    teardown();'],
      retry: ['cleanupOrFail();\n    if (attempt < MAX_ATTEMPTS)', 'teardown();\n    if (attempt < MAX_ATTEMPTS)'],
      budget: [
        "  if (!Number.isSafeInteger(TIMEOUT_MS) || TIMEOUT_MS <= 0 || TIMEOUT_MS > 2147483647) {\n"
          + "    console.error('Invalid AUDIT_TIMEOUT_MS: expected positive timer-range milliseconds.');\n"
          + "    server.close();\n    process.exit(2);\n  }",
        '',
      ],
      helpers: ['return verified;\n  };\n\n  // Windows releases', 'return true;\n  };\n\n  // Windows releases'],
      details: [
        'JSON.stringify({profile:profile,failures:cleanupFailures})',
        'JSON.stringify({profile:profile,failures:[]})',
      ],
      profilecause: [
        "cleanupFailures.push({helper:'profile removal',error:failure && failure.message});",
        "cleanupFailures.push({helper:'profile removal'});",
      ],
      transientwarning: [
        'const F1242_WARN_VERIFIED_TRANSIENT_WINDOWS_CLEANUP = true;',
        'const F1242_WARN_VERIFIED_TRANSIENT_WINDOWS_CLEANUP = false;',
      ],
      transientprocess: [
        "if (result.error || result.status !== 0 || profilePresent\n"
          + "          || String(result.stderr || '').trim()\n"
          + "          || String(result.stdout || '').trim() !== 'OWNED_PROFILE_CLEAR')",
        'if (false)',
      ],
      transienteligibility: [
        "failure.helper !== 'owned profile' || failure.status !== 1 || failure.error",
        "failure.helper !== 'owned profile' || failure.status !== 1",
      ],
      transientprofile: [
        'result.error || result.status !== 0 || profilePresent',
        'result.error || result.status !== 0',
      ],
      transientdiagnostic: [
        'JSON.stringify({profile,initial:failure})',
        'JSON.stringify({profile})',
      ],
      transientreset: ['cleanupFailures.length = 0;', ''],
      transientbudget: [
        "{ stdio: 'pipe', timeout: TIMEOUT_MS });\n      const profilePresent",
        "{ stdio: 'pipe' });\n      const profilePresent",
      ],
      transientgeometry: ['process.exit(bad ? 1 : 0);', 'process.exit(0);'],
    };
    if (mutation === 'timeout') {
      assert.equal(source.split(', timeout: TIMEOUT_MS').length, 5);
      source = source.replaceAll(', timeout: TIMEOUT_MS', '');
    } else if (mutation === 'nativecause') {
      assert.equal(source.split('result.error && result.error.message').length, 5);
      source = source.replaceAll('result.error && result.error.message', 'undefined');
    } else {
      const pair = choices[mutation];
      assert.ok(pair, 'unknown audit mutation');
      assert.equal(source.split(pair[0]).length, 2, 'audit mutation must match once');
      source = source.replace(pair[0], pair[1]);
    }
    console.log('APPLIED_AUDIT_MUTATION=' + mutation);
  }
  return compile.call(this, source, filename);
};
