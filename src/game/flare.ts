import type * as THREE from "three";

// How loud the hot things are.
//
// Four things in the night frame were too strong, and they were looked
// at together because they are one problem seen four ways — light that
// is meant to read as "bright" reading instead as "blown":
//
//   A  a big red halo round every braking car's tail, and a white star
//      hanging off the back of the car in the drift still
//   B  star-shaped glints sitting on the wheel arches at full lock
//   C  the same glints on the arches in the afternoon driver still
//   D  the scrape sparks
//
// None of them is a single number gone wrong. A is the bloom's bright
// pass, measured on the max channel since the lighting commit, together
// with the HEADLAMP flare sprites, which draw from every angle including
// from behind the car. B and C are not sprites at all — no sprite sits
// on an arch; the only sprites on a car are the head halo and star at
// lampPositions on the nose, and the tail glow planes at the tail face.
// They are the paint's own specular (a 0.06 clearcoat over a 0.18
// metallic basecoat, on the tightly curved flare tube) catching the four
// street-lamp SpotLights, the rim light or the sun, at values of 40 to
// 500, and the bloom then turning a few pixels at 500 into a halo the
// size of a headlamp's. D is the sparks' own colour, opacity, size and
// throw.
//
// So each is fixed where it is made, in one place, with the arithmetic
// written as plain functions beside the GLSL that runs it, so that
// tests/flare.mjs can hold the numbers without a browser.

/** Rec. 709 luminance — the eye's weighting of linear RGB. */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** GLSL float literal: always with a point, never in exponent form. */
const glf = (n: number): string => {
  const s = n.toFixed(6).replace(/0+$/, "");
  return s.endsWith(".") ? `${s}0` : s;
};

// --- A, B, C: the bloom's bright pass ----------------------------------

/**
 * The bloom: threshold, knee and strength as the lighting commit set
 * them, plus the two terms that tone it down.
 *
 * WHAT THE BRIGHT PASS MEASURES.
 *
 * It used to be three's stock luminance pass at 0.85, which passed a
 * pixel's WHOLE value once its luminance crossed — so every lit window
 * bloomed and no red lamp ever did (a red lens's luminance is a fifth of
 * its red). The lighting commit measured the max channel instead and
 * bloomed only the excess. That let red bloom at all, and it let red
 * bloom exactly as hard as white: a braking tail core at the stills'
 * exposure (1.1) put 2.60 of red into the bloom, against 3.62 for a
 * white headlamp core, and a tail lens band 1.39. Spread over the whole
 * lamp that is the big red halo of the drift still.
 *
 * Now it measures the geometric mean of the two:
 *
 *   m = max · (luminance / max) ^ lumaWeight,   lumaWeight 0.5
 *
 * which is the max channel for anything white (luminance = max) and less
 * the more saturated a colour is. 0 is the lighting commit's pass, 1 is
 * luminance. Per unit of max channel, m is:
 *
 *   white 1.000   head lens 0xfff6cf 0.957   cool white 0xe8f0ff 0.931
 *   amber 0.810   tail core 0xff1a05 0.469   pure red 0.461
 *   police blue 0x0030ff 0.306
 *
 * and what reaches the bloom, max channel, 7db3da94 -> now:
 *
 *                       stills (EV 1.1)       game night (meter 0.55)
 *   brake core + glow    2.60 -> 1.48 (-43%)   0.80 -> 0.13
 *   brake lens + glow    1.39 -> 0.40 (-71%)   0.24 -> 0.00
 *   head core            3.62 -> 3.62          1.31 -> 1.31
 *   head lens            0.87 -> 0.83 (-5%)    0.095 -> 0.082
 *   lantern 0xfff0cc     1.42 -> 1.35 (-5%)    0.25 -> 0.21
 *
 * A red lamp still blooms — gently, and at about 40% of a headlamp core
 * in the stills rather than 72% — and the whites are where they were.
 * It is never MORE than the old pass for any pixel: m <= max always
 * (luminance is a weighted mean of the channels), the excess weight
 * only rises with m, and the cap below only takes away.
 *
 * What it costs, said once: a patrol car's blue bar (3.2 on 0x0030ff)
 * at the game's night meter sits at the foot of the knee now, 0.76 of
 * bloom before and about none after — which is where it was for every
 * build before the lighting commit too, since its luminance never came
 * near 0.85. At the stills' exposure it keeps 0.54.
 *
 * THE CAP.
 *
 * The excess, after weighting, is held to `cap` in its brightest
 * channel. The arch glints are the reason: the clearcoat's lobe on the
 * flare tube under a street lamp is a handful of pixels at 40 to 500,
 * and the bloom is linear in what it is given, so five pixels at 500
 * halo like 689 pixels of headlamp core at the stills' exposure. 5 is
 * above every lamp this game draws at any exposure the stills or the
 * meter use — a head core at the meter's top (1.25) puts in 4.25, a
 * braking tail core 1.97 — so no lamp is touched, and a 500 glint goes
 * into the blur at 5: a hundredth of the halo it threw. The one thing
 * the cap reaches is a full flash on main beam under the hand-set
 * exposure (1.15), whose lens peak 6.58 is held at 5.
 */
