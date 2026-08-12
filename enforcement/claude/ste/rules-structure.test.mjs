import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clausePileupRule, longParagraphRule, nounStackRule, PARAGRAPH_SENTENCE_CAP,
} from './rules-structure.mjs';
import { COMPREHENSION } from './rule-classes.mjs';
import { lint } from './ste-lint.mjs';

function block(text, line = 0, heading = false) {
  return { line, text, heading };
}

// ---------------------------------------------------------------------------
// noun-stack
// ---------------------------------------------------------------------------

test('the owner\'s own noun stack example produces a noun-stack violation', () => {
  const found = nounStackRule(block('config resolution order divergence'));
  const hits = found.filter((v) => v.rule === 'noun-stack');
  assert.equal(hits.length, 1);
  assert.match(hits[0].msg, /config resolution order divergence/);
});

test('the owner\'s own rewrite produces no noun-stack violation', () => {
  const found = nounStackRule(block('the two paths read config in a different order'));
  assert.deepEqual(found.filter((v) => v.rule === 'noun-stack'), []);
});

test('a two noun phrase produces no noun-stack violation', () => {
  const found = nounStackRule(block('error message'));
  assert.deepEqual(found.filter((v) => v.rule === 'noun-stack'), []);
});

test('a heading produces no noun-stack violation', () => {
  const found = nounStackRule(block('config resolution order divergence', 0, true));
  assert.deepEqual(found, []);
});

test('the noun-stack rule never throws on empty text', () => {
  assert.doesNotThrow(() => {
    const found = nounStackRule(block(''));
    assert.deepEqual(found, []);
  });
});

test('a verb ending in "age" plus a plural s produces no noun-stack violation', () => {
  const found = nounStackRule(block('the tool manages version pinning'));
  assert.deepEqual(found.filter((v) => v.rule === 'noun-stack'), []);
});

test('a verb ending in "al" plus a plural s produces no noun-stack violation', () => {
  const found = nounStackRule(block('this only signals sophistication'));
  assert.deepEqual(found.filter((v) => v.rule === 'noun-stack'), []);
});

test('a quantifier phrase before a noun run produces no noun-stack violation', () => {
  const found = nounStackRule(block('at least one error-severity violation'));
  assert.deepEqual(found.filter((v) => v.rule === 'noun-stack'), []);
});

// ---------------------------------------------------------------------------
// clause-pileup
// ---------------------------------------------------------------------------

test('a sentence with four or more clauses produces a clause-pileup violation naming the count', () => {
  const text = 'This works when it starts although it fails because it stops since nothing runs.';
  const found = clausePileupRule(block(text));
  const hits = found.filter((v) => v.rule === 'clause-pileup');
  assert.equal(hits.length, 1);
  assert.match(hits[0].msg, /4 clauses/);
});

test('a plain sentence produces no clause-pileup violation', () => {
  const found = clausePileupRule(block('The parser reads the file and writes the report.'));
  assert.deepEqual(found.filter((v) => v.rule === 'clause-pileup'), []);
});

test('a list of three parallel items separated by commas is not a clause-pileup', () => {
  const text = 'The tool reads the file, checks the syntax, and writes the report.';
  const found = clausePileupRule(block(text));
  assert.deepEqual(found.filter((v) => v.rule === 'clause-pileup'), []);
});

test('a heading produces no clause-pileup violation', () => {
  const text = 'This works when it starts although it fails because it stops since nothing runs.';
  const found = clausePileupRule(block(text, 0, true));
  assert.deepEqual(found, []);
});

test('the clause-pileup rule never throws on empty text', () => {
  assert.doesNotThrow(() => {
    const found = clausePileupRule(block(''));
    assert.deepEqual(found, []);
  });
});

test('a list of parallel items with no serial comma is not a clause-pileup', () => {
  const text = 'The rule covers vocabulary, filler, phrasal verbs, '
    + 'nominalizations, contractions and punctuation only.';
  const found = clausePileupRule(block(text));
  assert.deepEqual(found.filter((v) => v.rule === 'clause-pileup'), []);
});

test('a bullet of backtick-quoted words masked to blank space produces no '
  + 'clause-pileup, run through the real masking and segmenting path', () => {
  const text = '- `least`, `most`, `more`, `less`, `one`, `two`, `many`, '
    + '`few`, `several`, `some`, `any`, `each`, `every`, `all`, `both`, '
    + '`other`.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const hits = found.filter((v) => v.rule === 'clause-pileup');
  assert.deepEqual(hits, []);
});

test('a list whose items open on the same word is not a clause-pileup', () => {
  const text = 'No em dash, no en dash, no curly quotes, no ellipsis '
    + 'character, no arrows.';
  const found = clausePileupRule(block(text));
  assert.deepEqual(found, []);
});

test('a list of articled items is not a clause-pileup, whatever the article', () => {
  const text = 'An API name, a flag, a path, an error string, a language '
    + 'name: these are precise.';
  const found = clausePileupRule(block(text));
  assert.deepEqual(found, []);
});

test('clauses that open on different words are still a clause-pileup', () => {
  const text = 'The parser reads the file, the writer holds the buffer open, '
    + 'because the linter checks it, although nobody asked for that.';
  const found = clausePileupRule(block(text));
  assert.equal(found.length, 1);
});

// ---------------------------------------------------------------------------
// long-paragraph
// ---------------------------------------------------------------------------

/** One paragraph of count sentences, each one short and plain. */
function paragraphOf(count) {
  return Array.from({ length: count }, (_, i) => `The rule read file ${i}.`)
    .join(' ');
}

test('a paragraph at the cap is not reported', () => {
  const found = longParagraphRule(block(paragraphOf(PARAGRAPH_SENTENCE_CAP)));
  assert.deepEqual(found, []);
});

test('a paragraph one sentence past the cap is reported once', () => {
  const found = longParagraphRule(block(paragraphOf(PARAGRAPH_SENTENCE_CAP + 1)));
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'long-paragraph');
  assert.match(found[0].msg, /7 sentences/);
});

test('a long paragraph reports on its own first line', () => {
  const found = longParagraphRule(block(paragraphOf(8), 11));
  assert.equal(found[0].line, 12);
});

test('a heading is never a long paragraph', () => {
  const found = longParagraphRule(block(paragraphOf(9), 0, true));
  assert.deepEqual(found, []);
});

test('a long paragraph blocks, and it reaches the report through lint', () => {
  const found = lint(`# Notes\n\n${paragraphOf(8)}\n`, {
    tier: 'flavored', kind: 'markdown',
  });
  const hits = found.filter((v) => v.rule === 'long-paragraph');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].cls, COMPREHENSION);
});
