#!/usr/bin/env node
/**
 * Do the declared photographs and the shipped files agree?  npm run audit:photos
 *
 * The failure this exists for is the one this repository keeps meeting: a
 * layer that falls back silently. `PlacePhoto` renders nothing when a slug has
 * no entry, and the place page then draws the illustration — which is correct
 * behaviour and completely invisible. A manifest entry whose file never made
 * it into `public/photos/` produces a broken image on one page out of
 * forty-four, and nothing anywhere says so.
 *
 * So this checks the three ways the two halves can disagree:
 *
 *   declared but not built   the entry exists, the file does not — a broken
 *                            hero on a live page
 *   built but not declared   a file nobody references, which means no credit,
 *                            no alt text, and no record of its licence
 *   wrong shape or weight    the pipeline's contract, checked on the artefact
 *                            rather than trusted from the run that made it
 *
 * It also reports coverage, and reports it as a plain number rather than a
 * pass. Zero photographs is not a failure — the site is designed to be whole
 * without them — but it is a fact worth saying on every scan instead of one
 * that goes quiet.
 */
import { readdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const OUT = join(ROOT, "public/photos");

const tmp = mkdtempSync(join(tmpdir(), "wain-photos-audit-"));
const bundled = join(tmp, "photos.mjs");
execSync(
  `npx -y esbuild ${JSON.stringify(join(ROOT, "src/lib/photos.ts"))} --bundle --format=esm ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundled)} --log-level=error`,
  { cwd: ROOT, stdio: "pipe" }
);
const { PHOTOS, PHOTO_WIDTH, PHOTO_HEIGHT, PHOTO_MAX_BYTES } = await import(pathToFileURL(bundled).href);

const placesBundle = join(tmp, "places.mjs");
execSync(
  `npx -y esbuild ${JSON.stringify(join(ROOT, "src/lib/places.ts"))} --bundle --format=esm ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(placesBundle)} --log-level=error`,
  { cwd: ROOT, stdio: "pipe" }
);
const { places } = await import(pathToFileURL(placesBundle).href);
rmSync(tmp, { recursive: true, force: true });

const errors = [];
const warnings = [];

const declared = Object.keys(PHOTOS);
const built = existsSync(OUT)
  ? readdirSync(OUT).filter((f) => extname(f) === ".jpg").map((f) => basename(f, ".jpg"))
  : [];

const slugs = new Set(places.map((p) => p.slug));

for (const slug of declared) {
  if (!slugs.has(slug))
    errors.push(`«${slug}» is not a place in the catalogue — the entry names nothing`);

  const file = join(OUT, `${slug}.jpg`);
  if (!existsSync(file)) {
    errors.push(`«${slug}» is declared but public/photos/${slug}.jpg is missing — run npm run photos`);
    continue;
  }

  const bytes = statSync(file).size;
  if (bytes > PHOTO_MAX_BYTES)
    errors.push(
      `«${slug}» is ${(bytes / 1024).toFixed(0)}KB, over the ${PHOTO_MAX_BYTES / 1024}KB budget`
    );

  // The JPEG's own SOF marker, so this measures the artefact rather than
  // trusting the run that produced it.
  const buf = readFileSync(file);
  let dims = null;
  for (let i = 2; i < buf.length - 9; ) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      dims = { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      break;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  if (!dims) errors.push(`«${slug}» is not a readable JPEG`);
  else if (dims.w !== PHOTO_WIDTH || dims.h !== PHOTO_HEIGHT)
    errors.push(
      `«${slug}» is ${dims.w}×${dims.h}, not ${PHOTO_WIDTH}×${PHOTO_HEIGHT} — the hero reserves the declared box, so this shifts the page`
    );

  const meta = PHOTOS[slug];
  if (!meta.credit?.trim()) errors.push(`«${slug}» has no credit — a photograph has an author`);
  if (!meta.licence?.trim()) errors.push(`«${slug}» has no licence recorded`);
  if (!meta.source?.trim()) errors.push(`«${slug}» has no source — it cannot be re-checked later`);
  if (!meta.altAr?.trim()) errors.push(`«${slug}» has no Arabic alt text`);
  else if (/[A-Za-z]/.test(meta.altAr))
    warnings.push(`«${slug}» alt text contains Latin letters — a screen reader will spell them out`);
}

for (const slug of built) {
  if (!declared.includes(slug))
    errors.push(
      `public/photos/${slug}.jpg ships with no entry in src/lib/photos.ts — no credit, no alt text, no licence on record`
    );
}

console.log(`\naudit-photos: ${declared.length} of ${places.length} places have a photograph\n`);

if (declared.length === 0) {
  console.log("  None yet. Every place falls back to its drawing, which is a");
  console.log("  finished state rather than a broken one — see src/lib/photos.ts");
  console.log("  for how to add one, and for what may not go in.\n");
}

for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);

console.log(`\n${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`);
process.exit(errors.length ? 1 : 0);
