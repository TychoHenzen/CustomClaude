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
