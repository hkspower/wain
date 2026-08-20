"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PlaceIcon from "@/components/PlaceIcon";
import { IconMap, IconPinSolid } from "@/components/icons";
import { toArabicDigits, type Place } from "@/lib/places";
import { embedUrl, fitFrame, osmLink, project, spreadPins } from "@/lib/map-frame";

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
 * overlay and desync every pin, and each pin is already a link. Panning lives
 * behind the "open the big map" link.
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
  // Measure it, or the spreading under-corrects on small screens.
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameW, setFrameW] = useState(720);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setFrameW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxAspect = frameW < PHONE_FRAME_PX ? 1.7 : 2.4;
  const f = useMemo(
    () => (places.length ? fitFrame(places, { maxAspect }) : null),
    [places, maxAspect]
  );
  const pins = useMemo(() => {
    if (!f) return [];
    return spreadPins(places.map((p) => project(f, p)), PIN_PX / frameW, f.aspect);
  }, [places, f, frameW]);

  if (!f || places.length === 0) return null;

  return (
    <section className="mb-6" aria-labelledby="search-map-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          id="search-map-heading"
          className="flex items-center gap-2 text-sm font-semibold text-ink-700"
        >
          <IconMap className="size-4 text-sea-600" />
          {toArabicDigits(places.length)} على الخريطة
        </h2>
        <a
          href={osmLink(f.centre, 12)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center text-xs font-semibold text-sea-700 underline-offset-2 hover:underline"
        >
          افتح الخريطة الكبيرة
        </a>
      </div>

      <div
        ref={frameRef}
        // The shape comes from the results, so it has to be inline. It must
        // stay exactly the aspect the bbox was grown to, or every pin shifts.
        style={{ aspectRatio: String(f.aspect) }}
        className="relative w-full overflow-hidden rounded-3xl border border-sand-200 bg-sand-100 shadow-sm"
      >
        {/* Ground for before the tiles paint — and for offline, where the pins
            still carry the answer on their own. */}
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-sand-700">
          <IconPinSolid className="size-8" />
        </span>

        {online && (
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

        {places.map((p, i) => {
          // Physical left/top on purpose. The page is RTL, but geography is
          // not — a logical inset would mirror the map east-to-west.
          const on = active === p.slug;
          return (
            <Link
              key={p.slug}
              href={`/places/${p.slug}`}
              style={{ left: `${pins[i].x * 100}%`, top: `${pins[i].y * 100}%` }}
              onMouseEnter={() => onActive?.(p.slug)}
              onMouseLeave={() => onActive?.(null)}
              onFocus={() => onActive?.(p.slug)}
              onBlur={() => onActive?.(null)}
              aria-label={`${p.nameAr} — ${p.areaAr}`}
              className={`absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white shadow-md transition hover:scale-110 focus-visible:scale-110 ${
                on ? "z-20 scale-110 bg-coral-600 text-white" : "z-10 bg-ink-900 text-white"
              }`}
            >
              <PlaceIcon slug={p.slug} className="size-5" />
              <span
                className={`pointer-events-none absolute bottom-full mb-1.5 whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1 text-[11px] font-semibold text-white shadow-lg transition ${
                  on ? "opacity-100" : "opacity-0"
                }`}
              >
                {p.nameAr}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
