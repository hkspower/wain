// The font stacks, read from the CSS custom properties in globals.css so
// canvas and DOM always name the same families.
//
// Deliberately free of any three.js import. These live apart from
// text.ts — which needs THREE for its self-repainting textures — because
// modules that only want a font stack should not pay for a 3D engine to
// get one. Importing text.ts from the crew emblem code took the /hub
// bundle from 5.77 kB to 73.5 kB, all of it three.js arriving to supply
// a string.

function stack(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.body || document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

/** Arabic for HUD-like surfaces (car decals, plates, name tags). */
export const arabicUI = () => stack("--font-arabic", "sans-serif");
/** Arabic for road signage — naskh, like real Gulf street furniture. */
export const arabicSign = () => stack("--font-arabic-sign", "serif");
/** The Latin racing face, for the bilingual halves of the same signs. */
export const latinDisplay = () =>
  // --font-display is a Tailwind theme token and only reaches the
  // stylesheet while a utility still references it; --font-display-stack
  // is emitted unconditionally beside the Arabic ones.
  stack("--font-display-stack", stack("--font-display", "sans-serif"));
