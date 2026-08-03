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
$ClaudeHome = Join-Path $env:USERPROFILE ".claude"
$EnforcementSrc = Join-Path $RepoDir "enforcement\claude"
$ghHeaders = @{'Accept'='application/vnd.github+json'; 'User-Agent'='customclaude'}
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

# -- git ----------------------------------------------------------------------
# Two faults used to end the launch here, and both hid what happened.
#
# git writes .git/index.lock while it changes the index. It removes the lock
# when it finishes. A killed git leaves the lock behind, and every later
# command on that clone refuses to run.
#
# On top of that, this script sets $ErrorActionPreference to Stop, and PowerShell
# turns a native command's stderr into a terminating error once the stream is
# redirected. Every call used the form `git ... 2>&1 | Out-Null`, so one line on
# stderr ended the whole launch, and the redirect threw away the line that said
# why. A stale lock in the tweakcc clone stopped customclaude from starting at
# all, with no usable message.
#
# Clear the lock, because the lock is the fault. Report anything else in full.

# Remove a lock no live git holds. These commands finish in well under a second,
# so a lock older than the threshold belongs to a process that is gone.
function Remove-StaleGitLock {
    param([string]$Dir, [int]$MinAgeSeconds = 10)

    $lock = Join-Path $Dir ".git\index.lock"
    if (-not (Test-Path $lock)) { return $false }
    $age = (Get-Date) - (Get-Item $lock).LastWriteTime
    if ($age.TotalSeconds -lt $MinAgeSeconds) { return $false }
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
    return -not (Test-Path $lock)
}

# Run git and return its exit code and its output. Never throws, so a failed
# git is a value the caller reads, not a dead script. Merges stderr into the
# text on purpose: that text is the error report.
function Invoke-Git {
    param([string[]]$GitArgs)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        # A redirected stderr line arrives as an ErrorRecord. Take the message
        # git wrote and drop the PowerShell frame around it.
        $lines = & git @GitArgs 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
        }
        $code = $LASTEXITCODE
        $text = ($lines -join "`n").Trim()
    } finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{ Ok = ($code -eq 0); Code = $code; Text = $text }
}

# Run one git step against a clone. Clears a stale lock and tries again, then
# prints git's own words when it still fails. Returns whether the step worked.
function Invoke-GitStep {
    param([string]$What, [string]$Dir, [string[]]$GitArgs)

    $result = Invoke-Git -GitArgs $GitArgs
    if ($result.Ok) { return $true }

    if ($Dir -and $result.Text -match 'index\.lock' -and (Remove-StaleGitLock -Dir $Dir)) {
        Write-Host "  Cleared a stale git lock in $Dir" -ForegroundColor DarkGray
        $result = Invoke-Git -GitArgs $GitArgs
        if ($result.Ok) { return $true }
    }

    Write-Host "  WARNING: $What failed (git exit $($result.Code))" -ForegroundColor Yellow
    foreach ($line in ($result.Text -split "`r?`n")) {
        if ($line.Trim()) { Write-Host "    $line" -ForegroundColor DarkGray }
    }
    return $false
}

# -- Writing and code structure enforcement -----------------------------------
# The checkers live in this repository under enforcement/claude, which mirrors
# ~/.claude. A launcher run is the only moment we know the checkout is current.
# The deployed copy is refreshed here, not by a separate install step.

