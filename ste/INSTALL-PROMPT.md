# Prompt: install the Simplified Technical English enforcement

Copy the text below the line into Claude Code on the target machine. Run it from
a checkout of this repository.

---

Install the ASD-STE100 Simplified Technical English enforcement from this
repository. The design is settled. Do not redesign it. Do not turn it into a
skill. Do not rewrite the checker from the rule list.

## Decisions already made

A skill is the wrong home for this. A skill loads only when the model matches
its description. Prose gets written in almost every task. Trigger-based loading
misses most of it. A skill also gives advice and verifies nothing.

Three layers cover the work:

1. Rule text that sits in context every session.
2. A checker that decides the mechanical rules.
3. Hooks that block a write when the checker finds an error.

The checker ships in this repository under `ste/claude/`. That tree mirrors
`~/.claude/`. Copy the files. Do not write new ones.

Four more decisions that already cost debugging time:

- The write hook lints the whole file for context. It then reports only the
  lines that the tool call wrote. Prose that a person wrote earlier must never
  block an unrelated edit.
- A markdown code span may wrap one line. The mask allows one newline inside a
  span. Without that, a rule example trips its own rule.
- Caveman reply style and this standard disagree about articles. The reply hook
  checks vocabulary, filler, phrasal verbs, nominalizations, contractions and
  punctuation only. It never checks sentence length on chat.
- The trailer pattern in the commit checker lists known git trailer keys. A
  pattern such as `^[A-Za-z-]+:` also eats a `feat:` subject line.

## Steps

1. Copy the tree. Run `cp -r ste/claude/ste ste/claude/hooks ste/claude/git-hooks ~/.claude/`.
2. Read `~/.claude/CLAUDE.md`. Find the section about plain language or word
   choice, if one exists.
3. Replace that section with the text in `ste/claude/CLAUDE-section.md`. If no
   such section exists, append the text.
4. Keep any existing rule about ASCII punctuation. The new section points at it.
5. Open `~/.claude/settings.json`. Find the node command used by other hooks.
   Use the same path. Use plain `node` if no other hook names one.
6. Add this entry to the `PostToolUse` array:

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

7. Add this entry to the `Stop` array:

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

8. Keep every hook that is already in those arrays. Merge, do not replace.
9. Verify that `settings.json` still parses as JSON.
10. Run `chmod +x ~/.claude/git-hooks/commit-msg`.
11. Read the current value of `git config --global core.hooksPath`.
12. If that value is empty, run `git config --global core.hooksPath "$HOME/.claude/git-hooks"`.
13. If that value is not empty, stop and report it. Do not overwrite it.

The system prompt component needs no work. `SystemPrompts/basis/components/ste-writing.md`
and its `manifest.yaml` entry are tracked in this repository.

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

6. Delete `/tmp/slop.md` and `/tmp/sterepo`.

## Known limits

- A repository that sets its own `core.hooksPath` overrides the global one.
  Husky does this. The commit check does not run there.
- The reply hook needs a session restart before it runs.
- Escape hatches: `ste-lint: off` in the first 500 characters of a file,
  `STE_LINT=off` in the environment, and `git commit --no-verify`.
