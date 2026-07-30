#!/usr/bin/env node
/**
 * Fail while any prose-gate waiver is still unacknowledged.
 *
 * The pre-commit hook runs this. It mirrors check-skips.mjs in the
 * quality-guard plugin, for the prose half.
 *
 *   node check-skips.mjs [repoRoot]
 *
 * Exit 0 when nothing is open. Exit 1 when a waiver needs a human.
 */

import { unacknowledged, EXEMPT_LIST, SKIP_LOG } from './sentinel.mjs';

/** Windows join gives backslashes. Show a path the reader can paste. */
const show = (p) => p.split('\\').join('/');

export function renderOpen(records) {
  const lines = [`ste-lint: ${records.length} unacknowledged prose waiver(s).`, ''];
  for (const record of records) {
    const kind = record.exempt ? 'file exempted' : 'one write waived';
    lines.push(`  ${record.file}  [${kind}]  ${record.at ?? 'unknown time'}`);
  }
  lines.push('');
  lines.push(`Review each one, then set "acknowledged": true in ${show(SKIP_LOG)}.`);
  lines.push(`Exempted files are listed in ${show(EXEMPT_LIST)}.`);
  return lines.join('\n');
}

export function main(root) {
  const open = unacknowledged(root);
  if (open.length === 0) return 0;
  process.stderr.write(`${renderOpen(open)}\n`);
  return 1;
}

if (process.argv[1]?.endsWith('check-skips.mjs')) {
  process.exit(main(process.argv[2] ?? process.cwd()));
}
