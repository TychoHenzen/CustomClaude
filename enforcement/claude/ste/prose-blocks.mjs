/**
 * prose-blocks - reduces a text to the blocks of prose a reader reads.
 *
 * A bullet, a heading and a paragraph each stand alone. A heading ends at
 * its own line. A blank line ends a block. Each block records the zero-based
 * index of its first line, because every rule counts its report line there.
 */

import { HOLE } from './canvas.mjs';
import { blankMarkdown } from './markdown-regions.mjs';
import { blankCode } from './code-regions.mjs';

/** Filler counts as white space here, so a blanked line reads as empty. */
const SPACE = `[\\s${HOLE}]`;
const BLANK = new RegExp(`^${SPACE}*$`);
const HEADING = new RegExp(`^${SPACE}{0,3}#{1,6}\\s`);
const ITEM = new RegExp(`^${SPACE}*(?:[-*+]\\s|\\d+[.)]\\s)`);
const LETTER = /[A-Za-z]/;

/** The same text with every part that carries no prose blanked out. */
export function proseCanvas(text, kind, ext) {
  if (kind === 'code') return blankCode(text, ext || '.js');
  return blankMarkdown(text);
}

function startsGroup(lines, index) {
  if (index === 0) return true;
  const above = lines[index - 1];
  if (BLANK.test(above) || HEADING.test(above)) return true;
  return ITEM.test(lines[index]) || HEADING.test(lines[index]);
}

/**
 * Blank the marker of a heading or a list item. The first word then opens a
 * sentence, so the rules read it as a word rather than as a name. The marker
 * also stops counting as a word.
 */
function withoutMarker(text) {
  const mark = HEADING.exec(text) || ITEM.exec(text);
  if (!mark) return text;
  return HOLE.repeat(mark[0].length) + text.slice(mark[0].length);
}

function toBlock(group) {
  return {
    line: group.line,
    text: withoutMarker(group.lines.join('\n')),
    heading: HEADING.test(group.lines[0]),
  };
}

/** Every prose block of a blanked canvas, in reading order. */
export function proseBlocks(canvas) {
  const lines = canvas.split('\n');
  const groups = [];
  lines.forEach((line, index) => {
    if (BLANK.test(line)) return;
    if (startsGroup(lines, index)) groups.push({ line: index, lines: [] });
    groups[groups.length - 1].lines.push(line);
  });
  return groups.map(toBlock).filter((block) => LETTER.test(block.text));
}
