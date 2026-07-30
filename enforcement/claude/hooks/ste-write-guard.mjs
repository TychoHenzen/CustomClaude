#!/usr/bin/env node
/**
 * PostToolUse hook. Lints prose written by Write, Edit or MultiEdit.
 *
 * Exit 0  - clean, exempt, waived, or the file is not a prose target.
 * Exit 2  - error-severity violations. stderr goes back to the model as feedback.
 *
 * A `.prose-skip` sentinel waives one blocked write. See ../ste/sentinel.mjs.
 * There is no in-band marker. A bypass has to be out-of-band, one shot, and
 * recorded, or the thing being checked can simply switch the check off.
 *
 * The hook never blocks on its own failure. Any internal error exits 0.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { lint, classify, format } from '../ste/ste-lint.mjs';
import { changedRanges } from '../lib/changed-lines.mjs';
import { addExemption, deleteSentinel, isExempt, readSentinel, recordConsumption } from '../ste/sentinel.mjs';

const MAX_BYTES = 400_000;
const MAX_REPORTED = 25;

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

/** Nearest ancestor holding a .git entry, or the file directory. */
function findRepoRoot(filePath) {
  let dir = dirname(resolve(filePath));
  for (let depth = 0; depth < 40; depth++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(resolve(filePath));
}

function relFor(repoRoot, filePath) {
  return relative(repoRoot, resolve(filePath)).split('\\').join('/');
}

/**
 * Honour a sentinel. A plain one waives this write only. `{"exempt": true}`
 * also records the file so later writes skip the check.
 */
export function waive(repoRoot, relPath, reasons) {
  const sentinel = readSentinel(repoRoot);
  if (!sentinel) return false;
  if (sentinel.exempt) addExemption(repoRoot, relPath);
  recordConsumption(repoRoot, { file: relPath, reasons, exempt: sentinel.exempt });
  deleteSentinel(repoRoot);
  return true;
}

/** The prose target this call wrote, or null when there is nothing to check. */
function target(input) {
  const tool = input.tool_name || '';
  if (!/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) return null;

  const path = input.tool_input?.file_path || input.tool_input?.notebook_path;
  const info = classify(path);
  if (!info.kind) return null;

  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  if (text.length > MAX_BYTES) return null;
  return { path, info, text };
}

/**
 * Lint the whole file, so fences and front matter are read correctly, then
 * keep only the lines this tool call wrote. Prose the user already had must
 * never block an unrelated edit.
 */
function blockingErrors(input, { info, text }) {
  const ranges = changedRanges(input, text);
  return lint(text, { tier: info.tier, kind: info.kind, ext: info.ext })
    .filter((v) => v.sev === 'error')
    .filter((v) => ranges.some((r) => v.line >= r.from && v.line <= r.to));
}

function main() {
  const input = readStdin();
  if (!input) process.exit(0);

  const found = target(input);
  if (!found) process.exit(0);
  const { path, info } = found;

  const repoRoot = findRepoRoot(path);
  const relPath = relFor(repoRoot, path);
  if (isExempt(repoRoot, relPath)) process.exit(0);

  const errors = blockingErrors(input, found);
  if (!errors.length) process.exit(0);

  const shown = errors.slice(0, MAX_REPORTED);
  const extra = errors.length - shown.length;
  const detail = format(shown, path);
  if (waive(repoRoot, relPath, [detail])) process.exit(0);

  const lines = [
    `ste-lint blocked this write. ${errors.length} rule violations in ${path} (tier: ${info.tier}).`,
    '',
    detail,
    extra > 0 ? `... and ${extra} more.` : '',
    '',
    'Fix the prose, then write the file again. Rules: short common words, active voice,',
    'one instruction per sentence, no semicolons, no contractions, ASCII punctuation only.',
    'This checks prose only. Code, identifiers and command syntax are exempt.',
    'To waive this once: touch .prose-skip',
    'To exempt the whole file: echo \'{"exempt": true}\' > .prose-skip',
    'Both are recorded, and the commit hook asks you to sign off on them.',
  ];
  process.stderr.write(`${lines.filter(Boolean).join('\n')}\n`);
  process.exit(2);
}

try {
  main();
} catch {
  process.exit(0);
}
