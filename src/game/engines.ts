/**
 * The five engines.
 *
 * Two fours, two sixes and a V8 — and the cylinder count is not a label
 * on a spec sheet here. It is the thing the car sounds like and the
 * shape of the shove it gives you, because those are the two ways a
 * driver actually meets an engine.
 *
 * WHAT MAKES THEM DIFFERENT
 *
 * A torque curve, not a power number. Every engine below makes the same
 * AREA under its curve — each one is normalised so its mean torque
 * across the usable rev range is exactly 1.0 — so swapping the block
 * does not hand you free performance. What it changes is WHERE that
 * torque lives. The 1.6 has almost nothing until the last third of the
 * tacho and then goes berserk; the 5.7 has everything at once and is
 * finished by the time the little four is waking up. On paper they are
 * worth the same. On the road they are completely different cars, and
 * which one is faster depends entirely on the corner you just left.
 *
 * That normalisation is deliberate and it is tested. An engine swap in
 * a game where every swap is a straight upgrade is a shop, not a
 * choice — you buy the biggest one you can afford and never think about
 * it again. `powerMult` is the small separate knob that says one block
 * is genuinely better than another, and it stays small on purpose.
 *
 * WHAT MAKES THEM SOUND DIFFERENT
 *
 * A four-stroke fires `cylinders / 2` times per crank revolution, so
 * the note you hear is not the engine speed — it is the FIRING rate,
 * and at the same rpm a V8 fires twice as often as a four. That is why
 * the eight sounds an octave up from the four at the same revs, and why
 * it still sounds deeper in practice: it gets there at 6,200 rpm while
 * the little four is at 8,400. Both facts come out of the same formula,
 * which is the whole argument for using the real one.
 *
 * The V8 also lopes. A cross-plane crank fires unevenly WITHIN each
 * bank — two of the eight pulses land on the wrong side of the beat —
 * and the half-order modulation that produces is the entire character
 * of the sound. Nothing else here does it: an inline six is the most
 * naturally balanced layout ever built, and a flat-six with equal
 * headers is smooth too. The lope belongs to one engine only.
 */

export type EngineLayout = "inline" | "flat" | "vee";
export type EngineId = "i4-16" | "i4-20t" | "f6-25" | "i6-30tt" | "v8-57";

export interface EngineSpec {
  id: EngineId;
  name: string;
  ar: string;
  /** 4, 6 or 8. Sets the firing rate and half the personality. */
  cylinders: 4 | 6 | 8;
  layout: EngineLayout;
  litres: number;
  idleRpm: number;
  redlineRpm: number;
  /** Torque curve shape, in rev-range fraction (0 = idle, 1 = redline).
   *  `peakAt` is where it makes the most, `breadth` how wide that peak
   *  is, `floor` what is left down at idle. */
  peakAt: number;
  breadth: number;
  floor: number;
  /** The one honest "this block is better" knob. Kept small — the
   *  curve shape is supposed to be the interesting part. */
  powerMult: number;
  /** Mass against the 2.0T benchmark, kg. A V8 is a lot of iron over
   *  the front axle and the tyres know about it. */
  massKg: number;
  /** Sound: how much of the mix sits on the sub-octave. Big engines
   *  are felt as much as heard. */
  subMix: number;
  /** Cross-plane lope depth, 0..1, modulating the exhaust at half
   *  crank order. Only the V8 has one. */
  lopeDepth: number;
  price: number;
  desc: string;
}

