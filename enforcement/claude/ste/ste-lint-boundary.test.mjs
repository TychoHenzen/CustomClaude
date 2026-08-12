import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  classify, format, isDisabled, lint, splitSentences,
} from './ste-lint.mjs';
import { setCorpusRoot } from './local-corpus.mjs';
import { runCli } from './ste-cli.mjs';
import {
  blocks, classOf, COMPREHENSION, ENCODING, POLISH,
} from './rule-classes.mjs';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const REAL_TABLE_PATH = join(HOME, '.claude', 'ste', 'data', 'word-freq.txt');
const needsTable = { skip: !existsSync(REAL_TABLE_PATH) };

// The hard-word rule asks the local corpus whether this project already uses
// a word. These tests use a rare word as a probe for masking, so the corpus
// has to be empty or the probe would vote for itself.
setCorpusRoot(mkdtempSync(join(tmpdir(), 'ste-boundary-corpus-')));

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

test('a falsy path answers with no kind and no reason', () => {
  assert.deepEqual(classify(''), { kind: null });
  assert.deepEqual(classify(null), { kind: null });
});

test('an excluded path answers with the excluded reason', () => {
  assert.deepEqual(classify('src/node_modules/a/readme.md'), {
    kind: null, reason: 'excluded path',
  });
  assert.equal(classify('src/build/notes.md').reason, 'excluded path');
  assert.equal(classify('/build/notes.md').reason, 'excluded path');
  assert.equal(classify('a/CHANGELOG.md').reason, 'excluded path');
});

test('a directory name needs a real separator in front of it', () => {
  assert.deepEqual(classify('build/notes.md'), {
    kind: 'markdown', ext: '.md', tier: 'flavored',
  });
});

test('an unknown extension answers that it is no prose target', () => {
  assert.deepEqual(classify('a/b/data.bin'), {
    kind: null, reason: 'not a prose target',
  });
});

test('a prose name that reads as a procedure lands in the strict tier', () => {
  assert.deepEqual(classify('docs/RUNBOOK.md'), {
    kind: 'markdown', ext: '.md', tier: 'strict',
  });
  assert.equal(classify('docs/install-notes.md').tier, 'strict');
});

test('any other prose name lands in the flavored tier', () => {
  assert.deepEqual(classify('docs/notes.md'), {
    kind: 'markdown', ext: '.md', tier: 'flavored',
  });
});

test('a source file reads as code in the flavored tier', () => {
  assert.deepEqual(classify('src/parser.ts'), {
    kind: 'code', ext: '.ts', tier: 'flavored',
  });
});

test('a windows path answers the same as a posix path', () => {
  assert.deepEqual(classify('C:\\work\\docs\\notes.md'), classify('C:/work/docs/notes.md'));
  assert.equal(classify('C:\\work\\dist\\notes.md').reason, 'excluded path');
});

// ---------------------------------------------------------------------------
// format
// ---------------------------------------------------------------------------

const SEMICOLON_FINDING = {
  line: 3, rule: 'semicolon', cls: POLISH, msg: 'no semicolons. Write two sentences.',
};

test('a finding renders with the label, the line, the class and the rule', () => {
  assert.equal(
    format([SEMICOLON_FINDING], 'commit-msg'),
    'commit-msg:3: polish [semicolon] no semicolons. Write two sentences.',
  );
});

test('the class a finding renders under comes from its rule', () => {
  assert.equal(classOf('semicolon'), POLISH);
  assert.equal(classOf('readability'), COMPREHENSION);
  assert.equal(classOf('punctuation'), ENCODING);
});

test('a finding from another checker renders the same way', () => {
  const finding = {
    line: 1,
    rule: 'subject-length',
    cls: COMPREHENSION,
    msg: 'subject is 90 characters, cap is 72.',
  };
  assert.equal(
    format([finding], 'commit-msg'),
    'commit-msg:1: comprehension [subject-length] subject is 90 characters, cap is 72.',
  );
});

test('no finding renders as an empty text', () => {
  assert.equal(format([], 'commit-msg'), '');
});

// ---------------------------------------------------------------------------
// isDisabled
// ---------------------------------------------------------------------------

test('only the environment turns the checks off', () => {
  const held = process.env.STE_LINT;
  try {
    process.env.STE_LINT = 'off';
    assert.equal(isDisabled(), true);
    process.env.STE_LINT = 'on';
    assert.equal(isDisabled(), false);
    delete process.env.STE_LINT;
    assert.equal(isDisabled('ste-lint: off\ntext'), false);
  } finally {
    if (held === undefined) delete process.env.STE_LINT;
    else process.env.STE_LINT = held;
  }
});

