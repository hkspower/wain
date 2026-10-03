
/**
 * صوت وين — the sentences the voice personas say, in one place.
 *
 * Both the browser engine (voice.ts) and the ElevenLabs clip generator
 * (scripts/gen-voice.mjs) read from this module, so the pre-rendered audio
 * and the on-device fallback can never drift apart.
 *
 * A SpeechPart carries a clip `key` when a pre-rendered ElevenLabs file can
 * exist for it, and always carries `text` so the browser's Arabic voice can
 * say it when the clip library hasn't been generated yet. Parts marked
 * `optional` (dynamic phrases like result counts) are skipped on the clip
 * path and spoken only by the fallback.
 */
import { toStandardArabic } from "@/lib/arabic";
import { isKuwaitNight, isSummerMonth } from "@/lib/kuwait-time";

export type SpeechPart = { key?: string; text: string; optional?: boolean };

/**
 * The same sentence, prepared for a voice rather than an eye.
 *
 * Every line in this file is written to be READ — Arabic-Indic numerals, an em
 * dash for a beat, a decimal comma. Those are right on screen and unreliable
 * out loud, and the failure is silent: an engine that cannot read ٣٦٠ does not
 * report anything, it just says the wrong thing or nothing where the number
 * was.
 *
 *   ١٨٧ → 187      Arabic TTS reads Western digits as Arabic number words on
 *                  every engine. Arabic-Indic support is good on recent iOS
 *                  and Chrome and patchy on older Android and eSpeak, where
 *                  they come out digit-by-digit or are dropped. The screen is
 *                  untouched — this string never reaches it.
 *   ٫ → .          U+066B is the Arabic decimal separator. Engines that do
 *                  read Arabic-Indic digits still mostly do not know this one,
 *                  and ٤٫٨ becomes "four eight".
 *   — → ،          An em dash is a beat to a reader and nothing to a
 *                  synthesiser: some pause, some ignore it, some announce it.
 *                  A comma pauses everywhere.
 *   چ → تش         Kuwaiti spellings borrow letters from the Persian block —
 *                  «چاي», «مچبوس», «سمچ» — and an Arabic voice has never been
 *                  trained on them. It drops the letter or spells it out, and
 *                  says nothing about having done so. See lib/arabic; the page
 *                  keeps «چاي», which is how it should be written there.
 *
 * Both paths use this — the browser fallback and the ElevenLabs generator — so
 * the recorded clip and the synthetic line stay the same sentence, which is
 * the whole point of keeping these lines in one module.
 */
export function forSpeech(text: string): string {
  return toStandardArabic(text)
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/\s*—\s*/g, "، ")
    .replace(/\s+/g, " ")
    .trim();
}

export type PersonaId = "shouq" | "salem";

export const PERSONAS: Record<
  PersonaId,
  { id: PersonaId; nameAr: string; descAr: string }
> = {
  shouq: { id: "shouq", nameAr: "شوق", descAr: "صوت كويتي شبابي — بنت" },
  salem: { id: "salem", nameAr: "سالم", descAr: "صوت كويتي شبابي — ولد" },
};

export const GENERIC_LINES = {
  // Said when nothing matched. The old line ("ما لقينا شي عن هالبحث. جرّب كلمة
  // ثانية أو أقصر.") told the visitor they had failed without telling them what
  // would work — and after a *spoken* question the likeliest cause is that
  // recognition misheard, so naming the four things she is good at gives them
  // something to say next.
  // «قول لي», not the MSA «قل لي» — see the note in wain-ai.ts. This one is
  // spoken aloud after a misheard question, which is the worst moment for her
  // to slip out of the register she is introduced in.
  "search-empty":
    "ما لقيت شي بهالكلمة. قول لي الجو اللي تبيه — قهوة، بحر، مطعم، ولا طلعة عيال.",
  /*
   * The summer, said INSTEAD of the best time for a place the sun ruins — 3
   * October, on the owner's word. It used to come after it: «أحلى وقت: العصر
   * المتأخر. بس هذي أيام حر — لا تروح إلا بعد المغرب.» — go in the afternoon,
   * don't go before sunset, one breath apart. Without a summer line at all she
   * would cheerfully send someone to a beach at two in the afternoon in
   * August, which is the one piece of advice a local guide would never give;
   * with it after the best time, she gave that advice and then took it back.
   */
  "summer-outdoor": "بالصيف لا تروح إلا عقب المغرب، النهار حر.",
  /**
   * The same summer, for a place that is partly indoors.
   *
   * The outdoor line used to fire on `setting: "outdoor"` alone, which left
   * **twelve** `mixed` places silent in August — سوق المباركية, شارع تونس,
   * مارينا كريسنت and the rest. Half of those are open alleys and pavements.
   *
   * It cannot be the same sentence, though. «لا تروح إلا عقب المغرب» is wrong
   * for مارينا مول or الكوت مول — the air-conditioned half is open and fine at
   * noon. So the mixed line names the part of the place that works right now,
   * which is also what her live agent prompt says — «مكيّف بالنهار، والمكشوف
   * بعد المغرب بس».
   */
  "summer-mixed": "بالنهار خلك بالمكيّف، والمكشوف عقب المغرب.",
  /*
   * And for a place that only happens in the morning — سوق الجمعة, سوق السمك,
   * سوق الوطية, مزارع الوفرة. «لا تروح إلا عقب المغرب» sent people to a
   * market that had packed up by noon. Which places these are is read off
   * their own best time (`isMorningPlace`), not a flag: the catalogue already
   * says «الصبح» for every one of them.
   */
  "summer-early": "بالصيف روح بدري الصبح، قبل لا يحمى الجو.",
} as const;

