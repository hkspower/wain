import Link from "next/link";
import { getCategory, toArabicDigits, type Place } from "@/lib/places";

export default function PlaceCard({ place }: { place: Place }) {
  const category = getCategory(place.category);

  return (
    <Link
      href={`/places/${place.slug}`}
      className="group flex flex-col overflow-hidden rounded-3xl border border-sand-200 bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:border-sand-300 hover:shadow-xl"
    >
      <div
        className={`relative flex h-36 items-center justify-center overflow-hidden bg-gradient-to-br ${place.gradient}`}
      >
        <span
          aria-hidden="true"
          className="text-5xl drop-shadow-md transition duration-300 group-hover:scale-110"
        >
          {place.emoji}
        </span>
        <span
          className="absolute start-3 top-3 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-ink-800 shadow-sm backdrop-blur"
          aria-label={`التقييم ${place.rating} من ٥`}
        >
          <svg viewBox="0 0 24 24" className="size-3.5 text-sun-500" fill="currentColor" aria-hidden="true">
            <path d="m12 2 2.9 6.1 6.6.9-4.8 4.7 1.2 6.7L12 17.2 6.1 20.4l1.2-6.7L2.5 9l6.6-.9L12 2Z" />
          </svg>
          {toArabicDigits(place.rating.toFixed(1))}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg font-bold leading-tight text-ink-900 transition group-hover:text-coral-700">
            {place.nameAr}
          </h3>
          <span
            className="flex shrink-0 items-center gap-1.5 pt-1 text-xs font-bold text-sand-700"
            aria-label={`مستوى السعر ${place.priceLevel} من ٣`}
          >
            <span className="flex gap-0.5" aria-hidden="true">
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`size-1.5 rounded-full ${
                    i <= place.priceLevel ? "bg-sand-600" : "bg-sand-300"
                  }`}
                />
              ))}
            </span>
            د.ك
          </span>
        </div>

        <p className="mt-1.5 line-clamp-2 flex-1 text-sm leading-relaxed text-ink-500">
          {place.taglineAr}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {category && (
            <span className="rounded-full bg-sea-50 px-2.5 py-1 font-bold text-sea-700">
              {category.ar}
            </span>
          )}
          <span className="flex items-center gap-1 text-ink-500">
            <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden="true">
              <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
            </svg>
            {place.areaAr}
          </span>
        </div>
      </div>
    </Link>
  );
}
