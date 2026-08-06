/**
 * `.prose-skip` - a one-shot escape from the prose guard.
 *
 * This mirrors the `.quality-skip` sentinel that the quality-guard plugin
 * uses. The two are separate copies on purpose. The prose guard installs into
 * ~/.claude and must not depend on a plugin being present.
 *
 * It replaces the old `ste-lint: off` marker, which was in-band. That marker
 * lived inside the very file under test, the model could write it, and it
 * silently changed the rule for every later edit. The pre-commit hook then
 * stripped it and threw the evidence away.
 *
 * An empty file waives the next blocked write. `{"exempt": true}` also adds
 * the file to a recorded exemption list, which is the deliberate case where a
 * whole file is quoted material or generated text.
 *
 * Each use writes a record and deletes the sentinel, so nobody can leave
 * the escape switched on. A record starts unacknowledged, and the
 * pre-commit hook refuses a commit while any stays open.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const SENTINEL_NAME = '.prose-skip';
export const SKIP_LOG = join('.github', 'quality', 'prose-skip-log.json');
export const EXEMPT_LIST = join('.github', 'quality', 'prose-exempt.json');

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  } catch {
    // A read-only tree must not break the write that already happened.
  }
}

/** Nearest ancestor holding a .git entry, or the start directory itself. */
export function repoRootFor(startDir) {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 40; depth++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(startDir);
}

/** A path relative to its repository root, with forward slashes. */
export function relPathIn(repoRoot, filePath) {
  return relative(repoRoot, resolve(filePath)).split('\\').join('/');
}

/**
 * The sentinel's intent, or null when no sentinel is present.
 * Empty or unparseable content means the plain waiver.
 */
export function readSentinel(repoRoot) {
  const path = join(repoRoot, SENTINEL_NAME);
  if (!existsSync(path)) return null;
  let parsed = {};
  try {
    const text = readFileSync(path, 'utf8').trim();
    if (text) parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  return { exempt: parsed?.exempt === true };
}

export function deleteSentinel(repoRoot) {
  try {
    rmSync(join(repoRoot, SENTINEL_NAME), { force: true });
  } catch {
    // Same reason as above.
  }
}

export function readSkipLog(repoRoot) {
  const log = readJson(join(repoRoot, SKIP_LOG), []);
  return Array.isArray(log) ? log : [];
}

/** Append one consumption record. Returns the record that was written. */
export function recordConsumption(repoRoot, entry) {
  const record = { ...entry, at: new Date().toISOString(), acknowledged: false };
  writeJson(join(repoRoot, SKIP_LOG), [...readSkipLog(repoRoot), record]);
  return record;
}

export function unacknowledged(repoRoot) {
  return readSkipLog(repoRoot).filter((record) => record.acknowledged !== true);
}

/** Paths a human has exempted, relative to the repository root. */
export function readExemptions(repoRoot) {
  const list = readJson(join(repoRoot, EXEMPT_LIST), []);
  return Array.isArray(list) ? list : [];
}

export function isExempt(repoRoot, relPath) {
  return readExemptions(repoRoot).includes(relPath);
}

export function addExemption(repoRoot, relPath) {
  const next = [...new Set([...readExemptions(repoRoot), relPath])].sort();
  writeJson(join(repoRoot, EXEMPT_LIST), next);
  return next;
}
