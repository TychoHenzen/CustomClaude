#!/usr/bin/env node
/**
 * Stop hook. Checks every prose file this turn wrote, once, before the turn
 * hands back to the user.
 *
 * The old design checked each tool call on its own. A turn holds dozens of
 * calls, so the model met one violation at a time and paid a round trip for
 * each. This gate sees the whole turn at once.
 *
 * A file may gain up to NEW_BUDGET fresh violations and still pass. Encoding
 * characters get no budget, because they corrupt the file when it is read back
 * and no later reader spots them by eye.
 *
 * The report also names problems the turn did not create, so the model can fix
 * what is worth fixing while it still holds the file.
 *
 * Exit 0  - nothing over budget, waived, or the log is empty.
 * Exit 2  - some file went over. stderr goes back to the model.
 */

import { readFileSync } from 'node:fs';
import { lint, classify } from '../ste/ste-lint.mjs';
import { addedRanges, inRanges } from '../lib/changed-lines.mjs';
import { byFile, clear, read } from '../ste/pending.mjs';
import {
  addExemption, deleteSentinel, isExempt, readSentinel, recordConsumption,
  relPathIn, repoRootFor,
} from '../ste/sentinel.mjs';

const NEW_BUDGET = 3;
const ENCODING_RULE = 'punctuation';
const MAX_BYTES = 400_000;
const MAX_FRESH = 25;
const MAX_EXISTING = 10;

/** Split this file's error findings into the turn's own and everyone else's. */
function review(file, records) {
  const info = classify(file);
  if (!info.kind) return null;

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (text.length > MAX_BYTES) return null;

  const repoRoot = repoRootFor(file);
  if (isExempt(repoRoot, relPathIn(repoRoot, file))) return null;

  const ranges = addedRanges(records, text);
  const errors = lint(text, { tier: info.tier, kind: info.kind, ext: info.ext })
    .filter((v) => v.sev === 'error');
  const fresh = errors.filter((v) => inRanges(v.line, ranges));
  return {
    file, repoRoot, tier: info.tier, fresh, existing: errors.filter((v) => !fresh.includes(v)),
  };
}

/** Why this file blocks the turn, or null when it stays inside its budget. */
function verdict(result) {
  const encoding = result.fresh.filter((v) => v.rule === ENCODING_RULE);
  const rest = result.fresh.filter((v) => v.rule !== ENCODING_RULE);
  if (encoding.length) {
    return `${encoding.length} new encoding violation(s), which have no budget`;
  }
  if (rest.length > NEW_BUDGET) {
    return `${rest.length} new violations, budget is ${NEW_BUDGET}`;
  }
  return null;
}

function renderFinding(finding) {
  return `  :${finding.line} [${finding.rule}] ${finding.msg}`;
}

function renderFile({ result, reason }) {
  const lines = [`${result.file} (tier: ${result.tier}) - ${reason}`];
  lines.push(...result.fresh.slice(0, MAX_FRESH).map(renderFinding));
  if (result.fresh.length > MAX_FRESH) {
    lines.push(`  ... and ${result.fresh.length - MAX_FRESH} more from this turn.`);
  }
  if (result.existing.length) {
    lines.push('  already in the file, not blocking:');
    lines.push(...result.existing.slice(0, MAX_EXISTING).map(renderFinding));
    if (result.existing.length > MAX_EXISTING) {
      lines.push(`  ... and ${result.existing.length - MAX_EXISTING} more.`);
    }
  }
  return lines.join('\n');
}

function renderReport(blocked, checked) {
  return [
    `ste-lint blocked this turn. ${blocked.length} of ${checked} files went over budget.`,
    '',
    blocked.map(renderFile).join('\n\n'),
    '',
    `Every rule but encoding allows ${NEW_BUDGET} new violations per file. Fix the ones`,
    'worth fixing and leave the rest. Use short common words. Write one instruction',
    'per sentence. Use no semicolons and no em dash, in any spelling.',
    'This checks prose only. Code, identifiers and command syntax are exempt.',
    'To waive this once: touch .prose-skip',
    'To exempt a whole file: echo \'{"exempt": true}\' > .prose-skip',
    'Both are recorded, and the commit hook asks you to sign off on them.',
  ].join('\n');
}

/** Consume a sentinel on behalf of every blocked file. */
function waive(blocked) {
  const sentinel = readSentinel(blocked[0].result.repoRoot);
  if (!sentinel) return false;
  for (const { result } of blocked) {
    const rel = relPathIn(result.repoRoot, result.file);
    if (sentinel.exempt) addExemption(result.repoRoot, rel);
    recordConsumption(result.repoRoot, { file: rel, reasons: [], exempt: sentinel.exempt });
  }
  deleteSentinel(blocked[0].result.repoRoot);
  return true;
}

/** Every file this turn wrote that went over its budget. */
export function assess(groups) {
  const blocked = [];
  let checked = 0;
  for (const [file, records] of groups) {
    const result = review(file, records);
    if (!result) continue;
    checked++;
    const reason = verdict(result);
    if (reason) blocked.push({ result, reason });
  }
  return { blocked, checked };
}

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const session = input?.session_id;

  // stop_hook_active means we already blocked this turn once. Blocking again
  // would hold the session in a loop, and one pass is the whole point.
  if (!session || input.stop_hook_active) {
    clear(session);
    process.exit(0);
  }

  const { blocked, checked } = assess(byFile(read(session)));
  clear(session);
  if (!blocked.length || waive(blocked)) process.exit(0);

  process.stderr.write(`${renderReport(blocked, checked)}\n`);
  process.exit(2);
}

if (process.argv[1]?.endsWith('ste-turn-guard.mjs')) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}
