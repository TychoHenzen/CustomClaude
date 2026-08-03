import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assess } from './ste-turn-guard.mjs';

const EM_DASH = String.fromCharCode(0x2014);

function fixture(name, body) {
  const dir = mkdtempSync(join(tmpdir(), 'turn-guard-'));
  const file = join(dir, name);
  writeFileSync(file, body);
  return file;
}

/** One record covering the whole file, as a Write call produces. */
function wroteAll(file) {
  return new Map([[file, [{ file, adds: null }]]]);
}

/** One record covering only the text an Edit call added. */
function edited(file, added) {
  return new Map([[file, [{ file, adds: [{ text: added, all: false }] }]]]);
}

test('three new violations stay inside the budget', () => {
  const body = '# Notes\n\n'
    + 'We leverage the parser here.\n'
    + 'We leverage the writer here.\n'
    + 'We leverage the reader here.\n';
  const { blocked, checked } = assess(wroteAll(fixture('notes.md', body)));
  assert.equal(checked, 1);
  assert.deepEqual(blocked, []);
});

test('a fourth new violation goes over the budget', () => {
  const body = '# Notes\n\n'
    + 'We leverage the parser here.\n'
    + 'We leverage the writer here.\n'
    + 'We leverage the reader here.\n'
    + 'We leverage the linter here.\n';
  const { blocked } = assess(wroteAll(fixture('notes.md', body)));
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].reason, /budget is 3/);
});

test('one new encoding violation blocks on its own', () => {
  const body = `# Notes\n\nA plain line ${EM_DASH} with a dash.\n`;
  const { blocked } = assess(wroteAll(fixture('notes.md', body)));
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].reason, /encoding/);
});

test('violations the turn did not write are reported, never blocking', () => {
  const body = '# Notes\n\n'
    + 'We leverage the parser here.\n'
    + 'We leverage the writer here.\n'
    + 'We leverage the reader here.\n'
    + 'We leverage the linter here.\n'
    + 'This line is clean and new.\n';
  const { blocked } = assess(edited(fixture('notes.md', body), 'This line is clean and new.\n'));
  assert.deepEqual(blocked, []);
});

test('the report carries the untouched violations too', () => {
  const body = `# Notes\n\nWe leverage the parser here.\nA line ${EM_DASH} added now.\n`;
  const { blocked } = assess(edited(fixture('notes.md', body), `A line ${EM_DASH} added now.\n`));
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].result.fresh.length, 1);
  assert.ok(blocked[0].result.existing.some((v) => v.rule === 'slop-word'));
});

test('a file that is not a prose target is never checked', () => {
  const file = fixture('data.json', '{"a": 1}\n');
  const { blocked, checked } = assess(wroteAll(file));
  assert.equal(checked, 0);
  assert.deepEqual(blocked, []);
});

test('text an later edit removed contributes no lines', () => {
  const body = `# Notes\n\nA line ${EM_DASH} added now.\n`;
  const file = fixture('notes.md', body);
  const { blocked } = assess(new Map([[file, [{ file, adds: [{ text: 'text that is gone', all: false }] }]]]));
  assert.deepEqual(blocked, []);
});