export function helloLine(nameAr: string): string {
  return `هلا! أنا ${nameAr}. من الحين، لما تدوّر أقول لك وش أحلى الأماكن بصوتي.`;
}

type PlaceLite = {
  slug: string;
  nameAr: string;
  areaAr: string;
  bestTimeAr: string;
  setting: "indoor" | "outdoor" | "mixed";
  summerOk?: boolean;
};

// In kuwait-time.ts with the rest of the clock; re-exported so callers keep
// importing it from here.
export { isSummerMonth };

/**
 * «جرّب سوق المباركية بمدينة الكويت.» — the place, and where it is.
 *
 * It used to be «أقترح عليك:», then «سوق المباركية، في مدينة الكويت.», then
 * the place's tagline: a form read aloud, colon and all, and with the second
 * choice and the best time ~20 seconds of speech, past where Chrome cuts one
 * utterance and well past where anybody is still listening. The tagline is on
 * the card under the answer; out loud it was the part nobody needed.
 *
 * One fixed sentence per place, on purpose: the read-aloud bridge caches a
 * sentence once and serves it for ever, so a line that changed with the
 * question would be paid for again on every question.
 *
 * «كافيهات شارع الخليج بشارع الخليج» — several places are named after the
 * area they sit in, and saying it again is a stutter.
 */
export function placeTryLine(p: PlaceLite): string {
  return p.nameAr.includes(p.areaAr) ? `جرّب ${p.nameAr}.` : `جرّب ${p.nameAr} ب${p.areaAr}.`;
}

/**
 * When to go — fixed per place, so it can be a recorded clip rather than
 * synthetic.
 *
 * «روح …» and not «أحلى وقت: …»: the colon was a form being read out, and it
 * stuttered on the two places whose best time already starts «وقت الغروب»
 * («أحلى وقت: وقت الغروب»). Five best times read badly after «روح» —
 * «روح الأشهر الباردة», «روح الربيع…», «روح مواعيد الجولات» — and were
 * reworded in places.ts and its second copy, supabase/schema.sql.
 */
export function placeBestTimeLine(p: PlaceLite): string {
  return `روح ${p.bestTimeAr}.`;
}

/** A best time that names the evening — «بعد المغرب», «بالليل», «العشا». */
const EVENING = /(المغرب|وقت الغروب|الليل|ليالي|العشا)/;
/** And one that names a time of DAY, which the summer rules out. */
const DAYTIME = /(الصبح|بدري|العصر|الظهر|النهار)/;

/**
 * A place whose best time is the morning and never the evening — سوق الجمعة,
 * سوق السمك, سوق الوطية, مزارع الوفرة, قصر السيف, حديقة الحيوان. Read off the
 * catalogue's own words rather than a flag, so it cannot drift from them, and
 * so the Flutter generator (which refuses a field it does not know) is not
 * handed one.
 */
export function isMorningPlace(p: PlaceLite): boolean {
  return /(الصبح|بدري)/.test(p.bestTimeAr) && !EVENING.test(p.bestTimeAr);
}

/** Which summer line belongs to this place, once it is summer and daytime. */
export type SummerKey = "summer-early" | "summer-outdoor" | "summer-mixed";
export function summerKey(p: PlaceLite): SummerKey {
  if (isMorningPlace(p)) return "summer-early";
  return p.setting === "mixed" ? "summer-mixed" : "summer-outdoor";
}

