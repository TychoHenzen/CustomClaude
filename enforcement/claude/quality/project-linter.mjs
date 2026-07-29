/**
 * Run the linter the repository already configures, for the one edited file.
 *
 * Only fast per-file linters belong here. Clippy and dotnet format work on a
 * whole crate or solution, so a per-write hook cannot afford them. Rust and C#
 * therefore get the structural scanner alone.
 *
 * Formatters are left out on purpose. The answer to bad layout is to run the
 * formatter, not to block the write.
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const TIMEOUT_MS = 10_000;

const ESLINT_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const ESLINT_CONFIGS = [
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts',
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
];
const RUFF_CONFIGS = ['ruff.toml', '.ruff.toml', 'pyproject.toml'];

function hasAny(repoRoot, names) {
  return names.some((name) => existsSync(join(repoRoot, name)));
}

function firstExisting(paths) {
  return paths.find((path) => existsSync(path)) || null;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout: TIMEOUT_MS, shell: false,
  });
  return result.stdout || '';
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** ESLint, only from a binary already installed in the repository. */
function eslintFindings(filePath, repoRoot) {
  if (!hasAny(repoRoot, ESLINT_CONFIGS)) return [];
  const binary = firstExisting([
    join(repoRoot, 'node_modules', '.bin', 'eslint.cmd'),
    join(repoRoot, 'node_modules', '.bin', 'eslint'),
  ]);
  if (!binary) return [];

  const parsed = parseJson(run(binary, ['--format=json', filePath], repoRoot));
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((file) => (file.messages || [])
    .filter((message) => message.severity === 2 && message.line)
    .map((message) => ({
      line: message.line,
      rule: message.ruleId || 'eslint',
      message: message.message,
    })));
}

/** Ruff, only when the repository configures it. */
function ruffFindings(filePath, repoRoot) {
  if (!hasAny(repoRoot, RUFF_CONFIGS)) return [];
  const parsed = parseJson(run('ruff', ['check', '--output-format=json', filePath], repoRoot));
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => item.location?.row)
    .map((item) => ({
      line: item.location.row,
      rule: item.code || 'ruff',
      message: item.message,
    }));
}

/** Findings from the repository linter that matches this file. */
export function runProjectLinter(filePath, repoRoot) {
  const lower = filePath.toLowerCase();
  try {
    if (ESLINT_EXT.has(lower.slice(lower.lastIndexOf('.')))) {
      return eslintFindings(filePath, repoRoot);
    }
    if (lower.endsWith('.py')) return ruffFindings(filePath, repoRoot);
  } catch {
    return [];
  }
  return [];
}
