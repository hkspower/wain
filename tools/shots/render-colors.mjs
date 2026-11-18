// Does each car still render in its own colour?
//
//   npm run check:render-colors                 press/renders against press/renders/cars.json
//   node tools/shots/render-colors.mjs [dir]    another folder of <id>.png and a cars.json
//
// WHY THIS EXISTS
//
// The studio's lights (tools/blender/studio.py) were matched to the game's
// tone curve on a grey ramp, and a grey says nothing about colour. Under a
// 1100 W key and a 1500 W strip over the bonnet, a bright, rough paint
// lands in the shoulder of the ACES curve and the shoulder rolls a
// saturated colour toward white: the satin yellow of the Efreet RX Kai
// came out at 0.40 saturation against 0.95 designed, its flag-green
// bonnet panel as mint. Every gate looked at whites and blacks (clipping,
// crush); nothing looked at hue, so 17 stills were committed with the
// yellow cars the colour of mustard.
//
// WHAT IT MEASURES
//
// For each car whose designed paint is saturated (HSV saturation >= 0.5;
// the greys and near-blacks have no hue to lose): the median saturation of
// the pixels in the paint's own hue (within 14 degrees, lit well enough to
// be paint: value over 0.25, saturation over 0.15) in the finished still.
// It fails when that is more than 0.25 under the paint the game defines
// (cars.json, written by tools/shots/export-cars.mjs from the game itself),
// or when so few pixels are in that hue that the paint cannot be found at
// all, which is what a washed-out car looks like from the far end.
//
// 0.25 is set from the fleet: the stills that were right sat up to 0.19
// under their design (a lit paint is never quite as saturated as its
// swatch; some are a little over it), and the four that were wrong sat 0.25
// to 0.54 under. The fix for a failure is the car's entry in
// studio.CAR_EXPOSURE_EV, half a stop at a time, not a change to this bar.
import sharp from "sharp";
import { readFileSync, existsSync } from "node:fs";

const dir = process.argv[2] || "press/renders";
const carsFile = existsSync(`${dir}/cars.json`) ? `${dir}/cars.json` : "press/renders/cars.json";
const cars = JSON.parse(readFileSync(carsFile, "utf8"));

const MIN_DESIGNED_SAT = 0.5;
const MAX_UNDER = 0.25;
const HUE_BAND = 14 / 360;
const MIN_VALUE = 0.25;
const MIN_SAT = 0.15;
const MIN_SHARE = 0.0005; // of the frame; below this the paint is not in the picture

function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}

const rows = [];
const fail = [];
for (const car of cars) {
  const file = `${dir}/${car.id}.png`;
  const hex = car.color.replace("#", "");
  const [h0, s0] = hsv(...[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
  if (s0 < MIN_DESIGNED_SAT) continue;
  if (!existsSync(file)) { fail.push(`${car.id}: no ${file}`); continue; }
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const c = info.channels, total = info.width * info.height;
  const bins = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < data.length; i += c) {
    const [h, s, v] = hsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    if (v <= MIN_VALUE || s <= MIN_SAT) continue;
    const dh = Math.abs(h - h0);
    if (Math.min(dh, 1 - dh) > HUE_BAND) continue;
    bins[Math.min(255, Math.floor(s * 256))]++;
    n++;
  }
  let sat = null;
  if (n >= total * MIN_SHARE) {
    let acc = 0;
    for (let b = 0; b < 256; b++) { acc += bins[b]; if (acc >= n / 2) { sat = (b + 0.5) / 256; break; } }
  }
  const under = sat === null ? null : s0 - sat;
  const ok = under !== null && under <= MAX_UNDER;
  rows.push({ car, s0, sat, under, share: n / total, ok });
  if (!ok) {
    fail.push(sat === null
      ? `${car.id}: only ${(100 * n / total).toFixed(2)}% of the frame is in the paint's hue (${car.color}); the paint is gone`
      : `${car.id}: paint saturation ${sat.toFixed(2)}, designed ${s0.toFixed(2)} (${car.color}): ${under.toFixed(2)} under, over the ${MAX_UNDER} bar`);
  }
}

console.log(`Paint saturation in the finished stills (${dir}), against the paint the game defines; bar: no more than ${MAX_UNDER} under.\n`);
console.log("car              paint    designed  rendered   under  share");
for (const r of rows) {
  console.log(
    `${r.car.id.padEnd(16)} ${r.car.color}  ${r.s0.toFixed(2).padStart(7)}  ${(r.sat === null ? "  --" : r.sat.toFixed(2)).padStart(8)}  ${(r.under === null ? "  --" : r.under.toFixed(2)).padStart(5)}  ${(100 * r.share).toFixed(1).padStart(5)}%  ${r.ok ? "ok" : "FAIL"}  ${r.car.finish}`
  );
}
console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : `\nevery saturated paint keeps its colour (${rows.length} cars checked)`);
process.exit(fail.length ? 1 : 0);
