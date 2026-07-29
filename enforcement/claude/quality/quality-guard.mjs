#!/usr/bin/env node
/**
 * quality-guard - PostToolUse gate for code structure.
 *
 * It runs the quality-refactor scanner on the one file that was written, then
 * decides with a ratchet rather than an absolute bound:
 *
 *   Tracked file  - block when an error-severity rule count rises above the
 *                   recorded baseline. Warn-severity counts are free.
 *   New file      - block only when a metric passes a generous ceiling, set at
 *                   NEW_FILE_FACTOR times the hard bound. A first draft gets
 *                   room. The baseline then holds it to that shape.
 *   No baseline   - seed the baseline from this scan and let the write pass.
 *
 * The project linter runs first when the repository configures one. Its
 * findings are reported only on the lines that this tool call wrote.
 *
 * Exit 0 always on internal failure. A broken gate must not stop work.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { scopeToChangedLines } from '../lib/changed-lines.mjs';
import { runProjectLinter } from './project-linter.mjs';

const CODE_EXT = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.cs', '.rs', '.py', '.go', '.java', '.kt', '.cpp', '.cc', '.hpp', '.h',
]);

/** Hard bounds copied from the scanner config. A new file gets these times NEW_FILE_FACTOR. */
const ERROR_BOUNDS = {
  'line-length': 120,
  'file-length': 300,
  'function-length': 60,
  complexity: 10,
  'param-count': 7,
  'nesting-depth': 5,
};
const NEW_FILE_FACTOR = 1.5;

/**
 * Rules a single-file scan can decide. duplicate-block, dead-export and
 * test-only-export need whole-project reachability, so a per-file gate would
 * call every export dead. Run those in a repository-wide scan instead.
 */
const FILE_RULES = [
  'line-length', 'file-length', 'function-length', 'complexity', 'param-count',
  'nesting-depth', 'types-per-file', 'else-branch', 'unnamed-tuple',
  'unused-local', 'commented-out-code', 'todo-marker', 'stateless-method',
].join(',');

const BASELINE_NAME = '.quality-baseline.json';
const SCAN_TIMEOUT_MS = 20_000;
const MAX_REPORTED = 20;

const SCANNER_PATHS = [
  'plugins/marketplaces/dod-guard/packages/dod-guard/skills/quality-refactor/scripts/quality-scan.mjs',
  'skills/quality-refactor/scripts/quality-scan.mjs',
  'quality/quality-scan.mjs',
];

// ---------------------------------------------------------------------------
// Locating things
// ---------------------------------------------------------------------------

function claudeHome() {
  return join(process.env.USERPROFILE || process.env.HOME || '', '.claude');
}

