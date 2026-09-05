#!/usr/bin/env node
// Where is there room left on the paint wall?
//
//   node tools/paint-space.mjs                 # how much room the wall has
//   node tools/paint-space.mjs 0x1b4d3e ...    # score specific candidates
//
// tests/paints.mjs holds every pair of paints at least 12 CIEDE2000
// apart, and the wall is already tight — the closest pair sits at 12.6.
// So a new colour cannot be chosen by eye and checked afterwards: most
// of the obvious ones are already someone else's. This searches instead.
//
// It walks a coarse grid of plausible car colours, scores each by its
// distance to the NEAREST existing paint, and prints the roomiest. That
// is the opposite of picking a colour and hoping: it finds the holes
// first and lets a name be chosen for one.
//
// A car colour, for this purpose, is one you could actually buy: not
// black-black, not white-white, and not a fully saturated primary at
// every hue, because most of that volume is not paint. The grid is in
// HSL and the bounds say so.
import { PAINTS, deltaE } from "../src/game/paints.ts";

const hsl = (h, s, l) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
};

const nearest = (hex) => {
  let best = { d: Infinity, id: "" };
  for (const p of PAINTS) {
    const d = deltaE(hex, p.hex);
    if (d < best.d) best = { d, id: p.id };
  }
  return best;
};

const hex6 = (n) => `#${n.toString(16).padStart(6, "0")}`;

const args = process.argv.slice(2);
if (args.length) {
  console.log("candidate   nearest existing paint");
  for (const a of args) {
    const hex = Number(a);
    const n = nearest(hex);
    console.log(
      `${hex6(hex)}   dE ${n.d.toFixed(1).padStart(5)} to ${n.id}` +
      (n.d >= 12 ? "  ok" : "  TOO CLOSE")
    );
  }
  process.exit(0);
}

// The plausible-paint box. Saturation from near-grey to strong but not
// fluorescent; lightness away from both ends, where paint stops having
// a colour and starts being black or white.
const found = [];
for (let h = 0; h < 360; h += 6) {
  for (let s = 0.12; s <= 0.92; s += 0.08) {
    for (let l = 0.12; l <= 0.82; l += 0.05) {
      const hex = hsl(h, s, l);
      const n = nearest(hex);
      if (n.d >= 12) found.push({ hex, h, s, l, ...n });
    }
  }
}
found.sort((a, b) => b.d - a.d);

console.log(`${PAINTS.length} paints on the wall. Grid of plausible car colours: ` +
  `${found.length} points sit 12 or more from all of them.\n`);
console.log("the roomiest, and what each is nearest to");
// Spread the report out: report a candidate only if it is itself 12
// from every candidate already reported, or the list is twenty shades
// of the same hole.
const picked = [];
for (const f of found) {
  if (picked.some((p) => deltaE(p.hex, f.hex) < 12)) continue;
  picked.push(f);
  console.log(
    `  ${hex6(f.hex)}  hue ${String(f.h).padStart(3)}  ` +
    `dE ${f.d.toFixed(1).padStart(5)} to ${f.id}`
  );
  if (picked.length >= 14) break;
}
