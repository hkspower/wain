// Shop-card thumbnails, from the showroom renders that already exist.
//
//   npm run shots:thumbs
//
// tools/shots/cars.mjs already renders every car on the menu's own
// turntable — the game's lighting, environment and paint — and writes
// 1920x1080 PNGs to press/cars. Those are press assets: over 20 MB for
// the set, which is not something to hand a player who opened a shop.
//
// This makes the shop's copy: the same pictures at card size, in WebP,
// into public/ where Next can actually serve them. Derived rather than
// re-rendered, so the card and the press shot can never disagree about
// what a car looks like — and so this takes a second instead of driving
// a browser through fifteen cars.
//
// Trimmed before resizing. The press frame leaves room for the menu's
// own column, so a straight downscale spends most of a small card on
// empty asphalt; trimming to the car's own pixels first is the
// difference between a thumbnail of a car and a thumbnail of a floor.
import sharp from "sharp";
import { readdirSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "press/cars";
const OUT = "public/cars";
// 1080 wide, not the 480 this shipped at. Measured live in a browser
// (GameSite.tsx's fleet grid, capped by its max-w-6xl container): a
// card renders at exactly 355 CSS px, unchanged from 1280px viewport up
// to 1920px — the grid's own cap, not the window. 480 was reasoned as
// "a 1.33x display... the 2x nobody can see on a thumbnail" — a claim,
// not a measurement, and the measurement says otherwise: most phones
// and most retina laptops run 2x or 3x today. Checked directly — the
// mean-gradient edge strength of the 480px webp against the same crop
// taken from the (now 1920px) press render, at the real 355px width:
//
//   DPR   edge strength, worst car (jahra-pickup)
//   1x    76%
//   2x    73%
//   3x    66%   — a third of the car's own edge definition, gone
//
// 355 * 3 = 1065; 1080 clears full 3x DPR coverage at the grid's real
// width with a little margin, at a cost of kilobytes: the whole set was
// ~120 kB at 480 wide and webp compresses a mostly-dark background
// hard, so this is not the tradeoff the old comment was guarding
// against. Re-measured after the change, at the real 355px width: the
// same worst car (jahra-pickup) now reads 78% / 75% / 73% at 1x / 2x /
// 3x DPR — real ground gained over 76% / 73% / 66%, not closed. Most of
// what is left is not resolution: jahra-pickup's trimmed silhouette is
// simply the widest one seated in the fixed 1080x405 box (the tool's
// own comment below says why every car gets a different scale inside
// it), so the same source pixels cover more of the frame and every one
// of them is worth less. A further width bump buys less each time; the
// honest fix for THAT is per-car headroom, not a bigger flat W.
const W = 1080;
// ...and ONE height for all of them. Trimming to each car's own pixels
// gives each thumbnail its own aspect — a pickup came out 188 tall and
// a wedge 160 — and a grid of cards whose pictures are different
// heights sits visibly ragged, row by row. So every car is trimmed,
// then fitted into the same box and centred in it: the cars still
// differ in size relative to each other (which is information — a
// pickup IS bigger than a hatch), the cards do not.
const H = 405;

mkdirSync(OUT, { recursive: true });

// The per-angle press shots (…-front/-rear/-side) are extra views of one
// car, not cars. The shop wants the three-quarter hero, which is the
// bare id.
const files = readdirSync(SRC).filter(
  (f) => f.endsWith(".png") && !/-(front|rear|side)\.png$/.test(f)
);

let total = 0;
for (const f of files.sort()) {
  const id = f.replace(/\.png$/, "");
  const src = join(SRC, f);
  const dst = join(OUT, `${id}.webp`);
  const img = sharp(src);
  const meta = await img.metadata();
  await img
    // Trim the flat backdrop away, then seat the car in a fixed box.
    // `contain` keeps the whole car and never crops it; the background
    // is the transparent one the card's own gradient shows through, so
    // a car narrower than the box does not sit on a visible slab.
    .trim({ threshold: 12 })
    .resize({
      width: W,
      height: H,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false,
    })
    .webp({ quality: 82, effort: 5, alphaQuality: 90 })
    .toFile(dst);
  const out = statSync(dst);
  total += out.size;
  console.log(
    `${id.padEnd(18)} ${meta.width}x${meta.height} png ` +
      `${(statSync(src).size / 1024).toFixed(0).padStart(4)}kB  ->  ` +
      `webp ${W}x${H} ${(out.size / 1024).toFixed(0).padStart(3)}kB`
  );
}
console.log(`\n${files.length} thumbnails, ${(total / 1024).toFixed(0)} kB total, in ${OUT}/`);
