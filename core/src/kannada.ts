// Copied from the billing app (Shridhar/billing-app/shared/src/kannada.ts) so the two repos never depend
// on each other. The billing app is the original: if its search rules change, copy them here.

/**
 * Latin-to-Kannada transliteration, so the shopkeeper can type item names without a Kannada
 * keyboard installed on the device.
 *
 * Handwriting covers regional language without any of this -- a pen stroke has no script. But
 * item names in the catalogue are typed once and searched often, and a tablet that has never had
 * Gboard's Kannada layout added cannot produce ಅಕ್ಕಿ at all. Typing "akki" can.
 *
 * The mapping is the usual ITRANS-style one: doubled or capital letters mark the long vowels and
 * the retroflex consonants. It is deliberately paired with a live preview in the UI, because no
 * scheme guesses every word right and seeing the output is what makes a wrong guess fixable.
 */

/** Longest keys first within each group: 'chh' must win over 'ch', and 'ch' over 'c'. */
const CONSONANTS: [string, string][] = [
  ['chh', 'ಛ'],
  ['kh', 'ಖ'], ['gh', 'ಘ'], ['~g', 'ಙ'],
  ['ch', 'ಚ'], ['jh', 'ಝ'], ['~j', 'ಞ'],
  ['Th', 'ಠ'], ['Dh', 'ಢ'],
  ['th', 'ಥ'], ['dh', 'ಧ'],
  ['ph', 'ಫ'], ['bh', 'ಭ'],
  ['sh', 'ಶ'], ['Sh', 'ಷ'],
  ['k', 'ಕ'], ['g', 'ಗ'],
  ['j', 'ಜ'],
  ['T', 'ಟ'], ['D', 'ಡ'], ['N', 'ಣ'],
  ['t', 'ತ'], ['d', 'ದ'], ['n', 'ನ'],
  ['p', 'ಪ'], ['b', 'ಬ'], ['m', 'ಮ'],
  ['y', 'ಯ'], ['r', 'ರ'], ['l', 'ಲ'], ['L', 'ಳ'],
  ['v', 'ವ'], ['w', 'ವ'],
  ['s', 'ಸ'], ['h', 'ಹ'],
];

/** [key, independent vowel, vowel sign]. The sign for 'a' is empty: it is inherent. */
const VOWELS: [string, string, string][] = [
  ['aa', 'ಆ', 'ಾ'], ['ai', 'ಐ', 'ೈ'], ['au', 'ಔ', 'ೌ'],
  ['ee', 'ಏ', 'ೇ'], ['ii', 'ಈ', 'ೀ'], ['oo', 'ಓ', 'ೋ'], ['uu', 'ಊ', 'ೂ'],
  ['Ru', 'ಋ', 'ೃ'],
  ['A', 'ಆ', 'ಾ'], ['I', 'ಈ', 'ೀ'], ['U', 'ಊ', 'ೂ'], ['E', 'ಏ', 'ೇ'], ['O', 'ಓ', 'ೋ'],
  ['a', 'ಅ', ''], ['i', 'ಇ', 'ಿ'], ['u', 'ಉ', 'ು'], ['e', 'ಎ', 'ೆ'], ['o', 'ಒ', 'ೊ'],
];

const VIRAMA = '್';
const ANUSVARA = 'ಂ';
const VISARGA = 'ಃ';

function matchAt(source: string, at: number, keys: string[]): string | null {
  for (const key of keys) {
    if (source.startsWith(key, at)) return key;
  }
  return null;
}

const CONSONANT_KEYS = CONSONANTS.map(([k]) => k);
const VOWEL_KEYS = VOWELS.map(([k]) => k);
const CONSONANT_MAP = new Map(CONSONANTS);
const VOWEL_MAP = new Map(VOWELS.map(([k, independent, sign]) => [k, { independent, sign }]));

/**
 * "akki" -> ಅಕ್ಕಿ, "sakkare" -> ಸಕ್ಕರೆ, "eNNe" -> ಎಣ್ಣೆ.
 *
 * A consonant with no vowel after it takes a virama, which is what makes clusters like "kk" come
 * out as ಕ್ಕ rather than two separate syllables. Anything the tables do not know -- digits,
 * spaces, punctuation, Kannada that is already Kannada -- passes through untouched.
 */
