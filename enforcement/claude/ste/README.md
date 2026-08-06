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
| `rules-syntax.mjs` | Tangled-sentence rule, which measures sentence shape |
| `rules-acronym.mjs` | Acronym rule, which asks for an expansion on first use |
| `local-corpus.mjs` | Builds the vocabulary the current project already uses |
| `corpus-files.mjs` | Picks the files that vocabulary is built from |
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
  messages. Sentences cap at 20 words. The readability ceiling is 14.
- `flavored` covers everything else. Sentences cap at 25 words. The
  readability ceiling is 16.5.

`hard-word` runs at warn severity in both tiers, so it never blocks a write.

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
| `hard-word` | warn | A word both the frequency table and this project call rare |
| `acronym` | error | An acronym with no expansion, no bracket, and no history in this project |
| `readability` | error | A block scores past the tier's grade ceiling |
| `noun-stack` | error | A run of content words with no verb, carrying abstract nouns |
| `clause-pileup` | error | A sentence with too many clause boundaries |
| `tangled-sentence` | error | A sentence that holds its opening open too long |

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

## Rarity takes two votes

The table reads a general English crawl from 2006. It scores `refactor` and
`placeholder` against everyday English, not against the writing they appear
in. Judged on that table alone, half the ordinary words of a software project
read as rare.

So `hard-word` asks twice. The table votes first, and a word above its
threshold stops there. The project votes second, through `local-corpus.mjs`.
That module reads every source and prose file git tracks under the working
directory. A word the project uses in two files, or five times over, is
vocabulary the reader already has, and the rule leaves it alone.

`acronym` asks the project the same way. A repository that writes `HELM` a
hundred times has a name, not an abbreviation, and nobody reading that
repository needs it spelled out. A term that appears in one file still gets
reported on first use.

The corpus reads tracked files only. So a file ignored by `.gitignore` never
votes, and neither does a file the current turn just wrote. It skips
dependency trees: `node_modules`, `vendor`, `plugins`, `dist`, `build`, and
the rest. It records tokens of two letters and up, digits included, so
`STE100` votes for itself. Set `STE_LOCAL_CORPUS=off` to turn the second
vote off.

The built vocabulary caches under `~/.claude/ste/cache` for six hours. Each
cache file opens with a header naming the settings that built it. A cache
built under other settings is rebuilt rather than read. Age alone is not
enough: lowering the length floor once left every machine reading a cache
with no short token in it.

`word-forms.mjs` runs before both votes. It reduces a built word to the word
it was built from, so `profiler` is judged as `profile` and `subagent` as
`agent`. Before that, `profiler` scored 0.13 and read as rare.

## How the shape check works

`tangled-sentence` measures what word rarity and sentence length cannot see.
This sentence passes both of those, at sixteen common words:

> How should a HELM answer that disclaims knowledge be allowed to name the
> thing it disclaims?

What makes it hard is distance. `should` waits seven words for `be`, with a
whole relative clause wedged in between, and the reader holds the opening in
mind the entire way. The rule counts three kinds of strain and reports a
sentence carrying three points at once:

- an auxiliary more than four words from the verb it governs
- a relative clause sitting between the two
- the passive voice

There is no part of speech tagger behind this. Closed word lists and
adjacency checks stand in for grammar, the same way `rules-structure.mjs`
works.

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
vocabulary, filler, nominalization, punctuation, acronyms, and hard-word only,
so the terse caveman reply style keeps working.
