import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nounStackRule, clausePileupRule } from './rules-structure.mjs';
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
