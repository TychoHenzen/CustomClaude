@echo off
REM Self-contained shim: keeps a clone of the repo next to itself, runs from it.
set "REPO=%~dp0CustomClaude"

if exist "%REPO%\.git" (
    git -C "%REPO%" pull --quiet 2>nul
) else (
    git clone --quiet https://github.com/TychoHenzen/CustomClaude.git "%REPO%"
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%REPO%\CustomClaude.ps1" %*
