/**
 * rules-prose - the sentence and punctuation rules.
 *
 * The punctuation rule reads the raw text rather than the blanked copy. A
 * quoted span does not shield these characters. The reason is byte
 * corruption on re-encode rather than style. This machine reads UTF-8 back
 * as cp1252, and every one of them comes back wrong.
 */

import { splitSentences } from './ste-lint.mjs';
import { wordCount } from './sentence-split.mjs';
import { quoteSentence } from './rule-classes.mjs';

const CAP_STRICT = 20;
const CAP_FLAVORED = 25;

const AMPERSAND = String.fromCharCode(38);
const CLOSER = String.fromCharCode(59);

/** Each mark the writer may not type, with the entity bodies that stand for
 *  it and the ASCII to write instead. Every character is built rather than
 *  typed, so this file never trips its own rule. */
const BANNED_MARKS = [
  {
    name: 'em dash',
    chars: [0x2014],
    entities: ['mdash', 'emdash', '#8212', '#x2014'],
    ascii: '-',
  },
  {
    name: 'en dash',
    chars: [0x2013],
    entities: ['ndash', '#8211', '#x2013'],
    ascii: '-',
  },
  {
    name: 'curly quote',
    chars: [0x2018, 0x2019, 0x201C, 0x201D],
    entities: [
      'lsquo', 'rsquo', 'ldquo', 'rdquo',
      '#8216', '#8217', '#8220', '#8221',
      '#x2018', '#x2019', '#x201c', '#x201d',
    ],
    ascii: `" or '`,
  },
  {
    name: 'ellipsis character',
    chars: [0x2026],
    entities: ['hellip', '#8230', '#x2026'],
    ascii: '...',
  },
  {
    name: 'arrow',
    chars: [0x2190, 0x2192, 0x2194, 0x21D0, 0x21D2, 0x21D4],
    entities: [
      'larr', 'rarr', 'harr', 'lArr', 'rArr', 'hArr',
      '#8592', '#8594', '#8596', '#8656', '#8658', '#8660',
      '#x2190', '#x2192', '#x2194', '#x21d0', '#x21d2', '#x21d4',
    ],
    ascii: '->',
  },
];

function patternForMark(mark) {
  const literals = mark.chars.map((code) => String.fromCharCode(code));
  const entities = `${AMPERSAND}(?:${mark.entities.join('|')})${CLOSER}`;
  return new RegExp(`${literals.join('|')}|${entities}`, 'gi');
}

const MARK_PATTERNS = BANNED_MARKS.map((mark) => ({
  pattern: patternForMark(mark),
  advice: `${mark.name} is banned on this machine, it corrupts on `
    + `re-encode. Use ${mark.ascii}.`,
}));

/** An entity body sitting right in front of the mark, as in `&amp`. The
 *  body runs 31 characters at most, and a hash may only open it. */
const ENTITY_HEAD = new RegExp(
  `${AMPERSAND}(?:#[A-Za-z0-9]{1,30}|[A-Za-z0-9]{1,31})$`,
);

function lineOf(block, offset) {
  const before = block.text.slice(0, offset);
  return block.line + (before.match(/\n/g) || []).length + 1;
}

/** Report every sentence that runs past the cap for this tier. */
export function longSentenceRule(block, tier) {
  if (block.heading) return [];
  const cap = tier === 'strict' ? CAP_STRICT : CAP_FLAVORED;
  const found = [];
  for (const part of splitSentences(block.text)) {
    const words = wordCount(part.text);
    if (words <= cap) continue;
    found.push({
      line: lineOf(block, part.offset),
      rule: 'long-sentence',
      msg: `sentence is ${words} words, cap is ${cap}. Split it. `
        + `Rewrite this sentence: ${quoteSentence(part.text)}`,
    });
  }
  return found;
}

/** Report every mark that is not the tail of an HTML entity. */
export function semicolonRule(block) {
  if (block.heading) return [];
  const found = [];
  let at = block.text.indexOf(CLOSER);
  while (at !== -1) {
    if (!ENTITY_HEAD.test(block.text.slice(0, at))) {
      found.push({
        line: lineOf(block, at),
        rule: 'semicolon',
        msg: 'no semicolons. Write two sentences.',
      });
    }
    at = block.text.indexOf(CLOSER, at + 1);
  }
  return found;
}

/**
 * Report every banned mark in the raw text, in each of its spellings.
 *
 * A line that carries one mark four times still reports it once. The writer
 * reads the line and fixes all four at one go.
 */
export function punctuationRule(text) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    for (const { pattern, advice } of MARK_PATTERNS) {
      pattern.lastIndex = 0;
      if (!pattern.test(line)) continue;
      found.push({ line: index + 1, rule: 'punctuation', msg: advice });
    }
  });
  return found;
}
