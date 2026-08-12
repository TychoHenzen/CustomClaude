/**
 * readability - turns already-segmented sentences into readability numbers.
 *
 * This module does not split text into sentences and does not mask
 * markdown. The linter owns that work. This module only scores plain
 * sentence strings it is handed, so it stays usable on its own.
 */

import { logFrequency, hasTable, OOV_FLOOR } from './word-freq.mjs';

const WORD_PATTERN = /[A-Za-z']+/g;
const SUFFIX_PATTERN = /(?:[^laeiouy]es|ed|[^laeiouy]e)$/;
const VOWEL_GROUP_PATTERN = /[aeiouy]{1,2}/g;

/**
 * Estimate the syllable count of a word. Returns at least 1.
 *
 * This is a vowel-group heuristic, not a lookup in a pronunciation
 * dictionary. It lowercases the word and drops a silent trailing e. It
 * keeps a trailing consonant plus le, as in "little". It drops a trailing
 * es or ed that usually adds no syllable. Then it counts groups of vowel
 * letters. It gets some words wrong. The Flesch-Kincaid formula tolerates
 * that error at this scale, because it only needs an average across many
 * words.
 */
export function syllables(word) {
  const lower = word.toLowerCase().replace(/[^a-z]/g, '');
  if (lower.length <= 3) return 1;
  const stripped = lower.replace(SUFFIX_PATTERN, '');
  const groups = stripped.match(VOWEL_GROUP_PATTERN);
  return groups ? groups.length : 1;
}

/** Split a sentence into word tokens. Punctuation-only input yields none. */
function wordsOf(sentence) {
  return sentence.match(WORD_PATTERN) || [];
}

function validSentences(sentences) {
  if (!Array.isArray(sentences)) return [];
  return sentences.filter((s) => typeof s === 'string');
}

/**
 * Flesch-Kincaid US grade level for sentences, an array of strings.
 * Formula: 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59.
 * Returns null when there are no words, because dividing by zero produces a
 * meaningless grade rather than an easy text.
 */
export function fleschKincaidGrade(sentences) {
  const usable = validSentences(sentences);
  const words = usable.flatMap(wordsOf);
  if (words.length === 0) return null;
  const totalSyllables = words.reduce((sum, w) => sum + syllables(w), 0);
  const sentenceCount = usable.length || 1;
  const wordsPerSentence = words.length / sentenceCount;
  const syllablesPerWord = totalSyllables / words.length;
  return 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;
}

const CHUNK_WORD_TARGET = 125;

/** Group sentence word lists into blocks of roughly CHUNK_WORD_TARGET words. */
function chunkSentences(sentenceWords) {
  const chunks = [];
  let current = [];
  let currentCount = 0;
  for (const words of sentenceWords) {
    current.push(words);
    currentCount += words.length;
    if (currentCount >= CHUNK_WORD_TARGET) {
      chunks.push(current);
      current = [];
      currentCount = 0;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function wordLogFrequency(word) {
  const value = logFrequency(word);
  return value === null ? OOV_FLOOR : value;
}

function average(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function chunkFrequencyMean(chunk) {
  const words = chunk.flat();
  return average(words.map(wordLogFrequency));
}

function chunkLengthMean(chunk) {
  return average(chunk.map((words) => Math.log(words.length)));
}

/**
 * Mean and spread of the two raw signals, measured over this repository's
 * own prose. An earlier step built the corpus from every markdown block in
 * README.md, everything under enforcement/, and everything under
 * SystemPrompts/. It used the real block splitter and sentence splitter
 * from ste-lint.mjs. It kept blocks of at least 15 words, the same floor
 * the readability rule uses. The corpus held 406 blocks, measured 2026-08-01.
 *
 * MU_FREQ and SD_FREQ are the mean and the standard deviation of each
 * block's mean log word frequency. MU_LEN and SD_LEN are the mean and the
 * standard deviation of each block's mean log sentence length. A z-score
 * built from these numbers says how many standard deviations a block sits
 * from ordinary prose in this repository, for each signal separately.
 */
const MU_FREQ = 2.2452;
const SD_FREQ = 0.3935;
const MU_LEN = 2.1647;
const SD_LEN = 0.5036;

/**
 * Grade for perfectly average prose, at both z-scores equal to zero.
 * Grades per standard deviation of combined difference. An earlier step picked
 * these so ordinary prose in this repository lands near grade 9. This
 * repository's hardest block, among the five files the linter runs at
 * error severity, lands at grade 15.92 under these two numbers. The
 * plainest blocks land near grade 3, a plausible US grade level range.
 */
const BASE = 9;
const W = 2;

function zScore(value, mu, sd) {
  return (value - mu) / sd;
}

/**
 * Combine the two standardized signals into one grade-level number.
 * A rarer word lowers meanLogFrequency, so its z-score is subtracted: a
 * lower frequency raises difficulty. A longer sentence raises
 * meanLogSentenceLength, so its z-score is added.
 */
function combinedDifficulty(meanLogFrequency, meanLogSentenceLength) {
  const zFreq = zScore(meanLogFrequency, MU_FREQ, SD_FREQ);
  const zLen = zScore(meanLogSentenceLength, MU_LEN, SD_LEN);
  return BASE + W * (zLen - zFreq);
}

/**
 * Grade-level number using the sentence-length signal alone, for when the
 * frequency table is missing. Holds zFreq at zero, so the missing signal
 * neither helps nor hurts the score, and the result rests on length only.
 */
function lengthOnlyDifficulty(meanLogSentenceLength) {
  const zLen = zScore(meanLogSentenceLength, MU_LEN, SD_LEN);
  return BASE + W * zLen;
}

/**
 * Lexile-style text measure for sentences, an array of strings.
 *
 * The result is a US grade-level number, not a Lexile L number. Real L
 * numbers need a regression against books with a published Lexile score,
 * and we have no anchor texts. Claiming an L number here would be a made-up
 * unit, so this function never produces one.
 *
 * It averages log word frequency and averages log sentence length. It
 * chunks the sentences into roughly 125-word blocks before averaging
 * across chunks. This way one long or one rare sentence cannot dominate the
 * score. It then standardizes each signal against this repository's own
 * prose and combines the two z-scores. Standardizing first means each
 * signal contributes on its own natural scale. Neither one can drown out
 * the other by having a larger raw range.
 *
 * When the word frequency table is missing, there is no frequency signal
 * to standardize. The result falls back to the length z-score alone and is
 * flagged degraded.
 */
export function textMeasure(sentences) {
  const usable = validSentences(sentences);
  const sentenceWords = usable.map(wordsOf).filter((words) => words.length > 0);
  const wordCount = sentenceWords.reduce((sum, words) => sum + words.length, 0);
  const fkGrade = fleschKincaidGrade(usable);

  if (wordCount === 0) {
    return {
      meanLogFrequency: null,
      meanLogSentenceLength: null,
      combinedDifficulty: null,
      wordCount: 0,
      fleschKincaidGrade: fkGrade,
      degraded: !hasTable(),
    };
  }

  const chunks = chunkSentences(sentenceWords);
  const meanLogSentenceLength = average(chunks.map(chunkLengthMean));

  if (!hasTable()) {
    return {
      meanLogFrequency: null,
      meanLogSentenceLength,
      combinedDifficulty: lengthOnlyDifficulty(meanLogSentenceLength),
      wordCount,
      fleschKincaidGrade: fkGrade,
      degraded: true,
    };
  }

  const meanLogFrequency = average(chunks.map(chunkFrequencyMean));
  const difficulty = combinedDifficulty(meanLogFrequency, meanLogSentenceLength);
  return {
    meanLogFrequency,
    meanLogSentenceLength,
    combinedDifficulty: difficulty,
    wordCount,
    fleschKincaidGrade: fkGrade,
    degraded: false,
  };
}

/**
 * A sentence too short to blame for a hard block. Below this, one rare word
 * swings the score and the reader was never held up.
 */
const MIN_BLAMED_WORDS = 8;

/**
 * The sentence in sentences that reads hardest, or null when every one of
 * them is too short to blame.
 *
 * The block score is an average, so it names no sentence. A writer told a
 * paragraph reads at grade 17 still has to find the bad line. This picks it,
 * scoring each sentence on its own with the same two signals the block
 * score uses.
 */
export function hardestSentence(sentences) {
  const usable = validSentences(sentences)
    .filter((text) => wordsOf(text).length >= MIN_BLAMED_WORDS);
  if (!usable.length) return null;

  let worst = null;
  let worstScore = -Infinity;
  for (const text of usable) {
    const words = wordsOf(text);
    const lengthMean = Math.log(words.length);
    const score = hasTable()
      ? combinedDifficulty(average(words.map(wordLogFrequency)), lengthMean)
      : lengthOnlyDifficulty(lengthMean);
    if (score <= worstScore) continue;
    worstScore = score;
    worst = text;
  }
  return worst;
}

export { MU_FREQ, SD_FREQ, MU_LEN, SD_LEN, BASE, W };
