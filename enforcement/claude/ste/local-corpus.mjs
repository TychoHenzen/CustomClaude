/**
 * local-corpus - the vocabulary of the project the writer is working in.
 *
 * The word frequency table reads a general English crawl from 2006. It knows
 * `refactor` at 2.20 and `placeholder` at 0.03, both scored against everyday
 * English rather than against the writing they appear in. Judged on that
 * table alone, half the ordinary words of a software project read as rare.
 *
 * So rarity takes two votes here. A word is hard only when the general table
 * says it is rare and this project does not already use it. A word the
 * project uses in two files, or five times over, is part of the vocabulary
 * the reader brought with them.
 *
 * The corpus is every source and prose file git already tracks under the
 * working directory. Tracked means committed, so a word the current turn
 * just invented cannot vote for itself. Ignored files never appear, because
 * git does not list them.
 */

import {
  existsSync, mkdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { corpusFiles } from './corpus-files.mjs';

/** A word must reach one of these two counts to join the vocabulary. One
 *  file and one use is a typo. Two files, or five uses, is a habit. */
const MIN_FILES = 2;
const MIN_USES = 5;

/**
 * Shortest word the corpus records. The hard-word rule only asks about
 * words of five letters or more, but the acronym rule asks about tokens as
 * short as two. `HELM` is four letters, and a project that writes it a
 * hundred times is using a name, not an abbreviation the reader must
 * decode.
 */
const MIN_WORD_LENGTH = 2;

/** Work caps. A scan runs inside a hook with a timeout, so each of these
 *  bounds the worst case rather than the usual case. corpus-files.mjs owns
 *  the cap on how many files the scan opens. */
const MAX_FILE_BYTES = 300_000;
const MAX_TOTAL_BYTES = 24_000_000;
const MAX_WORDS = 120_000;

/** How long a built corpus stays good, in milliseconds. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * First line of a cache file. It names every setting that decides which
 * words the file holds, so a cache built under different settings is
 * rejected rather than read. Add to this line whenever a change alters what
 * qualifies.
 */
function cacheHeader() {
  return `# ste-local-corpus v2 minlen=${MIN_WORD_LENGTH} `
    + `minfiles=${MIN_FILES} minuses=${MIN_USES}`;
}

/**
 * A token opens with a letter and runs on through letters and digits. The
 * digits matter: `STE100` and `PD1` are names a project writes, and a
 * letters-only pattern would record `STE` and `PD` instead, leaving the
 * acronym rule with nothing to match.
 */
const WORD_PATTERN = /[A-Za-z][A-Za-z0-9]*/g;
const CASE_BOUNDARY = /(?<=[a-z0-9])(?=[A-Z])/;
const DIGIT_RUN = /[0-9]+/;

let corpusRoot = null;
let corpusCachePath;
let cache = null;

/**
 * Point the corpus at a different directory. Tests use this for fixtures.
 * The second argument names the file that holds the built vocabulary.
 * Passing null, the default, keeps the build in memory, so a test never
 * leaves a cache file behind and never reads a stale one.
 */
export function setCorpusRoot(path, cacheFile = null) {
  corpusRoot = path;
  corpusCachePath = cacheFile;
  cache = null;
}

function rootPath() {
  return corpusRoot || process.cwd();
}

function cachePath(root) {
  if (corpusRoot !== null) return corpusCachePath;
  const hash = createHash('sha1').update(root).digest('hex').slice(0, 16);
  return join(homedir(), '.claude', 'ste', 'cache', `local-corpus-${hash}.tsv`);
}

/** Add word to out when it is long enough to record. */
function collect(out, word) {
  const lower = word.toLowerCase();
  if (lower.length >= MIN_WORD_LENGTH) out.add(lower);
}

/**
 * Every piece of one token worth recording, each piece once. The whole
 * token counts, so `codebase` and `STE100` vote for themselves. Each
 * case-split part counts, so `placeholderText` votes for `placeholder`.
 * Each run of letters counts, so `utf8mb4` still votes for `utf`.
 *
 * The set matters. A plain word splits into itself, and counting it twice
 * would let three uses reach a threshold of five.
 */
function piecesOf(token) {
  const out = new Set();
  collect(out, token);
  for (const part of token.split(CASE_BOUNDARY)) collect(out, part);
  if (DIGIT_RUN.test(token)) {
    for (const run of token.split(DIGIT_RUN)) collect(out, run);
  }
  return out;
}

/** Every word one text contributes, lowercased. */
function wordsIn(text) {
  const out = [];
  for (const match of text.match(WORD_PATTERN) ?? []) out.push(...piecesOf(match));
  return out;
}

function countFile(path, counts) {
  const text = readFileSync(path, 'utf8');
  const seenHere = new Set();
  for (const word of wordsIn(text)) {
    let entry = counts.get(word);
    if (!entry) {
      if (counts.size >= MAX_WORDS) continue;
      entry = { files: 0, uses: 0 };
      counts.set(word, entry);
    }
    entry.uses++;
    if (!seenHere.has(word)) {
      seenHere.add(word);
      entry.files++;
    }
  }
  return text.length;
}

/** Count every corpus word under root. Never throws on one unreadable file. */
function buildCounts(root) {
  const counts = new Map();
  let total = 0;
  for (const path of corpusFiles(root)) {
    if (total > MAX_TOTAL_BYTES) break;
    try {
      if (statSync(path).size > MAX_FILE_BYTES) continue;
      total += countFile(path, counts);
    } catch {
      // One unreadable file must not lose the whole corpus.
    }
  }
  return counts;
}

function qualifies(entry) {
  return entry.files >= MIN_FILES || entry.uses >= MIN_USES;
}

function serialize(counts) {
  const lines = [];
  for (const [word, entry] of counts) {
    if (qualifies(entry)) lines.push(word);
  }
  lines.sort();
  return `${cacheHeader()}\n${lines.join('\n')}\n`;
}

function writeCache(path, body) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, 'utf8');
  } catch {
    // A corpus that cannot be cached still works for this run.
  }
}

