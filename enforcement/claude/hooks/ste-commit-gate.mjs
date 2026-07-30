#!/usr/bin/env node
/**
 * PreToolUse hook. Refuses a `git commit` while a prose-gate waiver stays
 * unacknowledged.
 *
 * The pre-commit hook in enforcement/claude/git-hooks/ already checks this.
 * That hook runs only through `core.hooksPath`. A repository that points
 * `core.hooksPath` at its own directory shadows that check completely. This
 * hook is a second enforcement point that git cannot shadow. Claude Code
 * runs it before the tool call, not through git at all.
 *
 * Exit 0  - the command is not a git commit, every waiver is signed off,
 *           no log exists, or the tool call was not Bash.
 * Exit 2  - an unacknowledged waiver exists. stderr names each record.
 *
 * The hook never blocks on its own failure. Any internal error exits 0.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { unacknowledged } from '../ste/sentinel.mjs';

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

/** Nearest ancestor holding a .git entry, or the start directory. */
function findRepoRoot(startDir) {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 40; depth++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(startDir);
}

/**
 * Split a shell command into segments on `&&`, `||`, `;` and `|`, at the top
 * level only. A separator inside quotes stays part of its segment.
 */
function splitSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      segments.push(current);
      current = '';
      i++;
      continue;
    }
    if (ch === ';' || ch === '|') {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

/**
 * Tokenize one segment on whitespace, outside quotes. A quoted argument
 * becomes one token. `--grep="git commit"` never splits into two tokens that
 * look like a real `git commit` invocation.
 */
function tokenize(segment) {
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;
  for (const ch of segment) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

/** True when the command runs `git commit` as a real invocation. */
export function isGitCommitCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return false;
  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i] === 'git' && tokens[i + 1] === 'commit') return true;
    }
  }
  return false;
}

/** Unacknowledged waivers, or an empty list when the command is not a commit. */
export function blockingRecords(repoRoot, command) {
  if (!isGitCommitCommand(command)) return [];
  return unacknowledged(repoRoot);
}

function renderBlock(records) {
  const lines = [`ste-commit-gate: ${records.length} unacknowledged prose waiver(s) block this commit.`, ''];
  for (const record of records) {
    const kind = record.exempt ? 'file exempted' : 'one write waived';
    lines.push(`  ${record.file}  [${kind}]  ${record.at ?? 'unknown time'}`);
  }
  lines.push('');
  lines.push('Review each one, then set "acknowledged": true in .github/quality/prose-skip-log.json.');
  return lines.join('\n');
}

/**
 * Decide whether to block, given the parsed hook input. Never throws. Wrapped
 * in an exported function so a test can call it without spawning a process.
 */
export function evaluate(input) {
  try {
    if (!input || input.tool_name !== 'Bash') return { block: false, records: [] };
    const command = input.tool_input?.command;
    const repoRoot = findRepoRoot(input.cwd || process.cwd());
    const records = blockingRecords(repoRoot, command);
    return { block: records.length > 0, records };
  } catch {
    return { block: false, records: [] };
  }
}

function main() {
  const input = readStdin();
  if (!input) process.exit(0);

  const result = evaluate(input);
  if (!result.block) process.exit(0);

  process.stderr.write(`${renderBlock(result.records)}\n`);
  process.exit(2);
}

if (process.argv[1]?.endsWith('ste-commit-gate.mjs')) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}
