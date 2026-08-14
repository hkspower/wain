import * as THREE from "three";

// Canvas text, and the fonts it draws with.
//
// The DOM gets its type from next/font, which self-hosts each family
// under a hashed name published as a CSS variable. Canvas has to ask for
// those same families by name — and, critically, has to WAIT for them.
// A texture rasterised before its font arrives bakes the fallback in
// permanently: the sign is painted once, uploaded to the GPU, and never
// looks at the font again. For Arabic that failure is not subtle. The
// fallback is usually a face with no Arabic coverage, so the shaper
// falls back per-glyph and the letters come out unjoined — the written
// equivalent of s p e l l i n g  o u t  a  w o r d.
//
// So every text texture here registers its paint function and repaints
// itself once the fonts have actually loaded.

/** Read a composed font stack from the CSS custom properties in
 *  globals.css, so canvas and DOM always name the same families. */
function stack(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.body || document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

/** Arabic for HUD-like surfaces (car decals, plates). */
export const arabicUI = () => stack("--font-arabic", "sans-serif");
/** Arabic for road signage — naskh, like real Gulf street furniture. */
export const arabicSign = () => stack("--font-arabic-sign", "serif");
/** The Latin racing face, for the bilingual halves of the same signs. */
export const latinDisplay = () =>
  // --font-display is a Tailwind theme token and only reaches the
  // stylesheet while a utility still references it; --font-display-stack
  // is emitted unconditionally beside the Arabic ones.
  stack("--font-display-stack", stack("--font-display", "sans-serif"));

type Repaint = { tex: THREE.CanvasTexture; paint: () => void };
const waiting: Repaint[] = [];
let fontsSettled = false;

if (typeof document !== "undefined" && "fonts" in document) {
  // document.fonts.ready alone is not enough: a family nothing has drawn
  // yet was never requested, so "ready" resolves without it. Ask for each
  // family explicitly, with Arabic sample text, then repaint.
  const sample = "طريق";
  const want = [`700 40px ${arabicSign()}`, `700 40px ${arabicUI()}`];
  Promise.all([
    document.fonts.ready,
    ...want.map((f) => document.fonts.load(f, sample).catch(() => null)),
  ])
    .catch(() => null)
    .then(() => {
      fontsSettled = true;
      for (const w of waiting) {
        w.paint();
        w.tex.needsUpdate = true;
      }
      waiting.length = 0;
    });
} else {
  fontsSettled = true;
}

/**
 * A canvas-backed texture that repaints itself when the fonts land.
 * `paint` must draw the whole image — it is called again later.
 */
export function textTexture(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  const run = () => {
    ctx.clearRect(0, 0, width, height);
    paint(ctx);
  };
  run();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8; // signs are read at a glancing angle at speed
  if (!fontsSettled) waiting.push({ tex, paint: run });
  return tex;
}
