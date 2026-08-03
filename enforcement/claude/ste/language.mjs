/**
 * language - decides whether a prose block is written in English.
 *
 * Every vocabulary rule in this linter is English by construction. The word
 * frequency table reads an English crawl. The syllable count follows English
 * spelling. The suffix rules undo English inflections. The slop and filler
 * lists hold English phrases.
 *
 * Run those rules on Portuguese or German and every ordinary word scores as
 * rare. That pushes the readability grade past the ceiling and blocks the
 * write. It is a category error, not a threshold to tune. So the fix is to
 * skip those rules on text that is not English.
 *
 * Detection reads two signals, and a block must fail both to count as
 * another language. One signal alone is not enough. Function words alone
 * misread the terse list style this machine writes, where a whole block can
 * hold no function word at all. Word rarity alone misreads a block of
 * product names. Together they separated cleanly on every text measured.
 */

import { bestLogFrequency, HARD_WORD_THRESHOLD } from './word-forms.mjs';
import { OOV_FLOOR } from './word-freq.mjs';

/**
 * English function words used as the first signal.
 *
 * Each entry had to be common in English and rare as a whole word in the
 * languages this machine actually writes. That rules out several obvious
 * candidates. `in`, `a`, and `no` are ordinary Portuguese and Spanish. `was`
 * means what in German, `will` means wants, and `her` means here. Dropping
 * them costs a little English signal and buys a lot of separation.
 */
const FUNCTION_WORDS = new Set([
  'the', 'of', 'and', 'to', 'that', 'it', 'with', 'for', 'this', 'from',
  'they', 'them', 'their', 'there', 'these', 'those', 'have', 'has', 'had',
  'are', 'is', 'been', 'being', 'but', 'not', 'you', 'all', 'any', 'can',
  'when', 'what', 'which', 'while', 'where', 'why', 'how', 'does', 'did',
  'into', 'than', 'then', 'its', 'were', 'should', 'could', 'would', 'about',
  'after', 'before', 'because', 'only', 'other', 'some', 'such', 'each',
  'every', 'both', 'more', 'most', 'must', 'may', 'might', 'out', 'over',
  'under', 'through', 'first', 'still', 'never', 'always', 'here', 'him',
  'his', 'she', 'who', 'whom', 'whose', 'above', 'below', 'between',
]);

const WORD_PATTERN = /[A-Za-z][A-Za-z']*/g;

/** A word shorter than this many letters is ignored by the rarity signal. */
const MIN_CONTENT_WORD_LENGTH = 4;

/**
 * Function word share below which a block gives up its first signal.
 *
 * Measured over 22817 English blocks, taken from every markdown file under
 * this machine's Claude directory and the CustomClaude repository. Most sit
 * far above this line. About one block in nine falls below it, nearly all of
 * them terse bullet lists. Hand-written samples in Portuguese, Spanish,
 * German, French, and Dutch all scored 0.000.
 */
export const ENGLISH_FUNCTION_WORD_FLOOR = 0.12;

/**
 * Rare word share at or above which a block gives up its second signal.
 *
 * Over the same corpus, no English block that fell below the function word
 * floor reached 0.43. The foreign samples ran from 0.579 to 0.938. This
 * value sits in the empty band between those two groups.
 */
export const FOREIGN_RARE_WORD_SHARE = 0.5;

/**
 * A block with fewer word tokens than this is assumed English.
 *
 * A short block gives both signals too little to work with. One English
 * fragment of four nouns can score zero function words by chance. Assuming
 * English there keeps the old behavior for short text. So this gate can only
 * turn rules off on evidence, never on noise.
 */
export const MIN_TOKENS_FOR_DETECTION = 12;

/**
 * A block whose rarity signal rests on fewer known words than this reads as
 * `unknown`.
 *
 * A block of product names or field labels holds few words the table knows,
 * so its rare share swings on two or three lookups. Three code comments in
 * the measured corpus read as foreign at a floor of 7, all of them label
 * lists rather than sentences. This floor is high on purpose. A short block
 * that lands on `unknown` is not lost, because the caller falls back to the
 * language of the whole file.
 */
export const MIN_KNOWN_WORDS_FOR_DETECTION = 10;

function tokens(text) {
  return text.match(WORD_PATTERN) || [];
}

/** Share of word tokens in text that are English function words. */
export function englishFunctionWordRatio(text) {
  const words = tokens(text);
  if (words.length === 0) return 0;
  const hits = words.filter((w) => FUNCTION_WORDS.has(w.toLowerCase())).length;
  return hits / words.length;
}

/**
 * Share of the content words in text that the frequency table scores as
 * rare, and how many content words that share rests on.
 *
 * A word the table does not hold at all is left out of both counts. Absence
 * marks a young software term, not a foreign word, because the table reads a
 * crawl from 2006. Counting those would make a page of tool names look
 * foreign.
 */
export function rareWordShare(text) {
  const known = tokens(text)
    .filter((w) => w.length >= MIN_CONTENT_WORD_LENGTH)
    .map(bestLogFrequency)
    .filter((freq) => freq !== null && freq !== OOV_FLOOR);
  if (known.length === 0) return { share: null, known: 0 };
  const rare = known.filter((freq) => freq <= HARD_WORD_THRESHOLD).length;
  return { share: rare / known.length, known: known.length };
}

/**
 * Read the language of text as `english`, `foreign`, or `unknown`.
 *
 * `unknown` means the text held too little evidence to decide, not that it
 * looked like neither. A heading of three words lands there, and so does a
 * one-line list item. The caller decides what to do with those. It should
 * never treat `unknown` as `foreign` on its own.
 */
export function detectEnglish(text) {
  if (tokens(text).length < MIN_TOKENS_FOR_DETECTION) return 'unknown';
  if (englishFunctionWordRatio(text) >= ENGLISH_FUNCTION_WORD_FLOOR) return 'english';
  const { share, known } = rareWordShare(text);
  if (known < MIN_KNOWN_WORDS_FOR_DETECTION) return 'unknown';
  return share >= FOREIGN_RARE_WORD_SHARE ? 'foreign' : 'english';
}

/**
 * True unless text is clearly not English. Text with too little evidence
 * counts as English, so this gate can only turn rules off on evidence.
 */
export function isEnglish(text) {
  return detectEnglish(text) !== 'foreign';
}
