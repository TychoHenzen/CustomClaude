/**
 * rules-reporting - catches a report written for the writer, not the reader.
 *
 * The reader of a report did not watch the work. They hear the message and
 * nothing else. No tool output, no notes, no earlier steps. So a name that
 * only meant something during the work means nothing to them.
 *
 * `S10` and `phase 3` are that kind of name. Both get spoken as a word the
 * listener is supposed to know. Neither says what the thing did. Write what
 * the step did, or drop the name.
 *
 * A code span is blanked before any rule runs, so a backticked `S10` passes.
 * That is the escape hatch for a document about such names, including this
 * one.
 */

import { isLocalWord } from './local-corpus.mjs';

/**
 * A short identifier: up to three capitals then digits, as in `S10`, `U3`,
 * or `TC001`. The pattern reads a whole token, so a longer word carrying the
 * same letters cannot match. Standards share this shape, and KNOWN_NAMES
 * below carries the ones that do.
 */
const SHORT_ID = /\b[A-Z]{1,3}\d{1,4}\b/g;

/** A step named by its number, as in `phase 3` or `step 4`. */
const NUMBERED_STEP = new RegExp(
  '\\b(?:phase|step|probe|stage|agent|node|round|iteration|attempt|task)'
  + '\\s+\\d{1,3}\\b',
  'gi',
);

/**
 * Identifiers that name a standard rather than a step of this work. A reader
 * meets these outside the session, so they carry meaning on their own. The
 * project vote below covers the rest, and this list covers a project that
 * mentions one of these only once.
 */
const KNOWN_NAMES = new Set([
  'UTF8', 'UTF16', 'UTF32', 'ISO8601', 'RFC2119', 'SHA1', 'SHA256', 'SHA512',
  'MD5', 'IPV4', 'IPV6', 'X11', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'CO2', 'P50', 'P95', 'P99', 'HTTP2', 'HTTP3', 'ES6', 'ES5', 'CP1252',
  'WIN32', 'X64', 'X86', 'ARM64', 'AMD64',
]);

function lineOf(block, offset) {
  const before = block.text.slice(0, offset);
  return block.line + (before.match(/\n/g) || []).length + 1;
}

function findAll(block, pattern, describe) {
  const found = [];
  pattern.lastIndex = 0;
  let hit = pattern.exec(block.text);
  while (hit !== null) {
    const finding = describe(hit[0]);
    if (finding) found.push({ line: lineOf(block, hit.index), ...finding });
    hit = pattern.exec(block.text);
  }
  return found;
}

/**
 * True when the project writes this identifier often enough that it is a
 * name rather than a step of one session. `acronym` asks the same question
 * of an abbreviation, and this rule follows it. A repository whose linter is
 * named for ASD-STE100 writes `STE100` everywhere, and no reader of it needs
 * that spelled out.
 */
function isProjectName(hit) {
  return isLocalWord(hit.toLowerCase());
}

function shortIdFinding(hit) {
  if (KNOWN_NAMES.has(hit.toUpperCase())) return null;
  if (isProjectName(hit)) return null;
  return {
    rule: 'bare-label',
    msg: `"${hit}" names a step by ID alone. The reader did not watch the `
      + 'work. Write what it did, or drop the name.',
  };
}

/** Every label in block that stands in for what a step actually did. */
export function bareLabelRule(block) {
  try {
    if (block.heading) return [];
    return [
      ...findAll(block, SHORT_ID, shortIdFinding),
      ...findAll(block, NUMBERED_STEP, (hit) => ({
        rule: 'bare-label',
        msg: `"${hit}" names a step by number. Name what it did instead.`,
      })),
    ];
  } catch {
    return [];
  }
}
