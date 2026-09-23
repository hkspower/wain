"use client";

import { useEffect, useMemo, useState } from "react";
import MapPin, { pinHeadroom } from "@/components/MapPin";
import PlaceIcon from "@/components/PlaceIcon";
import { IconPinSolid } from "@/components/icons";
import type { Place } from "@/lib/places";
import { embedUrl, fitFrameAround, pinShiftCap, project, spreadPins } from "@/lib/map-frame";
import { useFrameWidth } from "@/lib/useFrameWidth";
import { useLiveMap } from "@/lib/useLiveMap";
import { IconMap } from "@/components/icons";

/**
 * The map itself for a place page: this place, and the nearby ones the page
 * already recommends further down.
 *
 * Showing only the one pin answered "where is it" and stopped there, while the
 * page went on to suggest three other places with no hint of whether they were
 * next door or across the country. They are drawn smaller and lighter so the
 * place you came for still reads first.
 *
 * The frame is fitted to all of them, and its shape is applied to the
 * container — see lib/map-frame for why those two must agree exactly.
 */
/**
 * What the spreading has to keep clear around each point.
 *
 * This is the main pin's diameter, not a neighbour's: it is the biggest thing
 * on the frame, and at 32 a neighbour was landing on top of the very place the
 * page is about. The halo around it is wider still, but a halo is translucent
 * and a pin overlapping it reads fine — a pin overlapping the pin does not.
 */
const PIN_PX = 40;
const NEAR_PIN_PX = 26;
const PHONE_FRAME_PX = 520;

