<#
.SYNOPSIS
  Run a `gh` command, retrying only the failures that retrying can fix.

.DESCRIPTION
  Publishing a release is the last step of a long night's work and it talks to
  the network exactly once per attempt. On 2026-08-12 that step failed with:

      Get "https://api.github.com/repos/.../releases/tags/v1.3.1":
          net/http: TLS handshake timeout

  Nothing was wrong with the release, the notes, or the build. A handshake
  timed out, `gh` exited non-zero, and the release kept its auto-generated body
  — which looks exactly like a release that published correctly, right up until
  someone reads it. That is the reason this exists: the failure was loud, but
  its CONSEQUENCE was silent.

  Deliberately narrow about what it retries:

    * transport failures (TLS, timeouts, resets, 5xx, secondary rate limits)
      are retried with exponential backoff, because trying again IS the remedy;
    * everything else — a bad tag, a missing file, a permissions error — fails
      immediately, because retrying a real error only takes five times as long
      to tell you the same thing.

.EXAMPLE
  pwsh scripts/gh-retry.ps1 release edit v1.3.1 --notes-file notes.md

.EXAMPLE
  pwsh scripts/gh-retry.ps1 -MaxAttempts 8 release view v1.3.1 --json body
#>
# Tunables come from the environment, not parameters. A param block competes
# with gh's own flags for the command line -- `release edit --title ...` binds
# --title to PowerShell before gh ever sees it -- so everything after the script
# name is passed straight through, untouched.
$MaxAttempts = if ($env:GH_RETRY_ATTEMPTS) { [int]$env:GH_RETRY_ATTEMPTS } else { 5 }
$InitialDelaySeconds = if ($env:GH_RETRY_DELAY) { [int]$env:GH_RETRY_DELAY } else { 2 }
$GhArgs = $args
if (-not $GhArgs -or $GhArgs.Count -eq 0) {
  Write-Host "usage: gh-retry.ps1 <gh args...>" -ForegroundColor Red
  exit 2
}

# Matched against gh's output. Kept as a list of what a RETRYABLE failure looks
# like rather than what a fatal one looks like: the fatal set is open-ended, so
# defaulting to "fail fast" is the safe direction to be wrong in.
$retryable = @(
  'TLS handshake timeout'
  'net/http: request canceled'
  'i/o timeout'
  'connection reset'
  'connection refused'
  'unexpected EOF'
  'temporary failure in name resolution'
  'no such host'
  'HTTP 5\d\d'
  'was submitted too quickly'
  'API rate limit'
  'Bad Gateway'
  'Service Unavailable'
)

$delay = $InitialDelaySeconds
for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
  $out = & gh @GhArgs 2>&1
  $code = $LASTEXITCODE
  if ($code -eq 0) {
    $out
    exit 0
  }

  $text = ($out | Out-String)
  $isRetryable = $false
  foreach ($p in $retryable) {
    if ($text -match $p) { $isRetryable = $true; break }
  }

  if (-not $isRetryable) {
    Write-Host "gh failed with something a retry will not fix:" -ForegroundColor Red
    $out
    exit $code
  }

  if ($attempt -eq $MaxAttempts) {
    Write-Host "gh still failing after $MaxAttempts attempts:" -ForegroundColor Red
    $out
    exit $code
  }

  $first = ($text.Trim() -split "`n" | Select-Object -First 1)
  Write-Host "  [retry $attempt/$MaxAttempts] transient failure, waiting ${delay}s: $first" -ForegroundColor Yellow
  Start-Sleep -Seconds $delay
  $delay = [math]::Min(60, $delay * 2)
}