function Copy-EnforcementTrees {
    $changed = 0
    foreach ($tree in @("ste", "hooks", "git-hooks", "lib")) {
        $src = Join-Path $EnforcementSrc $tree
        if (-not (Test-Path $src)) { continue }
        foreach ($file in @(Get-ChildItem $src -Recurse -File)) {
            $rel = $file.FullName.Substring($EnforcementSrc.Length).TrimStart('\')
            $dst = Join-Path $ClaudeHome $rel
            $dstDir = Split-Path $dst -Parent
            if (-not (Test-Path $dstDir)) {
                New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
            }
            if (Test-Path $dst) {
                $srcHash = (Get-FileHash $file.FullName -Algorithm SHA256).Hash
                $dstHash = (Get-FileHash $dst -Algorithm SHA256).Hash
                if ($srcHash -eq $dstHash) { continue }
            }
            Copy-Item $file.FullName $dst -Force
            Write-Host "  Enforcement: updated $rel" -ForegroundColor DarkGray
            $changed++
        }
    }
    return $changed
}

# The readability scorer needs a word frequency table. This fetches it after
# the tree copy above, so the deployed script under $ClaudeHome is current
# before it runs. The fetcher script decides on its own whether its table is
# current. It never exits non-zero, so a failed or missing download here
# can never stop the launch.
function Sync-WordFreqTable {
    $node = (Get-Command node -ErrorAction SilentlyContinue)
    if (-not $node) { return 0 }
    $script = Join-Path $ClaudeHome "ste\build-word-freq.mjs"
    if (-not (Test-Path $script)) { return 0 }

    $output = & $node.Source $script 2>&1
    if ($output -match 'wrote word-freq table') {
        Write-Host "  Enforcement: word-freq table updated." -ForegroundColor Green
        return 1
    }
    if ($output -match 'warning:') {
        Write-Host "  WARN: word-freq table fetch skipped." -ForegroundColor Yellow
    }
    return 0
}

# The rule text goes in its own file next to CLAUDE.md. CLAUDE.md itself only
# ever gains one include line, so a hand-written section there is never touched.
function Write-EnforcementRules {
    $parts = @()
    foreach ($name in @("CLAUDE-section.md", "CLAUDE-code-section.md")) {
        $path = Join-Path $EnforcementSrc $name
        if (Test-Path $path) {
            $parts += ((Get-Content $path -Raw) -replace "`r`n", "`n").TrimEnd()
        }
    }
    if ($parts.Count -eq 0) { return 0 }

    $body = ($parts -join "`n`n") + "`n"
    $target = Join-Path $ClaudeHome "enforcement.md"
    if (Test-Path $target) {
        $current = (Get-Content $target -Raw) -replace "`r`n", "`n"
        if ($current -eq $body) { return 0 }
    }
    [System.IO.File]::WriteAllText($target, $body, $Utf8NoBom)
    Write-Host "  Enforcement: wrote $target" -ForegroundColor DarkGray
    return 1
}

# New include lines join the block of includes at the top, where CLAUDE.md keeps
# the others. Content below that block stays where the operator put it.
function Add-EnforcementInclude {
    $claudeMd = Join-Path $ClaudeHome "CLAUDE.md"
    $line = "@enforcement.md"
    if (-not (Test-Path $claudeMd)) {
        [System.IO.File]::WriteAllText($claudeMd, "$line`n", $Utf8NoBom)
        Write-Host "  Enforcement: created $claudeMd with $line" -ForegroundColor DarkGray
        return 1
    }

    $lines = @(Get-Content $claudeMd)
    if ($lines -contains $line) { return 0 }
    $idx = 0
    while ($idx -lt $lines.Count -and $lines[$idx] -match '^@\S') { $idx++ }
    $merged = @()
    if ($idx -gt 0) { $merged += $lines[0..($idx - 1)] }
    $merged += $line
    if ($idx -lt $lines.Count) { $merged += $lines[$idx..($lines.Count - 1)] }
    [System.IO.File]::WriteAllLines($claudeMd, [string[]]$merged, $Utf8NoBom)
    Write-Host "  Enforcement: added $line to CLAUDE.md" -ForegroundColor Green
    return 1
}

# An older install pasted the same rules straight into CLAUDE.md. Two copies in
# context waste tokens and drift apart, but only the operator may cut theirs.
function Test-EnforcementDuplicateRules {
    $claudeMd = Join-Path $ClaudeHome "CLAUDE.md"
    if (-not (Test-Path $claudeMd)) { return }
    $text = Get-Content $claudeMd -Raw
    foreach ($heading in @("## Writing: Simplified Technical English", "## Code structure: ratchet")) {
        if ($text -match [regex]::Escape($heading)) {
            Write-Host "  NOTE: CLAUDE.md still holds an inline '$heading' section." -ForegroundColor Yellow
            Write-Host "        enforcement.md now carries it. Remove the inline copy." -ForegroundColor DarkGray
        }
    }
}

function New-EnforcementHookEntry {
    param([string]$Matcher, [string]$Script, [int]$TimeoutSec)

    $node = (Get-Command node -ErrorAction SilentlyContinue)
    $nodeCmd = if ($node) { "`"$($node.Source)`"" } else { "node" }
    $target = (Join-Path $ClaudeHome $Script) -replace '\\', '/'
    $hook = [pscustomobject]@{
        type    = "command"
        command = "$nodeCmd `"$target`""
        timeout = $TimeoutSec
    }
    if ($Matcher) {
        return [pscustomobject]@{ matcher = $Matcher; hooks = @($hook) }
    }
    return [pscustomobject]@{ hooks = @($hook) }
}

# We match on the script file name, not on the whole command. A hand-edited node
# path or wrapper then stays in place, and no second copy of the hook appears.
function Sync-EnforcementHooks {
    $settingsPath = Join-Path $ClaudeHome "settings.json"
    if (-not (Test-Path $settingsPath)) {
        Write-Host "  WARN: no $settingsPath, hooks not registered." -ForegroundColor Yellow
        return 0
    }
    $raw = Get-Content $settingsPath -Raw
    try {
        $json = $raw | ConvertFrom-Json
    } catch {
        Write-Host "  WARN: settings.json does not parse, hooks not registered." -ForegroundColor Yellow
        return 0
    }
    if (-not $json.hooks) {
        $json | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) -Force
    }

    $wanted = @(
        @{ Event = "PostToolUse"; Matcher = "Write|Edit|MultiEdit|NotebookEdit"; Script = "hooks/ste-write-guard.mjs";  Timeout = 15 },
        @{ Event = "Stop";        Matcher = "";                                  Script = "hooks/ste-reply-guard.mjs";  Timeout = 10 },
        @{ Event = "PreToolUse";  Matcher = "Bash";                              Script = "hooks/ste-commit-gate.mjs";  Timeout = 10 }
    )
    $added = 0
    foreach ($spec in $wanted) {
        $leaf = Split-Path $spec.Script -Leaf
        if ($raw -match [regex]::Escape($leaf)) { continue }
        $event = $spec.Event
        $existing = @()
        if ($json.hooks.PSObject.Properties.Name -contains $event) {
            $existing = @($json.hooks.$event)
        }
        $entry = New-EnforcementHookEntry -Matcher $spec.Matcher -Script $spec.Script -TimeoutSec $spec.Timeout
        $json.hooks | Add-Member -NotePropertyName $event -NotePropertyValue ($existing + $entry) -Force
        Write-Host "  Enforcement: registered $leaf on $event" -ForegroundColor Green
        $added++
    }
    if ($added -eq 0) { return 0 }

    Copy-Item $settingsPath "$settingsPath.bak" -Force
    [System.IO.File]::WriteAllText($settingsPath, ($json | ConvertTo-Json -Depth 30), $Utf8NoBom)
    return $added
}

