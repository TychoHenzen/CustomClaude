/**
 * rules-prose - the sentence and punctuation rules.
 *
 * The em dash rule reads the raw text rather than the blanked copy. A quoted
 * span does not shield that character. The reason is byte corruption on
 * re-encode rather than style.
 */

import { splitSentences } from './ste-lint.mjs';
import { wordCount } from './sentence-split.mjs';

const CAP_STRICT = 20;
const CAP_FLAVORED = 25;

const AMPERSAND = String.fromCharCode(38);
const CLOSER = String.fromCharCode(59);
const EM_DASH = String.fromCharCode(0x2014);

/** The named and numeric entity bodies that stand for an em dash. */
const DASH_ENTITIES = ['mdash', 'emdash', '#8212', '#x2014'];

const DASH_PATTERN = new RegExp(
  `${EM_DASH}|${AMPERSAND}(?:${DASH_ENTITIES.join('|')})${CLOSER}`,
  'gi',
);

/** An entity body sitting right in front of the mark, as in `&amp`. The
 *  body runs 31 characters at most, and a hash may only open it. */
const ENTITY_HEAD = new RegExp(
  `${AMPERSAND}(?:#[A-Za-z0-9]{1,30}|[A-Za-z0-9]{1,31})$`,
);

const DASH_ADVICE = 'em dash is banned on this machine, it corrupts on '
  + 're-encode. Use -.';

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
      sev: 'error',
      msg: `sentence is ${words} words, cap is ${cap}. Split it.`,
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
        sev: 'error',
        msg: 'no semicolons. Write two sentences.',
      });
    }
    at = block.text.indexOf(CLOSER, at + 1);
  }
  return found;
}

/**
 * Report the em dash in the raw text, in each of its five spellings. A
 * line that carries several of them still reports once, because the
 * writer reads the line and fixes them all at one go.
 */
export function punctuationRule(text) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    if (!line.match(DASH_PATTERN)) return;
    found.push({
      line: index + 1,
      rule: 'punctuation',
      sev: 'error',
      msg: DASH_ADVICE,
    });
  });
  return found;
}
