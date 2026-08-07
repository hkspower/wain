"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import SearchResults from "@/components/SearchResults";
import VoiceControls from "@/components/VoiceControls";
import { IconCompass, IconSearch } from "@/components/icons";
import { toArabicDigits } from "@/lib/places";
import { usePlaces } from "@/lib/usePlaces";
import { buildIndex, search, type DocKind } from "@/lib/search";
import { searchSummaryParts } from "@/lib/voice-lines";
import { speak, stop as stopVoice, useVoice } from "@/lib/voice";

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
  const inputRef = useRef<HTMLInputElement>(null);

  // Rebuilt whenever the place data changes (admin edits arrive live).
  const index = useMemo(() => buildIndex(places), [places]);

  const hits = useMemo(
    () => search(q, index, { limit: 40, kinds: kind === "all" ? undefined : [kind] }),
    [q, index, kind]
  );

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
    const all = search(q, index, { limit: 200 });
    return {
      all: all.length,
      place: all.filter((h) => h.doc.kind === "place").length,
      category: all.filter((h) => h.doc.kind === "category").length,
      area: all.filter((h) => h.doc.kind === "area").length,
      page: all.filter((h) => h.doc.kind === "page").length,
    };
  }, [q, index]);

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
    const t = setTimeout(() => {
      const signature = `${hits[0]?.doc.id ?? "none"}|${counts.all}`;
      if (signature === lastSpokenRef.current) return;
      lastSpokenRef.current = signature;
      speak(searchSummaryParts(hits, counts.all));
    }, 900);
    return () => clearTimeout(t);
  }, [q, hits, counts.all, voiceEnabled]);

  // Leaving the page shouldn't leave a voice talking.
  useEffect(() => () => stopVoice(), []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
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
          className="w-full rounded-2xl border border-sand-200 bg-white py-4 pe-4 ps-12 text-lg text-ink-800 shadow-sm outline-none transition placeholder:text-ink-500/60 focus:border-sea-400 focus:ring-4 focus:ring-sea-100"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="مسح البحث"
            className="absolute inset-y-0 end-3 my-auto grid size-8 place-items-center rounded-full text-ink-500 transition hover:bg-sand-100"
          >
            ×
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
                onClick={() => setKind(f.id)}
                aria-pressed={kind === f.id}
                disabled={n === 0}
                className={`rounded-full px-3.5 py-1.5 text-sm font-bold transition disabled:opacity-40 ${
                  kind === f.id
                    ? "bg-ink-900 text-white"
                    : "border border-sand-200 bg-white text-ink-600 hover:border-sea-300"
                }`}
              >
                {f.label} {n > 0 && <span className="opacity-70">{toArabicDigits(n)}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-7">
        {!q.trim() ? (
          <section>
            <h2 className="mb-3 text-sm font-bold text-ink-600">جرّب تدوّر عن</h2>
            <ul className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => setQ(s)}
                    className="rounded-full border border-sand-200 bg-white px-4 py-2 text-sm font-semibold text-ink-700 transition hover:border-sea-300 hover:text-sea-700"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : hits.length > 0 ? (
          <>
            <p className="mb-4 text-sm text-ink-500">
              {toArabicDigits(hits.length)} نتيجة
            </p>
            <SearchResults hits={hits} />
          </>
        ) : (
          <div className="rounded-3xl border border-dashed border-sand-300 bg-white/60 py-16 text-center">
            <span
              aria-hidden="true"
              className="mx-auto grid size-16 place-items-center rounded-3xl bg-sand-100 text-sand-600"
            >
              <IconCompass className="size-9" />
            </span>
            <h2 className="mt-4 font-display text-xl font-bold text-ink-900">
              ما لقينا شي عن «{q.trim()}»
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              جرّب كلمة أقصر، أو تصفّح كل الأماكن.
            </p>
            <Link
              href="/explore"
              className="mt-6 inline-block rounded-xl bg-ink-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-ink-800"
            >
              تصفّح الأماكن
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
