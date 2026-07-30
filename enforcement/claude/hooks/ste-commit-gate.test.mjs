import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { blockingRecords, evaluate, isGitCommitCommand } from './ste-commit-gate.mjs';

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'ste-commit-gate-'));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, '.github', 'quality'), { recursive: true });
  return root;
}

function writeLog(root, records) {
  writeFileSync(join(root, '.github', 'quality', 'prose-skip-log.json'), JSON.stringify(records));
}

test('isGitCommitCommand: plain git commit matches', () => {
  assert.equal(isGitCommitCommand('git commit -m "x"'), true);
});

test('isGitCommitCommand: chained through a prefix wrapper matches', () => {
  assert.equal(isGitCommitCommand('rtk git commit -m "x"'), true);
});

test('isGitCommitCommand: chained with && matches', () => {
  assert.equal(isGitCommitCommand('echo hi && git commit -m "x"'), true);
});

test('isGitCommitCommand: words inside a quoted argument do not match', () => {
  assert.equal(isGitCommitCommand('git log --grep="git commit"'), false);
});

test('blockingRecords: unacknowledged record blocks a plain commit', () => {
  const root = makeRepo();
  try {
    writeLog(root, [{ file: 'a.md', at: 'now', acknowledged: false }]);
    const records = blockingRecords(root, 'git commit -m "x"');
    assert.equal(records.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blockingRecords: every record acknowledged does not block', () => {
  const root = makeRepo();
  try {
    writeLog(root, [{ file: 'a.md', at: 'now', acknowledged: true }]);
    const records = blockingRecords(root, 'git commit -m "x"');
    assert.equal(records.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blockingRecords: no log file at all does not block', () => {
  const root = makeRepo();
  try {
    const records = blockingRecords(root, 'git commit -m "x"');
    assert.equal(records.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blockingRecords: a command that only mentions the words does not block', () => {
  const root = makeRepo();
  try {
    writeLog(root, [{ file: 'a.md', at: 'now', acknowledged: false }]);
    const records = blockingRecords(root, 'git log --grep="git commit"');
    assert.equal(records.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blockingRecords: a commit reached through a chain blocks', () => {
  const root = makeRepo();
  try {
    writeLog(root, [{ file: 'a.md', at: 'now', acknowledged: false }]);
    const records = blockingRecords(root, 'rtk git commit -m "x"');
    assert.equal(records.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('evaluate: a non-Bash tool call does not block', () => {
  const root = makeRepo();
  try {
    writeLog(root, [{ file: 'a.md', at: 'now', acknowledged: false }]);
    const result = evaluate({ tool_name: 'Write', tool_input: { command: 'git commit -m "x"' }, cwd: root });
    assert.equal(result.block, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
