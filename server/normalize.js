'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Arabic-aware normalization + forbidden/secret detection (SERVER-SIDE, authoritative)
//
// Goal: an Explainer must not be able to sneak the secret word — or any of the 5
// forbidden words — past the filter by adding diacritics, using an alternate
// letter shape, or gluing on a common prefix (و ف ب ك ل ال and combos).
//
// Design:
//   • normalizeArabic(): collapse a token to a canonical comparison form.
//   • buildForbiddenSet(): canonical forms of every forbidden/secret word.
//       - Stores BASE forms only (no risky prefix-stripping of the targets, which
//         would shorten them into fragments that match unrelated words).
//       - Splits multi-word entries ("كرة القدم") into their individual words so
//         leaking ANY word of the answer is caught.
//       - Also stores the ال-stripped stem of any word that carries the definite
//         article, so saying "قدم" is caught when the answer word is "القدم".
//   • candidateForms(): for a TOKEN the Explainer typed, generate the base form
//       plus every prefix-stripped variant. All prefix tolerance lives here, on
//       the input side — that is what keeps the targets clean and false-positive-free.
//   • detectViolation(): tokenize, evaluate only COMPLETED tokens, return the
//       offending raw token (for display) or null.
// ─────────────────────────────────────────────────────────────────────────────

// Tashkeel (U+064B–U+0652), dagger/superscript alef (U+0670), tatweel (U+0640).
const DIACRITICS = /[ً-ْٰـ]/g;
// Alef variants: أ (0623) إ (0625) آ (0622) ٱ (0671) → bare alef ا (0627).
const ALEF_VARIANTS = /[أإآٱ]/g;

/**
 * Collapse a string to its canonical Arabic comparison form.
 * Idempotent: normalizeArabic(normalizeArabic(x)) === normalizeArabic(x).
 */
function normalizeArabic(str) {
  if (str == null) return '';
  return String(str)
    .toLowerCase()                    // fold any Latin (e.g. "NBA" → "nba")
    .replace(DIACRITICS, '')          // strip tashkeel + tatweel
    .replace(ALEF_VARIANTS, 'ا') // أ إ آ ٱ → ا
    .replace(/ى/g, 'ي')     // ى → ي
    .replace(/ة/g, 'ه')     // ة → ه
    .replace(/ؤ/g, 'و')     // ؤ → و
    .replace(/ئ/g, 'ي')     // ئ → ي
    .replace(/ء/g, '')           // drop standalone hamza ء
    .replace(/\s+/g, ' ')
    .trim();
}

// Leading prefixes to tolerate, longest-first. Spec: و ف ب ك ل ال + combos.
const PREFIXES = [
  'وال', 'بال', 'فال', 'كال', 'لل', // combos (conjunction/preposition + article)
  'ال',                              // definite article
  'و', 'ف', 'ب', 'ك', 'ل',         // single-letter conjunctions/prepositions
];

// Definite article, used for the safe target-side stem expansion.
const AL = 'ال';

// A token must keep at least this many letters after a strip to be considered a
// real word and not a fragment — guards single-letter-prefix strips on short words.
const MIN_STEM_LEN = 2;

/**
 * All comparison forms of a TOKEN the Explainer typed: the base form plus each
 * single-pass prefix-stripped variant. Prefix tolerance lives here so the
 * forbidden targets can stay as clean base forms.
 */
function candidateForms(token) {
  const forms = new Set([token]);
  for (const prefix of PREFIXES) {
    if (token.startsWith(prefix) && token.length - prefix.length >= MIN_STEM_LEN) {
      forms.add(token.slice(prefix.length));
    }
  }
  return forms;
}

/** True if any prefix-tolerant form of the (already-normalized) token is forbidden. */
function matchesForbidden(normalizedToken, forbiddenSet) {
  if (!normalizedToken) return false;
  for (const form of candidateForms(normalizedToken)) {
    if (forbiddenSet.has(form)) return true;
  }
  return false;
}

/**
 * Build the set of forbidden comparison forms from a list of words/phrases
 * (the secret word + its 5 forbidden words). Stores clean base forms only.
 */
function buildForbiddenSet(words) {
  const set = new Set();
  const add = (form) => { if (form && form.length >= MIN_STEM_LEN) set.add(form); };

  for (const raw of words) {
    const norm = normalizeArabic(raw);
    if (!norm) continue;
    // Each individual word of a (possibly multi-word) entry is independently forbidden.
    for (const word of norm.split(' ')) {
      add(word);
      // Safe target-side expansion: if the word carries the definite article,
      // also forbid its bare stem ("القدم" ⇒ also forbid "قدم"). This is safe
      // because the stem is still a meaningful word, unlike single-letter strips.
      if (word.startsWith(AL) && word.length - AL.length >= MIN_STEM_LEN) {
        add(word.slice(AL.length));
      }
    }
  }
  return set;
}

