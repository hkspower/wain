/**
 * شوق's tools, reused for `/salem` — the pure half.
 *
 * `WainAiCall.tsx` already has `show_places`/`open_place`: they run the same
 * search index the search page runs, then say what is now on screen so she
 * can announce it instead of leaving a caller to guess. `/salem` cannot
 * reuse the CALL's version outright — that one navigates the whole page
 * (`router.push`), which is correct for a call sheet sitting OVER the page
 * it drives, and fatal for a typed chat that IS the page: navigating away
 * would unmount `SalemChat.tsx` and close the socket mid-conversation.
 *
 * So the two tools split in half here. This file is the part that is pure —
 * given a query and the live rows, what matched and what to tell her — and
 * is unit-testable with no browser, no socket, no React. `SalemChat.tsx`
 * owns the impure half: running these against `usePlaces()`'s live rows and
 * a lazily-loaded search index, and turning the result into an inline
 * message in the transcript instead of a navigation.
 *
 * Deliberately imports `@/lib/places`' TYPE only (`import type`, erased at
 * compile time) plus `@/lib/place-kit` (catalogue-free by its own rule) —
 * never `places` the array. `SalemChat.tsx` is the one file allowed to hold
 * the live rows, the same narrow allowance `WainAiCall.tsx` already has, and
 * only because it is its own route's chunk, not the shared bundle every page
 * pays for.
 *
 * Both results carry SLUGS only, not a trimmed copy of the place's own
 * fields — `SalemChat.tsx` already holds the live rows, so it looks a slug
 * up in them and renders the real `PlaceCard`, the same component /explore
 * and every "أماكن مشابهة" rail already use. A second, ad-hoc card shape
 * here would have meant this page's results looking unlike the rest of the
 * site's, and drifting from it the moment `PlaceCard` changed.
 */
import type { Place } from "@/lib/places";

export interface SalemShowPlacesResult {
  /** What goes back to her as the tool result — the same phrasing pattern
   * `WainAiCall.tsx`'s own `show_places` uses, so a caller who switches
   * between calling and typing hears the same voice either way. */
  spoken: string;
  query: string;
  /** Slugs only, in match order, capped at 8 — see this file's own header. */
  slugs: string[];
}

/** A minimal shape of `search()`'s own return — just enough to read here
 * without importing the module itself, which stays a runtime `import()` in
 * `SalemChat.tsx` for the reason `WainAiCall.tsx`'s own `loadIndex` already
 * gives: the engine belongs to a conversation that may never happen. */
export interface SalemSearchHit {
  doc: { kind: string; id: string; title: string };
}

export function formatShowPlaces(query: string, hits: SalemSearchHit[], places: Place[]): SalemShowPlacesResult {
  const found = hits.filter((h) => h.doc.kind === "place");
  const bySlug = new Set(places.map((p) => p.slug));
  const slugs = found
    .slice(0, 8)
    .map((h) => h.doc.id.replace(/^place:/, ""))
    .filter((slug) => bySlug.has(slug));

  if (found.length === 0) {
    return {
      query,
      slugs: [],
      spoken:
        `ما لقيت ولا مكان يطابق «${query}» — لا تسكتين، قولي له بصراحة إن هالكلمات ما طلّعت شي، ` +
        "ورشّحي أقرب مكان من معرفتك، ونادي show_places مرة ثانية بكلمة أوسع.",
    };
  }
  const names = found.slice(0, 3).map((h) => h.doc.title);
  // The same hand-rolled 1-vs-plural shape WainAiCall.tsx's own tool result
  // uses (its `summary`, not its on-screen `setLastAction` — that one goes
  // through `countAr`; this one goes back to her as the TOOL RESULT, and
  // matching it is the whole point of this file's split). Not `countAr`
  // here: it already returns a complete "N noun" phrase of its own, and
  // prefixing `found.length` in front of it doubled the count instead of
  // agreeing with it — caught before this ever ran, not after.
  return {
    query,
    slugs,
    spoken:
      `${found.length} ${found.length === 1 ? "مكان مطابق" : "أماكن مطابقة"} لـ «${query}» الحين قدام الزائر، أولها: ` +
      `${names.join("، ")}. قولي له بجملة وحدة إنها قدامه — وسمّي الأول لو ما ذكرتيه — ` +
      "واسأليه سؤال قصير يرجّع له الدور. لا تسكتين.",
  };
}

export interface SalemOpenPlaceResult {
  spoken: string;
  /** The slug that opened, or null on a bad or unknown one — the same
   * slug-only shape `formatShowPlaces` returns, and for the same reason. */
  slug: string | null;
}

export function formatOpenPlace(slug: string, places: Place[]): SalemOpenPlaceResult {
  const s = slug.trim();
  if (!/^[a-z0-9-]+$/.test(s)) {
    return { slug: null, spoken: "ما لقيت مكان بهذا المعرّف — ما تغيّر شي عند الزائر." };
  }
  const place = places.find((p) => p.slug === s);
  if (!place) {
    return {
      slug: null,
      spoken:
        `ما فيه مكان بالمعرّف (${s}) في قائمتك — ما تغيّر شي عند الزائر. ` +
        "تأكدي من الـ slug اللي في قاعدة المعرفة، أو حطي الأماكن قدامه بـ show_places بداله.",
    };
  }
  return {
    slug: s,
    spoken:
      `بطاقة «${place.nameAr}» (${s}) الحين قدام الزائر. قولي له إنك حطيتيها، ` +
      "واسأليه سؤال قصير يرجّع له الدور. لا تسكتين.",
  };
}