test('a marker at the head of a file never turns the check off', () => {
  const text = 'ste-lint: off\n\nThis layer is seamless.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.equal(found.filter((v) => v.rule === 'slop-word').length, 1);
});

// ---------------------------------------------------------------------------
// splitSentences
// ---------------------------------------------------------------------------

test('a period after a known abbreviation does not end a sentence', () => {
  const parts = splitSentences('Dr. Smith left. He came back.');
  assert.equal(parts.length, 2);
  assert.equal(parts[0].text, 'Dr. Smith left.');
  assert.equal(parts[1].offset, 16);
});

test('a period after an initial does not end a sentence', () => {
  const parts = splitSentences('The e.g. case still reads as one sentence here.');
  assert.equal(parts.length, 1);
});

test('a period after the number that opens a block does not end a sentence', () => {
  const parts = splitSentences('1. Copy the tree. Run it.');
  assert.equal(parts.length, 2);
  assert.equal(parts[0].text, '1. Copy the tree.');
});

test('a period after a bare number elsewhere does end a sentence', () => {
  const parts = splitSentences('Read the report on page 12. Then stop.');
  assert.equal(parts.length, 2);
});

test('a run of separator marks ends a sentence', () => {
  const parts = splitSentences(`alpha ${String.fromCharCode(0x00b7)} beta`);
  assert.equal(parts.length, 2);
  assert.equal(parts[1].text, 'beta');
});

test('every line break flattens to one space, so offsets still fit the input', () => {
  const parts = splitSentences('one two\nthree four.');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, 'one two three four.');
  assert.equal(parts[0].offset, 0);
});

test('an empty part is dropped', () => {
  assert.deepEqual(splitSentences('   \n  '), []);
});

// ---------------------------------------------------------------------------
// headings
// ---------------------------------------------------------------------------

test('a heading is exempt from the semicolon rule, a plain line is not', () => {
  const heading = lint('# A title; with a mark\n', { tier: 'flavored' });
  assert.deepEqual(heading.filter((v) => v.rule === 'semicolon'), []);
  const plain = lint('A title; with a mark\n', { tier: 'flavored' });
  assert.equal(plain.filter((v) => v.rule === 'semicolon').length, 1);
});

test('a heading is exempt from the sentence length rule', () => {
  const words = Array(40).fill('word').join(' ');
  const found = lint(`# ${words}\n`, { tier: 'flavored' });
  assert.deepEqual(found.filter((v) => v.rule === 'long-sentence'), []);
});

test('the words of a heading still feed the vocabulary rules', () => {
  const found = lint('# The seamless report\n', { tier: 'flavored' });
  assert.equal(found.filter((v) => v.rule === 'slop-word').length, 1);
});

test('a heading reaches the word rarity rule, its marker being blanked', needsTable, () => {
  const found = lint('# Hermeneutic Dev System-Prompt Basis\n', { tier: 'flavored' });
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  assert.equal(found[0].rule, 'hard-word');
  assert.match(found[0].msg, /Hermeneutic/);
});

const HEADING_THEN_TEXT = '### Determinism\n'
  + 'Seed all RNG explicitly; no implicit entropy in sim code.\n';

test('a heading ends at its own line, so the text under it is its own block', () => {
  const found = lint(HEADING_THEN_TEXT, { tier: 'flavored' });
  const marks = found.filter((v) => v.rule === 'semicolon');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].line, 2);
});

test('a heading above a paragraph keeps its own rarity finding', needsTable, () => {
  const found = lint(HEADING_THEN_TEXT, { tier: 'flavored' });
  const rare = found.filter((v) => v.rule === 'hard-word');
  assert.equal(rare.length, 1);
  assert.equal(rare[0].line, 1);
  assert.match(rare[0].msg, /Determinism/);
});

// ---------------------------------------------------------------------------
// links
// ---------------------------------------------------------------------------

test('the label of a link is prose and its target is not', () => {
  const text = 'It uses a [robust label](https://example.com/robust/x) here.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const slop = found.filter((v) => v.rule === 'slop-word');
  assert.equal(slop.length, 1);
  assert.equal(slop[0].line, 1);
});

test('a rare word reads in a link label and not in its target', needsTable, () => {
  const text = 'It uses a [connoisseur](https://example.com/a-connoisseur/x) patched binary here.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'hard-word');
  assert.match(found[0].msg, /connoisseur/);
});

