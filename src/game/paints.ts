// The paint booth, as data.
//
// WHY THIS IS ITS OWN FILE
//
// A colour was three facts in three places: a hex in mods.ts, a name and
// a price in the catalogue beside it, and — for the online cruise — a
// completely separate list of eight anonymous hexes hand-typed into the
// hub page. The two lists did not agree and could not: one had thirteen
// colours with names in two languages, the other had eight with none, so
// the colour a player picked to be seen in was not a colour the game
// could name.
//
// So the swatch lives here, once, and the shop keeps what only a shop
// knows — what a tin costs. That is the same split engines.ts already
// uses: the engine knows its torque curve, the catalogue knows its
// price, and check:parts asserts the two agree in both directions.
//
// WHAT MAKES A GOOD SET
//
// Not evenness. A colour wheel divided into twenty-four equal slices
// gives you four blues nobody can tell apart at night, which is one blue
// that cost four times. The rule this list is built to, and that
// tests/paints.mjs enforces in CIELAB rather than by eye:
//
//     NO TWO PAINTS MAY BE PERCEPTUALLY CLOSE.
//
// Measured as CIEDE2000, because the naive distance between two hex
// triples is not a distance anybody sees — it calls two dark blues far
// apart and two pale creams identical, and it is exactly the instrument
// that lets a palette fill up with colours that look the same on a car.

/** Rough grouping, for laying the swatches out in rows that read. It is
 *  presentation only — nothing in the game reads a family to decide
 *  anything. */
export type PaintFamily = "mono" | "warm" | "cool" | "loud";

export interface Paint {
  /** The garage part id. mods.ts sells this id; nothing else may. */
  id: string;
  hex: number;
  family: PaintFamily;
  /**
   * What to call this colour where it is not being sold.
   *
   * Almost always absent, because a tin's name and its colour's name are
   * the same words. The exception is the factory finish: in the garage
   * "Factory Finish" is exactly right, because that part means the
   * colour the car left the lot in and not any particular colour. On the
   * hub's cruise picker it is wrong — there is no lot and no purchase,
   * only a swatch, and the swatch is white.
   *
   * So this is not the shop's name repeated. It is the one fact the shop
   * cannot supply: what the colour is, as opposed to what the product
   * is.
   */
  asColor?: string;
  asColorAr?: string;
}

/**
 * Every colour a car in this game can be.
 *
 * Ordered within families from dark to light, which is the order a
 * swatch grid wants and not the order they were added in.
 */
/**
 * A NOTE ON WHY SOME OF THESE ARE LIGHTER THAN THEY LOOK.
 *
 * The floor below — no two paints perceptually close — is enforced on
 * the SWATCH, and a swatch is the input. What the player buys is a car,
 * and the road compresses what it is given: the dark end squeezes
 * together and warm colours lose most of their chroma to a blue night.
 * Measured on the built car (tools/shots/paintaccuracy.mjs), twelve
 * pairs that clear the floor in the shop fell under it on the road —
 * black, gunmetal and slate arrived within eight points of lightness of
 * each other, and red, orange and coral converged as their chroma
 * drained.
 *
 * So four of these are chosen against what the road does to them rather
 * than against how they read on a card: slate is lighter than a tin of
 * it would be, orange is pushed toward yellow and away from red, coral
 * is lighter still, and sand is lifted off gold.
 *
 * AND ONE LESSON ABOUT DOING THAT BY HAND. The first attempt lightened
 * gunmetal as well, which felt like more separation and was less: it
 * closed gunmetal's gap to slate from 22 lightness units to 17, and the
 * pair rendered 2.8 apart instead of 5.1 — worse than before it was
 * touched. Base to rendered is compressive and not intuitive. Spacing
 * two swatches further apart does not reliably space two cars further
 * apart, and the only way to know is to render them.
 *
 * WHAT THIS CANNOT FIX. The mono family's bases span 92 points of
 * lightness — 4, 44, 60, 77, 96 — and arrive on the car inside about 8.
 * No arrangement of five greys survives that, and the search that chose
 * these values could not find one that did while keeping the swatch
 * floor. Black, gunmetal and slate are still under the floor on the
 * road. That is not a palette problem and it will not be solved here:
 * the dark end of the picture is compressed, which is the same thing
 * that made the shadows read as holes.
 */
