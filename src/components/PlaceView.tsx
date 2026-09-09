"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { BusinessBio, BusinessBrand, BusinessContact, BusinessGallery, BusinessProducts } from "@/components/BusinessProfile";
import OrderPanel from "@/components/OrderPanel";
import QueuePanel from "@/components/QueuePanel";
import InviteBanner from "@/components/InviteBanner";
import ShareHangout from "@/components/ShareHangout";
import PlaceMap from "@/components/PlaceMap";
import {
  IconBack,
  IconCheck,
  IconClock,
  IconCoins,
  IconPinSolid,
  IconSparkle,
  IconStar,
  IconSun,
} from "@/components/icons";
// place-kit, never places: this is a client component, and importing the
// catalogue here would ship all 52 records to every place page. See the header
// of place-kit.ts. The Place TYPE is erased at compile time, so it is free.
import { getCategory, toArabicDigits, toArabicNumber } from "@/lib/place-kit";
import type { Place } from "@/lib/places";

const priceLabel = ["", "اقتصادي", "متوسط", "راقي"];

const SETTING_LABEL = { indoor: "مكيّف", outdoor: "برا", mixed: "داخلي وبرا" } as const;
const SETTING_TONE = {
  indoor: "bg-sea-50 text-sea-700",
  outdoor: "bg-palm-500/12 text-palm-700",
  mixed: "bg-sand-100 text-sand-800",
} as const;

/**
 * Everything on a place page that an admin can change.
 *
 * This is a client component and the page around it is not, and the split is
 * the whole point. A place page used to be a pure function of the build-time
 * snapshot: an admin could correct a phone number, a price level or a
 * description, watch it appear in search and on /explore within the second —
 * because those read `usePlaces` — and then open the place's own page and find
 * the old text still there, until somebody redeployed the site. The one page
 * about a place was the last place to hear about it.
 *
 * What does NOT move here is anything the reader sees before they read: the
 * hero photograph or drawing, and the row of related cards. Both arrive as
 * `art` and `related` — nodes the server already rendered — because they are
 * chosen by slug and category rather than typed by an admin, and because
 * `PlaceArt` and `CategoryArt` are 19KB of source between them. Rendering them
 * here would ship every drawing in the catalogue to every visitor for a
 * feature about editing text. Passed as props they cost nothing: React sends
 * the finished markup, not the code that made it.
 */
