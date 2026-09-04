// What is behind the headlamp lens.
//
//   npm run test:bulbs      (no browser, no dev server)
//
// This game runs from midnight to ten to six, and on most of the lap the
// only light is the one the car is carrying — so how far the beam throws
// is how far ahead the driver can read the road. That makes the bulb the
// one styling-adjacent purchase with a real effect on driving, and the
// thing worth asserting is that the effect is real, ordered, and does not
// quietly restyle the night for a car that has bought nothing.

import { BULBS, BULB_IDS, bulbColor, kelvinToRgb } from "../src/game/bulbs.ts";
import { PARTS, EXCLUSIVE_CATS, computeEffects } from "../src/game/mods.ts";
import { readFileSync } from "node:fs";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };
const F = (n, d = 2) => Number(n).toFixed(d);
const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;

// --- 1. Halogen leaves the graded night exactly as it was --------------
// The engine has always lit the road with 0xfff2cc, and the night levels,
// the dark check and every screenshot were measured against it. A bulb
// system that shifts the default car's beam by even a little invalidates
// all of that for no gain.
{
  check(bulbColor("halogen") === 0xfff2cc,
    `halogen must be the graded colour bit for bit, got ${hex(bulbColor("halogen"))}`);
  const h = BULBS.halogen;
  check(h.intensity === 1 && h.reach === 1 && h.angle === 1,
    "halogen must be the unit against which the others are quoted");
  const eng = readFileSync("src/game/engine.ts", "utf8");
  check(!/new THREE\.SpotLight\(0xfff2cc/.test(eng),
    "the lamps must be built from the fitted bulb, not from the old literal");
  console.log(`halogen ${hex(bulbColor("halogen"))} — identical to the colour the night was graded on`);
}

// --- 2. The upgrades are ordered, and pay for themselves in reach ------
{
  const order = ["halogen", "led", "laser"];
  for (const k of ["intensity", "reach"]) {
    for (let i = 1; i < order.length; i++) {
      check(BULBS[order[i]][k] > BULBS[order[i - 1]][k],
        `${k} must rise from ${order[i - 1]} to ${order[i]}`);
    }
  }
  // A longer throw is a narrower cone. The same light cannot go further
  // and wider at once without being free.
  for (let i = 1; i < order.length; i++) {
    check(BULBS[order[i]].angle < BULBS[order[i - 1]].angle,
      `the cone must tighten as the throw lengthens (${order[i - 1]} -> ${order[i]})`);
  }
  check(BULBS.laser.reach < 2.5, "laser must not be a floodlight — it is a long narrow beam");
  const reach = (b) => 95 * BULBS[b].reach;
  console.log(
    `throw: ${order.map((b) => `${b} ${F(reach(b), 0)} m`).join(" -> ")}, ` +
    `cone ${order.map((b) => F(0.32 * BULBS[b].angle, 3)).join(" -> ")} rad`
  );
}

// --- 3. Colour is derived from temperature, and stays distinguishable --
// Two earlier fits were measured and rejected: blending toward white by a
// single fraction made LED and laser #fffbf7 and #fffffd, and von Kries
// with clipping flattened both to pure white. Either way a player buys an
// upgrade and sees nothing.
{
  const cols = BULB_IDS.map(bulbColor);
  check(new Set(cols).size === cols.length,
    `two bulbs share a colour: ${cols.map(hex).join(" ")}`);
  // Cooler must read cooler: more blue relative to red, monotonically.
  const blueness = (b) => {
    const c = bulbColor(b);
    return ((c & 0xff) + 1) / (((c >> 16) & 0xff) + 1);
  };
  check(blueness("led") > blueness("halogen"), "LED must read cooler than halogen");
  check(blueness("laser") > blueness("led"), "laser must read cooler than LED");
  // ...and every channel must be a real 8-bit value.
  for (const b of BULB_IDS) {
    const c = bulbColor(b);
    for (const ch of [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]) {
      check(Number.isInteger(ch) && ch >= 0 && ch <= 255, `${b} has an out-of-range channel`);
    }
  }
  console.log(`colours ${BULB_IDS.map((b) => `${b} ${hex(bulbColor(b))}`).join(", ")} — all distinct, cooler with kelvin`);
}

// --- 4. The blackbody fit behaves at the edges -------------------------
// It is a piecewise polynomial fit and it goes somewhere silly outside
// its range. Clamped rather than extrapolated, because a headlamp the
// colour of nothing is hard to notice in a screenshot.
{
  for (const k of [-5000, 0, 500, 1000, 6500, 40000, 1e9]) {
    const rgb = kelvinToRgb(k);
    check(rgb.every((v) => Number.isFinite(v) && v >= 0 && v <= 1),
      `kelvinToRgb(${k}) returned ${rgb.join(", ")}`);
  }
  // Warmer is redder: the fit must not invert anywhere in the usable band.
  let prev = Infinity, mono = true;
  for (let k = 2000; k <= 10000; k += 100) {
    const [r, , b] = kelvinToRgb(k);
    const ratio = r / Math.max(1e-6, b);
    if (ratio > prev + 1e-9) mono = false;
    prev = ratio;
  }
  check(mono, "red-to-blue must fall monotonically as the source gets hotter");
  console.log("the fit is finite and monotone from 2000 K to 10000 K, and clamped outside its range");
}

// --- 5. The shop sells all three, in a slot of its own -----------------
// The lens and the source are different purchases: a smoked lens dims
// whatever bulb is behind it, and sharing a slot would make buying one
// silently remove the other.
{
  const bulbs = PARTS.filter((p) => p.cat === "bulbs");
  check(bulbs.length === 3, `${bulbs.length} bulbs on sale, expected 3`);
  check(EXCLUSIVE_CATS.has("bulbs"), "you fit one bulb at a time");
  check(EXCLUSIVE_CATS.has("lamps"), "sanity: the lens slot still exists");
  for (const p of bulbs) {
    check(p.price > 0, `${p.id} is free`);
    check(/[؀-ۿ]/.test(p.ar), `${p.id} has no Arabic name`);
    check(p.cat !== "lamps", `${p.id} must not evict the player's lens choice`);
  }
  // Priced in the order of what they do.
  //
  // Looked up defensively: if one of these has been moved into another
  // slot, `find` returns undefined and reading `.price` off it throws —
  // and a test that crashes tells you less than one that says which part
  // went missing. That is not hypothetical; it is what moving bulb-led
  // into the lens slot did to this block.
  const price = (id) => {
    const p = bulbs.find((q) => q.id === id);
    if (!p) { fail.push(`${id} is not in the bulbs slot — it cannot be bought as a bulb`); return null; }
    return p.price;
  };
  const [ph, pl, px] = ["bulb-halogen", "bulb-led", "bulb-laser"].map(price);
  if (ph !== null && pl !== null && px !== null) {
    check(ph < pl && pl < px, `price must follow reach, got ${ph}/${pl}/${px}`);
  }
  console.log(`3 bulbs on sale at ${bulbs.map((p) => p.price).join("/")} KD, in a slot the lens cannot evict`);
}

// --- 6. It reaches the car, and halogen is the default -----------------
{
  const base = { cars: ["wain-special"], car: "wain-special", kd: 0, builds: {} };
  const build = (owned) => ({
    ...base,
    builds: { "wain-special": { owned, equipped: Object.fromEntries(owned.map((id) => {
      const p = PARTS.find((q) => q.id === id);
      return [p.cat, id];
    })) } },
  });
  check(computeEffects(build([])).bulb === "halogen",
    "a car that has bought nothing runs halogen");
  check(computeEffects(build(["bulb-led"])).bulb === "led", "LED must reach the car");
  check(computeEffects(build(["bulb-laser"])).bulb === "laser", "laser must reach the car");
  // ...and buying light must not buy grip.
  const plain = computeEffects(build([]));
  const lit = computeEffects(build(["bulb-laser"]));
  for (const k of ["gripAccel", "brakeForce", "powerMult", "topSpeedKmh"]) {
    check(plain[k] === lit[k], `a bulb changed ${k}: ${plain[k]} -> ${lit[k]}`);
  }
  const eng = readFileSync("src/game/engine.ts", "utf8");
  check(/private applyBulb\(\): void/.test(eng) && /this\.applyBulb\(\);/.test(eng),
    "buying a bulb mid-session must reach the lamps, not just a car built at boot");
  console.log("halogen by default; LED and laser reach the car and buy light, not grip");
}

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
