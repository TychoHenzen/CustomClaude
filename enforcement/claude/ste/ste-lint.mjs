#!/usr/bin/env node
/**
 * ste-lint - mechanical checker for sentence structure and word readability.
 *
 * Checks only the rules a machine can decide: sentence length, semicolons,
 * slop words, filler openers, nominalizations, weak openers, and the em
 * dash. It cannot judge whether a sentence is true or whether a technical
 * noun is the right one.
 *
 * Tiers:
 *   strict   - procedures, runbooks, error messages. 20-word sentence cap.
 *   flavored - READMEs, docs, comments, commit bodies. 25-word sentence cap.
 *
 * Severities:
 *   error - blocks (hooks exit 2)
 *   warn  - reported, never blocks.
 *
 * CLI:
 *   node ste-lint.mjs [--tier=strict|flavored] [--format=text|json] <file>...
 *   node ste-lint.mjs --stdin [--tier=...] [--name=label]
 * Exit 1 if any error-severity violation was found.
 */

import { readFileSync } from 'node:fs';
import { basename, extname, sep } from 'node:path';
import { hardWordRule, readabilityRule } from './rules-readability.mjs';
import { nounStackRule, clausePileupRule } from './rules-structure.mjs';

// ---------------------------------------------------------------------------
// Dictionaries
// ---------------------------------------------------------------------------

/** Slop: marketing adjectives and decorative vocabulary. Flagged in both tiers. */
const SLOP = [
  ['seamless(ly)?', 'say what actually happens'],
  ['robust', 'say what it survives'],
  ['powerful', 'say what it does'],
  ['cutting[- ]edge', 'drop it'],
  ['effortless(ly)?', 'drop it'],
  ['world[- ]class', 'drop it'],
  ['next[- ]generation', 'drop it'],
  ['revolutionary', 'drop it'],
  ['game[- ]chang(er|ing)', 'drop it'],
  ['blazing(ly)? fast', 'give the number'],
  ['leverage', 'use'],
  ['utilize', 'use'],
  ['facilitate', 'help'],
  ['seek to', 'try to'],
  ['delve into', 'read'],
  ['unlock', 'say what it enables'],
  ['elevate', 'say what improves'],
  ['streamline', 'simplify'],
  ['holistic', 'say what it covers'],
  ['paradigm', 'say the actual approach'],
  ['synerg(y|ies|istic)', 'drop it'],
  ['best[- ]in[- ]class', 'drop it'],
  ['state[- ]of[- ]the[- ]art', 'drop it'],
  ['comprehensive', 'say what it includes'],
  ['plethora', 'many'],
  ['myriad', 'many'],
];

/** Filler openers and stacked auxiliaries. Both tiers. */
const FILLER = [
  'it is important to note that',
  'it should be noted that',
  'it is worth noting that',
  'please note that',
  'it is worth mentioning that',
  'needless to say',
  'as we can see',
  'we can see that',
  'in conclusion',
  'at the end of the day',
  'when it comes to',
  'in today\'s .{0,20}world',
  'let us dive in',
  'buckle up',
];

/**
 * Names of the em dash HTML entities, without the leading `&` or trailing
 * `;`. Held apart like this so the assembled entity text never sits in the
 * source as a literal string. This rule runs on raw text on purpose, so a
 * literal entity here would trip the rule against its own definition.
 */
const EM_DASH_ENTITY_NAMES = ['mdash', 'emdash', '#8212', '#x2014'];

function emDashEntityPattern() {
  const amp = String.fromCharCode(38);
  const semi = String.fromCharCode(59);
  return EM_DASH_ENTITY_NAMES.map((name) => `${amp}${name}${semi}`).join('|');
}

/**
 * The em dash, in every spelling that reaches the raw text. This covers the
 * literal character, the named HTML entity, the same entity misspelled with
 * a leading e, and both numeric entity forms. The em dash corrupts on this
 * machine when UTF-8 text gets read back as cp1252. That has already
 * damaged a repository. Every other non-ASCII punctuation mark reads fine
 * and stays unchecked.
 */
const BAD_PUNCT = [
  [new RegExp(`\\u2014|${emDashEntityPattern()}`, 'i'), 'em dash', '-'],
];

