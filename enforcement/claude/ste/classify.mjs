/**
 * classify - decides whether a path is a prose target, and at what tier.
 *
 * It reads no file and runs no rule. The answer rests on the path alone, so
 * a caller can ask before it loads anything.
 */

import { basename, extname } from 'node:path';

const PROSE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.mdx', '.rst']);

const SOURCE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rs', '.cs', '.go',
  '.java', '.c', '.h', '.cpp', '.php', '.rb', '.sh', '.bash', '.ps1',
  '.swift', '.kt',
]);

/** A prose file whose name holds one of these reads as a procedure. */
const PROCEDURE_NAMES = [
  'runbook', 'procedure', 'playbook', 'install', 'security', 'troubleshoot',
  'incident', 'migration', 'upgrade', 'error',
];

/**
 * Paths nobody writes by hand, or that a build wrote. A directory needs a
 * real separator in front of it in the path as given. So a name that opens
 * a relative path is a name, not a build directory.
 */
const IGNORED_PARTS = [
  'node_modules', '/.git/', '/dist/', '/build/', '/target/', '/vendor/',
  '/.venv/', 'changelog', 'license', 'package-lock', '.min.',
];

function tierFor(name) {
  const lower = name.toLowerCase();
  const strict = PROCEDURE_NAMES.some((hint) => lower.includes(hint));
  return strict ? 'strict' : 'flavored';
}

function isIgnored(path) {
  const lower = path.toLowerCase();
  return IGNORED_PARTS.some((part) => lower.includes(part));
}

function byExtension(path) {
  const ext = extname(path).toLowerCase();
  if (PROSE_EXTENSIONS.has(ext)) {
    return { kind: 'markdown', ext, tier: tierFor(basename(path)) };
  }
  if (SOURCE_EXTENSIONS.has(ext)) return { kind: 'code', ext, tier: 'flavored' };
  return { kind: null, reason: 'not a prose target' };
}

/** What kind of target filePath is, and at what tier it reads. */
export function classify(filePath) {
  if (!filePath) return { kind: null };
  const path = String(filePath).replace(/\\/g, '/');
  if (isIgnored(path)) return { kind: null, reason: 'excluded path' };
  return byExtension(path);
}
