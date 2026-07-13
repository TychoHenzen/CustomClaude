<#
.SYNOPSIS
    Launch Claude Code with custom system prompt, backend, patched binary.
.DESCRIPTION
    1. Pins CC to latest version with BOTH tweakcc-fixed prompt support AND connoisseur patched binary
    2. Installs stock CC, overlays connoisseur binary, applies tweakcc-fixed
    3. Interactive pickers for version, tweakcc preset, system prompt, backend
.USAGE
    CustomClaude       # interactive (4 pickers)
    CustomClaude -q    # quick: auto-accept all 4 steps from last config
#>

param(
    [switch]$q
)

$ErrorActionPreference = "Stop"

# -- Prevent Claude from auto-updating behind our back ------------------------
$env:CLAUDE_CODE_SKIP_AUTO_UPDATE = "1"

# -- Paths (resolved ONCE, never recomputed) ----------------------------------

$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ClaudeExe = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
$TweakccDir = Join-Path $env:USERPROFILE ".tweakcc"
$TweakccCfg = Join-Path $TweakccDir "config.json"
$TweakccCloneDir = Join-Path $RepoDir ".cache\tweakcc-fixed"
$PresetsDir = Join-Path $RepoDir "tweakcc-presets"
$PromptsDir = Join-Path $RepoDir "SystemPrompts"
$BackendsCfg = Join-Path $env:USERPROFILE ".claude\backends.json"
$ghHeaders = @{'Accept'='application/vnd.github+json'; 'User-Agent'='customclaude'}

# -- Backend config -----------------------------------------------------------

function Load-BackendConfig {
    if (-not (Test-Path $BackendsCfg)) {
        Write-Host "  WARN: No backends.json, using Anthropic native." -ForegroundColor Yellow
        return @{
            default = "anthropic"
            backends = @{
                anthropic = @{ label = "Anthropic Native" }
            }
        }
    }
    try {
        $cfg = Get-Content $BackendsCfg -Raw | ConvertFrom-Json
        # Resolve ~ in proxy dir
        foreach ($key in $cfg.backends.PSObject.Properties.Name) {
            $b = $cfg.backends.$key
            if ($b.proxy -and $b.proxy.dir) {
                $b.proxy.dir = $b.proxy.dir -replace '^~', $env:USERPROFILE
            }
        }
        return $cfg
    } catch {
        Write-Host "  ERROR: Invalid backends.json: $_" -ForegroundColor Red
        exit 1
    }
}

