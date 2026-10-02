#!/usr/bin/env node
/**
 * «معالم الكويت», the slideshow under the home hero, for the site and the app:
 *     npm run landmarks
 *
 * One picture per landmark, in the order the slideshow plays them. The master
 * for each is `brand-source/landmarks/<slug>.jpg` when it exists and
 * `brand-source/landmarks/<slug>.svg` otherwise:
 *
 *   - the .jpg is the real thing the owner asked for on 2 October — a
 *     generated, realistic picture of the landmark, approved by eye;
 *   - the .svg is a drawn stand-in, from the design canvas the owner picked
 *     the slideshow from. It exists because the pictures could not be
 *     generated that night (the image account had no credits), and the strip
 *     was built and tested on these meanwhile.
 *
 * Every entry carries which one it is (`source`), and the stand-ins are not
 * allowed to reach the live site: `deploy:plan` refuses an archive whose
 * landmarks.g.ts still names one, and audit:home-hero warns while any is left.
 * Dropping the six .jpg files in and re-running this is the whole swap.
 *
 * NOT `photos.ts`. That file's rule — no generated picture of a real landmark
 * stands in for a photograph on a place page — still holds: these never go
 * there. They are a picture OF each place on the home page, and the place page
 * keeps its own drawing.
 *
 * Writes:
 *   public/home/landmarks/<slug>-<hash>-{480,960,1440}.{avif,webp}   the site
 *   src/lib/landmarks.g.ts                                          their paths
 *   flutter_app/assets/img/landmarks/<slug>.webp                    the app (960w)
 *   flutter_app/lib/data/landmarks.g.dart                           the app's list
 *
 * The names carry the master's hash for the reason gen-home-hero.mjs gives:
 * `.htaccess` caches stable-named media for a week.
 *
 * `--check` re-renders the two text files and fails when either differs, an
 * image is missing or an older picture's files are left behind. It does not
 * compare image bytes, so an encoder upgrade does not fail it.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "brand-source/landmarks");
const WEB_DIR = join(ROOT, "public/home/landmarks");
const TS_OUT = join(ROOT, "src/lib/landmarks.g.ts");
const APP_DIR = join(ROOT, "flutter_app/assets/img/landmarks");
const DART_OUT = join(ROOT, "flutter_app/lib/data/landmarks.g.dart");

/** The six, in the order they play. Names and areas come from places.ts. */
export const LANDMARK_SLUGS = [
  "kuwait-towers",
  "liberation-tower",
  "grand-mosque",
  "seif-palace",
  "souq-al-mubarakiya",
  "marina-beach",
];

// 3:2 — what the canvas was drawn at and what the generation nodes ask for
// (1536×1024). The slideshow crops it to its own box with object-cover.
const RATIO = 3 / 2;
const WIDTHS = [480, 960, 1440];
const APP_WIDTH = 960;

const entries = LANDMARK_SLUGS.map((slug) => {
  const jpg = join(SRC, `${slug}.jpg`);
  const svg = join(SRC, `${slug}.svg`);
  const file = existsSync(jpg) ? jpg : existsSync(svg) ? svg : null;
  if (!file) {
    console.error(`no master for ${slug}: put brand-source/landmarks/${slug}.jpg (or the .svg stand-in) back`);
    process.exit(1);
  }
  const bytes = readFileSync(file);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
  return { slug, file, bytes, hash, source: file === jpg ? "ai" : "stand-in" };
});

const webName = (e, w, ext) => `${e.slug}-${e.hash}-${w}.${ext}`;
const H = (w) => Math.round(w / RATIO);

const ts = `// GENERATED — do not edit by hand.
// Produced by scripts/gen-landmarks.mjs from brand-source/landmarks/; why the
// masters are what they are, and what «stand-in» means, is in that script.
// Re-run \`npm run landmarks\` after replacing a picture.

export type LandmarkSource = "ai" | "stand-in";

export const LANDMARKS: readonly {
  slug: string;
  avif: string;
  webp: string;
  src: string;
  width: number;
  height: number;
  source: LandmarkSource;
}[] = [
${entries
  .map(
    (e) => `  {
    slug: "${e.slug}",
    avif: "${WIDTHS.map((w) => `/home/landmarks/${webName(e, w, "avif")} ${w}w`).join(", ")}",
    webp: "${WIDTHS.map((w) => `/home/landmarks/${webName(e, w, "webp")} ${w}w`).join(", ")}",
    src: "/home/landmarks/${webName(e, 960, "webp")}",
    width: 960,
    height: ${H(960)},
    source: "${e.source}",
  },`,
  )
  .join("\n")}
];
`;

