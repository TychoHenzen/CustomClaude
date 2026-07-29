# Prompt: install the writing and code structure enforcement

Copy the text below the line into Claude Code on the target machine. Run it from
a checkout of this repository.

---

Install the writing and code structure enforcement from this repository. The
design is settled. Do not redesign it. Do not turn any part of it into a skill.
Do not rewrite the checkers from the rule lists.

Two halves ship together:

- Prose. ASD-STE100 Simplified Technical English, checked by `ste-lint`.
- Code. Structural bounds, checked by the `quality-refactor` scanner behind a
  ratchet.

## Decisions already made

A skill is the wrong home for either half. A skill loads only when the model
matches its description. Prose and code get written in almost every task.
Trigger-based loading misses most of it. A skill also gives advice and verifies
nothing.

Three layers cover the work:

1. Rule text that sits in context every session.
2. A checker that decides the mechanical rules.
3. Hooks that block a write when the checker finds an error.

Both checkers ship in this repository under `enforcement/claude/`. That tree
mirrors `~/.claude/`. Copy the files. Do not write new ones.

Six more decisions that already cost debugging time:

- The write hooks scan the whole file for context. They then report only the
  lines that the tool call wrote. Work that a person wrote earlier must never
  block an unrelated edit.
- A markdown code span may wrap one line. The mask allows one newline inside a
  span. Without that, a rule example trips its own rule.
- Caveman reply style and Simplified Technical English disagree about articles.
  The reply hook checks vocabulary, filler, phrasal verbs, nominalizations,
  contractions and punctuation only. It never checks sentence length on chat.
- The trailer pattern in the commit checker lists known git trailer keys. A
  pattern such as `^[A-Za-z-]+:` also eats a `feat:` subject line.
- The code gate is a ratchet, never an absolute bound. An absolute gate blocks
  most edits to any file that already carries debt.
- The code gate drops `duplicate-block`, `dead-export` and `test-only-export`.
  Those need whole-project reachability. A single-file scan calls every export
  dead.

## Steps

1. Copy the tree. Run
   `cp -r enforcement/claude/ste enforcement/claude/hooks enforcement/claude/git-hooks enforcement/claude/quality enforcement/claude/lib ~/.claude/`.
2. Read `~/.claude/CLAUDE.md`. Find the section about plain language or word
   choice, if one exists.
3. Replace that section with the text in `enforcement/claude/CLAUDE-section.md`.
   If no such section exists, append the text.
4. Append the text in `enforcement/claude/CLAUDE-code-section.md` as well.
5. Keep any existing rule about ASCII punctuation. The new section points at it.
6. Confirm that the `dod-guard` plugin is installed. The code gate calls its
   `quality-refactor` scanner. Without that plugin the gate exits 0 and does
   nothing.
7. Open `~/.claude/settings.json`. Find the node command used by other hooks.
   Use the same path. Use plain `node` if no other hook names one.
8. Add this entry to the `PostToolUse` array:

```json
{
  "matcher": "Write|Edit|MultiEdit|NotebookEdit",
  "hooks": [
    {
      "type": "command",
      "command": "node \"$HOME/.claude/hooks/ste-write-guard.mjs\"",
      "timeout": 15
    }
  ]
}
```

9. Add this entry to the `PostToolUse` array as well:

```json
{
  "matcher": "Write|Edit|MultiEdit",
  "hooks": [
    {
      "type": "command",
      "command": "node \"$HOME/.claude/quality/quality-guard.mjs\"",
      "timeout": 30
    }
  ]
}
```

10. Add this entry to the `Stop` array:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "node \"$HOME/.claude/hooks/ste-reply-guard.mjs\"",
      "timeout": 10
    }
  ]
}
```

11. Keep every hook that is already in those arrays. Merge, do not replace.
12. Verify that `settings.json` still parses as JSON.
13. Run `chmod +x ~/.claude/git-hooks/commit-msg`.
14. Read the current value of `git config --global core.hooksPath`.
15. If that value is empty, run `git config --global core.hooksPath "$HOME/.claude/git-hooks"`.
16. If that value is not empty, stop and report it. Do not overwrite it.

The system prompt components need no work. `SystemPrompts/basis/components/ste-writing.md`,
the structure gate section in `code-quality.md`, and the `manifest.yaml` entry
are all tracked in this repository.

## Verification

Run every check. Report the result of each one.

1. Lint a bad file:

```bash
printf 'This robust layer was designed by the team to facilitate lookups; it is seamless.\n' > /tmp/slop.md
node ~/.claude/ste/ste-lint.mjs --tier=flavored /tmp/slop.md
```

Expect exit code 1 and at least five violations.

2. Lint the checker itself:

```bash
node ~/.claude/ste/ste-lint.mjs ~/.claude/ste/ste-lint.mjs ~/.claude/hooks/ste-write-guard.mjs
```

Expect exit code 0.

3. Drive the write hook:

```bash
printf '{"tool_name":"Write","tool_input":{"file_path":"/tmp/slop.md"}}' | node ~/.claude/hooks/ste-write-guard.mjs
```

Expect exit code 2 and a report on stderr.

4. Drive the commit hook in a scratch repository:

```bash
rm -rf /tmp/sterepo && mkdir /tmp/sterepo && cd /tmp/sterepo && git init -q
git config user.email t@t.t && git config user.name t
echo hi > a.txt && git add a.txt
git commit -m "feat: leverage a robust seamless thing"
```

Expect a rejected commit. Then run `git commit -m "feat: add a greeting file"`.
Expect that commit to pass.

5. Confirm that the git hook chains. Write an executable
   `.git/hooks/commit-msg` in the scratch repository. Make it print a word and
   exit 0. Commit again. Expect the word in the output.

6. Set up a scratch repository for the code gate. Use a real OS path. A git
   bash path such as `/tmp/x` does not resolve for node on Windows.

```bash
rm -rf /tmp/qrepo && mkdir /tmp/qrepo && cd /tmp/qrepo && git init -q
git config user.email t@t.t && git config user.name t
printf 'export function pick(v) {\n  if (v === 1) return 1;\n  return 0;\n}\n' > a.js
git add a.js && git commit -qm "feat: add a picker" --no-verify
W=$(pwd -W 2>/dev/null || pwd)
echo "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/a.js\"}}" | node ~/.claude/quality/quality-guard.mjs
```

Expect exit code 0. Expect a new `.quality-baseline.json` in the repository.

7. Add a function with eight parameters and deep nesting to `a.js`. Run the
   same command again. Expect exit code 2. Expect `complexity` and
   `param-count` in the report.

8. Confirm that the baseline did not change after that block. A blocked write
   must not record the worse shape.

9. Write a new file with the same bad function under a new name. Run the guard
   on it. Expect exit code 2 and the words `new-file ceiling`.

10. Delete `/tmp/slop.md`, `/tmp/sterepo` and `/tmp/qrepo`.

## Known limits

- A repository that sets its own `core.hooksPath` overrides the global one.
  Husky does this. The commit check does not run there.
- The reply hook needs a session restart before it runs.
- The code gate needs the `dod-guard` plugin. Without it the gate exits 0.
- Only `eslint` and `ruff` run as project linters. Clippy and `dotnet format`
  work on a whole crate or solution, so a per-write hook cannot afford them.
  Rust and C# get the structural rules alone.
- `dead-export`, `test-only-export` and `duplicate-block` never run in the
  gate. Run the scanner across the whole repository to check those.
- Escape hatches: `ste-lint: off` in the first 500 characters of a file,
  `STE_LINT=off` in the environment, and `git commit --no-verify`.