/** Showroom order: cheapest first. */
export const ENGINES: EngineSpec[] = [
  {
    id: "i4-16",
    name: "Sadu 1.6 VTC",
    ar: "سدو ١٫٦",
    cylinders: 4,
    layout: "inline",
    litres: 1.6,
    idleRpm: 850,
    redlineRpm: 8400,
    // Nothing down low and everything at the top: a small naturally
    // aspirated four only makes power where it can breathe.
    peakAt: 0.88,
    breadth: 0.24,
    floor: 0.26,
    powerMult: 0.93,
    massKg: -42,
    subMix: 0.2,
    lopeDepth: 0,
    price: 900,
    desc: "Naturally aspirated four. Dead below half revs, then it screams to 8,400 — keep it on the cam or it does nothing at all.",
  },
  {
    id: "i4-20t",
    name: "Bahri 2.0T",
    ar: "بحري ٢٫٠ تيربو",
    cylinders: 4,
    layout: "inline",
    litres: 2.0,
    idleRpm: 800,
    redlineRpm: 6800,
    // A boosted four is all mid-range and then it is over.
    peakAt: 0.5,
    breadth: 0.3,
    floor: 0.5,
    powerMult: 1.0,
    massKg: 0,
    subMix: 0.3,
    lopeDepth: 0,
    price: 2200,
    desc: "Boosted four. A hard shove through the middle of every gear and nothing left up top — the everyday street weapon.",
  },
  {
    id: "f6-25",
    name: "Nejma Flat-Six",
    ar: "نجمة ٢٫٥",
    cylinders: 6,
    layout: "flat",
    litres: 2.5,
    idleRpm: 900,
    redlineRpm: 7800,
    peakAt: 0.72,
    breadth: 0.34,
    floor: 0.44,
    powerMult: 1.05,
    massKg: 12,
    subMix: 0.34,
    lopeDepth: 0,
    price: 3800,
    desc: "Flat-six, slung low. Pulls hard from the middle and keeps going to 7,800 — and it sits lower in the car than anything else here.",
  },
  {
    id: "i6-30tt",
    name: "Sahil 3.0 TT",
    ar: "ساحل ٣٫٠",
    cylinders: 6,
    layout: "inline",
    litres: 3.0,
    idleRpm: 750,
    redlineRpm: 7000,
    // The flattest curve in the game. An inline six is perfectly
    // balanced and a pair of small turbos fill in everything else.
    peakAt: 0.58,
    breadth: 0.46,
    floor: 0.66,
    powerMult: 1.1,
    massKg: 48,
    subMix: 0.38,
    lopeDepth: 0,
    price: 5200,
    desc: "Twin-turbo inline six. Flat as a table from 2,000 to the limiter — no gear is the wrong gear.",
  },
  {
    id: "v8-57",
    name: "Ghazi 5.7 V8",
    ar: "غازي ٥٫٧",
    cylinders: 8,
    layout: "vee",
    litres: 5.7,
    idleRpm: 700,
    redlineRpm: 6200,
    // Everything, immediately, and then it runs out of breath. Near
    // enough the mirror image of the 1.6 above, which is the point: the
    // two of them are the argument this whole file is making.
    peakAt: 0.24,
    breadth: 0.36,
    floor: 0.46,
    powerMult: 1.12,
    massKg: 115,
    subMix: 0.5,
    // Cross-plane crank: the uneven bank firing that makes the burble.
    lopeDepth: 0.24,
    price: 6500,
    desc: "Cross-plane V8. Torque from idle, done by 6,200, and it lopes at every traffic light on the corniche.",
  },
];

export const ENGINE_BY_ID: Record<string, EngineSpec> = Object.fromEntries(
  ENGINES.map((e) => [e.id, e])
);

/** The engine a car has if nothing has been swapped into it. */
export const DEFAULT_ENGINE: EngineId = "i4-20t";

export function getEngine(id: string | undefined): EngineSpec {
  return ENGINE_BY_ID[id ?? ""] ?? ENGINE_BY_ID[DEFAULT_ENGINE];
}

/**
 * Lowest rev fraction the sim ever asks about. The gearbox model floors
 * in-gear revs here, so normalising over [0, 1] would average in a
 * stretch of the curve no car ever uses and quietly make the peaky
 * engines stronger than intended everywhere the driver can feel.
 */
export const MIN_REV_FRACTION = 0.12;

/** The raw bump, before normalisation. Gaussian on a floor: a floor
 *  that is nearly the peak is a flat engine, a floor near zero is a
 *  cammy one, and `peakAt` decides which half of the tacho it lives in. */
function rawTorque(e: EngineSpec, rev: number): number {
  const d = rev - e.peakAt;
  return e.floor + (1 - e.floor) * Math.exp(-(d * d) / (2 * e.breadth * e.breadth));
}

/** Mean raw torque over the usable range, per engine, computed once. */
const NORM: Record<string, number> = Object.fromEntries(
  ENGINES.map((e) => {
    const N = 256;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += rawTorque(e, MIN_REV_FRACTION + ((1 - MIN_REV_FRACTION) * (i + 0.5)) / N);
    }
    return [e.id, sum / N];
  })
);

/**
 * Torque delivered at a given point in the rev range, as a multiplier
 * on the car's power. Averages to EXACTLY 1.0 across the usable range
 * for every engine — the shape is all this function carries.
 *
 * `powerMult` deliberately does not appear here. It belongs to the
 * car's power figure, where the garage's spec bar can see it; folding
 * it in here as well would count it twice, once in the shop and once
 * again on the road.
 */
export function torqueShape(e: EngineSpec, rev: number): number {
  const r = Math.min(1, Math.max(0, rev));
  return rawTorque(e, r) / NORM[e.id];
}

/** Crank speed at a point in the rev range. */
export function rpmAt(e: EngineSpec, rev: number): number {
  return e.idleRpm + (e.redlineRpm - e.idleRpm) * Math.min(1, Math.max(0, rev));
}

/**
 * The note. A four-stroke fires once per cylinder every TWO crank
 * revolutions, so the firing rate — which is what the ear hears as the
 * engine's pitch — is rev/s × cylinders / 2.
 */
export function firingHz(e: EngineSpec, rev: number): number {
  return (rpmAt(e, rev) / 60) * (e.cylinders / 2);
}

/** How the layout reads on a spec line: I4, F6, V8. */
export function layoutTag(e: EngineSpec): string {
  const letter = e.layout === "inline" ? "I" : e.layout === "flat" ? "F" : "V";
  return `${letter}${e.cylinders}`;
}
