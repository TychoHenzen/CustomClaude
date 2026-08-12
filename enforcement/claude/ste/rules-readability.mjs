/**
 * rules-readability - word readability rules for ste-lint.
 *
 * Vocabulary rarity used to come from a hand-written list of about 30 long
 * words. That list missed most rare words and flagged some harmless ones.
 * This module reads rarity from a 333,333 word frequency table instead, so
 * the verdict comes from evidence, not from memory.
 */

import { hasTable, OOV_FLOOR } from './word-freq.mjs';
import { baseWordForms, bestLogFrequency, HARD_WORD_THRESHOLD } from './word-forms.mjs';
import { isLocalWord } from './local-corpus.mjs';
import {
  hardestSentence, textMeasure, MU_FREQ, SD_FREQ, MU_LEN, SD_LEN,
} from './readability.mjs';
import { splitSentences } from './ste-lint.mjs';
import { quoteSentence } from './rule-classes.mjs';

/**
 * `cannot` is a corpus glitch rather than a rare word. It sits at rank
 * 106,595 with 88,737 occurrences, log frequency -0.82, below ordinary
 * words such as `markdown` and `ampersand`. Every other common modal verb
 * ranks in the hundreds. It is the one word the two votes below cannot
 * settle, because a project that never writes it still owes its reader
 * nothing.
 */
const TABLE_GLITCHES = new Set(['cannot']);

/** A word shorter than this many letters is never flagged as hard. */
const MIN_HARD_WORD_LENGTH = 5;

/**
 * Word tokens use the ASCII apostrophe only.
 * The frequency table strips a trailing ASCII apostrophe before lookup.
 * A word with a curly apostrophe would always miss the table and score as
 * rare. Treating a curly apostrophe as a boundary avoids that false report.
 */
