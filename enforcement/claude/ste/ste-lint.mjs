#!/usr/bin/env node
/**
 * ste-lint - reports the lines of a text that break the writing rules.
 *
 * Four hooks and one git hook ask the same two questions. Is this path a
 * prose target, and at what tier. Which lines break a rule, and what should
 * the writer do next. This module answers both, and every other module here
 * answers one part of that.
 */

import { detectEnglish } from './language.mjs';
import { acronymRule } from './rules-acronym.mjs';
import { hardWordRule, readabilityRule } from './rules-readability.mjs';
import { clausePileupRule, nounStackRule } from './rules-structure.mjs';
import { tangledSentenceRule } from './rules-syntax.mjs';
import { proseBlocks, proseCanvas } from './prose-blocks.mjs';
import { boundaryCuts } from './sentence-split.mjs';
import {
  longSentenceRule, punctuationRule, semicolonRule,
} from './rules-prose.mjs';
import { vocabularyRules } from './rules-vocabulary.mjs';
import { runCli } from './ste-cli.mjs';

export { classify } from './classify.mjs';

/** True only when the environment holds STE_LINT set to off. No marker
 *  inside a file can turn the check off. */
export function isDisabled() {
  return process.env.STE_LINT === 'off';
}

/** One line per finding, ready for a terminal. */
export function format(violations, label) {
  return violations.map((finding) => {
    const mark = finding.sev === 'error' ? 'ERROR' : 'warn ';
    return `${label}:${finding.line}: ${mark} [${finding.rule}] ${finding.msg}`;
  }).join('\n');
}

/** The first part opens the text, so it keeps the white space in front of
 *  it and its offset stays at zero. */
function partFrom(flat, start, end) {
  const raw = flat.slice(start, end);
  if (!raw.trim()) return null;
  const lead = start === 0 ? 0 : raw.length - raw.trimStart().length;
  return { text: raw.slice(lead).trimEnd(), offset: start + lead };
}

/**
 * Split text into sentences. Each offset points into the input with every
 * line break flattened to one space, so the length of the input holds.
 */
export function splitSentences(text) {
  const flat = text.replace(/\n/g, ' ');
  const parts = [];
  let start = 0;
  for (const end of [...boundaryCuts(flat), flat.length]) {
    const part = partFrom(flat, start, end);
    if (part) parts.push(part);
    start = end;
  }
  return parts;
}

/** A heading holds too few words to judge, so it takes the file verdict. */
function languageOf(block, fileLanguage) {
  if (block.heading) return fileLanguage;
  const own = detectEnglish(block.text);
  return own === 'unknown' ? fileLanguage : own;
}

function blockFindings(block, tier, fileLanguage) {
  const found = [...semicolonRule(block), ...longSentenceRule(block, tier)];
  if (languageOf(block, fileLanguage) === 'foreign') return found;
  return found.concat(
    vocabularyRules(block),
    hardWordRule(block),
    readabilityRule(block, tier),
    nounStackRule(block),
    clausePileupRule(block),
    tangledSentenceRule(block),
  );
}

function byPlace(one, other) {
  return one.line - other.line || one.rule.localeCompare(other.rule);
}

/** Every violation in text, ordered by line and then by rule name. */
export function lint(text, options = {}) {
  const tier = options.tier === 'strict' ? 'strict' : 'flavored';
  const canvas = proseCanvas(text, options.kind, options.ext);
  const fileLanguage = detectEnglish(canvas);
  const found = punctuationRule(text);
  if (fileLanguage !== 'foreign') found.push(...acronymRule(canvas));
  for (const block of proseBlocks(canvas)) {
    found.push(...blockFindings(block, tier, fileLanguage));
  }
  return found.sort(byPlace);
}

if (process.argv[1]?.endsWith('ste-lint.mjs')) {
  process.exit(runCli(process.argv.slice(2)));
}
