/**
 * Work out which lines a turn added to a file.
 *
 * The write guard records the strings each tool call added. The turn guard
 * replays those strings against the final text of the file, once, at the end
 * of the turn. Text that one edit added and a later edit removed is gone from
 * that final text, so it contributes no lines.
 *
 * Findings on those lines are the ones the turn is answerable for. Findings
 * elsewhere in the file belong to whoever wrote them, and are reported without
 * blocking.
 */

const WHOLE_FILE = [{ from: 1, to: Number.MAX_SAFE_INTEGER }];

function countLines(text) {
  return (text.match(/\n/g) || []).length;
}

/** Every place `added` sits in `text`, as 1-based inclusive line ranges. */
function rangesFor(added, text, all) {
  const ranges = [];
  let at = text.indexOf(added);
  while (at !== -1) {
    const from = countLines(text.slice(0, at)) + 1;
    ranges.push({ from, to: from + countLines(added) });
    at = all ? text.indexOf(added, at + added.length) : -1;
  }
  return ranges;
}

/**
 * The strings this tool call added, or null when the call wrote the whole
 * file. `Write` replaces everything, so every line in it is new.
 */
export function addedText(input) {
  const tool = input?.tool_name;
  if (tool === 'Edit') {
    const edit = input.tool_input || {};
    return [{ text: edit.new_string, all: Boolean(edit.replace_all) }];
  }
  if (tool === 'MultiEdit') {
    return (input.tool_input?.edits || [])
      .map((edit) => ({ text: edit.new_string, all: Boolean(edit.replace_all) }));
  }
  return null;
}

/** Lines the recorded calls added, measured against the current text. */
export function addedRanges(records, text) {
  const ranges = [];
  for (const record of records) {
    if (!record?.adds) return WHOLE_FILE;
    for (const add of record.adds) {
      if (typeof add?.text !== 'string' || !add.text) continue;
      ranges.push(...rangesFor(add.text, text, add.all));
    }
  }
  return ranges;
}

export function inRanges(line, ranges) {
  return ranges.some((range) => line >= range.from && line <= range.to);
}
