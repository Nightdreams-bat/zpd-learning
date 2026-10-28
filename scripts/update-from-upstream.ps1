<#
.SYNOPSIS
  Pull the latest upstream LearnHarness into this claude-cli fork, without ever
  leaving main in a broken state.

.DESCRIPTION
  1. fetch upstream, stop if there is nothing new
  2. merge it on a throwaway branch (a conflict aborts and changes nothing)
  3. gates: typecheck, the claude-cli / graph tests, a production build, and a
     real 2-turn lesson through the Claude subscription (spends ~4 model calls)
  4. only if every gate passes, fast-forward main to the merged branch

  If anything fails, main is untouched and the branch is kept for inspection.
  The full test suite is run for information only: a few upstream tests fail on
  Windows by themselves (file modes, CRLF), so it is not a gate.

.PARAMETER NoSmoke
  Skip the real lesson through the Claude subscription.
.PARAMETER NoBuild
  Skip the production build.
#>
param(
	[switch]$NoSmoke,
	[switch]$NoBuild,
	[string]$Upstream = "upstream"
)

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$env:ELECTRON_CACHE = "D:\tmp\electron-cache"
New-Item -ItemType Directory -Force $env:ELECTRON_CACHE | Out-Null

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Stop-Update($msg) { Write-Host "`nSTOPPED: $msg" -ForegroundColor Red; exit 1 }
function Git { & git @args; if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed" } }

if ((git rev-parse --abbrev-ref HEAD) -ne "main") { Stop-Update "not on main. Switch to main first." }
if (git status --porcelain --untracked-files=no) { Stop-Update "uncommitted changes. Commit or stash them first." }
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
	Stop-Update "LearnHarness is running on port 3000. Close it first; the build replaces .next."
}

Step "Fetching $Upstream"
Git fetch $Upstream --tags --quiet
$tag = (git describe --tags --abbrev=0 "$Upstream/main")
$behind = [int](git rev-list --count "HEAD..$Upstream/main")
if ($behind -eq 0) { Write-Host "Already up to date with upstream ($tag)." -ForegroundColor Green; exit 0 }
Write-Host "$behind new upstream commits, latest release $tag. Newest:"
git log --oneline --no-merges -n 15 "HEAD..$Upstream/main"

$branch = "merge-upstream-$tag-$(Get-Date -Format 'yyyyMMdd-HHmm')"
Step "Merging on branch $branch"
Git switch -c $branch
& git merge "$Upstream/main" --no-edit -m "Merge upstream $tag into the claude-cli fork"
if ($LASTEXITCODE -ne 0) {
	$conflicts = (git diff --name-only --diff-filter=U) -join "`n  "
	& git merge --abort
	Git switch main
	Git branch -D $branch
	Stop-Update "merge conflicts in:`n  $conflicts`nNothing was changed. Ask Claude Code in this folder to 'merge upstream into the fork' to resolve them."
}

function Back-Out($why) {
	Git switch main
	& npm install --no-audit --no-fund 2>&1 | Out-Null
	Stop-Update "$why`nmain is untouched. The merge is kept on branch $branch for inspection."
}

function Gate($name, [scriptblock]$run) {
	Step $name
	& $run
	if ($LASTEXITCODE -ne 0) { Back-Out "$name failed" }
}

& git diff --quiet main HEAD -- package-lock.json
if ($LASTEXITCODE -ne 0) {
	Gate "npm install (dependencies changed)" { npm install --no-audit --no-fund }
}

Gate "Typecheck" { npm run typecheck }

$env:NODE_ENV = "test"
Gate "claude-cli + graph tests" {
	npx tsx --test tests/claude-cli-protocol.test.ts tests/claude-cli-provider.test.ts tests/graph.test.ts tests/source-title.test.ts tests/session-clusters.test.ts
}

Step "Full test suite (information only)"
$tap = npx tsx --test --test-reporter=tap "tests/*.test.ts" "tests/*.test.tsx" 2>$null
$failed = $tap | Where-Object { $_ -match "^not ok" }
Write-Host ("{0} top-level test groups failing (a few Windows-only failures are normal):" -f @($failed).Count)
$failed | ForEach-Object { Write-Host "  $_" }

$env:NODE_ENV = "production"
if (-not $NoBuild) {
	Gate "Production build" { npx next build }
	Git checkout -- next-env.d.ts
}

if (-not $NoSmoke) {
	Step "Real lesson through the Claude subscription (2 turns)"
	$out = npx tsx scripts/lesson-sim.ts --turns 2
	$out | Select-Object -Last 6 | ForEach-Object { Write-Host $_ }
	$dir = ($out | Select-String "^written: (.+)$" | Select-Object -Last 1).Matches.Groups[1].Value
	$report = if ($dir) { Get-Content (Join-Path $dir "report.json") -Raw | ConvertFrom-Json } else { $null }
	if (-not $report -or $report.callErrors -ne 0 -or $report.modelCalls -lt 1) {
		Back-Out "the Claude login smoke test failed (see $dir)"
	}
	Write-Host "OK: $($report.modelCalls) model calls, 0 errors." -ForegroundColor Green
}

Step "All gates passed - updating main"
Git switch main
Git merge --ff-only $branch
Git branch -d $branch
Write-Host "`nUpdated to $tag. Start it with start-learnharness.cmd" -ForegroundColor Green
