import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  logFrequency,
  hasTable,
  entryCount,
  setTablePath,
  OOV_FLOOR,
} from './word-freq.mjs';

const REAL_TABLE_PATH = join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'ste', 'data', 'word-freq.txt');

/** Thirty-plus words, sorted in byte order, matching build-word-freq output. */
const FIXTURE_WORDS = [
  'a', 'aardvark', 'ability', 'able', 'about', 'above', 'accept', 'across',
  'act', 'add', 'after', 'again', 'against', 'age', 'agree', 'air', 'all',
  'allow', 'almost', 'alone', 'along', 'already', 'also', 'although',
  'always', 'among', 'amount', 'and', 'anger', 'animal', 'another',
  'answer', 'any', 'zebra',
];

function buildFixtureTable() {
  const header = `# word-freq v1 source=https://example.test/list.txt entries=${FIXTURE_WORDS.length}`;
  const lines = FIXTURE_WORDS.map((word, i) => `${word} ${(i * 0.1).toFixed(2)}`);
  return `${[header, ...lines].join('\n')}\n`;
}

function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'word-freq-'));
  const path = join(dir, 'word-freq.txt');
  writeFileSync(path, buildFixtureTable(), 'utf8');
  try {
    setTablePath(path);
    fn(path);
  } finally {
    setTablePath(REAL_TABLE_PATH);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('logFrequency finds a common fixture word', () => {
  withFixture(() => {
    const idx = FIXTURE_WORDS.indexOf('animal');
    assert.equal(logFrequency('animal'), Number((idx * 0.1).toFixed(2)));
  });
});

test('logFrequency finds a rare fixture word', () => {
  withFixture(() => {
    const idx = FIXTURE_WORDS.indexOf('zebra');
    assert.equal(logFrequency('zebra'), Number((idx * 0.1).toFixed(2)));
  });
});

test('logFrequency returns OOV_FLOOR for an absent word', () => {
  withFixture(() => {
    assert.equal(logFrequency('qqqqqqzzzznotarealword'), OOV_FLOOR);
  });
});

test('logFrequency lowercases before lookup', () => {
  withFixture(() => {
    assert.equal(logFrequency('Animal'), logFrequency('animal'));
    assert.equal(logFrequency('ZEBRA'), logFrequency('zebra'));
  });
});

test('logFrequency strips a trailing possessive', () => {
  withFixture(() => {
    assert.equal(logFrequency("animal's"), logFrequency('animal'));
    assert.equal(logFrequency("animal'"), logFrequency('animal'));
  });
});

test('logFrequency resolves the first entry in the table', () => {
  withFixture(() => {
    assert.equal(logFrequency('a'), 0);
  });
});

test('logFrequency resolves the last entry in the table', () => {
  withFixture(() => {
    const idx = FIXTURE_WORDS.length - 1;
    assert.equal(logFrequency('zebra'), Number((idx * 0.1).toFixed(2)));
  });
});

test('entryCount reads the header count', () => {
  withFixture(() => {
    assert.equal(entryCount(), FIXTURE_WORDS.length);
  });
});

test('hasTable is false and logFrequency is null when the table file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'word-freq-'));
  const missingPath = join(dir, 'does-not-exist.txt');
  setTablePath(missingPath);
  try {
    assert.equal(hasTable(), false);
    assert.equal(logFrequency('the'), null);
    assert.equal(entryCount(), 0);
  } finally {
    setTablePath(REAL_TABLE_PATH);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the module reads the table file once across many calls', () => {
  withFixture((path) => {
    logFrequency('a');
    logFrequency('zebra');
    logFrequency('animal');
    // Removing the file after the first read must not break later lookups,
    // because the Buffer stays cached in module scope.
    rmSync(path, { force: true });
    assert.equal(logFrequency('a'), 0);
  });
});

test('real table: the resolves to the known value', { skip: !existsSync(REAL_TABLE_PATH) }, () => {
  setTablePath(REAL_TABLE_PATH);
  assert.equal(logFrequency('the'), 4.59);
});

test('real table: first and last entries resolve', { skip: !existsSync(REAL_TABLE_PATH) }, () => {
  setTablePath(REAL_TABLE_PATH);
  assert.equal(logFrequency('a'), 4.19);
  assert.equal(logFrequency('zzzz'), -0.21);
});