function Start-BackendProxy {
    param($backendCfg)

    $proxy = $backendCfg.proxy
    if (-not $proxy) { return @{ process = $null; wasRunning = $false } }

    # Check if already running
    if ($proxy.healthUrl) {
        try {
            $status = Invoke-RestMethod -Uri $proxy.healthUrl -TimeoutSec 1 -ErrorAction Stop
            $hk = $proxy.healthKey; $hv = $proxy.healthValue
            if ((-not $hk) -or ($status.$hk -eq $hv)) {
                Write-Host "  Reusing existing proxy" -ForegroundColor DarkGray
                return @{ process = $null; wasRunning = $true }
            }
        } catch {}
    }

    # Start proxy
    $apiKey = $backendCfg.apiKey
    if ($apiKey) { $env:DEEPSEEK_API_KEY = $apiKey }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = $proxy.command
    $psi.WorkingDirectory = $proxy.dir
    $psi.UseShellExecute = $false
    if ($apiKey) { $psi.EnvironmentVariables["DEEPSEEK_API_KEY"] = $apiKey }

    try {
        $proc = [System.Diagnostics.Process]::Start($psi)
        $pidFile = Join-Path $env:TEMP "customclaude-proxy.pid"
        $proc.Id | Out-File -FilePath $pidFile -NoNewline
    } catch {
        Write-Host "  ERROR: Could not start proxy: $_" -ForegroundColor Red
        exit 1
    }

    # Health check
    Write-Host "  Waiting for proxy..." -NoNewline -ForegroundColor DarkGray
    $ready = $false
    for ($i = 0; $i -lt 20; $i++) {
        try {
            $status = Invoke-RestMethod -Uri $proxy.healthUrl -TimeoutSec 1 -ErrorAction Stop
            $hk = $proxy.healthKey; $hv = $proxy.healthValue
            if ((-not $hk) -or ($status.$hk -eq $hv)) { $ready = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 500
        Write-Host "." -NoNewline -ForegroundColor DarkGray
    }
    if ($ready) {
        Write-Host " ready" -ForegroundColor Green
    } else {
        Write-Host " FAILED" -ForegroundColor Red
        try { $proc.Kill() } catch {}
        exit 1
    }
    return @{ process = $proc; wasRunning = $false }
}

function Apply-BackendEnv {
    param($backendCfg)

    # Clear env vars the backend wants gone
    if ($backendCfg.clearEnv) {
        $backendCfg.clearEnv | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
    }
    # Set env vars from config
    if ($backendCfg.env) {
        $backendCfg.env.PSObject.Properties | ForEach-Object {
            Set-Item "Env:$($_.Name)" $_.Value
        }
    }
    # Auth token routing: if proxy is used, auth token = api key
    if ($backendCfg.proxy -and $backendCfg.apiKey) {
        $env:ANTHROPIC_AUTH_TOKEN = $backendCfg.apiKey
    }
}

# -- Helpers ------------------------------------------------------------------

function Kill-ClaudeProcs {
    $procs = @(Get-Process -Name "claude" -ErrorAction SilentlyContinue)
    if ($procs.Count -gt 0) {
        Write-Host "  Killing $($procs.Count) Claude process(es)..." -ForegroundColor DarkGray
        $procs | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 600
    }
}

function Get-ClaudeVersion {
    if (-not (Test-Path $ClaudeExe)) { return "none" }
    $out = "$(& $ClaudeExe --version 2>&1)"
    if ($out -match "([0-9]+\.[0-9]+\.[0-9]+)") { return $Matches[1] }
    return "unknown"
}

function ConvertTo-WslPath {
    param([string]$WinPath)
    $drive = $WinPath.Substring(0,1).ToLower()
    return '/mnt/' + $drive + $WinPath.Substring(2).Replace('\', '/')
}

# -- Determine current version ------------------------------------------------

$currentVer = Get-ClaudeVersion
Write-Host "  CC binary: $ClaudeExe" -ForegroundColor DarkGray
Write-Host "  CC version: $currentVer" -ForegroundColor DarkGray

# -- Pull tweakcc-fixed for version data --------------------------------------

if (-not (Test-Path "$TweakccCloneDir\data\prompts")) {
    # Partial/broken clone blocks git clone; remove it first
    if (Test-Path $TweakccCloneDir) {
        Remove-Item $TweakccCloneDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  Cloning tweakcc-fixed..." -ForegroundColor DarkGray
    & git clone --depth 1 --quiet "https://github.com/skrabe/tweakcc-fixed.git" $TweakccCloneDir
} else {
    & git -C $TweakccCloneDir pull --quiet
}

$tweakccVersions = Get-ChildItem "$TweakccCloneDir\data\prompts" -Filter "prompts-*.json" -ErrorAction SilentlyContinue |
    ForEach-Object { if ($_.Name -match 'prompts-(\d+\.\d+\.\d+)\.json') { $Matches[1] } } |
    Where-Object { $_ }

# -- Query connoisseur releases -----------------------------------------------

$connVersions = $null
try {
    $connReleases = Invoke-RestMethod -Uri 'https://api.github.com/repos/a-connoisseur/patch-claude-code/releases?per_page=100' -Headers $ghHeaders -TimeoutSec 10
    $connVersions = $connReleases | ForEach-Object {
        if ($_.tag_name -match '^v([\d.]+)-win32-x64$') { $Matches[1] }
    } | Select-Object -Unique
} catch {
    Write-Host "  WARN: Could not query connoisseur releases: $_" -ForegroundColor Yellow
}

# -- Compute target version (intersection of both, with picker) ---------------

$intersectVersions = @()
if ($connVersions) {
    $intersectVersions = @($tweakccVersions | Where-Object { $_ -in $connVersions } |
        Sort-Object { [System.Version]$_ } -Descending | Select-Object -First 5)
}
if ($intersectVersions.Count -eq 0) {
    $intersectVersions = @($tweakccVersions | Sort-Object { [System.Version]$_ } -Descending | Select-Object -First 5)
    Write-Host "  No connoisseur intersection, using tweakcc-only versions." -ForegroundColor DarkGray
}

$lastVersionFile = Join-Path $env:TEMP "customclaude-last-version.txt"
$lastVersion = if (Test-Path $lastVersionFile) { (Get-Content $lastVersionFile -Raw).Trim() } else { "" }

if ($q) {
    # Non-interactive: use last version if valid, else latest
    if ($lastVersion -and $lastVersion -in $intersectVersions) {
        $targetVer = $lastVersion
    } else {
        $targetVer = $intersectVersions[0]
    }
    Write-Host "  Target: $targetVer (last used)" -ForegroundColor DarkGray
} elseif ($intersectVersions.Count -eq 1) {
    $targetVer = $intersectVersions[0]
    Write-Host "  Target: $targetVer (only available)" -ForegroundColor DarkGray
} else {
    Write-Host ""
    Write-Host "  CC Version" -ForegroundColor Cyan
    Write-Host "  $('-' * 40)" -ForegroundColor DarkGray
    $defaultIdx = 0
    if ($lastVersion -and $lastVersion -in $intersectVersions) {
        $defaultIdx = [array]::IndexOf($intersectVersions, $lastVersion)
    }
    for ($i = 0; $i -lt $intersectVersions.Count; $i++) {
        $v = $intersectVersions[$i]
        $tags = @()
        if ($i -eq 0) { $tags += "latest" }
        if ($v -eq $currentVer) { $tags += "installed" }
        if ($v -eq $lastVersion) { $tags += "last" }
        $tagStr = if ($tags.Count -gt 0) { " ($($tags -join ', '))" } else { "" }
        Write-Host "  [$($i + 1)] " -NoNewline -ForegroundColor Green
        Write-Host "$v$tagStr" -ForegroundColor White
    }
    Write-Host ""
    $defaultNum = $defaultIdx + 1
    $vChoice = Read-Host "  Pick version [$defaultNum]"
    if ($vChoice -eq "") { $vChoice = $defaultNum }
    $vIdx = [int]$vChoice - 1
    if ($vIdx -lt 0 -or $vIdx -ge $intersectVersions.Count) {
        Write-Host "  Invalid, using latest." -ForegroundColor Yellow
        $vIdx = 0
    }
    $targetVer = $intersectVersions[$vIdx]
}
$targetVer | Out-File -FilePath $lastVersionFile -NoNewline
Write-Host "  Target: $targetVer" -ForegroundColor DarkGray

# -- Full uninstall + clean install if version is wrong -----------------------
# The native installer caches binaries in versions/. Patching claude.exe can
# contaminate that cache (hardlink or same-file), so we nuke the entire install
# before re-installing to guarantee a clean stock binary.

if ($targetVer -and $currentVer -ne $targetVer) {
    Kill-ClaudeProcs

    Write-Host "  Uninstalling CC (nuking versions cache)..." -ForegroundColor DarkGray
    Remove-Item $ClaudeExe -Force -ErrorAction SilentlyContinue
    $binDir = Split-Path $ClaudeExe
    Get-ChildItem $binDir -Filter "claude.exe.old.*" -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue
    $versionsDir = Join-Path $env:USERPROFILE ".local\share\claude\versions"
    if (Test-Path $versionsDir) {
        Remove-Item $versionsDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host "  Installing stock CC $targetVer..." -ForegroundColor DarkGray
    try {
        & ([scriptblock]::Create((irm https://claude.ai/install.ps1))) $targetVer
    } catch {
        Write-Host "  WARN: native installer threw: $_" -ForegroundColor Yellow
    }

    if (-not (Test-Path $ClaudeExe)) {
        Write-Host "  ERROR: Installer did not create $ClaudeExe" -ForegroundColor Red
        exit 1
    }

    $currentVer = Get-ClaudeVersion
    if ($currentVer -ne $targetVer) {
        Write-Host "  ERROR: Wanted $targetVer but binary reports $currentVer." -ForegroundColor Red
        Write-Host "         Native installer version pinning failed. Cannot continue." -ForegroundColor Red
        exit 1
    }
    Write-Host "  Stock $currentVer installed." -ForegroundColor Green

    # Nuke tweakcc backup files so --apply creates a fresh backup from stock binary
    @("native-binary.backup", "native-claudejs-orig.js", "native-claudejs-patched.js") | ForEach-Object {
        $f = Join-Path $TweakccDir $_
        if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
    }
    Write-Host "  Cleared tweakcc backup files (fresh slate)." -ForegroundColor DarkGray
}

# -- Apply connoisseur patched binary -----------------------------------------
# Connoisseur may patch more than just the binary (future-proofing), but today
# it replaces claude.exe with a pre-patched build for the same CC version.
# Skip only if this exact version is already connoisseur-patched.

$verOutput = "$(& $ClaudeExe --version 2>&1)"
$isConnoisseur = $verOutput -match '\(patched\)'
if (-not $isConnoisseur -and $connVersions -and $currentVer -in $connVersions) {
    Write-Host "  Downloading connoisseur patch for $currentVer..." -ForegroundColor DarkGray
    try {
        $releaseTag = "v$currentVer-win32-x64"
        $releaseUrl = "https://api.github.com/repos/a-connoisseur/patch-claude-code/releases/tags/$releaseTag"
        $release = Invoke-RestMethod -Uri $releaseUrl -Headers $ghHeaders -TimeoutSec 15
        $asset = $release.assets | Where-Object { $_.name -eq "claude.native.windows.patched.exe" } | Select-Object -First 1
        if ($asset) {
            Kill-ClaudeProcs
            $tmpDir = Join-Path $env:TEMP ([guid]::NewGuid().ToString())
            New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
            $dlPath = Join-Path $tmpDir "claude-patched.exe"
            $prevProg = $ProgressPreference
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -Uri $asset.browser_download_url -Headers $ghHeaders -OutFile $dlPath
            $ProgressPreference = $prevProg
            Copy-Item -LiteralPath $dlPath -Destination $ClaudeExe -Force
            Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
            $currentVer = Get-ClaudeVersion
            Write-Host "  Connoisseur $currentVer (patched) installed." -ForegroundColor Green
        } else {
            Write-Host "  WARN: No connoisseur asset in release $releaseTag" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  WARN: Connoisseur download failed: $_" -ForegroundColor Yellow
    }
} elseif ($isConnoisseur) {
    Write-Host "  Connoisseur: already patched ($currentVer)." -ForegroundColor DarkGray
} else {
    Write-Host "  Connoisseur: no release for $currentVer, using stock." -ForegroundColor DarkGray
}

# -- Point tweakcc at the real binary -----------------------------------------

if (Test-Path $TweakccCfg) {
    try {
        $cfg = Get-Content $TweakccCfg -Raw | ConvertFrom-Json
        if ($cfg.ccInstallationPath -ne $ClaudeExe) {
            $cfg.ccInstallationPath = $ClaudeExe
            $cfg | ConvertTo-Json -Depth 20 | Set-Content $TweakccCfg -NoNewline
            Write-Host "  tweakcc targets: $ClaudeExe" -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "  WARN: tweakcc config update failed: $_" -ForegroundColor Yellow
    }
}

# =============================================================================
# TWEAKCC PRESETS
# =============================================================================

$presetNames  = @("stock", "unnerfcc", "lobotomized", "combined", "basis-custom")
$presetLabels = @(
    "Stock (JS patches only, stock Anthropic prompts)",
    "unnerfcc (lukehutch - lift restrictions, max thoroughness)",
    "lobotomized (skrabe - cut cruft, -28% tokens)",
    "combined (lobotomized base + unnerfcc awareness files)",
    "basis-custom (your custom overrides)"
)

$lastPresetFile        = Join-Path $env:TEMP "customclaude-last-preset.txt"
$lastAppliedPresetFile = Join-Path $env:TEMP "customclaude-last-applied-preset.txt"
$lastPreset = if (Test-Path $lastPresetFile) { (Get-Content $lastPresetFile -Raw).Trim() } else { "stock" }
$lastAppliedRaw = if (Test-Path $lastAppliedPresetFile) { (Get-Content $lastAppliedPresetFile -Raw).Trim() } else { "" }
$lastAppliedPreset  = if ($lastAppliedRaw -match '^(.+)@(.+)$') { $Matches[1] } else { "" }
$lastAppliedVersion = if ($lastAppliedRaw -match '^(.+)@(.+)$') { $Matches[2] } else { "" }
$chosenPreset = $null
$forceApply   = $false

function Initialize-TweakccPresets {
    if (Test-Path $PresetsDir) { return }

    Write-Host ""
    Write-Host "  First-run: setting up tweakcc presets..." -ForegroundColor DarkGray
    @("stock", "unnerfcc", "lobotomized", "combined", "basis-custom") | ForEach-Object {
        New-Item -ItemType Directory -Path "$PresetsDir\$_\system-prompts" -Force | Out-Null
        New-Item -ItemType Directory -Path "$PresetsDir\$_\system-reminders" -Force | Out-Null
    }
    foreach ($subdir in @("system-prompts", "system-reminders")) {
        if (Test-Path "$TweakccDir\$subdir") {
            Get-ChildItem "$TweakccDir\$subdir" -ErrorAction SilentlyContinue |
                Copy-Item -Destination "$PresetsDir\basis-custom\$subdir\" -Force -ErrorAction SilentlyContinue
        }
    }

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Host "  WARNING: git not found, skipping repo clones" -ForegroundColor Yellow
        return
    }

    Write-Host "  Cloning lukehutch/unnerfcc..." -ForegroundColor DarkGray
    & git clone --depth 1 --quiet "https://github.com/lukehutch/unnerfcc.git" "$PresetsDir\_unnerfcc-repo"
    if ($LASTEXITCODE -eq 0) {
        Get-ChildItem "$PresetsDir\_unnerfcc-repo\system-prompts" -Filter "*.md" -ErrorAction SilentlyContinue |
            Copy-Item -Destination "$PresetsDir\unnerfcc\system-prompts\" -Force
        Remove-Item "$PresetsDir\_unnerfcc-repo" -Recurse -Force -ErrorAction SilentlyContinue
    } else { Write-Host "  WARNING: Failed to clone unnerfcc" -ForegroundColor Yellow }

    Write-Host "  Cloning skrabe/lobotomized-claude-code..." -ForegroundColor DarkGray
    & git clone --depth 1 --quiet "https://github.com/skrabe/lobotomized-claude-code.git" "$PresetsDir\_lobotomized-repo"
    if ($LASTEXITCODE -eq 0) {
        $loboPromptsDir = "$PresetsDir\_lobotomized-repo\system-prompts-opus-4-8"
        if (Test-Path $loboPromptsDir) {
            Get-ChildItem $loboPromptsDir -Filter "*.md" |
                Copy-Item -Destination "$PresetsDir\lobotomized\system-prompts\" -Force
        }
        $loboRemindersDir = "$PresetsDir\_lobotomized-repo\system-reminders"
        if (Test-Path $loboRemindersDir) {
            Get-ChildItem $loboRemindersDir -Filter "*.md" |
                Copy-Item -Destination "$PresetsDir\lobotomized\system-reminders\" -Force
        }
        Remove-Item "$PresetsDir\_lobotomized-repo" -Recurse -Force -ErrorAction SilentlyContinue
    } else { Write-Host "  WARNING: Failed to clone lobotomized" -ForegroundColor Yellow }

    # Build combined: lobotomized base + unnerfcc behavioral content merged in
    # Strategy: size-based heuristic. Lobotomized base (compressed, inline docs, MCP routing).
    # Overwrite with unnerfcc when 30-89% bigger (lobo compressed away behavioral content).
    # Keep lobo when >2% bigger (lobo adds inline docs/rubrics) or 90%+ bigger (data stubs).
    Write-Host "  Building combined preset..." -ForegroundColor DarkGray
    $combinedPrompts = "$PresetsDir\combined\system-prompts"
    $combinedReminders = "$PresetsDir\combined\system-reminders"

    # Start with lobotomized as base (prompts + reminders)
    Copy-Item "$PresetsDir\lobotomized\system-prompts\*.md" $combinedPrompts -Force -ErrorAction SilentlyContinue
    Copy-Item "$PresetsDir\lobotomized\system-reminders\*.md" $combinedReminders -Force -ErrorAction SilentlyContinue

    # Add unnerfcc-unique files (13 awareness files lobotomized doesn't ship)
    $loboNames = @(Get-ChildItem "$PresetsDir\lobotomized\system-prompts" -Name)
    Get-ChildItem "$PresetsDir\unnerfcc\system-prompts\*.md" | Where-Object { $_.Name -notin $loboNames } |
        Copy-Item -Destination $combinedPrompts -Force

    # Behavioral overwrite: for common files where unnerfcc is 30-89% larger,
    # lobotomized likely compressed away instructions — use unnerfcc instead.
    $catA = 0  # lobo bigger (keep)
    $catB = 0  # data stubs (keep lobo)
    $catC = 0  # behavioral (use unnerfcc)
    Get-ChildItem "$PresetsDir\lobotomized\system-prompts\*.md" | Where-Object {
        Test-Path (Join-Path "$PresetsDir\unnerfcc\system-prompts" $_.Name)
    } | ForEach-Object {
        $lSize = $_.Length
        $uSize = (Get-Item (Join-Path "$PresetsDir\unnerfcc\system-prompts" $_.Name)).Length
        if ($lSize -gt $uSize) {
            $pct = [math]::Round(($lSize - $uSize) * 100.0 / $uSize)
            if ($pct -gt 2) { $catA++ }
        } elseif ($uSize -gt $lSize) {
            $pct = [math]::Round(($uSize - $lSize) * 100.0 / $uSize)
            if ($pct -ge 90) { $catB++ }
            elseif ($pct -ge 30) {
                Copy-Item (Join-Path "$PresetsDir\unnerfcc\system-prompts" $_.Name) $_.FullName -Force
                $catC++
            }
        }
    }
    $promptCount = @(Get-ChildItem $combinedPrompts -Name -ErrorAction SilentlyContinue).Count
    $remCount   = @(Get-ChildItem $combinedReminders -Name -ErrorAction SilentlyContinue).Count
    Write-Host "  Combined: $promptCount prompts, $remCount reminders (${catA} lobo-adds, ${catB} data-stubs, ${catC} behavioral overwrites)" -ForegroundColor Green

    Write-Host "  Presets initialized." -ForegroundColor Green
}

function Apply-TweakccPreset {
    param([string]$Preset)

    foreach ($subdir in @("system-prompts", "system-reminders")) {
        if (-not (Test-Path "$TweakccDir\$subdir")) {
            New-Item -ItemType Directory -Path "$TweakccDir\$subdir" -Force | Out-Null
        }
        Get-ChildItem "$TweakccDir\$subdir" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    }
    if ($Preset -eq "stock") { return }

    $src = "$PresetsDir\$Preset"
    foreach ($subdir in @("system-prompts", "system-reminders")) {
        Get-ChildItem "$src\$subdir" -Filter "*.md" -ErrorAction SilentlyContinue |
            Copy-Item -Destination "$TweakccDir\$subdir\" -Force
    }
}

# -- Preset selection ---------------------------------------------------------

if ($q) {
    $chosenPreset = $lastPreset
    Write-Host ""
    Write-Host "  Tweakcc Preset: $chosenPreset (last used)" -ForegroundColor DarkGray
} else {
    Initialize-TweakccPresets
    Write-Host ""
    Write-Host "  Tweakcc Preset" -ForegroundColor Cyan
    Write-Host "  $('-' * 40)" -ForegroundColor DarkGray

    $lastIdx = $presetNames.IndexOf($lastPreset)
    if ($lastIdx -lt 0) { $lastIdx = 0 }
    for ($i = 0; $i -lt $presetNames.Count; $i++) {
        $mark = if ($presetNames[$i] -eq $lastPreset) { " (last)" } else { "" }
        Write-Host "  [$($i + 1)] " -NoNewline -ForegroundColor Green
        Write-Host "$($presetLabels[$i])$mark" -ForegroundColor White
    }
    Write-Host "  [f] " -NoNewline -ForegroundColor Yellow
    Write-Host "Force re-apply (skip 'already applied' check)" -ForegroundColor DarkGray
    Write-Host ""

    $defaultNum = $lastIdx + 1
    $choice = Read-Host "  Pick preset [$defaultNum]"
    if ($choice -eq "") { $choice = $defaultNum }

    if ($choice -match '^[Ff]$') {
        $presetIdx = $lastIdx; $forceApply = $true
        Write-Host "  Force re-applying '$($presetNames[$presetIdx])'..." -ForegroundColor Yellow
    } elseif ($choice -match '^(\d+)[Ff]$') {
        $presetIdx = [int]$Matches[1] - 1; $forceApply = $true
    } else {
        $presetIdx = [int]$choice - 1
    }
    if ($presetIdx -lt 0 -or $presetIdx -ge $presetNames.Count) {
        Write-Host "  Invalid selection, defaulting to stock." -ForegroundColor Yellow
        $presetIdx = 0
    }
    $chosenPreset = $presetNames[$presetIdx]
}

$chosenPreset | Out-File -FilePath $lastPresetFile -NoNewline

# -- Apply tweakcc preset (skip if already done for this version) -------------

if (-not $forceApply -and $lastAppliedPreset -and
    $chosenPreset -eq $lastAppliedPreset -and $currentVer -eq $lastAppliedVersion) {
    Write-Host "  Tweakcc '$chosenPreset' already applied ($currentVer), skipping." -ForegroundColor DarkGray
} else {
    if ($forceApply) {
        Write-Host "  Forcing re-apply of '$chosenPreset'." -ForegroundColor Yellow
    }
    Apply-TweakccPreset -Preset $chosenPreset

    Kill-ClaudeProcs

    Write-Host "  Applying tweakcc ($chosenPreset)..." -NoNewline -ForegroundColor DarkGray
    $applyOutput = & npx -y tweakcc-fixed@latest --apply 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host " done" -ForegroundColor Green
        "$chosenPreset@$currentVer" | Out-File -FilePath $lastAppliedPresetFile -NoNewline
    } else {
        Write-Host " FAILED" -ForegroundColor Red
        Write-Host "  $applyOutput" -ForegroundColor DarkGray
        if ($chosenPreset -eq $lastPreset -and $applyOutput -match "EBUSY|locked") {
            Write-Host "  (binary locked; preset files in place -- saving as applied)" -ForegroundColor DarkGray
            "$chosenPreset@$currentVer" | Out-File -FilePath $lastAppliedPresetFile -NoNewline
        }
    }
}

# =============================================================================
# SYSTEM PROMPT PICKER
# =============================================================================

if (-not (Test-Path $PromptsDir)) {
    Write-Host "ERROR: $PromptsDir not found." -ForegroundColor Red
    exit 1
}

$files = Get-ChildItem -Path $PromptsDir -File -Filter "*.md" | Sort-Object Name
if ($files.Count -eq 0) {
    Write-Host "No .md files in $PromptsDir" -ForegroundColor Red
    exit 1
}

$extraArgsStr = ""
if ($args.Count -gt 0) {
    $extraArgsStr = " " + (($args | ForEach-Object {
        if ($_ -match '[\s"]') { "`"$($_ -replace '"', '\`"')`"" } else { $_ }
    }) -join " ")
}

$chosen = $null
$lastPromptFile = Join-Path $env:TEMP "customclaude-last-prompt.txt"
$lastPrompt = if (Test-Path $lastPromptFile) { (Get-Content $lastPromptFile -Raw).Trim() } else { "" }

if ($q) {
    if ($lastPrompt) {
        $match = $files | Where-Object { $_.BaseName -eq $lastPrompt }
        if ($match) { $chosen = $match }
    }
    if ($chosen) {
        Write-Host "  Prompt: $($chosen.BaseName) (last used)" -ForegroundColor DarkGray
    } else {
        Write-Host "  Prompt: default (no last prompt)" -ForegroundColor DarkGray
    }
} else {
    Write-Host ""
    Write-Host "  System Prompts" -ForegroundColor Cyan
    Write-Host "  $('-' * 40)" -ForegroundColor DarkGray
    $defaultPromptIdx = -1
    if ($lastPrompt) {
        for ($i = 0; $i -lt $files.Count; $i++) {
            if ($files[$i].BaseName -eq $lastPrompt) { $defaultPromptIdx = $i; break }
        }
    }
    for ($i = 0; $i -lt $files.Count; $i++) {
        $f = $files[$i]
        $sizeKB = [math]::Round($f.Length / 1024, 1)
        $firstLine = (Get-Content $f.FullName -TotalCount 1) -replace '^#\s*', ''
        $mark = if ($i -eq $defaultPromptIdx) { " (last)" } else { "" }
        Write-Host "  [$($i + 1)] " -NoNewline -ForegroundColor Green
        Write-Host "$($f.BaseName)$mark" -NoNewline -ForegroundColor White
        Write-Host " (${sizeKB}KB)" -NoNewline -ForegroundColor DarkGray
        if ($firstLine) { Write-Host " - $firstLine" -ForegroundColor DarkGray } else { Write-Host "" }
    }
    Write-Host "  [0] " -NoNewline -ForegroundColor Yellow
    Write-Host "Default (no custom prompt)" -ForegroundColor DarkGray
    Write-Host ""

    $defaultNum = if ($defaultPromptIdx -ge 0) { $defaultPromptIdx + 1 } else { "0" }
    $selection = Read-Host "  Pick [$defaultNum]"
    if ($selection -eq "") { $selection = $defaultNum }
    if ($selection -ne "0" -and $selection -ne "") {
        $idx = [int]$selection - 1
        if ($idx -lt 0 -or $idx -ge $files.Count) {
            Write-Host "Invalid selection." -ForegroundColor Red
            exit 1
        }
        $chosen = $files[$idx]
    }
}

# Persist last prompt selection
if ($chosen) {
    $chosen.BaseName | Out-File -FilePath $lastPromptFile -NoNewline
} elseif ($selection -eq "0") {
    Remove-Item $lastPromptFile -ErrorAction SilentlyContinue
}

# =============================================================================
# BACKEND PICKER
# =============================================================================

$backendCfg = Load-BackendConfig
$backendKeys = @($backendCfg.backends.PSObject.Properties.Name)
$lastBackendFile = Join-Path $env:TEMP "customclaude-last-backend.txt"
$lastBackend = if (Test-Path $lastBackendFile) { (Get-Content $lastBackendFile -Raw).Trim() } else { $backendCfg.default }

# Resolve backend: last used > config default
$chosenBackend = $null

if ($q) {
    # Non-interactive: use last backend or default
    if (-not $chosenBackend) {
        $chosenBackend = if ($lastBackend -and $lastBackend -in $backendKeys) { $lastBackend } else { $backendCfg.default }
    }
    Write-Host "  Backend: $chosenBackend (last used)" -ForegroundColor DarkGray
} else {
    if (-not $chosenBackend) {
        Write-Host ""
        Write-Host "  Backend" -ForegroundColor Cyan
        Write-Host "  $('-' * 40)" -ForegroundColor DarkGray
        $lastIdx = [array]::IndexOf($backendKeys, $lastBackend)
        if ($lastIdx -lt 0) { $lastIdx = [array]::IndexOf($backendKeys, $backendCfg.default) }
        if ($lastIdx -lt 0) { $lastIdx = 0 }
        for ($i = 0; $i -lt $backendKeys.Count; $i++) {
            $k = $backendKeys[$i]
            $b = $backendCfg.backends.$k
            $mark = if ($k -eq $lastBackend) { " (last)" } else { "" }
            Write-Host "  [$($i + 1)] " -NoNewline -ForegroundColor Green
            Write-Host "$($b.label)$mark" -ForegroundColor White
            if ($b.description) { Write-Host "      $($b.description)" -ForegroundColor DarkGray }
        }
        Write-Host ""
        $defaultNum = $lastIdx + 1
        $bkChoice = Read-Host "  Pick backend [$defaultNum]"
        if ($bkChoice -eq "") { $bkChoice = $defaultNum }
        $bkIdx = [int]$bkChoice - 1
        if ($bkIdx -lt 0 -or $bkIdx -ge $backendKeys.Count) {
            Write-Host "  Invalid, using default." -ForegroundColor Yellow
            $bkIdx = [array]::IndexOf($backendKeys, $backendCfg.default)
            if ($bkIdx -lt 0) { $bkIdx = 0 }
        }
        $chosenBackend = $backendKeys[$bkIdx]
    }
}
$chosenBackend | Out-File -FilePath $lastBackendFile -NoNewline
$backendCfg = $backendCfg.backends.$chosenBackend

# -- Start proxy + apply env ------------------------------------------------

$proxyResult = Start-BackendProxy -backendCfg $backendCfg
$proxyProcess = $proxyResult.process
$proxyWasAlreadyRunning = $proxyResult.wasRunning
Apply-BackendEnv -backendCfg $backendCfg

# -- Summary ----------------------------------------------------------------

Write-Host ""
Write-Host "  Prompt:  " -NoNewline -ForegroundColor DarkGray
if ($chosen) { Write-Host "$($chosen.BaseName)" -ForegroundColor Cyan } else { Write-Host "default" -ForegroundColor DarkGray }
Write-Host "  Backend: " -NoNewline -ForegroundColor DarkGray
Write-Host "$($backendCfg.label)" -ForegroundColor Magenta
Write-Host "  Preset:  " -NoNewline -ForegroundColor DarkGray
Write-Host "$chosenPreset" -ForegroundColor Blue
Write-Host "  CWD:     " -NoNewline -ForegroundColor DarkGray
Write-Host "$(Get-Location)" -ForegroundColor White
Write-Host ""

# -- Launch -------------------------------------------------------------------

$diagFile = Join-Path $env:TEMP "customclaude-env-dump.log"
"=== $(Get-Date -Format 'HH:mm:ss') ===" | Out-File $diagFile -Encoding utf8
Get-ChildItem env: | Where-Object { $_.Name -match '^(ANTHROPIC|CLAUDE|DEEPSEEK)' } | ForEach-Object {
    $val = if ($_.Name -match 'TOKEN|KEY') { $_.Value.Substring(0, [Math]::Min(8, $_.Value.Length)) + '...' } else { $_.Value }
    "$($_.Name)=$val" | Out-File $diagFile -Encoding utf8 -Append
}
Write-Host "  Env dump: $diagFile" -ForegroundColor DarkGray

try {
    if ($backendCfg.wsl) {
        if ($chosen) {
            $wslPromptPath = ConvertTo-WslPath $chosen.FullName
            & wsl bash -c "claude --system-prompt-file `"$wslPromptPath`"$extraArgsStr"
        } else {
            & wsl bash -c "claude$extraArgsStr"
        }
    } elseif ($chosen) {
        & "$env:ComSpec" /c "claude --system-prompt-file `"$($chosen.FullName)`"$extraArgsStr"
    } else {
        & "$env:ComSpec" /c "claude$extraArgsStr"
    }
} finally {
    if ($proxyProcess -or $proxyWasAlreadyRunning) {
        Start-Sleep -Milliseconds 500
        $siblingCount = @(Get-Process -Name "claude" -ErrorAction SilentlyContinue).Count
        if ($siblingCount -eq 0) {
            Write-Host "  Stopping proxy (last instance)..." -NoNewline -ForegroundColor DarkGray
            if ($proxyProcess) {
                try { $proxyProcess.Kill(); $proxyProcess.WaitForExit(3000); Write-Host " done" -ForegroundColor DarkGray } catch { Write-Host " (stopped)" -ForegroundColor DarkGray }
            } else {
                $pidFile = Join-Path $env:TEMP "customclaude-proxy.pid"
                if (Test-Path $pidFile) {
                    try {
                        $proxyPid = [int](Get-Content $pidFile -Raw)
                        (Get-Process -Id $proxyPid -ErrorAction Stop).Kill()
                        Remove-Item $pidFile -ErrorAction SilentlyContinue
                        Write-Host " done" -ForegroundColor DarkGray
                    } catch { Write-Host " (stopped)" -ForegroundColor DarkGray }
                }
            }
        }
    }
}
exit $LASTEXITCODE
