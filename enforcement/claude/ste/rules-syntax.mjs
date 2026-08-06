/**
 * rules-syntax - flags a sentence whose shape is hard to hold in the head.
 *
 * The rules in rules-readability.mjs measure words: how rare each one is,
 * how many a sentence carries. Both signals are blind to shape. A sentence
 * of sixteen ordinary words passes both and still reads badly. The README
 * quotes the one that started this rule.
 *
 * What makes such a sentence hard is distance. An opening `should` can wait
 * seven words for its `be`, with a whole relative clause wedged in between.
 * The reader holds the opening in mind the entire way. Research on
 * dependency distance names that gap directly. A word can leave working
 * memory only once it meets the word it depends on.
 *
 * A real dependency parse would measure the gap exactly. No maintained
 * parser exists for this runtime. Pulling in a tagged model would put a
 * package tree behind a hook that today copies plain files. So this module
 * does what rules-structure.mjs does. Closed word lists and adjacency
 * checks stand in for grammar. It counts three kinds of strain and reports
 * a sentence that carries three points at once.
 */

import { splitSentences } from './ste-lint.mjs';

const MODALS = new Set([
  'should', 'would', 'could', 'shall', 'will', 'can', 'may', 'might',
  'must', 'ought',
]);

const BE_FORMS = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', 'am']);

const OTHER_AUXILIARIES = new Set([
  'have', 'has', 'had', 'having', 'do', 'does', 'did',
]);

const RELATIVE_PRONOUNS = new Set(['that', 'which', 'who', 'whom', 'whose']);

/**
 * Words that open a new clause of equal rank. An auxiliary before one of
 * these cannot govern a verb after it. So the search for its partner verb
 * stops here. Without this rule, `the table does not hold that, so the
 * guess is dropped` read as one stretched auxiliary.
 */
const COORDINATORS = new Set(['and', 'but', 'or', 'nor', 'so', 'yet', 'then']);

/** Marks that end a clause the same way a coordinator does. */
const CLAUSE_BREAK = /[,;:()]/;

/** Past participles that do not end in `ed`. The list only needs the verbs
 *  that carry a passive in ordinary technical writing. */
const IRREGULAR_PARTICIPLES = new Set([
  'been', 'begun', 'broken', 'brought', 'built', 'bought', 'caught', 'chosen',
  'come', 'cut', 'done', 'drawn', 'driven', 'eaten', 'fallen', 'felt', 'found',
  'given', 'gone', 'got', 'gotten', 'held', 'hidden', 'hit', 'kept', 'known',
  'laid', 'left', 'lost', 'made', 'meant', 'met', 'paid', 'put', 'read',
  'run', 'said', 'seen', 'sent', 'set', 'shown', 'shut', 'sold', 'spent',
  'split', 'spoken', 'stood', 'taken', 'taught', 'thought', 'thrown', 'told',
  'understood', 'won', 'written',
]);

