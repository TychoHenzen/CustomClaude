#!/usr/bin/env node
/**
 * Lint a commit message. Called by the global commit-msg git hook.
 *
 * The subject line keeps its own rules: it is a fragment, so sentence length
 * and semicolon checks do not apply to it. The body is flavored-tier prose.
 * Comment lines, trailers, change tags, and generated merge or revert
 * messages are skipped.
 *
 * Exit 1 rejects the commit.
 */

import { readFileSync } from 'node:fs';
import { lint, isDisabled, format } from './ste-lint.mjs';

const SUBJECT_MAX = 72;
const SKIP_SUBJECT = /^(Merge|Revert|fixup!|squash!|Applying|Rebase)/;
// Known git trailer keys only. A pattern like /^[A-Za-z-]+:/ would also eat
// conventional-commit subjects such as "feat: ...".
const TRAILER = /^(Co-Authored-By|Signed-off-by|Change-Id|Reviewed-by|Acked-by|Tested-by|Refs|Closes|Fixes|Resolves|BREAKING[- ]CHANGE|See-also|Cc):/i;
// A body bullet may open with a short capital tag naming the kind of change:
// "- ADD: ...", "- CHG: ...", "- REM: ...". The tag labels the bullet, it is
// not part of the sentence, so the acronym rule has nothing to ask for here.
const CHANGE_TAG = /^(\s*[-*]\s*)([A-Z][A-Z0-9]{1,5}:)(\s)/;

/**
 * Body line with its leading change tag replaced by spaces. The blanking
 * keeps every later column where it was, so reported line and column numbers
 * still point at the real text.
 */
export function stripChangeTag(line) {
  return line.replace(CHANGE_TAG, (_, lead, tag, tail) => lead + ' '.repeat(tag.length) + tail);
}

function main() {
  const path = process.argv[2];
  if (!path) process.exit(0);

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    process.exit(0);
  }
  if (isDisabled(raw)) process.exit(0);

  const all = raw.split('\n');
  const kept = all.map((l) => (l.startsWith('#') || TRAILER.test(l) ? '' : l));
  const subject = (kept.find((l) => l.trim()) || '').trim();
  if (!subject || SKIP_SUBJECT.test(subject)) process.exit(0);

  const subjectIndex = kept.findIndex((l) => l.trim());
  const body = kept
    .map((l, i) => (i <= subjectIndex ? '' : stripChangeTag(l)))
    .join('\n');

  const problems = [];
  if (subject.length > SUBJECT_MAX) {
    problems.push({ line: subjectIndex + 1, sev: 'error', rule: 'subject-length', msg: `subject is ${subject.length} characters, cap is ${SUBJECT_MAX}.` });
  }
  // The subject is a fragment. Check its vocabulary only.
  problems.push(...lint(subject, { tier: 'flavored', kind: 'markdown' })
    .filter((v) => v.rule !== 'long-sentence' && v.rule !== 'weak-opener')
    .map((v) => ({ ...v, line: subjectIndex + 1 })));
  problems.push(...lint(body, { tier: 'flavored', kind: 'markdown' }));

  const errors = problems.filter((v) => v.sev === 'error');
  if (!errors.length) process.exit(0);

  process.stderr.write(
    `\nste-lint rejected this commit message. ${errors.length} violations:\n\n`
    + `${format(errors, 'commit-msg')}\n\n`
    + 'Rewrite it: short common words, active voice, no semicolons, no contractions,\n'
    + 'ASCII punctuation only. To bypass once, commit with --no-verify.\n\n',
  );
  process.exit(1);
}

if (process.argv[1]?.endsWith('ste-commit-msg.mjs')) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}
