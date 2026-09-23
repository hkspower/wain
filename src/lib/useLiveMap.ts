"use client";

import { useCallback, useRef, useState } from "react";
import type LiveMapComponent from "@/components/LiveMap";
import { liveMapEnabled, warmTiles } from "@/lib/map-tiles";

/**
 * Fetching the interactive map, once, when somebody asks for it.
 *
 * The import is the whole point: `@/components/LiveMap` pulls Leaflet, 42.4K
 * gzipped, and `/search` has about 15K of room under the budget `audit:js`
 * enforces. Reaching it only from inside a callback keeps it out of every
 * page's HTML, so nobody pays for a map they did not ask to move.
 *
 * `import type` above is erased at compile time — the same allowance
 * `place-kit.ts` relies on for the `Place` type. It is here so the returned
 * component is typed rather than `any`, and it pulls nothing.
 *
 * A failure is REPORTED, not retried into silence. The chunk can fail to
 * arrive — a dropped connection mid-tap is the ordinary case — and the shape
 * to avoid is شوق's old widget loader, which treated «a request was started»
 * as «it is here» and then narrated a success that had not happened. Here the
 * caller gets `failed` and says so, and the static map it was already drawing
 * is still on screen underneath.
 */
export function useLiveMap() {
  const [Comp, setComp] = useState<typeof LiveMapComponent | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Fetch the chunk and open the tile connection while the finger is still on
   * its way, so the tap spends neither.
   *
   * The same move `ShouqCallButton` makes for her call, and for the same
   * reason: the work a tap triggers can be started by the approach to the tap.
   * What the tap costs was measured on the built export at 390px, with the
   * clock started at the page's own `pointerdown` rather than from the test
   * harness — 27ms to the request, and then **316ms at ×6 CPU with the
   * download already finished**, because what dominates is Leaflet parsing
   * and `L.map()` building its panes. Warming pays both: `import()` resolves
   * only once webpack has EVALUATED the module, so priming it moves the parse
   * off the critical path too, not merely the bytes.
   *
   * Unlike شوق's 451KB widget this is 45K of our own, so it is fetched on
   * approach rather than held back to `pointerdown` — which is exactly what
   * her button already does with its OWN chunk, and withholds only from the
   * third-party half.
   *
   * Idempotent and fire-and-forget. A rejection is deliberately not
   * remembered and not reported: `enable` re-imports and owns `failed`, so a
   * warm that fails costs nothing and a warm that succeeds cannot make
   * `enable` claim anything it has not awaited itself — the `loadWidget`
   * lesson, which is that «a request was started» is not «it is here».
   */
  const warmed = useRef(false);
  const warm = useCallback(() => {
    if (warmed.current || !liveMapEnabled) return;
    warmed.current = true;
    warmTiles();
    void import("@/components/LiveMap").catch(() => {
      /* enable() will try again and say so honestly if it cannot. */
    });
  }, []);

  const enable = useCallback(async () => {
    if (Comp || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const mod = await import("@/components/LiveMap");
      // A setter given a function is called with the previous state, and a
      // component IS a function — passing it bare would have React invoke it
      // as an updater and store whatever it returned.
      setComp(() => mod.default);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [Comp, loading]);

  return {
    /** Null until the chunk has arrived; rendering it is what shows the map. */
    LiveMap: Comp,
    live: Comp !== null,
    loading,
    failed,
    /** False when `NEXT_PUBLIC_WAIN_TILES` is «none» — then no control is drawn. */
    available: liveMapEnabled,
    enable,
    warm,
  };
}
