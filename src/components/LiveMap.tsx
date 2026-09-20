"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapFrame } from "@/lib/map-frame";
import { ATTRIBUTION_AR, MAX_ZOOM, MIN_ZOOM, TILE_URL } from "@/lib/map-tiles";

/**
 * The map, once somebody asks to move it.
 *
 * Every map on this site draws an OpenStreetMap embed in a sandboxed iframe
 * and paints its own pins on top, from a Web Mercator projection that has to
 * agree with the embed's bbox exactly. That design bought a map for no
 * JavaScript at all, and it cost one thing, written up in `SearchMap`: «the
 * embed would pan under the overlay and desync every pin», so the basemap is
 * `pointer-events-none` and panning lives behind a link that leaves the site.
 *
 * This is that limitation answered rather than worked around. Leaflet owns the
 * basemap and the view; the pins stay exactly what they were — React, with
 * their callouts and their two-way highlight with the result list — and are
 * re-projected on every frame of a drag through `latLngToContainerPoint`. The
 * overlay cannot desync because it no longer has its own opinion about where
 * the map is looking.
 *
 * ## Why it is not simply the default
 *
 * 42.4K gzipped, and `/search` sits at 159.3K against a 175K budget. Loading
 * it eagerly would put the busiest route over, so this module is reached by a
 * runtime `import()` and nothing fetches it until a visitor taps «حرّك
 * الخريطة». `npm run audit:js` counts it separately for that reason — a chunk
 * no page's HTML references is invisible to a per-route total, and 46K that
 * the one check guarding weight cannot see is worse than 46K it can.
 *
 * The static frame is therefore not a fallback that is on its way out. It is
 * what a visitor gets for free, it is what works with no network and with no
 * JavaScript, and it is what keeps tile requests to a fraction of page views —
 * see `map-tiles.ts` for why that last one is an obligation and not a saving.
 */
export default function LiveMap({
  /** The view the static frame was showing, so the switch does not jump. */
  frame,
  points,
  ariaLabel,
  children,
}: {
  frame: MapFrame;
  /** In the caller's own order; `children` is handed positions in that order. */
  points: { lat: number; lng: number }[];
  ariaLabel: string;
  /**
   * The pins. Positions are container pixels, and `null` until Leaflet has
   * measured itself — drawing at 0,0 for one frame stacks every pin in the
   * corner and then scatters them, which reads as a glitch rather than a load.
   */
  children: (pos: { x: number; y: number }[] | null, size: { w: number; h: number }) => React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }[] | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<number | null>(null);

  // `points` is rebuilt by the parent on every render, so it cannot be a
  // dependency without tearing the map down and back up on each drag frame.
  // The ref is read inside the handler, which always wants the current one.
  const pointsRef = useRef(points);
  pointsRef.current = points;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !TILE_URL) return;

    let map: LeafletMap | null = null;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !hostRef.current) return;

      const [west, south, east, north] = frame.bbox.split(",").map(Number);

      map = L.map(hostRef.current, {
        // Ours are drawn in the site's own type and colours, below. Leaflet's
        // are a left-to-right corner box on a document that is `dir="rtl"`.
        zoomControl: false,
        attributionControl: false,
        // The pins are links and the callouts are ours; a scroll that zooms
        // the map instead of scrolling the page is the single most complained
        // about behaviour an embedded map has. Pinch and the buttons zoom.
        scrollWheelZoom: false,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
      });

      L.tileLayer(TILE_URL, { maxZoom: MAX_ZOOM, minZoom: MIN_ZOOM }).addTo(map);

      // The view the visitor was already looking at. `fitBounds` rather than a
      // centre and a zoom: the static frame's bbox was grown to the frame's
      // aspect precisely so everything fits, and re-deriving a zoom from it
      // would round to Leaflet's integer levels and crop what it fitted.
      map.fitBounds(
        [
          [south, west],
          [north, east],
        ],
        { animate: false }
      );

      const sync = () => {
        const m = mapRef.current;
        if (!m) return;
        const box = m.getSize();
        setSize({ w: box.x, h: box.y });
        setZoom(m.getZoom());
        setPos(
          pointsRef.current.map((p) => {
            const pt = m.latLngToContainerPoint([p.lat, p.lng]);
            return { x: pt.x, y: pt.y };
          })
        );
      };

      mapRef.current = map;
      // `move` rather than `moveend`: the pins have to travel with the map,
      // not catch up when it stops. It fires once per animation frame, which
      // is the rate the positions are wanted at anyway.
      map.on("move zoom resize", sync);
      sync();
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // The frame is the starting view only. Re-fitting on every parent render
    // would yank the map back the moment the visitor dragged it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nudge = (by: number) => {
    const m = mapRef.current;
    if (!m) return;
    m.setZoom(m.getZoom() + by);
  };

  return (
    <>
      <div ref={hostRef} className="absolute inset-0 z-0 h-full w-full" aria-label={ariaLabel} role="application" />

      {/* The pins, over Leaflet's own panes. `pointer-events-none` on the
          layer and not on the pins: the layer must not swallow the drag that
          pans the map, and a pin must still be tappable. */}
      <div className="pointer-events-none absolute inset-0 z-20">{children(pos, size)}</div>

      {/* Zoom, in the site's own shapes rather than Leaflet's. Physical
          right/bottom: the page is RTL, geography is not, and a logical inset
          would put these over the map's east edge on one page and its west on
          another. */}
      <div className="absolute bottom-3 right-3 z-30 flex flex-col overflow-hidden rounded-xl border border-line bg-white/95 shadow-sm">
        <button
          type="button"
          onClick={() => nudge(1)}
          disabled={zoom !== null && zoom >= MAX_ZOOM}
          aria-label="تكبير الخريطة"
          className="grid size-8 place-items-center text-lg font-semibold text-ink-700 transition hover:bg-sand-100 disabled:opacity-40"
        >
          +
        </button>
        <span aria-hidden="true" className="h-px bg-line" />
        <button
          type="button"
          onClick={() => nudge(-1)}
          disabled={zoom !== null && zoom <= MIN_ZOOM}
          aria-label="تصغير الخريطة"
          className="grid size-8 place-items-center text-lg font-semibold text-ink-700 transition hover:bg-sand-100 disabled:opacity-40"
        >
          −
        </button>
      </div>

      {/* Required, and so rendered by the map rather than by whoever remembers
          to. See map-tiles.ts: using the tiles directly is what makes this an
          obligation, where the iframe embed carried its own. */}
      <p className="absolute bottom-0 left-0 z-30 bg-white/85 px-1.5 py-0.5 text-2xs leading-tight text-ink-600">
        {ATTRIBUTION_AR}
      </p>
    </>
  );
}
