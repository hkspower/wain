"use client";

import { useLayoutEffect, useEffect, useRef, useState } from "react";

/**
 * The width of a map frame, measured before it is ever painted.
 *
 * Both maps fit their view to the box they are drawn in: the frame's aspect is
 * capped tighter on a phone than on a desktop, and the anti-overlap nudge is
 * budgeted in pixels. So the width has to be known before the bbox is built.
 *
 * It used to be *assumed* — the state started at 720 and a ResizeObserver
 * corrected it after the first paint. On a desktop the guess happened to be
 * right. On a phone it was wrong every single time, and the cost was not a
 * rounding error: the first frame was built at the desktop aspect cap, the
 * basemap iframe fetched that bbox from openstreetmap.org, the observer then
 * reported 358px, and the whole thing was thrown away and fetched again. Two
 * cross-origin round trips, a layout shift between two frame heights, and a
 * white flash — on every phone visit, which is nearly all of the traffic.
 *
 * Measuring in a layout effect closes that: it runs after the box is in the
 * DOM and before the browser paints, and the state it sets is flushed in the
 * same commit. The caller renders nothing inside the frame until this returns
 * a real width, so the wrong iframe is never created at all rather than being
 * created and replaced.
 *
 * Returns 0 until measured — including on the server, where there is nothing
 * to measure and `useLayoutEffect` would only warn.
 *
 * Both readings are of the BORDER box, and that is the whole reason the second
 * one is written the way it is. `getBoundingClientRect().width` is the border
 * box; `ResizeObserver`'s `contentRect` is the content box. The search map's
 * frame has a 1px border, so the two disagreed by 2px — and 2px is a different
 * frame, a different bbox, and a second fetch of the basemap. The fix for the
 * guessed width was undone by the mismatch until both were made to measure the
 * same rectangle.
 */
export function useFrameWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  // useLayoutEffect does nothing during the static export's prerender, and
  // React says so loudly. There is no box to measure there anyway.
  const useMeasure = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useMeasure(() => {
    const el = ref.current;
    if (!el) return;
    const take = (w: number) => {
      if (w > 0) setWidth((prev) => (prev === w ? prev : w));
    };
    take(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) =>
      take(entry.borderBoxSize?.[0]?.inlineSize ?? el.getBoundingClientRect().width)
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}
