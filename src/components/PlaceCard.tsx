import Link from "next/link";
import PlaceIcon from "@/components/PlaceIcon";
import { IconGo, IconPinSolid, IconStar } from "@/components/icons";
import { categoryTint, getCategory, toArabicDigits, type Place } from "@/lib/places";

export default function PlaceCard({ place }: { place: Place }) {
  const category = getCategory(place.category);

  return (
    <Link
      href={`/places/${place.slug}`}
      className="card-defer group flex flex-col overflow-hidden rounded-3xl border border-line bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-xl hover:shadow-ink-900/10"
    >
      <div
        className={`relative flex h-36 items-center justify-center overflow-hidden border-b border-line standalone:h-24 ${categoryTint(place.category)}`}
      >
        <PlaceIcon
          slug={place.slug}
          className="size-20 transition duration-500 group-hover:scale-105 standalone:size-14"
        />
        {/* No chip at all when there is no rating. A placeholder — a dash, a
            greyed star — would be a worse answer than silence: it draws the
            eye to a number that does not exist. */}
        {place.rating !== undefined && (
          <span
            className="absolute start-3 top-3 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-ink-800 shadow-sm backdrop-blur"
            aria-label={`التقييم ${toArabicDigits(place.rating.toFixed(1))} من ٥`}
          >
            <IconStar className="size-3.5 text-sun-500" />
            {toArabicDigits(place.rating.toFixed(1))}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4 standalone:p-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-semibold leading-snug text-ink-900 transition group-hover:text-coral-700">
            {place.nameAr}
          </h3>
          <span
            className="flex shrink-0 items-center gap-1.5 pt-1 text-xs font-semibold text-sand-700"
            aria-label={`مستوى السعر ${toArabicDigits(place.priceLevel)} من ٣`}
          >
            <span className="flex gap-0.5" aria-hidden="true">
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`size-1.5 rounded-full ${
                    i <= place.priceLevel ? "bg-sand-700" : "bg-sand-300"
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

        <div className="mt-3 flex items-center gap-2 text-xs">
          {category && (
            <span className="rounded-full bg-sea-50 px-2.5 py-1 font-semibold text-sea-700">
              {category.ar}
            </span>
          )}
          <span className="flex min-w-0 items-center gap-1 text-ink-500">
            <IconPinSolid className="size-3.5 shrink-0 text-coral-600/70" />
            <span className="truncate">{place.areaAr}</span>
          </span>
          <IconGo className="ms-auto size-4 shrink-0 text-sand-400 transition duration-300 group-hover:-translate-x-1 group-hover:text-coral-600" />
        </div>
      </div>
    </Link>
  );
}