// ---------------------------------------------------------------------------
// list markers
// ---------------------------------------------------------------------------

test('a bullet marker leaves the block, so the first word opens a sentence', needsTable, () => {
  const text = '- Placeholder macros are banned in code that is reported as complete.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  assert.equal(found[0].rule, 'hard-word');
  assert.match(found[0].msg, /Placeholder/);
});

const GREEK = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa '
  + 'lambda mu nu xi omicron pi rho sigma tau upsilon.';

test('a number marker adds no word to the count', () => {
  const found = lint(`1. ${GREEK}\n`, { tier: 'strict', kind: 'markdown' });
  assert.deepEqual(found.filter((v) => v.rule === 'long-sentence'), []);
});

test('an indented marker with a close parenthesis adds none either', () => {
  const words = Array(20).fill('word').join(' ');
  const found = lint(`   2) ${words}.\n`, { tier: 'strict', kind: 'markdown' });
  assert.deepEqual(found.filter((v) => v.rule === 'long-sentence'), []);
});

const DASH = String.fromCharCode(0x2014);

const ITEM_ONE = `- The 3 \`rme-strict\` versions in \`.claude/SystemPrompts/\` ${DASH} `
  + 'backbone + evolution signal.';

const ITEM_TWO = '- Full user setup (`~/.claude/CLAUDE.md`, RTK.md, caveman, '
  + `liedetector, context-mode, skills/agents) ${DASH} `
  + '**eval is internal only; NO scorecard is shipped.**';

const ITEM_THREE = `- Public/known agent prompts ${DASH} **fetch real ones** `
  + '(Claude Code, Cursor, Aider, Cline, Windsurf, Codex) to extract section '
  + 'patterns the corpus lacks. **These are leaked/reverse-engineered, treat '
  + 'as reference patterns, not ground truth. No build step may assert '
  + 'fidelity to them.**';

test('a sentence ends where its list item ends', needsTable, () => {
  const text = [ITEM_ONE, ITEM_TWO, ITEM_THREE].join('\n');
  // Polish findings are not boundary signals, so they stay out of this list.
  const found = lint(text, { tier: 'strict', kind: 'markdown' })
    .filter((v) => blocks(v.cls));
  assert.deepEqual(found.map((v) => `${v.line} ${v.rule}`), [
    '1 punctuation',
    '2 clause-pileup',
    '2 punctuation',
    '3 clause-pileup',
    '3 punctuation',
  ]);
  assert.match(found[1].msg, /4 clauses/);
  assert.match(found[3].msg, /5 clauses/);
});

// ---------------------------------------------------------------------------
// the em dash
// ---------------------------------------------------------------------------

test('a line reports the em dash once, however many it carries', () => {
  const line = `Say no ${DASH} do not guess. Say stop ${DASH} do not go on.`;
  const once = lint(line, { tier: 'flavored', kind: 'markdown' });
  assert.equal(once.filter((v) => v.rule === 'punctuation').length, 1);
  const twice = lint(`${line}\n${line}`, { tier: 'flavored', kind: 'markdown' });
  assert.equal(twice.filter((v) => v.rule === 'punctuation').length, 2);
});

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

const PATHS = [
  'No features/refactoring/abstractions beyond the task at hand today.',
  'Unknown axis values language/domain/strictness/backend are rejected here.',
  'Values are set, language/domain/strictness/backend, and then rejected here.',
  'Read ~/.claude/ste/data/connoisseur.txt for the rules in this repository.',
  'See https://example.com/a-connoisseur/x for the rules in this repository.',
];

test('a token that opens at a space and holds a slash is a path', () => {
  for (const text of PATHS) {
    assert.deepEqual(lint(text, { tier: 'flavored', kind: 'markdown' }), [], text);
  }
});

test('a run that opens inside a paren is prose, not a path', () => {
  const text = 'Unknown axis values (language/robust/backend name) are rejected here.';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.equal(found.filter((v) => v.rule === 'slop-word').length, 1);
});

test('a rare word in a run that opens inside a paren is read', needsTable, () => {
  const text = 'Unknown axis values (language/domain/connoisseur/backend/layer name) '
    + 'are rejected with an error.';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  assert.equal(found[0].rule, 'hard-word');
  assert.match(found[0].msg, /connoisseur/);
});

