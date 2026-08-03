/**
 * word-forms - guesses the base form of an English word and looks up how
 * common it is.
 *
 * The hard-word rule and the language gate both need this. Neither can call
 * the other, because the language gate runs first and the hard-word rule
 * runs only when the gate says the text is English. Keeping the shared part
 * here leaves both modules with a one-way import.
 */

import { logFrequency } from './word-freq.mjs';

/**
 * Log frequency at or below which a word counts as rare.
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
export function bestLogFrequency(word) {
  const direct = logFrequency(word);
  if (direct === null) return null;
  let best = direct;
  for (const candidate of baseWordForms(word)) {
    const freq = logFrequency(candidate);
    if (freq !== null && freq > best) best = freq;
  }
  return best;
}
