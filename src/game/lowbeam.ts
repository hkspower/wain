// The shape of the dipped beam.
//
// A headlamp is not a torch. A torch throws a round cone with a soft
// edge and its brightest light in the middle; point one down a road and
// the road a few metres ahead is blinding while forty metres out there is
// nothing. Until this file the player's lamps were exactly that — two
// round SpotLights aimed 2.9 % down (the axis met the road at 23 m), and
// a painted additive pool on the asphalt whose lobes sat two to six
// metres off the bumper. At night it read as a warm round blob in front
// of the car that stopped short of the first lane arrow.
//
// A real dipped beam is a different object, and every number below is
// one a lamp is built and aimed to:
//
//   aim        1.0-1.5 % down for a lamp under 0.8 m (ECE R48). The
//              cut-off line meets the road at h / 0.012, about 55 m for
//              a 0.66 m lamp — the beam reaches, it does not puddle.
//   cut-off    flat and sharp on the oncoming side, so nobody in the
//              other lane is looking into it. 0.3 deg from 90 % to 10 %
//              for a reflector, half that for a projector lens.
//   step       on the KERB side the line kinks up at 15 degrees and runs
//              about a degree higher: the nearside verge, the signs and
//              the pedestrians are lit further out. Kuwait drives on the
//              right (rig.ts), so the step is on the driver's right.
//   hot zone   just under the cut-off and a couple of degrees right of
//              centre — the ECE 50R / 75R points, which is where the eye
//              is looking at speed.
//   spread     wide and flat: full to about +-10 deg, gone by +-36,
//              wider on the kerb side.
//   foreground deliberately LESS intense the steeper down you look. The
//              road under the bumper is metres away, the hot zone tens of
//              metres; irradiance on asphalt goes as I h / d^(decay+1),
//              so a lamp that put the same candela everywhere would light
//              5 m about fifty times harder than 40 m. The profile below
//              takes most of that back.
//
// It is applied as a projected texture — SpotLight.map, the "cookie" —
// on both lamps. three r184 projects a spot's map with or without a
// shadow (WebGLLights.setup updates the shadow camera for any light with
// a map), through a frustum whose half-angle is the light's angle, so the
// circular cone is inscribed in it and every lit fragment is shaped by
// the cookie. The lamp's axis is aimed AT the cut-off, so cookie pitch 0
// is the cut-off line and the cookie needs nothing but angles.
//
// Pure: no three, no DOM, so tests/lowbeam.mjs reads the same function
// the game bakes from.
import { BULBS, type Bulb } from "./bulbs";

/** Main beam (no cut-off) or dipped. */
export type BeamMode = "low" | "main";

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    for (const v of Object.values(o as object)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
};

