@echo off
REM This file IS the repo: the working tree is checked out directly into the
REM directory on PATH, so the reset below overwrites this very file and the
REM shim updates itself.
REM
REM Keep this shim minimal and stable. It syncs BEFORE handing off, so the PS1
REM that runs is always the one just fetched — doing the sync inside the PS1
REM would only take effect on the next launch. The cost is that cmd.exe
REM re-reads a batch file by byte offset after every line: if this file's own
REM content ever changes, that one launch resumes at a garbage position. That
REM is survivable precisely because this file does not change.
set "REPO=%~dp0."

if exist "%REPO%\.git" (
    REM Hard reset, not pull: the working tree is a deployment artifact, and a
    REM pull that fails on a local edit or diverged history would silently
    REM freeze this machine on an old launcher. Everything worth keeping here
    REM (tweakcc-presets, backends.json, .cache) is gitignored.
    git -C "%REPO%" fetch --quiet origin main
    if errorlevel 1 (
        echo   WARN: could not reach origin, running the local copy.
    ) else (
        git -C "%REPO%" reset --hard --quiet FETCH_HEAD
        if errorlevel 1 echo   WARN: could not reset the working tree, running it as-is.
    )
) else (
    echo   WARN: %REPO% is not a git working tree, so it cannot self-update.
    echo         Install by cloning the repo directly into the directory on PATH.
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CustomClaude.ps1" %*
