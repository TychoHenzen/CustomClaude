import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { review, verdict } from './ste-reply-guard.mjs';
import { setCorpusRoot } from '../ste/local-corpus.mjs';

// The bare-label rule asks the local corpus whether the project already
// writes a token. This repository documents the rule with `S10`, so the real
// corpus votes that label a project name and the fixtures below report
// nothing. Point the corpus at an empty directory instead.
const EMPTY_CORPUS = mkdtempSync(join(tmpdir(), 'reply-guard-corpus-'));
setCorpusRoot(EMPTY_CORPUS);

const EM_DASH = String.fromCharCode(0x2014);

/** Why this reply blocks, or null when it passes. */
function judge(text) {
  return verdict(review(text));
}

test('a plain reply passes', () => {
  assert.equal(judge('The gate refused the write. It named the file.\n'), null);
});

test('one encoding character blocks on its own', () => {
  assert.match(judge(`The gate refused ${EM_DASH} it named the file.\n`), /corrupt/);
});

test('polish findings never block, however many the reply carries', () => {
  const text = 'We leverage the parser. We leverage the writer. '
    + 'We leverage the reader. We leverage the linter. '
    + 'We utilize the gate; we utilize the log.\n';
  const { advice } = review(text);
  assert.ok(advice.length > 4);
  assert.equal(judge(text), null);
});

test('two comprehension findings stay inside the budget', () => {
  const text = 'S10 read the file. Phase 3 wrote it back.\n';
  const { comprehension } = review(text);
  assert.equal(comprehension.length, 2);
  assert.equal(judge(text), null);
});

test('a third comprehension finding blocks the reply', () => {
  const text = 'S10 read the file. Phase 3 wrote it back. Step 4 closed it.\n';
  assert.match(judge(text), /budget is 2/);
});

test('a fragment-heavy reply is still checked for sentence shape', () => {
  const long = `Fixed ${'the parser and the writer and the reader '.repeat(4)}now.\n`;
  const { comprehension } = review(long);
  assert.ok(comprehension.some((v) => v.rule === 'long-sentence'));
});
