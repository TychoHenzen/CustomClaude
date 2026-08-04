/**
 * markdown-regions - blanks the parts of a markdown file that carry markup
 * rather than prose.
 *
 * Blanking runs in two stages. Markup that hides other marks goes first, so
 * a backtick inside a fence can never pair with one in the prose below it.
 * The inline patterns then read what that first stage left.
 */

import { HOLE, blankRanges, lineRanges, matchRanges } from './canvas.mjs';

/** Suffixes that mark a token as a path even when it holds no slash. */
const PATH_SUFFIXES = 'md|js|mjs|ts|py|ps1|cmd|json|yaml|yml|rs|cs|sh|txt|toml';

/** Matches at the end of the whole text, never at the end of a line. */
const TEXT_END = '(?![\\s\\S])';

/** A fenced block runs to its closing fence, or to the end of the file. */
const FENCE = new RegExp(
  `^[ \\t]*(\`{3,}|~{3,})[\\s\\S]*?(?:\\n[ \\t]*\\1[^\\n]*|${TEXT_END})`,
  'gm',
);

/** A line holding nothing but three hyphens or three plus signs. */
const FRONT_MARK = `(?:---|\\+\\+\\+)[ \\t]*(?=\\n|${TEXT_END})`;

/** Front matter opens only when the first line is a bare mark, and it
 *  closes at the next bare mark, however that one is indented. */
const FRONT_MATTER = new RegExp(
  `^[ \\t]*${FRONT_MARK}[\\s\\S]*?(?:\\n[ \\t]*${FRONT_MARK}|${TEXT_END})`,
  'g',
);

/**
 * Markup that hides what sits inside it. It runs before the inline scan, so
 * a backtick inside a fence can never pair with one in the prose below it.
 */
const HIDDEN_MARKUP = [FENCE, FRONT_MATTER, /<!--[\s\S]*?-->/g];

/** Whole lines that carry no prose: table rows, quotes, rules, link labels. */
const MARKUP_LINES = [
  /^\s{0,3}\|/,
  /^\s{0,3}>/,
  /^\s*([-*_])(?:\s*\1){2,}\s*$/,
  /^\s{0,3}\[[^\]]+\]:\s/,
];

/** A path holds none of these. A bracket, a paren, a quote or a bold mark
 *  wraps a path. A colon or a semicolon joins one to the sentence. */
const PATH_CHAR = `[^\\s${HOLE}\\[\\]()\`'"*;:]`;

/** Marks that may trail a path and still belong to the sentence. A path
 *  that ate the period after it would join two sentences into one. */
const TRAILING = '[.,;:!?)\\]}\'"`]*';

/** Only a real space opens a path. A blanked character means markup was
 *  cut out there, and the prose after it is still prose. */
const PATH_HEAD = '(?:^|[ \\t\\n])';
const PATH_TAIL = `(?=${TRAILING}(?:[\\s${HOLE}]|$))`;
const SEPARATOR = '[\\/\\\\]';

/** An address names its scheme first, and that is the one colon a path
 *  may hold. */
const SCHEME = `[A-Za-z][\\w+.-]*:${SEPARATOR}${SEPARATOR}`;

/** Either an address, or a run holding a separator of its own. */
const PATH_BODY = `(?:${SCHEME}${PATH_CHAR}*?`
  + `|${PATH_CHAR}*${SEPARATOR}${PATH_CHAR}*?)`;

/**
 * A path token opens at a space or at the start of a line. It holds no
 * bracket, paren, backtick or quote. Inside it, one separator is enough.
 * A run that opens inside something else reads as prose.
 */
const SLASHED_PATH = new RegExp(
  `${PATH_HEAD}(${PATH_BODY})${PATH_TAIL}`,
  'g',
);

/** The head belongs to the text, not to the path. A blanked space would
 *  hide the break between a list marker and the words after it. */
function pathRanges(text) {
  const ranges = [];
  for (const hit of text.matchAll(SLASHED_PATH)) {
    const start = hit.index + (hit[0].length - hit[1].length);
    ranges.push([start, start + hit[1].length]);
  }
  return ranges;
}

/** A bare file name, with no separator at all, still reads as a path. */
const SUFFIXED = new RegExp(`\\b[\\w.-]+\\.(?:${PATH_SUFFIXES})\\b`, 'g');

/** Spans that wrap what they hide. A code span and a quoted span may each
 *  wrap one line break and still count as one span. */
const INLINE_SPANS = [
  /`(?:[^`\n]*\n)?[^`\n]*`/g,
  /"(?:[^"\n]*\n)?[^"\n]*"/g,
  /\]\([^)\n]*\)/g,
];

/** Tokens that stand on their own inside a line. */
const INLINE_TOKENS = [SUFFIXED, /(?:^|\s)--?[A-Za-z][\w-]*/g];

/** Blank one pattern, then hand the result to the next. A later pattern
 *  must not reach inside a region an earlier one already took out. */
function blankPattern(text, pattern) {
  return blankRanges(text, matchRanges(text, [pattern]));
}

/** The text with every markup region blanked out. */
export function blankMarkdown(text) {
  const hidden = blankRanges(text, [
    ...matchRanges(text, HIDDEN_MARKUP),
    ...lineRanges(text, MARKUP_LINES),
  ]);
  const spans = INLINE_SPANS.reduce(blankPattern, hidden);
  const paths = blankRanges(spans, pathRanges(spans));
  return INLINE_TOKENS.reduce(blankPattern, paths);
}