/**
 * What to say about WHEN — the best time, the heat line instead of it, or
 * both, or neither.
 *
 *  - Not summer, an indoor place, or one the catalogue marks `summerOk`: the
 *    best time.
 *  - A morning place: «روح بدري الصبح» instead of the best time by day; at
 *    night the best time, which already says the morning.
 *  - Outdoors: the heat line INSTEAD of the best time by day — the old answer
 *    said both, and they contradicted each other. At night the heat line has
 *    already come true and is skipped; the best time is said only if it names
 *    the evening alone, because «من العصر لين بعد المغرب» at nine at night in
 *    August is the same contradiction arriving later.
 *  - Mixed: the best time (the air-conditioned half works at noon), plus the
 *    mixed line by day unless the best time is already the evening.
 *
 * No month means no guess: a caller who does not know the season gets the
 * best time.
 */
export function whenParts(p: PlaceLite, month?: number, hour?: number): SpeechPart[] {
  const best: SpeechPart = { key: `best-${p.slug}`, text: placeBestTimeLine(p) };
  const hot = month !== undefined && isSummerMonth(month) && !p.summerOk && p.setting !== "indoor";
  if (!hot) return [best];
  const night = hour !== undefined && isKuwaitNight(hour);
  const key = summerKey(p);
  const heat: SpeechPart = { key, text: GENERIC_LINES[key] };
  if (key === "summer-early") return night ? [best] : [heat];
  if (key === "summer-outdoor") {
    if (!night) return [heat];
    return EVENING.test(p.bestTimeAr) && !DAYTIME.test(p.bestTimeAr) ? [best] : [];
  }
  return night || EVENING.test(p.bestTimeAr) ? [best] : [best, heat];
}

/** Everything one persona needs recorded: the greeting, the fixed lines, and
 * the place and best time for every place. */
export function buildClipLines(
  persona: PersonaId,
  list: PlaceLite[]
): Record<string, string> {
  const lines: Record<string, string> = {
    hello: helloLine(PERSONAS[persona].nameAr),
    ...GENERIC_LINES,
  };
  for (const p of list) {
    lines[`try-${p.slug}`] = placeTryLine(p);
    lines[`best-${p.slug}`] = placeBestTimeLine(p);
  }
  return lines;
}

export function helloParts(persona: PersonaId): SpeechPart[] {
  return [{ key: "hello", text: helloLine(PERSONAS[persona].nameAr) }];
}

type SuggestHit = { doc: { id: string; kind: string; title: string; subtitle: string } };

/**
 * The spoken answer to a search: the place and where it is, then when to go.
 * About nine seconds.
 *
 * It began as a reading of the index — «لقينا لك ٥ نتائج…» — and became a
 * guide's answer: «أقترح عليك:», the place, its tagline, the best time, the
 * summer warning, «وإذا تبي غيره:» and a second place. Measured on 3 October
 * that was ~20 seconds out loud, and the half that answered the question came
 * last. The owner chose the short answer: the tagline and the second choice
 * are on screen in the place cards, and are not said.
 *
 * `asked` is the question as it was actually heard, echoed back before the
 * answer, because recognition mishears and hearing «قهوة هادية؟» is what tells
 * the visitor why the results look the way they do. It is `optional`, so the
 * recorded-clip path — which has no recording of a sentence nobody has said
 * yet — and the read-aloud bridge both skip it.
 *
 * `places` are the full records behind the place hits, in the order the
 * answer gives them (`answer-order.ts`). `hits` is still needed for a query
 * that matches only categories, areas or pages, which carry no place.
 *
 * `month` and `hour` are Kuwait's, from the caller; without them nothing is
 * said about the season.
 */
export function answerParts(
  hits: SuggestHit[],
  places: PlaceLite[],
  opts: { asked?: string; month?: number; hour?: number } = {}
): SpeechPart[] {
  const asked = opts.asked?.trim();
  const echo: SpeechPart[] = asked ? [{ text: `${asked}؟`, optional: true }] : [];

  const top = places[0];
  if (!top) {
    if (hits.length === 0) {
      return [...echo, { key: "search-empty", text: GENERIC_LINES["search-empty"] }];
    }
    // Categories, areas or pages only — there is nothing to recommend, so say
    // what was matched rather than inventing a recommendation.
    return [...echo, { text: `أقرب شي لطلبك: ${hits[0].doc.title}.` }];
  }

  return [
    ...echo,
    { key: `try-${top.slug}`, text: placeTryLine(top) },
    ...whenParts(top, opts.month, opts.hour),
  ];
}

/** What to say on a place page — the same two lines, with no season: the page
 * is built once and does not know when it will be read. */
export function placeSuggestParts(place: PlaceLite): SpeechPart[] {
  return [
    { key: `try-${place.slug}`, text: placeTryLine(place) },
    { key: `best-${place.slug}`, text: placeBestTimeLine(place) },
  ];
}
