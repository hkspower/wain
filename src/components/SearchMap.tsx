"use client";

import { useEffect, useMemo, useState } from "react";
import MapPin, { pinHeadroom } from "@/components/MapPin";
import { IconMap, IconPinSolid } from "@/components/icons";
import { toArabicDigits } from "@/lib/place-kit";
import type { Place } from "@/lib/places";
import { embedUrl, fitFrame, osmLink, pinShiftCap, project, spreadPins } from "@/lib/map-frame";
import { useFrameWidth } from "@/lib/useFrameWidth";
import { useLiveMap } from "@/lib/useLiveMap";

/**
 * Where the results actually are.
 *
 * The site is called وين — "where" — and search answered it with a list only.
 * This puts the hits on a map, and the two stay in step: pointing at a pin
 * highlights its row, and pointing at a row highlights its pin.
 *
 * The frame takes its shape from the results rather than the results being
 * squeezed into a fixed one. Kuwait's places run wide and shallow, so a fixed
 * 3:2 frame left the pins occupying as little as 4% of it. See lib/map-frame
 * for the fitting, and for why the frame's aspect must match the bbox exactly.
 *
 * The basemap is deliberately non-interactive: the embed would pan under the
 * overlay and desync every pin, and each pin is already a link.
 *
 * That last sentence used to end «panning lives behind the "open the big map"
 * link», and it no longer has to. `LiveMap` answers it — Leaflet takes the
 * view and the pins are re-projected as it moves, so the overlay has nothing
 * left to desync from. It costs 42.4K, so it is fetched only when somebody
 * taps to move the map, and this static frame remains what everyone else
 * gets. The link out stays: a full OSM page still does things this map does
 * not, and it is the only map here when the chunk cannot arrive.
 */

/** Pin diameter in px. Below the 44px tap floor on purpose: a pin's position
 *  is its meaning, so padding it out would either move it off its place or
 *  bury its neighbours — WCAG 2.5.8's exception for essential presentation.
 *  It still clears the 24px AA minimum. */
const PIN_PX = 32;
/** Frame width below which a wide frame has too little height left to read. */
const PHONE_FRAME_PX = 520;