const WORD_PATTERN = /[A-Za-z][A-Za-z'-]*/g;

/** Words allowed between an auxiliary and the verb it governs. Past that,
 *  the reader is holding the opening open across a whole clause. */
const MAX_AUXILIARY_GAP = 4;

/** Adverbs the passive test steps over, as in `is not fully covered`. */
const MAX_ADVERBS = 2;

/**
 * How many points of strain a sentence may carry before it is flagged. At
 * three, the sample in the README scores three and every block of this
 * repository's own prose stays clear.
 */
export const STRAIN_THRESHOLD = 3;

function isAuxiliary(word) {
  return MODALS.has(word) || BE_FORMS.has(word) || OTHER_AUXILIARIES.has(word);
}

function isParticiple(word) {
  if (IRREGULAR_PARTICIPLES.has(word)) return true;
  return word.length >= 4 && word.endsWith('ed');
}

function isAdverb(word) {
  return word.length > 3 && word.endsWith('ly');
}

/**
 * Split text into word tokens. Each one records whether a clause break sits
 * in front of it, either a mark of punctuation or a coordinating word.
 */
function tokenize(text) {
  const tokens = [];
  WORD_PATTERN.lastIndex = 0;
  let end = 0;
  let m;
  while ((m = WORD_PATTERN.exec(text)) !== null) {
    const word = m[0].toLowerCase();
    const gap = text.slice(end, m.index);
    tokens.push({ word, breaks: CLAUSE_BREAK.test(gap) || COORDINATORS.has(word) });
    end = m.index + m[0].length;
  }
  return tokens;
}

/** Count passives: a form of `be`, up to two adverbs, then a participle. */
function countPassives(words) {
  let found = 0;
  for (let i = 0; i < words.length; i++) {
    if (!BE_FORMS.has(words[i])) continue;
    let j = i + 1;
    while (j < words.length && j <= i + MAX_ADVERBS && isAdverb(words[j])) j++;
    if (j < words.length && isParticiple(words[j])) found++;
  }
  return found;
}

/**
 * Every auxiliary that waits more than MAX_AUXILIARY_GAP words for the next
 * auxiliary or participle, as a span from the auxiliary to its partner. The
 * search stops at a clause break, because a verb past one belongs to a
 * different clause.
 */
function stretchedSpans(tokens) {
  const spans = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!isAuxiliary(tokens[i].word)) continue;
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].breaks) break;
      if (!isAuxiliary(tokens[j].word) && !isParticiple(tokens[j].word)) continue;
      if (j - i - 1 > MAX_AUXILIARY_GAP) spans.push([i, j]);
      break;
    }
  }
  return spans;
}

/** Count spans that hold a relative pronoun, so a whole clause sits between
 *  an auxiliary and the verb it governs. */
function countInterruptions(tokens, spans) {
  let found = 0;
  for (const [i, j] of spans) {
    for (let k = i + 1; k < j; k++) {
      if (!RELATIVE_PRONOUNS.has(tokens[k].word)) continue;
      found++;
      break;
    }
  }
  return found;
}

/**
 * The strain one sentence carries, counted per kind.
 *
 * A repeated word was a fourth signal here and is gone. These writing rules
 * ask for one name for one thing. A paragraph that names the parser four
 * times is following that rule, not breaking it.
 */
export function strainOf(sentence) {
  const tokens = tokenize(sentence);
  const spans = stretchedSpans(tokens);
  return {
    passive: countPassives(tokens.map((token) => token.word)),
    stretched: spans.length,
    interrupted: countInterruptions(tokens, spans),
  };
}

function strainTotal(strain) {
  return strain.passive + strain.stretched + strain.interrupted;
}

function strainNames(strain) {
  const names = [];
  if (strain.stretched) names.push(`${strain.stretched} auxiliary far from its verb`);
  if (strain.interrupted) names.push(`${strain.interrupted} clause inside a subject`);
  if (strain.passive) names.push(`${strain.passive} passive`);
  return names.join(', ');
}

function lineOf(block, offset) {
  const before = block.text.slice(0, offset);
  return block.line + (before.match(/\n/g) || []).length + 1;
}

/**
 * Find every tangled sentence in block and return violations in the shape
 * the linter uses. A sentence is judged on its own. Never throws.
 */
export function tangledSentenceRule(block) {
  try {
    if (block.heading) return [];
    const found = [];
    for (const sentence of splitSentences(block.text)) {
      const strain = strainOf(sentence.text);
      const total = strainTotal(strain);
      if (total < STRAIN_THRESHOLD) continue;

      found.push({
        line: lineOf(block, sentence.offset),
        rule: 'tangled-sentence',
        sev: 'error',
        msg: `sentence carries ${total} points of strain (${strainNames(strain)}), `
          + `past the cap of ${STRAIN_THRESHOLD - 1}. Put the subject next to its `
          + 'verb and split the rest off.',
      });
    }
    return found;
  } catch {
    return [];
  }
}
