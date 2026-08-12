# ste-lint

A mechanical checker for word readability and sentence structure. It measures
how rare each word is, how hard each sentence reads as a whole, and how a
sentence is built. A small vocabulary check survives from the older rule set:
banned marketing words and the punctuation marks that corrupt on this machine.
It cannot judge whether a paragraph is true, or whether a technical noun is
the right one. It fixes the form of slop. It cannot make a hollow paragraph
true.

The style it enforces is `enforcement/natural.md`.

## Files

| Path | Role |
|------|------|
| `ste-lint.mjs` | Engine and command line front end |
| `rule-classes.mjs` | What each rule costs the writer, and the sentence quoter |
| `rules-readability.mjs` | Hard-word and readability rules |
| `rules-structure.mjs` | Noun-stack, clause-pileup, and long-paragraph rules |
| `rules-syntax.mjs` | Tangled-sentence rule, which measures sentence shape |
| `rules-reporting.mjs` | Bare-label rule, which asks what a step did |
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

Exit code 1 means the file carries at least one encoding or comprehension
violation.

## Tiers

- `strict` covers runbooks, procedures, install and security docs, and error
  messages. Sentences cap at 20 words. The readability ceiling is 14.
- `flavored` covers everything else. Sentences cap at 25 words. The
  readability ceiling is 16.5.

The hook picks the tier from the file name. A name that contains `runbook`,
`procedure`, `install`, `security`, `troubleshoot`, `incident`, `migration`,
`upgrade`, or `error` gets the strict tier.

## Three classes, not two severities

`rule-classes.mjs` says what a finding costs the writer. A rule names one
thing about a text, and its class says what kind of thing that is.

- `encoding` blocks on its own, everywhere, with no budget. The character
  corrupts the file when a reader loads it back, and no later reader spots it
  by eye.
- `comprehension` blocks once the count passes the budget. The reader cannot
  follow the sentence, and that is what this checker is for.
- `polish` never blocks, however many there are. The reader follows the
  sentence and one word or one mark could be better.

Every rule used to carry `error`, so a semicolon weighed the same as a
paragraph nobody can parse. The gates count findings, so the cheapest way past
them was to delete two semicolons and leave the jargon. That is what happened,
turn after turn. The split ended it.

Every finding that blocks quotes the sentence it wants rewritten. A grade
number against a ceiling named no sentence, so the writer went hunting, and
hunting is how a turn ends up fixing punctuation.

## Rules

| Rule | Class | Checks |
|------|-------|--------|
| `punctuation` | encoding | The em dash, en dash, curly quotes, ellipsis character, and arrows, in every spelling |
| `long-sentence` | comprehension | Word count over the tier cap |
| `long-paragraph` | comprehension | A paragraph past six sentences |
| `readability` | comprehension | A block scores past the tier's grade ceiling |
| `noun-stack` | comprehension | A run of content words with no verb, carrying abstract nouns |
| `clause-pileup` | comprehension | A sentence with too many clause boundaries |
| `tangled-sentence` | comprehension | A sentence that holds its opening open too long |
| `bare-label` | comprehension | A step named by ID or number alone, as in `S10` or `phase 3` |
| `self-grade` | comprehension | A verdict on your own work, as in `correctly refused` |
| `semicolon` | polish | Any semicolon in prose |
| `slop-word` | polish | Marketing adjectives and decorative vocabulary |
| `filler` | polish | Openers such as `it is important to note that` |
| `nominalization` | polish | `perform an analysis of`, and the same shape |
| `weak-opener` | polish | `there is a`, `there are some` |
| `acronym` | polish | An acronym with no expansion, no bracket, and no history in this project |
| `hard-word` | polish | A word both the frequency table and this project call rare |

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

`bare-label` asks it too. `STE100` reads as a step number and names a writing
standard, and this repository writes it everywhere. `S10` in a repository that
never mentions it again is a step of one session, and the reader was not
there.

The corpus reads tracked files only. So a file ignored by `.gitignore` never
votes, and neither does a file the current turn just wrote. It skips
dependency trees: `node_modules`, `vendor`, `plugins`, `dist`, `build`, and
the rest. It records tokens of two letters and up, digits included, so
`STE100` votes for itself. Set `STE_LOCAL_CORPUS=off` to turn the second
vote off.

A test for any of these three rules has to pin the corpus. Call `setCorpusRoot`
on an empty temporary directory first. Otherwise the test reads this
repository, and this repository documents each rule with the label that rule is
meant to catch. Writing `S10` into the README and two test files was enough to
make `S10` a project name, and five budget tests then measured nothing.

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

The score belongs to the block, so it names no one sentence. The report picks
one anyway. It scores each sentence of eight words or more on the same two
signals. It then quotes the hardest of them, and that is the sentence to
rewrite.

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
already in the file never blocks an unrelated edit. One turn may add three
findings of the comprehension class to a file and still pass.

The reply hook runs every rule. A reader hears a chat reply the same way they
hear a document, so a reply written in fragments fails them the same way. It
carries a budget of two comprehension violations, below the file budget,
because a reply is shorter and gets rewritten in place.

The commit message checker gets no budget on either blocking class. A commit
message is short and cheap to rewrite.
