// What is inside the headlamp.
//
// The `lamps` slot in the shop is about the LENS — tinted, or one of them
// taken out entirely. This is the other half: the source behind it. They
// are genuinely different questions, so they are different slots, and a
// smoked lens dims whatever bulb is fitted rather than replacing it.
//
// This is not a cosmetic part. The game is set between midnight and ten
// to six and the only light on most of the lap is the one the car is
// carrying, so how far the beam reaches is how far ahead the driver can
// read the road. That makes it the one styling-adjacent purchase with a
// real effect on driving, and the prices say so.
//
// THE COLOUR IS DERIVED, NOT PICKED
//
// Each bulb carries its colour TEMPERATURE, in kelvin, which is the
// number a real bulb is actually sold by — and the RGB comes out of a
// blackbody approximation rather than being typed in as a hex a human
// thought looked about right. Halogen at 3200 K lands on 0xffd3a5-ish
// warm, and the current hard-coded 0xfff2cc is close to it; the
// difference is that the next person to add a bulb writes down a
// temperature they can check against a box, not a colour they invented.

/** Which source is behind the lens. */
export type Bulb = "halogen" | "led" | "laser";

export interface BulbSpec {
  name: string;
  arabic: string;
  /** Colour temperature, kelvin. The number on the box. */
  kelvin: number;
  /** Multiplier on the beam's intensity, against halogen. */
  intensity: number;
  /** Multiplier on how far it throws. */
  reach: number;
  /** Multiplier on the cone angle. A longer throw is a narrower cone —
   *  the same light has to go further, and it cannot also go wider. */
  angle: number;
}

/**
 * The three sources, with the ratios taken from what these things
 * actually do rather than from what would feel generous.
 *
 * A halogen dipped beam throws usable light about 60-70 m. An LED unit
 * roughly doubles the luminous flux for the same power and is quoted
 * around 100 m. Laser high beam — which is a laser diode exciting a
 * phosphor, not a laser pointed down the road — is quoted at about twice
 * the LED's range again, and it is emphatically a narrow long-range
 * beam rather than a wider one.
 *
 * So: 1.0 / 1.45 / 1.9 on reach, and the angle tightens as it goes,
 * because a beam that reached further AND wider would be free light.
 */
export const BULBS: Record<Bulb, BulbSpec> = {
  halogen: {
    name: "Halogen",
    arabic: "هالوجين",
    // A tungsten filament runs about here. Warm, and warm is not a
    // defect: it is the colour that penetrates dust and rain best, which
    // on this coast in February is not nothing.
    kelvin: 3200,
    intensity: 1,
    reach: 1,
    angle: 1,
  },
  led: {
    name: "LED",
    arabic: "إل إي دي",
    kelvin: 5800,
    intensity: 1.35,
    reach: 1.45,
    angle: 0.92,
  },
  laser: {
    name: "Laser",
    arabic: "ليزر",
    kelvin: 6500,
    intensity: 1.75,
    reach: 1.9,
    angle: 0.78,
  },
};

export const BULB_IDS = Object.keys(BULBS) as Bulb[];

/**
 * Blackbody colour temperature to linear RGB, 0..1 each.
 *
 * The Tanner Helland piecewise fit, which is the one everybody uses for
 * this: accurate enough between 1000 K and 40000 K that the error is
 * smaller than the difference between two bulbs of the same rating, and
 * cheap enough to run at build time without thinking about it.
 *
 * Clamped at both ends rather than extrapolated. Outside the fitted
 * range the polynomials go somewhere silly, and a headlamp the colour of
 * nothing is harder to notice in a screenshot than it should be.
 */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const ch = (v: number) => Math.min(1, Math.max(0, v / 255));

  let r: number;
  if (t <= 66) r = 255;
  else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);

  let g: number;
  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);

  let b: number;
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return [ch(r), ch(g), ch(b)];
}

/**
 * The colour the game should actually light the road with.
 *
 * Not the raw blackbody value. A 3200 K source in absolute terms is
 * #ffb87b — properly orange — and headlights do not look orange, because
 * an eye adapts to the light it is given. The engine has always lit the
 * road with 0xfff2cc, which is that adaptation already applied and
 * already graded: the night levels, the dark check and every screenshot
 * of this game were measured against it.
 *
 * So the adaptation is fitted AT halogen and applied to the others — a
 * von Kries transform, which is the standard way to move a colour
 * between illuminants. Per-channel gain = graded / blackbody at 3200 K,
 * measured: 1.000, 1.318, 1.657. Halogen therefore comes back bit for
 * bit as 0xfff2cc, and nothing changes for a car that has not bought
 * anything.
 *
 * Two alternatives were measured and are worse:
 *
 *   Blend toward white by a single fraction. The best fit to the graded
 *   halogen was 0.660, and at that strength LED and laser came out
 *   #fffbf7 and #fffffd — a player buys the upgrade and sees no colour
 *   change at all.
 *
 *   Von Kries with clipping instead of normalising. The gains push both
 *   upgrades past 255 on green and blue, so they clip to pure white and
 *   become indistinguishable from each other.
 *
 * Normalising by the largest channel keeps the hue and gives back the
 * distinction: #fff2cc, #aad5ff, #9dceff. The upgrades read blue against
 * a sodium-lit world, which is what a cool-temperature beam looks like
 * next to a warm one — and is why people notice them on the road.
 */
export function bulbColor(bulb: Bulb): number {
  const ANCHOR_K = BULBS.halogen.kelvin;
  const GRADED: [number, number, number] = [255, 242, 204]; // 0xfff2cc
  const src = kelvinToRgb(ANCHOR_K).map((v) => v * 255);
  const gain = GRADED.map((t, i) => t / src[i]);

  let c = kelvinToRgb(BULBS[bulb].kelvin).map((v, i) => v * 255 * gain[i]);
  const mx = Math.max(...c);
  // Hue-preserving: scale the whole triple rather than clamping each
  // channel, which would flatten every cool bulb onto white.
  if (mx > 255) c = c.map((v) => (v * 255) / mx);
  const [r, g, b] = c.map((v) => Math.round(Math.min(255, Math.max(0, v))));
  return (r << 16) | (g << 8) | b;
}
