# ste-lint

A mechanical checker for ASD-STE100 Simplified Technical English. It enforces
the part of the standard that a machine can decide. It cannot judge whether a
paragraph is true, or whether a technical noun is the right one. It fixes the
form of slop. It cannot make a hollow paragraph true.

Standard: https://asd-ste100.org

## Files

| Path | Role |
|------|------|
| `ste-lint.mjs` | Rules, engine, and command line front end |
| `ste-commit-msg.mjs` | Commit message checker, called by the git hook |
| `~/.claude/hooks/ste-write-guard.mjs` | PostToolUse hook for Write, Edit, MultiEdit |
| `~/.claude/hooks/ste-reply-guard.mjs` | Stop hook for chat replies |
| `~/.claude/git-hooks/commit-msg` | Global git hook, installed by `core.hooksPath` |

## Command line

```bash
node ~/.claude/ste/ste-lint.mjs --tier=strict docs/runbook.md
node ~/.claude/ste/ste-lint.mjs --format=json src/parser.ts
node ~/.claude/ste/ste-lint.mjs --stdin --name=draft < draft.md
```

Exit code 1 means the file has at least one error-severity violation.

## Tiers

- `strict` covers runbooks, procedures, install and security docs, and error
  messages. Every rule applies. Sentences cap at 20 words.
- `flavored` covers everything else. Sentences cap at 25 words. The long-word
  list is skipped, so the text keeps enough range to read naturally.

The hook picks the tier from the file name. A name that contains `runbook`,
`procedure`, `install`, `security`, `troubleshoot`, `incident`, `migration`,
`upgrade`, or `error` gets the strict tier.

## Rules

| Rule | Severity | Checks |
|------|----------|--------|
| `long-sentence` | error | Word count over the tier cap |
| `semicolon` | error | Any semicolon in prose |
| `contraction` | error | A known contraction, never a possessive |
| `slop-word` | error | Marketing adjectives and decorative vocabulary |
| `long-word` | error | Long word with a short replacement, strict tier only |
| `filler` | error | Openers such as `it is important to note that` |
| `phrasal-verb` | error | `spin up`, `roll out`, `wire up`, and others |
| `nominalization` | error | `perform an analysis of`, and the same shape |
| `passive-voice` | error | A passive verb with a named actor after `by` |
| `punctuation` | error | Em dash, en dash, curly quote, ellipsis, arrow |
| `vague-word` | warn | A word with a real technical sense, so never blocks |
| `weak-opener` | warn | `there is a`, `there are some` |

## What the checker skips

Fenced code, inline code spans, tables, blockquotes, front matter, HTML
comments, links, bare URLs, file paths, and command flags. In source files it
reads comments and user-facing message strings only, never the code.

## Escape hatches

- `touch .prose-skip` waives the next blocked write, once.
- `echo '{"exempt": true}' > .prose-skip` also adds the file to
  `.github/quality/prose-exempt.json`, so later writes skip it.
- Both delete the sentinel and append to `.github/quality/prose-skip-log.json`.
  The pre-commit hook refuses a commit while a record stays unacknowledged.
- Set `STE_LINT=off` in the environment to disable every check.
- Commit with `--no-verify` to skip the commit message check once.
- Wrap a quoted example word in backticks. The checker masks code spans, so a
  document about banned words does not flag itself.

## Scope

The write hook reports only the lines that the tool call wrote. Prose that was
already in the file never blocks an unrelated edit. The reply hook checks
vocabulary, filler, punctuation, and passive voice only, so the terse caveman
reply style keeps working.
