#!/usr/bin/env node
/**
 * The pictures of «معالم الكويت», for the site and the app:
 *     npm run landmarks
 *
 * Eight landmarks, each with one picture, used in up to three places — the
 * owner's picks on the 3 October design canvas:
 *
 *   - the slideshow under the home hero (SHOW, six of them, in play order);
 *   - the card of each place in the «معالم الكويت» category, in the 56px band
 *     the icon sat in (PLACE_SLOTS, five of them) — everywhere a card appears;
 *   - the top of those same five places' pages, at 3:2, the whole picture.
 *
 * The master for each is `brand-source/landmarks/<slug>.jpg` when it exists and
 * `brand-source/landmarks/<slug>.svg` otherwise:
 *
 *   - the .jpg is the real thing the owner asked for — a generated, realistic
 *     picture of the landmark, approved by eye before it is put here;
 *   - the .svg is a drawn stand-in. The pictures could not be generated when
 *     this was built (the image account had no credits), and everything was
 *     built and tested on these meanwhile.
 *
 * Every entry carries which one it is (`source`), and a drawing is not allowed
 * to reach the live site in any slot. The pages leave a stand-in out (the
 * slideshow all or nothing, a card or a page top place by place —
 * landmark-gate.ts); `--prune-out` takes its files out of the export; and
 * `deploy:plan` refuses an archive that carries one anyway. A preview build,
 * NEXT_PUBLIC_SHOW_STANDINS=1, shows them, marked, so the layout can be judged.
 *
 * A generated picture is not a photograph, and the site never says it is: it
 * never goes in photos.ts's PHOTOS, it carries «صورة توضيحية» wherever it is
 * shown, and a real photograph, once there is one, wins over it.
 *
 * Each picture is cut AROUND ITS LANDMARK, never around its middle. `focus` is
 * where the landmark sits in the picture, as fractions of its width and height;
 * the 3:2 files are cut around it when a master is not 3:2, the card strip
 * (3:1) always is, and the slideshow's boxes use it as their object-position.
 * Re-measure it when a picture is replaced — a strip cut around the old
 * picture's tower is a strip of sky.
 *
 * `alt` is what the APPROVED picture shows, written when it is approved; a
 * place page's picture is the only one that is not decorative (the slideshow's
 * and the cards' links already name the place). A real picture without one is
 * refused rather than shipped silent.
 *
 * Writes:
 *   public/home/landmarks/<slug>-<hash>-{480,960,1440}.{avif,webp}     3:2
 *   public/home/landmarks/<slug>-<hash>-card-{480,960}.{avif,webp}     3:1, the five
 *   src/lib/landmarks.g.ts         the slideshow's and the page tops' — server only
 *   src/lib/landmark-cards.g.ts    the cards' strips — PlaceCard reaches the browser,
 *                                  so this half carries nothing else
 *   flutter_app/assets/img/landmarks/<slug>.webp   the app (960×640)
 *   flutter_app/assets/img/landmarks/<slug>-card.webp   the app's strips (960×320),
 *                                  the five — the web's card-960 bytes, so a card
 *                                  shows the same cut on a phone and in the app
 *   flutter_app/lib/data/landmarks.g.dart          the app's tables
 *
 * The names carry a hash of what they were made from — the master, its focus
 * and the sizes, budgets and qualities below — for the reason gen-home-hero.mjs
 * gives: `.htaccess` caches stable-named media for a week.
 *
 * `--check` re-renders the text files and fails when one differs, an image is
 * missing, an older picture's files are left behind, a slug is not in the
 * catalogue or a real picture has no alt. It does not compare image bytes, so
 * an encoder upgrade does not fail it.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "brand-source/landmarks");
const WEB_DIR = join(ROOT, "public/home/landmarks");
const TS_OUT = join(ROOT, "src/lib/landmarks.g.ts");
const CARDS_OUT = join(ROOT, "src/lib/landmark-cards.g.ts");
const APP_DIR = join(ROOT, "flutter_app/assets/img/landmarks");
const DART_OUT = join(ROOT, "flutter_app/lib/data/landmarks.g.dart");

/**
 * The one table. `focus` is [x, y]: where the landmark is, as fractions of
 * the picture. `alt` stays null until the real picture is approved — see the
 * header. The stand-ins' focus points were measured on the drawings.
 */
