/**
 * word-forms - guesses the base form of an English word and looks up how
 * common it is.
 *
 * The hard-word rule and the language gate both need this. Neither can call
 * the other, because the language gate runs first and the hard-word rule
 * runs only when the gate says the text is English. Keeping the shared part
 * here leaves both modules with a one-way import.
 *
 * The guess covers two kinds of word building. An inflection marks tense or
 * number and leaves the word itself alone: `disclaims` is `disclaim`. A
 * derivation builds a new word from an old one: `profiler` is `profile` plus
 * `-er`, and `subagent` is `agent` plus `sub-`. A reader who knows the base
 * reads either form without help, so both kinds reduce to the base here.
 */

import { logFrequency } from './word-freq.mjs';

/**
 * Log frequency at or below which a word counts as rare.
 *
 * An earlier step checked this value against the words the owner named as
 * still hard. Four words qualify: `epistemological`, `thoroughgoing`,
 * `hermeneutic`, and `ontological`. All four score below 0.3, from -0.12
 * down to -1.09. All four still get caught. A common technical word such as
 * `parser` scores 0.82, above the line, and stays clear. This value did not
 * change from its earlier guess. The corpus check confirmed it, rather than
 * finding a need to fix it.
 */
export const HARD_WORD_THRESHOLD = 0.3;

/**
 * Suffix and replacement pairs used to guess a candidate base form. Each
 * entry pairs an ending with the text that rebuilds the root. The list only
 * needs common English patterns. A wrong guess costs nothing. The caller
 * keeps the highest frequency found among the word and every candidate.
 *
 * The first group marks tense or number. The second group builds one word
 * from another. Before that second group existed, `profiler` scored 0.13
 * and `forgery` scored 0.08. Both sat under the threshold above, while
 * their bases `profile` and `forge` score 2.54 and 0.95.
 */
// Order does not matter here. Each pair is tried against the word on its own.
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
  ['er', ''],
  ['er', 'e'],
  ['or', ''],
  ['or', 'e'],
  ['ery', ''],
  ['ery', 'e'],
  ['ary', ''],
  ['able', ''],
  ['able', 'e'],
  ['ible', 'e'],
  ['ility', 'e'],
  ['ility', 'le'],
  ['ness', ''],
  ['ment', ''],
  ['ation', 'ate'],
  ['ation', 'e'],
  ['ition', 'e'],
  ['ion', 'e'],
  ['ion', ''],
  ['ive', 'e'],
  ['ive', ''],
  ['ical', ''],
  ['ic', ''],
  ['ist', ''],
  ['ism', ''],
  ['ize', ''],
  ['ise', ''],
  ['ful', ''],
  ['less', ''],
  ['ity', 'e'],
  ['ity', ''],
];

/**
 * Prefixes that change a word's sense but not the base a reader needs to
 * know. Stripping one is a guess like any other here. A prefix that opens
 * an unrelated word does no harm. `interest` becomes `est`. The table does
 * not hold that, so the guess is dropped.
 */
const PREFIXES = [
  'un', 're', 'non', 'pre', 'post', 'sub', 'super', 'over', 'under', 'de',
  'dis', 'mis', 'anti', 'inter', 'multi', 'semi', 'co', 'auto', 'down', 'up',
];

/** Shortest a stripped stem may be before it stops looking like a word. */
const MIN_STEM_LENGTH = 3;

/** How many rounds of suffix stripping to run. Two rounds reach a base
 *  that carries an inflection over a derivation, as `orchestrators` does. */
const SUFFIX_ROUNDS = 2;

/** Drop one letter off a doubled consonant ending, as in `resett` to `reset`. */
function undoubleConsonant(base) {
  const last = base[base.length - 1];
  const prev = base[base.length - 2];
  if (last && last === prev && !'aeiou'.includes(last)) return base.slice(0, -1);
  return null;
}

/** Every stem one suffix rule can build from word, plus undoubled forms. */
function stripSuffixes(word) {
  const out = [];
  for (const [suffix, replace] of SUFFIX_RULES) {
    if (word.length <= suffix.length || !word.endsWith(suffix)) continue;
    const base = word.slice(0, -suffix.length) + replace;
    if (base.length < MIN_STEM_LENGTH) continue;
    out.push(base);
    const undoubled = undoubleConsonant(base);
    if (undoubled && undoubled.length >= MIN_STEM_LENGTH) out.push(undoubled);
  }
  return out;
}

/** Every stem one prefix strip can build from word. */
function stripPrefixes(word) {
  const out = [];
  for (const prefix of PREFIXES) {
    if (!word.startsWith(prefix)) continue;
    const stem = word.slice(prefix.length);
    if (stem.length < MIN_STEM_LENGTH) continue;
    out.push(stem);
  }
  return out;
}

/** Grow seeds by SUFFIX_ROUNDS rounds of suffix stripping, into found. */
function expandSuffixes(seeds, found) {
  let frontier = seeds;
  for (let round = 0; round < SUFFIX_ROUNDS; round++) {
    const next = [];
    for (const stem of frontier) {
      for (const base of stripSuffixes(stem)) {
        if (found.has(base)) continue;
        found.add(base);
        next.push(base);
      }
    }
    if (next.length === 0) return;
    frontier = next;
  }
}

/**
 * Guess candidate base forms for word from ordinary English word building.
 * A candidate may not be a real word. The caller takes the highest known
 * frequency among the word and its candidates. A wrong guess is harmless,
 * because it can never make a word look harder than it is.
 */
export function baseWordForms(word) {
  const lower = word.toLowerCase();
  const found = new Set(stripPrefixes(lower));
  expandSuffixes([lower, ...found], found);
  found.delete(lower);
  return [...found];
}

/**
 * Highest known log frequency among word and its guessed base forms.
 * A reader who knows the base form finds the built form just as easy. So
 * the base form is what decides difficulty here. Returns null only when no
 * frequency table is loaded at all.
 *
 * A word already above HARD_WORD_THRESHOLD returns straight away. Both
 * callers only ask which side of that line a word falls on. Skipping the
 * guesses there keeps the common case to a single table lookup.
 */
export function bestLogFrequency(word) {
  const direct = logFrequency(word);
  if (direct === null || direct > HARD_WORD_THRESHOLD) return direct;
  let best = direct;
  for (const candidate of baseWordForms(word)) {
    const freq = logFrequency(candidate);
    if (freq !== null && freq > best) best = freq;
  }
  return best;
}
