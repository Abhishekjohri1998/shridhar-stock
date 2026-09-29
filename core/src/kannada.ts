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
function romanise(text: string): string {
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
  return romanise(String(text ?? ''))
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