export const BLOOM = {
  threshold: 1.0,
  knee: 0.5,
  strength: 0.48,
  lumaWeight: 0.5,
  cap: 5,
} as const;

/** The bright pass, as the shader runs it: what one pixel of exposed
 *  linear light puts into the bloom. Plain arithmetic, for the tests. */
export function brightPass(
  r: number,
  g: number,
  b: number,
  o: { threshold?: number; knee?: number; lumaWeight?: number; cap?: number } = {}
): [number, number, number] {
  const t = o.threshold ?? BLOOM.threshold;
  const kn = o.knee ?? BLOOM.knee;
  const lw = o.lumaWeight ?? BLOOM.lumaWeight;
  const cap = o.cap ?? BLOOM.cap;
  const hi = Math.max(r, g, b);
  const lum = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
  const m = hi * Math.pow(Math.min(1, Math.max(1e-6, lum / Math.max(hi, 1e-4))), lw);
  const k = Math.min(Math.max(m - t + kn, 0), 2 * kn);
  const soft = (k * k) / (4 * kn + 1e-4);
  const w = Math.max(soft, m - t) / Math.max(m, 1e-4);
  const top = hi * w;
  const s = Math.min(1, cap / Math.max(top, 1e-4));
  return [r * w * s, g * w * s, b * w * s];
}

/**
 * The bright pass's fragment shader. Reads the UnrealBloomPass's own
 * luminosityThreshold and smoothWidth uniforms (so its threshold setter
 * still works) plus two of ours, which the engine adds to the same
 * uniform object: bloomLumaWeight and bloomCap.
 */
export const BRIGHT_PASS_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float luminosityThreshold;
  uniform float smoothWidth;
  uniform float bloomLumaWeight;
  uniform float bloomCap;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    float hi = max(max(c.r, c.g), c.b);
    float lum = dot(c.rgb, vec3(${glf(LUMA[0])}, ${glf(LUMA[1])}, ${glf(LUMA[2])}));
    float m = hi * pow(clamp(lum / max(hi, 1e-4), 1e-6, 1.0), bloomLumaWeight);
    float k = clamp(m - luminosityThreshold + smoothWidth, 0.0, 2.0 * smoothWidth);
    float soft = k * k / (4.0 * smoothWidth + 1e-4);
    float w = max(soft, m - luminosityThreshold) / max(m, 1e-4);
    vec3 o = c.rgb * w;
    o *= min(1.0, bloomCap / max(max(max(o.r, o.g), o.b), 1e-4));
    gl_FragColor = vec4(o, 1.0);
  }
