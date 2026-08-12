import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assess } from './ste-turn-guard.mjs';
import { setCorpusRoot } from '../ste/local-corpus.mjs';

// The bare-label rule asks the local corpus whether the project already
// writes a token. This repository documents the rule with `S10`, so the real
// corpus votes that label a project name and the fixtures below report
// nothing. Point the corpus at an empty directory instead.
const EMPTY_CORPUS = mkdtempSync(join(tmpdir(), 'turn-guard-corpus-'));
setCorpusRoot(EMPTY_CORPUS);

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

/** A line carrying one comprehension violation, and nothing else. A bare
 *  label is the cheapest one to write, so the budget tests use it. */
function labelled(name) {
  return `The ${name} step read the file.\n`;
}

test('three new violations stay inside the budget', () => {
  const body = `# Notes\n\n${labelled('S10')}${labelled('S11')}${labelled('S12')}`;
  const { blocked, checked } = assess(wroteAll(fixture('notes.md', body)));
  assert.equal(checked, 1);
  assert.deepEqual(blocked, []);
});

test('polish violations never block, however many the turn writes', () => {
  const body = '# Notes\n\n'
    + 'We leverage the parser here.\n'
    + 'We leverage the writer here.\n'
    + 'We leverage the reader here.\n'
    + 'We leverage the linter here.\n'
    + 'We leverage the checker here.\n'
    + 'We leverage the gate here.\n';
  const { blocked, checked } = assess(wroteAll(fixture('notes.md', body)));
  assert.equal(checked, 1);
  assert.deepEqual(blocked, []);
});

test('a fourth new violation goes over the budget', () => {
  const body = `# Notes\n\n${labelled('S10')}${labelled('S11')}`
    + `${labelled('S12')}${labelled('S13')}`;
  const { blocked } = assess(wroteAll(fixture('notes.md', body)));
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].reason, /budget is 3/);
});

test('polish violations cannot buy a file out of the budget', () => {
  const overBudget = `# Notes\n\n${labelled('S10')}${labelled('S11')}`
    + `${labelled('S12')}${labelled('S13')}`;
  const withSemicolons = overBudget.replace(/step read/g, 'step read it; it read');
  const { blocked } = assess(wroteAll(fixture('notes.md', withSemicolons)));
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
  const body = `# Notes\n\n${labelled('S10')}${labelled('S11')}`
    + `${labelled('S12')}${labelled('S13')}`
    + 'This line is clean and new.\n';
  const { blocked } = assess(edited(fixture('notes.md', body), 'This line is clean and new.\n'));
  assert.deepEqual(blocked, []);
});

test('the report carries the untouched violations too', () => {
  const body = `# Notes\n\n${labelled('S10')}A line ${EM_DASH} added now.\n`;
  const { blocked } = assess(edited(fixture('notes.md', body), `A line ${EM_DASH} added now.\n`));
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].result.fresh.length, 1);
  assert.ok(blocked[0].result.existing.some((v) => v.rule === 'bare-label'));
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
