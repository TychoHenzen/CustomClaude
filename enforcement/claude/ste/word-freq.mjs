/**
 * word-freq - reader for the word frequency table that build-word-freq.mjs
 * writes.
 *
 * The table is 4.75 MB. A hook runs on every write, so this reader must not
 * parse the file into a Map or split it into lines. It loads the table into
 * one Buffer once, then binary searches that Buffer directly on newline
 * boundaries. The table is sorted in byte order, so a raw byte compare picks
 * the correct half at each step.
 *
 * A missing table must never throw. The table downloads at deploy time, and
 * an offline machine will not have it. Callers check hasTable() and degrade
 * when it is false.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Floor value for a word absent from the table.
 *
 * The rarest real entry in the built table sits near -1.67. This floor sits
 * well below that value. An out-of-vocabulary word always scores worse than
 * any word the table actually knows. A short text with even one absent word
 * can swing hard on this constant. Keep it a fixed, documented value instead
 * of a computed one.
 */
export const OOV_FLOOR = -3;

const DEFAULT_TABLE_PATH = join(homedir(), '.claude', 'ste', 'data', 'word-freq.txt');
const NEWLINE = 0x0a;
const SPACE = 0x20;

let tablePath = process.env.STE_WORD_FREQ_TABLE || DEFAULT_TABLE_PATH;
let cache = null;

/** Point the reader at a different table file. Tests use this for fixtures. */
export function setTablePath(path) {
  tablePath = path;
  cache = null;
}

function findDataStart(buffer) {
  const nl = buffer.indexOf(NEWLINE);
  return nl === -1 ? buffer.length : nl + 1;
}

function parseEntryCount(buffer, dataStart) {
  const headerEnd = dataStart > 0 ? dataStart - 1 : 0;
  const header = buffer.subarray(0, headerEnd).toString('utf8');
  const match = header.match(/entries=(\d+)/);
  return match ? Number(match[1]) : 0;
}

/** Read the table once and keep it in module scope for later calls. */
function loadTable() {
  if (cache !== null) return cache;
  if (!existsSync(tablePath)) {
    cache = false;
    return cache;
  }
  const buffer = readFileSync(tablePath);
  const dataStart = findDataStart(buffer);
  cache = { buffer, dataStart, entries: parseEntryCount(buffer, dataStart) };
  return cache;
}

/** True when a table file is present at the configured path. */
export function hasTable() {
  return loadTable() !== false;
}

/** Number of word entries the table header declares. */
export function entryCount() {
  const table = loadTable();
  return table === false ? 0 : table.entries;
}

function normalizeWord(word) {
  const lower = word.toLowerCase();
  if (lower.endsWith("'s")) return lower.slice(0, -2);
  if (lower.endsWith("'")) return lower.slice(0, -1);
  return lower;
}

/** Scan back from offset to the start of the line that contains it. */
function lineStartAt(buffer, offset, floor) {
  let i = offset;
  while (i > floor && buffer[i - 1] !== NEWLINE) i--;
  return i;
}

/** Scan forward from start to the first byte that matches target. */
function findByte(buffer, start, target) {
  let i = start;
  while (i < buffer.length && buffer[i] !== target) i++;
  return i;
}

function readValue(buffer, spaceIdx) {
  const nlIdx = findByte(buffer, spaceIdx, NEWLINE);
  return Number(buffer.subarray(spaceIdx + 1, nlIdx).toString('utf8'));
}

/** Binary search the table Buffer for word. Returns null when absent. */
function searchTable(table, word) {
  const target = Buffer.from(word, 'utf8');
  const buffer = table.buffer;
  let lo = table.dataStart;
  let hi = buffer.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const lineStart = lineStartAt(buffer, mid, lo);
    const spaceIdx = findByte(buffer, lineStart, SPACE);
    const cmp = Buffer.compare(buffer.subarray(lineStart, spaceIdx), target);
    if (cmp === 0) return readValue(buffer, spaceIdx);
    if (cmp < 0) lo = findByte(buffer, spaceIdx, NEWLINE) + 1;
    else hi = lineStart;
  }
  return null;
}

/**
 * Log10 counts-per-million for word, or OOV_FLOOR when the table does not
 * hold it. Lookup lowercases the word first and strips a trailing possessive.
 * Returns null when no table is loaded, so callers can degrade instead of
 * treating a missing table as a zero-frequency word.
 */
export function logFrequency(word) {
  const table = loadTable();
  if (table === false) return null;
  const found = searchTable(table, normalizeWord(word));
  return found === null ? OOV_FLOOR : found;
}
