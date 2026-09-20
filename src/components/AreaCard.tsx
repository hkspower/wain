import Link from "next/link";
import CategoryArt from "@/components/CategoryArt";
import PlaceArt, { hasPlaceArt } from "@/components/PlaceArt";
import { AreaPhoto } from "@/components/PlacePhoto";
import { IconGo, IconPinSolid } from "@/components/icons";
import type { Area } from "@/lib/areas";
import { areaPhotoOf } from "@/lib/photos";
import { countAr, placeGradient, placeVariant, RESULTS_COUNT } from "@/lib/place-kit";
import type { Place } from "@/lib/places";

/**
 * One area of Kuwait, as a way into the places in it.
 *
 * The band follows the same chain a place page's hero does and for the same
 * reason — **photograph → the place's own drawing → the category's drawing** —
 * so an area with no photograph looks finished rather than broken. What is
 * new is that the drawing belongs to `area.hero`, a place that is genuinely IN
 * this area (`audit:areas` enforces it). A card for حولي wearing the Avenues'
 * drawing would be `photos.ts`'s «lookalike» objection committed in ink
 * instead of in pixels: a picture that answers the question wrongly while
 * looking exactly like an answer.
 *
 * `aspect-[18/5]` and not a height, for the reason written out at length in
 * PlaceView: the art is a 400×160 viewBox drawn with
 * `preserveAspectRatio="slice"`, so a W×H band shows 400·H/W units of it and
 * the RATIO is the only input. 18/5 shows 111 units at every width, against
 * the ~103 the drawings need. A card that picked its own height would have to
 * re-derive that, and the last time a band's height was set without
 * re-deriving it, every desktop hero on the site was cropped through the feet
 * of its buildings for weeks.
 */
export default function AreaCard({
  area,
  hero,
  count,
}: {
  area: Area;
  /** A place in this area — whose drawing the card wears. */
  hero: Place;
  /** How many places this area holds. Never 0: `audit:areas` refuses that. */
  count: number;
}) {
  const art = areaPhotoOf(area.id) ? (
    <AreaPhoto id={area.id} className="absolute inset-0 h-full w-full" />
  ) : hasPlaceArt(hero.slug) ? (
    <PlaceArt place={hero} className="absolute inset-0 h-full w-full" />
  ) : (
    <CategoryArt
      category={hero.category}
      variant={placeVariant(hero.slug)}
      className="absolute inset-0 h-full w-full"
    />
  );

  return (
    <Link
      href={`/explore/?area=${area.id}`}
      className="card-defer group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-xl hover:shadow-ink-900/10"
    >
      <div
        className={`relative flex aspect-[18/5] w-full items-center justify-center overflow-hidden border-b border-line ${placeGradient(hero)}`}
      >
        {art}
        <span className="absolute start-1.5 top-1.5 rounded-full bg-white/95 px-1.5 py-0.5 text-2xs font-semibold text-ink-800 shadow-sm backdrop-blur">
          {countAr(count, RESULTS_COUNT)}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-2">
        <h3 className="flex items-center gap-1 font-display text-sm font-semibold leading-snug text-ink-900 transition group-hover:text-coral-700">
          <IconPinSolid className="size-3.5 shrink-0 text-coral-600/70" />
          {area.ar}
        </h3>
        <p className="mt-0.5 line-clamp-2 flex-1 text-xs text-ink-500">
          {area.blurbAr}
        </p>
        <div className="mt-1.5 flex items-center text-2xs text-ink-500">
          <span lang="en" dir="ltr" className="truncate">
            {area.en}
          </span>
          <IconGo className="ms-auto size-3.5 shrink-0 text-sand-400 transition duration-300 group-hover:-translate-x-1 group-hover:text-coral-600" />
        </div>
      </div>
    </Link>
  );
}
