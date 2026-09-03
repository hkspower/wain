#!/usr/bin/env node
/**
 * Originals in, web-sized photographs out:  npm run photos
 *
 * A photograph as it leaves a camera or a stock library is 5000–8000px wide
 * and several megabytes. Kuwait is a mobile market and the hero is the first
 * thing a place page paints, so the file that ships has to be a fraction of
 * that — and getting there by hand, once per place, is how a site ends up with
 * one image at 40KB and the next at 3MB.
 *
 * So the original is never the file that ships. Put it in `photos-src/<slug>`
 * with any extension, run this, and `public/photos/<slug>.jpg` comes out at a
 * fixed size, a fixed aspect and inside a fixed byte budget. `photos-src/` is
 * not committed; the output is, so a clone builds the real site.
 *
 * What it does to the picture, and why each part:
 *
 *   cover-crop to 3:2   The hero is a fixed shape. Letterboxing a portrait
 *                       into it would show bars; stretching would show a lie.
 *                       Cover takes the middle and keeps the geometry true.
 *   resize to 1200px    Two-times density on a phone, one-times on the widest
 *                       desktop column the layout allows.
 *   strip metadata      A photograph carries the camera, often the lens, and
 *                       sometimes the GPS coordinates of the person who took
 *                       it. None of that is ours to publish.
 *   mozjpeg, quality    Walked down from 82 until the file is inside the
 *                       budget, rather than guessed once — a flat quality
 *                       number gives a 60KB sky and a 400KB market stall.
 *
 * It refuses rather than ships when a picture cannot be made to fit at a
 * quality worth looking at, because a hero that costs more than the whole app
 * is a bug someone has to find later.
 */
import { readdirSync, mkdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error(
    "gen-photos needs sharp, which this project does not depend on.\n" +
    "  npm i -D sharp\n" +
    "The web-sized files in public/photos/ are committed, so you only need\n" +
    "this when adding or replacing a photograph."
  );
  process.exit(1);
}

const ROOT = process.cwd();
const SRC = join(ROOT, "photos-src");
const OUT = join(ROOT, "public/photos");

/** The manifest is the source of truth for WHICH photographs exist, so read
 *  the real module rather than keeping a second list here that can drift. */
const tmp = mkdtempSync(join(tmpdir(), "wain-photos-"));
const bundled = join(tmp, "photos.mjs");
execSync(
  `npx -y esbuild ${JSON.stringify(join(ROOT, "src/lib/photos.ts"))} --bundle --format=esm ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundled)} --log-level=error`,
  { cwd: ROOT, stdio: "pipe" }
);
const { PHOTOS, PHOTO_WIDTH, PHOTO_HEIGHT, PHOTO_MAX_BYTES } = await import(pathToFileURL(bundled).href);
rmSync(tmp, { recursive: true, force: true });

const slugs = Object.keys(PHOTOS);
if (slugs.length === 0) {
  console.log(
    "\nNo photographs are declared in src/lib/photos.ts, so there is nothing\n" +
    "to process. Add an entry there and drop the original in photos-src/.\n"
  );
  process.exit(0);
}

if (!existsSync(SRC)) {
  console.error(`\nphotos-src/ does not exist. Put each original at photos-src/<slug>.<ext>.\n`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

/** photos-src/<slug>.<anything> — the extension is whatever the camera gave. */
const originals = new Map();
for (const name of readdirSync(SRC)) {
  const slug = basename(name, extname(name));
  if (slug) originals.set(slug, join(SRC, name));
}

let written = 0;
const missing = [];
const refused = [];

for (const slug of slugs) {
  const from = originals.get(slug);
  if (!from) {
    missing.push(slug);
    continue;
  }

  const to = join(OUT, `${slug}.jpg`);
  const src = sharp(from).rotate(); // honour the camera's orientation, then drop it
  const meta = await src.metadata();

  let quality = 82;
  let bytes = 0;
  // Walk the quality down rather than guessing once. Eight steps reaches 54,
  // which is the floor below which a photograph starts to show its blocks.
  for (let step = 0; step < 8; step++) {
    const buf = await sharp(from)
      .rotate()
      .resize(PHOTO_WIDTH, PHOTO_HEIGHT, { fit: "cover", position: "attention" })
      .jpeg({ quality, mozjpeg: true, progressive: true })
      .toBuffer();
    bytes = buf.length;
    if (bytes <= PHOTO_MAX_BYTES) {
      /**
       * The buffer, byte for byte. This was `sharp(buf).toFile(to)`, which
       * DECODES the JPEG just measured and re-encodes it at sharp's default
       * quality — so the budget was checked against one file and a different,
       * larger one was written. The first run put 200KB on disk against a
       * 160KB budget and printed a tick, because everything it checked was
       * true of a buffer that never reached the disk.
       *
       * Re-encoding also costs a generation of quality for nothing: the
       * picture had already been resized and compressed exactly once, which
       * is the right number of times.
       */
      writeFileSync(to, buf);
      break;
    }
    quality -= 4;
  }

  if (bytes > PHOTO_MAX_BYTES) {
    refused.push(`${slug} — ${(bytes / 1024).toFixed(0)}KB at quality ${quality + 4}, budget is ${PHOTO_MAX_BYTES / 1024}KB`);
    continue;
  }

  written++;
  console.log(
    `  ✓ ${slug.padEnd(34)} ${meta.width}×${meta.height} → ${PHOTO_WIDTH}×${PHOTO_HEIGHT}` +
    `  ${(statSync(to).size / 1024).toFixed(0)}KB  q${quality}`
  );
}

console.log(`\n${written} photograph(s) written to public/photos/`);
if (missing.length) {
  console.log(`\n${missing.length} declared but no original found in photos-src/:`);
  for (const s of missing) console.log(`    ${s}`);
}
if (refused.length) {
  console.log(`\n${refused.length} refused — too heavy even at the lowest quality worth shipping:`);
  for (const r of refused) console.log(`    ${r}`);
}
process.exit(missing.length || refused.length ? 1 : 0);
