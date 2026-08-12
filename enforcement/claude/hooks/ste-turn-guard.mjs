#!/usr/bin/env node
/**
 * Stop hook. Checks every prose file this turn wrote, once, before the turn
 * hands back to the user.
 *
 * The old design checked each tool call on its own. A turn holds dozens of
 * calls, so the model met one violation at a time and paid a round trip for
 * each. This gate sees the whole turn at once.
 *
 * Only a comprehension finding spends the budget. A polish finding prints
 * and never blocks, whatever the count. The gate used to weigh every rule
 * the same, so deleting two semicolons bought a file out of a readability
 * finding. That taught the wrong lesson, and this is where it was taught.
 *
 * Encoding characters get no budget, because they corrupt the file when it is
 * read back and no later reader spots them by eye.
 *
 * The report also names problems the turn did not create, so the model can fix
 * what is worth fixing while it still holds the file.
 *
 * Exit 0  - nothing over budget, waived, or the log is empty.
 * Exit 2  - some file went over. stderr goes back to the model.
 */

import { readFileSync } from 'node:fs';
import { lint, classify } from '../ste/ste-lint.mjs';
import { COMPREHENSION, ENCODING } from '../ste/rule-classes.mjs';
import { addedRanges, inRanges } from '../lib/changed-lines.mjs';
import { byFile, clear, read } from '../ste/pending.mjs';
import {
  addExemption, deleteSentinel, isExempt, readSentinel, recordConsumption,
  relPathIn, repoRootFor,
} from '../ste/sentinel.mjs';

const NEW_BUDGET = 3;
const MAX_BYTES = 400_000;
const MAX_FRESH = 25;
const MAX_EXISTING = 10;

/** Split this file's blocking findings into the turn's own and everyone
 *  else's. Polish findings ride along as advice, whichever turn wrote them. */
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
  const found = lint(text, { tier: info.tier, kind: info.kind, ext: info.ext });
  const errors = found.filter((v) => v.cls === ENCODING || v.cls === COMPREHENSION);
  const fresh = errors.filter((v) => inRanges(v.line, ranges));
  const advice = found
    .filter((v) => v.cls !== ENCODING && v.cls !== COMPREHENSION)
    .filter((v) => inRanges(v.line, ranges));
  return {
    file,
    repoRoot,
    tier: info.tier,
    fresh,
    existing: errors.filter((v) => !fresh.includes(v)),
    advice,
  };
}

/** Why this file blocks the turn, or null when it stays inside its budget. */
function verdict(result) {
  const encoding = result.fresh.filter((v) => v.cls === ENCODING);
  const rest = result.fresh.filter((v) => v.cls !== ENCODING);
  if (encoding.length) {
    return `${encoding.length} new encoding violation(s), which have no budget`;
  }
  if (rest.length > NEW_BUDGET) {
    return `${rest.length} new sentences the reader cannot follow, budget is ${NEW_BUDGET}`;
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
  if (result.advice.length) {
    lines.push('  advice only, never blocking:');
    lines.push(...result.advice.slice(0, MAX_EXISTING).map(renderFinding));
  }
  return lines.join('\n');
}

function renderReport(blocked, checked) {
  return [
    `ste-lint blocked this turn. ${blocked.length} of ${checked} files went over budget.`,
    '',
    blocked.map(renderFile).join('\n\n'),
    '',
    'Rewrite the sentences quoted above. A shorter sentence with commoner words and',
    'one clause is what clears this. Renaming a word or deleting a mark will not.',
    `Each file may gain ${NEW_BUDGET} of these per turn. Advice lines never block, so`,
    'leave them unless the fix is free.',
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