test('a bold lead-in opens no sentence, so its first word stays a name', () => {
  const lead = '- **Refactor only what the task needs** and stop there for now.';
  assert.deepEqual(lint(lead, { tier: 'flavored', kind: 'markdown' }), []);
  const label = '- **Placeholder macros:** never leave one behind in the tree.';
  assert.deepEqual(lint(label, { tier: 'flavored', kind: 'markdown' }), []);
});

test('a bold mark opens no path, and the words it wraps are read', needsTable, () => {
  const text = '- **Sample/placeholder conventions** chosen by a connoisseur today.';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.deepEqual(found.map((v) => `${v.line} ${v.rule}`), ['1 hard-word', '1 hard-word']);
  const words = found.map((v) => v.msg).join(' ');
  assert.match(words, /placeholder/);
  assert.match(words, /connoisseur/);
});

test('the words that follow a path are still read', needsTable, () => {
  const text = 'Read enforcement/claude/ste/ste-lint.mjs for the connoisseur rules here.';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  assert.equal(found[0].rule, 'hard-word');
  assert.match(found[0].msg, /connoisseur/);
});

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

test('a missing kind reads as markdown', () => {
  const found = lint('Read the file; then close it.\n');
  assert.equal(found.filter((v) => v.rule === 'semicolon').length, 1);
});

test('any tier but strict reads as flavored', () => {
  const words = `${Array(22).fill('word').join(' ')}.`;
  assert.deepEqual(lint(words, { tier: 'other' }).filter((v) => v.rule === 'long-sentence'), []);
  assert.equal(lint(words, { tier: 'strict' }).filter((v) => v.rule === 'long-sentence').length, 1);
});

// ---------------------------------------------------------------------------
// code targets
//
// Every fixture below builds its rare and banned words from pieces. A
// literal one would sit inside the argument list of a marker. The checker
// would then read this file back as prose.
// ---------------------------------------------------------------------------

const SLOP_PAIR = [['seam', 'less'], ['rob', 'ust']].map((parts) => parts.join(''));
const RARE_WORD = ['conn', 'oisseur'].join('');
const MESSAGE_BODY = `Could not query ${RARE_WORD} releases now`;

const SOURCE = [
  '#!/usr/bin/env node',
  `const ${SLOP_PAIR[0]} = 1;`,
  `// This layer is ${SLOP_PAIR[0]} and ${SLOP_PAIR[1]}.`,
  `console.error("the report is ${SLOP_PAIR[0]} and ${SLOP_PAIR[1]} in here");`,
].join('\n');

test('a comment and a message string carry prose, and code does not', () => {
  const found = lint(SOURCE, { tier: 'flavored', kind: 'code', ext: '.mjs' });
  const slop = found.filter((v) => v.rule === 'slop-word');
  assert.equal(slop.length, 4);
  assert.deepEqual([...new Set(slop.map((v) => v.line))].sort(), [3, 4]);
});

test('the marks that end a code line raise no semicolon violation', () => {
  const found = lint(SOURCE, { tier: 'flavored', kind: 'code', ext: '.mjs' });
  assert.deepEqual(found.filter((v) => v.rule === 'semicolon'), []);
});

test('a quoted string holding comment marks never opens a comment', () => {
  const source = `const pattern = "// this layer is ${SLOP_PAIR[0]}";\n`;
  const found = lint(source, { tier: 'flavored', kind: 'code', ext: '.mjs' });
  assert.deepEqual(found.filter((v) => v.rule === 'slop-word'), []);
});

test('a hash language reads its own comment marker', () => {
  const source = `value = 1  # this layer is ${SLOP_PAIR[0]}\n`;
  const found = lint(source, { tier: 'flavored', kind: 'code', ext: '.py' });
  assert.equal(found.filter((v) => v.rule === 'slop-word').length, 1);
});

test('a marker followed by a space and a quote holds no message string', () => {
  const shell = `Write-Host "${MESSAGE_BODY}"\n`;
  assert.deepEqual(lint(shell, { tier: 'flavored', kind: 'code', ext: '.ps1' }), []);
  const script = `console.error "${MESSAGE_BODY}"\n`;
  assert.deepEqual(lint(script, { tier: 'flavored', kind: 'code', ext: '.mjs' }), []);
});

test('a quote that opens the argument list holds a message string', needsTable, () => {
  const shell = `Write-Host("${MESSAGE_BODY}")\n`;
  const found = lint(shell, { tier: 'flavored', kind: 'code', ext: '.ps1' });
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'hard-word');
  assert.match(found[0].msg, new RegExp(RARE_WORD));
});

