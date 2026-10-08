"use client";

import dynamic from "next/dynamic";

/**
 * The home page's own client pieces, each in a script of its own —
 * LandmarksShowLazy's reason.
 *
 * The home page's chunk (`app/page`) loads on most other routes too, because
 * `next/link` was first seen there, so whatever the home page imports directly
 * ships to /search, /salem and the rest. On 8 October the AVIF fallback put
 * /search 0.3K over its budget while drawing on no page but this one, and the
 * desktop start bar had been riding along the same way since 3 October.
 * Through `dynamic` the server still renders both, so the picture starts
 * loading with the HTML, and the bar — hidden and inert until its observer
 * answers — looks the same whether its script has arrived or not.
 */
export const HeroPicture = dynamic(() => import("@/components/HeroPicture"));
export const StartBar = dynamic(() => import("@/components/StartBar"));
