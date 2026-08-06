/**
 * foreign-words - positive evidence that a block is written in another
 * language this machine writes.
 *
 * language.mjs used to find a foreign block by absence: too few English
 * function words, then too many rare words. That fails on a block that mixes
 * another language with code identifiers. A Dutch commit body about C# reads
 * as easy English, because `filter`, `guard`, `null` and `static` are common
 * English, and short Dutch words such as `voor` and `naar` sit at ordinary
 * scores in an English frequency table. This module supplies the opposite
 * evidence, which no identifier can dilute in the same way.
 *
 * Each set holds function words that are common in its own language and are
 * not English words. Entries carry no accented letters, because the word
 * pattern reads ASCII letters only and would split such a word in two.
 */

/**
 * Words dropped from a set because English writes them too. `die`, `van`,
 * `met`, `door` and `hier` are ordinary Dutch. `war`, `hat`, `man` and `mit`
 * are ordinary German, and `mit` also lowercases out of the name MIT. `sin`,
 * `con`, `son`, `un` and `solo` are ordinary Spanish. `do` and `no` are
 * ordinary Portuguese. `par`, `plus` and `son` are ordinary French. Dropping
 * them costs a little signal in each language and buys separation from
 * English.
 */

const DUTCH = `
de het een en niet maar ook voor naar zijn wordt worden deze dit dat als aan
bij nog wel geen tussen omdat hebben heeft moet kan naast zoals andere alleen
welke daar dus uit te om er ze hun waar wij ik je niets alles zonder tegen
onder meer altijd nooit vaak samen iets veel elke dan toen hoe wat wie waarom
terwijl echter verder binnen buiten boven beneden eerst laatste volgende
plaats
`;

const GERMAN = `
der das und nicht aber auch ein eine einen einem den dem des zu ist sie sich
wird werden wenn dann oder nach bei aus auf sind haben kann muss nur noch
schon sehr alle jede jeden diese dieser dieses keine kein wie weil damit durch
zwischen nicht immer nie beide erste letzte naechste
`;

const SPANISH = `
el la las del que por para como pero mas este esta esto esa ese sus cuando
donde porque tambien entre hasta desde sobre muy cada otro otra ser
estan tiene hacer puede debe siempre nunca ambos primera ultima siguiente
mismo mientras aunque
`;

const PORTUGUESE = `
uma que por para como mas nao quando onde porque tambem entre ate
desde sobre sem muito cada outro outra ser esta sao tem fazer pode
deve pelo pela isso este esse seu sua seus suas
sempre nunca ambos primeira ultima seguinte enquanto embora
`;

const FRENCH = `
le les des du une dans pour avec sur sont pas qui que cette ces mais aux
comme quand tout tous chaque autre etre avoir peut doit nous vous leur leurs
cet ses alors donc ainsi entre sans sous meme toujours jamais premiere
derniere suivante pendant
`;

/** Every language set, keyed by name, as a set of lowercase whole words. */
const LANGUAGES = new Map(Object.entries({
  dutch: DUTCH,
  german: GERMAN,
  spanish: SPANISH,
  portuguese: PORTUGUESE,
  french: FRENCH,
}).map(([name, list]) => [name, new Set(list.trim().split(/\s+/))]));

/** Share of words that belong to set. */
function shareOf(words, set) {
  const hits = words.filter((word) => set.has(word)).length;
  return hits / words.length;
}

/**
 * The language whose function words cover the most of words, and what share
 * they cover. Returns a zero share and a null language for an empty list, so
 * a caller never has to test the list first.
 */
export function bestForeignShare(words) {
  let best = { language: null, share: 0 };
  if (words.length === 0) return best;
  for (const [language, set] of LANGUAGES) {
    const share = shareOf(words, set);
    if (share > best.share) best = { language, share };
  }
  return best;
}