// ---------------------------------------------------------------------------
// line numbers and sentence ends
// ---------------------------------------------------------------------------

test('a fenced block carries no prose and shifts no line number', () => {
  const text = ['```', 'leverage seamless robust', '```', '', 'This uses leverage.']
    .join('\n');
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const slop = found.filter((v) => v.rule === 'slop-word');
  assert.equal(slop.length, 1);
  assert.equal(slop[0].line, 5);
});

test('a table row and a block quote carry no prose', () => {
  const text = '| a | leverage |\n| - | - |\n\n> this layer is seamless\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  assert.deepEqual(found.filter((v) => v.rule === 'slop-word'), []);
});

test('front matter at the head of a file carries no prose', () => {
  const text = '---\ntitle: seamless\n---\n\nThis uses leverage.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const slop = found.filter((v) => v.rule === 'slop-word');
  assert.equal(slop.length, 1);
  assert.equal(slop[0].line, 5);
});

const TABLE_PARAGRAPH = [
  '`hard-word` and `readability` read word rarity from a table at',
  '`~/.claude/ste/data/word-freq.txt`. The table comes from the Norvig word',
  'count list and holds 333,333 entries. It is never committed to this',
  'repository. `CustomClaude.ps1` calls `build-word-freq.mjs` on every full',
  'launch and refreshes the table.',
].join('\n');

test('a mark that follows a blanked path still ends its sentence', () => {
  const found = lint(TABLE_PARAGRAPH, { tier: 'strict', kind: 'markdown' });
  assert.deepEqual(found.filter((v) => v.rule === 'long-sentence'), []);
});

const COMPONENT_PARAGRAPH = [
  '`manifest.yaml`.',
  '',
  '**Add a component:** create `components/<id>.md` with the 7-key frontmatter',
  '(`id`, `purpose`, `when-to-include`, `min-strictness`, `domains`, `backends`,',
  '`layers`), add an entry in `manifest.yaml` `assembly_order` at the desired',
  'position with its `min-strictness`/`domains`/`backends`. Use `<!-- @when ... -->`',
  'blocks and `<LANG_*>` tokens as needed (see `GRAMMAR.md`).',
].join('\n');

test('a path spelled with code spans keeps the mark that ends its sentence', () => {
  assert.deepEqual(lint(COMPONENT_PARAGRAPH, { tier: 'strict', kind: 'markdown' }), []);
});

test('findings come back ordered by line and then by rule name', () => {
  const text = 'This uses leverage.\n\nA robust line; with a mark.\n';
  const found = lint(text, { tier: 'flavored', kind: 'markdown' });
  const keys = found.map((v) => `${v.line}:${v.rule}`);
  assert.deepEqual(keys, [...keys].sort((a, b) => {
    const [lineA, ruleA] = a.split(':');
    const [lineB, ruleB] = b.split(':');
    return Number(lineA) - Number(lineB) || ruleA.localeCompare(ruleB);
  }));
});

// ---------------------------------------------------------------------------
// vocabulary spellings
// ---------------------------------------------------------------------------

const SPACED_PHRASES = [
  'world class', 'next generation', 'best in class', 'state of the art',
  'game changer', 'game changing',
];

function slopOf(text, options = { tier: 'flavored', kind: 'markdown' }) {
  return lint(text, options).filter((v) => v.rule === 'slop-word');
}

test('a banned compound also spells with a space', () => {
  for (const phrase of SPACED_PHRASES) {
    const slop = slopOf(`This is a ${phrase} parser for the job.`);
    assert.deepEqual(slop.map((v) => v.msg), [`"${phrase}" - drop it.`], phrase);
  }
});

test('the hyphen spelling of those compounds still holds', () => {
  const slop = slopOf('This is a state-of-the-art parser for the job.');
  assert.deepEqual(slop.map((v) => v.msg), ['"state-of-the-art" - drop it.']);
});

test('two banned words also take an adverb tail', () => {
  const seam = slopOf('The upgrade lands seamlessly for every user.');
  assert.deepEqual(seam.map((v) => v.msg),
    ['"seamlessly" - say what actually happens.']);
  const effort = slopOf('The upgrade lands effortlessly for every user.');
  assert.deepEqual(effort.map((v) => v.msg), ['"effortlessly" - drop it.']);
  assert.deepEqual(slopOf('The parser reads it powerfully for every user.'), []);
});

// ---------------------------------------------------------------------------
// regions
// ---------------------------------------------------------------------------

const CODE_OPTIONS = { tier: 'flavored', kind: 'code', ext: '.mjs' };

