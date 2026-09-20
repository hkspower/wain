"use client";

import { useCallback, useState } from "react";
import type LiveMapComponent from "@/components/LiveMap";
import { liveMapEnabled } from "@/lib/map-tiles";

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
  };
}
