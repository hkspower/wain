/**
 * The letters Kuwaitis write that the rest of the stack does not know.
 *
 * Kuwaiti Arabic has sounds Modern Standard Arabic has no letter for, and the
 * spellings people actually use borrow from the Persian/Urdu block: «چاي»,
 * «مچبوس», «سمچ» all use چ (U+0686), which is not an Arabic letter. This
 * catalogue uses those spellings because they are the right ones on the page —
 * a Kuwaiti reading «تشاي» on a screen would think the site was written by
 * somebody who had never been here.
 *
 * Two things downstream cannot read them, and both fail silently:
 *
 * **The speech engines.** An Arabic TTS voice is trained on the standard
 * letters. Hand it چ and it drops the letter, spells it out, or says something
 * else — and nothing reports that, because the request succeeded. One tagline
 * in the catalogue is affected today («چاي وقهوة عربية في حوش السوق.»), and it
 * belongs to one of the likeliest results for «قهوة». It is also the string
 * ElevenLabs is paid to record, so the fault would be baked into an mp3.
 *
 * **The search index.** Measured before this existed:
 *
 *   چاي   → مقاهي المباركية        تشاي  → ما لقينا شي
 *   سمچ   → سوق السمك             سمتش  → ما لقينا شي
 *   چای   → ما لقينا شي            کرک   → ما لقينا شي
 *
 * The last two are the ones that matter most, and they are invisible: «چای»
 * and «کرک» are written with the Persian yeh (ی, U+06CC) and kaf (ک, U+06A9),
 * which are the SAME GLYPH as ي and ك on screen. And they are not exotic — the
 * default Arabic keyboards on iOS and Android have no چ key at all, so the
 * people most likely to type «چاي» are the ones with a Farsi or Urdu keyboard
 * installed, and that keyboard hands them ی and ک with it. The one Kuwaiti word
 * the index had a synonym for was unreachable from the keyboard you would type
 * it on, and the visitor sees a correctly-spelled word finding nothing.
 *
 * So: one table, two readers. `forSpeech` (voice-lines) puts these into letters
 * an engine can voice; `normalise` (search) folds them so every spelling of a
 * word lands on one token. What is on the page never changes.
 */

/**
 * Ordered, because the substitutions must not feed each other. Each maps a
 * letter to the closest thing the standard Arabic alphabet has — which is also
 * how an Arabic speaker reads them aloud.
 */
const GULF_LETTERS: Array<[RegExp, string]> = [
  // [tʃ]. The only one that expands to two letters, and the only one actually
  // present in the catalogue: چاي، مچبوس، سمچ.
  [/چ/g, "تش"],
  // [p] and [v] do not exist in Arabic, and every Arabic speaker substitutes
  // these — «پيتزا» is said «بيتزا», «ڤيلا» is said «فيلا».
  [/پ/g, "ب"],
  [/[ڤﭪ]/g, "ف"],
  [/ژ/g, "ج"],
  // [g], and ق is the right answer HERE specifically: in Gulf Arabic ق is
  // pronounced [g], and the voice reading these sentences is Gulf. On an MSA
  // voice it comes out [q], which is still a letter rather than a hole.
  [/[گݣڬ]/g, "ق"],
  // Look-alikes: a different codepoint for a glyph that is drawn identically.
  // Nothing on screen changes; everything downstream starts working.
  [/ی/g, "ي"],
  [/ک/g, "ك"],
  [/ھ/g, "ه"],
  [/ٱ/g, "ا"],
];

/** The same words, in letters the search index and the speech engines know. */
export function toStandardArabic(text: string): string {
  let out = text;
  for (const [from, to] of GULF_LETTERS) out = out.replace(from, to);
  return out;
}

/**
 * Anything left that an Arabic engine has no business being handed.
 *
 * Used by the audit rather than at runtime: the point is to notice a new
 * catalogue entry written with a letter this table does not cover, before it
 * reaches a paid recording.
 */
// Written as escapes: the ranges end on codepoints that are themselves
// invisible (U+FEFF among them), and a literal one in the source is a
// zero-width character sitting in a regex nobody can see.
export const NON_STANDARD_ARABIC = /[\u0679-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
