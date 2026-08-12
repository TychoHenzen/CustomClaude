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

## Never edit ~/.claude directly

`enforcement/claude/` in this repo is the source. `~/.claude/` is its output.
`Sync-Enforcement` in `CustomClaude.ps1` copies `ste`, `hooks`, `git-hooks` and
`lib` on every launch. So a fix belongs here, and a launch deploys it.

A file written straight into `~/.claude` is invisible to this repo. It survives
every launch, because the copy only adds and overwrites. It never reaches
another machine, and the test suite here never sees it.

That already happened. Three modules sat in `~/.claude/ste` alone for days.
Five of their tests failed against the install and passed nowhere else, because
the module they gated was never wired into `ste-lint.mjs`.

Copying a file into `~/.claude` by hand is fine once the repo holds it. That is
the launcher's job done early, not a place to work.

This tree carries the checker, not the rules it checks. The writing rules ship
as the Natural output style, from the `natural-output-style` plugin in the
dod-guard marketplace. Only one output style loads at a time, so a machine left
on `Explanatory` gets the hooks with none of the rules behind them.

## The system prompt basis has no generator in this repo

`SystemPrompts/basis/` holds the components, the manifest and the eval set. The
program that reads them lives only in `~/.claude/skills/sysprompt-gen/`, as
`generate.py` and its `SKILL.md`. Neither file is in any repository.

Two things follow. `SystemPrompts/basis/evals/run.py` imports the generator from
`<repo>/skills/sysprompt-gen`, a path that does not exist here, so the eval
suite cannot run from a clone. Point `sys.path` at the real location to run it.

The generator also hardcodes every axis value it accepts. `LAYERS`, `DOMAINS`,
`BACKENDS` and `STRICTNESS` are sets in that file, and it raises on anything
outside them. So editing a component is half the work. A layer removed from the
basis stays valid on the command line until you edit the generator too.

## Deleting files in CustomClaude.ps1

Use the `Remove-StateFile` helper for single files. Do not call `Remove-Item`.

The script sets `$ErrorActionPreference = "Stop"` at the top. The file system
provider throws on some machines rather than writing an error, and a throw
ignores `-ErrorAction SilentlyContinue`. One real case: a home folder named by
its 8.3 alias on a volume that no longer creates short names. That killed the
launch on a cache file nobody needed. `Remove-StateFile` calls
`[System.IO.File]::Delete` instead, so no provider path resolution runs.
