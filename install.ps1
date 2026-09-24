# Copy skills, agents and commands into your Claude Code config directory.
# Existing items with the same name are kept unless you pass -Force.
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$cfg = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }

function Install-Item($item, $destDir) {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    $target = Join-Path $destDir $item.Name
    if ((Test-Path $target) -and -not $Force) { Write-Host "skip       $($item.Name) (already installed; -Force to overwrite)"; return }
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Copy-Item -Recurse $item.FullName $target
    Write-Host "installed  $($item.Name)"
}

Get-ChildItem -Directory (Join-Path $PSScriptRoot 'skills') | ForEach-Object { Install-Item $_ (Join-Path $cfg 'skills') }
Get-ChildItem -File (Join-Path $PSScriptRoot 'agents') -Filter *.md | ForEach-Object { Install-Item $_ (Join-Path $cfg 'agents') }
Get-ChildItem -File (Join-Path $PSScriptRoot 'commands') -Filter *.md | ForEach-Object { Install-Item $_ (Join-Path $cfg 'commands') }
Write-Host ""; Write-Host "Done. Set OBSIDIAN_VAULT_PATH, then restart Claude Code."