export const LOW_BEAM = deepFreeze({
  /** Downward aim of the cut-off, as a fraction (1.2 % = 12 mm per m).
   *  ECE R48: 1.0-1.5 % for a lamp mounted below 0.8 m. */
  aimDrop: 0.012,
  /** Distance to the aim point, m. The lamps' targets sit this far out;
   *  only the ratio matters, but the swivel and main-beam aim are written
   *  in metres at this distance (bulbs.ts HighBeam.aim). */
  aimAt: 42,
  /** The SpotLight's cone half-angle, rad (+-37.8 deg). Wide enough for
   *  the spread; the cookie does every bit of the shaping inside it. */
  envelope: 0.66,
  /** Only softens the circle's rim, which the cookie has already zeroed. */
  penumbra: 0.08,
  /** Off-axis angle, deg, over which the cookie itself fades to nothing
   *  before the cone's rim (37.8 deg). Without it the faint light the
   *  pattern still sends steeply down showed the circle's edge as a crisp
   *  arc on the road a metre or two off the bumper, from anywhere in
   *  front of the car. */
  rim: { from: 29, to: 35 },
  /** Candela-ish, per lamp, before the bulb's own multiplier. Calibrated
   *  against the night grade — see the table in engine.ts at the lamps. */
  candela: 1500,
  /** Physical-ish fall-off. The old rig's 1.4, kept: the night was graded
   *  with it and the beam's reach is set by the cookie now, not by this. */
  decay: 1.4,
  /** Light reaching the eye above the cut-off, as a fraction of the hot
   *  zone. ECE zone III allows ~0.7 lux against 12+ at 50R; a whisper,
   *  so overhead signs and gantries still catch something. */
  stray: 0.006,
  /** Width of the cut-off, deg, 90 % to 10 %. */
  soft: { reflector: 0.3, projector: 0.15 },
  /** Which bulbs sit behind a projector lens (sharper line). */
  projector: { halogen: false, xenon: true, led: true, laser: true } as Record<Bulb, boolean>,
  /** The kerb-side step: the line kinks up at `angle` deg from the
   *  centreline and levels off `rise` deg above the flat cut-off. */
  step: { angle: 15, rise: 1.0 },
  /** The hot zone across, deg: how far right of centre it sits, how wide
   *  it is and how much of the beam it carries. Its depth is the
   *  foreground profile's peak, just under the line. */
  hot: { right: 2, halfX: 7, share: 0.45 },
  /** Lateral spread, deg: full out to `inner`, gone by `outer`. Kerb side
   *  wider. Scaled by the bulb's own angle (a longer throw is a narrower
   *  beam — bulbs.ts). */
  spread: { left: { inner: 10, outer: 34 }, right: { inner: 12, outer: 40 } },
  /**
   * Intensity against depth below the cut-off, deg, log-interpolated.
   * For a 0.54 m lamp aimed 1.2 % down, depth 0.09 deg lands on the road
   * at 40 m, 0.34 at 30 m, 0.86 at 20 m, 2.4 at 10 m, 5.5 at 5 m and 9.5
   * at 3 m. The peak sits in the first half-degree (the 50R/75R band,
   * 30-45 m out) and the rest falls a little faster than the road comes
   * closer, so the lit road is level from 5 m to 20 m — not a blaze at
   * the bumper that is gone by 20. (A third less in the 5-15 m band
   * than the road's geometry alone would give: seen from in front of
   * the car, that band is the one whose polished wheel paths throw the
   * lamps straight back at the camera.) Under about 12 deg it is all but dark: that is the road the
   * bumper and the lamp's own housing hide, and the lamp that casts no
   * shadow (headlightR) would otherwise light it straight through the
   * car's splitter.
   */
  foreground: [
    [0, 0.8],
    [0.3, 1],
    [0.6, 0.95],
    [1.2, 0.42],
    [2, 0.2],
    [3, 0.1],
    [5, 0.035],
    [8, 0.016],
    [12, 0.004],
    [18, 0.0008],
    [26, 0.0001],
    [90, 0.0001],
  ] as [number, number][],
  /** Main beam: no cut-off, centred on its own (raised) axis — a core
   *  down the road and the dipped pattern's spread kept under it. */
  main: { coreX: 5, coreY: 2.2, broad: 0.5, above: 7 },
  /**
   * The road sends a headlamp back toward the lamp. Asphalt is a rough
   * aggregate and the paint carries glass beads, and both are brighter
   * seen from beside the source than from anywhere else — the opposition
   * peak every rough surface has (it is what the road-reflection tables
   * for vehicle lighting are measured at: an eye a degree or two off the
   * lamp's own line). three's diffuse is Lambert, which has none of it,
   * so from the chase camera — 3-5 deg off the lamps' line — a correctly
   * shaped, correctly bright beam read as barely there, while the same
   * road seen from in front glared (that is the GGX specular, which is
   * right). This adds the peak back for the two lamps only (the spots
   * that carry a cookie): `gain` x Lambert at the lamp's own line,
   * falling as cos^power of the angle off it — 0.75 of it at 4 deg,
   * half by 6, nothing from the side or the front.
   */
  retro: { gain: 6, power: 120 },
  /** The cookie's size. 1024 rows over 76 deg is 0.07 deg a row, under
   *  half the projector's line width; the spread is smooth across, so
   *  128 columns. Half a megabyte, uploaded only while the beam blends. */
  cookie: { w: 128, h: 1024 },
});

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Log-linear interpolation through [x, y] pairs (y > 0). */
function profile(pts: readonly (readonly [number, number])[], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x <= x1) {
      const [x0, y0] = pts[i - 1];
      const t = (x - x0) / (x1 - x0);
      return Math.exp(Math.log(y0) + (Math.log(y1) - Math.log(y0)) * t);
    }
  }
  return pts[pts.length - 1][1];
}

