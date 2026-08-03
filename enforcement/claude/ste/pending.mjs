/**
 * Per-session log of the prose files a turn wrote.
 *
 * The write guard appends one line per tool call. The turn guard reads the
 * whole log once, when the turn ends, and then clears it.
 *
 * The log is newline-delimited JSON, so two tool calls running at once each
 * append their own line. A read-modify-write file would lose one of them.
 *
 * Nothing here throws. A guard that cannot read its own log must still let the
 * turn finish.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'pending');

/** The log file for one session, or null when the id is unusable. */
export function pathFor(sessionId, dir = DIR) {
  const safe = String(sessionId ?? '').replace(/[^A-Za-z0-9._-]/g, '');
  return safe ? join(dir, `${safe}.json`) : null;
}

/** Add one record. Each record is `{ file, adds }`. */
export function append(sessionId, record, dir = DIR) {
  const path = pathFor(sessionId, dir);
  if (!path) return false;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** Every record this session logged, oldest first. */
export function read(sessionId, dir = DIR) {
  const path = pathFor(sessionId, dir);
  if (!path || !existsSync(path)) return [];
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A torn line loses one record. It never loses the rest.
    }
  }
  return records;
}

/** Group the records by file, keeping the order each file first appeared. */
export function byFile(records) {
  const groups = new Map();
  for (const record of records) {
    if (!record?.file) continue;
    if (!groups.has(record.file)) groups.set(record.file, []);
    groups.get(record.file).push(record);
  }
  return groups;
}

export function clear(sessionId, dir = DIR) {
  const path = pathFor(sessionId, dir);
  if (!path) return;
  try {
    rmSync(path, { force: true });
  } catch {
    // The next turn overwrites it anyway.
  }
}
