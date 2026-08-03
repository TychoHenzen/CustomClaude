# CustomClaude

Windows launcher for Claude Code. The working tree IS the install: the repo is
checked out directly into a directory on PATH, and `CustomClaude.cmd` is the
entry point.

## Never tell anyone to rerun Install.ps1

`Install.ps1` is a first-time installer only. It clones the repo and sets PATH.
It is not how a change reaches a machine.

`CustomClaude.cmd` self-updates. Every launch runs `git fetch origin main` then
`git reset --hard FETCH_HEAD` on its own directory, before it hands off to
`CustomClaude.ps1`. So the way to deploy a fix is to push it. The next launch
picks it up.

When a fix is ready, say "push and relaunch". Never say "rerun Install.ps1".

## The shim must not change

`CustomClaude.cmd` overwrites itself during that reset. cmd.exe re-reads a batch
file by byte offset after every line, so a launch that changes this file resumes
at a garbage position. Keep the shim short and stable. Put new logic in
`CustomClaude.ps1`, which the shim reads fresh after the reset.

## Deleting files in CustomClaude.ps1

Use the `Remove-StateFile` helper for single files. Do not call `Remove-Item`.

The script sets `$ErrorActionPreference = "Stop"` at the top. The file system
provider throws on some machines rather than writing an error, and a throw
ignores `-ErrorAction SilentlyContinue`. One real case: a home folder named by
its 8.3 alias on a volume that no longer creates short names. That killed the
launch on a cache file nobody needed. `Remove-StateFile` calls
`[System.IO.File]::Delete` instead, so no provider path resolution runs.
