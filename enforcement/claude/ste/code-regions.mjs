/**
 * code-regions - keeps the prose in a source file and blanks the code.
 *
 * A source file carries prose in two places. Comments carry it, and so do
 * the message strings a user reads. Code carries none.
 */

import {
  HOLE, blankRanges, blankThinLines, keepRanges, matchRanges,
} from './canvas.mjs';

/** Languages that open a comment with a hash rather than two slashes. */
const HASH_LANGUAGES = new Set([
  '.py', '.sh', '.bash', '.ps1', '.rb', '.yml', '.yaml', '.toml', '.pl',
]);

const QUOTE_MARKS = ['\'', '"', '`'];

/** Matches at the end of the whole text. A comment that never closes still
 *  carries prose, from its opener down to there. */
const TEXT_END = '(?![\\s\\S])';

const BLOCK_COMMENT = new RegExp(`/\\*[\\s\\S]*?(?:\\*/|${TEXT_END})`, 'g');
const DOCSTRING = new RegExp(`("""|''')[\\s\\S]*?(?:\\1|${TEXT_END})`, 'g');

/** The first line of a script names its interpreter, never a reader. */
const SHEBANG = /^#![^\n]*/g;

/** A string counts as prose only when one of these stands in front of it. */
const TRIGGERS = [
  'throw new [A-Za-z_$][\\w$]*',
  'Error',
  'panic!',
  'raise [A-Za-z_$][\\w$]*',
  'Write-Host',
  'console\\.error',
  'console\\.warn',
  'print',
];

/**
 * The quote has to open the argument list of the marker, though white space
 * may sit between them. A marker followed by a space and a quote is a shell
 * word, not a message. The last group holds the body, 20 characters or more.
 */
const MESSAGE = new RegExp(
  `(?:${TRIGGERS.join('|')})\\([ \\t]*(["'\`])([^\\n"'\`]{20,})\\1`,
  'g',
);

/** A hash that opens the body of a comment. No block of a source file is a
 *  heading, so this mark must not survive into the block text. */
const COMMENT_HASH = new RegExp(`^[ \\t${HOLE}]*#+`, 'gm');

/** Parts of a comment that read as code: doc tags, spans, groups, calls,
 *  and the markers themselves. */
const COMMENT_NOISE = [
  /@[A-Za-z]\w*/g,
  /`[^`\n]*`/g,
  /\{[^}\n]*\}/g,
  /\b[\w.]+\([^)\n]*\)/g,
  /\/\*+|\*+\//g,
  /^[ \t]*\*+/gm,
  COMMENT_HASH,
];

function quoteAfter(quote, ch) {
  if (quote) return ch === quote ? null : quote;
  return QUOTE_MARKS.includes(ch) ? ch : null;
}

/** Where a comment opens on this line, or -1. Quoted text never opens one,
 *  and the quote reading restarts at every line. */
function commentStart(line, marker) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') {
      i++;
    } else {
      quote = quoteAfter(quote, line[i]);
      if (!quote && line.startsWith(marker, i)) return i;
    }
  }
  return -1;
}

/** Where the words of the comment begin. A writer may repeat the marker,
 *  and a repeated hash would otherwise read as a markdown heading. */
function bodyStart(line, start, marker) {
  let at = start;
  while (line.startsWith(marker, at)) at += marker.length;
  return at;
}

/** Every line comment, with the marker itself left out. */
function lineCommentRanges(text, marker) {
  const ranges = [];
  let at = 0;
  for (const line of text.split('\n')) {
    const start = commentStart(line, marker);
    if (start !== -1) {
      ranges.push([at + bodyStart(line, start, marker), at + line.length]);
    }
    at += line.length + 1;
  }
  return ranges;
}

function messageRanges(text) {
  const ranges = [];
  for (const hit of text.matchAll(MESSAGE)) {
    const body = hit[2];
    const start = hit.index + hit[0].length - body.length - 1;
    ranges.push([start, start + body.length]);
  }
  return ranges;
}

function proseRanges(text, ext) {
  const hash = HASH_LANGUAGES.has(ext);
  return [
    ...matchRanges(text, [hash ? DOCSTRING : BLOCK_COMMENT]),
    ...lineCommentRanges(text, hash ? '#' : '//'),
    ...messageRanges(text),
  ];
}

/** The text with every part that is not comment or message prose blanked. */
export function blankCode(text, ext) {
  const kept = keepRanges(text, proseRanges(text, ext));
  const noise = matchRanges(kept, COMMENT_NOISE)
    .concat(matchRanges(text, [SHEBANG]));
  return blankThinLines(blankRanges(kept, noise));
}
