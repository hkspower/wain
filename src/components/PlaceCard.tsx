import Link from "next/link";
import type { Place } from "@/lib/places";

export default function PlaceCard({ place }: { place: Place }) {
  return (
    <Link
      href={`/places/${place.slug}`}
      className="group overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
    >
      <div
        className={`relative flex h-40 items-center justify-center bg-gradient-to-br ${place.gradient}`}
      >
        <span className="text-6xl drop-shadow-md transition group-hover:scale-110">
          {place.emoji}
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-slate-700 backdrop-blur">
          ⭐ {place.rating.toFixed(1)}
        </span>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-bold text-slate-900 group-hover:text-brand-700">
              {place.name}
            </h3>
            <p className="text-sm text-slate-400" dir="rtl" lang="ar">
              {place.nameAr}
            </p>
          </div>
          <span className="shrink-0 text-sm font-medium text-sand-600">
            {"KD".padEnd(2)}
            {"•".repeat(place.priceLevel)}
          </span>
        </div>

        <p className="mt-2 line-clamp-2 text-sm text-slate-500">{place.tagline}</p>

        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
          <span className="rounded-full bg-brand-50 px-2.5 py-1 font-medium text-brand-700">
            {place.category}
          </span>
          <span>📍 {place.area}</span>
        </div>
      </div>
    </Link>
  );
}