const ABBREV = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'cf', 'al', 'approx', 'fig', 'no', 'dr', 'mr', 'ms',
  'mrs', 'st', 'jr', 'sr', 'inc', 'ltd', 'ca', 'esp', 'min', 'max', 'sec', 'ver',
]);

// ---------------------------------------------------------------------------
// Masking - remove regions that are not prose
// ---------------------------------------------------------------------------

const NUL = '\u0000';

function blank(s) {
  return s.replace(/[^\n]/g, NUL);
}

/**
 * Return the text with every non-prose region replaced by NUL, keeping every
 * character position and line break. Returns null-masked text plus the set of
 * lines that are structural (headings, list markers) for the length rule.
 */
function maskMarkdown(text) {
  const lines = text.split('\n');
  const out = new Array(lines.length);
  const heading = new Set();
  let inFence = false;
  let fenceMark = '';
  let inFrontMatter = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (i === 0 && (trimmed === '---' || trimmed === '+++')) {
      inFrontMatter = true;
      out[i] = blank(line);
      continue;
    }
    if (inFrontMatter) {
      out[i] = blank(line);
      if (trimmed === '---' || trimmed === '+++') inFrontMatter = false;
      continue;
    }

    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMark = fence[1][0];
      } else if (fence[1][0] === fenceMark) {
        inFence = false;
      }
      out[i] = blank(line);
      continue;
    }
    if (inFence) {
      out[i] = blank(line);
      continue;
    }

    // Tables, blockquotes, horizontal rules, link-reference definitions.
    if (/^\s*\|/.test(line) || /^\s*>/.test(line) || /^\s*(-{3,}|={3,}|\*{3,})\s*$/.test(line)
      || /^\s*\[[^\]]+\]:\s*\S+/.test(line)) {
      out[i] = blank(line);
      continue;
    }

    // Headings keep their words for vocabulary checks but are not sentences.
    if (/^\s*#{1,6}\s/.test(line)) heading.add(i);

    out[i] = line;
  }

  let masked = out.join('\n');

  // Inline regions, in order: HTML comments, code spans, quoted speech, links,
  // bare URLs, paths. Quoted speech runs after code spans and before links.
  // A code span that holds a quote character stays masked as code first.
  // A quoted span that holds a path or a flag gets masked whole first, so
  // the later path and flag patterns cannot split it apart.
  masked = maskPattern(masked, /<!--[\s\S]*?-->/g);
  // A code span may wrap one line, so allow a single newline inside it.
  masked = maskPattern(masked, /`[^`\n]*(\n[^`\n]*)?`/g);
  // Only the ASCII double quote opens and closes a span. An apostrophe would
  // close it early. Allow at most one newline inside, the same allowance the
  // code span pattern makes. A blank line has no non-newline character for
  // `[^"\n]` to eat, so a span never crosses one.
  masked = maskPattern(masked, /"[^"\n]*(\n[^"\n]*)?"/g);
  masked = maskPattern(masked, /\]\([^)\s]*\)/g);
  masked = maskPattern(masked, /\bhttps?:\/\/\S+/g);
  masked = maskPattern(masked, /\b[\w.-]+\.(md|js|mjs|ts|py|ps1|cmd|json|yaml|yml|rs|cs|sh|txt|toml)\b/g);
  masked = maskPattern(masked, /(^|\s)[-\w.]*[\\/][-\w./\\*]+/g);
  masked = maskPattern(masked, /\B(--?[a-zA-Z][\w-]*)/g);

  return { masked, heading };
}

function maskPattern(text, re) {
  return text.replace(re, (m) => blank(m));
}

const HASH_LANGS = ['.py', '.sh', '.bash', '.ps1', '.rb', '.yml', '.yaml', '.toml', '.pl'];
const SLASH_LANGS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.rs', '.cs', '.go',
  '.java', '.c', '.h', '.cpp', '.php', '.swift', '.kt', '.scala'];

/**
 * Find the first comment marker on a line that is not inside a string literal.
 * Quote state resets at the end of each line, so an unbalanced quote inside a
 * regex literal costs at most one line of coverage.
 */
function findComment(line, slash, hash) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (slash && c === '/' && line[i + 1] === '/') return { type: 'line', at: i + 2 };
    if (slash && c === '/' && line[i + 1] === '*') return { type: 'block', at: i + 2 };
    if (hash && c === '#') return { type: 'line', at: i + 1 };
  }
  return null;
}

