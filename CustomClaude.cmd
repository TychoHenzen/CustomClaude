@echo off
REM Deployed to a PATH dir (e.g. %USERPROFILE%\bin). Keeps a clone of the
REM repo next to itself and runs the script from that clone.
set "REPO=%~dp0CustomClaude"

if exist "%REPO%\.git" (
    REM Hard-sync, not pull. The clone is a deployment artifact: a local edit,
    REM a detached HEAD or diverged history makes `pull` fail, and swallowing
    REM that error freezes this machine on an old launcher forever. Everything
    REM worth keeping in there (tweakcc-presets, backends.json, .cache) is
    REM gitignored, so a reset costs nothing.
    git -C "%REPO%" fetch --quiet origin main
    if errorlevel 1 (
        echo   WARN: could not reach origin, running the local copy.
    ) else (
        git -C "%REPO%" reset --hard --quiet FETCH_HEAD
        if errorlevel 1 echo   WARN: could not reset the clone, running it as-is.
    )
) else (
    git clone --quiet https://github.com/TychoHenzen/CustomClaude.git "%REPO%"
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%REPO%\CustomClaude.ps1" %*