/** Path to the scanner, or null when the quality-refactor skill is absent. */
function findScanner() {
  for (const candidate of SCANNER_PATHS) {
    const full = join(claudeHome(), candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

/** Nearest ancestor holding a .git entry, or the file directory. */
function findRepoRoot(filePath) {
  let dir = dirname(resolve(filePath));
  for (let depth = 0; depth < 40; depth++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(resolve(filePath));
}

function isTracked(repoRoot, filePath) {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', filePath], {
    cwd: repoRoot, encoding: 'utf8', timeout: 5000,
  });
  return result.status === 0;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function runScanner(scanner, filePath, repoRoot) {
  const result = spawnSync(process.execPath, [
    scanner, filePath, `--root=${repoRoot}`, '--format=json', `--rules=${FILE_RULES}`,
  ], { encoding: 'utf8', timeout: SCAN_TIMEOUT_MS, cwd: repoRoot });
  if (!result.stdout) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function countByRule(violations) {
  const counts = {};
  for (const violation of violations) {
    counts[violation.rule] = (counts[violation.rule] ?? 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

function readBaseline(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && parsed.counts ? parsed : null;
  } catch {
    return null;
  }
}

function baselineCountsFor(baseline, relPath) {
  const counts = {};
  const prefix = `${relPath}::`;
  for (const [key, value] of Object.entries(baseline.counts)) {
    if (key.startsWith(prefix)) counts[key.slice(prefix.length)] = value;
  }
  return counts;
}

/** Replace this file's rows with the current counts, then write the file back. */
function saveBaseline(path, baseline, relPath, counts) {
  const next = baseline || { version: 1, profile: 'default', total: 0, counts: {} };
  const prefix = `${relPath}::`;
  for (const key of Object.keys(next.counts)) {
    if (key.startsWith(prefix)) delete next.counts[key];
  }
  for (const [rule, value] of Object.entries(counts)) {
    next.counts[`${prefix}${rule}`] = value;
  }
  next.total = Object.values(next.counts).reduce((sum, value) => sum + value, 0);
  next.updatedAt = new Date().toISOString();
  try {
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  } catch {
    // A read-only tree must not break the write that already happened.
  }
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/** A new file passes unless a metric goes past the generous ceiling. */
function newFileVerdict(violations) {
  const blocking = [];
  for (const violation of violations) {
    const bound = ERROR_BOUNDS[violation.rule];
    if (bound === undefined || typeof violation.metric !== 'number') continue;
    const ceiling = Math.round(bound * NEW_FILE_FACTOR);
    if (violation.metric > ceiling) {
      blocking.push(`${violation.file}:${violation.line}: ${violation.message} (new-file ceiling ${ceiling})`);
    }
  }
  return blocking;
}

/** A tracked file may not raise the count of any error-severity rule. */
function ratchetVerdict(violations, before) {
  const errors = violations.filter((violation) => violation.severity === 'error');
  const now = countByRule(errors);
  const blocking = [];
  for (const [rule, count] of Object.entries(now)) {
    const was = before[rule] ?? 0;
    if (count <= was) continue;
    const worst = errors.filter((violation) => violation.rule === rule).slice(0, 3);
    const detail = worst.map((v) => `  ${v.file}:${v.line}: ${v.message}`).join('\n');
    blocking.push(`${rule}: ${was} before, ${count} now\n${detail}`);
  }
  return blocking;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function report(header, lines, tail) {
  const shown = lines.slice(0, MAX_REPORTED);
  const extra = lines.length - shown.length;
  const body = [header, '', ...shown, extra > 0 ? `... and ${extra} more.` : '', '', tail];
  process.stderr.write(`${body.filter(Boolean).join('\n')}\n`);
  process.exit(2);
}

function gate(input, filePath) {
  const scanner = findScanner();
  if (!scanner) process.exit(0);

  const repoRoot = findRepoRoot(filePath);
  const scan = runScanner(scanner, filePath, repoRoot);
  if (!scan || !Array.isArray(scan.violations)) process.exit(0);

  // Derive the key from the path, not from the scan. A clean file has no row
  // in byFile, and it still needs a baseline entry so the ratchet engages.
  const relPath = relative(repoRoot, resolve(filePath)).split('\\').join('/');
  const baselinePath = join(repoRoot, BASELINE_NAME);
  const baseline = readBaseline(baselinePath);
  const counts = countByRule(scan.violations);

  if (!baseline) {
    saveBaseline(baselinePath, null, relPath, counts);
    process.exit(0);
  }

  const tracked = isTracked(repoRoot, filePath);
  const blocking = tracked
    ? ratchetVerdict(scan.violations, baselineCountsFor(baseline, relPath))
    : newFileVerdict(scan.violations);

  if (blocking.length) {
    report(
      `quality-guard blocked this write. ${filePath} got structurally worse.`,
      blocking,
      tracked
        ? 'Fix the new violations, or split the change. The baseline records what was\n'
          + 'already there, so only the increase blocks. Run the scanner directly:\n'
          + `  node "${scanner}" "${filePath}" --root="${repoRoot}"`
        : 'This file is new, so only the generous ceiling applies. Split it up.',
    );
  }

  saveBaseline(baselinePath, baseline, relPath, counts);
  const linterFindings = scopeToChangedLines(input, runProjectLinter(filePath, repoRoot));
  if (linterFindings.length) {
    report(
      `The project linter rejected lines this edit wrote in ${filePath}.`,
      linterFindings.map((f) => `${f.line}: ${f.rule ? `[${f.rule}] ` : ''}${f.message}`),
      'These rules come from the repository config, not from this hook.',
    );
  }
  process.exit(0);
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }
  if (!input || process.env.QUALITY_GUARD === 'off') process.exit(0);
  if (!/^(Write|Edit|MultiEdit)$/.test(input.tool_name || '')) process.exit(0);

  const filePath = input.tool_input?.file_path;
  if (!filePath || !CODE_EXT.has(extname(filePath).toLowerCase())) process.exit(0);
  if (!existsSync(filePath)) process.exit(0);
  if (/quality-guard:\s*off/i.test(readFileSync(filePath, 'utf8').slice(0, 500))) process.exit(0);

  gate(input, filePath);
}

try {
  main();
} catch {
  process.exit(0);
}
