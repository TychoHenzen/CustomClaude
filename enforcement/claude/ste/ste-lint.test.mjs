import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lint } from './ste-lint.mjs';

/**
 * Build an em dash HTML entity from its name at run time, so the literal
 * text stays out of this file. The punctuation rule under test reads raw
 * text, so a literal entity here would trip that rule against its own
 * test fixture.
 */
function emDashEntity(name) {
  return `&${name};`;
}

test('a slop word inside a double-quoted span produces no slop-word violation', () => {
  const text = 'She asked, "Is this leverage?" and nobody answered.';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const slop = found.filter((v) => v.rule === 'slop-word');
  assert.deepEqual(slop, []);
});

test('the same slop word outside quotes still produces a slop-word violation', () => {
  const text = 'She asked, is this leverage? and nobody answered.';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const slop = found.filter((v) => v.rule === 'slop-word');
  assert.equal(slop.length, 1);
});

test('an em dash inside a double-quoted span still produces a punctuation violation', () => {
  const emDash = String.fromCharCode(0x2014);
  const text = `She asked, "Who is up${emDash}now?" and nobody answered.`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const punctuation = found.filter((v) => v.rule === 'punctuation');
  assert.equal(punctuation.length, 1);
});

test('a violation on a line after a masked quoted span is reported at its true line number', () => {
  const text = 'Text with "a quoted phrase" here.\nThis line uses leverage improperly.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const slop = found.filter((v) => v.rule === 'slop-word');
  assert.equal(slop.length, 1);
  assert.equal(slop[0].line, 2);
});

const MIDDLE_DOT = String.fromCharCode(0x00b7);

const INDEX_WORDS = [
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty', 'twentyone', 'twentytwo', 'twentythree',
  'twentyfour', 'twentyfive', 'twentysix', 'twentyseven', 'twentyeight',
  'twentynine', 'thirty',
];

test('a long line of short entries joined by middle dots produces no long-sentence violation', () => {
  const text = `${INDEX_WORDS.join(` ${MIDDLE_DOT} `)}\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const longSentence = found.filter((v) => v.rule === 'long-sentence');
  assert.deepEqual(longSentence, []);
});

test('the same words on the same line joined by plain spaces still produces a long-sentence violation', () => {
  const text = `${INDEX_WORDS.join(' ')}\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const longSentence = found.filter((v) => v.rule === 'long-sentence');
  assert.equal(longSentence.length, 1);
});

test('a sentence that starts on the line after a terminator is reported at its own line', () => {
  const first = 'This first sentence ends right at the line break.';
  const second = `${INDEX_WORDS.join(' ')}.`;
  const text = `${first}\n${second}\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const violations = found.filter((v) => v.rule === 'long-sentence');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 2);
});

test('a separator-joined line reports a later violation on the line it sits on', () => {
  const text = `alpha ${MIDDLE_DOT} beta ${MIDDLE_DOT} gamma\nThis line uses leverage improperly.\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const slop = found.filter((v) => v.rule === 'slop-word');
  assert.equal(slop.length, 1);
  assert.equal(slop[0].line, 2);
});

test('a genuinely long sentence after a separator-joined line is reported at its true line number', () => {
  const indexLine = INDEX_WORDS.join(` ${MIDDLE_DOT} `);
  const longSentence = `${INDEX_WORDS.join(' ')}.`;
  const text = `${indexLine}\n\n${longSentence}\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const violations = found.filter((v) => v.rule === 'long-sentence');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 3);
});

test('a literal em dash produces a punctuation violation', () => {
  const emDash = String.fromCharCode(0x2014);
  const text = `Do this${emDash}then that.\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const punctuation = found.filter((v) => v.rule === 'punctuation');
  assert.equal(punctuation.length, 1);
});

test('the named em dash HTML entity produces a punctuation violation', () => {
  const text = `Do this${emDashEntity('mdash')}then that.\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const punctuation = found.filter((v) => v.rule === 'punctuation');
  assert.equal(punctuation.length, 1);
});

test('the misspelled em dash HTML entity produces a punctuation violation', () => {
  const text = `Do this${emDashEntity('emdash')}then that.\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const punctuation = found.filter((v) => v.rule === 'punctuation');
  assert.equal(punctuation.length, 1);
});