export default function PlaceView({
  place,
  heroClass,
  art,
  credit,
  related,
  relatedPlaces,
}: {
  place: Place;
  /**
   * The hero's gradient, computed on the server by `placeGradient`.
   *
   * Passed rather than derived: it is `GRADIENT_DIRECTION[variant] +
   * HERO_GRADIENT[category]`, and both tables live beside the catalogue. It is
   * decoration keyed to the slug, so a category edited after the build keeps
   * the old gradient until the next deploy — which is invisible next to the
   * text being right.
   */
  heroClass: string;
  /** Hero photograph or drawing, rendered on the server. */
  art: ReactNode;
  /** Photo credit, which renders nothing unless a licence needs naming. */
  credit: ReactNode;
  /** The «أماكن مشابهة» cards, rendered on the server from the snapshot. */
  related: ReactNode;
  /** The same places as data, for the map's pins. */
  relatedPlaces: Place[];
}) {
  const category = getCategory(place.category);

  return (
    <div className="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-8">
      {/* Breadcrumb */}
      <nav className="mb-5 text-sm text-ink-500" aria-label="مسار التنقّل">
        <Link
          href="/explore"
          className="inline-flex min-h-11 items-center transition hover:text-coral-700"
        >
          استكشف
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span className="text-ink-700" aria-current="page">
          {place.nameAr}
        </span>
      </nav>

      {/* Hero */}
      <div
        className={`relative flex h-40 items-center justify-center overflow-hidden rounded-3xl shadow-lg sm:h-64 ${heroClass}`}
      >
        {art}
        {place.rating !== undefined && (
          <span
            className="absolute start-4 top-4 flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-sm font-semibold text-ink-800 shadow-sm backdrop-blur"
            aria-label={`التقييم ${toArabicNumber(place.rating)} من ٥`}
          >
            <IconStar className="size-4 text-sun-500" />
            {toArabicNumber(place.rating)}
          </span>
        )}
      </div>
      {credit}

      {/* Header */}
      <div className="mt-7 flex items-start gap-4">
        <BusinessBrand place={place} />
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">
            {place.nameAr}
          </h1>
          <p className="mt-1 text-lg text-ink-500">
            <span lang="en" dir="ltr">
              {place.name}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {category && (
              <span className="rounded-full bg-sea-50 px-3 py-1.5 text-sm font-semibold text-sea-700">
                {category.ar}
              </span>
            )}
            <span
              className="flex items-center gap-1.5 rounded-full bg-sand-100 px-3 py-1.5 text-sm font-semibold text-sand-800"
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
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-ink-500">
        <IconPinSolid className="size-4 text-coral-600" />
        {place.areaAr}، الكويت
      </p>

      {/* Above the description, because for an invited visitor this is why
          they opened the page at all — and below the name and area, so they
          can see what they have been invited to before being told when. */}
      <InviteBanner place={place} />

      <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-ink-600">{place.descriptionAr}</p>

      <BusinessBio place={place} />
      <BusinessContact place={place} />
      <BusinessProducts place={place} />
      <OrderPanel place={place} />
      <QueuePanel place={place} />
      <ShareHangout place={place} />
      <BusinessGallery place={place} />

      {/* Details */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-3xl border border-line bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
            <IconSparkle className="size-5 text-sun-600" />
            أبرز ما فيه
          </h2>
          <ul className="mt-3 space-y-2.5">
            {place.highlightsAr.map((h) => (
              <li key={h} className="flex items-start gap-2 text-sm text-ink-600">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-palm-500" />
                {h}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-3xl border border-line bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
            <IconClock className="size-5 text-sea-600" />
            أحسن وقت للزيارة
          </h2>
          <p className="mt-2.5 text-sm text-ink-600">{place.bestTimeAr}</p>

          <h2 className="mt-6 flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
            <IconCoins className="size-5 text-sand-600" />
            مستوى الأسعار
          </h2>
          <p className="mt-2.5 text-sm text-ink-600">{priceLabel[place.priceLevel]}</p>

          {/* Kuwait's weather decides most outings for a third of the year, so
              it belongs on the page and not only in the search index. */}
          <h2 className="mt-6 flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
            <IconSun className="size-5 text-sun-600" />
            الجو والموسم
          </h2>
          <p className="mt-2.5 flex flex-wrap items-center gap-2 text-sm text-ink-600">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${SETTING_TONE[place.setting]}`}>
              {SETTING_LABEL[place.setting]}
            </span>
            {place.seasonAr}
          </p>

          {/* Only ever the positive. An absent flag means «we do not know»,
              not «no» — see `shisha` in lib/places — so there is nothing to
              render for the places without one. */}
          {place.shisha && (
            <p className="mt-2.5 flex items-center gap-2 text-sm text-ink-600">
              <span className="rounded-full bg-palm-500/12 px-2.5 py-1 text-xs font-semibold text-palm-700">
                فيه شيشة
              </span>
            </p>
          )}
        </div>
      </div>

      <PlaceMap place={place} related={relatedPlaces} />

      {related}

      <div className="mt-12 text-center">
        <Link
          href="/explore"
          className="inline-flex items-center gap-2 rounded-xl border border-line-control bg-white px-6 py-3 font-semibold text-ink-700 shadow-sm transition hover:border-sea-300 hover:text-sea-700"
        >
          <IconBack className="size-4" />
          رجوع للاستكشاف
        </Link>
      </div>
    </div>
  );
}