function isFresh(path) {
  try {
    return Date.now() - statSync(path).mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Read the cached vocabulary at path, or null when it cannot be used.
 *
 * The header has to match the rules this build would apply. Age alone is
 * not enough. Lowering MIN_WORD_LENGTH from 5 to 2 left every machine
 * holding a cache with no short word in it. Every four-letter name then
 * read as an unexplained acronym, until the file aged out six hours
 * later.
 */
function readCache(path) {
  if (!path || !existsSync(path) || !isFresh(path)) return null;
  let lines;
  try {
    lines = readFileSync(path, 'utf8').split('\n');
  } catch {
    return null;
  }
  if (lines[0] !== cacheHeader()) return null;
  return new Set(lines.slice(1).filter(Boolean));
}

function loadCorpus() {
  if (cache !== null) return cache;
  if (process.env.STE_LOCAL_CORPUS === 'off') {
    cache = new Set();
    return cache;
  }
  const path = cachePath(rootPath());
  const cached = readCache(path);
  if (cached) {
    cache = cached;
    return cache;
  }
  const body = serialize(buildCounts(rootPath()));
  if (path) writeCache(path, body);
  cache = new Set(body.split('\n').slice(1).filter(Boolean));
  return cache;
}

/**
 * True when this project already uses word often enough to count it as
 * known. Never throws. A corpus that cannot be built answers false for
 * every word, and the frequency table then decides on its own.
 */
export function isLocalWord(word) {
  try {
    return loadCorpus().has(String(word).toLowerCase());
  } catch {
    return false;
  }
}

/** How many words the current corpus holds. Callers report on the scan. */
export function corpusSize() {
  try {
    return loadCorpus().size;
  } catch {
    return 0;
  }
}
