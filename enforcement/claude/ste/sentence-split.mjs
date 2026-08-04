/**
 * sentence-split - decides where one sentence ends and the next begins.
 *
 * A period is weak evidence. It also ends an abbreviation, an initial, and
 * the number that opens a list item. A run of separator marks between two
 * spaces is strong evidence. A line of index entries joined that way is not
 * one long sentence.
 */

import { HOLE } from './canvas.mjs';

/** The vertical bar, the middle dot, and the bullet. */
const SEPARATORS = [124, 0x00b7, 0x2022]
  .map((code) => String.fromCharCode(code))
  .join('');

const BOUNDARY = new RegExp(
  `[.!?]+(?=[\\s${HOLE}]|$)|\\s[${SEPARATORS}]+(?=\\s)`,
  'g',
);

const ABBREVIATIONS = [
  'e.g', 'i.e', 'etc', 'vs', 'cf', 'al', 'approx', 'fig', 'no', 'dr', 'mr',
  'ms', 'mrs', 'st', 'jr', 'sr', 'inc', 'ltd', 'ca', 'esp', 'min', 'max',
  'sec', 'ver',
];

const ABBREVIATION_END = new RegExp(
  `(?:^|[^A-Za-z])(?:${ABBREVIATIONS.join('|').replace(/\./g, '\\.')})$`,
  'i',
);

/** A single letter reads as an initial rather than as a word. */
const INITIAL_END = /(?:^|[^A-Za-z])[A-Za-z]$/;

/** A bare number that opens the block reads as a list enumerator. */
const ENUMERATOR = new RegExp(`^[\\s${HOLE}]*\\d+$`);

const WORD = /[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g;

function endsSentence(flat, index) {
  const before = flat.slice(0, index);
  if (ABBREVIATION_END.test(before)) return false;
  if (INITIAL_END.test(before)) return false;
  return !ENUMERATOR.test(before);
}

/** Every offset where a sentence ends, counted from the start of flat. */
export function boundaryCuts(flat) {
  const cuts = [];
  BOUNDARY.lastIndex = 0;
  let hit = BOUNDARY.exec(flat);
  while (hit !== null) {
    if (hit[0] !== '.' || endsSentence(flat, hit.index)) {
      cuts.push(hit.index + hit[0].length);
    }
    hit = BOUNDARY.exec(flat);
  }
  return cuts;
}

/** Count tokens that open with a letter or a digit. A token may hold an
 *  inner apostrophe or hyphen. */
export function wordCount(text) {
  return (text.match(WORD) || []).length;
}
