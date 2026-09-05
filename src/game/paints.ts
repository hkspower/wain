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
  /**
   * Solid pigment, or metallic flake?
   *
   * A PROPERTY OF THE PAINT, not something derivable from its hex. Every
   * real range sells the same colour both ways — a solid red and a
   * metallic red are two tins with two prices — so no rule over R, G and
   * B can tell you which one is in front of you. The renderer inferred
   * it from luminance alone, which got the two ends right (a near-white
   * and a near-black are pigment under lacquer) and everything between
   * them wrong by assumption: a muted sage came out as flake, which is
   * to say as a mirror, and a mirror at night shows you the night.
   *
   * That is measurable and it was measured. Under sodium the muted
   * colours were landing tens of degrees from their own hue — sage 52,
   * molasses 60 — while the saturated ones sat within a few, because a
   * saturated pigment has enough colour of its own to argue with what
   * the sky is adding and a near-grey one does not. The fix is not to
   * pre-distort the tins. It is to stop claiming a solid colour is
   * flake.
   *
   * Absent means flake, because most of this wall is: it is a street
   * racing game and metallic is what people buy. The solid ones say so.
   */
  solid?: boolean;
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
/**
 * The wall.
 *
 * THE LAST EIGHT WERE FOUND, NOT PICKED. tests/paints.mjs holds every
 * pair at least 12 CIEDE2000 apart and the wall was already tight — the
 * closest pair, silver against white, sits at 12.6. At that density a
 * colour chosen by eye is usually somebody else's colour with a
 * different name on it, and the test says so after the work rather than
 * before it.
 *
 * So tools/paint-space.mjs walks a grid of plausible car colours,
 * scores each by its distance to the NEAREST paint already here, and
 * reports where the holes are. molasses, mudbrick, diver, sage, indigo,
 * violet, signal and mauve are eight of those holes. Run it before
 * adding a ninth.
 *
 * AND THEN CHECK THEM ON A CAR. Distance on the wall is necessary and
 * not sufficient: tools/shots/paintcolors.mjs paints each one through
 * the real garage and measures what the night leaves of it. That is
 * what sent the first molasses back (see its note below). Measured, all
 * eight, at 02:30 on the corniche — source hue against rendered:
 *
 *              body   dead    hue          sat
 *   molasses   42.5   0.4%   350 -> 290   0.32
 *   mudbrick   80.3     0%    30 ->  14   0.23
 *   diver      26.3   2.9%   168 -> 176   0.57
 *   sage       68.4     0%   102 -> 154   0.31
 *   indigo     42.7   0.1%   246 -> 242   0.77
 *   violet     41.9     0%   288 -> 276   0.83
 *   signal     54.6     0%   132 -> 130   1.00
 *   mauve      42.9   0.1%   288 -> 277   0.44
 *
 * Two things that table says. The saturated ones barely move — signal
 * lands 2 degrees off its tin and indigo 4 — because there is enough
 * colour in them to survive the sky. And the shift is not a constant:
 * sage swings 52 degrees where mudbrick swings 16, so a colour cannot
 * be pre-rotated by a fixed amount and called compensated. Measure it.
 *
 * diver's 2.9% of dead panels is the only figure near a limit, and it
 * is a deliberately near-black green: paint-black measures 6.9% on the
 * same pass and is not a bug either.
 */
