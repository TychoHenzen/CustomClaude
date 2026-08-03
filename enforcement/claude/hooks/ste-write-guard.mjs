#!/usr/bin/env node
/**
 * PostToolUse hook. Records the prose file a tool call wrote, then exits 0.
 *
 * This used to lint and block right here. That fired once per tool call, and a
 * turn holds dozens of them, so the model paid a full round trip for each
 * single violation. Six of every ten blocks reported exactly one problem.
 *
 * The check now runs in ste-turn-guard.mjs, once, when the turn ends. This
 * hook only writes down what to check. It never blocks, and it never lints.
 */

import { readFileSync } from 'node:fs';
import { classify } from '../ste/ste-lint.mjs';
import { addedText } from '../lib/changed-lines.mjs';
import { append } from '../ste/pending.mjs';

const WRITERS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (!WRITERS.test(input?.tool_name || '')) return;

  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (!file || !classify(file).kind) return;

  append(input.session_id, { file, adds: addedText(input) });
}

try {
  main();
} catch {
  // The turn must finish even when the log cannot be written.
}
process.exit(0);
