@echo off
REM Thin shim: pulls latest from repo, then runs the real script.
REM Deploy this file to %USERPROFILE%\bin\CustomClaude.cmd

set "REPO_DIR=C:\Development\Projects\customclaude"

REM Pull latest (quiet, non-fatal)
git -C "%REPO_DIR%" pull --quiet 2>nul

REM Run the real script from the repo
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%REPO_DIR%\CustomClaude.ps1" %*
