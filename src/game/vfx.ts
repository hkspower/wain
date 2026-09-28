import * as THREE from "three";
import { makeRng } from "./rand";

// Particles, done properly.
//
// THREE.PointsMaterial has one size and one opacity for the whole pool,
// so every puff of a drift is born and dies at the same instant, the
// same size, facing the same way. That reads as a flickering sheet
// rather than smoke. This module gives each particle its own age, life,
// size and seed, and does the work a particle shader should:
//
//   • alpha fades in fast and out slowly over that particle's own life
//   • size grows with age (smoke expands; sparks do not)
//   • the sprite spins by a per-particle seed, so no two are identical
//   • colour ramps across life — sparks go white-hot → orange → ember
//
// Positions are still integrated on the CPU. At a couple of hundred
// particles that costs nothing, and it keeps collision (sparks bouncing
// off the asphalt) in ordinary readable code.
//
// Smoke and sand take a second path through the same class (the `smoke`
// option below). Sparks and flame are LIGHT: they are drawn additively
// and a flat colour ramp is the right model for them. Smoke is a MEDIUM:
// it has no colour of its own, only an albedo, and what it looks like is
// whatever light is reaching it — the moon and the sky, the street lamp
// overhead, the car's own tail lamps behind it, a headlight swung
// through it in a spin. Drawn as a flat 0xc4c9d2 it was the one thing in
// the night frame lit by nothing, and it glowed like a fog lamp between
// columns where the asphalt under it was black. The smoke path lights
// each puff from the rig's own numbers, thins it by Beer-Lambert as it
// spreads, sizes it in metres rather than in lens-dependent pixels, and
// draws the pool back to front. Sparks and flame never see any of it:
// they compile today's shader, byte for byte.

/** Soft radial sprite. `core` is how much of the disc stays at full
 *  brightness before the falloff starts. */
export function radialSprite(core = 0.12, gamma = 1): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = (x - 31.5) / 31.5;
      const dy = (y - 31.5) / 31.5;
      const d = Math.hypot(dx, dy);
      // Smoothstep rather than a linear ramp: a linear falloff still has
      // slope where it reaches zero, and that shows up as a visible rim
      // on every sprite once a few of them overlap.
      const t = d <= core ? 1 : Math.max(0, 1 - (d - core) / (1 - core));
      const a = Math.pow(t * t * (3 - 2 * t), gamma);
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The billow atlas's side, in texels, and one cell's: a 2 x 2 atlas of
 *  128-texel cells. 128 because a puff is rarely more than a few hundred
 *  pixels across and the mip chain covers the rest; four cells because,
 *  with the rotation and mirroring the shader gives each slot, four
 *  shapes turned any way are already more puffs than a plume shows at
 *  once. */
const BILLOW_SIDE = 256;
const BILLOW_CELL = 128;

/**
 * The density of four billows, as the alpha bytes billowAtlas() uploads:
 * BILLOW_SIDE² of them, row by row from the top of the canvas.
 *
 * Exported so it can be measured without a canvas — a node check can
 * read exactly what the page will draw.
 *
 * WHY NOT radialSprite. That sprite is radially symmetric, so every puff
 * was the same cotton ball and the `spin` uniform had no visible effect
 * at any value (the note that used to sit in tests/vfx.mjs says exactly
 * this). Tyre smoke is cauliflower: overlapping round lobes with a
 * torn, grainy edge. So each cell is built from lobes, and noise.
 *
 * Coordinates below are in half-widths from the cell's centre, so the
 * cell's edge is at 1.
 *
 *   lobes     seven, each centred within 0.28 of the middle, each 0.32 to
 *             0.52 across the radius, shaped (1 - (d/r)²)² — round-
 *             shouldered with no slope at its rim, which is what stops a
 *             lobe edge showing as a ring. They combine as overlapping
 *             veils, 1 - Π(1 - 0.6·lobe), so where two overlap the cloud
 *             is denser without ever passing 1.
 *   grain     two octaves of value noise, 8 and 16 lattice cells across
 *             the cell, weighted 0.65 and 0.35, applied as a 0.62..1
 *             multiplier — enough to break the lobes' smoothness, not so
 *             much that a puff reads as a sponge.
 *   envelope  1 - smoothstep(0.62, 0.92, r). The furthest lobe reaches
 *             0.28 + 0.52 = 0.80 anyway; the envelope makes the zero
 *             exact from 0.92 outward, so every cell has a gutter of at
 *             least 64 x 0.08 = 5 texels of nothing before its neighbour
 *             begins. The shader clamps its lookups to the cell, and the
 *             gutter is why bilinear filtering at that clamp reads 0 and
 *             not the next billow.
 *
 * Each cell is normalised to a peak of 1 and raised to 1.2, which pulls
 * the thin skirt down a little so the lobes read before the haze does.
 * Seeded (0x534d4b31, "SMK1"), so it is the same four billows every load.
 */
