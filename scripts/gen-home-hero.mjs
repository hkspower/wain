#!/usr/bin/env node
/**
 * The home hero picture, for the site and the app:   npm run home-hero
 *
 * The master is `brand-source/home-hero.png` (1080×1920) — a finished
 * illustration supplied by the owner on 2 October, used as it is: the wordmark,
 * the question and the sun are part of the picture, not drawn over it. This
 * writes what ships from it:
 *
 *   public/home/hero-<hash>-{720,1080}.{avif,webp}   the site (hash = the master's)
 *   src/lib/home-hero.g.ts                           their paths and the geometry below
 *   flutter_app/assets/img/home-hero.webp            the app
 *   flutter_app/lib/data/home_hero.g.dart            the same geometry, for the app
 *
 * The file names carry the master's hash because `.htaccess` caches stable-named
 * media for a week: a new picture under an old name would be served stale for
 * a week to everyone who had seen the old one.
 *
 * `--check` re-renders the two text files and fails when either differs or an
 * image is missing (wired into audit:flutter and audit:home-hero). It does not
 * compare image bytes: an encoder upgrade would fail it for no visible reason.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = join(ROOT, "brand-source/home-hero.png");
const WEB_DIR = join(ROOT, "public/home");
const TS_OUT = join(ROOT, "src/lib/home-hero.g.ts");
const APP_IMG = join(ROOT, "flutter_app/assets/img/home-hero.webp");
const DART_OUT = join(ROOT, "flutter_app/lib/data/home_hero.g.dart");

/**
 * Where things are in the master, in its own pixels — measured, not guessed.
 *
 * SUN: the disc's outer edge, its 6px amber rim included. Row 1004 runs sky →
 * rim at x 255 → fill at 261; column 540 runs sky → rim at y 720 → fill at 726.
 * Both put the edge 285px from (540, 1004). The bottom of the disc is behind
 * the city and the right of it behind the Kuwait Towers, which is fine: the
 * whole disc is the button, the label is not.
 *
 * LABEL: the part of the disc nothing stands in front of — right of the
 * Liberation Tower's pod (it ends at x 270), left of the big sphere (x 662) and
 * the lower one (x 695), above the city (y 1150). «إلى وين؟» and «ابحث» go
 * here and nowhere else; audit:home-hero samples the master under them and
 * requires the disc's own yellow.
 *
 * EDGE: the colour bands at the picture's left and right edges, top to bottom
 * — sky, the mint city, the dark shore, five bands of sea. On a screen wider
 * than the picture these are drawn out to the sides, so the sky and the sea
 * carry on instead of the picture sitting in a box. Read off columns 0–6 and
 * 1073–1079; where the two sides differ (the clock tower's base reaches the
 * right edge at y 1250–1315) the mint wins and the picture's own edge is faded
 * into it, over 6% of its width each side. The thin dashed wave at y ~1430 is left out — drawn out to the
 * sides it would be a solid white line.
 */
const SIZE = { width: 1080, height: 1920 };
const SUN = { cx: 540, cy: 1004, r: 285 };
const LABEL = { x0: 290, y0: 880, x1: 640, y1: 1110 };
const EDGE = [
  // The sky is a curve, not a line: two stops left it 2–3 units darker than
  // the picture at mid-height, and that is enough to see the picture's box.
  [0, "#fdf9f0"], [250, "#fcf6ea"], [500, "#fbf3e4"], [750, "#faf0de"],
  [1000, "#f8ebd5"], [1100, "#f8e9d2"], [1204, "#f7e6cd"],
  [1205, "#b5d8c2"], [1315, "#b5d8c2"],
  [1316, "#063d23"], [1347, "#063d23"],
  [1348, "#78caf2"], [1399, "#76c7ee"],
  [1400, "#49ace1"], [1430, "#46a7dc"],
  [1431, "#2492cc"], [1564, "#2492cc"],
  [1565, "#1c7cb2"], [1699, "#1c7cb2"],
  [1700, "#156897"], [1835, "#156897"],
  [1836, "#0e527c"], [1920, "#0e527c"],
];

const master = readFileSync(MASTER);
const meta = await sharp(master).metadata();
if (meta.width !== SIZE.width || meta.height !== SIZE.height) {
  console.error(`home-hero.png is ${meta.width}×${meta.height}; the geometry above was measured on ${SIZE.width}×${SIZE.height}. Re-measure before changing SIZE.`);
  process.exit(1);
}
const hash = createHash("sha256").update(master).digest("hex").slice(0, 10);
const WIDTHS = [720, 1080];
const webName = (w, ext) => `hero-${hash}-${w}.${ext}`;

const pct = (v, of) => +((v / of) * 100).toFixed(3);
const edgeGradient = EDGE.map(([y, c]) => `${c} ${pct(y, SIZE.height)}%`).join(", ");

