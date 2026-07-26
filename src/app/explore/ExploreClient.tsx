"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import PlaceCard from "@/components/PlaceCard";
import { categories, places, type Category } from "@/lib/places";

export default function ExploreClient() {
  const searchParams = useSearchParams();
  const initialCategory = searchParams.get("category");

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "All">(
    categories.some((c) => c.name === initialCategory)
      ? (initialCategory as Category)
      : "All"
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return places.filter((place) => {
      const matchesCategory = category === "All" || place.category === category;
      const matchesQuery =
        q === "" ||
        place.name.toLowerCase().includes(q) ||
        place.nameAr.includes(q) ||
        place.area.toLowerCase().includes(q) ||
        place.tagline.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [query, category]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          Explore Kuwait
        </h1>
        <p className="mt-2 text-slate-500">
          {places.length} places, zero &ldquo;I don&apos;t know, you choose&rdquo;.
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
        >
          🔎
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search places, areas, or vibes, in English or Arabic"
          placeholder="Search places, areas, or vibes…"
          className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 pl-12 pr-4 text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
        />
      </div>

      {/* Category pills */}
      <div className="mb-10 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        <button
          type="button"
          onClick={() => setCategory("All")}
          aria-pressed={category === "All"}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
            category === "All"
              ? "bg-brand-600 text-white shadow-sm"
              : "border border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-700"
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.name}
            type="button"
            onClick={() => setCategory(cat.name)}
            aria-pressed={category === cat.name}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              category === cat.name
                ? "bg-brand-600 text-white shadow-sm"
                : "border border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-700"
            }`}
          >
            <span aria-hidden="true">{cat.emoji}</span> {cat.name}
          </button>
        ))}
      </div>

      {/* Results */}
      {filtered.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((place) => (
            <PlaceCard key={place.slug} place={place} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 py-20 text-center">
          <p className="text-4xl" aria-hidden="true">🤷</p>
          <h2 className="mt-4 text-lg font-bold text-slate-900">No places found</h2>
          <p className="mt-1 text-slate-500">
            Try a different search or category — Kuwait has more to offer!
          </p>
          <button
            onClick={() => {
              setQuery("");
              setCategory("All");
            }}
            className="mt-6 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
