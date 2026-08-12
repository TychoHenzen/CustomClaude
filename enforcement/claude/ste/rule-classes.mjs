/**
 * rule-classes - decides what a finding costs the writer.
 *
 * Every rule used to carry `error` or `warn`, and almost every one carried
 * `error`. So a semicolon weighed the same as a paragraph no reader can
 * parse. The gates count findings, so the cheapest way past them was to
 * delete punctuation and leave the jargon. That is what happened.
 *
 * Three classes replace the two severities. A rule names one thing about a
 * text, and the class says what kind of thing it is.
 */

/** The character corrupts the file when a reader loads it back. Never a
 *  matter of taste, so it blocks on its own everywhere. */
export const ENCODING = 'encoding';

/** The reader cannot follow the sentence. This is what the checker is for,
 *  and these are the findings that block. */
export const COMPREHENSION = 'comprehension';

/** The reader follows the sentence and one word or mark could be better.
 *  Worth reporting, never worth a round trip. */
export const POLISH = 'polish';

const CLASS_OF_RULE = new Map([
  ['punctuation', ENCODING],

  ['readability', COMPREHENSION],
  ['tangled-sentence', COMPREHENSION],
  ['noun-stack', COMPREHENSION],
  ['clause-pileup', COMPREHENSION],
  ['long-sentence', COMPREHENSION],
  ['long-paragraph', COMPREHENSION],
  ['bare-label', COMPREHENSION],
  ['self-grade', COMPREHENSION],
  ['subject-length', COMPREHENSION],

  ['semicolon', POLISH],
  ['slop-word', POLISH],
  ['filler', POLISH],
  ['nominalization', POLISH],
  ['weak-opener', POLISH],
  ['acronym', POLISH],
  ['hard-word', POLISH],
]);

/** The class a rule reports under. An unlisted rule reads as polish, so a
 *  new rule advises until someone decides it should block. */
export function classOf(rule) {
  return CLASS_OF_RULE.get(rule) || POLISH;
}

/** True when a finding of this class stops the turn. */
export function blocks(cls) {
  return cls === ENCODING || cls === COMPREHENSION;
}

/** The linter leaves this behind where it blanks a code span or a path. It
 *  is built rather than typed, so no source file carries the byte. */
const MASK_FILLER = String.fromCharCode(0);

const RUN_OF_SPACE = new RegExp(`[\\s${MASK_FILLER}]+`, 'g');

/** How long a quoted sentence runs before it is cut. */
const QUOTE_LENGTH = 100;

/**
 * One sentence, ready to paste into a report. Mask filler and line breaks
 * collapse to single spaces, so the quote reads as the writer wrote it. A
 * long sentence is cut with an ASCII ellipsis.
 */
export function quoteSentence(text) {
  const flat = text.replace(RUN_OF_SPACE, ' ').trim();
  if (flat.length <= QUOTE_LENGTH) return flat;
  return `${flat.slice(0, QUOTE_LENGTH).trimEnd()}...`;
}