const CODE_HEADING = '// # Overview of the loader, which is a very long comment '
  + 'sentence running well past twenty five words in total for sure now';

test('no block of a source file is a heading', () => {
  const found = lint(CODE_HEADING, CODE_OPTIONS);
  assert.equal(found.filter((v) => v.rule === 'noun-stack').length, 1);
});

test('front matter opens only on a bare mark', () => {
  const ruled = slopOf('----\nThis layer is seamless.\n');
  assert.equal(ruled.length, 1);
  assert.equal(ruled[0].line, 2);
  assert.equal(slopOf('--- Notes\nThis layer is seamless.\n').length, 1);
});

test('white space may sit between the call paren and the quote', () => {
  const source = `throw new Error( "the parser is ${SLOP_PAIR[1]} about input" );`;
  assert.equal(slopOf(source, CODE_OPTIONS).length, 1);
});

const OPEN_COMMENT = ['/', '*'].join('');
const TRIPLE_QUOTE = '"""';

test('an unterminated comment runs to the end of the file', () => {
  const block = `${OPEN_COMMENT} the loader is ${SLOP_PAIR[1]} about writes`;
  assert.equal(slopOf(block, CODE_OPTIONS).length, 1);
  const doc = `${TRIPLE_QUOTE} the loader is ${SLOP_PAIR[1]} about writes`;
  assert.equal(slopOf(doc, { ...CODE_OPTIONS, ext: '.py' }).length, 1);
});

test('a run inside angle brackets is prose', () => {
  assert.equal(slopOf(`Use the <${SLOP_PAIR[1]}> flag when you run it.`).length, 1);
});

test('four more languages comment with a hash', () => {
  for (const ext of ['.yml', '.yaml', '.toml', '.pl']) {
    const source = `# this comment is ${SLOP_PAIR[1]} and long enough`;
    assert.equal(slopOf(source, { ...CODE_OPTIONS, ext }).length, 1, ext);
  }
});

test('an inline pattern cannot reach inside another', () => {
  const text = `\`"\` mark and a ${SLOP_PAIR[1]} "claim" sits here.`;
  assert.equal(slopOf(text).length, 1);
});

test('a path token holds no semicolon and no colon', () => {
  const text = 'A run foo/bar;baz sits here in the text.';
  const marked = lint(text, { tier: 'flavored' });
  assert.equal(marked.filter((v) => v.rule === 'semicolon').length, 1);
  const joined = `A run ${SLOP_PAIR[0]}:${SLOP_PAIR[1]}/powerful sits here.`;
  assert.equal(slopOf(joined).length, 3);
});

test('an entity body longer than 31 characters is no entity', () => {
  const body = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const found = lint(`A mark &${body}; here.`, { tier: 'flavored' });
  assert.equal(found.filter((v) => v.rule === 'semicolon').length, 1);
});

test('the first part keeps the white space in front of it', () => {
  const parts = splitSentences('  one two.');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, '  one two.');
  assert.equal(parts[0].offset, 0);
});

// ---------------------------------------------------------------------------
// the command line
// ---------------------------------------------------------------------------

const SELF = fileURLToPath(import.meta.url);

/** Hold a stream's writes while run goes, then answer with what it wrote. */
function capture(stream, run) {
  const held = stream.write;
  const chunks = [];
  stream.write = (chunk) => {
    chunks.push(chunk);
    return true;
  };
  try {
    run();
  } finally {
    stream.write = held;
  }
  return chunks.join('');
}

test('the environment empties each target and the report still runs', () => {
  const held = process.env.STE_LINT;
  try {
    process.env.STE_LINT = 'off';
    let status = null;
    const out = capture(process.stdout, () => {
      status = runCli(['--format=json', SELF]);
    });
    assert.equal(status, 0);
    assert.equal(out, '[]\n');
    const skipped = capture(process.stderr, () => {
      assert.equal(runCli(['notes.bin']), 0);
    });
    assert.equal(skipped, 'skip notes.bin: not a prose target\n');
  } finally {
    if (held === undefined) delete process.env.STE_LINT;
    else process.env.STE_LINT = held;
  }
});

test('an empty flag value is ignored, not read as a file name', () => {
  let status = null;
  const skipped = capture(process.stderr, () => {
    status = runCli(['--tier=', '--name=', '--format=', 'notes.bin']);
  });
  assert.equal(status, 0);
  assert.equal(skipped, 'skip notes.bin: not a prose target\n');
});
