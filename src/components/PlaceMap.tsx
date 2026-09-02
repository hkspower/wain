import PlaceMapFrame from "@/components/PlaceMapFrame";
import VoiceControls, { SpeakButton } from "@/components/VoiceControls";
import { IconMap, IconGo } from "@/components/icons";
import type { Place } from "@/lib/places";
import { osmLink } from "@/lib/map-frame";
import { placeSuggestParts } from "@/lib/voice-lines";

/**
 * Interactive map for a place: an OpenStreetMap embed with a marker (no API
 * key, so it works on static hosting), plus a Google Maps link that searches
 * by name — landing on the live listing with hours and reviews rather than an
 * anonymous dropped pin — and a directions link that navigates to the exact
 * coordinates.
 */
export default function PlaceMap({
  place,
  related = [],
}: {
  place: Place;
  related?: Place[];
}) {
  const { lat, lng } = place;
  const suggestParts = placeSuggestParts(place, related);
  // The shared builder, not a second copy of the same template. This file had
  // its own `const osmLink` spelling out the identical URL — and shadowing the
  // exported name while doing it — so a fix to one would have silently left
  // the other behind. Zoom 16 rather than the default 15: this map is one
  // building, where the search map is a whole result set.
  const osm = osmLink(place, 16);
  const gmapsPoi = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${place.name}, ${place.area}, Kuwait`
  )}`;
  const gmapsDirections = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  return (
    <section className="mt-9 standalone:mt-5">
      <h2 className="mb-4 flex items-center gap-2 font-display text-2xl font-bold text-ink-900">
        <IconMap className="size-6 text-sea-600" />
        وينه بالضبط؟
      </h2>
      <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
        <PlaceMapFrame place={place} related={related} />
        <div className="flex flex-wrap items-center gap-3 border-t border-line p-4">
          <a
            href={gmapsPoi}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sea-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sea-700"
          >
            <IconMap className="size-4" />
            افتح في خرائط جوجل
          </a>
          <a
            href={gmapsDirections}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-control bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 transition hover:border-sea-300 hover:text-sea-700"
          >
            <IconGo className="size-4" />
            الاتجاهات
          </a>
          <a
            href={osm}
            target="_blank"
            rel="noopener noreferrer"
            className="ms-auto inline-flex min-h-11 items-center text-xs text-ink-500 underline-offset-2 hover:underline"
          >
            بيانات الخريطة © OpenStreetMap
          </a>
        </div>

        {/* صوت وين — spoken suggestion for this spot and what's around it */}
        <div className="flex flex-wrap items-center gap-3 border-t border-line bg-sand-100 p-4">
          <SpeakButton parts={suggestParts} label="اسمع الاقتراح" />
          <VoiceControls />
        </div>
      </div>
    </section>
  );
}