export const TABLE = {
  "kuwait-towers": { focus: [0.52, 0.42], alt: null },
  "liberation-tower": { focus: [0.5, 0.3], alt: null },
  "grand-mosque": { focus: [0.5, 0.42], alt: null },
  "seif-palace": { focus: [0.5, 0.3], alt: null },
  "souq-al-mubarakiya": { focus: [0.5, 0.45], alt: null },
  "marina-beach": { focus: [0.6, 0.62], alt: null },
  "al-hamra-tower": { focus: [0.52, 0.35], alt: null },
  "sheikh-jaber-causeway": { focus: [0.55, 0.5], alt: null },
};

/** The slideshow, in the order it plays — the owner kept it at six. */
export const SHOW = [
  "kuwait-towers",
  "liberation-tower",
  "grand-mosque",
  "seif-palace",
  "souq-al-mubarakiya",
  "marina-beach",
];

/** The places whose card and page carry their picture: the category's five. */
export const PLACE_SLOTS = [
  "kuwait-towers",
  "liberation-tower",
  "seif-palace",
  "al-hamra-tower",
  "sheikh-jaber-causeway",
];

const SLIDE = { ratio: 3 / 2, widths: [480, 960, 1440] };
const CARD = { ratio: 3 / 1, widths: [480, 960] };
const APP_WIDTH = 960;

/**
 * The most each file may weigh. A picture is walked down in quality until it
 * fits, the way gen-photos.mjs does, and refused if it never does — the home
 * page carries six of these and a phone in Kuwait pays for every one.
 */
const BUDGET = {
  avif: { 480: 28, 960: 80, 1440: 160, "card-480": 12, "card-960": 36 },
  webp: { 480: 40, 960: 120, 1440: 240, "card-480": 18, "card-960": 56 },
};
const QUALITY = { avif: { start: 60, floor: 40 }, webp: { start: 82, floor: 62 } };
const RECIPE = JSON.stringify({ SLIDE, CARD, BUDGET, QUALITY });

