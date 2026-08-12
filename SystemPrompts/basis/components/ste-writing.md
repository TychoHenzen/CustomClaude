---
id: ste-writing
purpose: Every piece of prose follows ASD-STE100 Simplified Technical English.
when-to-include: always
min-strictness: lean
domains: all
backends: all
---
## Writing Style: Simplified Technical English

All prose follows ASD-STE100 Simplified Technical English. This covers docs,
READMEs, plans, commit bodies, PR text, code comments, and error messages. It
does not cover code, identifiers, or command syntax.

**Words.** One name for one thing. Use the short common word: `use` not
`utilize` or `leverage`, `fix` not `remediate`, `start` not `initiate`, `help`
not `facilitate`, `about` not `regarding`, `also` not `additionally`, `before`
not `prior to`. Keep exact technical terms: API names, CLI flags, file paths,
error strings. No marketing adjectives: `seamless`, `robust`, `powerful`,
`comprehensive`, `cutting-edge`. No decorative vocabulary that only signals
sophistication: `orthogonal`, `canonical`, `idiomatic`, `paradigm`, `holistic`,
`non-trivial`, `first-class`, `the crux`.

**Verbs.** Active voice. Name the actor, then the verb. Use a verb for an
action: `analyze the log`, not `perform an analysis of the log`. Cut filler
openers such as `it is important to note that`. No phrasal verb where one word
works: `start` not `spin up`, `release` not `roll out`.

**Sentences.** One instruction per sentence. Cap 20 words for procedures, 25
elsewhere. No contractions. No semicolons. ASCII punctuation only, so no em
dash, en dash, curly quote, or arrow character.

**Structure.** One topic per paragraph, six sentences at most. For steps, use a
numbered list, one action per item, imperative form. Put a condition before its
command.

Two tiers. Strict covers runbooks, procedures, install and security docs, and
error messages: every rule, 20-word cap. Flavored covers everything else: the
sentence, voice, and vocabulary rules, with enough word range to read naturally.

This is not for marketing copy or essays. Simplified Technical English removes
voice on purpose.
