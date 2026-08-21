// What resolution the game actually renders at.
//
// The canvas fills its layout box and the drawing buffer is that box
// times the renderer's pixel ratio, so "resolution" in a browser game is
// one number: the ratio. Everything else follows from it — the composer
// targets, the FXAA texel size, the particle scale, the bloom pyramid.
//
// That number was `min(devicePixelRatio, 2)` and nothing else, which
// gave a correct NATIVE picture and no way to ask for anything: a 4K
// panel rendered 4K only if the window happened to be 4K, a 1280x720
// window could not render 4K however much GPU was sitting idle, and a
// 4K panel could not drop to 1080p to buy frames without also turning
// off bloom and shadows through the quality tier. Resolution and effects
// are different axes and they are separate settings now.
//
// A pinned resolution is a LINE COUNT, not a pair of numbers. "4K" means
// 2160 lines, and the width follows the window's aspect: on 16:9 that is
// exactly 3840x2160, and on a 2560x1080 ultrawide it is 5120x2160, which
// is what 2160p means on that monitor. Pinning a fixed 3840x2160 buffer
// into a window of a different shape would either stretch the picture or
// crop it, and both are worse than rendering the shape of the window.

/** A pinned line count, or the display's own pixels. */
export type Resolution = "native" | 2160 | 1440 | 1080 | 720;

export const RESOLUTIONS: ReadonlyArray<{
  value: Resolution;
  label: string;
  hint: string;
}> = [
  { value: "native", label: "Native", hint: "One buffer pixel per display pixel" },
  { value: 2160, label: "4K UHD", hint: "2160 lines · 3840×2160 on 16:9" },
  { value: 1440, label: "1440p", hint: "2560×1440 on 16:9" },
  { value: 1080, label: "Full HD", hint: "1920×1080 on 16:9" },
  { value: 720, label: "HD", hint: "1280×720 — for weak hardware" },
];

/**
 * The pixel ratio that puts the requested resolution on the screen.
 *
 * `cap` is the ceiling on NATIVE only. A phone reporting a device pixel
 * ratio of 3 is asking for nine times the pixels of a desktop panel for
 * a screen the size of a hand, and the default has always refused it. An
 * explicit resolution is not capped by it: a player who picks 4K has
 * said what they want more clearly than any heuristic can.
 */
export function pixelRatioFor(
  res: Resolution,
  cssW: number,
  cssH: number,
  dpr: number,
  maxBuffer: number,
  cap = 2
): number {
  const w = Math.max(1, cssW);
  const h = Math.max(1, cssH);
  let r = res === "native" ? Math.min(dpr || 1, cap) : res / h;
  // Never ask the GL stack for a buffer bigger than it will give. Past
  // MAX_RENDERBUFFER_SIZE the composer's targets fail to allocate and
  // the picture goes black — a failure that reports itself as nothing at
  // all, on exactly the wide, high-resolution setups most likely to hit
  // it. 2160 lines on a 32:9 superwide is 7680 across, which is already
  // half of a common limit.
  const limit = Math.max(1, maxBuffer);
  r = Math.min(r, limit / w, limit / h);
  // Three floors the product, so a ratio that is mathematically exact can
  // still land a line short through binary rounding: 915 * (1080/915) is
  // 1079.9999999999999 as often as it is 1080.0000000000002. The nudge is
  // ten-millionths of a pixel and it makes "1080p" mean 1080 every time.
  if (res !== "native") r += 1e-9;
  return Math.max(0.25, r);
}

/** The buffer three will actually allocate for this ratio — floor, the
 *  same way WebGLRenderer.setSize does it, so a caller can predict the
 *  numbers instead of measuring them afterwards. */
export function bufferFor(ratio: number, cssW: number, cssH: number): [number, number] {
  return [Math.floor(cssW * ratio), Math.floor(cssH * ratio)];
}

/** A resolution as a person would say it: "3840 × 2160". */
export function formatBuffer(w: number, h: number): string {
  return `${w} × ${h}`;
}
