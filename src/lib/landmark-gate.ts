/**
 * Whether a generated landmark picture may be shown.
 *
 * The pictures of «معالم الكويت» (scripts/gen-landmarks.mjs) were built on
 * drawn stand-ins, because the real ones could not be generated yet, and a
 * drawing must not reach the live site where the owner asked for a realistic
 * picture. So every slot asks this first:
 *
 *   - the slideshow under the home hero is all or nothing — half real and
 *     half drawn would be worse than the section not being there;
 *   - a card or a page top goes place by place — a place whose picture is not
 *     ready keeps its icon and its drawing, which is what it had before.
 *
 * A preview build (NEXT_PUBLIC_SHOW_STANDINS=1) shows the stand-ins, marked,
 * so the layout can be judged before the pictures exist. `--prune-out` and
 * deploy:plan keep such a build from shipping.
 *
 * Nothing here may import a data file: PlaceCard reaches the browser, and so
 * would whatever this imported.
 */
export const SHOW_STANDINS = process.env.NEXT_PUBLIC_SHOW_STANDINS === "1";

export function shown(picture: { source: string }): boolean {
  return picture.source === "ai" || SHOW_STANDINS;
}
