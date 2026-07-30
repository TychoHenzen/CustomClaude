import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lint } from './ste-lint.mjs';

test('a contraction inside a double-quoted span produces no contraction violation', () => {
  const text = 'She asked, "Who\'s up?" and nobody answered.';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const contractions = found.filter((v) => v.rule === 'contraction');
  assert.deepEqual(contractions, []);
});

test('the same contraction outside quotes still produces a contraction violation', () => {
  const text = 'She asked, Who\'s up? and nobody answered.';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const contractions = found.filter((v) => v.rule === 'contraction');
  assert.equal(contractions.length, 1);
});

test('a curly apostrophe inside a double-quoted span still produces a punctuation violation', () => {
  const curlyApostrophe = String.fromCharCode(0x2019);
  const text = `She asked, "Who${curlyApostrophe}s up?" and nobody answered.`;
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
