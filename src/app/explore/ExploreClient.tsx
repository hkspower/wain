"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import CategoryIcon from "@/components/CategoryIcon";
import { IconCompass, IconPinSolid, IconSearch } from "@/components/icons";
import { AREAS } from "@/lib/areas";
import PlaceCard from "@/components/PlaceCard";
import {
  categories,
  countAr,
  PLACES_COUNT,
  RESULTS_COUNT,
  type CategoryId,
} from "@/lib/place-kit";
import { usePlaces } from "@/lib/usePlaces";
import { haptic } from "@/lib/haptics";

/** Strip Arabic diacritics and normalise alef/ya/ta-marbuta so search is forgiving. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .trim();
}

export default function ExploreClient() {
  const searchParams = useSearchParams();
  const initial = searchParams.get("category");

  const { places } = usePlaces();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [category, setCategory] = useState<CategoryId | "all">(
    categories.some((c) => c.id === initial) ? (initial as CategoryId) : "all"
  );
  /**
   * `?area=` is where /areas sends a visitor, and it is an EXACT match on
   * `areaAr` rather than a search for the area's name.
   *
   * The box below would already have found most of it — it matches `areaAr`
   * among five other fields — and that is exactly why it is the wrong tool
   * here: «شرق» as free text also matches «سوق شرق», which is in مدينة
   * الكويت, and the reader arrived from a card that promised «شرق». A filter
   * that quietly includes one place from somewhere else is worse than no
   * filter, because nothing on screen says it happened.
   *
   * State, not a memo of the URL, so clearing it does not need a navigation —
   * and read on every params change for the reason SearchClient documents:
   * pushing `?area=` from this same route is a same-route push, so nothing
   * remounts and a value adopted once at mount would go stale.
   */
  const areaParam = searchParams.get("area");
  const area = useMemo(() => AREAS.find((a) => a.id === areaParam), [areaParam]);
  // The dismissed id rather than a boolean: arriving at a DIFFERENT area after
  // clearing one must filter again, and a flag would stay off and silently
  // show the whole catalogue under the new area's name.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const activeArea = area && dismissed !== area.id ? area : undefined;

  const filtered = useMemo(() => {
    const q = normalise(query);
    return places.filter((place) => {
      const matchesCategory = category === "all" || place.category === category;
      const matchesArea = !activeArea || place.areaAr === activeArea.ar;
      const haystack = normalise(
        `${place.nameAr} ${place.name} ${place.areaAr} ${place.area} ${place.taglineAr}`
      );
      return matchesCategory && matchesArea && (q === "" || haystack.includes(q));
    });
  }, [query, category, activeArea, places]);

  return (
    <div className="mx-auto max-w-6xl px-2.5 py-2 sm:px-4 sm:py-3">
      <header className="mb-3">
        <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">
          استكشف الكويت
        </h1>
        <p className="mt-1 text-xs text-ink-500 sm:text-sm">
          {countAr(places.length, PLACES_COUNT)}، وما عاد فيه «ما أدري، اختر أنت».
        </p>
      </header>

      {/* The area a visitor arrived under, and the way out of it. It is drawn
          as a chip rather than folded into the heading because a filter the
          reader cannot see is a filter they cannot undo — and this one comes
          from the URL, so without it a short result list reads as «wain does
          not have much» instead of «you asked for one area». */}
      {activeArea && (
        <div className="mb-2.5 flex items-center gap-1.5">
          <span className="flex min-h-6 items-center gap-1.5 rounded-full bg-ink-900 px-3 text-xs font-semibold text-white shadow-sm">
            <IconPinSolid className="size-3.5 text-sun-300" />
            {activeArea.ar}
          </span>
          <button
            type="button"
            onClick={() => { haptic("select"); setDismissed(activeArea.id); }}
            className="min-h-6 rounded-full border border-line bg-white px-3 text-xs font-semibold text-ink-600 transition hover:border-sea-300 hover:text-sea-700"
          >
            شوف كل المناطق
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-2.5">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-ink-500"
        >
          <IconSearch className="size-5" />
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="ابحث عن مكان أو منطقة"
          placeholder="دوّر على مكان أو منطقة…"
          className="w-full rounded-2xl border border-line bg-white py-2.5 pe-3 ps-11 text-ink-800 shadow-sm outline-none transition placeholder:text-ink-500/70 focus:border-sea-400 focus:ring-4 focus:ring-sea-100"
        />
      </div>

      {/* Category rail */}
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="تصفية حسب التصنيف">
        <button
          type="button"
          onClick={() => { haptic("select"); setCategory("all"); }}
          aria-pressed={category === "all"}
          className={`flex min-h-6 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
            category === "all"
              ? "bg-ink-900 text-white shadow-sm"
              : "border border-line bg-white text-ink-600 hover:border-sea-300 hover:text-sea-700"
          }`}
        >
          <CategoryIcon name="all" className="icon-pop size-4" />
          الكل
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => { haptic("select"); setCategory(cat.id); }}
            aria-pressed={category === cat.id}
            className={`flex min-h-6 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
              category === cat.id
                ? "bg-ink-900 text-white shadow-sm"
                : "border border-line bg-white text-ink-600 hover:border-sea-300 hover:text-sea-700"
            }`}
          >
            <CategoryIcon name={cat.icon} className="icon-pop size-4" />
            {cat.ar}
          </button>
        ))}
      </div>

      {/* Results */}
      {filtered.length > 0 ? (
        <>
          <h2 className="mb-1.5 text-xs font-semibold text-ink-500">
            {countAr(filtered.length, RESULTS_COUNT)}
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((place) => (
              <PlaceCard key={place.slug} place={place} />
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-3xl border border-dashed border-line-strong bg-sand-100/70 py-10 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-sand-100 text-sand-600" aria-hidden="true">
            <IconCompass className="size-9" />
          </span>
          <h2 className="mt-4 font-display text-xl font-semibold text-ink-900">ما لقينا شي</h2>
          <p className="mt-1 text-ink-500">جرّب بحث ثاني أو تصنيف ثاني — الكويت فيها وايد.</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setCategory("all");
            }}
            className="mt-6 rounded-xl bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800"
          >
            امسح الفلاتر
          </button>
        </div>
      )}
    </div>
  );
}