export default function PlaceMapFrame({
  place,
  related = [],
}: {
  place: Place;
  related?: Place[];
}) {
  // Which neighbour is called out. On a phone the first tap sets this and the
  // second opens the place — see MapPin.
  const [active, setActive] = useState<string | null>(null);

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

  // Measured, not assumed — see useFrameWidth: guessing a desktop width made
  // every phone fetch the basemap twice and shift the layout between the two.
  const [frameRef, frameW] = useFrameWidth<HTMLDivElement>();
  const live = useLiveMap();

  // Only nearby places earn a pin. A "similar" place 30km away would drag the
  // frame out until this place's own street was unreadable, which is the one
  // thing this map has to get right.
  const near = useMemo(
    () => related.filter((r) => Math.hypot(r.lat - place.lat, r.lng - place.lng) < 0.055),
    [related, place.lat, place.lng]
  );
  const all = useMemo(() => [place, ...near], [place, near]);

  const maxAspect = frameW < PHONE_FRAME_PX ? 1.6 : 2.0;
  // Centred on this place, not on the bounding box of it and its neighbours —
  // the page is asking where *it* is, so it belongs in the middle.
  const f = useMemo(
    () =>
      frameW > 0
        ? fitFrameAround(place, near, {
            maxAspect,
            padding: 1.25,
            // Room for a neighbour's pin to stand in. The subject's own pin is
            // centred and has half a frame above it; it is the neighbours near
            // the top edge that lose their heads without this.
            headroom: pinHeadroom(NEAR_PIN_PX),
            frameW,
          })
        : null,
    [place, near, maxAspect, frameW]
  );
  // A remote place — Al-Khiran, Failaka — has no near neighbours, so the frame
  // stretches to reach them and one pin width becomes kilometres on the
  // ground. pinShiftCap keeps the nudge honest at every zoom.
  const pins = useMemo(() => {
    if (!f) return [];
    const size = PIN_PX / frameW;
    return spreadPins(all.map((p) => project(f, p)), size, f.aspect, pinShiftCap(f, size));
  }, [all, f, frameW]);

  /**
   * One marker, drawn the same whichever map is underneath it.
   *
   * The static frame places things as a fraction of itself and Leaflet answers
   * in container pixels, so both are passed in and the decisions that depend
   * on position — which edge a callout hangs off, whether it drops below — are
   * written once. `pointerEvents` is set by the live caller because its
   * overlay layer is `pointer-events-none`, so the drag that pans the map is
   * not swallowed by an invisible sheet over the whole frame.
   */
  const renderMarker = (
    p: (typeof all)[number],
    i: number,
    style: React.CSSProperties,
    fx: number,
    fy: number
  ) => {
    // The place the page is about. Not a link — you are already on it —
    // and not a plain dot either: it is the answer to the question the
    // page asks, so it is the largest thing on the frame and the only one
    // that is always haloed.
    if (i === 0) {
      return (
        <span key={p.slug} style={style} className="absolute z-30 -translate-x-1/2 -translate-y-1/2">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 size-[4.5rem] -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-coral-600/25 motion-reduce:animate-none"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-coral-600/15"
          />
          <span className="relative grid size-10 place-items-center rounded-full border-2 border-white bg-coral-700 text-white shadow-xl ring-1 ring-ink-900/10">
            <PlaceIcon slug={p.slug} className="size-5" />
          </span>
          <span className="sr-only">{p.nameAr} — هنا</span>
        </span>
      );
    }

    return (
      <MapPin
        key={p.slug}
        place={p}
        active={active === p.slug}
        onActive={setActive}
        size={NEAR_PIN_PX}
        dim
        align={fx < 0.28 ? "start" : fx > 0.72 ? "end" : "center"}
        below={fy < 0.28}
        style={style}
      />
    );
  };

  return (
    <div
      ref={frameRef}
      data-map-frame=""
      style={f ? { aspectRatio: String(f.aspect) } : undefined}
      className="relative w-full bg-sand-100"
    >
      {/* Open the connection to the third-party basemap — DNS, TCP, TLS —
          while the page is still parsing, rather than when the iframe appears.
          It can live here because a place page always has a map; the search
          page's copy is in its route, for reasons written down there. */}
      <link rel="preconnect" href="https://www.openstreetmap.org" />

      {/* Deliberate ground rather than a stark void while the tiles load — and
          the whole answer when there is no network. */}
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-sand-700">
        <span className="flex flex-col items-center gap-2">
          <IconPinSolid className="size-10" />
          <span className="text-xs font-semibold">الخريطة</span>
        </span>
      </span>

      {live.live && live.LiveMap && f ? (
        <live.LiveMap
          frame={f}
          points={all}
          ariaLabel={`خريطة ${place.nameAr}، تقدر تحركها`}
        >
          {(at, box) =>
            at
              ? all.map((p, i) =>
                  renderMarker(
                    p,
                    i,
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
              title={`خريطة ${place.nameAr}`}
              loading="lazy"
              tabIndex={-1}
              aria-hidden="true"
              // See SearchMap: scripts only, no same-origin, no top navigation.
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              className="pointer-events-none absolute inset-0 block h-full w-full border-0"
            />
          )}

          {f &&
            all.map((p, i) =>
              renderMarker(
                p,
                i,
                // Physical left/top on purpose: the page is RTL, geography is not.
                { left: `${pins[i].x * 100}%`, top: `${pins[i].y * 100}%` },
                pins[i].x,
                pins[i].y
              )
            )}

          {/* Over the static frame only, and over the map rather than beside
              it: this frame has no header row of its own to put a control in,
              and the row under it belongs to Google Maps and the directions —
              links that leave. This one does not leave. */}
          {f && online && live.available && (
            <button
              type="button"
              onClick={live.enable}
              // See SearchMap's copy: the approach pays for the tap.
              onMouseEnter={live.warm}
              onFocus={live.warm}
              onTouchStart={live.warm}
              onPointerDown={live.warm}
              disabled={live.loading}
              className="absolute bottom-3 right-3 z-30 flex min-h-6 items-center gap-1.5 rounded-full border border-line bg-white/95 px-3 py-1.5 text-xs font-semibold text-ink-700 shadow-sm transition hover:text-sea-700 disabled:opacity-60"
            >
              <IconMap className="size-3.5" />
              {live.loading ? "لحظة…" : "حرّك الخريطة"}
            </button>
          )}

          {live.failed && (
            <p className="absolute bottom-3 left-3 z-30 rounded-lg bg-white/95 px-2 py-1 text-2xs text-ink-600 shadow-sm">
              ما قدرنا نحمّل الخريطة المتحركة
            </p>
          )}
        </>
      )}
    </div>
  );
}
