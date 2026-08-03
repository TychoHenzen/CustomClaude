# ste-lint

A mechanical checker for word readability and sentence structure. It measures
how rare each word is, how hard each sentence reads as a whole, and how a
sentence is built. A small vocabulary check survives from the older rule set:
banned marketing words and one banned punctuation mark. It cannot judge
whether a paragraph is true, or whether a technical noun is the right one. It
fixes the form of slop. It cannot make a hollow paragraph true.

## Files

| Path | Role |
|------|------|
| `ste-lint.mjs` | Rules, engine, and command line front end |
| `rules-readability.mjs` | Hard-word and readability rules |
| `rules-structure.mjs` | Noun-stack and clause-pileup rules |
| `readability.mjs` | Scores a block of sentences into a grade level |
| `language.mjs` | Decides whether a block is English, so English-only rules stay off other languages |
| `word-forms.mjs` | Guesses base word forms and looks up how common they are |
| `word-freq.mjs` | Reads the word frequency table |
| `build-word-freq.mjs` | Deploy-time fetcher for the word frequency table |
| `pending.mjs` | Per-session log of the prose files a turn wrote |
| `ste-commit-msg.mjs` | Commit message checker, called by the git hook |
| `~/.claude/hooks/ste-write-guard.mjs` | PostToolUse hook, records what a turn wrote |
| `~/.claude/hooks/ste-turn-guard.mjs` | Stop hook, checks those files once per turn |
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
  messages. Sentences cap at 20 words. `hard-word` runs at error severity.
  The readability ceiling is 14.
- `flavored` covers everything else. Sentences cap at 25 words. `hard-word`
  runs at warn severity only, so it never blocks on its own. The readability
  ceiling is 16.5.

The hook picks the tier from the file name. A name that contains `runbook`,
`procedure`, `install`, `security`, `troubleshoot`, `incident`, `migration`,
`upgrade`, or `error` gets the strict tier.

## Rules

| Rule | Severity | Checks |
|------|----------|--------|
| `long-sentence` | error | Word count over the tier cap |
| `semicolon` | error | Any semicolon in prose |
| `weak-opener` | warn | `there is a`, `there are some` |
| `slop-word` | error | Marketing adjectives and decorative vocabulary |
| `filler` | error | Openers such as `it is important to note that` |
| `nominalization` | error | `perform an analysis of`, and the same shape |
| `punctuation` | error | The em dash, in every spelling |
| `hard-word` | error in strict, warn in flavored | A word too rare for the frequency table's floor |
| `readability` | error | A block scores past the tier's grade ceiling |
| `noun-stack` | error | A run of content words with no verb, carrying abstract nouns |
| `clause-pileup` | error | A sentence with too many clause boundaries |

## What the checker skips

Fenced code, inline code spans, tables, blockquotes, front matter, HTML
comments, links, bare URLs, file paths, and command flags. In source files it
reads comments and user-facing message strings only, never the code.

## The word frequency table

`hard-word` and `readability` read word rarity from a table at
`~/.claude/ste/data/word-freq.txt`. The table comes from the Norvig word
count list and holds 333,333 entries. It is never committed to this
repository. `CustomClaude.ps1` calls `build-word-freq.mjs` on every full
launch and refreshes the table.

On a machine with no table, both rules degrade instead of failing. `hard-word`
emits nothing, because it has no evidence to flag a word on. `readability`
falls back to sentence length alone, with no weight for word rarity, and marks
its result as degraded.

## How the readability score works

`readability` scores a whole block, not one sentence. It groups the block's
sentences into chunks of about 125 words. It then finds the mean log word
frequency and the mean log sentence length across the chunks. It turns each
mean into a z-score against a corpus of 406 blocks measured from this
repository. It combines the two z-scores into one grade-level number.

The output is a US grade level under the Flesch-Kincaid style scale. It is
NOT a Lexile L number. A real L number needs a regression against books with
a published score, and this checker has no such anchor texts.

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
vocabulary, filler, nominalization, punctuation, and hard-word only, so the
terse caveman reply style keeps working.
