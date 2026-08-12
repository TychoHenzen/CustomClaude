/**
 * vocabulary - the words and phrases the checker bans, with the advice it
 * gives for each one.
 *
 * Every entry is data. The rules that read it live in rules-vocabulary.mjs.
 */

/** The banned word, then what to write instead. */
export const BANNED_WORDS = [
  ['seamless', 'say what actually happens'],
  ['robust', 'say what it survives'],
  ['powerful', 'say what it does'],
  ['cutting-edge', 'drop it'],
  ['effortless', 'drop it'],
  ['world-class', 'drop it'],
  ['next-generation', 'drop it'],
  ['revolutionary', 'drop it'],
  ['game-changer', 'drop it'],
  ['game-changing', 'drop it'],
  ['blazing fast', 'give the number'],
  ['blazingly fast', 'give the number'],
  ['leverage', 'use'],
  ['utilize', 'use'],
  ['facilitate', 'help'],
  ['seek to', 'try to'],
  ['delve into', 'read'],
  ['unlock', 'say what it enables'],
  ['elevate', 'say what improves'],
  ['streamline', 'simplify'],
  ['holistic', 'say what it covers'],
  ['paradigm', 'say the actual approach'],
  ['synergy', 'drop it'],
  ['synergies', 'drop it'],
  ['synergistic', 'drop it'],
  ['best-in-class', 'drop it'],
  ['state-of-the-art', 'drop it'],
  ['comprehensive', 'say what it includes'],
  ['plethora', 'many'],
  ['myriad', 'many'],
];

/** A trailing form the checker also matches on a banned word. */
export const INFLECTIONS = '(?:s|es|d|ed|ing)?';

/** These two also read as an adverb. No other entry does. */
export const ADVERB_WORDS = new Set(['seamless', 'effortless']);

const CURLY_MARK = String.fromCharCode(0x2019);

/** Openers that carry no fact. Each entry is a pattern source. */
const OPENERS = [
  'it is important to note that',
  'it should be noted that',
  'it is worth noting that',
  'please note that',
  'it is worth mentioning that',
  'needless to say',
  'as we can see',
  'we can see that',
  'in conclusion',
  'at the end of the day',
  'when it comes to',
  `in today['${CURLY_MARK}]s.{0,20}world`,
  'let us dive in',
  'buckle up',
];

export const OPENER_PATTERN = new RegExp(
  `\\b(?:${OPENERS.map((source) => source.replace(/ /g, '\\s+')).join('|')})`,
  'gi',
);

/** A verb hidden inside a noun, as in `perform an analysis of the log`. */
export const NOMINALIZATION_PATTERN = new RegExp(
  '\\b(?:perform|conduct|carry\\s+out|provide|make)\\s+(?:a|an|the)\\s+'
  + '\\w*(?:ation|ysis|ment|ance|ence|ing)\\b',
  'gi',
);

/** An existential opener, as in `there is a bug`. */
export const WEAK_OPENER_PATTERN = new RegExp(
  '\\bthere\\s+(?:is|are|was|were)\\s+(?:a|an|no|some|many|several)\\b',
  'gi',
);

/**
 * Adverbs that pass a verdict on work. The style asks for what happened,
 * not for a grade on it. Write "the rule matched seven pieces of prose".
 * Drop the adverb that grades the match.
 *
 * `properly` and `cleanly` are missing on purpose. Both carry their weight
 * in ordinary instruction prose, as in `shut the handle cleanly`, so
 * flagging them would cost more than it buys.
 */
const GRADING_ADVERBS = ['correctly', 'successfully', 'perfectly', 'flawlessly'];

/** Phrases that grade without an adverb. */
const GRADING_PHRASES = ['as expected', 'works great', 'a real defect', 'a real bug'];

/**
 * A pattern for phrase that reads a leading capital as well, and any run of
 * white space between its words.
 *
 * This rule cannot run case-insensitive. It tells a verb from an
 * abbreviation by looking for one small letter, and the insensitive flag
 * makes every letter small. So each word carries its own capital instead.
 */
function eitherCase(phrase) {
  const spaced = phrase.replace(/ /g, '\\s+');
  return `[${spaced[0].toUpperCase()}${spaced[0]}]${spaced.slice(1)}`;
}

const ADVERB_GROUP = GRADING_ADVERBS.map(eitherCase).join('|');

/** How far behind its verb a grading adverb may sit and still count, as in
 *  `reads it correctly`. The span never crosses a sentence end. */
const OBJECT_GAP = '[^.!?]{0,15}?';

/**
 * A grading adverb counts only where it lands on a verb. One example is the
 * adverb in front of a past-tense verb. Another is the same adverb one short
 * object behind its verb. The bare adverb alone reports too much. It fires
 * on a question that grades nothing and asks something.
 *
 * A verb here is a word ending in `ed`, `es`, or `s` that carries at least
 * one small letter. No tagger stands behind that, the same way no tagger
 * stands behind rules-syntax.mjs. The small letter keeps an abbreviation out
 * of the verb slot, so `would a TTS read it correctly` reports nothing.
 */
const VERBISH = '\\b(?=\\w*[a-z])\\w+(?:ed|es|s)\\b';

export const SELF_GRADE_PATTERN = new RegExp(
  `\\b(?:${ADVERB_GROUP})\\s+${VERBISH}`
  + `|${VERBISH}${OBJECT_GAP}\\s(?:${ADVERB_GROUP})\\b`
  + `|\\b(?:${GRADING_PHRASES.map(eitherCase).join('|')})\\b`,
  'g',
);