// ── the catalogue: every slug real, every slot a «معالم الكويت» place ────────
const bundled = await build({
  entryPoints: [join(ROOT, "src/lib/places.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  logLevel: "silent",
  alias: { "@": join(ROOT, "src") },
});
const { places } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const bySlug = new Map(places.map((p) => [p.slug, p]));
const problems = [];
for (const slug of new Set([...SHOW, ...PLACE_SLOTS, ...Object.keys(TABLE)])) {
  if (!bySlug.has(slug)) problems.push(`${slug} is not in places.ts`);
  if (!TABLE[slug]) problems.push(`${slug} is used but has no row in TABLE`);
}
for (const slug of PLACE_SLOTS) {
  const p = bySlug.get(slug);
  if (p && p.category !== "landmarks") problems.push(`${slug} is in PLACE_SLOTS but its category is ${p.category}, not landmarks`);
}

const slugs = Object.keys(TABLE);
const entries = slugs.map((slug) => {
  const jpg = join(SRC, `${slug}.jpg`);
  const svg = join(SRC, `${slug}.svg`);
  const file = existsSync(jpg) ? jpg : existsSync(svg) ? svg : null;
  if (!file) {
    problems.push(`no master for ${slug}: put brand-source/landmarks/${slug}.jpg (or the .svg stand-in) back`);
    return null;
  }
  const bytes = readFileSync(file);
  const { focus, alt } = TABLE[slug];
  const source = file === jpg ? "ai" : "stand-in";
  if (source === "ai" && !alt) problems.push(`${slug} is a real picture with no alt — write what it shows in TABLE`);
  const name = bySlug.get(slug)?.nameAr ?? slug;
  return {
    slug,
    bytes,
    source,
    focus,
    // A stand-in is only ever seen in a preview build, and it says what it is.
    alt: source === "ai" ? alt : `رسم مؤقت: ${name}`,
    // Everything that decides a file's bytes is in its name: the master, the
    // focus it is cut around (always for a strip, and for a 3:2 file whenever
    // the master is not 3:2) and the encoder's recipe. A name that survived a
    // re-cut or a new budget would be served from week-old caches as the old
    // bytes.
    hash: createHash("sha256").update(bytes).update(RECIPE).update(String(focus)).digest("hex").slice(0, 10),
  };
});
if (problems.length) {
  console.error(problems.map((p) => `  ✗ ${p}`).join("\n"));
  process.exit(1);
}
const E = Object.fromEntries(entries.map((e) => [e.slug, e]));

const slideName = (e, w, ext) => `${e.slug}-${e.hash}-${w}.${ext}`;
const cardName = (e, w, ext) => `${e.slug}-${e.hash}-card-${w}.${ext}`;
const srcset = (e, name, widths, ext) => widths.map((w) => `/home/landmarks/${name(e, w, ext)} ${w}w`).join(", ");

const ts = `// GENERATED — do not edit by hand.
// Produced by scripts/gen-landmarks.mjs from brand-source/landmarks/; why the
// masters are what they are, and what «stand-in» means, is in that script.
// Re-run \`npm run landmarks\` after replacing a picture.
//
// Server only: the slideshow's rows are handed to it as props, and the page
// tops are rendered on the server. The cards' strips are in landmark-cards.g.ts.

export type LandmarkSource = "ai" | "stand-in";

export interface LandmarkPicture {
  slug: string;
  avif: string;
  webp: string;
  src: string;
  width: number;
  height: number;
  /** Where the landmark sits, as fractions of the picture's width and height. */
  focus: readonly [number, number];
  /** What the approved picture shows; only a place page's picture uses it. */
  alt: string;
  source: LandmarkSource;
}

export const LANDMARKS: readonly LandmarkPicture[] = [
${entries
  .map(
    (e) => `  {
    slug: "${e.slug}",
    avif: "${srcset(e, slideName, SLIDE.widths, "avif")}",
    webp: "${srcset(e, slideName, SLIDE.widths, "webp")}",
    src: "/home/landmarks/${slideName(e, 960, "webp")}",
    width: 960,
    height: 640,
    focus: [${e.focus.join(", ")}],
    alt: "${e.alt}",
    source: "${e.source}",
  },`,
  )
  .join("\n")}
];

/** The slideshow under the home hero, in the order it plays. */
export const SHOW: readonly string[] = [${SHOW.map((s) => `"${s}"`).join(", ")}];

/** The places whose card and page carry their picture. */
export const PLACE_SLOTS: readonly string[] = [${PLACE_SLOTS.map((s) => `"${s}"`).join(", ")}];
`;

const cardEntry = (e, pad) =>
  [
    `{`,
    `  slug: "${e.slug}",`,
    `  avif: "${srcset(e, cardName, CARD.widths, "avif")}",`,
    `  webp: "${srcset(e, cardName, CARD.widths, "webp")}",`,
    `  src: "/home/landmarks/${cardName(e, 480, "webp")}",`,
    `  width: 480,`,
    `  height: 160,`,
    `  source: "${e.source}",`,
    `},`,
  ]
    .map((line) => pad + line)
    .join("\n");
const realCards = PLACE_SLOTS.map((s) => E[s]).filter((e) => e.source === "ai");
const drawnCards = PLACE_SLOTS.map((s) => E[s]).filter((e) => e.source !== "ai");
const cardsTs = `// GENERATED — do not edit by hand.
// Produced by scripts/gen-landmarks.mjs. The card strips only: PlaceCard is
// rendered inside client components, so whatever this file holds reaches the
// browser — the slideshow's and the page tops' files are in landmarks.g.ts.
//
// The drawn stand-ins sit behind the preview switch, which next.config.ts
// defines in every build: a normal build folds it to false and drops them, so
// no JavaScript the site ships names a file the export left out.

export interface LandmarkCard {
  slug: string;
  avif: string;
  webp: string;
  src: string;
  width: number;
  height: number;
  source: "ai" | "stand-in";
}

export const LANDMARK_CARDS: readonly LandmarkCard[] = [
${realCards.map((e) => cardEntry(e, "  ")).join("\n")}${realCards.length && drawnCards.length ? "\n" : ""}${
  drawnCards.length
    ? `  ...(process.env.NEXT_PUBLIC_SHOW_STANDINS === "1"
    ? ([
${drawnCards.map((e) => cardEntry(e, "        ")).join("\n")}
      ] as LandmarkCard[])
    : []),`
    : ""
}
];
`;

const dart = `// GENERATED — do not edit by hand.
// Produced by scripts/gen-landmarks.mjs from brand-source/landmarks/ (the
// web's src/lib/landmarks.g.ts lists the same eight). Re-run
// \`npm run landmarks\` after replacing a picture.

class LandmarkPicture {
  const LandmarkPicture(
    this.slug,
    this.asset, {
    required this.focusX,
    required this.focusY,
    required this.alt,
    required this.standIn,
    this.cardAsset,
  });
  final String slug;
  final String asset;

  /// The card's strip, cut around the landmark when it was made (3:1) — the
  /// web's card file. Null outside the five «معالم الكويت» places.
  final String? cardAsset;

  /// Where the landmark sits, as fractions of the picture's width and height.
  final double focusX, focusY;

  /// What the approved picture shows; only a place page's picture uses it.
  final String alt;

  /// A drawn placeholder rather than the approved picture.
  final bool standIn;
}

/// All eight, by slug.
const Map<String, LandmarkPicture> kLandmarkPictures = {
${entries.map((e) => `  '${e.slug}': LandmarkPicture('${e.slug}', 'assets/img/landmarks/${e.slug}.webp', focusX: ${e.focus[0]}, focusY: ${e.focus[1]}, alt: '${e.alt}', standIn: ${e.source !== "ai"}${PLACE_SLOTS.includes(e.slug) ? `, cardAsset: 'assets/img/landmarks/${e.slug}-card.webp'` : ""}),`).join("\n")}
};

/// The slideshow under the home hero, in the order it plays.
final List<LandmarkPicture> kLandmarks = [
${SHOW.map((s) => `  kLandmarkPictures['${s}']!,`).join("\n")}
];

/// The places whose card and page carry their picture.
const Set<String> kLandmarkPlaceSlots = {${PLACE_SLOTS.map((s) => `'${s}'`).join(", ")}};
`;

/**
 * The part of a W×H master that has the target ratio and the landmark in it:
 * the whole of one side, and a window of the other placed around the focus,
 * kept inside the picture.
 */
function cut(W, H, ratio, [fx, fy]) {
  if (W / H > ratio) {
    const w = Math.round(H * ratio);
    const left = Math.min(Math.max(Math.round(fx * W - w / 2), 0), W - w);
    return { left, top: 0, width: w, height: H };
  }
  const h = Math.round(W / ratio);
  const top = Math.min(Math.max(Math.round(fy * H - h / 2), 0), H - h);
  return { left: 0, top, width: W, height: h };
}

// An SVG has no pixels of its own, so it is rasterised once, large enough for
// the biggest file, rather than drawn small and scaled up.
const rasters = new Map();
async function raster(e) {
  if (!rasters.has(e.slug)) {
    const input = e.source === "ai" ? sharp(e.bytes) : sharp(e.bytes, { density: Math.ceil((72 * 1440) / 600) });
    const png = await input.flatten({ background: "#ffffff" }).png().toBuffer();
    const { width, height } = await sharp(png).metadata();
    rasters.set(e.slug, { png, width, height });
  }
  return rasters.get(e.slug);
}

async function render(e, ratio, w) {
  const r = await raster(e);
  return sharp(r.png)
    .extract(cut(r.width, r.height, ratio, e.focus))
    .resize({ width: w, height: Math.round(w / ratio) });
}

async function encode(e, ratio, w, ext, budgetKey) {
  const kb = BUDGET[ext][budgetKey];
  const { start, floor } = QUALITY[ext];
  for (let q = start; q >= floor; q -= 5) {
    const img = await render(e, ratio, w);
    const buf = await (ext === "avif" ? img.avif({ quality: q, effort: 6 }) : img.webp({ quality: q, effort: 6 })).toBuffer();
    if (buf.length <= kb * 1024) return buf;
  }
  throw new Error(`${e.slug} ${budgetKey}.${ext} is over its ${kb}K budget even at quality ${floor}`);
}

const images = [];
for (const e of entries) {
  for (const w of SLIDE.widths) {
    for (const ext of ["avif", "webp"]) images.push([join(WEB_DIR, slideName(e, w, ext)), () => encode(e, SLIDE.ratio, w, ext, w)]);
  }
  if (PLACE_SLOTS.includes(e.slug)) {
    for (const w of CARD.widths) {
      for (const ext of ["avif", "webp"]) images.push([join(WEB_DIR, cardName(e, w, ext)), () => encode(e, CARD.ratio, w, ext, `card-${w}`)]);
    }
    images.push([join(APP_DIR, `${e.slug}-card.webp`), () => encode(e, CARD.ratio, 960, "webp", "card-960")]);
  }
  images.push([join(APP_DIR, `${e.slug}.webp`), async () => (await render(e, SLIDE.ratio, APP_WIDTH)).webp({ quality: 85, effort: 6 }).toBuffer()]);
}

const wanted = new Set(images.map(([f]) => f));
const leftovers = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => !wanted.has(join(dir, f))) : []);
const standIns = entries.filter((e) => e.source !== "ai").map((e) => e.slug);

