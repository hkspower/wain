"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import L, { type Map as LeafletMap } from "leaflet";
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
 * their callouts and their two-way highlight with the result list — and they
 * are placed from the view rather than from a bbox of their own, through
 * `latLngToContainerPoint` when it settles and one transform while it moves
 * (see `project` and `paint`). The overlay cannot desync because it no longer
 * has its own opinion about where the map is looking.
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
 * **Leaflet is imported statically, and that is what makes the tap one round
 * trip instead of two.** It used to be a second `await import("leaflet")`
 * inside the effect below, which reads as consistent — the map is lazy, so
 * Leaflet is lazy — and is not: this module is ALREADY only reachable from a
 * runtime `import()`, so a nested one bought no laziness at all and cost a
 * serial request. Traced on the built export: the tap fetched a 2.2K chunk,
 * waited for it to arrive and be evaluated, and only then asked for the 41K
 * one that is the actual download. On localhost that gap is 5ms and invisible;
 * on a phone in Kuwait it is a whole round trip of nothing, in front of the
 * thing the visitor tapped for. One static import puts both in one chunk.
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
  const pinsRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }[] | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<number | null>(null);

  // `points` is rebuilt by the parent on every render, so it cannot be a
  // dependency without tearing the map down and back up on each drag frame.
  // The ref is read inside the handler, which always wants the current one.
  const pointsRef = useRef(points);
  pointsRef.current = points;

  /**
   * Re-apply the pan offset after React has committed new pin positions.
   *
   * Owned by the effect below, which is where the map it reads from lives;
   * called from the layout effect at the bottom. See `paint`.
   */
  const paintRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !TILE_URL) return;

    const [west, south, east, north] = frame.bbox.split(",").map(Number);

    const map = L.map(host, {
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

    // Typed optional because `getPane` also takes a name that may not exist.
    // This one is built by the map's own constructor, so a missing pane would
    // mean Leaflet had changed underneath us — say so rather than translate by
    // (0,0) for ever, which would look exactly like the bug being fixed here.
    const pane = map.getPane("mapPane");
    if (!pane) throw new Error("LiveMap: Leaflet built no mapPane");

    /**
     * Where the map pane stood, and at what zoom, when `pos` was last computed.
     *
     * A container point is a layer point plus the map pane's own offset, and a
     * PAN moves only the pane — every pin's layer point is unchanged. So the
     * whole overlay can follow a drag with one transform, and the result is
     * not an approximation of re-projecting: it is the same number, arrived at
     * by addition instead of by trigonometry and a React render.
     */
    let base = L.DomUtil.getPosition(pane);
    let baseZoom = map.getZoom();

    /**
     * Re-project every pin. This is the expensive path and it runs when the
     * view SETTLES, not while it moves.
     *
     * It used to run on every `move`, which is once per animation frame, and
     * it is not one projection — it is a React render of every pin, each with
     * a fresh `style` object and the callout, the halo and the nose under it.
     * Measured on the built export at 390px with 30 results and the CPU
     * throttled 6×, one second of dragging cost 3.5 SECONDS of long tasks:
     * a median frame of 33ms against 60fps' 16.7, and a worst of 150ms. The
     * map moved smoothly — Leaflet moves its own panes on the compositor —
     * and the pins stuttered across it, which is the one thing this component
     * exists to make look like one object.
     */
    const project = () => {
      const box = map.getSize();
      // A fresh object every frame defeats React's bail-out even when the two
      // numbers have not changed, and during a drag they never do.
      setSize((s) => (s.w === box.x && s.h === box.y ? s : { w: box.x, h: box.y }));
      setZoom(map.getZoom());
      setPos(
        pointsRef.current.map((p) => {
          const pt = map.latLngToContainerPoint([p.lat, p.lng]);
          return { x: pt.x, y: pt.y };
        })
      );
      base = L.DomUtil.getPosition(pane);
      baseZoom = map.getZoom();
    };

    /**
     * Carry the pins with a pan, in one style write and no React at all.
     *
     * `project` does not clear the transform; the layout effect below calls
     * this instead, after the new `left`/`top` have been committed and before
     * they are painted. The difference from simply zeroing it there is that
     * this RECOMPUTES the delta: against a freshly re-based `base` that is the
     * identity, and against a map that moved again in between it is the offset
     * that is actually wanted. So there is no ordering it can be wrong for.
     *
     * The seam that would argue for it was looked for and does NOT reproduce:
     * `project` runs inside a DOM event, React flushes that before the paint,
     * and zeroing the transform there turned out to be seamless too. Measured
     * on a settled release and on a fling, throttled and not. So this is not a
     * bug being fixed, and there is no assertion for it — an assertion that
     * cannot go red is worse than none, and this file already carries one
     * lesson about that. It is here because it costs a line and does not
     * depend on a flush order nothing here controls.
     *
     * The zoom guard is the case a translate cannot answer: a pinch changes
     * every layer point, so there is no single offset that fixes them. Those
     * frames take `project` instead — a pinch is short, and it is what this
     * did on every frame of everything until now.
     */
    const paint = () => {
      const layer = pinsRef.current;
      if (!layer || map.getZoom() !== baseZoom) return;
      const now = L.DomUtil.getPosition(pane);
      layer.style.transform = `translate3d(${now.x - base.x}px, ${now.y - base.y}px, 0)`;
    };
    paintRef.current = paint;

    // The cheap path while it moves, the real one when it stops. A pinch fires
    // `move` too and changes the zoom with it, which is the branch — `paint`
    // repeats that guard because the layout effect reaches it another way.
    map.on("move", () => (map.getZoom() === baseZoom ? paint() : project()));
    map.on("moveend zoomend viewreset resize", project);

    mapRef.current = map;
    project();

    return () => {
      map.remove();
      mapRef.current = null;
      paintRef.current = () => {};
    };
    // The frame is the starting view only. Re-fitting on every parent render
    // would yank the map back the moment the visitor dragged it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Before the paint that shows the new positions, never after. See `paint`.
  useLayoutEffect(() => {
    paintRef.current();
  }, [pos]);

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
          pans the map, and a pin must still be tappable.

          `transform` on this element is written by the effect above and by
          nothing else — it is how the whole set follows a pan without a
          render. `will-change` so the browser keeps it on its own layer for
          the length of the drag rather than promoting it afresh each time. */}
      <div ref={pinsRef} style={{ willChange: "transform" }} className="pointer-events-none absolute inset-0 z-20">
        {children(pos, size)}
      </div>

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
