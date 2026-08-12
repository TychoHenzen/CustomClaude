import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { acronymRule } from './rules-acronym.mjs';
import { classOf, POLISH } from './rule-classes.mjs';
import { setCorpusRoot } from './local-corpus.mjs';
import { lint } from './ste-lint.mjs';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const REAL_TABLE_PATH = join(HOME, '.claude', 'ste', 'data', 'word-freq.txt');
const needsTable = { skip: !existsSync(REAL_TABLE_PATH) };

// The rule asks the local corpus whether the project already writes a
// token. These tests use HELM as an unexplained sample, and this repository
// now writes it often, so the corpus has to be empty here.
const EMPTY_CORPUS = mkdtempSync(join(tmpdir(), 'ste-acronym-corpus-'));
setCorpusRoot(EMPTY_CORPUS);

function words(found) {
  return found.map((v) => v.msg.match(/^"([^"]+)"/)[1]);
}

test('an acronym with no expansion anywhere is reported', () => {
  const found = acronymRule('The HELM answer names the thing it disclaims.');
  assert.deepEqual(words(found), ['HELM']);
  assert.equal(found[0].rule, 'acronym');
  assert.equal(classOf(found[0].rule), POLISH);
});

test('an acronym spelled out anywhere in the file is left alone', () => {
  const text = 'A Hierarchical Environment Language Model runs first.\n'
    + 'The HELM answer names the thing it disclaims.';
  assert.deepEqual(acronymRule(text), []);
});

test('an expansion after the acronym counts, not just one before it', () => {
  const text = 'The HELM answer names the thing.\n'
    + 'A HELM is a Hierarchical Environment Language Model.';
  assert.deepEqual(acronymRule(text), []);
});

test('a bracket right after the acronym counts as a qualifier', () => {
  const text = 'The HELM (our in-house router) names the thing it disclaims.';
  assert.deepEqual(acronymRule(text), []);
});

test('a bracket holding one word does not qualify an acronym', () => {
  const text = 'The HELM (ours) names the thing it disclaims.';
  assert.deepEqual(words(acronymRule(text)), ['HELM']);
});

test('a bracket after a hyphenated name explains the leading part too', () => {
  const text = 'A linter for ASD-STE100 (the aerospace writing standard) runs here.';
  assert.deepEqual(acronymRule(text), []);
});

test('a token this project already writes is a name, not an acronym', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ste-acronym-name-'));
  writeFileSync(join(dir, 'one.md'), 'The HELM runs first.', 'utf8');
  writeFileSync(join(dir, 'two.md'), 'A second HELM note.', 'utf8');
  try {
    setCorpusRoot(dir);
    assert.deepEqual(acronymRule('The HELM answer names the thing it disclaims.'), []);
  } finally {
    setCorpusRoot(EMPTY_CORPUS);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a token the project writes once is still an acronym', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ste-acronym-once-'));
  writeFileSync(join(dir, 'one.md'), 'The HELM runs first.', 'utf8');
  try {
    setCorpusRoot(dir);
    assert.deepEqual(words(acronymRule('The HELM answer names the thing.')), ['HELM']);
  } finally {
    setCorpusRoot(EMPTY_CORPUS);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the project vote reads a two letter token too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ste-acronym-short-'));
  writeFileSync(join(dir, 'one.md'), 'The PD board is ready.', 'utf8');
  writeFileSync(join(dir, 'two.md'), 'Another PD note.', 'utf8');
  try {
    setCorpusRoot(dir);
    assert.deepEqual(acronymRule('The PD stage runs before the rest of it.'), []);
  } finally {
    setCorpusRoot(EMPTY_CORPUS);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a well known abbreviation needs no expansion', () => {
  const text = 'The API returns JSON over HTTPS, and the CLI prints it.';
  assert.deepEqual(acronymRule(text), []);
});

test('an acronym is reported once however often it appears', () => {
  const text = 'The HELM runs. The HELM answers. The HELM stops.';
  assert.deepEqual(words(acronymRule(text)), ['HELM']);
});

test('each unexplained acronym gets its own report', () => {
  const text = 'The HELM sends a PII record to the RNG.';
  assert.deepEqual(words(acronymRule(text)), ['HELM', 'PII', 'RNG']);
});

test('a plural acronym reports under its singular form', () => {
  assert.deepEqual(words(acronymRule('Two HELMs disagreed about the answer.')), ['HELM']);
});

test('a shouted common word is not an acronym', needsTable, () => {
  const text = 'You must NEVER do that, and you should ALWAYS check first.';
  assert.deepEqual(acronymRule(text), []);
});

test('a shouted inflected word is not an acronym', needsTable, () => {
  const text = 'These words are BANNED, and those VERBS are fine.';
  assert.deepEqual(acronymRule(text), []);
});

test('a line in capitals throughout is a label, not prose', () => {
  assert.deepEqual(acronymRule('WORDS AND HELM RULES\nordinary prose here.'), []);
});

test('a single capital letter is not an acronym', () => {
  assert.deepEqual(acronymRule('Option A runs before option B does.'), []);
});

test('a token longer than six capitals is not an acronym', () => {
  assert.deepEqual(acronymRule('The ABCDEFGH marker sits at the top.'), []);
});

test('the rule never throws on empty input', () => {
  assert.deepEqual(acronymRule(''), []);
});

test('an acronym inside a code span never reaches the rule', () => {
  const found = lint('Set the `HELM` field before you save it.\n', { tier: 'flavored', kind: 'markdown' });
  assert.deepEqual(found.filter((v) => v.rule === 'acronym'), []);
});

test('an acronym inside a fenced block never reaches the rule', () => {
  const text = '```\nHELM=1\n```\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.deepEqual(found.filter((v) => v.rule === 'acronym'), []);
});

test('an acronym in prose reaches the rule through lint', () => {
  const found = lint('The HELM answer names the thing it disclaims.\n', { tier: 'flavored', kind: 'markdown' });
  assert.deepEqual(words(found.filter((v) => v.rule === 'acronym')), ['HELM']);
});