function Sync-EnforcementGitHooks {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return 0 }
    $want = (Join-Path $ClaudeHome "git-hooks") -replace '\\', '/'
    $current = "$(& git config --global core.hooksPath 2>$null)".Trim()
    if (-not $current) {
        & git config --global core.hooksPath $want
        Write-Host "  Enforcement: set core.hooksPath to $want" -ForegroundColor Green
        return 1
    }
    if (($current -replace '\\', '/').TrimEnd('/') -ne $want.TrimEnd('/')) {
        Write-Host "  NOTE: core.hooksPath is $current, not $want." -ForegroundColor Yellow
        Write-Host "        The commit message check does not run. Left as is." -ForegroundColor DarkGray
    }
    return 0
}

function Sync-Enforcement {
    if (-not (Test-Path $EnforcementSrc)) {
        Write-Host "  WARN: $EnforcementSrc missing, enforcement not synced." -ForegroundColor Yellow
        return
    }
    $changed = (Copy-EnforcementTrees) + (Write-EnforcementRules) + (Add-EnforcementInclude)
    $changed += (Sync-EnforcementHooks) + (Sync-EnforcementGitHooks) + (Sync-WordFreqTable)
    Test-EnforcementDuplicateRules
    if ($changed -eq 0) {
        Write-Host "  Enforcement: up to date." -ForegroundColor DarkGray
    } else {
        Write-Host "  Enforcement: $changed change(s) applied." -ForegroundColor Green
    }
}

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
    # Auth token routing: proxy backends route through local proxy
    # Direct (native) backends use OAuth — MUST clear proxy leftovers
    if ($backendCfg.proxy -and $backendCfg.apiKey) {
        $env:ANTHROPIC_AUTH_TOKEN = $backendCfg.apiKey
        $env:ANTHROPIC_API_KEY = $backendCfg.apiKey
    } else {
        # Clear auth vars
        Remove-Item "Env:ANTHROPIC_AUTH_TOKEN" -ErrorAction SilentlyContinue
        Remove-Item "Env:ANTHROPIC_API_KEY" -ErrorAction SilentlyContinue
        Remove-Item "Env:DEEPSEEK_API_KEY" -ErrorAction SilentlyContinue
        # Clear ALL env vars set by ANY proxy backend (self-healing: new backends
        # with new env vars are auto-cleared without updating this function)
        $allBackends = Load-BackendConfig
        $allBackends.backends.PSObject.Properties | ForEach-Object {
            if ($_.Value.env) {
                $_.Value.env.PSObject.Properties | ForEach-Object {
                    Remove-Item "Env:$($_.Name)" -ErrorAction SilentlyContinue
                }
            }
        }
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

# Everything here patches the NATIVE install at $ClaudeExe. An npm install of
# claude-code is a second, unpatched copy, and if its shim sits earlier on PATH
# it is the one that runs — with none of the tweakcc work applied and no sign
# that anything is wrong.
function Find-NpmClaudeInstall {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { return $null }

    $prefixes = @()
    if ($env:APPDATA) { $prefixes += (Join-Path $env:APPDATA 'npm') }
    try {
        $p = "$(& npm prefix -g 2>$null)".Trim()
        if ($p -and ($p -notin $prefixes)) { $prefixes += $p }
    } catch {}

    # A malformed APPDATA or an npm prefix that came back as something other
    # than a path makes Test-Path throw, and $ErrorActionPreference here is
    # Stop — a bad environment variable must not take the launcher down.
    foreach ($prefix in $prefixes) {
        if (-not $prefix) { continue }
        if (-not (Test-Path $prefix -ErrorAction SilentlyContinue)) { continue }
        $pkg = Join-Path $prefix 'node_modules\@anthropic-ai\claude-code'
        if (Test-Path $pkg -ErrorAction SilentlyContinue) { return $pkg }
    }
    return $null
}

function Assert-NativeClaudeInstall {
    param([switch]$Quiet)

    $npmPkg = Find-NpmClaudeInstall
    if ($npmPkg) {
        Write-Host "  Found an npm install of claude-code at:" -ForegroundColor Yellow
        Write-Host "    $npmPkg" -ForegroundColor DarkGray
        Write-Host "  It is a separate, unpatched copy of Claude Code." -ForegroundColor Yellow
        if ($Quiet) {
            Write-Host "  Run CustomClaude without -q to remove it." -ForegroundColor DarkGray
        } else {
            $ans = Read-Host "  Uninstall it? [Y/n]"
            if ($ans -eq "" -or $ans -match '^[Yy]') {
                & npm uninstall -g "@anthropic-ai/claude-code"
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "  npm install removed." -ForegroundColor Green
                } else {
                    Write-Host "  WARN: npm uninstall failed (exit $LASTEXITCODE)." -ForegroundColor Yellow
                }
            } else {
                Write-Host "  Left in place. It may shadow the patched native binary." -ForegroundColor DarkGray
            }
        }
    }

    # Independent of npm: PATH order decides what a bare `claude` resolves to.
    # We launch $ClaudeExe by absolute path, so this is only a warning about
    # what the user gets when they type `claude` themselves.
    $onPath = Get-Command claude -ErrorAction SilentlyContinue
    if ($onPath -and $onPath.Source -and ($onPath.Source -ne $ClaudeExe)) {
        Write-Host "  NOTE: `claude` on PATH resolves to $($onPath.Source)," -ForegroundColor Yellow
        Write-Host "        not the patched $ClaudeExe" -ForegroundColor DarkGray
    }
}