/** The cut-off's elevation above the flat line at this yaw, deg (+ = the
 *  driver's right, the kerb side). */
export function cutoffAt(yawDeg: number, spec = LOW_BEAM): number {
  if (yawDeg <= 0) return 0;
  return Math.min(spec.step.rise, yawDeg * Math.tan((spec.step.angle * Math.PI) / 180));
}

/** Lateral weight, 0..1. */
function spreadAt(yawDeg: number, k: number, spec = LOW_BEAM): number {
  const side = yawDeg < 0 ? spec.spread.left : spec.spread.right;
  return 1 - smooth(side.inner * k, side.outer * k, Math.abs(yawDeg));
}

/**
 * The beam's relative intensity in one direction, 0..1 (1 = the hottest
 * point of the dipped beam). `yawDeg` + is the driver's right; `pitchDeg`
 * + is up, both measured from the lamp's axis — which is aimed at the
 * cut-off, so pitch 0 IS the dipped cut-off line (and, on main beam, the
 * axis the main beam's core is centred on). Angles are a test screen's:
 * atan(x / d) across and atan(y / d) up.
 */
export function cookieValue(bulb: Bulb, mode: BeamMode, yawDeg: number, pitchDeg: number, spec = LOW_BEAM): number {
  // Off-axis angle on a screen: the direction (tan yaw, tan pitch, 1).
  const ty = Math.tan((yawDeg * Math.PI) / 180), tp = Math.tan((pitchDeg * Math.PI) / 180);
  const off = (Math.atan(Math.hypot(ty, tp)) * 180) / Math.PI;
  return (1 - smooth(spec.rim.from, spec.rim.to, off)) * shape(bulb, mode, yawDeg, pitchDeg, spec);
}

function shape(bulb: Bulb, mode: BeamMode, yawDeg: number, pitchDeg: number, spec: typeof LOW_BEAM): number {
  const b = BULBS[bulb];
  if (mode === "main") {
    const k = b.high.angle * b.angle;
    const m = spec.main;
    // The dipped pattern's body with its cut-off taken away: the same
    // spread and foreground under the axis, a soft fall-off above it.
    const vert = pitchDeg <= 0
      ? profile(spec.foreground, -pitchDeg)
      : 1 - smooth(0, m.above, pitchDeg);
    const broad = m.broad * spreadAt(yawDeg, k, spec) * vert;
    const core = Math.exp(-((yawDeg / (m.coreX * k)) ** 2) - (pitchDeg / m.coreY) ** 2);
    return Math.min(1, broad + core);
  }
  const k = b.angle;
  const c = cutoffAt(yawDeg, spec);
  const depth = c - pitchDeg; // deg below the local cut-off
  const soft = spec.projector[bulb] ? spec.soft.projector : spec.soft.reflector;
  // smoothstep's 10-90 % span is 0.6 of its width
  const half = soft / 1.2;
  const gate = smooth(-half, half, depth);
  const h = spec.hot;
  const wide = spreadAt(yawDeg, k, spec);
  const across = (1 - h.share) * wide + h.share * Math.exp(-(((yawDeg - h.right) / (h.halfX * k)) ** 2));
  const peak = (1 - h.share) + h.share; // across at its best, x the profile's 1
  // The profile hangs off the FLAT line: under the kerb-side step the
  // beam is as strong as it is just under the cut-off, which is what
  // sends the nearside light further — the step adds reach, it does not
  // push the whole pattern up and dim the road beneath it.
  const v = (profile(spec.foreground, Math.max(0, -pitchDeg)) * across) / peak;
  return Math.min(1, Math.max(spec.stray * wide, v * gate + spec.stray * (1 - gate) * wide));
}

