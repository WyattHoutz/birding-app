<#
.SYNOPSIS
  Run the full verification detached, to a log, so an interrupted session
  costs a file read instead of seven minutes.

.DESCRIPTION
  The unit suite takes ~6.5 minutes and the layout sweep another few. When the
  agent session driving it dies mid-run - a model error, a dropped websocket, a
  cancelled tool call - the run dies with it and everything starts over. That is
  the actual cost of a retry failing: not the error, the lost work.

  So the run is decoupled from whoever asked for it. It writes to a log file and
  finishes by writing a STATUS line. Anyone arriving later - the same session
  after a retry, or a new one - reads the log rather than re-running:

      pwsh scripts/verify.ps1              # start it, return immediately
      pwsh scripts/verify.ps1 -Read        # what happened / how far along

  -Read is the whole point. It is safe to call at any time: mid-run it reports
  progress, after a crash it reports the failure, and after success it reports
  that too. It never starts anything.

.PARAMETER Read
  Report on the most recent run instead of starting a new one.

.PARAMETER Quick
  Skip the layout sweep (which needs Chrome). Unit suites only.
#>
param(
  [switch]$Read,
  [switch]$Quick,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$log = Join-Path $repo '.verify.log'
$statusFile = Join-Path $repo '.verify.status'
$pidFile = Join-Path $repo '.verify.pid'

if ($Read) {
  if (-not (Test-Path $log)) {
    Write-Output 'NOT STARTED - no run has been made yet.'
    exit 2
  }
  $age = [int]((Get-Date) - (Get-Item $log).LastWriteTime).TotalSeconds
  $status = if (Test-Path $statusFile) { (Get-Content $statusFile -Raw).Trim() } else { 'RUNNING' }

  # Liveness is checked against the actual PROCESS, never inferred from how
  # long the log has been quiet. The first version guessed from the log's
  # mtime, and that was wrong in the one case that matters: `node --test` runs
  # for six minutes without printing anything, so a perfectly healthy run was
  # about to be reported as dead - which would have triggered exactly the
  # wasted re-run this script exists to prevent. A wrong liveness signal is
  # worse than none.
  if ($status -eq 'RUNNING') {
    $alive = $false
    if (Test-Path $pidFile) {
      $runPid = (Get-Content $pidFile -Raw).Trim()
      $alive = [bool](Get-Process -Id $runPid -ErrorAction SilentlyContinue)
    }
    $status = if ($alive) {
      "RUNNING (pid $runPid, ${age}s since last output - node prints nothing until a suite ends, so silence here is normal)"
    } else {
      'DIED - the process is gone and never wrote a verdict. Start it again.'
    }
  }

  Write-Output "STATUS: $status"
  Write-Output "last written: ${age}s ago"
  Write-Output ''
  # Failures first: the reason to read a log is almost always to find one.
  #
  # The pattern is anchored, and that is the whole lesson. A loose one matching
  # FAIL or "TAP TARGET" anywhere reported four PASSING tests as problems -
  # "a failed feed is evicted from the memo", "every tap target clears 44px" -
  # because those words appear in the test NAMES. A report that cries wolf on a
  # green run is worse than no report, because the next real failure gets read
  # as more noise.
  $bad = Select-String -Path $log -Encoding utf8 -Pattern @(
      '^not ok '
      '^\s*\u2716 '
      '^# fail [1-9]'
      '^\s*\u2139 fail [1-9]'
      'SUITE FAILED'
      '^PROBLEMS:'
      '^\s+TAP TARGET '
      '^\s+NO ACCESSIBLE NAME '
    ) | Where-Object { $_.Line -notmatch '0\.0px over' } | Select-Object -First 25
  if ($bad) {
    Write-Output '--- problems ---'
    $bad | ForEach-Object { Write-Output ('  ' + $_.Line.Trim()) }
    Write-Output ''
  }
  Write-Output '--- tail ---'
  Get-Content $log -Tail 18 -Encoding utf8 | ForEach-Object { Write-Output ('  ' + $_) }
  exit 0
}

# Refuse to start a second run on top of a live one. Two runners append to the
# same log and fight over the same handle, and the symptom is a file-in-use
# error from the NEW run while the OLD one is still perfectly healthy - which
# reads as "verification is broken" when nothing is. -Force takes over instead.
if (Test-Path $pidFile) {
  $existing = (Get-Content $pidFile -Raw).Trim()
  $live = Get-Process -Id $existing -ErrorAction SilentlyContinue
  if ($live -and -not $Force) {
    Write-Output "already running (pid $existing). Read it with -Read, or restart with -Force."
    exit 3
  }
  if ($live -and $Force) {
    Stop-Process -Id $existing -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
  }
}

Remove-Item $statusFile, $pidFile -ErrorAction SilentlyContinue
"started $(Get-Date -Format o)" | Out-File $log -Encoding utf8

# Detached on purpose. Start-Process without -Wait means this returns now and
# the work outlives the caller - which is the entire point.
#
# The runner is written to a FILE rather than passed as a -Command string. The
# first version passed a here-string, and it died silently before writing a
# single line: every $ in it needed escaping, and one wrong escape produces a
# parse error in a hidden window with nowhere to report it. A file is read back
# verbatim, and can be run by hand when something does go wrong.
$runner = Join-Path $repo '.verify-run.ps1'
$doLayout = if ($Quick) { '$false' } else { '$true' }
@"
Set-Location "$repo"
`$ok = `$true
"== unit suites ==" | Out-File -Append -Encoding utf8 "$log"
node --test tests/dom.test.js tests/logic.test.js tests/normalize.test.js ``
     tests/parse.test.js tests/seed.test.js tests/version.test.js 2>&1 |
  Out-File -Append -Encoding utf8 "$log"
if (`$LASTEXITCODE -ne 0) { `$ok = `$false }
if ($doLayout) {
  "== layout sweep ==" | Out-File -Append -Encoding utf8 "$log"
  npm run test:layout 2>&1 | Out-File -Append -Encoding utf8 "$log"
  if (`$LASTEXITCODE -ne 0) { `$ok = `$false }
}
if (`$ok) { `$verdict = "PASSED" } else { `$verdict = "FAILED" }
`$verdict | Out-File -Encoding utf8 "$statusFile"
"@ | Out-File $runner -Encoding utf8

# Parse the runner BEFORE launching it. This is not defensive tidiness: the
# first working version died instantly and silently because of `if {} else {} |
# Out-File`, which is not a valid pipe source. A parse error kills the WHOLE
# file, so not one line ran, the log stayed empty, and the only symptom was a
# process that vanished. In a hidden window there is nowhere for that error to
# go. Reading it here turns an invisible death into a visible one.
$parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($runner, [ref]$null, [ref]$parseErrors)
if ($parseErrors) {
  Write-Output 'the generated runner does not parse - not launching it:'
  $parseErrors | ForEach-Object { Write-Output ("  " + $_.Message) }
  exit 1
}

$proc = Start-Process pwsh -ArgumentList '-NoProfile', '-File', $runner -WindowStyle Hidden -PassThru
$proc.Id | Out-File $pidFile -Encoding utf8

Write-Output "started - detached, survives this session"
Write-Output "read it with:  pwsh scripts/verify.ps1 -Read"
