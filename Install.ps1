<#
.SYNOPSIS
    Install CustomClaude by checking the repo out into a directory on PATH.
.DESCRIPTION
    The working tree IS the install: CustomClaude.cmd sits at the root of the
    checkout, so the shim self-updates by resetting the repo around itself. No
    file copying, no second clone nested inside the install.

    Re-running this is the supported way to repair an install. It also migrates
    the older layout, which kept a nested clone in a CustomClaude subdirectory
    and copied prompts to ~\.claude\SystemPrompts.
.USAGE
    .\Install.ps1
    .\Install.ps1 -InstallDir "C:\Tools\CustomClaude"
#>

param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'CustomClaude'),
    [string]$RepoUrl = 'https://github.com/TychoHenzen/CustomClaude.git'
)

$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Label, [string]$Value, [ConsoleColor]$Color = 'Cyan')
    Write-Host "  $Label" -NoNewline -ForegroundColor DarkGray
    Write-Host " $Value" -ForegroundColor $Color
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  ERROR: git is required and was not found on PATH." -ForegroundColor Red
    exit 1
}

$InstallDir = $InstallDir.TrimEnd('\')

# --- Migrate the old nested-clone layout -------------------------------------
# Older installs copied the shim to $InstallDir and cloned the repo into
# $InstallDir\CustomClaude. Lift the machine-local state (all of it gitignored,
# so a checkout would not restore it) up to the install root first.

$nested = Join-Path $InstallDir 'CustomClaude'
if (Test-Path (Join-Path $nested '.git')) {
    Write-Step 'Migrating:' "nested clone at $nested"

    foreach ($item in @('tweakcc-presets', '.cache', 'backends.json')) {
        $src = Join-Path $nested $item
        $dst = Join-Path $InstallDir $item
        if ((Test-Path $src) -and -not (Test-Path $dst)) {
            Move-Item -Path $src -Destination $dst -Force
            Write-Step 'Moved:' "$item -> $InstallDir"
        }
    }

    # Everything else worth keeping is whatever git calls untracked — a prompt
    # written only on this machine, say. Tracked files come back from the reset,
    # so they need no help. Relative paths are preserved: SystemPrompts has
    # subdirectories, and flattening them would dump prompt fragments into the
    # picker as if they were whole prompts.
    foreach ($line in @(& git -C $nested status --porcelain --untracked-files=all 2>$null)) {
        if ($line -notmatch '^\?\?\s+(.+)$') { continue }
        $rel = $Matches[1].Trim('"').Replace('/', '\')
        $src = Join-Path $nested $rel
        $dst = Join-Path $InstallDir $rel
        if (-not (Test-Path $src)) { continue }
        if (Test-Path $dst) { continue }
        $dstParent = Split-Path $dst -Parent
        if (-not (Test-Path $dstParent)) {
            New-Item -ItemType Directory -Path $dstParent -Force | Out-Null
        }
        Move-Item -Path $src -Destination $dst -Force
        Write-Step 'Kept:' $rel
    }
}

# --- Check out the repo into the install directory ---------------------------

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

if (Test-Path (Join-Path $InstallDir '.git')) {
    Write-Step 'Updating:' $InstallDir
    & git -C $InstallDir remote set-url origin $RepoUrl
} else {
    # The directory usually already holds the old shim, so `git clone` is out —
    # it refuses a non-empty target. Init in place and reset onto the remote,
    # which overwrites those leftovers with the tracked versions.
    Write-Step 'Checking out:' "$RepoUrl -> $InstallDir"
    & git -C $InstallDir init --quiet
    & git -C $InstallDir remote add origin $RepoUrl
}

& git -C $InstallDir fetch --quiet origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: could not fetch $RepoUrl" -ForegroundColor Red
    exit 1
}
& git -C $InstallDir reset --hard --quiet FETCH_HEAD
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: could not check out the working tree at $InstallDir" -ForegroundColor Red
    exit 1
}
# A fresh init leaves HEAD detached on FETCH_HEAD; put it on main. Forcing the
# branch while it is already checked out is an error, so only move when needed.
$branch = "$(& git -C $InstallDir rev-parse --abbrev-ref HEAD 2>$null)".Trim()
if ($branch -ne 'main') {
    & git -C $InstallDir checkout --quiet -B main FETCH_HEAD 2>&1 | Out-Null
}
Write-Step 'At:' "$(& git -C $InstallDir log --oneline -1)"

# --- Retire the nested clone -------------------------------------------------
# Only once its local state is upstairs and nothing unexpected is left in it.

if (Test-Path (Join-Path $nested '.git')) {
    $leftovers = @(& git -C $nested status --porcelain --ignored --untracked-files=all 2>$null |
        Where-Object { $_ -notmatch '(^|/)(\.cache|tweakcc-presets|backends\.json)' })
    if ($leftovers.Count -eq 0) {
        Remove-Item $nested -Recurse -Force
        Write-Step 'Removed:' "$nested (superseded)"
    } else {
        Write-Host "  WARN: leaving $nested in place -- it still holds files not in the repo:" -ForegroundColor Yellow
        $leftovers | Select-Object -First 10 | ForEach-Object { Write-Host "        $_" -ForegroundColor DarkGray }
    }
}

# --- Update PATH -------------------------------------------------------------

$currentPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($null -eq $currentPath) { $currentPath = '' }
$pathParts = $currentPath -split ';' | Where-Object { $_ -ne '' }

if ($pathParts | Where-Object { $_.TrimEnd('\') -eq $InstallDir }) {
    Write-Step 'PATH:' "already contains $InstallDir" Yellow
} else {
    $newPath = ($pathParts + $InstallDir) -join ';'
    [Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')
    Write-Step 'PATH:' "added $InstallDir" Green
}

# --- Done --------------------------------------------------------------------

$legacyPrompts = Join-Path $env:USERPROFILE '.claude\SystemPrompts'
if (Test-Path $legacyPrompts) {
    Write-Host ""
    Write-Host "  Note: $legacyPrompts is left over from the copy-based install." -ForegroundColor DarkGray
    Write-Host "        Prompts are read from $InstallDir\SystemPrompts now." -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  CustomClaude installed.' -ForegroundColor Cyan
Write-Host '  Open a new terminal and run: ' -NoNewline -ForegroundColor DarkGray
Write-Host 'CustomClaude' -ForegroundColor White
Write-Host ''