export function latinToKannada(input: string): string {
  let out = '';
  let pending: string | null = null;
  let at = 0;

  const flush = (withVirama: boolean) => {
    if (pending == null) return;
    out += pending + (withVirama ? VIRAMA : '');
    pending = null;
  };

  while (at < input.length) {
    const consonant = matchAt(input, at, CONSONANT_KEYS);
    if (consonant) {
      // A consonant following a consonant means a cluster, so the first one loses its inherent 'a'.
      flush(true);
      pending = CONSONANT_MAP.get(consonant) as string;
      at += consonant.length;
      continue;
    }

    const vowel = matchAt(input, at, VOWEL_KEYS);
    if (vowel) {
      const { independent, sign } = VOWEL_MAP.get(vowel)!;
      if (pending != null) {
        out += pending + sign;
        pending = null;
      } else {
        out += independent;
      }
      at += vowel.length;
      continue;
    }

    const ch = input[at] as string;
    if (ch === 'M') {
      // Anusvara rides on the syllable already built, keeping its inherent vowel.
      flush(false);
      out += ANUSVARA;
      at += 1;
      continue;
    }
    if (ch === 'H') {
      flush(false);
      out += VISARGA;
      at += 1;
      continue;
    }

    flush(true);
    out += ch;
    at += 1;
  }

  flush(true);
  return out;
}

/*
 * ---------------------------------------------------------------- the other direction
 *
 * The tables above turn Latin into Kannada. Reversed, they turn Kannada into Latin, which is
 * what lets a name typed in one script find a name stored in the other.
 *
 * Derived from those same tables rather than written out again: a second copy of a mapping this
 * size drifts from the first the week someone corrects one of them. Where the forward table has
 * two ways to write the same glyph on purpose -- `v` and `w` both give ವ -- the first wins,
 * which is why the tables are ordered as they are.
 */
const CONSONANT_BY_GLYPH = new Map<string, string>();
for (const [latin, glyph] of CONSONANTS) {
  if (!CONSONANT_BY_GLYPH.has(glyph)) CONSONANT_BY_GLYPH.set(glyph, latin);
}

const VOWEL_BY_LETTER = new Map<string, string>();
const VOWEL_BY_SIGN = new Map<string, string>();
for (const [latin, independent, sign] of VOWELS) {
  if (!VOWEL_BY_LETTER.has(independent)) VOWEL_BY_LETTER.set(independent, latin);
  // The sign for the inherent 'a' is the empty string, which is not a character to look up.
  if (sign && !VOWEL_BY_SIGN.has(sign)) VOWEL_BY_SIGN.set(sign, latin);
}

/**
 * ಅಕ್ಕಿ -> "akki", ರಮೇಶ್ -> "rameesh".
 *
 * Kannada is an abugida: a consonant carries an inherent 'a', a vowel sign replaces that 'a',
 * and the virama removes it. So the inherent vowel is held back until the next character says
 * what became of it. Anything that is not Kannada -- Latin, digits, spaces -- passes through.
 */
export function romanise(text: string): string {
  let out = '';
  let owed = '';
  const flush = () => { out += owed; owed = ''; };

  for (const ch of text) {
    const consonant = CONSONANT_BY_GLYPH.get(ch);
    if (consonant != null) { flush(); out += consonant; owed = 'a'; continue; }

    const sign = VOWEL_BY_SIGN.get(ch);
    if (sign != null) { owed = sign; flush(); continue; }

    if (ch === VIRAMA) { owed = ''; continue; }

    const vowel = VOWEL_BY_LETTER.get(ch);
    if (vowel != null) { flush(); out += vowel; continue; }

    if (ch === ANUSVARA) { flush(); out += 'n'; continue; }
    if (ch === VISARGA) { flush(); out += 'h'; continue; }

    flush();
    out += ch;
  }
  flush();
  return out;
}

/**
 * A rough phonetic key, for matching a name typed in one script against one stored in the other.
 *
 * Romanising is only half of it. Kannada tells apart sounds that English spelling does not, and
 * the forward scheme above marks those differences with capitals and doubled letters -- ಎಣ್ಣೆ is
 * `eNNe`, ಹಿಟ್ಟು is `hiTTu`. Nobody types that at a counter; they type `enne` and `hittu`. So
 * both sides of the comparison are folded down to what an English speaker would actually reach
 * for: retroflex onto dental, the three s-sounds together, aspirates onto their plain consonant,
 * long vowels onto short, doubles onto singles.
 *
 * That trades precision for recall, deliberately. ಕಟ and ಖಠ end up with the same key, so a
 * search can turn up a name that merely sounds close. In a shop with a few hundred customers
 * five suggestions to glance at beats a name that cannot be found at all.
 */
