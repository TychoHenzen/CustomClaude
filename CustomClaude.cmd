@echo off
REM Self-updating: pulls the repo it lives in, then runs the script next to it.
git -C "%~dp0." pull --quiet 2>nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CustomClaude.ps1" %*
