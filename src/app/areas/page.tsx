import type { Metadata } from "next";
import AreaCard from "@/components/AreaCard";
import { AREAS } from "@/lib/areas";
import { countAr, PLACES_COUNT } from "@/lib/place-kit";
import { places } from "@/lib/places";

export const metadata: Metadata = {
  title: "مناطق الكويت",
  description:
    "وين تطلع بالسالمية، بمدينة الكويت، بحولي أو بالفحيحيل — أماكن وين، مرتّبة بالمنطقة.",
  alternates: { canonical: "/areas/" },
};

/**
 * Kuwait by area.
 *
 * A server component, and the whole point is that it stays one: it reads the
 * catalogue to count each area, and `places.ts` must never reach a client
 * bundle (`audit:js`). The counting happens here, at build time, and what
 * crosses into the browser is a number per card. `AreaCard` receives the one
 * `Place` whose drawing it wears rather than importing the catalogue for it,
 * the same way `/places/[slug]` hands `PlaceView` its art as a prop.
 *
 * The order is `AREAS`' own — by share of the catalogue, which is the nearest
 * thing to «famous» that a check can hold this file to. See `areas.ts`.
 */
export default function AreasPage() {
  const counts = new Map<string, number>();
  for (const place of places) {
    counts.set(place.areaAr, (counts.get(place.areaAr) ?? 0) + 1);
  }

  const rows = AREAS.map((area) => ({
    area,
    count: counts.get(area.ar) ?? 0,
    hero: places.find((p) => p.slug === area.hero),
  }));

  return (
    <div className="mx-auto max-w-6xl px-2.5 py-2 sm:px-4 sm:py-3">
      <header className="mb-3">
        <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">
          مناطق الكويت
        </h1>
        <p className="mt-1 text-xs text-ink-500 sm:text-sm">
          {countAr(places.length, PLACES_COUNT)}، مرتّبة على وين هي بالضبط.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map(({ area, count, hero }) =>
          // `hero` is `find`, so TypeScript has to be shown it is there. It
          // always is — `audit:areas` fails the build's own check if an area
          // names a place that does not exist or sits in another area — and a
          // card with no drawing is still better than a page that throws.
          hero ? (
            <AreaCard key={area.id} area={area} hero={hero} count={count} />
          ) : null
        )}
      </div>
    </div>
  );
}
