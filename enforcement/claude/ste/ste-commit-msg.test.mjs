import test from 'node:test';
import assert from 'node:assert/strict';
import { stripChangeTag } from './ste-commit-msg.mjs';

test('blanks a change tag on a bullet', () => {
  assert.equal(stripChangeTag('- CHG: rename the flag'), '-      rename the flag');
});

test('keeps the column of the text after the tag', () => {
  const line = '  * REM: drop the old path';
  assert.equal(stripChangeTag(line).indexOf('drop'), line.indexOf('drop'));
});

test('leaves a bullet with no tag alone', () => {
  assert.equal(stripChangeTag('- rename the flag'), '- rename the flag');
});

test('leaves a tag that opens no bullet alone', () => {
  assert.equal(stripChangeTag('CHG: rename the flag'), 'CHG: rename the flag');
});

test('leaves a capitalized word alone', () => {
  assert.equal(stripChangeTag('- Rename: the flag'), '- Rename: the flag');
});
