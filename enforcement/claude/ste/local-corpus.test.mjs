import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { corpusSize, isLocalWord, setCorpusRoot } from './local-corpus.mjs';

function git(dir, ...args) {
  return spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
}

const hasGit = git(tmpdir(), 'version').status === 0;

/** Build a throwaway project tree from a map of relative path to content. */
function withProject(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ste-local-corpus-'));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body, 'utf8');
  }
  try {
    setCorpusRoot(dir);
    fn(dir);
  } finally {
    setCorpusRoot(null);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a word in two files joins the vocabulary', () => {
  withProject({
    'one.md': 'The zoological report is ready.',
    'two.md': 'A second zoological note.',
  }, () => {
    assert.equal(isLocalWord('zoological'), true);
  });
});

test('a word used once in one file does not join, because a typo looks like that', () => {
  withProject({ 'one.md': 'The zooological report is ready.' }, () => {
    assert.equal(isLocalWord('zooological'), false);
  });
});

test('a word used five times in one file joins', () => {
  withProject({
    'one.md': 'zoological zoological zoological zoological zoological',
  }, () => {
    assert.equal(isLocalWord('zoological'), true);
  });
});

test('the lookup ignores case', () => {
  withProject({
    'one.md': 'Zoological survey.',
    'two.md': 'zoological survey.',
  }, () => {
    assert.equal(isLocalWord('ZOOLOGICAL'), true);
  });
});

test('an identifier votes for the words it is built from', () => {
  withProject({
    'a.js': 'const zoologicalCount = 1;',
    'b.js': 'let otherZoologicalThing = 2;',
  }, () => {
    assert.equal(isLocalWord('zoological'), true);
  });
});

test('a word only a vendor directory uses does not join', () => {
  withProject({
    'node_modules/pkg/a.js': 'zoological zoological zoological zoological zoological',
    'src/b.js': 'const x = 1;',
  }, () => {
    assert.equal(isLocalWord('zoological'), false);
  });
});

test('a word only a plugin directory uses does not join', () => {
  withProject({
    'plugins/other/a.md': 'zoological zoological zoological zoological zoological',
    'README.md': 'Nothing here.',
  }, () => {
    assert.equal(isLocalWord('zoological'), false);
  });
});

test('a file of a kind the corpus does not read contributes nothing', () => {
  withProject({
    'data.bin': 'zoological zoological zoological zoological zoological',
    'notes.log': 'zoological zoological zoological zoological zoological',
  }, () => {
    assert.equal(isLocalWord('zoological'), false);
  });
});

test('a short token joins, because the acronym rule asks about those', () => {
  withProject({ 'one.md': 'The PD board.', 'two.md': 'Another PD note.' }, () => {
    assert.equal(isLocalWord('pd'), true);
  });
});

test('a name that carries a digit joins under its whole spelling', () => {
  withProject({
    'one.md': 'The STE100 standard applies.',
    'two.md': 'A second STE100 note.',
  }, () => {
    assert.equal(isLocalWord('ste100'), true);
    assert.equal(isLocalWord('ste'), true);
  });
});

test('a token counts once per use, however many pieces it splits into', () => {
  // Three uses, and the threshold is five. Double counting would pass this.
  withProject({ 'one.md': 'zoological zoological zoological' }, () => {
    assert.equal(isLocalWord('zoological'), false);
  });
});

test('a single letter never joins, since no rule asks about one', () => {
  withProject({ 'one.md': 'a a a a a a', 'two.md': 'a again' }, () => {
    assert.equal(isLocalWord('a'), false);
  });
});

test('an empty project yields an empty vocabulary', () => {
  withProject({}, () => {
    assert.equal(corpusSize(), 0);
    assert.equal(isLocalWord('anything'), false);
  });
});

test('the environment switch turns the corpus off', () => {
  withProject({
    'one.md': 'zoological report',
    'two.md': 'zoological note',
  }, () => {
    process.env.STE_LOCAL_CORPUS = 'off';
    setCorpusRoot(process.cwd());
    try {
      assert.equal(isLocalWord('zoological'), false);
    } finally {
      delete process.env.STE_LOCAL_CORPUS;
    }
  });
});

test('a missing root answers false rather than throwing', () => {
  setCorpusRoot(join(tmpdir(), 'ste-local-corpus-does-not-exist'));
  try {
    assert.equal(isLocalWord('zoological'), false);
  } finally {
    setCorpusRoot(null);
  }
});

test('a file .gitignore blocks contributes nothing', { skip: !hasGit }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ste-local-corpus-git-'));
  try {
    git(dir, 'init', '-q');
    writeFileSync(join(dir, '.gitignore'), 'ignored.md\n', 'utf8');
    writeFileSync(join(dir, 'ignored.md'), 'zoological zoological zoological zoological zoological', 'utf8');
    writeFileSync(join(dir, 'kept.md'), 'hermeneutic hermeneutic hermeneutic hermeneutic hermeneutic', 'utf8');
    git(dir, 'add', '-A');
    setCorpusRoot(dir);
    assert.equal(isLocalWord('zoological'), false);
    assert.equal(isLocalWord('hermeneutic'), true);
  } finally {
    setCorpusRoot(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an untracked file contributes nothing, so a new word cannot vote for itself', { skip: !hasGit }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ste-local-corpus-new-'));
  try {
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'kept.md'), 'hermeneutic note here', 'utf8');
    git(dir, 'add', '-A');
    writeFileSync(join(dir, 'fresh.md'), 'zoological zoological zoological zoological zoological', 'utf8');
    setCorpusRoot(dir);
    assert.equal(isLocalWord('zoological'), false);
  } finally {
    setCorpusRoot(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a cache built under different settings is rebuilt, not read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ste-local-corpus-stale-'));
  const cacheFile = join(dir, 'vocab.tsv');
  try {
    writeFileSync(join(dir, 'one.md'), 'The zoological report.', 'utf8');
    writeFileSync(join(dir, 'two.md'), 'Another zoological note.', 'utf8');
    writeFileSync(cacheFile, '# ste-local-corpus v0 minlen=5\nhermeneutic\n', 'utf8');
    setCorpusRoot(dir, cacheFile);
    assert.equal(isLocalWord('hermeneutic'), false);
    assert.equal(isLocalWord('zoological'), true);
  } finally {
    setCorpusRoot(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a built vocabulary is written to the cache file it was given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ste-local-corpus-cache-'));
  writeFileSync(join(dir, 'one.md'), 'The zoological report.', 'utf8');
  writeFileSync(join(dir, 'two.md'), 'Another zoological note.', 'utf8');
  const cacheFile = join(dir, 'vocab.tsv');
  try {
    setCorpusRoot(dir, cacheFile);
    assert.equal(isLocalWord('zoological'), true);
    // A second reader starts cold and has to answer from the cache alone.
    setCorpusRoot(join(tmpdir(), 'ste-local-corpus-empty'), cacheFile);
    assert.equal(isLocalWord('zoological'), true);
  } finally {
    setCorpusRoot(null);
    rmSync(dir, { recursive: true, force: true });
  }
});
