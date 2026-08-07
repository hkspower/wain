import { countAr, RESULTS_COUNT } from "@/lib/places";

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
  "search-empty": "ما لقينا شي عن هالبحث. جرّب كلمة ثانية أو أقصر.",
  "suggest-intro": "أحلى نتيجة طلعت لنا:",
  "related-intro": "وإذا حاب تغيّر الجو، شوف بعد:",
} as const;

export function helloLine(nameAr: string): string {
  return `هلا! أنا ${nameAr}. من الحين، لما تدوّر أقول لك وش أحلى الأماكن بصوتي.`;
}

type PlaceLite = { slug: string; nameAr: string; areaAr: string; taglineAr: string };

export function placeSuggestLine(p: PlaceLite): string {
  return `${p.nameAr}، في ${p.areaAr}. ${p.taglineAr}`;
}

export function placeNameLine(p: PlaceLite): string {
  return `${p.nameAr} في ${p.areaAr}`;
}

/** Everything one persona needs recorded: greeting, connectors, and both a
 * full suggestion and a short name for every place. */
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
  }
  return lines;
}

export function helloParts(persona: PersonaId): SpeechPart[] {
  return [{ key: "hello", text: helloLine(PERSONAS[persona].nameAr) }];
}

type SuggestHit = { doc: { id: string; kind: string; title: string; subtitle: string } };

/** What to say once a search settles: the count (fallback only, it changes
 * with every query) and the strongest place suggestion. */
export function searchSummaryParts(hits: SuggestHit[], total: number): SpeechPart[] {
  if (total === 0) {
    return [{ key: "search-empty", text: GENERIC_LINES["search-empty"] }];
  }
  const parts: SpeechPart[] = [
    { text: `لقينا لك ${countAr(total, RESULTS_COUNT)}.`, optional: true },
  ];
  const top = hits.find((h) => h.doc.kind === "place");
  if (top) {
    parts.push(
      { key: "suggest-intro", text: GENERIC_LINES["suggest-intro"] },
      {
        key: `place-${top.doc.id.slice("place:".length)}`,
        text: `${top.doc.title}، ${top.doc.subtitle}.`,
      }
    );
  } else {
    parts.push({ text: `أقرب شي لطلبك: ${hits[0].doc.title}.` });
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
