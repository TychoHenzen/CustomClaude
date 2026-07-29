/**
 * Shared by the PostToolUse guards: work out which lines a tool call wrote.
 *
 * A guard that reports every problem in a file blocks edits over prose or code
 * that somebody else wrote. Both guards lint the whole file for context, then
 * keep only the findings that land on lines this call produced.
 */

import { readFileSync } from 'node:fs';

const WHOLE_FILE = [{ from: 1, to: Number.MAX_SAFE_INTEGER }];

function countLines(text) {
  return (text.match(/\n/g) || []).length;
}

/** Ranges for one edit, or null when the new text is no longer in the file. */
function rangesForEdit(edit, text) {
  const added = edit.new_string;
  if (typeof added !== 'string' || !added) return [];
  let at = text.indexOf(added);
  if (at === -1) return null;

  const ranges = [];
  while (at !== -1) {
    const from = countLines(text.slice(0, at)) + 1;
    ranges.push({ from, to: from + countLines(added) });
    at = edit.replace_all ? text.indexOf(added, at + added.length) : -1;
  }
  return ranges;
}

/** Line ranges, 1-based and inclusive, that this tool call wrote. */
export function changedRanges(input, text) {
  const tool = input.tool_name;
  if (tool !== 'Edit' && tool !== 'MultiEdit') return WHOLE_FILE;

  const edits = tool === 'MultiEdit'
    ? (input.tool_input?.edits || [])
    : [input.tool_input || {}];

  const ranges = [];
  for (const edit of edits) {
    const found = rangesForEdit(edit, text);
    if (found === null) return WHOLE_FILE;
    ranges.push(...found);
  }
  return ranges.length ? ranges : WHOLE_FILE;
}

/** Keep only the findings whose line falls inside a changed range. */
export function scopeToChangedLines(input, findings) {
  const filePath = input.tool_input?.file_path;
  if (!filePath || !findings.length) return findings;
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return findings;
  }
  const ranges = changedRanges(input, text);
  return findings.filter((finding) => ranges.some(
    (range) => finding.line >= range.from && finding.line <= range.to,
  ));
}