const ts = `// GENERATED — do not edit by hand.
// Produced by scripts/gen-home-hero.mjs from brand-source/home-hero.png;
// the measurements and why each one is what it is are in that script.
// Re-run \`npm run home-hero\` after replacing the picture.

export const HOME_HERO = {
  width: ${SIZE.width},
  height: ${SIZE.height},
  avif: "${WIDTHS.map((w) => `/home/${webName(w, "avif")} ${w}w`).join(", ")}",
  webp: "${WIDTHS.map((w) => `/home/${webName(w, "webp")} ${w}w`).join(", ")}",
  src: "/home/${webName(1080, "webp")}",
  /** The sun disc, in % of the picture's width (x, r) and height (y). */
  sun: { x: ${pct(SUN.cx, SIZE.width)}, y: ${pct(SUN.cy, SIZE.height)}, r: ${pct(SUN.r, SIZE.width)} },
  /** Where the label may sit, in % of the picture's width and height. */
  label: { x0: ${pct(LABEL.x0, SIZE.width)}, y0: ${pct(LABEL.y0, SIZE.height)}, x1: ${pct(LABEL.x1, SIZE.width)}, y1: ${pct(LABEL.y1, SIZE.height)} },
  /** The picture's edge colours, top to bottom, as a CSS gradient's stops. */
  edge: "${edgeGradient}",
} as const;

/** The same numbers in the master's own pixels, for audit:home-hero. */
export const HOME_HERO_PX = ${JSON.stringify({ size: SIZE, sun: SUN, label: LABEL })} as const;
`;

const dartColor = (hex) => `Color(0xFF${hex.slice(1).toUpperCase()})`;
const dart = `// GENERATED — do not edit by hand.
// Produced by scripts/gen-home-hero.mjs from brand-source/home-hero.png (the
// web's src/lib/home-hero.g.ts carries the same numbers). Re-run
// \`npm run home-hero\` after replacing the picture.

import 'dart:ui';

const String kHomeHeroAsset = 'assets/img/home-hero.webp';
const double kHomeHeroWidth = ${SIZE.width};
const double kHomeHeroHeight = ${SIZE.height};

/// The sun disc, as fractions of the picture's width (x, r) and height (y).
const double kHomeHeroSunX = ${SUN.cx / SIZE.width};
const double kHomeHeroSunY = ${SUN.cy / SIZE.height};
const double kHomeHeroSunR = ${SUN.r / SIZE.width};

/// Where the label may sit, as fractions of width (x) and height (y).
const Rect kHomeHeroLabel = Rect.fromLTRB(${LABEL.x0 / SIZE.width}, ${LABEL.y0 / SIZE.height}, ${LABEL.x1 / SIZE.width}, ${LABEL.y1 / SIZE.height});

/// The picture's edge colours, top to bottom, for the bands beside it.
const List<Color> kHomeHeroEdgeColors = [${EDGE.map(([, c]) => dartColor(c)).join(", ")}];
const List<double> kHomeHeroEdgeStops = [${EDGE.map(([y]) => +(y / SIZE.height).toFixed(5)).join(", ")}];
`;

const images = [
  ...WIDTHS.flatMap((w) => [
    [join(WEB_DIR, webName(w, "avif")), (s) => s.resize({ width: w }).avif({ quality: 60, effort: 6 })],
    [join(WEB_DIR, webName(w, "webp")), (s) => s.resize({ width: w }).webp({ quality: 85, effort: 6 })],
  ]),
  [APP_IMG, (s) => s.webp({ quality: 88, effort: 6 })],
];

if (process.argv.includes("--check")) {
  const stale = [];
  if (!existsSync(TS_OUT) || readFileSync(TS_OUT, "utf8") !== ts) stale.push("src/lib/home-hero.g.ts");
  if (!existsSync(DART_OUT) || readFileSync(DART_OUT, "utf8") !== dart) stale.push("flutter_app/lib/data/home_hero.g.dart");
  for (const [file] of images) if (!existsSync(file)) stale.push(file.slice(ROOT.length + 1));
  const extra = existsSync(WEB_DIR) ? readdirSync(WEB_DIR).filter((f) => f.startsWith("hero-") && !f.includes(hash)) : [];
  extra.forEach((f) => stale.push(`public/home/${f} (an older picture's — delete it)`));
  if (stale.length) {
    console.error(`stale: ${stale.join(", ")}`);
    process.exit(1);
  }
  console.log(`current (${hash}, ${images.length} pictures)`);
  process.exit(0);
}

mkdirSync(WEB_DIR, { recursive: true });
for (const f of readdirSync(WEB_DIR)) if (f.startsWith("hero-") && !f.includes(hash)) unlinkSync(join(WEB_DIR, f));
for (const [file, encode] of images) {
  const buf = await encode(sharp(master)).toBuffer();
  writeFileSync(file, buf);
  console.log(`  ${file.slice(ROOT.length + 1)}  ${(buf.length / 1024).toFixed(1)}K`);
}
writeFileSync(TS_OUT, ts);
writeFileSync(DART_OUT, dart);
console.log(`  src/lib/home-hero.g.ts, flutter_app/lib/data/home_hero.g.dart  (${hash})`);