export function searchKey(text: string): string {
  // English "oo" is the long u (Santoor = ಸಂತೂರ್), so typed Latin folds it before romanising;
  // Kannada glyphs are untouched by this.
  return romanise(String(text ?? '').replace(/oo/gi, 'u'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    // Aspirates: kha -> ka, sha -> sa, chha -> cha. The + is what makes ಛ and ಚ agree.
    .replace(/([kgcjtdpbs])h+/g, '$1')
    /*
     * Two spellings the reversed tables get wrong for a Kannada name written in English.
     *
     * The forward table offers both `v` and `w` for the same glyph and the first one wins on
     * the way back, so a stored name romanises to `v` where the shopkeeper types `w`. And the
     * au vowel sign comes back as `au` where the usual English spelling is `ow` -- Gowda, the
     * commonest surname in Karnataka, missed on exactly this.
     */
    .replace(/w/g, 'v')
    /*
     * The anusvara assimilates to whatever follows it -- an `n` before a dental, an `m`
     * before a labial -- so ನಂದಿ is said `nandi` and ಸಂಪ is said `sampa`. Romanising it as
     * either letter is therefore wrong half the time, so both fold to one nasal, but only
     * before a consonant. Leaving a final or pre-vowel `m` alone is what keeps Rama and
     * Rana two different people.
     */
    .replace(/m(?=[bcdfghjklmnpqrstvxyz])/g, 'n')
    .replace(/o([uv])/g, 'au')
    // Long vowels onto short, doubled consonants onto single: haalu -> halu, hiTTu -> hitu.
    .replace(/([a-z0-9])\1+/g, '$1');
}

/** True if the text contains at least one Kannada character. */
export function hasKannada(text: string): boolean {
  return /[ಀ-೿]/.test(text);
}

/**
 * Kirana and brand words whose Kannada spelling is settled and that the rules below would get
 * wrong (English spelling does not say how "Tide" or "Maggi" is said). Checked before the rules.
 */
export const KANNADA_WORDS: Record<string, string> = {
  santoor: 'ಸಂತೂರ್', small: 'ಸ್ಮಾಲ್', vimal: 'ವಿಮಲ್', parle: 'ಪಾರ್ಲೆ', surf: 'ಸರ್ಫ್', rin: 'ರಿನ್',
  tide: 'ಟೈಡ್', lux: 'ಲಕ್ಸ್', dettol: 'ಡೆಟಾಲ್', colgate: 'ಕೋಲ್ಗೇಟ್', maggi: 'ಮ್ಯಾಗಿ',
  sunsilk: 'ಸನ್ಸಿಲ್ಕ್', clinic: 'ಕ್ಲಿನಿಕ್', plus: 'ಪ್ಲಸ್', punjabi: 'ಪಂಜಾಬಿ', tadka: 'ತಡ್ಕಾ',
  sugar: 'ಶುಗರ್', rice: 'ರೈಸ್', excel: 'ಎಕ್ಸೆಲ್', big: 'ಬಿಗ್', pack: 'ಪ್ಯಾಕ್', oil: 'ಆಯಿಲ್',
  soap: 'ಸೋಪ್', powder: 'ಪೌಡರ್', salt: 'ಸಾಲ್ಟ್', tea: 'ಟೀ', coffee: 'ಕಾಫಿ', biscuit: 'ಬಿಸ್ಕತ್',
  gold: 'ಗೋಲ್ಡ್', red: 'ರೆಡ್', label: 'ಲೇಬಲ್', tata: 'ಟಾಟಾ', amul: 'ಅಮುಲ್', britannia: 'ಬ್ರಿಟಾನಿಯಾ',
  good: 'ಗುಡ್', day: 'ಡೇ', dove: 'ಡವ್', lifebuoy: 'ಲೈಫ್ಬಾಯ್', wheel: 'ವ್ಹೀಲ್', ariel: 'ಏರಿಯಲ್',
  nirma: 'ನಿರ್ಮಾ', horlicks: 'ಹಾರ್ಲಿಕ್ಸ್', boost: 'ಬೂಸ್ಟ್', bournvita: 'ಬೋರ್ನ್ವಿಟಾ', kissan: 'ಕಿಸಾನ್',
  aashirvaad: 'ಆಶೀರ್ವಾದ್', fortune: 'ಫಾರ್ಚೂನ್', gemini: 'ಜೆಮಿನಿ', medimix: 'ಮೆಡಿಮಿಕ್ಸ್',
  pears: 'ಪಿಯರ್ಸ್', cinthol: 'ಸಿಂಥಾಲ್', harpic: 'ಹಾರ್ಪಿಕ್', vim: 'ವಿಮ್', bar: 'ಬಾರ್', liquid: 'ಲಿಕ್ವಿಡ್',
  shampoo: 'ಶಾಂಪೂ', paste: 'ಪೇಸ್ಟ್', brush: 'ಬ್ರಶ್', masala: 'ಮಸಾಲಾ', chilli: 'ಚಿಲ್ಲಿ', mango: 'ಮ್ಯಾಂಗೋ',
};

/** The spelling rules only: no dictionary, no learned words. One word or several. */
export function toKannadaRule(english: string): string {
  return String(english ?? '').replace(/[A-Za-z]+/g, (w) => latinToKannada(ruleSpell(w.toLowerCase())));
}

/**
 * Rewrites an English-spelled word into the scheme's spelling before the tables see it:
 * oo -> uu (ೂ), ee -> ii (ೀ); a doubled final consonant is spelling only (small -> smal);
 * 'a' closing a syllable before l/r is long (smal -> smaal -> ಸ್ಮಾಲ್, parle -> ಪಾರ್ಲೆ);
 * n/m before another consonant is the anusvara (santuur -> saMtuur -> ಸಂತೂರ್), never word-final
 * and never before n/m/y (enne, amma stay doubled).
 */
function ruleSpell(w: string): string {
  return w
    .replace(/oo/g, 'uu')
    .replace(/ee/g, 'ii')
    .replace(/([bcdfghjklmnpqrstvwxyz])\1$/, '$1')
    .replace(/(^|[^a])a(?=[lr](?:[bcdfghjklmnpqrstvwxyz]|$))/g, '$1aa')
    .replace(/[nm](?=[bcdfgjklpqrstvwxz])/g, 'M');
}

/** Learned keys are compared lower-cased; values are the Kannada the shopkeeper saved. */
function lookup(word: string, learned?: Record<string, string>): string | undefined {
  const k = word.toLowerCase();
  return learned?.[k] ?? KANNADA_WORDS[k];
}

/**
 * The item-form "A -> ಅ" button: an English name written the same way in Kannada (not translated).
 * Each word is looked up first in what this shop has taught it (`learned`), then in the seed
 * dictionary above, and only then spelled out by the rules. The box stays editable to fix a guess.
 */
export function toKannada(english: string, learned?: Record<string, string>): string {
  return String(english ?? '').replace(/[A-Za-z]+/g, (w) => lookup(w, learned) ?? latinToKannada(ruleSpell(w.toLowerCase())));
}

/**
 * Up to three spellings to pick from: dictionary/learned, the rules, and a plain letter-by-letter
 * variant (the old scheme, which keeps short vowels and doubled letters). Duplicates removed.
 */
export function kannadaSuggestions(english: string, learned?: Record<string, string>): string[] {
  const text = String(english ?? '');
  const plain = text.replace(/[A-Za-z]+/g, (w) => latinToKannada(w.toLowerCase()));
  return [...new Set([toKannada(text, learned), toKannadaRule(text), plain])].filter((s) => s.trim()).slice(0, 3);
}

/**
 * What to remember after the shopkeeper corrected a transliteration and saved: word-by-word
 * pairs where the saved Kannada differs from what the button gave. Only when both names have the
 * same number of words, since otherwise which word maps to which is a guess.
 */
export function learnedFrom(english: string, savedKannada: string, learned?: Record<string, string>): Record<string, string> {
  const en = String(english ?? '').trim().split(/\s+/).filter(Boolean);
  const kn = String(savedKannada ?? '').trim().split(/\s+/).filter(Boolean);
  const out: Record<string, string> = {};
  if (!en.length || en.length !== kn.length) return out;
  en.forEach((w, i) => {
    if (!/^[A-Za-z]+$/.test(w) || !hasKannada(kn[i] as string)) return;
    if (toKannada(w, learned) !== kn[i]) out[w.toLowerCase()] = kn[i] as string;
  });
  return out;
}

/**
 * The item-form "ಅ -> A" button: a Kannada name in Latin letters, capitalised per word
 * (ಸಕ್ಕರೆ -> "Sakkare"). Long vowels come back doubled (ರಮೇಶ್ -> "Rameesh"); retroflex and plain
 * consonants come back as the scheme's letters lower-cased.
 */
export function toEnglish(kannada: string): string {
  return romanise(String(kannada ?? ''))
    .toLowerCase()
    .replace(/(^|\s)([a-z])/g, (_, sp: string, c: string) => sp + c.toUpperCase());
}
