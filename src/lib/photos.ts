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
 * The same, keyed by area id — see `areas.ts`.
 *
 * Also empty, and for a reason worth writing down rather than re-discovering:
 * **genuine photographs of Kuwait exist and this account cannot license
 * them.** Re-checked 20 September against Adobe Stock, which is the one
 * library reachable here:
 *
 *   - `Kuwait` returns **45 assets**, of which about seven are actually of
 *     Kuwait — the city skyline (242691058, 588611620, 486154484, 514653680),
 *     the Grand Mosque (148852369) and Kuwait Towers (236264025, 244121505).
 *   - `asset_license_and_download_stock` on the first of those answers
 *     `not_possible` — «Get started with a free trial». Search works without
 *     a plan; licensing does not, and an unlicensed thumbnail is 240px wide.
 *   - Searching for an AREA is worse than empty. Kuwaiti neighbourhoods —
 *     Salmiya, the streets, the suburbs — return Vancouver, Leeds,
 *     Kensington, Calgary, Chiswick, Tallinn, Ayia Napa and Dallas. Not one
 *     Kuwait photograph, which is the «several hundred lookalikes» problem
 *     above in its purest form: a plausible-looking answer to the exact
 *     question, and every one of them wrong.
 *   - Dropbox holds wain's own exported `og/*.jpg` — drawings — and a scan of
 *     a civil ID. No photography.
 *
 * So the four city-skyline shots would genuinely serve `kuwait-city`, and the
 * rest of the country has nothing. The moment there is a Stock plan, those
 * asset ids are the shortlist: license one, drop it in `photos-src/`, add the
 * entry, `npm run photos`.
 */
export const AREA_PHOTOS: Record<string, PlacePhoto> = {};

/** The photograph for an area, if it has one. */
export function areaPhotoOf(id: string): PlacePhoto | undefined {
  return AREA_PHOTOS[id];
}

/** Where an area's web-sized file lives. Same shape rule as `photoSrc`. */
export function areaPhotoSrc(id: string): string {
  return `/photos/areas/${id}.jpg`;
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
