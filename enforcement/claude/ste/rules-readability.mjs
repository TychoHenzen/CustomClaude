/**
 * rules-readability - word readability rules for ste-lint.
 *
 * Vocabulary rarity used to come from a hand-written list of about 30 long
 * words. That list missed most rare words and flagged some harmless ones.
 * This module reads rarity from a 333,333 word frequency table instead, so
 * the verdict comes from evidence, not from memory.
 */

import { logFrequency, hasTable, OOV_FLOOR } from './word-freq.mjs';
import { textMeasure, MU_FREQ, SD_FREQ, MU_LEN, SD_LEN } from './readability.mjs';
import { splitSentences } from './ste-lint.mjs';

/**
 * Log frequency threshold for the hard-word rule. A word at or below this
 * value counts as rare enough to flag.
 *
 * Step S08 checked this value against the words the owner named as still
 * hard. Four words qualify: `epistemological`, `thoroughgoing`,
 * `hermeneutic`, and `ontological`. All four score below 0.3, from -0.12
 * down to -1.09. All four still get caught. A common technical word such as
 * `parser` scores 0.82, above the line, and stays clear. This value did not
 * change from its earlier guess. The corpus check confirmed it, rather than
 * finding a need to fix it.
 */
export const HARD_WORD_THRESHOLD = 0.3;

/**
 * Words this rule never flags as hard, checked in lower case.
 *
 * The word frequency table reads a crawl from 2006. It never saw most
 * software terms, so it floors every one of them at OOV_FLOOR. The
 * hardWordRule below already skips a floored word for that reason. But a
 * handful of real, non-floored entries are just as ordinary in this
 * repository's writing and still score under HARD_WORD_THRESHOLD:
 * `markdown` at -0.50, `newline` at 0.21, `phrasal` at -0.60, `backticks`
 * at -1.34, `blockquotes` at -1.55, and the name `Clippy` at -1.37. This
 * list adds them by hand, checked against this repository's own good
 * prose files.
 *
 * `cannot` is a separate case, a corpus glitch rather than a domain gap.
 * It sits at rank 106,595 with 88,737 occurrences, log frequency -0.82,
 * below ordinary words such as `markdown` and `ampersand`. Every other
 * common modal verb ranks in the hundreds. This list carries it too, with
 * this note as the record of why.
 *
 * `enforcement/INSTALL-PROMPT.md` is a strict-tier file in the good set.
 * Hard-word runs at error severity there. It surfaced five more ordinary
 * words that score under the line for the same reason. Their scores run
 * from -0.58 up to 0.26. That range sits too close to a genuinely hard
 * word such as `ontological`, at -0.12. The threshold alone cannot tell
 * them apart, so this list carries them too.
 */
const DOMAIN_ALLOWLIST = new Set([
  'markdown', 'newline', 'phrasal', 'backticks', 'blockquotes', 'clippy',
  'cannot', 'ratchet', 'caveman', 'reinstate', 'unacknowledged', 'overwrite',
]);

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

function severityFor(tier) {
  return tier === 'strict' ? 'error' : 'warn';
}

/**
 * Suffix and replacement pairs used to guess a candidate base form. Each
 * entry pairs an inflected ending with the text that rebuilds the root.
 * The list only needs to cover common English patterns. A wrong guess
 * costs nothing, because the caller keeps the highest frequency found
 * among the word and every candidate.
 */
// Order does not matter here. Each pair is tried against word on its own.
const SUFFIX_RULES = [
  ['ies', 'y'],
  ['ves', 'fe'],
  ['ves', 'f'],
  ['ing', 'e'],
  ['ing', ''],
  ['es', ''],
  ['ed', 'e'],
  ['ed', ''],
  ['ly', ''],
  ['d', ''],
  ['s', ''],
];

/** Drop one letter off a doubled consonant ending, as in "resett" to "reset". */
function undoubleConsonant(base) {
  const last = base[base.length - 1];
  const prev = base[base.length - 2];
  if (last && last === prev && !'aeiou'.includes(last)) return base.slice(0, -1);
  return null;
}

/**
 * Guess candidate base forms for word from ordinary English suffix rules.
 * A candidate may not be a real word. The caller takes the highest known
 * frequency among the word and its candidates. A wrong guess is harmless,
 * because it can never make a word look harder than it is.
 */
export function baseWordForms(word) {
  const lower = word.toLowerCase();
  const candidates = new Set();
  for (const [suffix, replace] of SUFFIX_RULES) {
    if (lower.length <= suffix.length || !lower.endsWith(suffix)) continue;
    const base = lower.slice(0, -suffix.length) + replace;
    if (base.length === 0) continue;
    candidates.add(base);
    const undoubled = undoubleConsonant(base);
    if (undoubled) candidates.add(undoubled);
  }
  return [...candidates];
}

