"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PlaceIcon from "@/components/PlaceIcon";
import { IconPinSolid } from "@/components/icons";
import type { Place } from "@/lib/places";
import { embedUrl, fitFrameAround, project, spreadPins } from "@/lib/map-frame";

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
const PIN_PX = 32;
const NEAR_PIN_PX = 26;
const PHONE_FRAME_PX = 520;

export default function PlaceMapFrame({
  place,
  related = [],
}: {
  place: Place;
  related?: Place[];
}) {
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
    () => fitFrameAround(place, near, { maxAspect, padding: 1.25 }),
    [place, near, maxAspect]
  );
  const pins = useMemo(
    () => spreadPins(all.map((p) => project(f, p)), PIN_PX / frameW, f.aspect),
    [all, f, frameW]
  );

  return (
    <div
      ref={frameRef}
      style={{ aspectRatio: String(f.aspect) }}
      className="relative w-full bg-sand-100"
    >
      {/* Deliberate ground rather than a stark void while the tiles load — and
          the whole answer when there is no network. */}
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-sand-700">
        <span className="flex flex-col items-center gap-2">
          <IconPinSolid className="size-10" />
          <span className="text-xs font-semibold">الخريطة</span>
        </span>
      </span>

      {online && (
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

      {all.map((p, i) => {
        const isMain = i === 0;
        // Physical left/top on purpose: the page is RTL, geography is not.
        const style = { left: `${pins[i].x * 100}%`, top: `${pins[i].y * 100}%` };
        if (isMain) {
          return (
            <span
              key={p.slug}
              style={style}
              aria-hidden="true"
              className="absolute z-20 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-coral-600 text-white shadow-lg"
            >
              <PlaceIcon slug={p.slug} className="size-5" />
            </span>
          );
        }
        return (
          <Link
            key={p.slug}
            href={`/places/${p.slug}`}
            style={style}
            aria-label={`${p.nameAr} — قريب من هنا`}
            className="group absolute z-10 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-ink-800/90 text-white shadow-md transition hover:z-20 hover:scale-110 focus-visible:z-20 focus-visible:scale-110"
          >
            <span className="grid place-items-center" style={{ width: NEAR_PIN_PX, height: NEAR_PIN_PX }}>
              <PlaceIcon slug={p.slug} className="size-4" />
            </span>
            <span className="pointer-events-none absolute bottom-full mb-1.5 whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1 text-2xs font-semibold text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-visible:opacity-100">
              {p.nameAr}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
