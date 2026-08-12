import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { bareLabelRule } from './rules-reporting.mjs';
import { setCorpusRoot } from './local-corpus.mjs';
import { lint } from './ste-lint.mjs';
import { COMPREHENSION } from './rule-classes.mjs';

// The rule asks the local corpus whether the project already writes a token.
// This repository writes `STE100` everywhere, so the corpus has to be empty
// before a sample label reports at all.
const EMPTY_CORPUS = mkdtempSync(join(tmpdir(), 'ste-reporting-corpus-'));
setCorpusRoot(EMPTY_CORPUS);

function block(text, line = 0, heading = false) {
  return { line, text, heading };
}

function labels(found) {
  return found.map((v) => v.msg.match(/^"([^"]+)"/)[1]);
}

test('a step named by a short ID alone is reported', () => {
  const found = bareLabelRule(block('S10 read the file and stopped there.'));
  assert.deepEqual(labels(found), ['S10']);
  assert.equal(found[0].rule, 'bare-label');
});

test('a longer ID of the same shape is reported', () => {
  const found = bareLabelRule(block('The TC001 case ran before the rest.'));
  assert.deepEqual(labels(found), ['TC001']);
});

test('a step named by its number is reported', () => {
  const found = bareLabelRule(block('Phase 3 came back with two findings.'));
  assert.deepEqual(labels(found), ['Phase 3']);
});

test('every step word takes a number', () => {
  const found = bareLabelRule(block('Step 4 ran, then agent 2 read it.'));
  assert.deepEqual(labels(found), ['Step 4', 'agent 2']);
});

test('a number that names something other than a step is left alone', () => {
  assert.deepEqual(bareLabelRule(block('The file holds 3 rules and 12 tests.')), []);
});

test('a standard that shares the shape of an ID is left alone', () => {
  assert.deepEqual(bareLabelRule(block('The file is UTF8 and the hash is SHA256.')), []);
});

test('an ID the project writes often is a name, not a label', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ste-reporting-name-'));
  writeFileSync(join(dir, 'one.md'), 'The S10 rule and the S10 gate.', 'utf8');
  writeFileSync(join(dir, 'two.md'), 'S10 again here.', 'utf8');
  try {
    setCorpusRoot(dir);
    assert.deepEqual(bareLabelRule(block('S10 read the file and stopped.')), []);
  } finally {
    setCorpusRoot(EMPTY_CORPUS);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a heading carries no bare label', () => {
  assert.deepEqual(bareLabelRule(block('S10 and the rest', 0, true)), []);
});

test('a backticked label passes, because lint blanks the code span', () => {
  const found = lint('The `S10` step read the file.\n', {
    tier: 'flavored', kind: 'markdown',
  });
  assert.deepEqual(found.filter((v) => v.rule === 'bare-label'), []);
});

test('a bare label blocks, and it reaches the report through lint', () => {
  const found = lint('The S10 step read the file.\n', {
    tier: 'flavored', kind: 'markdown',
  });
  const hits = found.filter((v) => v.rule === 'bare-label');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].cls, COMPREHENSION);
});
