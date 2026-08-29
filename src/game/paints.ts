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
export const PAINTS: Paint[] = [
  // --- mono: the ones most cars on any road actually are
  { id: "paint-black", hex: 0x0d0e11, family: "mono" },
  { id: "paint-gunmetal", hex: 0x4a5058, family: "mono" },
  { id: "paint-slate", hex: 0x7a8794, family: "mono" },
  { id: "paint-silver", hex: 0xb9bfc7, family: "mono" },
  { id: "paint-white", hex: 0xf2f4f7, family: "mono", asColor: "White", asColorAr: "أبيض" },

  // --- warm: sand, sun and rust
  { id: "paint-maroon", hex: 0x5e1420, family: "warm" },
  { id: "paint-bronze", hex: 0x8a5a2a, family: "warm" },
  { id: "paint-olive", hex: 0x6d6a2f, family: "warm" },
  { id: "paint-red", hex: 0xc1121f, family: "warm" },
  { id: "paint-gold", hex: 0xc9a227, family: "warm" },
  { id: "paint-sand", hex: 0xcbb388, family: "warm" },

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
  { id: "paint-orange", hex: 0xe2571c, family: "loud" },
  { id: "paint-coral", hex: 0xff9179, family: "loud" },
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
