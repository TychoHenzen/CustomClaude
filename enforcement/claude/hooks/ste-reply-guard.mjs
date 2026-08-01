#!/usr/bin/env node
/**
 * Stop hook. Lints the last assistant message in the transcript.
 *
 * Chat replies get the flavored tier and the rules that survive terse
 * writing: banned vocabulary, filler, nominalization, punctuation and
 * hard-word. Sentence length and sentence-structure rules are dropped.
 * The caveman reply style drops articles and writes fragments on
 * purpose. A sentence-shape rule would fight that style.
 *
 * `hard-word` carries warn severity in the flavored tier, not error. This
 * hook never blocks on `hard-word` alone. When another rule in the set
 * already blocks, hard-word findings ride along in the report. When
 * hard-word is the only finding, the hook reports it to stderr as advice
 * and still exits 0.
 *
 * The hook blocks at most once per turn. It respects stop_hook_active so it
 * can never hold the session in a loop.
 */

import { readFileSync } from 'node:fs';
import { lint } from '../ste/ste-lint.mjs';

const CHAT_RULES = new Set([
  'slop-word', 'filler', 'nominalization', 'punctuation', 'hard-word',
]);
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

/** Report hard-word findings as advice only, then let the caller exit 0. */
function reportAdvisory(advisories) {
  const shown = advisories.slice(0, MAX_REPORTED).map((v) => `[${v.rule}] ${v.msg}`);
  const unique = [...new Set(shown)];
  process.stderr.write(
    `ste-lint: advisory only, not blocking.\n${unique.join('\n')}\n`
    + 'These are rare words. Consider a commoner one next time.\n',
  );
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

  const violations = lint(text, { tier: 'flavored', kind: 'markdown' })
    .filter((v) => CHAT_RULES.has(v.rule));
  const errors = violations.filter((v) => v.sev === 'error');
  const advisories = violations.filter((v) => v.rule === 'hard-word' && v.sev === 'warn');

  if (!errors.length) {
    if (advisories.length) reportAdvisory(advisories);
    process.exit(0);
  }

  const shown = [...errors, ...advisories].slice(0, MAX_REPORTED)
    .map((v) => `[${v.rule}] ${v.msg}`);
  const unique = [...new Set(shown)];
  process.stderr.write(
    `ste-lint: your reply broke ${errors.length} writing rules.\n${unique.join('\n')}\n`
    + 'Say it again without those. Keep it short. Backtick any word you are quoting as an example.\n',
  );
  process.exit(2);
}

try {
  main();
} catch {
  process.exit(0);
}