export function billowAlpha(): Uint8ClampedArray {
  const S = BILLOW_SIDE;
  const C = BILLOW_CELL;
  const H = C / 2;
  const rng = makeRng(0x534d4b31);
  const out = new Uint8ClampedArray(S * S);
  const den = new Float32Array(C * C);
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // A value-noise lattice of n x n cells: (n + 1)² random corners, read
  // back with smoothstep weights so the grain has no creases along the
  // lattice lines.
  const lattice = (n: number) => {
    const v = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i < v.length; i++) v[i] = rng();
    return (fx: number, fy: number) => {
      const x = fx * n;
      const y = fy * n;
      const ix = Math.min(n - 1, Math.floor(x));
      const iy = Math.min(n - 1, Math.floor(y));
      const tx = smooth(0, 1, x - ix);
      const ty = smooth(0, 1, y - iy);
      const a = v[iy * (n + 1) + ix];
      const b = v[iy * (n + 1) + ix + 1];
      const c = v[(iy + 1) * (n + 1) + ix];
      const d = v[(iy + 1) * (n + 1) + ix + 1];
      return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    };
  };
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * C;
    const oy = Math.floor(cell / 2) * C;
    const lx: number[] = [];
    const ly: number[] = [];
    const lr: number[] = [];
    for (let k = 0; k < 7; k++) {
      // sqrt spreads the centres evenly over the 0.28 disc instead of
      // bunching them at the middle.
      const ang = rng() * Math.PI * 2;
      const off = Math.sqrt(rng()) * 0.28;
      lx.push(Math.cos(ang) * off);
      ly.push(Math.sin(ang) * off);
      lr.push(0.32 + rng() * 0.2);
    }
    const coarse = lattice(8);
    const fine = lattice(16);
    let peak = 0;
    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const u = (x + 0.5 - H) / H;
        const v = (y + 0.5 - H) / H;
        let clear = 1;
        for (let k = 0; k < 7; k++) {
          const d = Math.hypot(u - lx[k], v - ly[k]);
          if (d >= lr[k]) continue;
          const q = 1 - (d / lr[k]) ** 2;
          clear *= 1 - 0.6 * q * q;
        }
        const fx = (x + 0.5) / C;
        const fy = (y + 0.5) / C;
        const grain = 0.65 * coarse(fx, fy) + 0.35 * fine(fx, fy);
        const r = Math.hypot(u, v);
        const d = (1 - clear) * (0.62 + 0.38 * grain) * (1 - smooth(0.62, 0.92, r));
        den[y * C + x] = d;
        if (d > peak) peak = d;
      }
    }
    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const d = peak > 0 ? den[y * C + x] / peak : 0;
        out[(oy + y) * S + ox + x] = Math.round(255 * Math.pow(d, 1.2));
      }
    }
  }
  return out;
}

/** Built once: every smoke and sand pool, in the race and on the menu,
 *  shares one upload. */
let billowCache: THREE.CanvasTexture | null = null;

/**
 * The smoke sprite: billowAlpha() as a white texture, in a 2 x 2 atlas
 * the shader picks a cell of per particle. Only alpha is read — it is a
 * density, not a colour — and SRGBColorSpace (as radialSprite has) leaves
 * alpha alone. Default mipmaps: 256 is a power of two, and a far puff is
 * a handful of pixels.
 */
