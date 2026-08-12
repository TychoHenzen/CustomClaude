#!/usr/bin/env node
/**
 * Stop hook. Lints the last assistant message in the transcript.
 *
 * A chat reply gets the same rules as a file. The style says a reader hears
 * this message read aloud and nothing else. So a reply written in fragments
 * fails that reader the way a document would. The old carve-out here kept
 * sentence-shape rules off replies to protect a terse style. That carve-out
 * is gone.
 *
 * What replaces it is the class split, so the terse reply is not paid for one
 * word at a time. An encoding character blocks on its own, because it
 * corrupts the transcript. Comprehension findings block once they pass
 * REPLY_BUDGET. Polish findings print as advice and never block, however many
 * there are.
 *
 * The hook blocks at most once per turn. It respects stop_hook_active so it
 * can never hold the session in a loop.
 */

import { readFileSync } from 'node:fs';
import { lint } from '../ste/ste-lint.mjs';
import { COMPREHENSION, ENCODING } from '../ste/rule-classes.mjs';

/**
 * Comprehension findings a reply may carry before it blocks. A reply is
 * shorter than a file and gets rewritten in place, so it sits below the
 * file budget of three.
 */
const REPLY_BUDGET = 2;

const MAX_REPORTED = 10;

function lastAssistantText(transcriptPath) {
  const raw = readFileSync(transcriptPath, 'utf8').trim().split('\n');
  for (let i = raw.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(raw[i]);
    } catch {
      continue;
    }
    if (entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (text.trim()) return text;
  }
  return '';
}

function render(findings) {
  const shown = findings.slice(0, MAX_REPORTED).map((v) => `[${v.rule}] ${v.msg}`);
  return [...new Set(shown)].join('\n');
}

/** Report the polish findings as advice, then let the caller exit 0. */
function reportAdvisory(advice) {
  process.stderr.write(
    `ste-lint: advisory only, not blocking.\n${render(advice)}\n`
    + 'Worth a better word next time. Nothing to redo.\n',
  );
}

/** This reply's findings, split by what each one costs. */
export function review(text) {
  const violations = lint(text, { tier: 'flavored', kind: 'markdown' });
  return {
    encoding: violations.filter((v) => v.cls === ENCODING),
    comprehension: violations.filter((v) => v.cls === COMPREHENSION),
    advice: violations.filter(
      (v) => v.cls !== ENCODING && v.cls !== COMPREHENSION,
    ),
  };
}

/** Why this reply blocks, or null when it passes. */
export function verdict({ encoding, comprehension }) {
  if (encoding.length) {
    return `${encoding.length} character(s) that corrupt on re-encode`;
  }
  if (comprehension.length > REPLY_BUDGET) {
    return `${comprehension.length} sentences the reader cannot follow, `
      + `budget is ${REPLY_BUDGET}`;
  }
  return null;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }
  if (!input || input.stop_hook_active) process.exit(0);
  if (!input.transcript_path) process.exit(0);

  let text;
  try {
    text = lastAssistantText(input.transcript_path);
  } catch {
    process.exit(0);
  }
  if (!text || text.length > 40_000) process.exit(0);

  const { encoding, comprehension, advice } = review(text);
  const reason = verdict({ encoding, comprehension });
  if (!reason) {
    if (advice.length) reportAdvisory(advice);
    process.exit(0);
  }

  process.stderr.write(
    `ste-lint: your reply carries ${reason}.\n`
    + `${render([...encoding, ...comprehension])}\n`
    + 'Say it again. Rewrite the sentences it quoted rather than trimming words.\n'
    + 'Backtick any word or label you are quoting as an example.\n',
  );
  process.exit(2);
}

// Run only as a hook. A test imports this module for review and verdict, and
// main reads standard input, so importing it must not start it.
if (process.argv[1]?.endsWith('ste-reply-guard.mjs')) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}
