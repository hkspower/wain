"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PlaceIcon from "@/components/PlaceIcon";
import { IconMap, IconPinSolid } from "@/components/icons";
import { toArabicDigits, type Place } from "@/lib/places";

/**
 * Where the results actually are.
 *
 * The site is called وين — "where" — and search answered it with a list only.
 * This puts the hits on a map.
 *
 * Two things make it work on a static export with no API key:
 *
 * 1. OpenStreetMap's embed renders the bbox we ask for, so it is an accurate
 *    basemap for free. It is made non-interactive on purpose: the embed would
 *    pan under our overlay and desync the pins, and every pin is a link, so
 *    the frame has nothing to offer that we do not. Panning lives behind the
 *    "open the big map" link instead.
 *
 * 2. Because we choose the bbox, we can project each place into it ourselves
 *    and place a real pin per result — the embed only ever draws one marker.
 *
 * The catch the maths has to respect: the embed fits the bbox to the frame,
 * expanding whichever axis is short. If our bbox aspect and the frame aspect
 * disagree, every pin lands slightly wrong. So the frame is locked to ASPECT
 * and the bbox is grown to match it before being handed over.
 */

/** Frame shape, and the shape the bbox is grown to match. */
const ASPECT = 3 / 2;
/** Breathing room so no pin sits on the frame edge. */
const PADDING = 1.25;
/** Floor on the zoom, in radians of longitude, so one result is not absurd. */
const MIN_HALF_SPAN = 0.0016;
/**
 * Pin diameter in px. Below the 44px tap floor on purpose: a pin's position is
 * its meaning, so padding it out would either move it off its place or bury
 * its neighbours — WCAG 2.5.8's exception for essential presentation. It still
 * clears the 24px AA minimum.
 */
const PIN_PX = 32;

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
/** Web Mercator, so the projection matches the tiles underneath. */
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const invMercY = (y: number) => deg(2 * Math.atan(Math.exp(y)) - Math.PI / 2);

function frame(places: Place[]) {
  const xs = places.map((p) => rad(p.lng));
  const ys = places.map((p) => mercY(p.lat));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

  let hx = Math.max((Math.max(...xs) - Math.min(...xs)) / 2, MIN_HALF_SPAN) * PADDING;
  let hy = Math.max((Math.max(...ys) - Math.min(...ys)) / 2, MIN_HALF_SPAN) * PADDING;
  // Grow the short axis until the bbox is exactly the frame's shape.
  if (hx / hy < ASPECT) hx = hy * ASPECT;
  else hy = hx / ASPECT;

  return {
    cx, cy, hx, hy,
    west: deg(cx - hx), east: deg(cx + hx),
    south: invMercY(cy - hy), north: invMercY(cy + hy),
  };
}

/**
 * Nudge pins apart until each is clickable.
 *
 * One far result — Failaka is 30km east of everything else — zooms the frame
 * out until the city places land on top of each other and only the last one
 * drawn can be clicked. That is geography, not a bug, but a pin nobody can
 * press is not much of a map.
 *
 * So overlapping pins are pushed apart, and the push is capped at one pin
 * radius: enough to separate them, small enough that a pin never crosses into
 * somewhere it isn't. Positions are exact whenever nothing collides, which is
 * the common case.
 *
 * Works in units of frame width, so x and y are comparable on a 3:2 frame.
 */
function spread(pts: { x: number; y: number }[], size: number) {
  const out = pts.map((p) => ({ x: p.x, y: p.y / ASPECT }));
  const home = out.map((p) => ({ ...p }));
  const maxShift = size / 2;

  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        let dx = out[j].x - out[i].x;
        let dy = out[j].y - out[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= size) continue;
        // Exactly coincident: pick a direction from the index so it is stable.
        if (d < 1e-6) {
          const a = (i * 2.399) % (Math.PI * 2);
          dx = Math.cos(a); dy = Math.sin(a); d = 1;
        }
        const push = (size - d) / 2 / d;
        out[i].x -= dx * push; out[i].y -= dy * push;
        out[j].x += dx * push; out[j].y += dy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }

  return out.map((p, i) => {
    // Never let a pin drift further than a radius from where it belongs.
    const dx = p.x - home[i].x, dy = p.y - home[i].y;
    const d = Math.hypot(dx, dy);
    const k = d > maxShift ? maxShift / d : 1;
    return { x: home[i].x + dx * k, y: (home[i].y + dy * k) * ASPECT };
  });
}

export default function SearchMap({ places }: { places: Place[] }) {
  const [active, setActive] = useState<string | null>(null);
  // The basemap is a cross-origin iframe: with no network it paints the
  // browser's own error page inside our frame. Offline the pins and the ground
  // still answer the question, so only mount the frame when there is a network.
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
  // wide the frame actually is — 4% on a desktop column, 9% on a phone. Measure
  // it, or the spreading under-corrects on small screens and pins still stack.
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

  const f = useMemo(() => (places.length ? frame(places) : null), [places]);
  const pins = useMemo(() => {
    if (!f) return [];
    const raw = places.map((p) => ({
      x: (rad(p.lng) - (f.cx - f.hx)) / (2 * f.hx),
      y: (f.cy + f.hy - mercY(p.lat)) / (2 * f.hy),
    }));
    return spread(raw, PIN_PX / frameW);
  }, [places, f, frameW]);

  if (!f || places.length === 0) return null;

  const bbox = [f.west, f.south, f.east, f.north].join(",");
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
    bbox
  )}&layer=mapnik`;
  const big = `https://www.openstreetmap.org/#map=12/${invMercY(f.cy).toFixed(4)}/${deg(
    f.cx
  ).toFixed(4)}`;

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
          href={big}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center text-xs font-semibold text-sea-700 underline-offset-2 hover:underline"
        >
          افتح الخريطة الكبيرة
        </a>
      </div>

      <div
        ref={frameRef}
        className="relative aspect-[3/2] w-full overflow-hidden rounded-3xl border border-sand-200 bg-sand-100 shadow-sm"
      >
        {/* Ground for before the tiles paint — and for offline, where the pins
            still carry the answer on their own. */}
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-sand-700">
          <IconPinSolid className="size-8" />
        </span>

        {online && (
          <iframe
            src={embed}
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
          const left = pins[i].x * 100;
          const top = pins[i].y * 100;
          const on = active === p.slug;
          return (
            <Link
              key={p.slug}
              href={`/places/${p.slug}`}
              style={{ left: `${left}%`, top: `${top}%` }}
              onMouseEnter={() => setActive(p.slug)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(p.slug)}
              onBlur={() => setActive(null)}
              aria-label={`${p.nameAr} — ${p.areaAr}`}
              className={`absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-ink-900 text-white shadow-md transition hover:scale-110 focus-visible:scale-110 ${
                on ? "z-20 scale-110" : "z-10"
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