export function billowAtlas(): THREE.CanvasTexture {
  if (billowCache) return billowCache;
  const alpha = billowAlpha();
  const c = document.createElement("canvas");
  c.width = c.height = BILLOW_SIDE;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(BILLOW_SIDE, BILLOW_SIDE);
  for (let i = 0; i < alpha.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = alpha[i];
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  billowCache = tex;
  return tex;
}

/**
 * The light a smoke pool is drawn in: uniform objects, one set per
 * scene, that the owner writes once a frame.
 *
 * The material spreads these objects into its uniforms BY REFERENCE —
 * ShaderMaterial keeps the {value} objects it is given rather than
 * cloning them — so one write feeds every pool that shares the bag (the
 * race's tyre smoke and its sand both do). All colours are linear, in
 * the renderer's working space; every default is dark or absent, so a
 * pool with nothing written lights only by its fill.
 */
export interface SmokeLight {
  /** The key — moon or sun — as colour x intensity x the sky share. */
  uKey: { value: THREE.Color };
  /** Unit vector TOWARD the key. */
  uKeyDir: { value: THREE.Vector3 };
  /** Everything else from above, direction averaged away. */
  uFill: { value: THREE.Color };
  /** Four street lamps: xyz is the lens, w its weight. w = 0 is off. */
  uLamp: { value: THREE.Vector4[] };
  uLampCol: { value: THREE.Color };
  /** The tail lamps: xyz between them, w how hard they are lit. */
  uTail: { value: THREE.Vector4 };
  /** The way the car's back faces — the lamps light only what is behind. */
  uTailBack: { value: THREE.Vector3 };
  uTailCol: { value: THREE.Color };
  /** The headlights: between the lamps, their aim, their colour x power,
   *  and the cosines of the cone's edge and of its full-strength core. */
  uHead: { value: THREE.Vector3 };
  uHeadDir: { value: THREE.Vector3 };
  uHeadCol: { value: THREE.Color };
  uHeadCos: { value: THREE.Vector2 };
}

/** A fresh, dark SmokeLight. The fill's 0.2 grey is a neutral stand-in
 *  so a pool built and never lit is visible rather than black. */
export function smokeLight(): SmokeLight {
  return {
    uKey: { value: new THREE.Color(0, 0, 0) },
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uFill: { value: new THREE.Color(0.2, 0.2, 0.2) },
    // Parked a kilometre under the road with no weight: nothing above a
    // puff, so the downlight term below is zero twice over.
    uLamp: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -1000, 0, 0)) },
    // The street lanterns' own emissive (world.ts, the lens material), so
    // a puff under a column is the colour the column's pool is.
    uLampCol: { value: new THREE.Color(0xdfeaff) },
    uTail: { value: new THREE.Vector4(0, -1000, 0, 0) },
    uTailBack: { value: new THREE.Vector3(0, 0, -1) },
    // Pure red with a trace of green and blue: TAIL.lensColor is 0xff0000
    // (cars.ts) and the core behind it is 0xff1a05, which linearises to
    // about this. Linear values, written as such.
    uTailCol: { value: new THREE.Color(1.0, 0.03, 0.01) },
    uHead: { value: new THREE.Vector3(0, -1000, 0) },
    uHeadDir: { value: new THREE.Vector3(0, 0, 1) },
    uHeadCol: { value: new THREE.Color(0, 0, 0) },
    uHeadCos: { value: new THREE.Vector2(0.95, 0.97) },
  };
}

/** What makes a ParticleSystem a smoke pool rather than a light. */
export interface SmokeOptions {
  light: SmokeLight;
  /** Optical depth through a puff's densest texel at birth. Opacity is
   *  1 - exp(-tau · density / g²), g the growth so far. */
  tau: number;
  /** Metres from the camera to the puff's near surface over which it
   *  fades in: gone at [0], whole at [1]. */
  nearFade: [number, number];
  /** Metres above the road over which a puff fades in from the asphalt. */
  groundSoft: number;
  /** Fraction of the half-frame over which a puff whose centre nears the
   *  frame edge fades out. Default 0.12. */
  edgeFade?: number;
}

export interface ParticleOptions {
  map: THREE.Texture;
  /** Colour at birth and at death — the ramp across each life. */
  colorA: THREE.ColorRepresentation;
  colorB: THREE.ColorRepresentation;
  blending?: THREE.Blending;
  /** Size multiplier at the end of life (1 = no growth). */
  grow?: number;
  /** Sprite spin in turns per life. 0 keeps them still. */
  spin?: number;
  opacity?: number;
  /** Fraction of life spent fading in. */
  fadeIn?: number;
  /** Where each slot's seed comes from — rotation, mirroring and atlas
   *  cell in the smoke path. Default Math.random; pass a seeded one where
   *  a capture must be the same capture twice (the menu does). */
  seeds?: () => number;
  /** Draw as a lit medium instead of a light. See SmokeOptions. Absent,
   *  the pool is exactly what it always was. */
  smoke?: SmokeOptions;
}

/** The shader every light-type pool — sparks, flame — has always used.
 *  Kept as its own strings, untouched, so those pools compile the same
 *  program they always did; the smoke shader is a different program,
 *  not a branch inside this one. */
const LIGHT_VERT = /* glsl */ `
        attribute float aAge;
        attribute float aLife;
        attribute float aSize;
        attribute float aSeed;
        uniform float uGrow;
        uniform float uScale;
        varying float vT;
        varying float vSeed;
        void main() {
          vT = aLife > 0.0 ? clamp(aAge / aLife, 0.0, 1.0) : 2.0;
          vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (1.0 + uGrow * vT) * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `;
