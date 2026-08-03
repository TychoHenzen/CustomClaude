import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { append, byFile, clear, pathFor, read } from './pending.mjs';

function dir() {
  return mkdtempSync(join(tmpdir(), 'pending-'));
}

test('records come back in the order they were written', () => {
  const d = dir();
  append('s1', { file: 'a.md', adds: null }, d);
  append('s1', { file: 'b.md', adds: [{ text: 'x', all: false }] }, d);
  const records = read('s1', d);
  assert.deepEqual(records.map((r) => r.file), ['a.md', 'b.md']);
});

test('one torn line never loses the rest', () => {
  const d = dir();
  append('s1', { file: 'a.md', adds: null }, d);
  appendFileSync(pathFor('s1', d), '{ not json\n');
  append('s1', { file: 'b.md', adds: null }, d);
  assert.deepEqual(read('s1', d).map((r) => r.file), ['a.md', 'b.md']);
});

test('sessions do not read each other', () => {
  const d = dir();
  append('s1', { file: 'a.md', adds: null }, d);
  append('s2', { file: 'b.md', adds: null }, d);
  assert.deepEqual(read('s2', d).map((r) => r.file), ['b.md']);
});

test('clear empties the log', () => {
  const d = dir();
  append('s1', { file: 'a.md', adds: null }, d);
  clear('s1', d);
  assert.deepEqual(read('s1', d), []);
});

test('a session id cannot escape the log directory', () => {
  const d = dir();
  assert.equal(pathFor('../../evil', d), join(d, '....evil.json'));
  assert.equal(pathFor('', d), null);
  assert.equal(pathFor(null, d), null);
});

test('byFile groups every call on one file together', () => {
  const groups = byFile([
    { file: 'a.md', adds: null },
    { file: 'b.md', adds: null },
    { file: 'a.md', adds: [{ text: 'x', all: false }] },
  ]);
  assert.deepEqual([...groups.keys()], ['a.md', 'b.md']);
  assert.equal(groups.get('a.md').length, 2);
});