/**
 * Bake a cookie for a SpotLight of half-angle `angle` (rad), as RGBA
 * bytes, row 0 at the BOTTOM (a DataTexture is not flipped) and column 0
 * on the driver's left — the shadow camera looks down the beam with world
 * up, so its +x is the driver's right. A perspective frustum maps a pixel
 * to tan, not to angle: x_ndc = tan(yaw) / tan(angle).
 */
export function bakeCookie(bulb: Bulb, mode: BeamMode, angle = LOW_BEAM.envelope, spec = LOW_BEAM): Uint8Array {
  const { w, h } = spec.cookie;
  const out = new Uint8Array(w * h * 4);
  const t = Math.tan(angle);
  const D = 180 / Math.PI;
  for (let j = 0; j < h; j++) {
    const pitch = Math.atan(((2 * (j + 0.5)) / h - 1) * t) * D;
    for (let i = 0; i < w; i++) {
      const yaw = Math.atan(((2 * (i + 0.5)) / w - 1) * t) * D;
      const v = Math.round(255 * cookieValue(bulb, mode, yaw, pitch, spec));
      const o = (j * w + i) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Height of a lamp's aim point at `aimAt`, in the lamp rig's frame, for
 *  a lamp at `lampY`: the cut-off's drop, plus however far the main beam
 *  has lifted it (`raise`, metres at aimAt — bulbs.ts HighBeam.aim). */
export function lampTargetY(lampY: number, raise = 0, spec = LOW_BEAM): number {
  return lampY - spec.aimDrop * spec.aimAt + raise;
}

/**
 * Patch three's lights_fragment_begin chunk (r184) so the spot lights
 * that project a cookie — the headlamps, and nothing else in the scene
 * has one — add LOW_BEAM.retro's back-scatter to the diffuse. Returns
 * null when the chunk is not the shape this expects, so a three upgrade
 * fails loud in tests/lowbeam.mjs instead of quietly dropping the term.
 * The material sets GRN_RETRO_GAIN and GRN_RETRO_POW.
 */
export function patchHeadlampRetro(chunk: string): string | null {
  const steps: [string, string][] = [
    [
      "\tbool inSpotLightMap;\n",
      "\tbool inSpotLightMap;\n\tfloat grnRetro;\n",
    ],
    [
      "\t\tgetSpotLightInfo( spotLight, geometryPosition, directLight );\n",
      "\t\tgetSpotLightInfo( spotLight, geometryPosition, directLight );\n\t\tgrnRetro = 0.0;\n",
    ],
    [
      "\t\t\tdirectLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;\n",
      "\t\t\tdirectLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;\n" +
        "\t\t\tgrnRetro = inSpotLightMap ? 1.0 : 0.0;\n",
    ],
  ];
  let out = chunk;
  for (const [from, to] of steps) {
    if (out.split(from).length !== 2) return null;
    out = out.replace(from, to);
  }
  // The RE_Direct call inside the spot loop: the first one after the
  // cookie block (point lights come before it, directional after).
  const cookieAt = out.indexOf("grnRetro = inSpotLightMap");
  const call = "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";
  const at = out.indexOf(call, cookieAt);
  if (cookieAt < 0 || at < 0) return null;
  const add =
    call +
    "\n\t\tif ( grnRetro > 0.0 ) {" +
    "\n\t\t\tfloat grnObs = saturate( dot( geometryViewDir, directLight.direction ) );" +
    "\n\t\t\tfloat grnNoL = saturate( dot( geometryNormal, directLight.direction ) );" +
    "\n\t\t\treflectedLight.directDiffuse += GRN_RETRO_GAIN * pow( grnObs, GRN_RETRO_POW ) * grnNoL * directLight.color * BRDF_Lambert( material.diffuseColor );" +
    "\n\t\t}";
  return out.slice(0, at) + add + out.slice(at + call.length);
}
