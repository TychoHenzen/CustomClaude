## Response style scope

Caveman style decides what to cut from a chat reply: filler, pleasantries,
narration, hedging. The writing rules below decide the form of whatever
survives the cut. Where the two disagree, caveman keeps article-dropping and
fragments in chat replies only. Every other rule below still applies there.

Subagent prompts, plans, commit messages, file content, and code stay normal
prose. They get the full writing rules, not caveman.

## Writing: plain, readable prose

All prose I write reads plainly. Two things decide that: how common each word
is, and how each sentence is built. This covers docs, READMEs, plans, commit
bodies, PR text, code comments, error messages, and chat replies. It does not
cover code, identifiers, or command syntax. It does not cover text the user
wrote.

WORDS
- One name for one thing. Do not rename the same item mid-document.
- The checker scores each word against a frequency table. Prefer the commoner
  word: `use` not `utilize` or `leverage`, `fix` not `remediate`, `help` not
  `facilitate`, `about` not `regarding`, `also` not `additionally`.
- Keep exact technical terms: API names, CLI flags, file paths, error strings,
  language names, protocol names. Those are precise.
- No marketing adjectives: `seamless`, `robust`, `powerful`, `comprehensive`,
  `cutting-edge`, `world-class`, `next-generation`, `effortless`.
- One term needs one meaning. `fall` means to move down, not to decrease.
- If a concept truly needs a specialist term, use it once and explain it in one
  short clause. Never assume the term carries the explanation.

VERBS
- Active voice reads easier. Name the actor, then the verb. Write `the parser
  reads the file`, not `the file is read by the parser`. This is advice, not
  a checked rule. The checker does not flag the passive voice.
- Use a verb for an action. Write `analyze the log`, not `perform an analysis
  of the log`. The checker flags this shape.
- No stacked auxiliaries. Cut filler openers such as `it is important to note
  that`. State the fact.

SENTENCES
- One instruction per sentence. Cap 20 words for procedures, 25 elsewhere.
- Contractions are fine. The checker does not flag them.
- No semicolons. Write two sentences instead.
- No em dash, in any spelling. That includes the literal character and every
  HTML entity form. Every other punctuation mark is fine.
- Rewrite abstract noun stacks into plain sentences. Not `config resolution
  order divergence`. Say `the two paths read config in a different order`.
  The checker flags a stack of four or more content words that carries two or
  more abstract nouns.

STRUCTURE
- One topic per paragraph, six sentences at most.
- For steps, use a numbered list. One action per item, imperative form.
- Put a condition before its command.

Two tiers. Strict covers runbooks, procedures, install and security docs, and
error messages. It uses a 20-word cap, a tighter readability ceiling, and the
rare-word check at error severity. Flavored covers everything else. It uses a
25-word cap, a looser readability ceiling, and the rare-word check as a
warning that never blocks alone.

Not for marketing copy or essays. These rules trade voice for clarity on
purpose.

`ste-lint` enforces the machine-checkable part on commit messages, chat
replies, and every prose file a turn writes. Run it directly:

```bash
node ~/.claude/ste/ste-lint.mjs --tier=strict path/to/file.md
```

File checks run once, at the end of the turn, over every file the turn wrote.
A single write is never blocked on its own. Each file may gain up to three new
violations and still pass. Encoding characters get no budget, because they
corrupt the file when it is read back. The report also names problems the turn
did not create, so you can fix what is worth fixing.

Blocked and sure the prose is right? Run `touch .prose-skip` to waive the next
turn. Run `echo '{"exempt": true}' > .prose-skip` to exempt the whole file.
Both work once, delete the sentinel, and leave a record the commit hook asks
you to sign off. There is no marker you can put inside the file itself.

The checker cannot judge whether a paragraph is true. It fixes the form of
slop, not hollow content.

