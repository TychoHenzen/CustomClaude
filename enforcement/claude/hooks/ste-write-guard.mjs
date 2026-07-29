#!/usr/bin/env node
/**
 * PostToolUse hook. Lints prose written by Write, Edit or MultiEdit.
 *
 * Exit 0  - clean, or the file is not a prose target.
 * Exit 2  - error-severity violations. stderr goes back to the model as feedback.
 *
 * The hook never blocks on its own failure. Any internal error exits 0.
 */

import { readFileSync } from 'node:fs';
import { lint, classify, isDisabled, format } from '../ste/ste-lint.mjs';
import { changedRanges } from '../lib/changed-lines.mjs';

const MAX_BYTES = 400_000;
const MAX_REPORTED = 25;

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const input = readStdin();
  if (!input) process.exit(0);

  const tool = input.tool_name || '';
  if (!/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) process.exit(0);

  const path = input.tool_input?.file_path || input.tool_input?.notebook_path;
  const info = classify(path);
  if (!info.kind) process.exit(0);

  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    process.exit(0);
  }
  if (text.length > MAX_BYTES || isDisabled(text)) process.exit(0);

  // Lint the whole file, so fences and front matter are read correctly, then
  // report only the lines this tool call wrote. Prose the user already had
  // must never block an unrelated edit.
  const ranges = changedRanges(input, text);
  const errors = lint(text, { tier: info.tier, kind: info.kind, ext: info.ext })
    .filter((v) => v.sev === 'error')
    .filter((v) => ranges.some((r) => v.line >= r.from && v.line <= r.to));
  if (!errors.length) process.exit(0);

  const shown = errors.slice(0, MAX_REPORTED);
  const extra = errors.length - shown.length;
  const lines = [
    `ste-lint blocked this write. ${errors.length} rule violations in ${path} (tier: ${info.tier}).`,
    '',
    format(shown, path),
    extra > 0 ? `... and ${extra} more.` : '',
    '',
    'Fix the prose, then write the file again. Rules: short common words, active voice,',
    'one instruction per sentence, no semicolons, no contractions, ASCII punctuation only.',
    'This checks prose only. Code, identifiers and command syntax are exempt.',
    'To exempt a whole file, put "ste-lint: off" in its first few lines.',
  ];
  process.stderr.write(`${lines.filter(Boolean).join('\n')}\n`);
  process.exit(2);
}

try {
  main();
} catch {
  process.exit(0);
}
