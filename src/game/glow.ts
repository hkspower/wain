import * as THREE from "three";

/**
 * The two shapes a glow can have, and why one texture cannot be both.
 *
 * A POINT source seen directly — a lamp head, a headlamp, a tail lamp —
 * falls off the way a small bright thing does on a lens: a tiny, very
 * hot core and a long faint tail that never quite ends.
 *
 * A POOL is the opposite. Neon washing the asphalt under a car is broad
 * and even and has no core at all; it is light landing ON something
 * rather than the source itself.
 *
 * One texture was doing both jobs and it was the pool's shape: alpha
 * 0.85 at the centre still 0.25 a third of the way out, and 0.3 more
 * than half way out. Blended that would be soft. ADDED, which is how
 * every one of these is drawn, it is a plateau — and a plateau does not
 * read as a light, it reads as a flat white disc with a soft edge. That
 * is what every street lamp in this game looked like, and it is what
 * "the flare is too much" actually was: not too bright, the wrong shape.
 */
function radial(
  r: number,
  g: number,
  b: number,
  peak: number,
  falloff: (t: number) => number
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  // Sampled at seventeen stops rather than given three. The curves below
  // are nowhere near straight between any two points that matter, and a
  // three-stop gradient interpolates them into exactly the plateau this
  // file exists to get rid of.
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    grad.addColorStop(t, `rgba(${r},${g},${b},${(peak * falloff(t)).toFixed(4)})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let pointShared: THREE.CanvasTexture | null = null;

/**
 * A light source seen directly. Tight core, long tail, exactly zero at
 * the edge — the last part matters, because a falloff that still has
 * alpha at the quad's boundary shows the quad.
 */
export function pointGlowTexture(r = 255, g = 255, b = 255, peak = 0.95): THREE.CanvasTexture {
  if (r === 255 && g === 255 && b === 255 && peak === 0.95) {
    if (!pointShared) pointShared = radial(r, g, b, peak, pointFalloff);
    return pointShared;
  }
  return radial(r, g, b, peak, pointFalloff);
}
/** 1/(1+(t/k)^2) is what a small source does on a lens. The (1-t)^2
 *  carries it to zero at the edge without flattening the core. */
const pointFalloff = (t: number): number => (1 / (1 + (t / 0.085) ** 2)) * (1 - t) ** 2;

let poolShared: THREE.CanvasTexture | null = null;

/** Light landing on a surface: broad, even, coreless. */
export function poolGlowTexture(): THREE.CanvasTexture {
  if (!poolShared) poolShared = radial(255, 255, 255, 0.85, (t) => (1 - t * t) ** 1.4);
  return poolShared;
}
