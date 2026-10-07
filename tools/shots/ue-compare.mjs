// Blender and Unreal, side by side, car by car.
//
//   node tools/shots/ue-compare.mjs                  # press/renders vs press/unreal/fleet
//   node tools/shots/ue-compare.mjs --self-test      # the tool, on frames with a known answer
//
// For each car in cars.json that has BOTH a Cycles render
// (press/renders/<id>.png, tools/blender/render_cars.py) and an Unreal
// hero (press/unreal/fleet/<id>.png, unreal/Showcase/run.sh sheet), one
// pair of tiles: Blender on the left, Unreal on the right, the car's
// name and the gap in mean brightness between them in stops. Both come
// out of the same studio at the same framing, so a car whose gap stands
// out from the rest — the paint dressed wrong, a light missing, the nose
// turned the wrong way — is the one to open first.
//
// The gap is the mean luma of the two images in linear light, as a
// log2 ratio, so +0.5 is "Unreal is half a stop brighter". It is a smoke
// alarm, not a grade: the black floor and the dark car make it small,
// and a systematic offset across all 17 means LIGHT_SCALE or EV100 in
// unreal/Showcase/showcase_math.py, not 17 faults. The spread is what
// to read, and the tool prints it.
//
// Reads only: sharp over the PNGs, no browser, no engine.
import sharp from "sharp";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SELF = process.argv.includes("--self-test");
const blenderDir = SELF ? "press/renders" : (process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "press/renders");
const unrealDir = SELF ? "press/renders" : (process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "press/unreal/fleet");
const out = SELF ? "/tmp/ue-compare-selftest.jpg" : (process.argv[4] && !process.argv[4].startsWith("--") ? process.argv[4] : "press/unreal/fleet/compare-sheet.jpg");

const cars = JSON.parse(readFileSync("press/renders/cars.json", "utf8"));
const list = (Array.isArray(cars) ? cars : cars.cars).filter(
  (c) => existsSync(`${blenderDir}/${c.id}.png`) && existsSync(`${unrealDir}/${c.id}.png`)
);
if (!list.length) {
  console.error(`no car has both ${blenderDir}/<id>.png and ${unrealDir}/<id>.png yet`);
  process.exit(SELF ? 1 : 2);
}

// Mean luma in LINEAR light: sRGB bytes -> linear, weighted, averaged.
// sharp's stats are on the bytes, so the linear mean is taken from a
// 64x36 box-filtered copy, which is plenty for a mean and cheap.
const srgbToLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
async function meanLinearLuma(path) {
  const { data, info } = await sharp(path).removeAlpha().resize(64, 36, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i += 3) {
    sum += 0.2126 * srgbToLin(data[i]) + 0.7152 * srgbToLin(data[i + 1]) + 0.0722 * srgbToLin(data[i + 2]);
  }
  return sum / (info.width * info.height);
}

const W = 640, H = 360, COLS = 4, PAD = 12, LABEL = 34;
const rows = Math.ceil((list.length * 2) / COLS);
const tiles = [];
const gaps = [];
for (const [i, c] of list.entries()) {
  const ml = await meanLinearLuma(`${blenderDir}/${c.id}.png`);
  const ul = await meanLinearLuma(`${unrealDir}/${c.id}.png`);
  const stops = Math.log2(Math.max(ul, 1e-6) / Math.max(ml, 1e-6));
  gaps.push({ id: c.id, stops });
  const x = PAD + ((i * 2) % COLS) * (W + PAD), y = PAD + Math.floor((i * 2) / COLS) * (H + LABEL + PAD);
  tiles.push({ input: await sharp(`${blenderDir}/${c.id}.png`).gamma().resize(W, H).toBuffer(), left: x, top: y });
  tiles.push({ input: await sharp(`${unrealDir}/${c.id}.png`).gamma().resize(W, H).toBuffer(), left: x + W + PAD, top: y });
  const sign = stops >= 0 ? "+" : "";
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const svg = `<svg width="${2 * W + PAD}" height="${LABEL}"><text x="8" y="23" font-family="sans-serif" font-size="18" font-weight="700" fill="#ffc45c">${esc(c.name ?? c.id)}</text><text x="${W + PAD / 2}" y="23" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#ffffff88">Blender Cycles</text><text x="${2 * W + PAD - 8}" y="23" text-anchor="end" font-family="sans-serif" font-size="16" fill="#9fe8d8">Unreal 5.8   ${sign}${stops.toFixed(2)} stops</text></svg>`;
  tiles.push({ input: Buffer.from(svg), left: x, top: y + H });
}
mkdirSync(dirname(out), { recursive: true });
await sharp({ create: { width: PAD + COLS * (W + PAD), height: PAD + rows * (H + LABEL + PAD), channels: 3, background: "#07090d" } })
  .composite(tiles).jpeg({ quality: 88 }).toFile(out);

const mean = gaps.reduce((a, g) => a + g.stops, 0) / gaps.length;
const spread = Math.sqrt(gaps.reduce((a, g) => a + (g.stops - mean) ** 2, 0) / gaps.length);
const worst = [...gaps].sort((a, b) => Math.abs(b.stops - mean) - Math.abs(a.stops - mean)).slice(0, 3);
console.log(`${list.length} cars -> ${out}`);
console.log(`brightness gap, Unreal minus Blender, in stops: mean ${mean.toFixed(2)}, spread ${spread.toFixed(2)}`);
console.log(`furthest from the rest: ${worst.map((g) => `${g.id} ${g.stops >= 0 ? "+" : ""}${g.stops.toFixed(2)}`).join(", ")}`);
if (SELF) {
  const bad = gaps.filter((g) => Math.abs(g.stops) > 1e-9);
  if (bad.length) { console.error(`self-test FAIL: an image compared with itself differs: ${bad.map((g) => g.id).join(", ")}`); process.exit(1); }
  console.log("self-test ok: every car compared with itself is a zero-stop gap");
}