export const PAINTS: Paint[] = [
  // --- mono: the ones most cars on any road actually are
  { id: "paint-black", hex: 0x0d0e11, family: "mono" },
  { id: "paint-gunmetal", hex: 0x4a5058, family: "mono" },
  { id: "paint-slate", hex: 0x8593a2, family: "mono" },
  { id: "paint-silver", hex: 0xb9bfc7, family: "mono" },
  { id: "paint-white", hex: 0xf2f4f7, family: "mono", asColor: "White", asColorAr: "أبيض" },

  // --- warm: sand, sun and rust
  { id: "paint-maroon", hex: 0x5e1420, family: "warm" },
  { id: "paint-bronze", hex: 0x8a5a2a, family: "warm" },
  { id: "paint-olive", hex: 0x6d6a2f, family: "warm" },
  { id: "paint-red", hex: 0xc1121f, family: "warm" },
  // 0xb0ab28, not the tin's 0xc9a227: the blue night rotates gold's
  // rendered hue about 18 degrees toward green (measured, sky-tier), so
  // the base is turned 14 back toward orange to meet it. Same idea as
  // the light-vs-road spread already in this file — chosen against what
  // the road does, not against the swatch.
  { id: "paint-gold", hex: 0xb0ab28, family: "warm" },
  // 0xd0cb9d, pre-rotated 15 degrees against the same blue drift that
  // pushed the tin's 0xdcc79c past a nameable gold on the car.
  { id: "paint-sand", hex: 0xd0cb9d, family: "warm" },

  // --- cool: the water this road runs along
  { id: "paint-navy", hex: 0x16305e, family: "cool" },
  { id: "paint-palm", hex: 0x1d6b3f, family: "cool" },
  { id: "paint-teal", hex: 0x2e8f96, family: "cool" },
  { id: "paint-gulf", hex: 0x1e7fd4, family: "cool" },
  { id: "paint-mint", hex: 0x7fd8b0, family: "cool" },
  { id: "paint-ice", hex: 0x86c6e6, family: "cool" },

  // --- loud: bought to be seen
  { id: "paint-purple", hex: 0x5b2a86, family: "loud" },
  { id: "paint-rose", hex: 0xd9557f, family: "loud" },
  { id: "paint-orange", hex: 0xef7a0a, family: "loud" },
  { id: "paint-coral", hex: 0xffab95, family: "loud" },
  { id: "paint-yellow", hex: 0xf7e21c, family: "loud" },
  { id: "paint-lime", hex: 0x9ad11f, family: "loud" },
];

/** id to hex, for the renderer. */
export const PAINT_HEX: Record<string, number> = Object.fromEntries(
  PAINTS.map((p) => [p.id, p.hex])
);

/** "#1e7fd4" — what CSS and the hub's wire format want. */
export function swatch(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

/** The paint whose swatch is this CSS colour, if any. The hub stores a
 *  profile colour as a string, and a string that no longer names a paint
 *  — an old save, a hand-edited one — has to be recognisable as such
 *  rather than silently drawn as black. */
export function paintFromSwatch(css: string): Paint | null {
  const want = css.trim().toLowerCase();
  return PAINTS.find((p) => swatch(p.hex) === want) ?? null;
}

// ---------------------------------------------------------------------
// Underglow.
//
// A separate list because it is a separate thing: this is light, not
// pigment. It is emissive, it is seen against dark tarmac rather than
// against the sky, and the values are therefore brighter and more
// saturated than any paint here would be — a neon the colour of Desert
// Sand is not a neon.

export interface Glow {
  id: string;
  hex: number;
}

export const GLOWS: Glow[] = [
  { id: "glow-cyan", hex: 0x38e8ff },
  { id: "glow-green", hex: 0x2eff7a },
  { id: "glow-purple", hex: 0xb84dd6 },
  { id: "glow-red", hex: 0xff3b3b },
  { id: "glow-amber", hex: 0xffa62b },
  { id: "glow-pink", hex: 0xff5fd0 },
  { id: "glow-white", hex: 0xe8f4ff },
];

export const GLOW_HEX: Record<string, number> = Object.fromEntries(
  GLOWS.map((g) => [g.id, g.hex])
);

// ---------------------------------------------------------------------
// Engine covers.
//
// The cam cover is the one part of an engine anybody outside the car
// ever sees, and it is the part tuners have always painted — crackle
// red, wrinkle black, a polished cast alloy. It is a separate list from
// the paint booth for a reason a glance at the numbers shows: these are
// stronger and darker than any body colour here, because a cover is seen
// in shadow, through a vent, lit by whatever spills past the bonnet. A
// cover in Desert Sand would be a grey smudge in a hole.
//
// It is also why there are six and not twenty-three. What you can see of
// a cover is roughly a hand's width of it; the distinctions a whole
// flank can carry are wasted there.

export interface Cover {
  id: string;
  hex: number;
}

export const COVERS: Cover[] = [
  { id: "cover-red", hex: 0xb3121b },
  { id: "cover-blue", hex: 0x1550a8 },
  { id: "cover-black", hex: 0x14161a },
  { id: "cover-gold", hex: 0xb08420 },
  { id: "cover-alloy", hex: 0x9aa2ab },
  { id: "cover-green", hex: 0x1a7a44 },
];

export const COVER_HEX: Record<string, number> = Object.fromEntries(
  COVERS.map((c) => [c.id, c.hex])
);

// ---------------------------------------------------------------------
// Carbon.
//
// Not a colour — a material, and the difference matters to the renderer:
// carbon has a weave, and a weave has a direction and a scale. A flat
// dark grey panel is what "carbon" looks like when nobody drew the cloth,
// and this game has had exactly that on its kit pieces since the kit
// existed.

export type CarbonLevel = "none" | "panels" | "full";

/**
 * What the cloth actually saves, in kilograms.
 *
 * Real numbers, per panel, against the steel they replace: a bonnet is
 * 8-12 kg, a boot lid 6-8, a pair of mirror caps under 2, a roof skin
 * 10-14. They are added up here rather than invented as a percentage,
 * because a percentage would make a carbon bonnet worth more on a heavy
 * car than on a light one, which is the wrong way round.
 */
export const CARBON_KG: Record<CarbonLevel, number> = {
  none: 0,
  panels: 22,
  full: 38,
};

/** What a car weighs, near enough, for turning kilos into a fraction.
 *  One number for the whole fleet: the cars in this game do not carry
 *  individual masses, and inventing fifteen of them to divide a
 *  twenty-two kilo saving by would be false precision. */
export const NOMINAL_CAR_KG = 1400;
