#!/usr/bin/env node
// Lift the car renders out of the dark, for the Story cards.
//
//   npm run stories:images
//
// MOST OF WHAT THIS FILE EXISTED FOR HAS BEEN FIXED UPSTREAM.
//
// It used to say the showroom renders were "genuinely too dark for a
// phone held outdoors: the GTR's own body sits at a mean luma of about
// 30 of 255". That was true and it was measured again to be sure — 29.6
// for the GTR, a fleet mean of 37.7, and 48% to 69% of every car at or
// below 16/255. The cause was not the story cards' problem at all: the
// menu's turntable was rendering without the grade the race has always
// run, so the showroom never got the shadow lift or the soft black
// point. attract.ts now shares that grade and carries a fill light on
// the camera side, and the same renders measure a fleet mean of 49.4.
//
// So the correction here is a third of what it was, and it is doing
// what a correction should: a small push for viewing conditions, not a
// rescue of a badly lit picture.
//
// THE GAMMA CALL WAS NEVER DOING ANYTHING. It read `.gamma(1.6)`, and
// sharp's gamma darkens before a resize and brightens after it — with
// no resize in this pipeline it round-trips. Measured across four cars:
// no-op 54.0 mean luma, gamma 1.15 52.8, gamma 1.25 52.6, gamma 1.35
// 52.5. Every one of those is DARKER than doing nothing. All of the
// lift this file ever applied came from .linear(); the gamma was a
// no-op that read like the main event, which is why it is gone rather
// than merely reduced.
//
// On Adobe, for the record: the connector is authenticated and works,
// but nothing in this sandbox can reach Adobe (403 at CONNECT on every
// host) and Adobe will not fetch from raw.githubusercontent.com or from
// claudeusercontent.com — its image tools keep an Adobe-only allowlist.
// The file picker is the only way in, one manual pick per image. None
// of which matters any more, because the fix belonged in the renderer.
import sharp from "sharp";
import { readdirSync, mkdirSync, existsSync } from "node:fs";

const SRC = "press/cars";
const OUT = "press/stories/img";
mkdirSync(OUT, { recursive: true });

// Every car in the showroom, by id, taken from the render sheet rather
// than typed: cars.json is written by the same tool that renders these.
const cars = JSON.parse(
  (await import("node:fs/promises")).default
    ? await (await import("node:fs/promises")).readFile(`${SRC}/cars.json`, "utf8")
    : "[]"
);

/** Mean Rec.709 luma of the middle of the frame, where the car is. */
const luma = async (buf) => {
  const im = sharp(buf);
  const { width, height } = await im.metadata();
  const { data, info } = await im
    .extract({
      left: Math.round(width * 0.2), top: Math.round(height * 0.25),
      width: Math.round(width * 0.6), height: Math.round(height * 0.5),
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  const px = info.width * info.height;
  for (let i = 0; i < px; i++) {
    const o = i * info.channels;
    sum += 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  }
  return sum / px;
};

const rows = [];
for (const car of cars) {
  const src = `${SRC}/${car.id}.png`;
  if (!existsSync(src)) { console.log(`  ${car.id.padEnd(16)} NO RENDER`); continue; }
  const before = await luma(src);
  // A modest linear lift with a small offset so the black point comes
  // off zero without going grey, and a little saturation back because
  // brightening desaturates. Was 1.18 and 6 against renders that needed
  // rescuing; the renders are lit properly now, so this is the push for
  // a bright phone and nothing more.
  const out = await sharp(src)
    .linear(1.06, 3)
    .modulate({ saturation: 1.08 })
    .png()
    .toBuffer();
  const after = await luma(out);
  await sharp(out).toFile(`${OUT}/${car.id}.png`);
  rows.push({ id: car.id, before, after });
  console.log(`  ${car.id.padEnd(16)} ${before.toFixed(1).padStart(5)} -> ${after.toFixed(1).padStart(5)}`);
}

const mean = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
console.log(`\n${rows.length} cars, mean luma ${mean("before").toFixed(1)} -> ${mean("after").toFixed(1)}`);
console.log(`darkest after: ${rows.slice().sort((a, b) => a.after - b.after)[0].id} at ${Math.min(...rows.map((r) => r.after)).toFixed(1)}`);