/** Strip code and markup from a source file, keeping comment prose and message strings. */
function extractComments(text, ext) {
  const lines = text.split('\n');
  const out = lines.map(() => '');
  const hash = HASH_LANGS.includes(ext);
  const slash = SLASH_LANGS.includes(ext);
  let inBlock = false;
  let inDocstring = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let prose = '';

    if (inBlock) {
      const end = line.indexOf('*/');
      prose = end >= 0 ? line.slice(0, end) : line;
      if (end >= 0) inBlock = false;
      prose = prose.replace(/^\s*\*\s?/, '');
    } else if (inDocstring) {
      const end = line.indexOf('"""');
      prose = end >= 0 ? line.slice(0, end) : line;
      if (end >= 0) inDocstring = false;
    } else if (hash && /"""/.test(line)) {
      const open = line.indexOf('"""');
      const end = line.indexOf('"""', open + 3);
      prose = end >= 0 ? line.slice(open + 3, end) : line.slice(open + 3);
      if (end < 0) inDocstring = true;
    } else if (!/^#!/.test(line.trim())) {
      const mark = findComment(line, slash, hash);
      if (mark && mark.type === 'line') {
        prose = line.slice(mark.at);
      } else if (mark) {
        const end = line.indexOf('*/', mark.at);
        prose = end >= 0 ? line.slice(mark.at, end) : line.slice(mark.at);
        if (end < 0) inBlock = true;
      }
    }

    // User-facing message strings.
    if (!prose) {
      const msg = line.match(/(?:throw new \w+|Error|panic!|raise \w+|Write-Host|console\.(?:error|warn)|print)\(\s*["'`]([^"'`]{20,})["'`]/);
      if (msg) prose = msg[1];
    }

    // Drop tokens that are not prose: doc tags, code spans, types, paths, flags.
    prose = prose
      .replace(/@\w+/g, '')
      .replace(/`[^`]*`/g, '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\b[\w.]+\([^)]*\)/g, '');
    out[i] = /[a-z]{3}/.test(prose) ? prose : '';
  }

  return { masked: out.join('\n'), heading: new Set() };
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

/** Split masked text into prose blocks. A block never spans a blank line, a
 *  heading, or a list-item boundary, so a bullet list is not one long sentence. */
function segments(masked, heading) {
  const lines = masked.split('\n');
  const blocks = [];
  let current = null;

  const flush = () => {
    if (current && /[a-z]{3}/i.test(current.text)) blocks.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const text = raw.replace(new RegExp(NUL, 'g'), ' ');
    const isBlank = !text.trim();
    const isItem = /^\s*([-*+]|\d+[.)])\s+/.test(text);

    if (isBlank || heading.has(i)) {
      flush();
      if (heading.has(i)) blocks.push({ line: i, text: text.replace(/^\s*#+\s*/, ''), heading: true });
      continue;
    }
    if (isItem) flush();

    const stripped = isItem ? text.replace(/^\s*([-*+]|\d+[.)])\s+/, '') : text;
    if (!current) current = { line: i, text: stripped, heading: false };
    else current.text += `\n${stripped}`;
  }
  flush();
  return blocks;
}

/** Separator characters that end a sentence like a period, when a run of
 *  them stands between white space. Used for index and apparatus lines,
 *  e.g. entries joined by a middle dot, a bullet, or a table pipe. */
const SEPARATOR_CHARS = '\u00b7\u2022|';

export function splitSentences(text) {
  const flat = text.replace(/\n/g, ' ');
  const parts = [];
  let start = 0;

  // A sentence starts at its first word, not at the white space before it.
  // `lineOf` counts the line breaks strictly before an offset, so an offset
  // that still points at the break reports the line above. A sentence that
  // begins right after a line break would then be reported one line early.
  const firstWord = (at) => {
    let k = at;
    while (k < flat.length && /\s/.test(flat[k])) k++;
    return k;
  };

  for (let i = 0; i < flat.length; i++) {
    if (SEPARATOR_CHARS.includes(flat[i])) {
      if (!/\s/.test(flat[i - 1] ?? '')) continue;
      let j = i;
      while (j < flat.length && SEPARATOR_CHARS.includes(flat[j])) j++;
      if (!/\s/.test(flat[j] ?? ' ')) continue;
      parts.push({ text: flat.slice(start, j), offset: start });
      start = firstWord(j);
      i = j - 1;
      continue;
    }
    if (!'.!?'.includes(flat[i])) continue;
    if (!/\s/.test(flat[i + 1] ?? ' ')) continue;
    const before = flat.slice(Math.max(0, i - 12), i).match(/([\w.]+)$/);
    const word = before ? before[1].toLowerCase() : '';
    if (ABBREV.has(word) || /^[a-z]$/.test(word)) continue;
    // A bare number before the period is an enumerator only where a segment
    // starts, as in "1. Do this". Anywhere else the number ends a sentence.
    // Skipping every number glued such a sentence to the next one and reported
    // one false long-sentence error over the pair.
    if (/^\d+$/.test(word) && !flat.slice(start, i - word.length).trim()) continue;
    parts.push({ text: flat.slice(start, i + 1), offset: start });
    start = firstWord(i + 1);
  }
  if (start < flat.length) parts.push({ text: flat.slice(start), offset: start });
  return parts.filter((p) => p.text.trim());
}

function countWords(sentence) {
  const words = sentence.match(/[A-Za-z0-9][A-Za-z0-9'\-\u2019]*/g);
  return words ? words.length : 0;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function lineOf(block, offsetInBlock) {
  const flatToReal = block.text.slice(0, offsetInBlock);
  return block.line + (flatToReal.match(/\n/g) || []).length + 1;
}

function scan(block, re, make, found) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(block.text)) !== null) {
    found.push({ line: lineOf(block, m.index), ...make(m) });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
}

/** Match the word plus its common inflections, so a plural form still trips. */
function wordRe(pattern, inflect = true) {
  const tail = inflect ? '(?:s|es|d|ed|ing)?' : '';
  return new RegExp(`\\b(${pattern})${tail}\\b`, 'gi');
}

export function lint(text, options = {}) {
  const tier = options.tier === 'strict' ? 'strict' : 'flavored';
  const kind = options.kind || 'markdown';
  const cap = tier === 'strict' ? 20 : 25;
  const found = [];

  const { masked, heading } = kind === 'code'
    ? extractComments(text, options.ext || '.js')
    : maskMarkdown(text);

  for (const block of segments(masked, heading)) {
    if (!block.heading) {
      for (const s of splitSentences(block.text)) {
        const n = countWords(s.text);
        if (n > cap) {
          found.push({
            line: lineOf(block, s.offset),
            rule: 'long-sentence',
            sev: 'error',
            msg: `sentence is ${n} words, cap is ${cap}. Split it.`,
            hint: s.text.trim().slice(0, 60),
          });
        }
      }
      // An HTML entity ends in a semicolon that closes the entity, not the sentence.
      // Skip the named form, the decimal numeric form, and the hex numeric form.
      scan(block, /(?<!&[A-Za-z0-9]{1,31})(?<!&#[0-9]{1,10})(?<!&#[xX][0-9A-Fa-f]{1,8});/g, () => ({
        rule: 'semicolon', sev: 'error', msg: 'no semicolons. Write two sentences.',
      }), found);
    }

    for (const [pat, fix] of SLOP) {
      scan(block, wordRe(pat), (m) => ({
        rule: 'slop-word', sev: 'error', msg: `"${m[1]}" - ${fix}.`,
      }), found);
    }
    for (const pat of FILLER) {
      scan(block, wordRe(pat, false), (m) => ({
        rule: 'filler', sev: 'error', msg: `"${m[1]}" - delete it, state the fact.`,
      }), found);
    }

    scan(block, /\b(perform|conduct|carry out|provide|make)\s+(a|an|the)\s+(\w+(?:ation|ysis|ment|ance|ence|ing))\b/gi, (m) => ({
      rule: 'nominalization', sev: 'error', msg: `"${m[0]}" - use the verb directly.`,
    }), found);

    scan(block, /\bthere (is|are|was|were)\s+(a|an|no|some|many|several)\b/gi, (m) => ({
      rule: 'weak-opener', sev: 'warn', msg: `"${m[0]}" - name the subject.`,
    }), found);

    found.push(...hardWordRule(block, tier));
    found.push(...readabilityRule(block, tier));
    found.push(...nounStackRule(block, tier));
    found.push(...clausePileupRule(block, tier));
  }

  // Punctuation is checked on the raw text, since code blocks must be clean too.
  const rawLines = text.split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    for (const [re, name, fix] of BAD_PUNCT) {
      if (re.test(rawLines[i])) {
        found.push({
          line: i + 1, rule: 'punctuation', sev: 'error',
          msg: `${name} is banned on this machine, it corrupts on re-encode. Use ${fix}.`,
        });
      }
    }
  }

  found.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return found;
}

// ---------------------------------------------------------------------------
// Tier and target selection
// ---------------------------------------------------------------------------

const STRICT_HINT = /(runbook|procedure|playbook|install|security|troubleshoot|incident|migration|upgrade|error)/i;

const PROSE_EXT = new Set(['.md', '.markdown', '.txt', '.mdx', '.rst']);
const CODE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rs', '.cs', '.go',
  '.java', '.c', '.h', '.cpp', '.php', '.rb', '.sh', '.bash', '.ps1', '.swift', '.kt',
]);

const SKIP_PATH = /(node_modules|[\\/]\.git[\\/]|[\\/]dist[\\/]|[\\/]build[\\/]|[\\/]target[\\/]|[\\/]vendor[\\/]|[\\/]\.venv[\\/]|CHANGELOG|LICENSE|package-lock|\.min\.)/i;

export function classify(filePath) {
  if (!filePath) return { kind: null };
  const p = filePath.split(sep).join('/');
  if (SKIP_PATH.test(p)) return { kind: null, reason: 'excluded path' };
  const ext = extname(p).toLowerCase();
  const name = basename(p);
  if (PROSE_EXT.has(ext)) {
    return { kind: 'markdown', ext, tier: STRICT_HINT.test(name) ? 'strict' : 'flavored' };
  }
  if (CODE_EXT.has(ext)) return { kind: 'code', ext, tier: 'flavored' };
  return { kind: null, reason: 'not a prose target' };
}

/**
 * Only an operator can switch the linter off, and only for one command.
 *
 * There used to be an in-band `ste-lint: off` marker read from the file head.
 * That put the switch inside the thing under test. The writer could disable
 * its own check, and every later edit to that file stayed unchecked. Use a
 * `.prose-skip` sentinel instead. A sentinel is out-of-band, works once, and
 * leaves a record.
 */
export function isDisabled(_text) {
  return process.env.STE_LINT === 'off';
}

export function format(violations, label) {
  return violations
    .map((v) => `${label}:${v.line}: ${v.sev === 'error' ? 'ERROR' : 'warn '} [${v.rule}] ${v.msg}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const files = [];
  let tier = null;
  let fmt = 'text';
  let stdin = false;
  let name = 'stdin';

  for (const arg of argv) {
    if (arg.startsWith('--tier=')) tier = arg.slice(7);
    else if (arg.startsWith('--format=')) fmt = arg.slice(9);
    else if (arg.startsWith('--name=')) name = arg.slice(7);
    else if (arg === '--stdin') stdin = true;
    else files.push(arg);
  }

  const targets = [];
  if (stdin) {
    targets.push({ label: name, text: readFileSync(0, 'utf8'), ...classify(name) });
  }
  for (const f of files) {
    const info = classify(f);
    if (!info.kind) {
      process.stderr.write(`skip ${f}: ${info.reason}\n`);
      continue;
    }
    targets.push({ label: f, text: readFileSync(f, 'utf8'), ...info });
  }

  const all = [];
  for (const t of targets) {
    const kind = t.kind || 'markdown';
    const use = tier || t.tier || 'flavored';
    if (isDisabled(t.text)) continue;
    const v = lint(t.text, { tier: use, kind, ext: t.ext });
    all.push({ label: t.label, tier: use, violations: v });
  }

  if (fmt === 'json') {
    process.stdout.write(`${JSON.stringify(all, null, 2)}\n`);
  } else {
    for (const r of all) {
      if (r.violations.length) process.stdout.write(`${format(r.violations, r.label)}\n`);
    }
  }
  const errors = all.reduce((n, r) => n + r.violations.filter((v) => v.sev === 'error').length, 0);
  process.exit(errors > 0 ? 1 : 0);
}

if (process.argv[1]?.endsWith('ste-lint.mjs')) main(process.argv.slice(2));
