/**
 * corpus-files - decides which files under a directory count as this
 * project's own writing.
 *
 * local-corpus.mjs turns those files into a vocabulary. This module only
 * answers which files there are, so the two questions stay apart.
 *
 * Git answers first. `git ls-files` lists tracked files, so a file
 * `.gitignore` blocks never appears and neither does one the current turn
 * just wrote. A directory git cannot answer for falls back to a plain walk.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

/** Extensions that carry a project's own words. */
const CORPUS_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.mdx', '.rst',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rs', '.cs', '.go',
  '.java', '.c', '.h', '.cpp', '.hpp', '.php', '.rb', '.sh', '.bash', '.ps1',
  '.psm1', '.swift', '.kt', '.lua', '.sql', '.yml', '.yaml', '.toml',
]);

/**
 * Directory names that hold somebody else's code. A dependency tree votes
 * for its own vocabulary, not this project's, so none of it counts.
 */
const VENDOR_DIRECTORIES = new Set([
  '.git', 'node_modules', 'vendor', 'third_party', 'third-party', 'thirdparty',
  'plugins', 'addons', 'addon', 'extern', 'external', 'deps', 'Pods',
  'bower_components', '.venv', 'venv', 'site-packages', 'dist', 'build',
  'target', 'out', 'bin', 'obj', 'coverage', '__pycache__', '.cache', '.next',
  '.nuxt', '.tox', '.mypy_cache', '.gradle',
]);

/** Work caps. A scan runs inside a hook with a timeout, so each of these
 *  bounds the worst case rather than the usual case. */
const MAX_FILES = 3000;
const MAX_WALK_ENTRIES = 20_000;

/** Every tracked file git lists under root, or null when git cannot answer. */
function trackedFiles(root) {
  const run = spawnSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'utf8', maxBuffer: 32_000_000, windowsHide: true,
  });
  if (run.status !== 0 || typeof run.stdout !== 'string') return null;
  return run.stdout.split('\0').filter(Boolean).map((rel) => join(root, rel));
}

function isVendorPath(root, path) {
  const rel = path.slice(root.length);
  return rel.split(/[\\/]/).some((part) => VENDOR_DIRECTORIES.has(part));
}

/** Read one directory, or nothing at all when it cannot be read. */
function entriesOf(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Walk root for files. Used only when git cannot list the tree. */
function walkFiles(root) {
  const found = [];
  const queue = [root];
  let seen = 0;
  while (queue.length && found.length < MAX_FILES && seen < MAX_WALK_ENTRIES) {
    const dir = queue.shift();
    for (const entry of entriesOf(dir)) {
      seen++;
      if (entry.isFile()) found.push(join(dir, entry.name));
      else if (entry.isDirectory() && !VENDOR_DIRECTORIES.has(entry.name)) {
        queue.push(join(dir, entry.name));
      }
    }
  }
  return found;
}

/** Every file under root whose words count toward the project vocabulary. */
export function corpusFiles(root) {
  const listed = trackedFiles(root) ?? walkFiles(root);
  return listed
    .filter((path) => CORPUS_EXTENSIONS.has(extname(path).toLowerCase()))
    .filter((path) => !isVendorPath(root, path))
    .slice(0, MAX_FILES);
}