const dart = `// GENERATED — do not edit by hand.
// Produced by scripts/gen-landmarks.mjs from brand-source/landmarks/ (the
// web's src/lib/landmarks.g.ts lists the same six). Re-run
// \`npm run landmarks\` after replacing a picture.

class LandmarkPicture {
  const LandmarkPicture(this.slug, this.asset, {required this.standIn});
  final String slug;
  final String asset;

  /// A drawn placeholder rather than the approved picture.
  final bool standIn;
}

const List<LandmarkPicture> kLandmarks = [
${entries.map((e) => `  LandmarkPicture('${e.slug}', 'assets/img/landmarks/${e.slug}.webp', standIn: ${e.source !== "ai"}),`).join("\n")}
];
`;

// An SVG has no pixels of its own, so it is rasterised at the size asked for
// rather than drawn small and scaled up.
const load = (e, w) =>
  sharp(e.bytes, e.source === "ai" ? {} : { density: Math.ceil((72 * w) / 600) })
    .resize({ width: w, height: H(w), fit: "cover" })
    .flatten({ background: "#ffffff" });

const images = entries.flatMap((e) => [
  ...WIDTHS.flatMap((w) => [
    [join(WEB_DIR, webName(e, w, "avif")), () => load(e, w).avif({ quality: 60, effort: 6 })],
    [join(WEB_DIR, webName(e, w, "webp")), () => load(e, w).webp({ quality: 82, effort: 6 })],
  ]),
  [join(APP_DIR, `${e.slug}.webp`), () => load(e, APP_WIDTH).webp({ quality: 85, effort: 6 })],
]);

const wanted = new Set(images.map(([f]) => f));
const leftovers = existsSync(WEB_DIR)
  ? readdirSync(WEB_DIR).filter((f) => !wanted.has(join(WEB_DIR, f)))
  : [];
const standIns = entries.filter((e) => e.source !== "ai").map((e) => e.slug);

if (process.argv.includes("--check")) {
  const stale = [];
  if (!existsSync(TS_OUT) || readFileSync(TS_OUT, "utf8") !== ts) stale.push("src/lib/landmarks.g.ts");
  if (!existsSync(DART_OUT) || readFileSync(DART_OUT, "utf8") !== dart) stale.push("flutter_app/lib/data/landmarks.g.dart");
  for (const [file] of images) if (!existsSync(file)) stale.push(file.slice(ROOT.length + 1));
  leftovers.forEach((f) => stale.push(`public/home/landmarks/${f} (not a current picture's — delete it)`));
  if (stale.length) {
    console.error(`stale: ${stale.join(", ")}`);
    process.exit(1);
  }
  console.log(`current (${entries.length} landmarks, ${images.length} pictures${standIns.length ? `; ${standIns.length} still drawn stand-ins` : ""})`);
  process.exit(0);
}

mkdirSync(WEB_DIR, { recursive: true });
mkdirSync(APP_DIR, { recursive: true });
for (const f of leftovers) unlinkSync(join(WEB_DIR, f));
for (const [file, encode] of images) {
  const buf = await encode().toBuffer();
  writeFileSync(file, buf);
  console.log(`  ${file.slice(ROOT.length + 1)}  ${(buf.length / 1024).toFixed(1)}K`);
}
writeFileSync(TS_OUT, ts);
writeFileSync(DART_OUT, dart);
console.log(`  src/lib/landmarks.g.ts, flutter_app/lib/data/landmarks.g.dart`);
if (standIns.length) console.log(`\n! ${standIns.length} of ${entries.length} are drawn stand-ins (${standIns.join(", ")}) — deploy:plan will refuse them.`);
