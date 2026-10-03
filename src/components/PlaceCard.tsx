import Link from "next/link";
import GeneratedPicture from "@/components/GeneratedPicture";
import IllustrativeTag from "@/components/IllustrativeTag";
import PlaceIcon from "@/components/PlaceIcon";
import { IconGo, IconPinSolid, IconSend, IconStar } from "@/components/icons";
import { LANDMARK_CARDS } from "@/lib/landmark-cards.g";
import { shown } from "@/lib/landmark-gate";
import {
  categoryTint,
  distanceAr,
  getCategory,
  toArabicDigits,
  toArabicNumber,
} from "@/lib/place-kit";
import type { Place } from "@/lib/places";

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
  shareable = false,
}: {
  place: Place;
  awayKm?: number;
  /**
   * «رسّلها» on the card itself — the share panel is three doors away from
   * a visitor on /explore or the home page (open the place, scroll to the
   * foot), so a small button on the band leads straight to it (3 October, on
   * request). Only where there is no panel already on the page: /pick and
   * سالم's rail draw one next to the card.
   */
  shareable?: boolean;
}) {
  const category = getCategory(place.category);
  // The five «معالم الكويت» places carry their picture in the band the icon
  // sat in — the owner's pick (card A, 3 October): the same 56px, so no card
  // on the site changes height, and the other 47 keep their icon. A picture
  // that is still a drawn stand-in is not shown outside a preview build.
  const picture = LANDMARK_CARDS.find((c) => c.slug === place.slug);
  const pictured = picture !== undefined && shown(picture);

  // A link cannot hold a link, so the card stays the one <a> it always was
  // and the share button is its SIBLING, laid over the band's far corner in
  // a wrapper that sets the frame. The card's own markup is untouched —
  // every suite that reads `a[href^="/places/"] [data-card-band]` still finds
  // the band inside the anchor. audit:mobile reads an overlapped target as
  // overlapped, not as crowded, so the two may sit on one another.
  const card = (
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
        data-card-band={pictured ? "picture" : "icon"}
        className={`relative flex h-14 items-center justify-center overflow-hidden border-b border-line ${categoryTint(place.category)}`}
      >
        {pictured ? (
          <>
            {/* Cut around the landmark when it was made (a 3:1 strip), so
                the middle of it is the tower, whatever the card's width. The
                tint under it is what shows while it loads. */}
            <GeneratedPicture
              {...picture}
              sizes="(min-width: 1024px) 280px, (min-width: 640px) 33vw, 256px"
              className="absolute inset-0 size-full transition duration-500 group-hover:scale-105"
            />
            {/* The tag takes the start corner under a share button, which
                holds the end corner and, at a finger's 40px, would reach
                down into it. The rating chip sits above it, at the top. */}
            <IllustrativeTag className={shareable ? "start-1.5 bottom-1.5" : "end-1.5 bottom-1.5"} />
          </>
        ) : (
          <PlaceIcon
            slug={place.slug}
            className="size-8 transition duration-500 group-hover:scale-105"
          />
        )}
        {/* No chip at all when there is no rating. A placeholder — a dash, a
            greyed star — would be a worse answer than silence: it draws the
            eye to a number that does not exist. */}
        {place.rating !== undefined && (
          <span
            // text-2xs, matching MapPin's tooltip badge — both sit on a
            // thumbnail-scale image (this card's h-14 tint band, the
            // tooltip's own compact type). PlaceView's hero badge and
            // SearchResults' row are one size up (text-xs) because their own
            // images, or the row itself, are bigger — audit:type surfaced
            // all four as one ٤٫٧-shaped bucket at two sizes; this is the
            // rule that explains the two, not a slip.
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

  if (!shareable) return card;
  return (
    <div className="relative h-full">
      {card}
      {/* On the band's end corner: the rating chip holds the start corner and
          a landmark's «صورة توضيحية» tag the bottom. `size-8` with the tap
          token so a finger gets 40px and a mouse 32 — the icon would touch a
          24px button's own edge. `#share` is the panel's anchor on the place
          page, which scrolls itself into view once drawn. */}
      <Link
        href={`/places/${place.slug}/#share`}
        data-share=""
        aria-label={`رسّل ${place.nameAr} للربع`}
        className="absolute end-1.5 top-1.5 z-10 grid size-8 min-h-tap min-w-tap place-items-center rounded-full bg-white/95 text-ink-700 shadow-sm backdrop-blur transition hover:bg-coral-50 hover:text-coral-700"
      >
        <IconSend className="size-4" />
      </Link>
    </div>
  );
}