// A "word character" is an Arabic letter or combining mark, an Arabic-Indic
// digit, an extended Arabic letter, a Latin letter, or an ASCII digit.
// Crucially this EXCLUDES Arabic punctuation that lives inside the Arabic block
// — ، (U+060C) ؛ (U+061B) ؟ (U+061F) ٪ (U+066A) ۔ (U+06D4) — so those split tokens.
//   ء-ٟ : hamza, alef forms, all base letters, ة ى ي, + tashkeel marks
//   ٠-٩ : Arabic-Indic digits ٠-٩
//   ٰ-ۓ : superscript alef + extended Arabic letters (ٱ etc.)
const WORD_CHAR = '\\u0621-\\u065F\\u0660-\\u0669\\u0670-\\u06D3a-zA-Z0-9';
const WORD_RUN = new RegExp('[' + WORD_CHAR + ']+', 'g');
const ENDS_WITH_WORD_CHAR = new RegExp('[' + WORD_CHAR + ']$');

/**
 * Tokenize on whitespace + punctuation and return only COMPLETED tokens.
 *
 * A token is "completed" once it is followed by a separator (space/punctuation)
 * or at round end. The token currently being typed — the trailing run of word
 * characters with no separator after it — is NOT evaluated, so typing "كرامة"
 * never trips on its prefix "كرة".
 *
 * @param {boolean} roundEnd  When true, the final (in-progress) token is also
 *                            treated as completed (the round is over).
 */
function tokenizeCompleted(text, roundEnd = false) {
  const tokens = text.match(WORD_RUN) || [];
  if (roundEnd) return tokens;
  // If the text ends mid-word, drop that last run — it may still be typed.
  if (tokens.length && ENDS_WITH_WORD_CHAR.test(text)) return tokens.slice(0, -1);
  return tokens;
}

/**
 * Scan the Explainer's text for a violation against a prebuilt forbidden set.
 * Returns the offending RAW token (for display/reveal) or null if clean.
 * Pure — no side effects — so it is fully unit-testable.
 */
function detectViolation(text, forbiddenSet, roundEnd = false) {
  if (!forbiddenSet || !text) return null;
  for (const token of tokenizeCompleted(text, roundEnd)) {
    if (matchesForbidden(normalizeArabic(token), forbiddenSet)) return token;
  }
  return null;
}

/**
 * Is `guess` a correct guess of `secret`? (Arabic-aware, prefix-tolerant.)
 *
 * Unlike violation checking, the guess must match the WHOLE secret — guessing a
 * single word of a multi-word answer does NOT win. Tolerance is asymmetric to
 * avoid false accepts:
 *   • Targets: the normalized secret, plus its ال-stripped stem (safe — a
 *     meaningful stem, so "البتراء" accepts a bare "بتراء").
 *   • Guess side: full prefix tolerance, since users naturally ADD prefixes
 *     ("الأسد", "والكرة"). We never strip letters off the secret to match a
 *     shorter guess, which would accept fragments.
 */
function isCorrectGuess(guess, secret) {
  const ns = normalizeArabic(secret);
  const ng = normalizeArabic(guess);
  if (!ns || !ng) return false;

  const targets = new Set([ns]);
  if (ns.startsWith(AL) && ns.length - AL.length >= MIN_STEM_LEN) {
    targets.add(ns.slice(AL.length));
  }
  for (const form of candidateForms(ng)) {
    if (targets.has(form)) return true;
  }
  return false;
}

/** Classic Levenshtein edit distance between two strings. */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Is `guess` a *near miss* of `secret` — wrong, but only a tiny edit away?
 * Used to reward "🔥 قريب جدًا!" feedback. Deliberately conservative so an
 * unrelated word never reads as "close": at most 1 edit for short answers, 2
 * for longer ones. Never returns true for an actually-correct guess.
 */
function isNearMiss(guess, secret) {
  const ns = normalizeArabic(secret);
  const ng = normalizeArabic(guess);
  if (!ns || !ng) return false;
  if (isCorrectGuess(guess, secret)) return false;
  const dist = levenshtein(ns, ng);
  if (dist === 0) return false;
  const threshold = ns.length >= 6 ? 2 : 1;
  return dist <= threshold;
}

module.exports = {
  normalizeArabic,
  candidateForms,
  matchesForbidden,
  buildForbiddenSet,
  tokenizeCompleted,
  detectViolation,
  isCorrectGuess,
  levenshtein,
  isNearMiss,
};
