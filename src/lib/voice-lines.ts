
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
export type SpeechPart = { key?: string; text: string; optional?: boolean };

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
  "search-empty":
    "ما لقيت شي بهالكلمة. قل لي الجو اللي تبيه — قهوة، بحر، مطعم، ولا طلعة عيال.",
  "suggest-intro": "أقترح عليك:",
  "related-intro": "وإذا تبي غيره:",
  // Added when she recommends an open-air place in the Kuwaiti summer. Without
  // it she would cheerfully send someone to a beach at two in the afternoon in
  // August, which is the one piece of advice a local guide would never give.
  "summer-outdoor": "بس هذي أيام حر — لا تروح إلا بعد المغرب.",
} as const;

export function helloLine(nameAr: string): string {
  return `هلا! أنا ${nameAr}. من الحين، لما تدوّر أقول لك وش أحلى الأماكن بصوتي.`;
}

type PlaceLite = {
  slug: string;
  nameAr: string;
  areaAr: string;
  taglineAr: string;
  bestTimeAr: string;
  setting: "indoor" | "outdoor" | "mixed";
  summerOk?: boolean;
};

/**
 * June to September in Kuwait — daytime highs around 45–50°C, when an open-air
 * recommendation stops being a recommendation. Months are 0-based, as from
 * Date#getMonth.
 */
export function isSummerMonth(month: number): boolean {
  return month >= 5 && month <= 8;
}

export function placeSuggestLine(p: PlaceLite): string {
  return `${p.nameAr}، في ${p.areaAr}. ${p.taglineAr}`;
}

export function placeNameLine(p: PlaceLite): string {
  // "كافيهات شارع الخليج في شارع الخليج" — several places are named after the
  // area they sit in, and appending it again reads as a stutter out loud.
  // Full stops matter here: these lines are concatenated into one utterance,
  // and without them the synthesiser runs "…وبعد المغرب وإذا تبي غيره" together
  // as a single breathless clause.
  return p.nameAr.includes(p.areaAr) ? `${p.nameAr}.` : `${p.nameAr} في ${p.areaAr}.`;
}

/** When to go — the single most useful thing to add to a recommendation, and
 *  fixed per place, so it can be a recorded clip rather than synthetic. */
export function placeBestTimeLine(p: PlaceLite): string {
  return `أحلى وقت: ${p.bestTimeAr}.`;
}

/** Everything one persona needs recorded: greeting, connectors, and the full
 * suggestion, short name and best time for every place. */
export function buildClipLines(
  persona: PersonaId,
  list: PlaceLite[]
): Record<string, string> {
  const lines: Record<string, string> = {
    hello: helloLine(PERSONAS[persona].nameAr),
    ...GENERIC_LINES,
  };
  for (const p of list) {
    lines[`place-${p.slug}`] = placeSuggestLine(p);
    lines[`name-${p.slug}`] = placeNameLine(p);
    lines[`best-${p.slug}`] = placeBestTimeLine(p);
  }
  return lines;
}

export function helloParts(persona: PersonaId): SpeechPart[] {
  return [{ key: "hello", text: helloLine(PERSONAS[persona].nameAr) }];
}

type SuggestHit = { doc: { id: string; kind: string; title: string; subtitle: string } };

/**
 * The spoken answer to a search.
 *
 * This used to read the index back: "لقينا لك ٥ نتائج. أحلى نتيجة طلعت لنا:
 * مقاهي المباركية، قهوة، مدينة الكويت." — a count nobody asked for, followed
 * by a category and an area. Everything in it was already on the screen, and
 * none of it answered the question.
 *
 * A guide answers instead: what to go to, why it suits, and when to go —
 * then one alternative. The count is dropped precisely because the screen
 * already shows it; speech is the expensive channel and should carry what the
 * screen cannot.
 *
 * `asked` is the question as it was actually heard, echoed back before the
 * answer. It is not decoration: speech recognition mishears, and hearing
 * "قهوة هادية؟" is what tells the visitor why the results look the way they
 * do. It stays `optional` so the pre-rendered clip path — which has no
 * recording of a sentence nobody has said yet — simply skips it.
 *
 * `places` are the full records behind the place hits, in result order.
 * `hits` is still needed for the case where a query matches only categories,
 * areas or pages, which carry no place to recommend.
 */
export function answerParts(
  hits: SuggestHit[],
  places: PlaceLite[],
  opts: { asked?: string; month?: number } = {}
): SpeechPart[] {
  const asked = opts.asked?.trim();
  const echo: SpeechPart[] = asked ? [{ text: `${asked}؟`, optional: true }] : [];

  if (hits.length === 0) {
    return [...echo, { key: "search-empty", text: GENERIC_LINES["search-empty"] }];
  }

  const top = places[0];
  if (!top) {
    // Categories, areas or pages only — there is nothing to recommend, so say
    // what was matched rather than inventing a recommendation.
    return [...echo, { text: `أقرب شي لطلبك: ${hits[0].doc.title}.` }];
  }

  const parts: SpeechPart[] = [
    ...echo,
    { key: "suggest-intro", text: GENERIC_LINES["suggest-intro"] },
    { key: `place-${top.slug}`, text: placeSuggestLine(top) },
    { key: `best-${top.slug}`, text: placeBestTimeLine(top) },
  ];

  if (
    top.setting === "outdoor" &&
    !top.summerOk &&
    opts.month !== undefined &&
    isSummerMonth(opts.month)
  ) {
    parts.push({ key: "summer-outdoor", text: GENERIC_LINES["summer-outdoor"] });
  }

  const next = places[1];
  if (next) {
    parts.push(
      { key: "related-intro", text: GENERIC_LINES["related-intro"] },
      { key: `name-${next.slug}`, text: placeNameLine(next) }
    );
  }
  return parts;
}

/** What to say on a place page: this place, then up to two related ones. */
export function placeSuggestParts(
  place: PlaceLite,
  related: PlaceLite[]
): SpeechPart[] {
  const parts: SpeechPart[] = [
    { key: `place-${place.slug}`, text: placeSuggestLine(place) },
  ];
  if (related.length > 0) {
    parts.push({ key: "related-intro", text: GENERIC_LINES["related-intro"] });
    for (const r of related.slice(0, 2)) {
      parts.push({ key: `name-${r.slug}`, text: placeNameLine(r) });
    }
  }
  return parts;
}
