/**
 * Real photographs of real places.
 *
 * Every picture on this site is drawn. `PlaceArt` gives the famous places a
 * hand-made scene and `CategoryArt` gives everything else its category's, and
 * that was a deliberate choice: it costs nothing, it never shows the wrong
 * building, and it looks like one site rather than a scrape. It is also, for a
 * place someone is deciding whether to drive to, less information than a
 * photograph.
 *
 * So a photo, where one exists, sits above both. The order is
 *
 *     photograph  →  the place's own drawing  →  the category's drawing
 *
 * and it degrades in that direction, which is why a place with no photograph
 * still looks finished rather than broken.
 *
 * ## What may go in here
 *
 * A picture of the place it names, and nothing else. Adobe Stock's reachable
 * collection, searched while this was written, has perhaps six genuinely
 * Kuwaiti photographs and several hundred «Arab market», «grand mosque» and
 * «old town» shots taken in Nizwa, Dubai, Marrakesh and Istanbul. Putting one
 * of those on سوق المباركية would be indistinguishable from doing the job, and
 * it would be a lie told to somebody about to drive across town. A drawing
 * never claims to be a specific building; a photograph always does.
 *
 * The same rule rules out a generated image of a real landmark. There is no
 * such thing as an AI photograph of أبراج الكويت — only a picture of something
 * that looks like it.
 *
 * ## Adding one
 *
 *   1. Put the original in `photos-src/<slug>.<ext>` — full resolution, as it
 *      came from the photographer or the library.
 *   2. Add the entry below.
 *   3. `npm run photos` — crops, resizes and compresses it into
 *      `public/photos/<slug>.jpg` within the byte budget.
 *   4. `npm run audit:photos` (it is in `npm run scan`) checks the two halves
 *      still agree.
 *
 * `photos-src/` is not committed. The web-sized output is, so a clone builds
 * the real site without needing the originals.
 */

export interface PlacePhoto {
  /**
   * Who took it, as it must appear. Written out even where the licence does
   * not force it: a photograph has an author, and the person who let us use
   * their picture of الكويت is the reason this page is not a drawing.
   */
  credit: string;
  /** The licence the credit satisfies — the words, not a guess. */
  licence: string;
  /** Where it came from, so it can be re-fetched or re-checked years later. */
  source: string;
  /**
   * What the picture SHOWS, in Arabic — not the name of the place, which the
   * heading beside it already says. A screen reader that hears «أبراج الكويت»
   * twice has learnt nothing the second time.
   */
  altAr: string;
  /**
   * True when the licence requires the credit to be visible on the page rather
   * than only in this file. Creative Commons does; most stock licences do not.
   */
  creditOnPage?: boolean;
}

/**
 * Keyed by place slug.
 *
 * Empty, and that is the honest state rather than an oversight. No source of
 * real Kuwaiti photography is reachable from the environment this was written
 * in: the open libraries are blocked by the network policy, the Adobe account
 * has no Stock plan, and neither the connected Lightroom nor the connected
 * Dropbox holds a photograph of a Kuwaiti place. `npm run audit:photos` says
 * so out loud on every scan instead of letting the gap pass unmentioned.
 */
export const PHOTOS: Record<string, PlacePhoto> = {};

/** The photograph for a place, if it has one. */
export function photoOf(slug: string): PlacePhoto | undefined {
  return PHOTOS[slug];
}

/**
 * Where the web-sized file lives. Same shape for every place, so nothing has
 * to store a path and no path can go stale against the file it names.
 */
export function photoSrc(slug: string): string {
  return `/photos/${slug}.jpg`;
}

/**
 * The shape every photograph is cropped to, and the size it is served at.
 *
 * 3:2 is the aspect of nearly every camera, so a cover-crop to it throws away
 * the least. 1200px covers the hero at two-times density on a phone and at
 * one-times on the widest desktop column the layout allows.
 */
export const PHOTO_WIDTH = 1200;
export const PHOTO_HEIGHT = 800;

/**
 * The most a single photograph may weigh, in bytes.
 *
 * A hero image is the first thing a place page paints and Kuwait is a mobile
 * market. 160KB is roughly what the whole of the shared JavaScript costs after
 * the split, and a photograph is not allowed to cost more than the app.
 */
export const PHOTO_MAX_BYTES = 160 * 1024;