`;

// --- A: the headlamp flare sprites -------------------------------------

/**
 * The halo and diffraction star every lit headlamp carries.
 *
 * Three things were wrong with them, and all three showed in the stills.
 *
 * THEY DREW FROM BEHIND. A sprite always faces the camera, so a lamp's
 * flare has no idea which way the lamp points. In the drift still the
 * camera is about 150 degrees round from the nose; one headlamp's halo
 * and star stood out past the flank as a white blaze beside the tail
 * lamp, and the other's star, seen through both screens, hung over the
 * rear deck as a second, smaller one with its horizontal arm still
 * drawn through it. That is the "white star at the tail": it is the
 * headlamps. The flare now fades with the angle between
 * the lamp's axis and the eye, in the shader, so every writer of the
 * opacity (the clock, a flash, the film, the rival's reply) keeps
 * owning it: full within 53 degrees of the axis, 0.48 at 70, and gone
 * past 84 all the way round to the back.
 *
 * THEY GREW WITHOUT LIMIT. A 1.7 m sprite is 4.7% of the frame's height
 * on an oncoming car at 30 m — right — and 49% at 6.5 m through the lock
 * still's 30-degree lens, where its vertical arm stood up out of the
 * light bar as two shafts the height of the car. A flare is a lens's
 * response to a source, and it does not keep growing as you walk up to
 * the lamp. The star may now span at most `capFrac` (14%) of the
 * viewport's height, and the halo shrinks with it by the same factor, so
 * both keep their proportions. In the game's own 62-degree view that
 * only starts to bite inside 7.1 m; the lock still's star goes from 49%
 * of the frame to 14%, its halo from 24% to 9.9%.
 *
 * THE STAR WAS AS LOUD AS THE HALO. The clock set both to 0.9 at night
 * on the player's car, the star at twice the halo's size. The halo is
 * what says "this lamp is lit"; the star is a decoration on top of it.
 * The star is now 1.2 m (from 1.7) and 0.55 at night (from 0.9) on the
 * player, 0.42 (from 0.62) as built on a rival: 39% and 32% less at any
 * one pixel, its arms 29% shorter, and 70% less light in all. The halo
 * is untouched.
 *
 * And the tint now reaches the player's sprites too. A smoked lens
 * flares at 0.34 of stock, and cars.ts always built it that way; the
 * clock then set every sprite on the player's car to a flat 0.9 at
 * dusk, so a smoked car flared like a stock one at night. Each material
 * carries its own night level (userData.nightOpacity) and the clock
 * reads it.
 */
export const HEAD_FLARE = {
  /** Halo diameter, metres, before the per-lamp size. Unchanged. */
  haloSize: 0.85,
  /** As built: what a rival, a showroom car or the menu starts from. */
  haloOpacity: 0.5,
  /** At night on the player's car (applyDaylight). Unchanged. */
  nightHalo: 0.9,
  /** Star diameter, metres. Was 1.7. */
  starSize: 1.2,
  /** As built. Was 0.62. */
  starOpacity: 0.42,
  /** At night on the player's car. Was 0.9, the same as the halo. */
  nightStar: 0.55,
  /** cos(angle off the lamp's axis) where the flare starts to show and
   *  where it is whole: gone past 84 degrees, whole inside 53. */
  facing: [0.1, 0.6] as const,
  /** The most of the viewport's height the star may span. */
  capFrac: 0.14,
} as const;

/** How much of a lamp's flare shows at `cosOff`, the cosine of the angle
 *  between the lamp's axis and the direction to the eye. */
export function flareFacing(cosOff: number): number {
  const [lo, hi] = HEAD_FLARE.facing;
  const u = Math.min(1, Math.max(0, (cosOff - lo) / (hi - lo)));
  return u * u * (3 - 2 * u);
}

/** The factor a lamp sprite is drawn at, `dist` metres from a camera
 *  whose projection has `p11` = 1 / tan(fov / 2): 1 until the star would
 *  span more than capFrac of the viewport's height. */
export function flareScale(dist: number, p11: number): number {
  const dMin = (p11 * HEAD_FLARE.starSize) / (2 * HEAD_FLARE.capFrac);
  return Math.min(1, dist / dMin);
}

/** The distance factor's denominator over p11: starSize / (2 capFrac). */
const FLARE_NEAR_K = HEAD_FLARE.starSize / (2 * HEAD_FLARE.capFrac);

/** Where the patch goes in three's sprite shader (r184). Each must occur
 *  exactly once, or the patch is not applied at all — a renamed line in
 *  a three upgrade leaves the stock sprite, never a broken shader, and
 *  tests/flare.mjs fails on it. */
export const FLARE_ANCHORS = {
  vertexPars: "uniform vec2 center;",
  vertexScale: "vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );",
  fragmentPars: "uniform float opacity;",
  fragmentAlpha: "vec4 diffuseColor = vec4( diffuse, opacity );",
} as const;

const once = (s: string, a: string): boolean => {
  const i = s.indexOf(a);
  return i >= 0 && s.indexOf(a, i + a.length) < 0;
};

/**
 * Patch a sprite shader in place: the facing fade and the size cap.
 * Returns false, and changes nothing, if any anchor is missing.
 *
 * The lamp's axis is the car's +z — every lamp is built facing it, and
 * the sprite is a child of the car — so it comes out of the sprite's own
 * modelViewMatrix: no uniform, nothing to update per frame, and the same
 * program for every lamp on every car.
 */
export function patchLampFlare(shader: { vertexShader: string; fragmentShader: string }): boolean {
  const A = FLARE_ANCHORS;
  if (
    !once(shader.vertexShader, A.vertexPars) ||
    !once(shader.vertexShader, A.vertexScale) ||
    !once(shader.fragmentShader, A.fragmentPars) ||
    !once(shader.fragmentShader, A.fragmentAlpha)
  ) {
    return false;
  }
  const [lo, hi] = HEAD_FLARE.facing;
  shader.vertexShader = shader.vertexShader
    .replace(A.vertexPars, `${A.vertexPars}\nvarying float vFlareFacing;`)
    .replace(
      A.vertexScale,
      `${A.vertexScale}
	vec3 flareAxis = normalize( ( modelViewMatrix * vec4( 0.0, 0.0, 1.0, 0.0 ) ).xyz );
	vFlareFacing = smoothstep( ${glf(lo)}, ${glf(hi)}, dot( flareAxis, normalize( - mvPosition.xyz ) ) );
	if ( isPerspectiveMatrix( projectionMatrix ) ) {
		scale *= min( 1.0, - mvPosition.z / ( projectionMatrix[ 1 ][ 1 ] * ${glf(FLARE_NEAR_K)} ) );
	}`
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(A.fragmentPars, `${A.fragmentPars}\nvarying float vFlareFacing;`)
    .replace(A.fragmentAlpha, `${A.fragmentAlpha}\n\tdiffuseColor.a *= vFlareFacing;`);
  return true;
}

/** One function for every lamp sprite, so three's program cache (keyed
 *  on onBeforeCompile's source) builds the patched sprite program once. */
function compileLampFlare(shader: { vertexShader: string; fragmentShader: string }): void {
  patchLampFlare(shader);
}

/** Mark a sprite material as a headlamp flare. */
export function lampFlareMaterial<T extends THREE.SpriteMaterial>(m: T): T {
  m.onBeforeCompile = compileLampFlare;
  return m;
}

// --- D: the scrape sparks ----------------------------------------------

/**
 * A scrape's sparks: their look and their throw.
 *
 * LOOK. Measured at the chase camera (tools/shots/sparks.mjs, 900x520,
 * pinned exposure, one severity-1 scrape) before this change: 280 px
 * lit at 0.18 s, peak +41 of 255, none clipped, and the bloom made no
 * difference at all — so this is the sprites' own light, and it comes
 * down where it is made, modestly:
 *
 *   core     0xffdf9e -> 0xffd08a   luminance 0.765 -> 0.682 (-11%),
 *                                   and a shade further from white
 *   opacity  0.4 -> 0.34                                      (-15%)
 *   size     0.09-0.16 -> 0.085-0.145 m                      (-8% across)
 *
 * which is 24% less at any one pixel at birth and 36% less light from
 * the whole shower (opacity x luminance x mean area). The ember end,
 * 0xff5a12, and the life are as they were.
 *
 * THROW. Up was 0.5-3.5 m/s from 0.22-0.52 m, which under 17 m/s^2 tops
 * out at 0.88 m before drag — over the beltline, and over the barrier
 * rail the shower is supposed to be skipping along. Now 0.4-2.2 m/s from
 * 0.2-0.42 m: at most 0.42 + 2.2^2 / (2 x 17) = 0.56 m, which `ceiling`
 * records and tests/flare.mjs flies the real integrator against. A bounce
 * keeps 0.42 of the speed it lands with, so 0.18 of the height it fell
 * from, and can never climb past the arc it came down from.
 *
 * The draws are the same eleven per spark in the same order as before,
 * so a seeded shower (sparks.mjs seeds Math.random) is the same shower
 * scaled, and before and after can be compared spark for spark.
 */
export const SPARK = {
  colorA: 0xffd08a,
  colorB: 0xff5a12,
  opacity: 0.34,
  size: [0.085, 0.145] as const,
  life: [0.35, 0.85] as const,
  spawnY: [0.2, 0.42] as const,
  up: [0.4, 2.2] as const,
  /** What the engine integrates them with. */
  motion: { gravity: 17, drag: 0.7, bounce: 0.42, groundY: 0.03 },
  /** The highest a spark can be: the top of its spawn plus the climb of
   *  its fastest throw with no drag at all. */
  ceiling: 0.42 + (2.2 * 2.2) / (2 * 17),
} as const;

/** One spark's birth: position, velocity, life and size. */
export interface SparkBirth {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
}

/**
 * A shower off one flank. `side` is which flank made contact (-1 left,
 * +1 right, 0 centre/rear), `intensity` the hit's severity; (px, pz) is
 * the car and (tx, tz) the road's unit tangent there. `rnd` is
 * Math.random in the game and a seeded stream in the tests.
 */
export function sparkShower(
  rnd: () => number,
  px: number,
  pz: number,
  tx: number,
  tz: number,
  side: number,
  intensity: number,
  emit: (s: SparkBirth) => void
): void {
  const sx = -tz;
  const sz = tx;
  const n = Math.round(26 + 34 * intensity);
  const [y0, y1] = SPARK.spawnY;
  const [u0, u1] = SPARK.up;
  const [l0, l1] = SPARK.life;
  const [s0, s1] = SPARK.size;
  for (let i = 0; i < n; i++) {
    const along = -0.6 + rnd() * 1.2;
    const lat = side * (0.95 + rnd() * 0.15);
    const back = -(5 + rnd() * 12) * (0.6 + intensity * 0.6);
    // Argument order is draw order, and it is the order the engine's
    // spawn call always drew in: y, vx (two), vy, vz (two), life, size.
    const y = y0 + rnd() * (y1 - y0);
    const vx = tx * back + sx * side * (1 + rnd() * 4) + (rnd() - 0.5) * 3;
    const vy = u0 + rnd() * (u1 - u0);
    const vz = tz * back + sz * side * (1 + rnd() * 4) + (rnd() - 0.5) * 3;
    const life = l0 + rnd() * (l1 - l0);
    const size = s0 + rnd() * (s1 - s0);
    emit({ x: px + sx * lat + tx * along, y, z: pz + sz * lat + tz * along, vx, vy, vz, life, size });
  }
}
