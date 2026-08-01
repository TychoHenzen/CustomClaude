import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  transform,
  buildHeader,
  parseHeader,
  isTableCurrent,
  HEADER_VERSION,
} from './build-word-freq.mjs';

const SAMPLE = [
  'the\t100',
  'of\t50',
  'a\t50',
  'zebra\t10',
  'Aardvark\t5',
].join('\n');

test('transform sorts entries by byte order, not locale', () => {
  const out = transform(SAMPLE);
  const lines = out.trim().split('\n').slice(1);
  const words = lines.map((l) => l.split(' ')[0]);
  assert.deepEqual(words, ['Aardvark', 'a', 'of', 'the', 'zebra']);
});

test('transform computes log10 counts per million', () => {
  const out = transform(SAMPLE);
  const lines = out.trim().split('\n').slice(1);
  const theLine = lines.find((l) => l.startsWith('the '));
  const value = Number(theLine.split(' ')[1]);
  // total = 215, the = 100. log10(100 / 215 * 1e6) is about 5.6675.
  assert.ok(Math.abs(value - 5.67) < 0.01, `got ${value}`);
});

test('transform writes a header with source, version, and count', () => {
  const out = transform(SAMPLE);
  const header = out.split('\n')[0];
  const parsed = parseHeader(header);
  assert.equal(parsed.version, HEADER_VERSION);
  assert.equal(parsed.entries, 5);
  assert.equal(header.startsWith('#'), true);
});

test('buildHeader and parseHeader round-trip', () => {
  const header = buildHeader(42, 'https://example.test/list.txt');
  const parsed = parseHeader(header);
  assert.equal(parsed.entries, 42);
  assert.equal(parsed.sourceUrl, 'https://example.test/list.txt');
});

test('isTableCurrent is false when the file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'word-freq-'));
  try {
    assert.equal(isTableCurrent(join(dir, 'word-freq.txt')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isTableCurrent is true when the header count matches the data lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'word-freq-'));
  const path = join(dir, 'word-freq.txt');
  try {
    const body = transform(SAMPLE);
    writeFileSync(path, body, 'utf8');
    assert.equal(isTableCurrent(path), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isTableCurrent is false when the data lines do not match the header count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'word-freq-'));
  const path = join(dir, 'word-freq.txt');
  try {
    const body = `${buildHeader(5)}\nonly one line here 1.0\n`;
    writeFileSync(path, body, 'utf8');
    assert.equal(isTableCurrent(path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the script never exits non-zero, even offline', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'word-freq-'));
  const outPath = join(dir, 'word-freq.txt');
  try {
    let stderr = '';
    let status = 0;
    try {
      execFileSync('node', [
        join(import.meta.dirname, 'build-word-freq.mjs'),
        `--out=${outPath}`,
      ], { timeout: 65000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      status = err.status ?? 1;
      stderr = String(err.stderr || '');
    }
    if (status !== 0) {
      assert.fail(`script exited ${status}, stderr: ${stderr}`);
    }
    if (!existsSync(outPath)) {
      t.diagnostic('no network reachable, download skipped as expected');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
