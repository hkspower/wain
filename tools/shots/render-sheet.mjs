// A contact sheet of the car renders: every car in a 4-wide grid with its name.
//
//   node tools/shots/render-sheet.mjs [press/renders] [press/renders/contact-sheet.jpg]
//
// Run after tools/blender/render_cars.py; reads cars.json beside the PNGs.
import sharp from "sharp";
import { readFileSync, existsSync } from "node:fs";
const dir = process.argv[2] || "press/renders";
const out = process.argv[3] || `${dir}/contact-sheet.jpg`;
const carsFile = existsSync(`${dir}/cars.json`) ? `${dir}/cars.json` : "press/renders/cars.json";
const cars = JSON.parse(readFileSync(carsFile, "utf8")).filter((c) => existsSync(`${dir}/${c.id}.png`));
const W = 640, H = 360, COLS = 4, PAD = 12, LABEL = 34;
const rows = Math.ceil(cars.length / COLS);
const tiles = [];
for (const [i, c] of cars.entries()) {
  const x = PAD + (i % COLS) * (W + PAD), y = PAD + Math.floor(i / COLS) * (H + LABEL + PAD);
  tiles.push({ input: await sharp(`${dir}/${c.id}.png`).resize(W, H).toBuffer(), left: x, top: y });
  const svg = `<svg width="${W}" height="${LABEL}"><text x="8" y="23" font-family="sans-serif" font-size="18" font-weight="700" fill="#ffc45c">${c.name}</text><text x="${W - 8}" y="23" text-anchor="end" font-family="sans-serif" font-size="16" fill="#ffffffaa">${c.ar}</text></svg>`;
  tiles.push({ input: Buffer.from(svg), left: x, top: y + H });
}
await sharp({ create: { width: PAD + COLS * (W + PAD), height: PAD + rows * (H + LABEL + PAD), channels: 3, background: "#07090d" } })
  .composite(tiles).jpeg({ quality: 88 }).toFile(out);
console.log(`${cars.length} cars -> ${out}`);
