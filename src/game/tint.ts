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
// — dyed or carbon — and then you say how dark. The price is per
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
//             that stays charcoal, and no metal in it. The one you
//             actually want, and what every tinted car in this game was
//             wearing before any of it was for sale.
//
// THERE WERE THREE
//
// A ceramic roll sat above carbon at 1400 KD, and tools/shots/tint.mjs
// refused it. Over the glass pixels — the only place a window film can
// show — dyed differs from carbon by 23 of 255. Ceramic differed from
// carbon by 1.21, and four attempts to widen it got to 2.95: a colour
// push, a reflectivity push, and a clearcoat layer added specifically
// for the job. The reason is the material rather than the numbers. At
// 86% opacity this glass propagates TRANSMISSION differences — how much
// of the cabin shows through, which is exactly why dyed reads as a
// different film — and swallows colour and specular ones. Ceramic and
// carbon are two products that differ in clarity, and clarity is the
// thing this surface cannot show.
//
// So the shelf is two. A third entry at nearly three times the price of
// the second, rendering a window nobody could tell from it, would have
// been the shop lying about what it sells.
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
export type TintFilm = "dyed" | "carbon";

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
   * is flat and reads as a painted panel; carbon keeps enough of an
   * optical surface to throw the sodium lights back at you.
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
  /**
   * The optical surface on top of the film, 0 to 1. A clearcoat layer,
   * in the material.
   *
   * A clearcoat is a second specular lobe laid OVER the surface, which
   * is what the thing being modelled physically is: a smooth film
   * surface on top of a dark layer. Cheap film has no such surface to
   * speak of.
   *
   * It is here because it is right, not because it rescued anything. It
   * was added to try to tell a ceramic roll from a carbon one and moved
   * that difference by 0.02 of 255 — on a surface this opaque the
   * highlight has almost nothing to catch at two in the morning. The
   * roll it was meant to justify is gone; the layer stays, because a
   * dyed window and a carbon one genuinely do differ in it.
   */
  coat: number;
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
    coat: 0,
  },
  carbon: {
    name: "Carbon Film",
    arabic: "فيلم كاربون",
    core: 0x0b0b0c,
    sheen: 0.5,
    haze: 0.02,
    coat: 0.3,
  },
};

export const FILM_IDS: readonly TintFilm[] = ["dyed", "carbon"];

export interface GlassLook {
  /** 0-1. Never 1: a window you cannot see into at all has stopped
   *  being glass and become a painted panel. */
  opacity: number;
  color: number;
  envMapIntensity: number;
  roughness: number;
  /** Strength of the clearcoat lobe, 0-1. */
  clearcoat: number;
  /** How sharp that lobe is. Follows the film's haze: a cheap surface
   *  scatters its highlight as well as its transmission. */
  clearcoatRoughness: number;
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
      clearcoat: 0,
      clearcoatRoughness: 0,
    };
  }
  const f = FILMS[film];
  return {
    opacity: CLEAR_OPACITY + t * 0.34,
    color: mixHex(FACTORY_GLASS, f.core, t),
    envMapIntensity: 1.35 + t * f.sheen,
    roughness: 0.05 + t * f.haze,
    // The coat comes on with the film, because it IS the film's own
    // surface — there is no clearcoat on bare glass here.
    clearcoat: t * f.coat,
    clearcoatRoughness: 0.02 + f.haze * 4,
  };
}
