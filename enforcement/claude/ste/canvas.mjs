/**
 * canvas - builds a same-length copy of a text with the parts a reader
 * skips replaced by filler.
 *
 * Every rule reports a line number, so the copy has to keep the length and
 * the line breaks of the input. The filler is U+0000, which the rule
 * modules read as a word boundary.
 */

export const HOLE = String.fromCharCode(0);

/** Replace every character inside each range with filler. Line breaks stay. */
export function blankRanges(text, ranges) {
  const out = text.split('');
  for (const [start, end] of ranges) {
    for (let i = start; i < end; i++) {
      if (out[i] !== '\n') out[i] = HOLE;
    }
  }
  return out.join('');
}

/** Keep the characters inside the ranges and blank everything else. */
export function keepRanges(text, ranges) {
  const out = text.split('').map((ch) => (ch === '\n' ? ch : HOLE));
  for (const [start, end] of ranges) {
    for (let i = start; i < end; i++) out[i] = text[i];
  }
  return out.join('');
}

/** The range of every match of every pattern. Each pattern needs the g flag. */
export function matchRanges(text, patterns) {
  const ranges = [];
  for (const pattern of patterns) {
    for (const hit of text.matchAll(pattern)) {
      ranges.push([hit.index, hit.index + hit[0].length]);
    }
  }
  return ranges;
}

/** The range of every whole line that matches one of the patterns. */
export function lineRanges(text, patterns) {
  const ranges = [];
  let at = 0;
  for (const line of text.split('\n')) {
    if (patterns.some((pattern) => pattern.test(line))) {
      ranges.push([at, at + line.length]);
    }
    at += line.length + 1;
  }
  return ranges;
}

/** Blank every line that carries no run of three lower-case letters. */
export function blankThinLines(text) {
  return text.split('\n')
    .map((line) => (/[a-z]{3}/.test(line) ? line : HOLE.repeat(line.length)))
    .join('\n');
}
