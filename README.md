# CustomClaude

A Windows launcher for Claude Code that manages version pinning, binary
patching, system prompt selection, backend routing, and writing/code quality
enforcement - all from one command.

## What it does

`CustomClaude` runs four interactive pickers, then launches Claude Code with
the selected configuration:

1. **Version** - picks a Claude Code version that has both
   [tweakcc-fixed](https://github.com/skrabe/tweakcc-fixed) prompt support and
   a [connoisseur](https://github.com/a-connoisseur/patch-claude-code) patched
   binary. Installs or reinstalls as needed.
2. **Tweakcc preset** - applies a system prompt preset (stock, unnerfcc,
   lobotomized, combined, or your own custom set).
3. **System prompt** - passes `--system-prompt-file` from the `SystemPrompts/`
   directory.
4. **Backend** - routes through Anthropic directly, WSL, or a local proxy (for
   DeepSeek or other providers via deepclaude).

Use `CustomClaude -q` to skip the pickers and reuse the last selection.

## Enforcement

The `enforcement/` directory carries writing and code structure guards that
deploy into `~/.claude/` on each launch:

- **ste-lint** - a linter for ASD-STE100 (the aerospace industry standard for
  Simplified Technical English). Runs on every file write and on every chat
  reply via Claude Code hooks.
- **quality-guard** - structural code scanner (line length, function size,
  complexity, nesting depth). Uses a ratchet: old debt never blocks, new debt
  always blocks. Baseline stored in `.quality-baseline.json`.
- **git hooks** - commit message linter enforcing STE rules.

## Install

Requires git and PowerShell 5.1+.

```powershell
irm https://raw.githubusercontent.com/TychoHenzen/CustomClaude/main/Install.ps1 | iex
```

Or clone manually into a directory on PATH:

```powershell
git clone https://github.com/TychoHenzen/CustomClaude.git C:\Tools\CustomClaude
# Add C:\Tools\CustomClaude to your user PATH
```

### Updating

Run `Install.ps1` once, on a machine that has no copy yet. Never run it to pick
up a change.

The working tree IS the install. `CustomClaude.cmd` fetches origin and resets
the tree on every launch, before it hands off to the PowerShell script. So a
pushed commit reaches every machine the next time someone starts CustomClaude.
To deploy a fix, push it and launch.

## Configuration

Copy `backends.json.template` to `~/.claude/backends.json` and fill in your
API keys. The real `backends.json` is gitignored - it never leaves your
machine.

## Layout

```
CustomClaude.cmd        Entry point (batch shim, self-updates from git)
CustomClaude.ps1        Main launcher (pickers, install, patching, proxy)
Install.ps1             One-time installer (checkout + PATH setup)
backends.json.template  Backend config template (no real keys)
SystemPrompts/          System prompt files (.md) for the picker
enforcement/claude/     Writing and code quality guards (deployed to ~/.claude/)
```