/**
 * Highest known log frequency among word and its guessed base forms.
 * A reader who knows the base form finds the inflected form just as easy,
 * so the base form is what should decide difficulty. Returns null only
 * when no frequency table is loaded at all.
 */
function bestLogFrequency(word) {
  const direct = logFrequency(word);
  if (direct === null) return null;
  let best = direct;
  for (const candidate of baseWordForms(word)) {
    const freq = logFrequency(candidate);
    if (freq !== null && freq > best) best = freq;
  }
  return best;
}

/**
 * Find every hard word in block and return violations in the shape the
 * linter uses. Returns an empty array when no frequency table is loaded.
 * It never throws, because with no table there is no evidence to flag on.
 *
 * A word absent from the table floors at OOV_FLOOR and never flags. The
 * table reads a 2006 crawl, so absence marks a young word, not a hard one.
 * Most of the confirmed false hits, `linter`, `tweakcc`, `CustomClaude`,
 * and others, are exactly this case. Step S08 chose this fix over a
 * longer allowlist or a second check on word length. DOMAIN_ALLOWLIST
 * above still catches the handful of real, non-floored entries that need
 * it.
 */
export function hardWordRule(block, tier) {
  if (!hasTable()) return [];
  const sev = severityFor(tier);
  const found = [];

  WORD_PATTERN.lastIndex = 0;
  let m;
  while ((m = WORD_PATTERN.exec(block.text)) !== null) {
    const word = m[0];
    if (word.length < MIN_HARD_WORD_LENGTH) continue;
    if (DOMAIN_ALLOWLIST.has(word.toLowerCase())) continue;
    if (looksLikeProperNoun(word, block.text, m.index)) continue;
    if (looksLikeEntityName(word, block.text, m.index)) continue;

    const freq = bestLogFrequency(word);
    if (freq === null || freq === OOV_FLOOR || freq > HARD_WORD_THRESHOLD) continue;

    found.push({
      line: lineOf(block, m.index),
      rule: 'hard-word',
      sev,
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
 * document's own average. Step S08 measured the one strict-tier file in
 * the corpus that must pass, `enforcement/INSTALL-PROMPT.md`. Its hardest
 * block scores grade 11.52, 1.26 standard deviations above average. This
 * ceiling sits well above that block.
 */
export const READABILITY_CEILING_STRICT = 14; // BASE + W * 2.5 standard deviations.

/**
 * Combined-difficulty ceiling for the flavored tier, in grades, under the
 * standardized scale in readability.mjs.
 *
 * Step S08 measured every flavored-tier file in the corpus that must pass.
 * Its hardest block, a README bullet, scores grade 15.92, 3.46 standard
 * deviations above average. Probe 1 from the task brief, six sentences of
 * pure jargon, scores grade 17.03, 4.01 standard deviations. This ceiling
 * sits between the two, with more than half a grade of room on each side.
 */
export const READABILITY_CEILING_FLAVORED = 16.5; // BASE + W * 3.75 standard deviations.

/**
 * A block below this many words is skipped. A short block gives the score
 * too little text to average over, so the result would read as noise
 * rather than a real signal.
 *
 * Step S08 measured a 15 word sentence built entirely from invented, rare
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

function readabilityMessage(measure, ceiling, tier) {
  const grade = measure.combinedDifficulty.toFixed(2);
  const advice = driverAdvice(dominantDriver(measure));
  const note = degradedNote(measure.degraded);
  return `Readability grade is ${grade}, ceiling for ${tier} is ${ceiling.toFixed(2)}.${note} ${advice}`;
}

/**
 * Score block as a whole and report one violation when it reads harder
 * than tier allows. A block that fails on both long sentences and rare
 * words still gets one report, because a hard paragraph is one problem.
 * Never throws, so a scoring surprise cannot block every write.
 */
export function readabilityRule(block, tier) {
  try {
    if (block.heading) return [];
    const sentences = splitSentences(block.text).map((s) => s.text);
    const measure = textMeasure(sentences);
    if (measure.wordCount < MIN_READABILITY_WORDS) return [];
    if (measure.combinedDifficulty === null) return [];
    const ceiling = ceilingFor(tier);
    if (measure.combinedDifficulty <= ceiling) return [];

    return [{
      line: lineOf(block, 0),
      rule: 'readability',
      sev: 'error',
      msg: readabilityMessage(measure, ceiling, tier),
    }];
  } catch {
    return [];
  }
}
