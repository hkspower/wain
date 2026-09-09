"use client";

import type { ReactNode } from "react";
import PlaceView from "@/components/PlaceView";
import { usePlaces } from "@/lib/usePlaces";
import type { Place } from "@/lib/places";

/**
 * The place page, told what the admin has changed since the build.
 *
 * `usePlaces` is the same hook /explore, /search and the ⌘K palette already
 * use: it starts from the build-time snapshot — so the first paint is the
 * prerendered HTML, instant and crawlable — and swaps in the live rows when
 * Supabase is configured. Three listing surfaces were already doing this and
 * the place's OWN page was not, which is the wrong way round: a visitor who
 * searched saw the corrected name in the results and the stale one after they
 * tapped it.
 *
 * Nothing is fetched twice for it. The hook is one query for the whole
 * catalogue, and React shares the result between every component that calls it
 * on the same page.
 *
 * `initial` is the fallback rather than the source: with Supabase unset — which
 * is the case today — `places` is the snapshot and this resolves to exactly what
 * the server rendered, so the page is unchanged until a back end exists.
 */
export default function PlaceLive({
  slug,
  initial,
  heroClass,
  art,
  credit,
  related,
  relatedPlaces,
}: {
  slug: string;
  initial: Place;
  heroClass: string;
  art: ReactNode;
  credit: ReactNode;
  related: ReactNode;
  relatedPlaces: Place[];
}) {
  const { places } = usePlaces();
  // Falls back rather than disappearing. A place unpublished in the admin drops
  // out of the live rows, and the visitor standing on its page should keep
  // reading the page they opened instead of watching it empty itself — the
  // listings stop offering it, which is what unpublishing is for.
  const place = places.find((p) => p.slug === slug) ?? initial;

  return (
    <PlaceView
      place={place}
      heroClass={heroClass}
      art={art}
      credit={credit}
      related={related}
      relatedPlaces={relatedPlaces}
    />
  );
}
