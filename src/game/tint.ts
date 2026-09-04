// The film on the windows.
//
// Window tint has been in this game as a free slider from 0 to 100, and
// the slider is the right shape for the DARKNESS: tint is a continuum,
// everybody has a number they want, and three purchasable steps would be
// a worse answer to that question. What the slider is not is a shop
// item, and a tint job is one of the few things every car on the
// corniche has actually paid for.
//
// So the shop sells the FILM and the slider still sets the darkness.
// That is also how a tint shop works: you choose a product off the wall
// — dyed, carbon, ceramic — and then you say how dark. The price is per
// film, not per per cent.
//
// WHAT SEPARATES THEM IS NOT DARKNESS
//
// It is tempting to price these by how dark they go, and it would be
// wrong: every one of these films is sold down to 5% VLT. What actually
// separates a 12 KD roll from a 100 KD one is the COLOUR it goes, how
// much it mirrors, and how clear it stays.
//
//   dyed      Dye suspended in the adhesive. The cheap job. It is not
//             quite neutral when new and it does not stay neutral —
//             dyed film is the one that turns purple, and this game is
//             set on a coast in a country where the sun is the
//             strongest argument against it. Flat, low reflectivity.
//   carbon    Carbon particles instead of dye. A deep flat charcoal
//             that stays charcoal, and no metal in it. The default a
//             sensible person buys.
//   ceramic   Ceramic nanoparticles. The clear one — least haze, and
//             the glass still reads as glass rather than as a panel, so
//             it keeps the reflection of the street in it. The
//             expensive one, and it looks it. Not the darkest: at a
//             given darkness every film blocks the same light, which is
//             the point the top of this comment is making.
//
// None of them changes how the car drives, and the shop says so. There
// is no hidden performance in a window.
//
// WHY THE DRIVER'S VIEW IS NOT PART OF THIS
//
// A tint that cost the driver their forward vision would be the obvious
// trade to build. It is not built, because it would not be true: the
// cockpit camera in this game sits over the bonnet, outside the screen,
// and tools/shots/tint.mjs measures the view from it at 75.4 of 255 at
// every setting of the slider from 0 to 100. Tint here is what the car
// looks like from outside. Claiming otherwise would be a number in a
// shop description that nothing in the game produces.

/** Which product is on the glass. Absent means bare factory glass. */
export type TintFilm = "dyed" | "carbon" | "ceramic";

export interface FilmSpec {
  name: string;
  arabic: string;
  /**
   * The colour the glass moves toward as the film goes on.
   *
   * Not "black". A tinted window is not a darker version of a clear one
   * — factory glass is blue-green and the film lays a grey over it that
   * kills the blue — so each of these is the charcoal that particular
   * product actually goes, and the differences between them are the
   * whole reason the shop has three.
   */
  core: number;
  /**
   * How much the reflection of the street comes up at full darkness,
   * added to the base envMapIntensity.
   *
   * This is most of what tells the three apart at a glance. Dyed film
   * is flat and reads as a painted panel; ceramic keeps its optical
   * surface and still throws the sodium lights back at you.
   */
  sheen: number;
  /**
   * Haze added at full darkness. Roughness, in the material.
   *
   * Cheap film scatters. It is a small number in absolute terms — this
   * is glass, not stone — but it is the difference between a window and
   * a slightly milky window.
   */
  haze: number;
}

/** Bare glass, before any film: the blue-green a windscreen already is. */
export const FACTORY_GLASS = 0x121722;

/** Factory glass, for a build that has never been to the tint shop. */
export const CLEAR_OPACITY = 0.62;

/**
 * The three products.
 *
 * `carbon` reproduces exactly what the game did before the shop existed
 * — core 0x0b0b0c, sheen 0.5, haze 0.02 — so the look every tinted car
 * in every existing save is wearing is still on the wall, in the middle
 * of the range, at a middling price. The other two are built outward
 * from it rather than around it.
 */
export const FILMS: Record<TintFilm, FilmSpec> = {
  dyed: {
    name: "Dyed Film",
    arabic: "فيلم ملوّن",
    // Warm, with the violet lean that gives cheap film away. Lighter
    // than the other two at the same darkness, because dye alone does
    // not get you to black.
    core: 0x17121c,
    sheen: 0.22,
    haze: 0.038,
  },
  carbon: {
    name: "Carbon Film",
    arabic: "فيلم كاربون",
    core: 0x0b0b0c,
    sheen: 0.5,
    haze: 0.02,
  },
  ceramic: {
    name: "Ceramic Film",
    arabic: "فيلم سيراميك",
    // A hair cool, and that is the whole of its colour story. It is NOT
    // the darkest of the three — this said "the deepest" until the test
    // measured it at 11.7 against carbon's 11.1 and refused the claim.
    // Depth is what the slider is for; what ceramic sells is the sheen
    // and the haze below, and those are where it wins outright.
    // Both of these were milder — core 0x090c11 and sheen 0.88 — and
    // tools/shots/tint.mjs measured ceramic against carbon at a mean
    // difference of 1.21 out of 255, a fifth of what separates carbon
    // from dyed. Side by side at 70% they were the same window. A shelf
    // whose top item costs 880 KD more than the middle one and looks
    // identical to it is not a shelf, so the two properties that ARE
    // ceramic's — how cool it reads and how much it still mirrors —
    // were pushed until the difference is one you can see.
    core: 0x070d17,
    sheen: 1.45,
    haze: 0.006,
  },
};

export const FILM_IDS: readonly TintFilm[] = ["dyed", "carbon", "ceramic"];

export interface GlassLook {
  /** 0-1. Never 1: a window you cannot see into at all has stopped
   *  being glass and become a painted panel. */
  opacity: number;
  color: number;
  envMapIntensity: number;
  roughness: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Channel-wise mix of two packed 0xRRGGBB colours. */
function mixHex(a: number, b: number, t: number): number {
  const ch = (v: number, s: number) => (v >> s) & 0xff;
  const r = Math.round(lerp(ch(a, 16), ch(b, 16), t));
  const g = Math.round(lerp(ch(a, 8), ch(b, 8), t));
  const bl = Math.round(lerp(ch(a, 0), ch(b, 0), t));
  return (r << 16) | (g << 8) | bl;
}

/**
 * What the glass looks like with `pct` per cent of `film` on it.
 *
 * Pure arithmetic, and deliberately not a THREE material: this is the
 * half of the job a node test can check, and cars.ts is the half that
 * needs a renderer. Everything the shop claims about these three
 * products comes out of here, so tests/tint.mjs can hold it to it.
 */
export function glassLook(film: TintFilm | undefined, pct: number): GlassLook {
  const t = Math.max(0, Math.min(100, pct)) / 100;
  // No film is no tint, whatever the slider says. The darkness is free
  // and the product is not, so the product is what gates it.
  if (!film || t === 0) {
    return {
      opacity: CLEAR_OPACITY,
      color: FACTORY_GLASS,
      envMapIntensity: 1.35,
      roughness: 0.05,
    };
  }
  const f = FILMS[film];
  return {
    opacity: CLEAR_OPACITY + t * 0.34,
    color: mixHex(FACTORY_GLASS, f.core, t),
    envMapIntensity: 1.35 + t * f.sheen,
    roughness: 0.05 + t * f.haze,
  };
}
