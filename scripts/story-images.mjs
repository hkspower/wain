#!/usr/bin/env node
// Lift the car renders out of the dark, for the Story cards.
//
//   npm run stories:images
//
// The showroom renders are lit for a dark card on a dark page and they
// are genuinely too dark for a phone held outdoors: the GTR's own body
// sits at a mean luma of about 30 of 255, which on an OLED at midday is
// a silhouette. This is the tonal correction Photoshop's
// image_apply_adjustments would make — a gamma lift on the midtones, a
// shadow lift under it, and a little saturation to put back what
// brightening takes out.
//
// It is done here rather than in Photoshop because this environment
// cannot reach Adobe's upload host: at.adobe.com is refused by the
// egress policy with a 403 at CONNECT, so the renders cannot be put
// into Creative Cloud for the image tools to fetch. The numbers below
// are the same numbers, applied locally.
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
  // gamma 1.6 on the midtones, then a modest linear lift with a small
  // offset so the black point comes off zero without going grey, and
  // saturation back up because brightening desaturates.
  const out = await sharp(src)
    .gamma(1.6)
    .linear(1.18, 6)
    .modulate({ saturation: 1.22 })
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
