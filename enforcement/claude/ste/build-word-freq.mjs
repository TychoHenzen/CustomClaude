#!/usr/bin/env node
/**
 * build-word-freq - deploy-time fetcher for the English word frequency table.
 *
 * Downloads the Norvig word count list and turns it into a lookup table.
 * The reader in word-freq.mjs loads the table into one Buffer and binary
 * searches it on newline boundaries. That reader compares raw bytes, so
 * this script sorts by byte order, not by locale.
 *
 * The table is never committed. A launcher run refreshes it, the same way
 * Copy-EnforcementTrees refreshes the checker scripts themselves.
 *
 * A failed download must never break the linter on an offline machine.
 * Every failure path here prints a warning and exits 0.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const SOURCE_URL = 'https://norvig.com/ngrams/count_1w.txt';
export const HEADER_VERSION = 'v1';
const TIMEOUT_MS = 60000;

// ---------------------------------------------------------------------------
// Transform - pure, no network, no file system.
// ---------------------------------------------------------------------------

function parseEntries(rawText) {
  return rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { word: line.slice(0, tab), count: Number(line.slice(tab + 1)) };
    });
}

function sumCounts(entries) {
  return entries.reduce((sum, e) => sum + e.count, 0);
}

function roundTwo(n) {
  return Math.round(n * 100) / 100;
}

function scoreEntries(entries, total) {
  return entries.map((e) => ({
    word: e.word,
    value: roundTwo(Math.log10((e.count / total) * 1e6)),
  }));
}

/** Byte order, the same comparison the binary search reader uses. */
function byteOrder(a, b) {
  return Buffer.compare(Buffer.from(a.word), Buffer.from(b.word));
}

export function buildHeader(entryCount, sourceUrl = SOURCE_URL) {
  return `# word-freq ${HEADER_VERSION} source=${sourceUrl} entries=${entryCount}`;
}

export function parseHeader(line) {
  const m = (line || '').match(/^# word-freq (\S+) source=(\S+) entries=(\d+)$/);
  if (!m) return null;
  return { version: m[1], sourceUrl: m[2], entries: Number(m[3]) };
}

/** Turn the raw tab-separated corpus into the sorted lookup table text. */
export function transform(rawText, options = {}) {
  const sourceUrl = options.sourceUrl || SOURCE_URL;
  const entries = parseEntries(rawText);
  const scored = scoreEntries(entries, sumCounts(entries));
  scored.sort(byteOrder);
  const header = buildHeader(scored.length, sourceUrl);
  const lines = scored.map((e) => `${e.word} ${e.value}`);
  return `${[header, ...lines].join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// File system and network.
// ---------------------------------------------------------------------------

export function defaultOutPath() {
  return join(homedir(), '.claude', 'ste', 'data', 'word-freq.txt');
}

/**
 * True when the file at outPath already holds a current table.
 * Checks the header version and checks the header's stated entry count
 * against the number of data lines actually present. Both checks run
 * without touching the network, so a current table never triggers a
 * download.
 */
export function isTableCurrent(outPath) {
  if (!existsSync(outPath)) return false;
  const lines = readFileSync(outPath, 'utf8').split('\n');
  const header = parseHeader(lines[0]);
  if (!header || header.version !== HEADER_VERSION) return false;
  const dataLines = lines.slice(1).filter(Boolean);
  return dataLines.length === header.entries;
}

async function fetchCorpus(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`download failed with status ${res.status}`);
  return res.text();
}

function parseArgs(argv) {
  const args = { out: null, force: false };
  for (const arg of argv) {
    if (arg.startsWith('--out=')) args.out = arg.slice(6);
    else if (arg === '--force') args.force = true;
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  const outPath = args.out || defaultOutPath();

  if (!args.force && isTableCurrent(outPath)) {
    console.log(`word-freq table is current at ${outPath}`);
    return;
  }

  let rawText;
  try {
    rawText = await fetchCorpus(SOURCE_URL);
  } catch (err) {
    process.stderr.write(`warning: could not download word frequency data: ${err.message}\n`);
    return;
  }

  const output = transform(rawText);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, output, 'utf8');
  console.log(`wrote word-freq table to ${outPath}`);
}

if (process.argv[1]?.endsWith('build-word-freq.mjs')) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`warning: build-word-freq failed: ${err.message}\n`);
  });
}
