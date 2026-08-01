# Prompt: install the writing and code structure enforcement

`CustomClaude.ps1` runs this install on every full launch. It copies the trees
and writes `~/.claude/enforcement.md`. It adds one `@enforcement.md` include
line to `~/.claude/CLAUDE.md`. It merges the hook entries. It sets
`core.hooksPath` when that value is empty.

Use the prompt below only for a machine without the
launcher, or to check the result by hand.

Copy the text below the line into Claude Code on the target machine. Run it from
a checkout of this repository.

---

Install the writing and code structure enforcement from this repository. The
design is settled. Do not redesign it. Do not turn any part of it into a skill.
Do not rewrite the checkers from the rule lists.

Two halves ship together:

- Prose. Word `readability` and sentence structure, checked by `ste-lint`.
- Code. Structural bounds, checked by the `quality-guard` plugin behind a
  ratchet. That half no longer lives here. It ships from the dod-guard
  marketplace and installs with `/plugin`.

## Decisions already made

A skill is the wrong home for either half. A skill loads only when the model
matches its description. Prose and code get written in almost every task.
Trigger-based loading misses most of it. A skill also gives advice and verifies
nothing.

Three layers cover the work:

1. Rule text that sits in context every session.
2. A checker that decides the mechanical rules.
3. Hooks that block a write when the checker finds an error.

The prose checker ships in this repository under `enforcement/claude/`. That
tree mirrors `~/.claude/`. Copy the files. Do not write new ones. The code gate
ships as the `quality-guard` plugin and needs no copying at all.

Six more decisions that already cost debugging time:

- The write hooks scan the whole file for context. They then report only the
  lines that the tool call wrote. Work that a person wrote earlier must never
  block an unrelated edit.
- A markdown code span may wrap one line. The mask allows one newline inside a
  span. Without that, a rule example trips its own rule.
- Caveman reply style and the sentence rules disagree about articles. The
  reply hook checks vocabulary, filler, nominalization, punctuation, and
  hard-word only. It never checks sentence length or sentence structure on
  chat. `hard-word` is advisory there. It never blocks a reply on its own.
- The trailer pattern in the commit checker lists known git trailer keys. A
  pattern such as `^[A-Za-z-]+:` also eats a `feat:` subject line.
- The code gate is a ratchet, never an absolute bound. An absolute gate blocks
  most edits to any file that already carries debt.
- The code gate lived here once, wired by hand into `settings.json`. It now
  ships as the `quality-guard` plugin, which declares its own `PostToolUse`
  hook and reads `.github/quality/quality-baseline.json`. Do not reinstate the
  hand-wired copy.

## Steps

1. Copy the tree. Run
   `cp -r enforcement/claude/ste enforcement/claude/hooks enforcement/claude/git-hooks enforcement/claude/lib ~/.claude/`.
1a. Fetch the word frequency table. `CustomClaude.ps1` already calls
    `build-word-freq.mjs` on every full launch, so a launcher run needs no
    extra step. On a machine without the launcher, run
    `node ~/.claude/ste/build-word-freq.mjs` by hand. Without the table,
    `hard-word` and `readability` both fall back instead of failing.
2. Read `~/.claude/CLAUDE.md`. Find the section about plain language or word
   choice, if one exists.
3. Replace that section with the text in `enforcement/claude/CLAUDE-section.md`.
   If no such section exists, append the text.
4. Append the text in `enforcement/claude/CLAUDE-code-section.md` as well.
5. Keep any existing rule about ASCII punctuation. The new section points at it.
6. Install the `quality-guard` plugin from the dod-guard marketplace. It
   carries the code gate, its scanner and the `/quality-refactor` skill. No
   `settings.json` entry is needed for it. The plugin declares its own hook.
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

9. Add this entry to the `Stop` array:

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

9a. Add this entry to the `PreToolUse` array. It refuses a `git commit` while
    a prose waiver stays unacknowledged. It still works when a repository
    points `core.hooksPath` at its own directory and shadows the pre-commit
    hook:

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "node \"$HOME/.claude/hooks/ste-commit-gate.mjs\"",
      "timeout": 10
    }
  ]
}
```

10. Keep every hook that is already in those arrays. Merge, do not replace.
11. Verify that `settings.json` still parses as JSON.
12. Run `chmod +x ~/.claude/git-hooks/commit-msg`.
13. Read the current value of `git config --global core.hooksPath`.
14. If that value is empty, run `git config --global core.hooksPath "$HOME/.claude/git-hooks"`.
15. If that value is not empty, stop and report it. Do not overwrite it.

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

Expect exit code 1 and 4 violations: one `semicolon` hit, and three
`slop-word` hits, for `robust`, `facilitate`, and `seamless`.

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
   bash path such as `/tmp/x` does not resolve for node on Windows. The gate
   reads `.github/quality/quality-baseline.json`, and it exits 0 when that
   file is absent, so record one first.

```bash
Q=~/.claude/plugins/marketplaces/dod-guard/packages/quality-guard
R=$(mktemp -d) && W=$(cd $R && pwd -W) && cd $R && git init -q
mkdir -p .github/quality
printf 'export function pick(v) {\n  if (v === 1) return 1;\n  return 0;\n}\n' > a.js
node $Q/skills/quality-refactor/scripts/quality-scan.mjs . --root=$W \
  --write-baseline=$W/.github/quality/quality-baseline.json
echo "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/a.js\"}}" | node $Q/scripts/quality-guard.mjs
```

Expect exit code 0.

7. Add a function with eight parameters and deep nesting to `a.js`. Run the
   same command again. Expect exit code 2. Expect `complexity` and
   `param-count` in the report.

8. Confirm that the baseline did not change after that block. A blocked write
   must not record the worse shape.

9. Run `touch .quality-skip`, then run the guard again. Expect exit code 2,
   because a plain sentinel never waives a tracked-file regression. Then run
   `echo '{"rebaseline": true}' > .quality-skip` and run the guard again.
   Expect exit code 0, a deleted sentinel, and a record in
   `.github/quality/skip-log.json`.

10. Check the prose sentinel. In the scratch prose repository, write a bad
    sentence and run the write guard. Expect exit code 2. Run
    `touch .prose-skip` and run it again. Expect exit code 0 and a record in
    `.github/quality/prose-skip-log.json`. Then run
    `node ~/.claude/ste/check-skips.mjs .` and expect exit code 1.

11. Confirm the old marker is dead. Put `ste-lint: off` at the top of a bad
    prose file and run the write guard. Expect exit code 2.

12. Confirm the word frequency table is in place. Run
    `test -f ~/.claude/ste/data/word-freq.txt && echo present`. Expect
    `present`. Run `node ~/.claude/ste/ste-lint.mjs --tier=strict
    ~/.claude/ste/rules-readability.mjs` and confirm the process does not
    crash.

13. Check the degraded path with the table absent. Run
    `node --test "enforcement/claude/ste/word-freq.test.mjs"` and confirm
    every test passes, including the one that checks `hasTable` and
    `logFrequency` with a missing table file. That test proves `hard-word`
    emits nothing and `readability` falls back to sentence length alone when
    the table is not there.

14. Delete `/tmp/slop.md`, `/tmp/sterepo` and `/tmp/qrepo`.

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
- Escape hatches: a `.prose-skip` sentinel for prose, a `.quality-skip`
  sentinel for code, `STE_LINT=off` in the environment, and
  `git commit --no-verify`. Both sentinels work once and leave a record.
- The word frequency table comes from a 2006 web crawl. It has no modern
  software vocabulary. A word absent from the table skips the `hard-word`
  check. It does not get flagged. A young technical term never blocks a
  write for that reason.