// After `next build`: the files of every slot the pages leave out are dropped
// from the export too — a drawing uploaded and served to nobody is still a
// drawing on the live host. A preview build (NEXT_PUBLIC_SHOW_STANDINS=1) keeps
// what it shows. The rules are landmark-gate.ts's: the slideshow all or
// nothing, a card or a page top place by place.
if (process.argv.includes("--prune-out")) {
  const outDir = join(ROOT, "out/home/landmarks");
  const preview = process.env.NEXT_PUBLIC_SHOW_STANDINS === "1";
  const shown = (slug) => preview || E[slug].source === "ai";
  const keep = new Set();
  if (SHOW.every(shown)) for (const s of SHOW) SLIDE.widths.forEach((w) => ["avif", "webp"].forEach((x) => keep.add(slideName(E[s], w, x))));
  for (const s of PLACE_SLOTS.filter(shown)) {
    SLIDE.widths.forEach((w) => ["avif", "webp"].forEach((x) => keep.add(slideName(E[s], w, x))));
    CARD.widths.forEach((w) => ["avif", "webp"].forEach((x) => keep.add(cardName(E[s], w, x))));
  }
  let dropped = 0;
  if (existsSync(outDir)) {
    for (const f of readdirSync(outDir)) if (!keep.has(f)) { unlinkSync(join(outDir, f)); dropped++; }
    if (readdirSync(outDir).length === 0) rmdirSync(outDir);
  }
  console.log(
    `landmarks: ${keep.size} picture file(s) shipped, ${dropped} left out` +
      (standIns.length ? ` (${standIns.length} stand-in(s)${preview ? ", shown — preview build" : ""})` : ""),
  );
  process.exit(0);
}

