import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { setTablePath } from './word-freq.mjs';
import { syllables, fleschKincaidGrade, textMeasure } from './readability.mjs';

const REAL_TABLE_PATH = join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.claude', 'ste', 'data', 'word-freq.txt',
);

/** Fixture words with hand-picked log frequencies, sorted in byte order. */
const FIXTURE_ROWS = [
  ['cat', 1.00],
  ['mat', 1.00],
  ['on', 3.00],
  ['sat', 1.00],
  ['the', 4.59],
];

function buildFixtureTable() {
  const header = `# word-freq v1 source=https://example.test/list.txt entries=${FIXTURE_ROWS.length}`;
  const lines = FIXTURE_ROWS.map(([word, value]) => `${word} ${value.toFixed(2)}`);
  return `${[header, ...lines].join('\n')}\n`;
}

function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'readability-'));
  const path = join(dir, 'word-freq.txt');
  writeFileSync(path, buildFixtureTable(), 'utf8');
  try {
    setTablePath(path);
    fn();
  } finally {
    setTablePath(REAL_TABLE_PATH);
    rmSync(dir, { recursive: true, force: true });
  }
}

function withNoTable(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'readability-missing-'));
  const missingPath = join(dir, 'does-not-exist.txt');
  setTablePath(missingPath);
  try {
    fn();
  } finally {
    setTablePath(REAL_TABLE_PATH);
    rmSync(dir, { recursive: true, force: true });
  }
}

function close(actual, expected, tolerance = 0.01) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

// --- syllables -------------------------------------------------------

test('syllables matches the words named in the task brief', () => {
  assert.equal(syllables('the'), 1);
  assert.equal(syllables('readability'), 5);
  assert.equal(syllables('cake'), 1);
  assert.equal(syllables('little'), 2);
});

test('syllables handles a short word without a vowel group', () => {
  assert.equal(syllables('dr'), 1);
});

test('syllables never returns less than 1 on punctuation-only input', () => {
  assert.equal(syllables('!!!'), 1);
  assert.equal(syllables(''), 1);
});

// --- fleschKincaidGrade ------------------------------------------------

test('fleschKincaidGrade matches a hand-computed value for a simple sentence', () => {
  // "The cat sat." -> 3 words, 1 sentence, 3 syllables (all 1-syllable words).
  // 0.39 * 3 + 11.8 * 1 - 15.59 = -2.62
  const grade = fleschKincaidGrade(['The cat sat.']);
  close(grade, -2.62);
});

test('fleschKincaidGrade matches a hand-computed value for a denser sentence', () => {
  // "Software engineers analyze vendor feedback carefully." -> 6 words, 1
  // sentence. Syllable counts by the stated heuristic: software 2,
  // engineers 3, analyze 3, vendor 2, feedback 2, carefully 4. Sum 16.
  // 0.39 * 6 + 11.8 * (16 / 6) - 15.59 = 18.216666...
  const grade = fleschKincaidGrade(['Software engineers analyze vendor feedback carefully.']);
  close(grade, 18.2167);
});

test('fleschKincaidGrade returns a clearly higher number for the dense sentence', () => {
  const simple = fleschKincaidGrade(['The cat sat.']);
  const dense = fleschKincaidGrade(['Software engineers analyze vendor feedback carefully.']);
  assert.ok(dense > simple + 5);
});

test('fleschKincaidGrade returns null for an empty array', () => {
  assert.equal(fleschKincaidGrade([]), null);
});

test('fleschKincaidGrade returns null for a sentence of pure punctuation', () => {
  assert.equal(fleschKincaidGrade(['... !! ---']), null);
});

// --- textMeasure ---------------------------------------------------------

test('textMeasure scores short common words below rare long words', () => {
  withFixture(() => {
    const easy = textMeasure(['The cat sat on the mat.']);
    // words: the, cat, sat, on, the, mat -> freq sum 4.59+1+1+3+4.59+1 =
    // 15.18, mean 2.53. Sentence length log(6) approx 1.791759.
    close(easy.meanLogFrequency, 2.53);
    close(easy.meanLogSentenceLength, Math.log(6));

    const dense = textMeasure(['Extraordinary philosophical epistemology necessitates comprehensive interdisciplinary frameworks profoundly.']);
    // None of the 8 words are in the fixture table, so each resolves to
    // OOV_FLOOR (-3). Mean log frequency is exactly -3.
    close(dense.meanLogFrequency, -3);
    close(dense.meanLogSentenceLength, Math.log(8));

    assert.ok(dense.combinedDifficulty > easy.combinedDifficulty);
  });
});

test('textMeasure chunks a long passage and averages instead of favoring one sentence', () => {
  withFixture(() => {
    const unit = 'The cat sat on the mat.';
    const sentences = new Array(25).fill(unit);
    const result = textMeasure(sentences);

    assert.equal(result.wordCount, 150);
    // Every sentence is identical, so every chunk has the same per-word
    // frequency mean and the same sentence-length mean, no matter where the
    // chunk boundary falls. Overall mean log frequency is 2.53, as in the
    // single-sentence case above. Overall mean log sentence length is
    // log(6).
    close(result.meanLogFrequency, 2.53);
    close(result.meanLogSentenceLength, Math.log(6));
    // zFreq = (2.53 - 2.2452) / 0.3935 = 0.7237
    // zLen = (log(6) - 2.1647) / 0.5036 = -0.7373
    // combinedDifficulty = 9 + 2 * (zLen - zFreq) = 6.0714
    close(result.combinedDifficulty, 6.0714, 0.01);
  });
});

test('textMeasure falls back to a length-only grade when the table is absent', () => {
  withNoTable(() => {
    const result = textMeasure(['The cat sat.']);
    assert.equal(result.degraded, true);
    assert.equal(result.meanLogFrequency, null);
    // zLen = (log(3) - 2.1647) / 0.5036 = -2.1174
    // combinedDifficulty = 9 + 2 * zLen = 4.7652
    close(result.combinedDifficulty, 4.7652, 0.01);
    close(result.fleschKincaidGrade, -2.62);
  });
});

test('textMeasure does not throw on an empty array or punctuation-only input', () => {
  withFixture(() => {
    const empty = textMeasure([]);
    assert.equal(empty.wordCount, 0);
    assert.equal(empty.combinedDifficulty, null);

    const punctOnly = textMeasure(['... !! ---']);
    assert.equal(punctOnly.wordCount, 0);
    assert.equal(punctOnly.combinedDifficulty, null);
  });
});

test('real table: textMeasure scores a plain sentence without throwing', { skip: !existsSync(REAL_TABLE_PATH) }, () => {
  setTablePath(REAL_TABLE_PATH);
  const result = textMeasure(['The quick brown fox jumps over the lazy dog.']);
  assert.equal(result.degraded, false);
  assert.equal(typeof result.combinedDifficulty, 'number');
});
