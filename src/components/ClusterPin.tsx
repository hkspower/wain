"use client";

import { PLACES_COUNT, countAr, toArabicDigits } from "@/lib/place-kit";

/**
 * Several places too close to draw apart, as one bubble that says how many.
 *
 * A button, not a link: it does not go anywhere, it brings the map closer —
 * the frame the caller hands it is fitted to just these places. The places
 * themselves stay reachable from the list beside every map, which is the
 * keyboard's and the screen reader's index; the bubble's name says what it
 * holds and what pressing it does.
 */
export default function ClusterPin({
  count,
  onZoom,
  style,
}: {
  count: number;
  onZoom: () => void;
  style?: React.CSSProperties;
}) {
  // Grows with what it holds, a little: 34px for a pair, 44 at ten or more.
  const size = Math.min(44, 30 + count * 1.4);
  return (
    <span style={style} className="absolute z-[150] -translate-x-1/2 -translate-y-1/2">
      <button
        type="button"
        onClick={onZoom}
        data-count={count}
        // «بهالمنطقة» rather than an adjective: «قريبة» would have to agree
        // with a dual, a plural and a singular-after-eleven in turn.
        aria-label={`${countAr(count, PLACES_COUNT)} بهالمنطقة — قرّب الخريطة`}
        style={{ width: size, height: size }}
        className="grid place-items-center rounded-full border-2 border-white bg-ink-900/85 font-display text-sm font-bold text-white shadow-md ring-4 ring-ink-900/15 transition duration-200 hover:scale-110 focus-visible:scale-110"
      >
        {toArabicDigits(count)}
      </button>
    </span>
  );
}