const LIGHT_FRAG = /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uSpin;
        uniform float uOpacity;
        uniform float uFadeIn;
        varying float vT;
        varying float vSeed;
        void main() {
          if (vT >= 1.0) discard;
          vec2 uv = gl_PointCoord - 0.5;
          float ang = uSpin * 6.2831853 * (vSeed + vT);
          float c = cos(ang), s = sin(ang);
          uv = mat2(c, -s, s, c) * uv + 0.5;
          vec4 tex = texture2D(uMap, uv);
          // Fade in over the first slice of life, then out to nothing
          float a = smoothstep(0.0, uFadeIn, vT) * (1.0 - vT) * (1.0 - vT);
          vec3 col = mix(uColorA, uColorB, vT);
          gl_FragColor = vec4(col, tex.a * a * uOpacity);
          if (gl_FragColor.a < 0.01) discard;
        }
      `;

/**
 * The smoke pool's vertex shader. A point sprite is ONE vertex, so
 * everything that is the same across a puff — its size, its fades, its
 * rotation, and all of its lighting — is worked out here once rather than
 * at every one of its pixels. The fragment shader is left one texture
 * fetch and one exp.
 *
 * SIZE IN METRES. aSize is the puff's diameter at birth; g = 1 + uGrow·t
 * is how far it has spread. The old size was aSize · uScale / depth with
 * uScale = 0.42 × buffer height, which is a size in pixels per metre of
 * depth whatever the lens: the same puff was the same pixels under every
 * lens and so a different size in the world under each — a fifth smaller
 * at 52° than at 62°, and growing as the chase widens its field with
 * speed — and the fades below could not know its radius. Since
 * projectionMatrix[1][1] is 1 / tan(fov/2), D · P11 · H / (2·depth) is
 * exactly the pixels a sphere of diameter D covers at that depth,
 * whatever the lens.
 *
 * FADES, multiplied into one alpha (vA):
 *   life     in over uFadeIn of the life, out over the last 30% — the
 *            thinning below does most of the fading, this closes it.
 *   near     by the distance from the camera to the puff's NEAR surface
 *            (depth - R): a puff the camera is about to pass through
 *            dissolves instead of filling the screen, and nothing pops
 *            at the 0.6 m near plane.
 *   cap      a puff bigger than half of uCapPx fades out by uCapPx, so a
 *            tier sets its own fill ceiling. The hardware's own limit
 *            (uHwPx) only clamps, as it always has — a GPU with a small
 *            point limit gets smaller sprites, never vanishing ones.
 *   edge     a point sprite is clipped by its CENTRE on Metal and some GL
 *            drivers, so one leaving the frame vanishes in a frame. The
 *            last uEdgeW of the half-frame fades it first.
 *
 * LIGHT, split three ways so the fragment shader can shade across the
 * sprite: vTop comes from above (key, lamps) and is shaded brighter at
 * the puff's top, vSide from around it (fill, tail lamps, headlights),
 * vRim is the forward-scatter excess that shows as a silver lining when
 * a puff is between the camera and a light.
 *
 * pr() is a Henyey-Greenstein-shaped phase, scaled so side-on (c = 0) is
 * exactly 1 and capped at 3: smoke throws light mostly onward, so a puff
 * seen against a lamp is brighter than one seen with the lamp behind the
 * camera (0.46 at g = 0.4). The cap stops a puff directly in front of a
 * source going white — uncapped it would be 5.8 at g = 0.4.
 *
 * Street lamps are downlights: inverse square, times the cosine off
 * straight down, normalised so a puff 0.8 m off the road directly under
 * a lens gets exactly w — the height is taken from the lamp's own y, so
 * it follows the lanterns wherever world.ts hangs them (lens undersides
 * at 12.0 m, so 11.2 m over a puff). Walked down the road through the
 * pool's centre, 1.2 m inboard of the lens, the profile is 0.48 of its
 * value there at 8.96 m, where the painted pool's 40% contour is and the
 * pool is at 0.54 of its centre, and 0.18 at 16.3 m, where the pool is at
 * 0.20: the smoke brightens where the road under it does. Across the
 * road it is wider than the pool — the pool is an ellipse and this is
 * round — which matters only off the carriageway. The optic's aim, 5.7°
 * in toward the road, is not modelled: it moves the peak 1.2 m and the
 * value under the lens by under 2%.
 */
const SMOKE_VERT = /* glsl */ `
        attribute float aAge;
        attribute float aLife;
        attribute float aSize;
        attribute float aSeed;
        uniform float uGrow;
        uniform float uSpin;
        uniform float uFadeIn;
        uniform float uOpacity;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uBufH;
        uniform float uTau;
        uniform vec2 uNear;
        uniform float uGroundSoft;
        uniform float uEdgeW;
        uniform float uCapPx;
        uniform float uHwPx;
        uniform vec3 uKey;
        uniform vec3 uKeyDir;
        uniform vec3 uFill;
        uniform vec4 uLamp[4];
        uniform vec3 uLampCol;
        uniform vec4 uTail;
        uniform vec3 uTailBack;
        uniform vec3 uTailCol;
        uniform vec3 uHead;
        uniform vec3 uHeadDir;
        uniform vec3 uHeadCol;
        uniform vec2 uHeadCos;
        varying vec4 vRot;
        varying vec2 vCell;
        varying vec3 vAlb;
        varying vec3 vTop;
        varying vec3 vSide;
        varying vec3 vRim;
        varying float vA;
        varying float vTauG;
        varying vec2 vGround;
        float pr(float c, float g) {
          float g2 = g * g;
          return min(3.0, pow((1.0 + g2) / (1.0 + g2 - 2.0 * g * c), 1.5));
        }
        void main() {
          float t = aLife > 0.0 ? clamp(aAge / aLife, 0.0, 1.0) : 1.0;
          vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          vec4 clip = projectionMatrix * mv;
          float depth = -mv.z;
          float g = 1.0 + uGrow * t;
          float R = 0.5 * aSize * g;
          float px = aSize * g * 0.5 * uBufH * projectionMatrix[1][1] / max(0.1, depth);
          vec2 ndc = clip.xy / max(clip.w, 1e-3);
          vA = uOpacity
            * smoothstep(0.0, uFadeIn, t) * (1.0 - smoothstep(0.7, 1.0, t))
            * smoothstep(uNear.x, uNear.y, depth - R)
            * clamp((uCapPx - px) / (0.5 * uCapPx), 0.0, 1.0)
            * clamp((1.0 - max(abs(ndc.x), abs(ndc.y))) / uEdgeW, 0.0, 1.0);
          // Beer-Lambert over a puff that has spread g times across: the
          // same smoke over g² the area is g² as thin.
          vTauG = uTau / (g * g);
          // World height of the sprite's centre and its radius, in units
          // of the ground fade, so the fragment can find its own height.
          vGround = vec2(wp.y, R) / uGroundSoft;

          // A seeded start angle, turning either way by uSpin turns over
          // the life, mirrored for half the slots, one of four cells.
          float ang = 6.2831853 * (fract(aSeed * 7.13) + uSpin * t * (aSeed < 0.5 ? -1.0 : 1.0));
          float mir = fract(aSeed * 13.7) > 0.5 ? -1.0 : 1.0;
          float ca = cos(ang);
          float sa = sin(ang);
          vRot = vec4(ca * mir, -sa, sa * mir, ca);
          float cell = floor(fract(aSeed * 3.71) * 4.0);
          vCell = vec2(mod(cell, 2.0), floor(cell / 2.0)) * 0.5;
          vAlb = mix(uColorA, uColorB, t);

          vec3 V = normalize(cameraPosition - wp);
          float k = pr(dot(-uKeyDir, V), 0.4);
          vec3 top = uKey * k;
          vec3 rim = uKey * max(0.0, k - 1.0);
          for (int i = 0; i < 4; i++) {
            vec3 L = wp - uLamp[i].xyz;
            float d2 = max(dot(L, L), 1.0);
            float id = inversesqrt(d2);
            float h0 = uLamp[i].y - 0.8;
            float f = uLamp[i].w * (h0 * h0 / d2) * max(0.0, -L.y) * id;
            float kl = pr(dot(L * id, V), 0.4);
            top += uLampCol * f * kl;
            rim += uLampCol * f * max(0.0, kl - 1.0);
          }
          // Tail lamps: a 1.2 m falloff, and only behind the car.
          vec3 T = wp - uTail.xyz;
          float dT = length(T) + 1e-4;
          vec3 Tn = T / dT;
          float fT = uTail.w / (1.0 + dT * dT / 1.44) * smoothstep(-0.3, 0.5, dot(Tn, uTailBack));
          // Headlights: inside the cone only, softened across its edge.
          vec3 Hd = wp - uHead;
          float dH = length(Hd) + 1e-4;
          vec3 Hn = Hd / dH;
          float cone = smoothstep(uHeadCos.x, uHeadCos.y, dot(Hn, uHeadDir));
          vec3 side = uFill
            + uTailCol * fT * pr(dot(Tn, V), 0.5)
            + uHeadCol * cone / max(1.0, pow(dH, 1.4)) * pr(dot(Hn, V), 0.5);
          vTop = min(top, vec3(2.0));
          vSide = min(side, vec3(2.0));
          vRim = min(rim * 0.4, vec3(1.0));

          bool dead = t >= 1.0 || vA < 0.004;
          gl_Position = dead ? vec4(2.0, 2.0, 2.0, 1.0) : clip;
          gl_PointSize = dead ? 0.0 : min(px, uHwPx);
        }
      `;

/**
 * The smoke pool's fragment shader.
 *
 * The sprite is turned and mirrored by vRot and read from its own atlas
 * cell, clamped inside that cell so the corners of a turned sprite read
 * the cell's empty gutter and never the next billow.
 *
 * Opacity is Beer-Lambert: 1 - exp(-tau·density/g²). A dense young puff
 * is solid; as it spreads it thins in proportion to the area it now
 * covers, so the smoke keeps its mass instead of the old (1 - t)² simply
 * turning it off — that left a quarter of the alpha at mid-life, and a
 * drift left no cloud behind it.
 *
 * The ground fade takes the fragment's world height from the sprite's
 * centre and radius (the sprite faces the camera, and the chase camera is
 * nearly level), so a puff meets the asphalt softly instead of being cut
 * by it in a hard line.
 *
 * Shading: the light from above is stronger at the top of the sprite,
 * and the core is darkened a little by its own density — the cheap half
 * of self-shadowing. The rim shows only where the puff is thin.
 */
const SMOKE_FRAG = /* glsl */ `
        uniform sampler2D uMap;
        varying vec4 vRot;
        varying vec2 vCell;
        varying vec3 vAlb;
        varying vec3 vTop;
        varying vec3 vSide;
        varying vec3 vRim;
        varying float vA;
        varying float vTauG;
        varying vec2 vGround;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          vec2 uv = clamp(vec2(dot(vRot.xy, p), dot(vRot.zw, p)) + 0.5, 0.0, 1.0) * 0.5 + vCell;
          float dens = texture2D(uMap, uv).a;
          float a = vA * (1.0 - exp(-vTauG * dens))
            * clamp(vGround.x + vGround.y * (1.0 - 2.0 * gl_PointCoord.y), 0.0, 1.0);
          if (a < 0.004) discard;
          float top = 1.0 - gl_PointCoord.y;
          vec3 light = (vSide + vTop * (0.55 + 0.8 * top)) * (1.0 - 0.3 * dens) + vRim * (1.0 - dens);
          gl_FragColor = vec4(vAlb * light, a);
        }
      `;

export class ParticleSystem {
  readonly points: THREE.Points;
  private pos: THREE.BufferAttribute;
  private age: THREE.BufferAttribute;
  private life: THREE.BufferAttribute;
  private size: THREE.BufferAttribute;
  private vel: Float32Array;
  private head = 0;
  private readonly count: number;
  /**
   * Smoke only: the draw order. The index buffer's own array IS the
   * order — slots, far to near — and the draw range is how many of them
   * are alive, so sorting moves 16-bit slot numbers and never a
   * particle's data. Null for the light pools, which are additive and so
   * the same in any order.
   */
  private index: THREE.BufferAttribute | null = null;
  /** How many slots the index currently lists. */
  private drawn = 0;
  /** 1 for each slot the index lists, so a newly lit slot is found
   *  without searching the list for it. */
  private listed: Uint8Array | null = null;
  /** Squared distance from the eye, per slot, for the sort. */
  private keys: Float64Array | null = null;

  constructor(count: number, o: ParticleOptions) {
    this.count = count;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3).fill(-99999);
    this.pos = new THREE.BufferAttribute(positions, 3);
    this.age = new THREE.BufferAttribute(new Float32Array(count), 1);
    this.life = new THREE.BufferAttribute(new Float32Array(count), 1);
    this.size = new THREE.BufferAttribute(new Float32Array(count), 1);
    const seed = new Float32Array(count);
    const seeds = o.seeds ?? Math.random;
    for (let i = 0; i < count; i++) seed[i] = seeds();
    geo.setAttribute("position", this.pos);
    geo.setAttribute("aAge", this.age);
    geo.setAttribute("aLife", this.life);
    geo.setAttribute("aSize", this.size);
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.vel = new Float32Array(count * 3);

    const uniforms: Record<string, THREE.IUniform> = {
      uMap: { value: o.map },
      uColorA: { value: new THREE.Color(o.colorA) },
      uColorB: { value: new THREE.Color(o.colorB) },
      uGrow: { value: (o.grow ?? 1) - 1 },
      uSpin: { value: o.spin ?? 0 },
      uOpacity: { value: o.opacity ?? 1 },
      uFadeIn: { value: o.fadeIn ?? 0.12 },
      // Point size is in pixels, so it has to scale with the drawing
      // buffer or particles shrink on a 4K panel.
      uScale: { value: 300 },
    };
    const sm = o.smoke;
    if (sm) {
      Object.assign(uniforms, sm.light, {
        // The drawing buffer's height in pixels, for sizes in metres. 720
        // until setPixelScale is told the real one.
        uBufH: { value: 720 },
        uTau: { value: sm.tau },
        uNear: { value: new THREE.Vector2(sm.nearFade[0], sm.nearFade[1]) },
        uGroundSoft: { value: sm.groundSoft },
        uEdgeW: { value: sm.edgeFade ?? 0.12 },
        // No tier cap and no hardware clamp until setPointLimits says so.
        uCapPx: { value: 1e6 },
        uHwPx: { value: 1024 },
      });
      // Listed, not drawn, until update() finds something alive.
      this.index = new THREE.BufferAttribute(new Uint16Array(count), 1).setUsage(
        THREE.DynamicDrawUsage
      );
      geo.setIndex(this.index);
      geo.setDrawRange(0, 0);
      this.listed = new Uint8Array(count);
      this.keys = new Float64Array(count);
    }

    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: sm ? SMOKE_VERT : LIGHT_VERT,
      fragmentShader: sm ? SMOKE_FRAG : LIGHT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: o.blending ?? THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  get material(): THREE.ShaderMaterial {
    return this.points.material as THREE.ShaderMaterial;
  }

  /** Point size is expressed in pixels; without this a particle is half
   *  the apparent size on a display with twice the pixel ratio. A smoke
   *  pool sizes in metres and needs only the buffer's height. */
  setPixelScale(drawingBufferHeight: number): void {
    const u = this.material.uniforms;
    u.uScale.value = drawingBufferHeight * 0.42;
    if (u.uBufH) u.uBufH.value = drawingBufferHeight;
  }

  /**
   * Smoke only: the largest a puff may be drawn, in pixels. `capPx` is
   * the tier's fill ceiling — a puff fades out as it grows from half of
   * it to all of it. `hwPx` is the GPU's ALIASED_POINT_SIZE_RANGE limit,
   * a plain clamp as it always was. A no-op on a light pool.
   */
  setPointLimits(capPx: number, hwPx: number): void {
    const u = this.material.uniforms;
    if (u.uCapPx) u.uCapPx.value = capPx;
    if (u.uHwPx) u.uHwPx.value = hwPx;
  }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size: number
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.count;
    this.pos.setXYZ(i, x, y, z);
    this.age.setX(i, 0);
    this.life.setX(i, life);
    this.size.setX(i, size);
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
  }

  /**
   * Integrate. `bounce` reflects a particle off the road surface with
   * that much energy kept — sparks skittering along the asphalt are
   * most of what sells a wall scrape.
   *
   * `groundY` given with no bounce is a floor: a particle reaching it
   * stops there, falling speed gone and sliding speed cut by the same
   * 0.7 a bounce takes. Sand is the case — it used to fall straight
   * through the road, ending about 7 cm under it (0.06 m up, 0.9 m/s
   * up, drag 1.5 and gravity 1.1 reach y = -0.066 at 1.5 s). Without
   * `groundY` nothing is clamped, as before: smoke and flame rise.
   *
   * `wind` is the air's own horizontal velocity, m/s. Drag relaxes a
   * particle toward it rather than toward rest, so smoke that has shed
   * its throw drifts off down the breeze instead of hanging frozen where
   * it stopped. Absent it is zero, and v·damp is what it always was.
   */
  update(
    dt: number,
    opts: {
      gravity?: number;
      drag?: number;
      bounce?: number;
      groundY?: number;
      wind?: { x: number; z: number };
    } = {}
  ): void {
    const gravity = opts.gravity ?? 0;
    const drag = opts.drag ?? 0;
    const bounce = opts.bounce ?? 0;
    const groundY = opts.groundY ?? 0.02;
    const floor = bounce > 0 || opts.groundY !== undefined;
    const wx = opts.wind?.x ?? 0;
    const wz = opts.wind?.z ?? 0;
    let any = false;
    const damp = Math.max(0, 1 - drag * dt);
    for (let i = 0; i < this.count; i++) {
      const life = this.life.getX(i);
      if (life <= 0) continue;
      const age = this.age.getX(i) + dt;
      if (age >= life) {
        this.life.setX(i, 0);
        this.pos.setXYZ(i, -99999, -99999, -99999);
        continue;
      }
      this.age.setX(i, age);
      const b = i * 3;
      this.vel[b] = wx + (this.vel[b] - wx) * damp;
      this.vel[b + 1] = this.vel[b + 1] * damp - gravity * dt;
      this.vel[b + 2] = wz + (this.vel[b + 2] - wz) * damp;
      let x = this.pos.getX(i) + this.vel[b] * dt;
      let y = this.pos.getY(i) + this.vel[b + 1] * dt;
      let z = this.pos.getZ(i) + this.vel[b + 2] * dt;
      if (floor && y < groundY && this.vel[b + 1] < 0) {
        y = groundY;
        this.vel[b + 1] = -this.vel[b + 1] * bounce;
        this.vel[b] *= 0.7;
        this.vel[b + 2] *= 0.7;
      }
      this.pos.setXYZ(i, x, y, z);
      any = true;
    }
    this.pos.needsUpdate = true;
    this.age.needsUpdate = true;
    this.life.needsUpdate = true;
    this.size.needsUpdate = true;
    this.points.visible = any;
    if (this.index) this.relist();
  }

  /**
   * Bring the draw list up to date with who is alive: survivors keep the
   * order the last sort left them in — so the next sort starts nearly
   * sorted and costs a pass, not a shuffle — and slots lit since are
   * added at the end. Correct to draw on its own; sortFrom() orders it.
   */
  private relist(): void {
    const index = this.index!;
    const order = index.array as Uint16Array;
    const listed = this.listed!;
    let n = 0;
    for (let j = 0; j < this.drawn; j++) {
      const i = order[j];
      if (this.life.getX(i) > 0) order[n++] = i;
      else listed[i] = 0;
    }
    for (let i = 0; i < this.count; i++) {
      if (!listed[i] && this.life.getX(i) > 0) {
        listed[i] = 1;
        order[n++] = i;
      }
    }
    this.drawn = n;
    this.points.geometry.setDrawRange(0, n);
    index.needsUpdate = true;
  }

  /**
   * Smoke only: order the pool far to near from `eye`, so each puff is
   * blended over the ones behind it.
   *
   * The light pools do not need this — addition is the same in any
   * order. Smoke does, now that each puff is lit differently: over-
   * blending a bright puff under a lamp and a dark one between lamps
   * gives a different colour depending on which went first. Nor could
   * three.js do it: it sorts whole objects, by the geometry's bounding
   * sphere, and this pool's sphere is computed once and is dominated by
   * the dead slots parked at -99999.
   *
   * An insertion sort over at most a couple of hundred slots, on a list
   * relist() left in last frame's order, so it is one comparison per puff
   * plus the few that moved. Allocates nothing. Call after update(), once
   * the camera has moved.
   */
  sortFrom(eye: THREE.Vector3): void {
    const index = this.index;
    if (!index) return;
    const order = index.array as Uint16Array;
    const keys = this.keys!;
    const p = this.pos.array as Float32Array;
    const n = this.drawn;
    for (let j = 0; j < n; j++) {
      const i = order[j];
      const dx = p[i * 3] - eye.x;
      const dy = p[i * 3 + 1] - eye.y;
      const dz = p[i * 3 + 2] - eye.z;
      keys[i] = dx * dx + dy * dy + dz * dz;
    }
    for (let j = 1; j < n; j++) {
      const v = order[j];
      const kv = keys[v];
      let k = j - 1;
      while (k >= 0 && keys[order[k]] < kv) {
        order[k + 1] = order[k];
        k--;
      }
      order[k + 1] = v;
    }
    index.needsUpdate = true;
  }

  /**
   * Live particle count — for tests and debug readouts.
   *
   * Counted, not tracked. There used to be a `live` field incremented on
   * spawn and decremented on expiry, and it was wrong in a way that
   * could only ever grow: spawn() is a ring buffer with no free-list, so
   * a full pool OVERWRITES a live particle, and the overwrite bumped the
   * counter without the thing it replaced ever expiring. It was also
   * never read by anything — not by this class, not by the tests, not by
   * the debug readout, all of which use this getter. Three lines and a
   * branch per spawn, spent on a number nobody looked at and that would
   * have lied if they had.
   */
  get alive(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.life.getX(i) > 0) n++;
    return n;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
