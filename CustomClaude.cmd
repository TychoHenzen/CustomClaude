@echo off
REM Deployed to a PATH dir (e.g. %USERPROFILE%\bin). Keeps a clone of the
REM repo next to itself and runs the script from that clone.
set "REPO=%~dp0CustomClaude"

if exist "%REPO%\.git" (
    git -C "%REPO%" pull --quiet 2>nul
) else (
    git clone --quiet https://github.com/TychoHenzen/CustomClaude.git "%REPO%"
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%REPO%\CustomClaude.ps1" %*
