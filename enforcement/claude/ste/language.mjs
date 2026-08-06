/**
 * language - decides whether a block of text is English.
 *
 * Word rarity, hard words, readability, noun stacks and clause pileups only
 * mean anything on English. On Portuguese or German every ordinary word
 * measures as rare, so the block would fail for the wrong reason.
 *
 * Two questions run in order. Do another language's function words carry
 * this text. If not, do English function words carry it, and failing that,
 * are its words rare. The first question reads positive evidence and settles
 * a text that mixes a language with code. The other two read the absence of
 * English evidence, and neither one is enough alone. Function words alone
 * misread the terse list style this machine writes. Word commonness alone
 * misreads a block of product names.
 */

import { bestForeignShare } from './foreign-words.mjs';
import { bestLogFrequency, HARD_WORD_THRESHOLD } from './word-forms.mjs';
import { OOV_FLOOR } from './word-freq.mjs';

/**
 * Each entry is common in English and rare as a whole word in the languages
 * this machine writes. That ruled out obvious candidates. `in`, `a` and `no`
 * are ordinary Portuguese and Spanish. `was`, `will` and `her` are ordinary
 * German words meaning what, wants and here. Dropping them costs a little
 * English signal and buys a lot of separation.
 */
const FUNCTION_WORDS = new Set(`
the of and to that it with for this from they them their there
these those have has had are is been being but not you all any
can when what which while where why how does did into than then
its were should could would about after before because only other some such
each every both more most must may might out over under through first
still never always here him his she who whom whose above below between
`.trim().split(/\s+/));

/**
 * Share of word occurrences that must be function words for English. Measured
 * over 22817 English blocks, from every markdown file under the user's Claude
 * directory and the CustomClaude repository. Most sit far above this line.
 * About one block in nine falls below it, nearly all of them terse bullet
 * lists. Portuguese, Spanish, German, French and Dutch samples measured 0.000.
 */
const FUNCTION_WORD_SHARE = 0.12;

/**
 * Share of word occurrences that must belong to one other language before
 * that language wins the text. Measured over 3912 English blocks, from every
 * markdown file under the user's Claude directory and the CustomClaude
 * repository. The highest of them reached 0.042. A Dutch commit body written
 * around C# identifiers, the case this test exists for, reached 0.183. This
 * line sits in the gap between them.
 */
const FOREIGN_WORD_SHARE = 0.08;

/**
 * Share of recognized words that must be rare for a foreign verdict. Over the
 * same corpus, no English block below the function word line reached 0.43.
 * The foreign samples ran from 0.579 to 0.938, so this sits in the gap.
 */
const RARE_SHARE = 0.5;

/**
 * Fewest word occurrences needed to judge a text at all. One English fragment
 * of four nouns can hold zero function words by chance, and calling that
 * foreign would turn rules off on noise.
 */
const MIN_WORDS = 12;

/**
 * Fewest table-recognized words needed for the commonness evidence. At a
 * lower bound of 7, three code comments in the corpus read as foreign, all of
 * them label lists. A block that lands on 'unknown' is not lost, because the
 * caller falls back to the verdict for the whole file.
 */
const MIN_RECOGNIZED = 10;

/**
 * A word starts with an ASCII letter and runs on through letters and
 * apostrophes. A trailing apostrophe stays part of the word. The frequency
 * table strips it before every lookup, so keeping it only affects the length
 * test below, where a quoted short word still earns its place.
 */
const WORD_PATTERN = /[A-Za-z][A-Za-z']*/g;

/**
 * How common word is, or null when it carries no commonness evidence. Words
 * under four letters carry none. The table reads a 2006 crawl, so absence
 * marks a young software term, not a foreign word. Counting absent words as
 * rare would make a page of tool names look foreign.
 */
function tableScore(word) {
  if (word.length < 4) return null;
  const score = bestLogFrequency(word);
  if (score === null || score === OOV_FLOOR) return null;
  return score;
}

/** With no table loaded every lookup is null, so this answers 'unknown'. */
function rarityVerdict(words) {
  const scores = words
    .map((word) => tableScore(word))
    .filter((score) => score !== null);
  if (scores.length < MIN_RECOGNIZED) return 'unknown';
  const rare = scores.filter((score) => score <= HARD_WORD_THRESHOLD).length;
  return rare / scores.length >= RARE_SHARE ? 'foreign' : 'english';
}

/**
 * True when one other language carries more of words than English does, by
 * enough to rule out an English text that quotes a foreign phrase.
 */
function readsForeign(words, englishShare) {
  const best = bestForeignShare(words);
  return best.share >= FOREIGN_WORD_SHARE && best.share > englishShare;
}

/**
 * One of 'english', 'foreign' or 'unknown' for text. Enough function words on
 * either side settle it without any lookup, because lookups are the expense
 * here.
 */
export function detectEnglish(text) {
  const found = text.match(WORD_PATTERN) ?? [];
  if (found.length < MIN_WORDS) return 'unknown';
  const words = found.map((word) => word.toLowerCase());
  const hits = words.filter((word) => FUNCTION_WORDS.has(word)).length;
  const englishShare = hits / words.length;
  if (readsForeign(words, englishShare)) return 'foreign';
  if (englishShare >= FUNCTION_WORD_SHARE) return 'english';
  return rarityVerdict(words);
}
