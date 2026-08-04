/**
 * ste-cli - the command line front end for ste-lint.
 *
 * It checks the named files, and standard input when asked, then writes one
 * report per target and hands the exit status back.
 */

import { readFileSync } from 'node:fs';
import { classify, format, isDisabled, lint } from './ste-lint.mjs';

const SETTING = /^--(tier|format|name)=(.*)$/;

function applyArgument(options, argument) {
  const setting = SETTING.exec(argument);
  if (setting) {
    if (setting[2]) options[setting[1]] = setting[2];
    return;
  }
  if (argument === '--stdin') {
    options.stdin = true;
    return;
  }
  options.files.push(argument);
}

function parseArguments(argv) {
  const options = {
    tier: null, format: 'text', name: 'stdin', stdin: false, files: [],
  };
  for (const argument of argv) applyArgument(options, argument);
  return options;
}

/**
 * Check one text under the tier and kind its label asks for. With the
 * checks off it holds no finding at all, so it carries no result.
 */
function checked(text, label, options) {
  if (isDisabled()) return null;
  const info = classify(label);
  const tier = options.tier || info.tier || 'flavored';
  const kind = info.kind || 'markdown';
  return { label, tier, violations: lint(text, { tier, kind, ext: info.ext }) };
}

function fromStdin(options) {
  if (!options.stdin) return [];
  const result = checked(readFileSync(0, 'utf8'), options.name, options);
  return result ? [result] : [];
}

function fromFile(file, options) {
  const info = classify(file);
  if (!info.kind) {
    process.stderr.write(`skip ${file}: ${info.reason}\n`);
    return null;
  }
  return checked(readFileSync(file, 'utf8'), file, options);
}

function fromFiles(options) {
  const results = [];
  for (const file of options.files) {
    const result = fromFile(file, options);
    if (result) results.push(result);
  }
  return results;
}

function writeReport(results, style) {
  if (style === 'json') {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }
  for (const result of results.filter((one) => one.violations.length)) {
    process.stdout.write(`${format(result.violations, result.label)}\n`);
  }
}

function blocking(result) {
  return result.violations.some((finding) => finding.sev === 'error');
}

/** Run the command line and answer with the exit status. */
export function runCli(argv) {
  const options = parseArguments(argv);
  const results = [...fromStdin(options), ...fromFiles(options)];
  writeReport(results, options.format);
  return results.some(blocking) ? 1 : 0;
}
