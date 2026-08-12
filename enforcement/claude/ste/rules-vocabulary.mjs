/**
 * rules-vocabulary - the word choice rules.
 *
 * Each one reads a block and names the exact phrase it wants changed, so the
 * writer never has to guess which words tripped it.
 */

import {
  ADVERB_WORDS, BANNED_WORDS, INFLECTIONS, NOMINALIZATION_PATTERN,
  OPENER_PATTERN, SELF_GRADE_PATTERN, WEAK_OPENER_PATTERN,
} from './vocabulary.mjs';

/** A writer spells a compound with a hyphen or with a space, so the
 *  pattern takes either one. The message quotes what the writer wrote. */
function patternFor(word) {
  const body = word.replace(/ /g, '\\s+').replace(/-/g, '[- ]');
  const tail = ADVERB_WORDS.has(word) ? '(?:ly|s|es|d|ed|ing)?' : INFLECTIONS;
  return new RegExp(`\\b${body}${tail}\\b`, 'gi');
}

const BANNED_PATTERNS = BANNED_WORDS.map(([word, advice]) => [
  patternFor(word), advice,
]);

function lineOf(block, offset) {
  const before = block.text.slice(0, offset);
  return block.line + (before.match(/\n/g) || []).length + 1;
}

/** Every hit of pattern in block, described by the caller. */
function findAll(block, pattern, describe) {
  const found = [];
  pattern.lastIndex = 0;
  let hit = pattern.exec(block.text);
  while (hit !== null) {
    found.push({ line: lineOf(block, hit.index), ...describe(hit[0]) });
    hit = pattern.exec(block.text);
  }
  return found;
}

function bannedWordFindings(block) {
  const found = [];
  for (const [pattern, advice] of BANNED_PATTERNS) {
    found.push(...findAll(block, pattern, (hit) => ({
      rule: 'slop-word',
      msg: `"${hit}" - ${advice}.`,
    })));
  }
  return found;
}

/** Every word choice violation in block. */
export function vocabularyRules(block) {
  return [
    ...bannedWordFindings(block),
    ...findAll(block, OPENER_PATTERN, (hit) => ({
      rule: 'filler',
      msg: `"${hit}" - delete it, state the fact.`,
    })),
    ...findAll(block, NOMINALIZATION_PATTERN, (hit) => ({
      rule: 'nominalization',
      msg: `"${hit}" - use the verb directly.`,
    })),
    ...findAll(block, WEAK_OPENER_PATTERN, (hit) => ({
      rule: 'weak-opener',
      msg: `"${hit}" - name the subject.`,
    })),
    ...findAll(block, SELF_GRADE_PATTERN, (hit) => ({
      rule: 'self-grade',
      msg: `"${hit}" - do not grade your own work. Write what happened.`,
    })),
  ];
}