test('the decimal numeric em dash entity produces a punctuation violation', () => {
  const text = `Do this${emDashEntity('#8212')}then that.\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const punctuation = found.filter((v) => v.rule === 'punctuation');
  assert.equal(punctuation.length, 1);
});

test('the hex numeric em dash entity produces a punctuation violation, matched case-insensitively', () => {
  const text = `Do this${emDashEntity('#X2014')}then that.\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const punctuation = found.filter((v) => v.rule === 'punctuation');
  assert.equal(punctuation.length, 1);
});

test('an en dash produces no violation', () => {
  const enDash = String.fromCharCode(0x2013);
  const text = `Pages 10${enDash}20 cover setup.\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.deepEqual(found, []);
});

test('a curly double quote produces no violation', () => {
  const openQuote = String.fromCharCode(0x201c);
  const closeQuote = String.fromCharCode(0x201d);
  const text = `She said ${openQuote}go now${closeQuote} and left.\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.deepEqual(found, []);
});

test('an ellipsis character produces no violation', () => {
  const ellipsis = String.fromCharCode(0x2026);
  const text = `The list goes on${ellipsis} and stops there.\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.deepEqual(found, []);
});

test('an arrow character produces no violation', () => {
  const arrow = String.fromCharCode(0x2192);
  const text = `Old value ${arrow} new value in the table.\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.deepEqual(found, []);
});

test('the contraction with a curly apostrophe produces no violation', () => {
  const curlyApostrophe = String.fromCharCode(0x2019);
  const text = `Let${curlyApostrophe}s start the build now.\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.deepEqual(found, []);
});

test('a filler opener still produces a filler violation', () => {
  const text = 'It is important to note that the build failed today.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const filler = found.filter((v) => v.rule === 'filler');
  assert.equal(filler.length, 1);
});

test('a nominalization still produces a nominalization violation', () => {
  const text = 'The team will perform an analysis of the logs tomorrow.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const nominalization = found.filter((v) => v.rule === 'nominalization');
  assert.equal(nominalization.length, 1);
});

test('a semicolon still produces a semicolon violation', () => {
  const text = 'Read the file; then close it.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const semicolon = found.filter((v) => v.rule === 'semicolon');
  assert.equal(semicolon.length, 1);
});

test('a named HTML entity produces no semicolon violation', () => {
  const text = 'Use &amp; for an ampersand here.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const semicolon = found.filter((v) => v.rule === 'semicolon');
  assert.deepEqual(semicolon, []);
});

test('several named HTML entities in one line produce no semicolon violation', () => {
  const text = 'A &nbsp; space and &lt;tag&gt; markup.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const semicolon = found.filter((v) => v.rule === 'semicolon');
  assert.deepEqual(semicolon, []);
});

test('the em dash named entity produces only a punctuation violation, no semicolon violation', () => {
  const text = `A sentence with an ${emDashEntity('mdash')} inside it.\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'punctuation');
});

test('the em dash decimal numeric entity produces only a punctuation violation, no semicolon violation', () => {
  const text = `A sentence with an ${emDashEntity('#8212')} inside it.\n`;
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'punctuation');
});

test('a real semicolon still produces a semicolon violation next to prose', () => {
  const text = 'The parser reads the file; it then writes output.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const semicolon = found.filter((v) => v.rule === 'semicolon');
  assert.equal(semicolon.length, 1);
});

test('a bare ampersand followed later by a stray semicolon still produces a semicolon violation', () => {
  const text = 'A bare & and a stray ; in one line.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const semicolon = found.filter((v) => v.rule === 'semicolon');
  assert.equal(semicolon.length, 1);
});

test('a weak opener still produces a weak-opener violation', () => {
  const text = 'There is a bug in the parser that breaks the build.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const weakOpener = found.filter((v) => v.rule === 'weak-opener');
  assert.equal(weakOpener.length, 1);
});
