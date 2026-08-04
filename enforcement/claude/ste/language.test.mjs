import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { setTablePath } from './word-freq.mjs';
import { detectEnglish } from './language.mjs';
import { lint } from './ste-lint.mjs';

const REAL_TABLE_PATH = join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'ste', 'data', 'word-freq.txt');
const needsTable = { skip: !existsSync(REAL_TABLE_PATH) };

setTablePath(REAL_TABLE_PATH);

const ENGLISH = 'The parser reads the file and writes the result to the disk. '
  + 'Every line takes the same path. When the file is missing, the program '
  + 'stops with a clear message.';

const PORTUGUESE = 'O analisador le o arquivo e escreve o resultado no disco. '
  + 'Cada linha passa pelo mesmo caminho. Quando o arquivo nao existe, o '
  + 'programa termina com um erro claro.';

const GERMAN = 'Der Parser liest die Datei und schreibt das Ergebnis auf die '
  + 'Festplatte. Jede Zeile nimmt denselben Weg. Wenn die Datei fehlt, bricht '
  + 'das Programm mit einer klaren Meldung ab.';

const SPANISH = 'El analizador lee el archivo y escribe el resultado en el '
  + 'disco. Cada linea sigue el mismo camino. Cuando el archivo no existe, el '
  + 'programa termina con un error claro y no escribe nada.';

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

test('English prose reads as English', needsTable, () => {
  assert.equal(detectEnglish(ENGLISH), 'english');
});

test('Portuguese, Spanish and German prose read as foreign', needsTable, () => {
  assert.equal(detectEnglish(PORTUGUESE), 'foreign');
  assert.equal(detectEnglish(SPANISH), 'foreign');
  assert.equal(detectEnglish(GERMAN), 'foreign');
});

test('text too short to judge reads as unknown', () => {
  assert.equal(detectEnglish('Notas de instalacao'), 'unknown');
});

test('a list of product names reads as unknown, not foreign', needsTable, () => {
  const names = 'ESLint Prettier Husky Vitest Playwright Storybook Vite Rollup '
    + 'Biome Turborepo Nx Bun Deno';
  assert.notEqual(detectEnglish(names), 'foreign');
});

test('a block of unknown product names reads as unknown, whatever its length', needsTable, () => {
  const names = 'tweakcc unnerfcc customclaude tweakcc unnerfcc customclaude '
    + 'tweakcc unnerfcc customclaude tweakcc unnerfcc customclaude';
  assert.equal(detectEnglish(names), 'unknown');
});

test('English prose carrying no function word still reads as English', needsTable, () => {
  const terse = 'Parser reads file, writes result, closes handle. Message '
    + 'shows clear reason. Program stops. Line takes same path. Missing file '
    + 'means error.';
  assert.equal(detectEnglish(terse), 'english');
});

// ---------------------------------------------------------------------------
// The gate inside lint
// ---------------------------------------------------------------------------

function rules(violations) {
  return [...new Set(violations.map((v) => v.rule))].sort();
}

test('foreign prose raises no word or readability violation', needsTable, () => {
  const found = lint(`# Notas\n\n${PORTUGUESE}\n`, { tier: 'flavored' });
  assert.deepEqual(rules(found), []);
});

test('foreign prose stays clean in the strict tier too', needsTable, () => {
  for (const text of [PORTUGUESE, SPANISH, GERMAN]) {
    const found = lint(`# Notas\n\n${text}\n`, { tier: 'strict' });
    assert.deepEqual(rules(found), []);
  }
});

test('a heading in a foreign file inherits the language of the file', needsTable, () => {
  const found = lint(`# Notas de instalacao\n\n${PORTUGUESE}\n`, { tier: 'strict' });
  assert.equal(found.filter((v) => v.line === 1).length, 0);
});

test('an em dash in foreign prose is still reported', needsTable, () => {
  const emDash = String.fromCharCode(0x2014);
  const found = lint(`# Notas\n\n${PORTUGUESE} Um traco ${emDash} aqui.\n`, { tier: 'flavored' });
  assert.deepEqual(rules(found), ['punctuation']);
});

test('a semicolon in foreign prose is still reported', needsTable, () => {
  const found = lint(`# Notas\n\n${PORTUGUESE} Um ponto; aqui.\n`, { tier: 'flavored' });
  assert.ok(rules(found).includes('semicolon'));
});

test('a long sentence in foreign prose is still reported', needsTable, () => {
  const long = `${PORTUGUESE} ${'palavra '.repeat(30)}fim.`;
  const found = lint(`# Notas\n\n${long}\n`, { tier: 'flavored' });
  assert.ok(rules(found).includes('long-sentence'));
});

test('English prose keeps every rule it had before the gate', needsTable, () => {
  const text = '# Notes\n\nThis parser is a robust and comprehensive tool that '
    + 'we built to leverage the file system.\n';
  const found = lint(text, { tier: 'flavored' });
  assert.ok(rules(found).includes('slop-word'));
});

test('a foreign paragraph inside an English file is gated on its own', needsTable, () => {
  const text = `# Notes\n\n${ENGLISH}\n\n${PORTUGUESE}\n`;
  const found = lint(text, { tier: 'strict' });
  const foreignLine = text.split('\n').findIndex((l) => l.startsWith('O analisador')) + 1;
  assert.equal(found.filter((v) => v.line >= foreignLine).length, 0);
});