if (process.argv.includes("--check")) {
  const stale = [];
  if (!existsSync(TS_OUT) || readFileSync(TS_OUT, "utf8") !== ts) stale.push("src/lib/landmarks.g.ts");
  if (!existsSync(CARDS_OUT) || readFileSync(CARDS_OUT, "utf8") !== cardsTs) stale.push("src/lib/landmark-cards.g.ts");
  if (!existsSync(DART_OUT) || readFileSync(DART_OUT, "utf8") !== dart) stale.push("flutter_app/lib/data/landmarks.g.dart");
  for (const [file] of images) if (!existsSync(file)) stale.push(file.slice(ROOT.length + 1));
  leftovers(WEB_DIR).forEach((f) => stale.push(`public/home/landmarks/${f} (not a current picture's — delete it)`));
  leftovers(APP_DIR).forEach((f) => stale.push(`flutter_app/assets/img/landmarks/${f} (not a current picture's — delete it)`));
  if (stale.length) {
    console.error(`stale: ${stale.join(", ")}`);
    process.exit(1);
  }
  console.log(
    `current (${entries.length} landmarks, ${images.length} pictures` +
      (standIns.length ? `; ${standIns.length} still drawn stand-ins: ${standIns.join(", ")}` : "") + ")",
  );
  process.exit(0);
}

mkdirSync(WEB_DIR, { recursive: true });
mkdirSync(APP_DIR, { recursive: true });
for (const f of leftovers(WEB_DIR)) unlinkSync(join(WEB_DIR, f));
for (const f of leftovers(APP_DIR)) unlinkSync(join(APP_DIR, f));
// Only what changed is written: a file rewritten with the same bytes is still
// newer than the export, and the browser suites refuse a build older than
// src/ (tests/stale-build.mjs).
const same = (file, data) => existsSync(file) && readFileSync(file).equals(Buffer.from(data));
for (const [file, make] of images) {
  const buf = await make();
  if (!same(file, buf)) writeFileSync(file, buf);
  console.log(`  ${file.slice(ROOT.length + 1)}  ${(buf.length / 1024).toFixed(1)}K`);
}
for (const [file, text] of [[TS_OUT, ts], [CARDS_OUT, cardsTs], [DART_OUT, dart]]) if (!same(file, text)) writeFileSync(file, text);
console.log("  src/lib/landmarks.g.ts, src/lib/landmark-cards.g.ts, flutter_app/lib/data/landmarks.g.dart");
if (standIns.length) console.log(`\n! ${standIns.length} of ${entries.length} are drawn stand-ins (${standIns.join(", ")}) — the pages leave them out and deploy:plan refuses them.`);
