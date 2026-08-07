import VoiceControls, { SpeakButton } from "@/components/VoiceControls";
import { IconMap, IconGo, IconPinSolid } from "@/components/icons";
import type { Place } from "@/lib/places";
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
  // A box tight enough to show the surrounding streets and landmarks.
  const bbox = [lng - 0.008, lat - 0.005, lng + 0.008, lat + 0.005].join(",");
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
    bbox
  )}&layer=mapnik&marker=${lat}%2C${lng}`;
  const osmLink = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
  const gmapsPoi = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${place.name}, ${place.area}, Kuwait`
  )}`;
  const gmapsDirections = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  return (
    <section className="mt-9">
      <h2 className="mb-4 flex items-center gap-2 font-display text-2xl font-bold text-ink-900">
        <IconMap className="size-6 text-sea-600" />
        وينه بالضبط؟
      </h2>
      <div className="overflow-hidden rounded-3xl border border-sand-200 bg-white shadow-sm">
        {/* The iframe is transparent until OpenStreetMap paints, so give it a
            deliberate ground: a soft sand field with a pin, instead of a
            stark white void while tiles load. */}
        <div className="relative h-72 w-full bg-sand-100 sm:h-96">
          <span
            aria-hidden="true"
            className="absolute inset-0 grid place-items-center text-sand-700"
          >
            <span className="flex flex-col items-center gap-2">
              <IconPinSolid className="size-10" />
              <span className="text-xs font-semibold">الخريطة تحمّل…</span>
            </span>
          </span>
          <iframe
            src={embed}
            title={`خريطة ${place.nameAr}`}
            loading="lazy"
            className="absolute inset-0 block h-full w-full border-0"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-sand-200 p-4">
          <a
            href={gmapsPoi}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-sea-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-sea-700"
          >
            <IconMap className="size-4" />
            افتح في خرائط جوجل
          </a>
          <a
            href={gmapsDirections}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-sand-300 bg-white px-4 py-2.5 text-sm font-bold text-ink-700 transition hover:border-sea-300 hover:text-sea-700"
          >
            <IconGo className="size-4" />
            الاتجاهات
          </a>
          <a
            href={osmLink}
            target="_blank"
            rel="noopener noreferrer"
            className="ms-auto text-xs text-ink-500 underline-offset-2 hover:underline"
          >
            بيانات الخريطة © OpenStreetMap
          </a>
        </div>

        {/* صوت وين — spoken suggestion for this spot and what's around it */}
        <div className="flex flex-wrap items-center gap-3 border-t border-sand-200 bg-sand-50/60 p-4">
          <SpeakButton parts={suggestParts} label="اسمع الاقتراح" />
          <VoiceControls />
        </div>
      </div>
    </section>
  );
}