const WORD_PATTERN = /[A-Za-z][A-Za-z']*/g;

/** Mask filler is a NUL character. The linter leaves it behind where it
 *  blanks out a code span, a path, or a flag. */
const MASK_FILLER = String.fromCharCode(0);

function isBoundaryChar(ch) {
  return /\s/.test(ch) || ch === MASK_FILLER;
}

/**
 * True when the character at index starts a sentence.
 * Nothing sits before it but white space and mask filler.
 * Or a stop mark sits right before that white space, where a stop mark is
 * a period, a question mark, or an exclamation mark.
 */
function startsSentence(text, index) {
  let i = index - 1;
  while (i >= 0 && isBoundaryChar(text[i])) i--;
  if (i < 0) return true;
  return '.!?'.includes(text[i]);
}

/** True when word is a capital that looks like a name rather than a sentence start. */
function looksLikeProperNoun(word, text, index) {
  if (!/^[A-Z]/.test(word)) return false;
  return !startsSentence(text, index);
}

/** True when word sits between an ampersand and a stop mark, as in the name
 *  part of an HTML entity. That is markup, not a prose word. */
function looksLikeEntityName(word, text, index) {
  const before = text[index - 1];
  const after = text[index + word.length];
  return before === '&' && after === ';';
}

function lineOf(block, offset) {
  const before = block.text.slice(0, offset);
  return block.line + (before.match(/\n/g) || []).length + 1;
}

/**
 * True when word is rare for a reader of this project. Two votes decide it.
 *
 * The frequency table votes first. A word above HARD_WORD_THRESHOLD is
 * common English and stops here. A word absent from the table floors at
 * OOV_FLOOR and stops here too. The table reads a 2006 crawl, so absence
 * marks a young word rather than a hard one.
 *
 * The project votes second. A word this project already uses, in two files
 * or five times over, is vocabulary the reader brought with them. Telling a
 * writer to replace it costs precision and buys nothing. That vote replaces
 * a hand-written allowlist. The list had grown to twelve entries against a
 * hundred and thirty-two offenders in one repository alone.
 */
function rarityOf(word) {
  const lower = word.toLowerCase();
  if (TABLE_GLITCHES.has(lower)) return null;
  const freq = bestLogFrequency(word);
  if (freq === null || freq === OOV_FLOOR || freq > HARD_WORD_THRESHOLD) return null;
  if (isProjectVocabulary(lower)) return null;
  return freq;
}

/** True when the project uses word, in the form written or in its base
 *  form. A project that writes `linter` has taught its reader `linters`. */
function isProjectVocabulary(lower) {
  if (isLocalWord(lower)) return true;
  return baseWordForms(lower).some((base) => isLocalWord(base));
}

/**
 * Find every hard word in block and return violations in the shape the
 * linter uses. Returns an empty array when no frequency table is loaded.
 * It never throws, because with no table it has no evidence to flag on.
 *
 * Every finding lands in the polish class, in both tiers. Research on
 * readability formulas reads them as a good diagnosis and a bad
 * prescription. Texts revised to shorter sentences and commoner words
 * measure easier and test worse. A precise term carries meaning that its
 * plain paraphrase drops. So this rule advises and never blocks.
 */
export function hardWordRule(block) {
  if (!hasTable()) return [];
  const found = [];

  WORD_PATTERN.lastIndex = 0;
  let m;
  while ((m = WORD_PATTERN.exec(block.text)) !== null) {
    const word = m[0];
    if (word.length < MIN_HARD_WORD_LENGTH) continue;
    if (looksLikeProperNoun(word, block.text, m.index)) continue;
    if (looksLikeEntityName(word, block.text, m.index)) continue;

    const freq = rarityOf(word);
    if (freq === null) continue;

    found.push({
      line: lineOf(block, m.index),
      rule: 'hard-word',
      msg: `"${word}" is a rare word (log frequency ${freq.toFixed(2)}). Use a commoner one.`,
    });
  }

  return found;
}

/**
 * Combined-difficulty ceiling for the strict tier, in grades, under the
 * standardized scale in readability.mjs.
 *
 * The linter scores one block at a time, not a whole document averaged
 * together. A single hard paragraph can measure harder than its whole
 * document's own average. An earlier step measured the one strict-tier
 * file in the corpus that must pass, `enforcement/INSTALL-PROMPT.md`. Its hardest
 * block scores grade 11.52, 1.26 standard deviations above average. This
 * ceiling sits well above that block.
 */
export const READABILITY_CEILING_STRICT = 14; // BASE + W * 2.5 standard deviations.

/**
 * Combined-difficulty ceiling for the flavored tier, in grades, under the
 * standardized scale in readability.mjs.
 *
 * An earlier step measured every flavored-tier file that must pass.
 * Its hardest block, a README bullet, scores grade 15.92, 3.46 standard
 * deviations above average. The worst sample in the task brief, six
 * sentences of pure jargon, scores grade 17.03, 4.01 standard deviations.
 * This ceiling sits between the two, with more than half a grade of room on
 * each side.
 */
export const READABILITY_CEILING_FLAVORED = 16.5; // BASE + W * 3.75 standard deviations.

/**
 * A block below this many words is skipped. A short block gives the score
 * too little text to average over, so the result would read as noise
 * rather than a real signal.
 *
 * An earlier step measured a 15 word sentence built from invented, rare
 * words. It scored grade 32.21, far over the flavored ceiling. A short
 * block can still cross the ceiling on rarity alone at this floor. This
 * floor stays at 15 words, about one plain sentence.
 */
const MIN_READABILITY_WORDS = 15;

function ceilingFor(tier) {
  return tier === 'strict' ? READABILITY_CEILING_STRICT : READABILITY_CEILING_FLAVORED;
}

/**
 * Decide which driver, rarity or length, contributes more to measure.
 *
 * Both signals in measure come standardized, in units of standard
 * deviation from this repository's own average prose. The two z-scores
 * already sit on the same scale. This is a straight comparison, with no
 * extra weight of its own to keep in step with readability.mjs.
 */
function dominantDriver(measure) {
  if (measure.meanLogFrequency === null) return 'length';
  const zFreq = (measure.meanLogFrequency - MU_FREQ) / SD_FREQ;
  const zLen = (measure.meanLogSentenceLength - MU_LEN) / SD_LEN;
  const rarityTerm = -zFreq;
  return rarityTerm >= zLen ? 'rarity' : 'length';
}

function driverAdvice(driver) {
  return driver === 'rarity'
    ? 'Word rarity drives the score. Swap the rare words for common ones.'
    : 'Sentence length drives the score. Split the long sentences.';
}

/** Note added to the message when there is no frequency table to weigh
 *  word rarity, so the score rests on sentence length alone. */
function degradedNote(degraded) {
  if (!degraded) return '';
  return ' The word frequency table is missing. Word rarity was not weighed.';
}

function readabilityMessage(measure, ceiling, tier, worst) {
  const grade = measure.combinedDifficulty.toFixed(2);
  const advice = driverAdvice(dominantDriver(measure));
  const note = degradedNote(measure.degraded);
  const blame = worst ? ` Rewrite this sentence: ${quoteSentence(worst)}` : '';
  return `Readability grade is ${grade}, ceiling for ${tier} is ${ceiling.toFixed(2)}.`
    + `${note} ${advice}${blame}`;
}

/** The offset of the hardest sentence in block, or zero when no sentence
 *  carries the blame on its own. */
function blameOffset(parts, worst) {
  const hit = parts.find((part) => part.text === worst);
  return hit ? hit.offset : 0;
}

/**
 * Score block as a whole and report one violation when it reads harder
 * than tier allows. A block that fails on both long sentences and rare
 * words still gets one report, because a hard paragraph is one problem.
 *
 * The score belongs to the block, but the report points at the hardest
 * sentence in it and quotes that sentence. A grade number alone left the
 * writer hunting, and hunting is how a turn goes to fixing punctuation
 * instead. Never throws, so a scoring surprise cannot block every write.
 */
export function readabilityRule(block, tier) {
  try {
    if (block.heading) return [];
    const parts = splitSentences(block.text);
    const measure = textMeasure(parts.map((s) => s.text));
    if (measure.wordCount < MIN_READABILITY_WORDS) return [];
    if (measure.combinedDifficulty === null) return [];
    const ceiling = ceilingFor(tier);
    if (measure.combinedDifficulty <= ceiling) return [];

    const worst = hardestSentence(parts.map((s) => s.text));
    return [{
      line: lineOf(block, blameOffset(parts, worst)),
      rule: 'readability',
      msg: readabilityMessage(measure, ceiling, tier, worst),
    }];
  } catch {
    return [];
  }
}