# -- Quick-launch: skip version/patch/tweakcc, just load last config and go ---

if ($q) {
    Assert-NativeClaudeInstall -Quiet
    $backendCfg = Load-BackendConfig
    $backendKeys = @($backendCfg.backends.PSObject.Properties.Name)
    $lastBackendFile = Join-Path $env:TEMP "customclaude-last-backend.txt"
    $lastBackend = if (Test-Path $lastBackendFile) { (Get-Content $lastBackendFile -Raw).Trim() } else { $backendCfg.default }
    $chosenBackend = if ($lastBackend -and $lastBackend -in $backendKeys) { $lastBackend } else { $backendCfg.default }
    $chosenBackend | Out-File -FilePath $lastBackendFile -NoNewline
    $backendCfg = $backendCfg.backends.$chosenBackend

    $chosen = $null
    $lastPromptFile = Join-Path $env:TEMP "customclaude-last-prompt.txt"
    $lastPrompt = if (Test-Path $lastPromptFile) { (Get-Content $lastPromptFile -Raw).Trim() } else { "" }
    if ($lastPrompt -and (Test-Path $PromptsDir)) {
        $files = Get-ChildItem -Path $PromptsDir -File -Filter "*.md" | Sort-Object Name
        $match = $files | Where-Object { $_.BaseName -eq $lastPrompt }
        if ($match) { $chosen = $match }
    }

    $proxyResult = Start-BackendProxy -backendCfg $backendCfg
    Apply-BackendEnv -backendCfg $backendCfg

    Write-Host "  Prompt:  " -NoNewline -ForegroundColor DarkGray
    if ($chosen) { Write-Host "$($chosen.BaseName)" -ForegroundColor Cyan } else { Write-Host "default" -ForegroundColor DarkGray }
    Write-Host "  Backend: " -NoNewline -ForegroundColor DarkGray
    Write-Host "$($backendCfg.label)" -ForegroundColor Magenta
    Write-Host ""

    $extraArgsStr = ""
    if ($args.Count -gt 0) {
        $extraArgsStr = " " + (($args | ForEach-Object {
            if ($_ -match '[\s"]') { "`"$($_ -replace '"', '\`"')`"" } else { $_ }
        }) -join " ")
    }
    if ($backendCfg.wsl) {
        if ($chosen) {
            & wsl bash -c "claude --system-prompt-file `"$(ConvertTo-WslPath $chosen.FullName)`"$extraArgsStr"
        } else {
            & wsl bash -c "claude$extraArgsStr"
        }
    } elseif ($chosen) {
        & "$env:ComSpec" /c "`"$ClaudeExe`" --system-prompt-file `"$($chosen.FullName)`"$extraArgsStr"
    } else {
        & "$env:ComSpec" /c "`"$ClaudeExe`"$extraArgsStr"
    }
    if ($proxyResult.process) {
        try { $proxyResult.process.Kill() } catch {}
    }
    exit $LASTEXITCODE
}

# -- Determine current version ------------------------------------------------

Assert-NativeClaudeInstall
Sync-Enforcement

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
    Invoke-GitStep -What "tweakcc-fixed clone" -Dir "" -GitArgs @(
        "clone", "--depth", "1", "--quiet",
        "https://github.com/skrabe/tweakcc-fixed.git", $TweakccCloneDir) | Out-Null
} else {
    # tweakcc-fixed force-pushes its history, so `git pull` on this shallow
    # clone fails as a non-fast-forward and leaves the clone stale — which
    # silently freezes the version list below. Fetch + reset instead.
    if (Invoke-GitStep -What "tweakcc-fixed fetch" -Dir $TweakccCloneDir -GitArgs @(
            "-C", $TweakccCloneDir, "fetch", "--depth", "1", "--quiet", "origin")) {
        Invoke-GitStep -What "tweakcc-fixed reset" -Dir $TweakccCloneDir -GitArgs @(
            "-C", $TweakccCloneDir, "reset", "--hard", "--quiet", "FETCH_HEAD") | Out-Null
    }
}

$tweakccVersions = Get-ChildItem "$TweakccCloneDir\data\prompts" -Filter "prompts-*.json" -ErrorAction SilentlyContinue |
    ForEach-Object { if ($_.Name -match 'prompts-(\d+\.\d+\.\d+)\.json') { $Matches[1] } } |
    Where-Object { $_ }

# -- Query connoisseur releases -----------------------------------------------

$connVersions = $null
$connDates = @{}   # CC version -> release date, used to date-match preset repos
try {
    $connReleases = Invoke-RestMethod -Uri 'https://api.github.com/repos/a-connoisseur/patch-claude-code/releases?per_page=100' -Headers $ghHeaders -TimeoutSec 10
    $connVersions = $connReleases | ForEach-Object {
        if ($_.tag_name -match '^v([\d.]+)-win32-x64$') {
            $v = $Matches[1]
            if (-not $connDates.ContainsKey($v)) { $connDates[$v] = [datetime]$_.published_at }
            $v
        }
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

if ($intersectVersions.Count -eq 1) {
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

# Keep a persistent clone so later launches fetch instead of re-cloning.
function Sync-PresetRepo {
    param([string]$Url, [string]$Dir)

    $name = Split-Path $Dir -Leaf
    if (Test-Path "$Dir\.git") {
        # Tag and date resolution both need real history; earlier versions of
        # this script cloned these repos with --depth 1.
        if (Test-Path "$Dir\.git\shallow") {
            Invoke-GitStep -What "$name unshallow" -Dir $Dir -GitArgs @(
                "-C", $Dir, "fetch", "--unshallow", "--tags", "--quiet", "origin") | Out-Null
        }
        Invoke-GitStep -What "$name fetch" -Dir $Dir -GitArgs @(
            "-C", $Dir, "fetch", "--tags", "--force", "--quiet", "origin") | Out-Null
        if (-not (Invoke-GitStep -What "$name checkout" -Dir $Dir -GitArgs @(
                "-C", $Dir, "checkout", "--quiet", "--detach", "origin/HEAD"))) {
            Invoke-GitStep -What "$name checkout of the fetched head" -Dir $Dir -GitArgs @(
                "-C", $Dir, "checkout", "--quiet", "--detach", "FETCH_HEAD") | Out-Null
        }
        return $true
    }
    Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue
    return (Invoke-GitStep -What "$name clone" -Dir "" -GitArgs @("clone", "--quiet", $Url, $Dir))
}

# Newest tag of the form v<ccVersion>-<n> that is not ahead of $Version.
# Exact match wins; otherwise the closest older release.
function Resolve-PresetTag {
    param([string]$Dir, [string]$Version)

    $target = [System.Version]$Version
    $best = $null; $bestVer = $null; $bestSeq = -1
    foreach ($tag in @(& git -C $Dir tag --list "v*" 2>$null)) {
        if ($tag -notmatch '^v(\d+\.\d+\.\d+)-(\d+)$') { continue }
        $v = [System.Version]$Matches[1]; $seq = [int]$Matches[2]
        if ($v -gt $target) { continue }
        if ((-not $bestVer) -or ($v -gt $bestVer) -or ($v -eq $bestVer -and $seq -gt $bestSeq)) {
            $best = $tag; $bestVer = $v; $bestSeq = $seq
        }
    }
    return $best
}

# Repos without release tags get resolved by date: the last commit made before
# the NEXT CC version shipped is the state that tracked $Version.
function Resolve-PresetCommitByDate {
    param([string]$Dir, [datetime]$Before)

    $sha = (& git -C $Dir rev-list -n 1 --before="$($Before.ToString('yyyy-MM-ddTHH:mm:ssZ'))" HEAD 2>$null)
    if ($LASTEXITCODE -ne 0) { return $null }
    return ("$sha").Trim()
}

# Lobotomized ships one prompt set per model generation; older checkouts predate
# the newer sets, so fall back down the list.
function Get-LoboPromptDir {
    param([string]$RepoDir)

    foreach ($name in @("system-prompts-opus-5", "system-prompts-opus-4-8", "system-prompts-opus-4-7")) {
        if (Test-Path "$RepoDir\$name") { return "$RepoDir\$name" }
    }
    $fallback = Get-ChildItem $RepoDir -Directory -Filter "system-prompts*" -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($fallback) { return $fallback.FullName }
    return $null
}

# Rebuild every generated preset against the CC version being installed. Runs on
# every launch: upstream realigns its overrides to each CC release, and an
# override left behind by a bump binds to identifiers that moved, which crashes
# CC at prompt assembly rather than failing loudly.
function Sync-TweakccPresets {
    param([string]$Version, [datetime]$UpperBound)

    $marker = Join-Path $PresetsDir ".synced-version"
    $synced = if (Test-Path $marker) { (Get-Content $marker -Raw).Trim() } else { "" }

    @("stock", "unnerfcc", "lobotomized", "combined", "basis-custom") | ForEach-Object {
        New-Item -ItemType Directory -Path "$PresetsDir\$_\system-prompts" -Force | Out-Null
        New-Item -ItemType Directory -Path "$PresetsDir\$_\system-reminders" -Force | Out-Null
    }
    # basis-custom is the operator's own set — seed it once, never overwrite.
    if (-not $synced) {
        foreach ($subdir in @("system-prompts", "system-reminders")) {
            if (Test-Path "$TweakccDir\$subdir") {
                Get-ChildItem "$TweakccDir\$subdir" -ErrorAction SilentlyContinue |
                    Copy-Item -Destination "$PresetsDir\basis-custom\$subdir\" -Force -ErrorAction SilentlyContinue
            }
        }
    }

    if ($synced -eq $Version) {
        Write-Host "  Presets already synced to $Version." -ForegroundColor DarkGray
        return
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Host "  WARNING: git not found, presets left as-is" -ForegroundColor Yellow
        return
    }

    Write-Host ""
    Write-Host "  Syncing presets to CC $Version..." -ForegroundColor DarkGray

    $unnerfRepo = "$PresetsDir\_unnerfcc-repo"
    if (Sync-PresetRepo -Url "https://github.com/lukehutch/unnerfcc.git" -Dir $unnerfRepo) {
        $ref = Resolve-PresetTag -Dir $unnerfRepo -Version $Version
        if (-not $ref) { $ref = Resolve-PresetCommitByDate -Dir $unnerfRepo -Before $UpperBound }
        if ($ref) {
            Invoke-GitStep -What "unnerfcc checkout" -Dir $unnerfRepo -GitArgs @(
                "-C", $unnerfRepo, "checkout", "--quiet", "--detach", $ref) | Out-Null
            Write-Host "  unnerfcc @ $ref" -ForegroundColor DarkGray
        } else {
            Write-Host "  unnerfcc @ HEAD (no matching tag or date)" -ForegroundColor Yellow
        }
        Get-ChildItem "$PresetsDir\unnerfcc\system-prompts" -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
        Get-ChildItem "$unnerfRepo\system-prompts" -Filter "*.md" -ErrorAction SilentlyContinue |
            Copy-Item -Destination "$PresetsDir\unnerfcc\system-prompts\" -Force
    } else { Write-Host "  WARNING: Failed to sync unnerfcc" -ForegroundColor Yellow }

    $loboRepo = "$PresetsDir\_lobotomized-repo"
    if (Sync-PresetRepo -Url "https://github.com/skrabe/lobotomized-claude-code.git" -Dir $loboRepo) {
        $ref = Resolve-PresetTag -Dir $loboRepo -Version $Version
        if (-not $ref) { $ref = Resolve-PresetCommitByDate -Dir $loboRepo -Before $UpperBound }
        if ($ref) {
            Invoke-GitStep -What "lobotomized checkout" -Dir $loboRepo -GitArgs @(
                "-C", $loboRepo, "checkout", "--quiet", "--detach", $ref) | Out-Null
            Write-Host "  lobotomized @ $ref" -ForegroundColor DarkGray
        } else {
            Write-Host "  lobotomized @ HEAD (no matching tag or date)" -ForegroundColor Yellow
        }
        foreach ($subdir in @("system-prompts", "system-reminders")) {
            Get-ChildItem "$PresetsDir\lobotomized\$subdir" -ErrorAction SilentlyContinue |
                Remove-Item -Force -ErrorAction SilentlyContinue
        }
        $loboPromptsDir = Get-LoboPromptDir -RepoDir $loboRepo
        if ($loboPromptsDir) {
            Write-Host "  lobotomized set: $(Split-Path $loboPromptsDir -Leaf)" -ForegroundColor DarkGray
            Get-ChildItem $loboPromptsDir -Filter "*.md" |
                Copy-Item -Destination "$PresetsDir\lobotomized\system-prompts\" -Force
        }
        if (Test-Path "$loboRepo\system-reminders") {
            Get-ChildItem "$loboRepo\system-reminders" -Filter "*.md" |
                Copy-Item -Destination "$PresetsDir\lobotomized\system-reminders\" -Force
        }
    } else { Write-Host "  WARNING: Failed to sync lobotomized" -ForegroundColor Yellow }

    # Build combined: lobotomized base + unnerfcc behavioral content merged in
    # Strategy: size-based heuristic. Lobotomized base (compressed, inline docs, MCP routing).
    # Overwrite with unnerfcc when 30-89% bigger (lobo compressed away behavioral content).
    # Keep lobo when >2% bigger (lobo adds inline docs/rubrics) or 90%+ bigger (data stubs).
    Write-Host "  Building combined preset..." -ForegroundColor DarkGray
    $combinedPrompts = "$PresetsDir\combined\system-prompts"
    $combinedReminders = "$PresetsDir\combined\system-reminders"
    foreach ($dir in @($combinedPrompts, $combinedReminders)) {
        Get-ChildItem $dir -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    }

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

    $Version | Out-File -FilePath $marker -NoNewline
    Write-Host "  Presets synced to $Version." -ForegroundColor Green
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

# Date bound for preset repos without release tags: upstream commits that landed
# before the NEXT CC version shipped are the ones that tracked $targetVer.
$presetUpperBound = (Get-Date).ToUniversalTime().AddDays(1)
$nextVer = @($connDates.Keys | Where-Object { [System.Version]$_ -gt [System.Version]$targetVer } |
    Sort-Object { [System.Version]$_ } | Select-Object -First 1)
if ($nextVer -and $nextVer[0]) { $presetUpperBound = $connDates[$nextVer[0]] }

Sync-TweakccPresets -Version $targetVer -UpperBound $presetUpperBound
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

# Persist last prompt selection
if ($chosen) {
    $chosen.BaseName | Out-File -FilePath $lastPromptFile -NoNewline
} elseif ($selection -eq "0" -and (Test-Path $lastPromptFile)) {
    Remove-Item $lastPromptFile -Force -ErrorAction SilentlyContinue
}

# =============================================================================
# BACKEND PICKER
# =============================================================================

$backendCfg = Load-BackendConfig
$backendKeys = @($backendCfg.backends.PSObject.Properties.Name)
$lastBackendFile = Join-Path $env:TEMP "customclaude-last-backend.txt"
$lastBackend = if (Test-Path $lastBackendFile) { (Get-Content $lastBackendFile -Raw).Trim() } else { $backendCfg.default }

# Resolve backend

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
        & "$env:ComSpec" /c "`"$ClaudeExe`" --system-prompt-file `"$($chosen.FullName)`"$extraArgsStr"
    } else {
        & "$env:ComSpec" /c "`"$ClaudeExe`"$extraArgsStr"
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
