"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import SearchMap from "@/components/SearchMap";
import SearchResults from "@/components/SearchResults";
import VoiceControls from "@/components/VoiceControls";
import { IconClose, IconCompass, IconSearch } from "@/components/icons";
import { toArabicDigits } from "@/lib/places";
import { usePlaces } from "@/lib/usePlaces";
import { buildIndex, search, type DocKind } from "@/lib/search";
import { answerParts } from "@/lib/voice-lines";
import { speak, stop as stopVoice, useVoice } from "@/lib/voice";
import { haptic } from "@/lib/haptics";

const FILTERS: { id: DocKind | "all"; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "place", label: "أماكن" },
  { id: "category", label: "تصنيفات" },
  { id: "area", label: "مناطق" },
  { id: "page", label: "صفحات" },
];

const SUGGESTIONS = ["قهوة هادية", "طلعة مع العيال", "بحر", "أكل كويتي", "متحف", "السالمية"];

export default function SearchClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { places } = usePlaces();

  const [q, setQ] = useState(params.get("q") ?? "");
  const [kind, setKind] = useState<DocKind | "all">("all");
  // Shared between the map and the list: pointing at either end highlights the
  // other, so the two read as one view of the same results.
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * The query the RESULTS are for, which is allowed to lag the query the BOX
   * shows.
   *
   * Measured on a 4× throttled phone, a keystroke took up to 615ms to paint
   * and typing one phrase produced fourteen long tasks. Almost none of it was
   * the search: `search()` costs 0.09ms over this catalogue. It was the
   * rendering hanging off it — up to sixty result cards, and a map that
   * re-fits its frame and re-spreads every pin, all synchronously, between the
   * key going down and the letter appearing.
   *
   * useDeferredValue splits the two. `q` still updates instantly, so the box
   * echoes the finger; everything derived from `deferredQ` re-renders at a
   * lower priority and is interruptible, so the next keystroke pre-empts a
   * results render still in flight instead of queueing behind it.
   */
  const deferredQ = useDeferredValue(q);
  /** True while the results on screen are for an older query than the box. */
  const settling = deferredQ !== q;

  // Rebuilt whenever the place data changes (admin edits arrive live).
  const index = useMemo(() => buildIndex(places), [places]);

  const hits = useMemo(
    () => search(deferredQ, index, { limit: 40, kinds: kind === "all" ? undefined : [kind] }),
    [deferredQ, index, kind]
  );

  // The place hits, in result order, resolved back to full records so the map
  // can plot them. Only places carry coordinates — categories, areas and pages
  // have nothing to pin.
  const hitPlaces = useMemo(() => {
    const bySlug = new Map(places.map((p) => [p.slug, p]));
    return hits
      .filter((h) => h.doc.kind === "place")
      .map((h) => bySlug.get(h.doc.id.replace(/^place:/, "")))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  }, [hits, places]);

  // Keep ?q= in step with the box so a search can be shared or bookmarked,
  // replacing rather than pushing so Back leaves the page instead of
  // walking through every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search";
      router.replace(next, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [q, router]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const counts = useMemo(() => {
    const all = search(deferredQ, index, { limit: 200 });
    return {
      all: all.length,
      place: all.filter((h) => h.doc.kind === "place").length,
      category: all.filter((h) => h.doc.kind === "category").length,
      area: all.filter((h) => h.doc.kind === "area").length,
      page: all.filter((h) => h.doc.kind === "page").length,
    };
  }, [deferredQ, index]);

  // A kind filter chosen for an earlier query can have nothing for the new
  // one. Left alone it becomes a dead end: the chip stays selected but
  // disabled, and the page shows "ما لقينا شي" while the الكل chip is still
  // counting results. Drop back to الكل so the visitor sees them.
  useEffect(() => {
    if (kind !== "all" && counts[kind] === 0 && counts.all > 0) setKind("all");
  }, [kind, counts]);

  // A question asked out loud, handed over by وين AI. Read once: it belongs to
  // the arrival, not to every later edit of the query box.
  const [asked, setAsked] = useState<string | null>(null);
  useEffect(() => {
    try {
      const value = sessionStorage.getItem("wain:asked");
      if (value) {
        sessionStorage.removeItem("wain:asked");
        setAsked(value);
      }
    } catch {
      /* private mode — no echo */
    }
  }, []);

  // صوت وين: once a search settles, say the best suggestion out loud —
  // only while the visitor has the voice toggle on, and never twice for the
  // same outcome.
  const { enabled: voiceEnabled } = useVoice();
  const lastSpokenRef = useRef("");
  useEffect(() => {
    if (!voiceEnabled) return;
    if (!q.trim()) {
      lastSpokenRef.current = "";
      return;
    }
    // The 900ms wait exists to let typing settle. A spoken question is already
    // finished when it arrives, so waiting only leaves the visitor listening
    // to silence after they have stopped talking.
    const spokenQuestion = asked && asked === q.trim() ? asked : null;
    const t = setTimeout(
      () => {
        const signature = `${hits[0]?.doc.id ?? "none"}|${hits.length}`;
        if (signature === lastSpokenRef.current) return;
        lastSpokenRef.current = signature;
        speak(
          answerParts(hits, hitPlaces, {
            asked: spokenQuestion ?? undefined,
            // Read at speaking time, not at module load: an installed app can
            // sit open across midnight, and across the end of a month.
            month: new Date().getMonth(),
          })
        );
      },
      spokenQuestion ? 220 : 900
    );
    return () => clearTimeout(t);
  }, [q, hits, hitPlaces, voiceEnabled, asked]);

  // Leaving the page shouldn't leave a voice talking.
  useEffect(() => () => stopVoice(), []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 standalone:px-3 standalone:py-4 sm:px-6 sm:py-14">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">
          دوّر في وين
        </h1>
        <VoiceControls />
      </div>

      {/* Query box */}
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-ink-500"
        >
          <IconSearch className="size-5" />
        </span>
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="ابحث في كل محتوى وين"
          placeholder="اكتب اسم مكان، منطقة، أو جو…"
          className="w-full rounded-2xl border border-line-control bg-white py-4 pe-4 ps-12 text-lg text-ink-800 shadow-sm outline-none transition placeholder:text-ink-500/60 focus:border-sea-400 focus:ring-4 focus:ring-sea-100"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="مسح البحث"
            className="absolute inset-y-0 end-3 my-auto grid size-11 place-items-center rounded-full text-ink-500 transition hover:bg-sand-200 hover:text-ink-800"
          >
            <IconClose className="size-4" />
          </button>
        )}
      </div>

      {/* Filters */}
      {q.trim() && (
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="نوع النتيجة">
          {FILTERS.map((f) => {
            const n = counts[f.id as keyof typeof counts];
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => { haptic("select"); setKind(f.id); }}
                aria-pressed={kind === f.id}
                disabled={n === 0}
                className={`min-h-11 rounded-full px-4 text-sm font-semibold transition disabled:opacity-40 ${
                  kind === f.id
                    ? "bg-ink-900 text-white"
                    : "border border-line-control bg-white text-ink-600 hover:border-sea-300"
                }`}
              >
                {/* opacity-70 put the count at 3.97:1 on white — it reads as a
                    dimmed detail but it is the number the reader is choosing
                    by, so it has to clear 4.5:1 like any other text. */}
                {f.label} {n > 0 && <span className="opacity-80">{toArabicDigits(n)}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-7">
        {!q.trim() ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink-600">جرّب تدوّر عن</h2>
            <ul className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => setQ(s)}
                    className="flex min-h-11 items-center rounded-full border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300 hover:text-sea-700"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : hits.length > 0 ? (
          /* Dimmed, not blanked, while the results are still for an older
             query than the box. Blanking would make every keystroke a flash
             of empty page; this says «catching up» quietly and keeps what is
             on screen readable, which is usually still the right answer. */
          <div className={settling ? "opacity-60 transition-opacity duration-150" : "transition-opacity duration-150"}>
            <p className="mb-4 text-sm text-ink-500" aria-live="polite">
              {toArabicDigits(hits.length)} نتيجة
            </p>
            <SearchMap places={hitPlaces} active={activeSlug} onActive={setActiveSlug} />
            <SearchResults hits={hits} activeSlug={activeSlug} onActiveSlug={setActiveSlug} />
          </div>
        ) : settling ? (
          /* Nothing yet for the newest query, but the older one is still being
             replaced — so this is «not finished», not «nothing there». The
             empty state below announces a dead end, and announcing one mid-word
             is the single most annoying thing a live search box can do. */
          null
        ) : (
          <div className="rounded-3xl border border-dashed border-line-strong bg-sand-100/70 py-16 text-center">
            <span
              aria-hidden="true"
              className="mx-auto grid size-16 place-items-center rounded-3xl bg-sand-100 text-sand-600"
            >
              <IconCompass className="size-9" />
            </span>
            <h2 className="mt-4 font-display text-xl font-semibold text-ink-900">
              ما لقينا شي عن «{q.trim()}»
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              جرّب كلمة أقصر، أو تصفّح كل الأماكن.
            </p>
            <Link
              href="/explore"
              className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800"
            >
              تصفّح الأماكن
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
