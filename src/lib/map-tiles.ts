/**
 * Where the live map's tiles come from.
 *
 * The static frame on every map is an OpenStreetMap *embed* — their own
 * `export/embed.html` in a sandboxed iframe — and that is a product OSM
 * publishes for exactly this. The live map is a different relationship: it
 * asks their tile servers for images directly, and that is governed by the
 * tile usage policy rather than by the embed's existence. Two obligations
 * come with it and both are met here rather than assumed:
 *
 *   1. **Attribution on screen.** `ATTRIBUTION_AR` is rendered by every map
 *      that uses these tiles, not buried in a credits page.
 *   2. **Modest use.** The live map is opt-in — nothing fetches a tile until
 *      a visitor asks to move the map — so tiles cost a fraction of page
 *      views rather than one full basemap per view. That is the main reason
 *      the interactive map is a second mode instead of the only mode.
 *
 * **If this site ever gets real traffic, move off these tiles.** That is what
 * `NEXT_PUBLIC_WAIN_TILES` is for: point it at a provider with a plan and the
 * live map follows, with no code change. The variable is read the way every
 * other switch in this repository is — `||` rather than `??`, because an unset
 * GitHub Actions variable expands to `""` and `??` passes the empty string
 * through as the value (`wain-ai.ts` has the measurement). Write «none» to
 * take the live map away entirely and leave every map exactly as it was.
 *
 * NOTHING HERE MAY IMPORT THE CATALOGUE — same rule as `place-kit.ts`. This is
 * reachable from the search map, which is on a route `audit:js` watches.
 */

/**
 * The default tile template.
 *
 * No `{s}` subdomain placeholder: OSM asked people to stop using a, b and c
 * years ago — one host, HTTP/2, and a browser multiplexes the requests over a
 * single connection rather than opening three. A template carrying `{s}` also
 * has to be added to the CSP three times.
 */
const DEFAULT_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const CONFIGURED = process.env.NEXT_PUBLIC_WAIN_TILES || DEFAULT_TILES;

/** Empty when the live map is switched off, which every caller treats as «stay static». */
export const TILE_URL = CONFIGURED.trim().toLowerCase() === "none" ? "" : CONFIGURED;

/** Whether a live map can be offered at all. */
export const liveMapEnabled = TILE_URL.length > 0;

/**
 * Shown on the map itself, in Arabic, beside the © the data requires.
 *
 * Leaflet's own attribution control is not used: it renders an English string
 * with a Leaflet backlink in a corner box, laid out for a language that reads
 * the other way, on a page that is `dir="rtl"` throughout. The obligation is
 * to credit the data, and that is done in the site's own voice and its own
 * direction. (The phrasing avoids the hyphenated «left-…» spelling on
 * purpose: `audit:css` matches physical direction utilities line by line and
 * does not know a comment from code, so prose can fail it.)
 */
export const ATTRIBUTION_AR = "بيانات الخريطة © المساهمين في OpenStreetMap";

/**
 * How far in the live map may be zoomed.
 *
 * 19 is as deep as OSM renders; asking for 20 does not fail, it serves a
 * blurry upscale of 19 and looks like a broken tile server. The floor is the
 * whole country and a little sea — there is nothing below it worth panning to
 * on a site about one place to go tonight.
 */
export const MAX_ZOOM = 19;
export const MIN_ZOOM = 7;
