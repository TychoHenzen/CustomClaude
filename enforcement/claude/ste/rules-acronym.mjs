/**
 * rules-acronym - flags an acronym the reader has no way to resolve.
 *
 * A three-letter abbreviation dropped into a sentence with no expansion is
 * a reliable way to make prose unreadable. The reader either knows it or
 * stops. A rare word gives partial credit. An acronym gives none, because
 * the letters carry no clue to their meaning.
 *
 * This rule runs over the whole file rather than one block at a time. The
 * expansion that rescues an acronym often sits paragraphs above the use
 * that needs it. It reports the first use only, so one unexplained term
 * costs one finding however often it appears.
 */

import { bestLogFrequency } from './word-forms.mjs';
import { OOV_FLOOR } from './word-freq.mjs';
import { isLocalWord } from './local-corpus.mjs';

/**
 * Abbreviations in wide enough use that spelling them out reads as noise.
 * The test for an entry is whether a working programmer meets it weekly
 * without looking it up.
 */
const WELL_KNOWN = new Set(`
API HTTP HTTPS URL URI URN HTML CSS XML JSON YAML TOML CSV TSV SQL
CLI GUI TUI UI UX OS IO ID UUID GUID PDF PNG JPG JPEG GIF SVG WEBP
ASCII UTF BOM CPU GPU RAM ROM SSD HDD USB DNS TCP UDP IP SSH TLS SSL
FTP SMTP IMAP REST RPC GRPC CRUD ORM MVC MVVM SDK IDE VM JVM OOP
TDD BDD CI CD PR QA LTS EOL EOF FAQ TODO FIXME HACK NOTE XXX
UTC ISO RFC IEEE ANSI W3C MIT GPL BSD LGPL NPM PNPM YARN
PATH HOME ENV ARGV ARGC STDIN STDOUT STDERR NUL LF CR CRLF TTY PID
AI ML LLM NLP GPT RAG MCP JS TS PHP PS PWSH WSL DOM CDN ETL DB
KB MB GB TB MS NS HZ FPS RGB RGBA HSL README LICENSE
CEO CTO ETA FYI USA UK EU AM PM
`.trim().split(/\s+/));

/**
 * Log frequency at or above which an all-capital token is a shouted word,
 * not an acronym. NEVER at 2.41, ALWAYS at 2.34 and MUST at 2.70 all sit
 * above this line. So do STOP at 2.12 and AVOID at 1.79. The sample
 * acronyms sit at 0.52 and 0.11, so both stay eligible. An acronym that
 * spells a very common word is missed here. That is the safe way to miss.
 */
const EMPHASIS_FLOOR = 1.5;

/**
 * Endings that mark an inflected English word. An acronym does not take an
 * ending like that, so a capitalized token that carries one is a shout.
 * This catches the shouts under EMPHASIS_FLOOR. BANNED at 1.00, VERBS at
 * 0.48 and SENTENCES at 0.99 are ordinary words wearing capitals.
 */
const INFLECTIONS = ['ed', 'ing', 'es', 's', 'ly'];

/** An acronym is two to six capitals, with an optional plural s. */
const ACRONYM_PATTERN = /\b([A-Z][A-Z0-9]{1,5})(s)?\b/g;

/** A line in capitals throughout is a shouted label, not prose. */
const SHOUTED_LINE = /^[^a-z]*$/;

function lineTextAt(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? text.length : end);
}

function lineNumberAt(text, index) {
  return (text.slice(0, index).match(/\n/g) || []).length + 1;
}

/**
 * Pattern that matches a spelled-out expansion of acronym. Each letter has
 * to open a word. The words have to run one after another, separated by a
 * space or a hyphen. So `SQL` matches `structured query language` in any
 * casing.
 */
function expansionPattern(acronym) {
  const parts = [...acronym].map((ch) => `${ch}[A-Za-z]*`);
  return new RegExp(`\\b${parts.join('[\\s-]+')}\\b`, 'i');
}

/**
 * Pattern for a bracket right after the acronym holding two words or more.
 * A hyphenated tail counts as part of the name, so the bracket after
 * `ASD-STE100` explains `ASD` as well as `STE100`.
 */
function bracketPattern(acronym) {
  const name = `\\b${acronym}(?:s|-[A-Za-z0-9]+)?`;
  return new RegExp(`${name}\\s*\\([^)]*[A-Za-z]{2,}[^)]*\\s[^)]*\\)`);
}

/** True when the file explains acronym somewhere, either by spelling it out
 *  or by putting a phrase in brackets right after it. */
function isExplained(text, acronym) {
  if (bracketPattern(acronym).test(text)) return true;
  const spelled = expansionPattern(acronym);
  const match = spelled.exec(text);
  if (!match) return false;
  // A one-word "expansion" is the acronym itself in some other casing.
  return /[\s-]/.test(match[0]);
}

/** True when the token is really a shouted ordinary word: common enough on
 *  its own, or an inflected form the table already knows. */
function isShoutedWord(acronym) {
  const lower = acronym.toLowerCase();
  const freq = bestLogFrequency(lower);
  if (freq === null || freq === OOV_FLOOR) return false;
  if (freq >= EMPHASIS_FLOOR) return true;
  return INFLECTIONS.some((ending) => lower.endsWith(ending));
}

/**
 * True when this project writes the token often enough that it reads as a
 * name rather than an abbreviation. A repository that writes `HELM` a
 * hundred times is naming the thing. Asking the writer to expand it in
 * every file would be noise.
 *
 * The corpus reads tracked files only, so a term the current turn just
 * invented does not qualify. A genuinely new acronym is still reported on
 * its first use.
 */
function isProjectName(acronym) {
  return isLocalWord(acronym);
}

function isSkippable(text, acronym, index) {
  if (WELL_KNOWN.has(acronym)) return true;
  if (SHOUTED_LINE.test(lineTextAt(text, index))) return true;
  if (isShoutedWord(acronym)) return true;
  if (isProjectName(acronym)) return true;
  return isExplained(text, acronym);
}

/**
 * Every unexplained acronym in text, reported at its first use. The input
 * is the blanked canvas, so an acronym inside a code span, a fence or a
 * path never reaches this rule. Never throws.
 */
export function acronymRule(text) {
  try {
    const found = [];
    const seen = new Set();
    ACRONYM_PATTERN.lastIndex = 0;
    let m;
    while ((m = ACRONYM_PATTERN.exec(text)) !== null) {
      const acronym = m[1];
      if (seen.has(acronym)) continue;
      seen.add(acronym);
      if (isSkippable(text, acronym, m.index)) continue;

      found.push({
        line: lineNumberAt(text, m.index),
        rule: 'acronym',
        msg: `"${acronym}" is an acronym the reader cannot resolve. Spell it out `
          + 'on first use, or put its meaning in brackets right after it.',
      });
    }
    return found;
  } catch {
    return [];
  }
}