export const PAINTS: Paint[] = [
  // --- mono: the ones most cars on any road actually are
  { id: "paint-black", hex: 0x0d0e11, family: "mono", solid: true },
  { id: "paint-gunmetal", hex: 0x4a5058, family: "mono" },
  { id: "paint-slate", hex: 0x8593a2, family: "mono" },
  { id: "paint-silver", hex: 0xb9bfc7, family: "mono" },
  { id: "paint-white", hex: 0xf2f4f7, family: "mono", asColor: "White", asColorAr: "أبيض", solid: true },

  // --- warm: sand, sun and rust
  { id: "paint-maroon", hex: 0x5e1420, family: "warm" },
  { id: "paint-bronze", hex: 0x8a5a2a, family: "warm" },
  { id: "paint-olive", hex: 0x6d6a2f, family: "warm", solid: true },
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
  // 0x81565e, not the 0x3b2a02 the search first offered.
  //
  // That one was the roomier hole — 20.3 from black against this one's
  // 12.1 — and tools/shots/paintcolors.mjs refused it. Painted on a car
  // and measured at night it came back at hue 234 degrees: blue. A
  // molasses that renders blue is not a molasses. The cause is the one
  // this file already documents for gold and sand — the night drags
  // warm hues round toward the cool — and at a body luminance of 32 of
  // 255 there was not enough colour left for it to drag AGAINST.
  //
  // Every lighter brown collides with bronze, so there is no second
  // brown to be had. This is the same idea moved to where it survives:
  // a dusty wine-brown, light enough at L 40 to have something left
  // after the sky has had its say. Measured on a car at night:
  //
  //              body   dead    hue
  //   0x3b2a02   32.4   2.5%   234 deg   the first pick — blue
  //   0x81565e   42.5   0.4%   290 deg   this one — red-purple
  //
  // 290 is not 350, and it is not going to be. The night in this game
  // owns hue at low luminance: paint-black itself measures 222 deg on
  // the same pass. Pre-rotating far enough to land back on a wine red
  // would put the source at hue 50 — which is bronze, and bronze is
  // already on the wall. Brighter, not dead, and out of the blues is
  // what this hole affords.
  { id: "paint-molasses", hex: 0x81565e, family: "warm", solid: true },
  { id: "paint-mudbrick", hex: 0xa7917b, family: "warm", solid: true },

  // --- cool: the water this road runs along
  { id: "paint-navy", hex: 0x16305e, family: "cool" },
  { id: "paint-palm", hex: 0x1d6b3f, family: "cool" },
  { id: "paint-teal", hex: 0x2e8f96, family: "cool" },
  { id: "paint-gulf", hex: 0x1e7fd4, family: "cool" },
  { id: "paint-mint", hex: 0x7fd8b0, family: "cool" },
  { id: "paint-ice", hex: 0x86c6e6, family: "cool" },
  { id: "paint-diver", hex: 0x07362d, family: "cool", solid: true },
  { id: "paint-sage", hex: 0x7f9376, family: "cool", solid: true },
  { id: "paint-indigo", hex: 0x695ce0, family: "cool" },

  // --- loud: bought to be seen
  { id: "paint-purple", hex: 0x5b2a86, family: "loud" },
  { id: "paint-rose", hex: 0xd9557f, family: "loud" },
  { id: "paint-orange", hex: 0xef7a0a, family: "loud" },
  { id: "paint-coral", hex: 0xffab95, family: "loud", solid: true },
  { id: "paint-yellow", hex: 0xf7e21c, family: "loud", solid: true },
  { id: "paint-lime", hex: 0x9ad11f, family: "loud" },
  { id: "paint-violet", hex: 0xc814f5, family: "loud" },
  // Not solid, though a real signal green usually is: at saturation 1.0
  // it has all the colour it needs to hold its hue as flake — measured
  // 2 degrees off as metallic against 7 as solid — and accuracy is the
  // point of the flag.
  { id: "paint-signal", hex: 0x079d25, family: "loud" },

  // --- mono, but a colour: the grey with an argument in it
  { id: "paint-mauve", hex: 0x806986, family: "mono" },
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


/**
 * Colour science, for anything that has to know whether two paints are
 * the same colour.
 *
 * It lived in tests/paints.mjs, which is where it was needed first and
 * the wrong place for it to stay: the moment a second thing wanted to
 * ask "how far apart are these two colours" — a tool searching for a
 * paint that is not already on the wall — the only options were to
 * import from a test or to write the standard out twice. CIEDE2000 is
 * eighty lines of constants; a second copy of it is a second copy that
 * can disagree.
 *
 * paints.ts is the bottom of the stack and imports nothing, which is
 * exactly what this needs to be.
 */
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Hex to CIELAB under a D65 white point. */
export function lab(hex: number): [number, number, number] {
  const r = srgbToLinear(((hex >> 16) & 255) / 255);
  const g = srgbToLinear(((hex >> 8) & 255) / 255);
  const b = srgbToLinear((hex & 255) / 255);
  // sRGB primaries, D65.
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000. The constants are the standard's; kL = kC = kH = 1. */
export function deltaE(hex1: number, hex2: number): number {
  const [L1, a1, b1] = lab(hex1);
  const [L2, a2, b2] = lab(hex2);
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (b: number, ap: number): number => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) * deg;
    return h >= 0 ? h : h + 360;
  };
  const hp1 = hp(b1, ap1), hp2 = hp(b2, ap2);
  const dLp = L2 - L1;
  const dCp = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp * rad) / 2);
  const Lbar = (L1 + L2) / 2;
  const Cpbar = (Cp1 + Cp2) / 2;
  let hbar = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hbar += hp1 + hp2 < 360 ? 360 : -360;
    hbar /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hbar - 30) * rad) + 0.24 * Math.cos(2 * hbar * rad)
    + 0.32 * Math.cos((3 * hbar + 6) * rad) - 0.20 * Math.cos((4 * hbar - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpbar ** 7 / (Cpbar ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cpbar;
  const Sh = 1 + 0.015 * Cpbar * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 +
    Rt * (dCp / Sc) * (dHp / Sh)
  );
}
