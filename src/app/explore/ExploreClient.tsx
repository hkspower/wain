"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import CategoryIcon from "@/components/CategoryIcon";
import { IconCompass, IconSearch } from "@/components/icons";
import PlaceCard from "@/components/PlaceCard";
import {
  categories,
  countAr,
  PLACES_COUNT,
  RESULTS_COUNT,
  type CategoryId,
} from "@/lib/places";
import { usePlaces } from "@/lib/usePlaces";

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

  const filtered = useMemo(() => {
    const q = normalise(query);
    return places.filter((place) => {
      const matchesCategory = category === "all" || place.category === category;
      const haystack = normalise(
        `${place.nameAr} ${place.name} ${place.areaAr} ${place.area} ${place.taglineAr}`
      );
      return matchesCategory && (q === "" || haystack.includes(q));
    });
  }, [query, category, places]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-7">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
          استكشف الكويت
        </h1>
        <p className="mt-2 text-ink-500">
          {countAr(places.length, PLACES_COUNT)}، وما عاد فيه «ما أدري، اختر أنت».
        </p>
      </header>

      {/* Search */}
      <div className="relative mb-5">
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
          className="w-full rounded-2xl border border-sand-200 bg-white py-3.5 pe-4 ps-12 text-ink-800 shadow-sm outline-none transition placeholder:text-ink-500/70 focus:border-sea-400 focus:ring-4 focus:ring-sea-100"
        />
      </div>

      {/* Category rail */}
      <div className="mb-8 flex flex-wrap gap-2" role="group" aria-label="تصفية حسب التصنيف">
        <button
          type="button"
          onClick={() => setCategory("all")}
          aria-pressed={category === "all"}
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${
            category === "all"
              ? "bg-ink-900 text-white shadow-sm"
              : "border border-sand-200 bg-white text-ink-600 hover:border-sea-300 hover:text-sea-700"
          }`}
        >
          <CategoryIcon name="all" className="size-4" />
          الكل
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategory(cat.id)}
            aria-pressed={category === cat.id}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${
              category === cat.id
                ? "bg-ink-900 text-white shadow-sm"
                : "border border-sand-200 bg-white text-ink-600 hover:border-sea-300 hover:text-sea-700"
            }`}
          >
            <CategoryIcon name={cat.icon} className="size-4" />
            {cat.ar}
          </button>
        ))}
      </div>

      {/* Results */}
      {filtered.length > 0 ? (
        <>
          <h2 className="mb-4 text-sm font-medium text-ink-500">
            {countAr(filtered.length, RESULTS_COUNT)}
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((place) => (
              <PlaceCard key={place.slug} place={place} />
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-3xl border border-dashed border-sand-300 bg-white/60 py-20 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-sand-100 text-sand-600" aria-hidden="true">
            <IconCompass className="size-9" />
          </span>
          <h2 className="mt-4 font-display text-xl font-bold text-ink-900">ما لقينا شي</h2>
          <p className="mt-1 text-ink-500">جرّب بحث ثاني أو تصنيف ثاني — الكويت فيها وايد.</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setCategory("all");
            }}
            className="mt-6 rounded-xl bg-ink-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-ink-800"
          >
            امسح الفلاتر
          </button>
        </div>
      )}
    </div>
  );
}
