import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STRAIN_THRESHOLD, strainOf, tangledSentenceRule } from './rules-syntax.mjs';
import { classOf, COMPREHENSION } from './rule-classes.mjs';

function block(text, line = 0) {
  return { line, text, heading: false };
}

/** The sentence that started this rule. Every word in it is common and it
 *  runs to sixteen words, so word rarity and sentence length both pass it. */
const TANGLED = 'How should a HELM answer that disclaims knowledge be allowed '
  + 'to name the thing it disclaims?';

test('the sample sentence carries all three kinds of strain', () => {
  const strain = strainOf(TANGLED);
  assert.equal(strain.stretched, 1);
  assert.equal(strain.interrupted, 1);
  assert.equal(strain.passive, 1);
});

test('the sample sentence is reported', () => {
  const found = tangledSentenceRule(block(TANGLED));
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'tangled-sentence');
  assert.equal(classOf(found[0].rule), COMPREHENSION);
  assert.equal(found[0].line, 1);
});

test('the same sentence written plainly is not reported', () => {
  const plain = 'A HELM answer disclaims knowledge. May it name what it disclaims?';
  assert.deepEqual(tangledSentenceRule(block(plain)), []);
});

test('an auxiliary next to its verb is no strain', () => {
  assert.equal(strainOf('The file should be read before the run starts.').stretched, 0);
});

test('an auxiliary five words from its verb is strain', () => {
  const strain = strainOf('The parser should on every single ordinary launch be started early.');
  assert.equal(strain.stretched, 1);
});

test('a relative clause between an auxiliary and its verb counts twice', () => {
  const strain = strainOf('Should the answer that disclaims all knowledge be published now?');
  assert.equal(strain.stretched, 1);
  assert.equal(strain.interrupted, 1);
});

test('a plain passive is one point of strain and does not fire alone', () => {
  const strain = strainOf('The file is read by the parser.');
  assert.equal(strain.passive, 1);
  assert.deepEqual(tangledSentenceRule(block('The file is read by the parser.')), []);
});

test('a passive with an irregular participle is found', () => {
  assert.equal(strainOf('The verdict was written before the check ran.').passive, 1);
});

test('a passive with an adverb between the parts is found', () => {
  assert.equal(strainOf('The file is fully covered by the tests.').passive, 1);
});

test('an active sentence carries no passive', () => {
  assert.equal(strainOf('The parser reads the file and writes the report.').passive, 0);
});

test('a repeated word is no strain, since one name for one thing is the rule', () => {
  const text = 'The parser reads the file, then the parser writes the report.';
  assert.deepEqual(tangledSentenceRule(block(text)), []);
});

test('the report names each kind of strain it counted', () => {
  const found = tangledSentenceRule(block(TANGLED));
  assert.match(found[0].msg, /auxiliary far from its verb/);
  assert.match(found[0].msg, /clause inside a subject/);
  assert.match(found[0].msg, /passive/);
});

test('the report names the cap it went past', () => {
  const found = tangledSentenceRule(block(TANGLED));
  assert.match(found[0].msg, new RegExp(`cap of ${STRAIN_THRESHOLD - 1}`));
});

test('a heading is never judged on shape', () => {
  assert.deepEqual(tangledSentenceRule({ line: 0, text: TANGLED, heading: true }), []);
});

test('a sentence is judged on its own, not with its neighbours', () => {
  const text = `The file is read.\n${TANGLED}`;
  const found = tangledSentenceRule(block(text));
  assert.equal(found.length, 1);
});

test('the line number counts from the start of the block', () => {
  const found = tangledSentenceRule(block(`Plain text here.\n${TANGLED}`, 10));
  assert.equal(found[0].line, 12);
});

test('empty text produces nothing and does not throw', () => {
  assert.deepEqual(tangledSentenceRule(block('')), []);
});

test('this machine own writing rules pass the shape check', () => {
  const text = 'One instruction per sentence. Cap 20 words for procedures, 25 '
    + 'elsewhere. Contractions are fine. No semicolons. Write two sentences '
    + 'instead. Put a condition before its command.';
  assert.deepEqual(tangledSentenceRule(block(text)), []);
});
