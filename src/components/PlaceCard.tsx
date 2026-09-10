import Link from "next/link";
import PlaceIcon from "@/components/PlaceIcon";
import { IconGo, IconPinSolid, IconStar } from "@/components/icons";
import {
  categoryTint,
  distanceAr,
  getCategory,
  toArabicDigits,
  toArabicNumber,
  type Place,
} from "@/lib/places";

/**
 * `awayKm` is how far this place is from the one being looked at.
 *
 * Optional because most of the time there is nothing to be away FROM: on
 * /explore and in search results a card stands on its own. On a place page the
 * three «أماكن مشابهة» are chosen by category and then by distance — the page
 * already sorts them with distanceKm — and the number that decided the order
 * was thrown away before it reached the reader. «أبراج الكويت» and «أكوا بارك»
 * are three hundred metres apart; the card said nothing, so a visitor had no
 * way to tell a walk from a drive to the other end of the country.
 */
export default function PlaceCard({
  place,
  awayKm,
}: {
  place: Place;
  awayKm?: number;
}) {
  const category = getCategory(place.category);

  return (
    <Link
      href={`/places/${place.slug}`}
      // h-full so the card fills whatever holds it. In a grid it already did,
      // because grid items stretch; in the home page's scroll rail the <li>
      // stretches and the card inside it would not, leaving short cards
      // floating above a ragged bottom edge.
      className="card-defer group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-xl hover:shadow-ink-900/10"
    >
      {/* The tint band was h-24 with a size-14 mark floating in it — most of a
          card's height spent on one icon, repeated 52 times down /explore.
          It is a category cue, not a picture, and a cue does not need 96px to
          land. */}
      <div
        className={`relative flex h-14 items-center justify-center overflow-hidden border-b border-line ${categoryTint(place.category)}`}
      >
        <PlaceIcon
          slug={place.slug}
          className="size-8 transition duration-500 group-hover:scale-105"
        />
        {/* No chip at all when there is no rating. A placeholder — a dash, a
            greyed star — would be a worse answer than silence: it draws the
            eye to a number that does not exist. */}
        {place.rating !== undefined && (
          <span
            className="absolute start-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-white/95 px-1.5 py-0.5 text-2xs font-semibold text-ink-800 shadow-sm backdrop-blur"
            aria-label={`التقييم ${toArabicNumber(place.rating)} من ٥`}
          >
            <IconStar className="size-3 text-sun-500" />
            {toArabicNumber(place.rating)}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-2">
        <div className="flex items-start justify-between gap-1.5">
          {/* text-sm, not text-lg. Two cards to a phone row leaves ~181px of
              card, and an 18px display face wrapped every second name onto a
              third line. */}
          <h3 className="font-display text-sm font-semibold leading-snug text-ink-900 transition group-hover:text-coral-700">
            {place.nameAr}
          </h3>
          <span
            className="flex shrink-0 items-center gap-1 pt-0.5 text-2xs font-semibold text-sand-700"
            aria-label={`مستوى السعر ${toArabicDigits(place.priceLevel)} من ٣`}
          >
            <span className="flex gap-0.5" aria-hidden="true">
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`size-1 rounded-full ${
                    i <= place.priceLevel ? "bg-sand-700" : "bg-sand-300"
                  }`}
                />
              ))}
            </span>
            د.ك
          </span>
        </div>

        <p className="mt-0.5 line-clamp-2 flex-1 text-xs text-ink-500">
          {place.taglineAr}
        </p>

        <div className="mt-1.5 flex items-center gap-1 text-2xs">
          {/* The category name is the first thing to go when the card narrows:
              at two-up on a phone this row has about 165px for a chip, an
              area, sometimes a distance and an arrow, and the chip pushed the
              area into an ellipsis. Nothing is lost that the card does not
              already say — the tint band and the mark on it ARE the category,
              and /explore filters by it. It comes back at sm, where the row
              has the width for it. */}
          {category && (
            <span className="hidden rounded-full bg-sea-50 px-2 py-0.5 font-semibold text-sea-700 sm:inline-block">
              {category.ar}
            </span>
          )}
          <span className="flex min-w-0 items-center gap-1 text-ink-500">
            <IconPinSolid className="size-3 shrink-0 text-coral-600/70" />
            <span className="truncate">{place.areaAr}</span>
          </span>
          {/* Hedged for the places whose pin is the right area rather than the
              right building — «قريب جداً» instead of a metre count nobody
              measured. See distanceAr. */}
          {awayKm !== undefined && (
            <span className="shrink-0 whitespace-nowrap font-semibold text-sand-700">
              {distanceAr(awayKm, place.coordsUnverified)}
            </span>
          )}
          <IconGo className="ms-auto size-3.5 shrink-0 text-sand-400 transition duration-300 group-hover:-translate-x-1 group-hover:text-coral-600" />
        </div>
      </div>
    </Link>
  );
}