export default function SearchMap({
  places,
  active = null,
  onActive,
}: {
  places: Place[];
  /** Highlighted slug, shared with the result list so the two stay in step. */
  active?: string | null;
  onActive?: (slug: string | null) => void;
}) {
  // The basemap is a cross-origin iframe: with no network it paints the
  // browser's own error page inside our frame. Offline the pins and the ground
  // still answer the question, so only mount it when there is a network.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    addEventListener("online", sync);
    addEventListener("offline", sync);
    return () => {
      removeEventListener("online", sync);
      removeEventListener("offline", sync);
    };
  }, []);

  // A pin is a fixed 32px, so how much of the frame it covers depends on how
  // wide the frame actually is — 4% on a desktop column, 9% on a phone.
  // Measure it, or the spreading under-corrects on small screens. The width is
  // measured rather than assumed: see useFrameWidth for the two basemap loads
  // and the layout shift that assuming it cost on every phone visit.
  const [frameRef, frameW] = useFrameWidth<HTMLDivElement>();
  const live = useLiveMap();

  const maxAspect = frameW < PHONE_FRAME_PX ? 1.7 : 2.4;
  const f = useMemo(
    () =>
      places.length && frameW > 0
        ? // The pins stand above their coordinates, so the frame has to leave
          // them somewhere to stand — otherwise the northernmost result, which
          // the search just decided was worth showing, is drawn with its head
          // cut off by the frame's own border.
          fitFrame(places, { maxAspect, headroom: pinHeadroom(PIN_PX), frameW })
        : null,
    [places, maxAspect, frameW]
  );
  const pins = useMemo(() => {
    if (!f) return [];
    const size = PIN_PX / frameW;
    // Bound the anti-overlap nudge on the ground too. A result set spanning
    // the whole country makes one pin width worth kilometres, and a pin that
    // far from its place is worse than one that overlaps its neighbour.
    return spreadPins(
      places.map((p) => project(f, p)),
      size,
      f.aspect,
      pinShiftCap(f, size)
    );
  }, [places, f, frameW]);

  if (places.length === 0) return null;

  /**
   * One pin, drawn the same whichever map is underneath it.
   *
   * The static frame knows where a pin goes as a fraction of itself; Leaflet
   * answers in container pixels. Both are passed through here so the callout
   * logic — which edge to hang off, whether to drop below — is written once
   * and cannot come to differ between the two maps.
   */
  const renderPin = (
    p: Place,
    i: number,
    style: React.CSSProperties,
    fx: number,
    fy: number
  ) => (
    <MapPin
      key={p.slug}
      place={p}
      active={active === p.slug}
      onActive={(slug) => onActive?.(slug)}
      size={PIN_PX}
      // The frame clips its overflow, so a callout centred on a pin near
      // an edge would lose the half with the name on it.
      align={fx < 0.28 ? "start" : fx > 0.72 ? "end" : "center"}
      below={fy < 0.28}
      style={style}
    />
  );

  return (
    <section className="mb-4" aria-labelledby="search-map-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          id="search-map-heading"
          className="flex items-center gap-2 text-sm font-semibold text-ink-700"
        >
          <IconMap className="size-4 text-sea-600" />
          {toArabicDigits(places.length)} على الخريطة
        </h2>
        <div className="flex items-center gap-3">
          {/* Offered only while there is a frame to hand over, a network to
              fetch tiles on, and tiles configured at all. Not offered once
              the live map is up: it would be a button that does nothing, and
              the map itself is then the evidence that it worked. */}
          {f && online && live.available && !live.live && (
            <button
              type="button"
              onClick={live.enable}
              disabled={live.loading}
              className="flex min-h-6 items-center gap-1.5 rounded-full border border-line-control bg-white px-3 py-1 text-xs font-semibold text-ink-700 transition hover:border-sea-300 hover:text-sea-700 disabled:opacity-60"
            >
              <IconMap className="size-3.5" />
              {live.loading ? "لحظة…" : "حرّك الخريطة"}
            </button>
          )}
          {f && (
            <a
              href={osmLink(f.centre, 12)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-6 items-center text-xs font-semibold text-sea-700 underline-offset-2 hover:underline"
            >
              افتح الخريطة الكبيرة
            </a>
          )}
        </div>
      </div>

      {/* Said out loud rather than left as a control that stopped responding.
          The static map below is still the answer to «where are these», so
          this is a missing upgrade, not a broken page. */}
      {live.failed && (
        <p className="mb-3 text-xs text-ink-500">
          ما قدرنا نحمّل الخريطة المتحركة. الخريطة تحت وأماكنها صح، وتقدر تفتح
          الخريطة الكبيرة.
        </p>
      )}

      <div
        ref={frameRef}
        data-map-frame=""
        // The shape comes from the results, so it has to be inline. It must
        // stay exactly the aspect the bbox was grown to, or every pin shifts.
        // Until the box has been measured there is no bbox and nothing is put
        // inside it — that measurement happens in a layout effect, so this
        // state is never painted.
        style={f ? { aspectRatio: String(f.aspect) } : undefined}
        className="relative w-full overflow-hidden rounded-2xl border border-line bg-sand-100 shadow-sm"
      >
        {/* Ground for before the tiles paint — and for offline, where the pins
            still carry the answer on their own. */}
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-sand-700">
          <IconPinSolid className="size-8" />
        </span>

        {live.live && live.LiveMap && f ? (
          <live.LiveMap
            frame={f}
            points={places}
            ariaLabel={`خريطة ${toArabicDigits(places.length)} نتيجة، تقدر تحركها`}
          >
            {(at, box) =>
              at
                ? places.map((p, i) =>
                    renderPin(
                      p,
                      i,
                      // `pointerEvents` because the overlay layer is
                      // `pointer-events-none` — it must not swallow the drag
                      // that pans the map, and a pin must still be tappable.
                      { left: at[i].x, top: at[i].y, pointerEvents: "auto" },
                      box.w ? at[i].x / box.w : 0.5,
                      box.h ? at[i].y / box.h : 0.5
                    )
                  )
                : null
            }
          </live.LiveMap>
        ) : (
          <>
            {online && f && (
              <iframe
                src={embedUrl(f)}
                title="خريطة نتائج البحث"
                loading="lazy"
                tabIndex={-1}
                aria-hidden="true"
                // Third-party frame. allow-scripts is what the map needs to draw;
                // withholding allow-same-origin, allow-popups, allow-forms and
                // allow-top-navigation means it cannot reach its own cookies,
                // open windows, or navigate the page out from under the visitor.
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                className="pointer-events-none absolute inset-0 block h-full w-full border-0"
              />
            )}

            {f &&
              places.map((p, i) =>
                renderPin(
                  p,
                  i,
                  // Physical left/top on purpose. The page is RTL, but geography
                  // is not — a logical inset would mirror the map east-to-west.
                  { left: `${pins[i].x * 100}%`, top: `${pins[i].y * 100}%` },
                  pins[i].x,
                  pins[i].y
                )
              )}
          </>
        )}
      </div>
    </section>
  );
}
