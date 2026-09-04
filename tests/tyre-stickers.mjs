// The tyre sticker package.
//
//   npm run test:tyre-stickers      (no browser, no dev server)
//
// Sidewall lettering is cosmetic, which makes it the easiest kind of part
// to get quietly wrong: nothing about the car's behaviour changes, so a
// bug shows up only as an absence nobody notices. The things worth
// asserting are the ones that would leave a player having paid for
// something they cannot see, or having lost something they did not mean
// to sell.

import { PARTS, EXCLUSIVE_CATS, computeEffects } from "../src/game/mods.ts";
import { readFileSync } from "node:fs";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

const sidewalls = PARTS.filter((p) => p.cat === "sidewall");

// --- 1. The package is in the catalogue and priced ---------------------
{
  check(sidewalls.length >= 3, `only ${sidewalls.length} lettering options`);
  for (const p of sidewalls) {
    check(p.price > 0, `${p.id} is free`);
    check(/[؀-ۿ]/.test(p.ar), `${p.id} has no Arabic name`);
    check(p.desc.length > 10, `${p.id} has no description`);
    // Cosmetic parts must say so. A player reading "Raised White Letters"
    // beside a Sport Tires entry that buys real grip is entitled to know
    // which kind of part this is before spending on it.
    check(/[Cc]osmetic|Changes nothing/.test(p.desc),
      `${p.id} does not say it is cosmetic — it sits in a shop full of parts that are not`);
  }
  console.log(`${sidewalls.length} lettering options, ${sidewalls.map((p) => p.price).join("/")} KD, all declared cosmetic`);
}

// --- 2. Lettering is its own slot, not the tyre compound ---------------
// The failure this prevents: a player buys slicks, then buys lettering,
// and the shop quietly takes the slicks off because both were "tires".
{
  check(EXCLUSIVE_CATS.has("sidewall"), "lettering must be an exclusive slot — you wear one at a time");
  check(EXCLUSIVE_CATS.has("tires"), "sanity: the compound slot still exists");
  for (const p of sidewalls) check(p.cat !== "tires", `${p.id} must not share the compound's slot`);
  const compounds = PARTS.filter((p) => p.cat === "tires");
  check(compounds.length > 0, "sanity: there are still tyre compounds to buy");
  console.log(`${compounds.length} compounds and ${sidewalls.length} letterings, in two slots that do not evict each other`);
}

// --- 3. Buying it changes nothing about how the car drives -------------
// The claim the description makes, checked rather than trusted.
{
  const base = { cars: ["wain-special"], car: "wain-special", kd: 0, builds: {} };
  const build = (owned) => ({
    ...base,
    builds: { "wain-special": { owned, equipped: Object.fromEntries(owned.map((id) => {
      const p = PARTS.find((q) => q.id === id);
      return [p.cat, id];
    })) } },
  });
  const plain = computeEffects(build([]));
  const lettered = computeEffects(build(["sidewall-rwl"]));
  const DRIVING = ["gripAccel", "brakeForce", "powerMult", "accelMult", "topSpeedKmh",
    "tractionMult", "understeerMult", "rollMax", "crashResist", "downforce"];
  for (const k of DRIVING) {
    check(plain[k] === lettered[k],
      `lettering changed ${k}: ${plain[k]} -> ${lettered[k]} — it is meant to be cosmetic`);
  }
  check(lettered.tyreSticker === "rwl", `the sticker must reach the car, got ${lettered.tyreSticker}`);
  check(plain.tyreSticker === undefined, "a bare tyre must carry no lettering");
  console.log(`${DRIVING.length} driving figures identical with and without lettering; the sticker still reaches the car`);
}

// --- 4. Every option maps to something the wheel can draw --------------
{
  const cars = readFileSync("src/game/cars.ts", "utf8");
  for (const p of sidewalls) {
    const id = p.id.replace("sidewall-", "");
    check(new RegExp(`\\b${id}:\\s*\\{`).test(cars),
      `${p.id} has no entry in TYRE_STICKERS — it would sell a sticker the wheel cannot draw`);
  }
  // ...and nothing in the table is unreachable from the shop.
  const declared = [...cars.matchAll(/^  (\w+): \{ ink:/gm)].map((m) => m[1]);
  for (const d of declared) {
    check(sidewalls.some((p) => p.id === `sidewall-${d}`),
      `TYRE_STICKERS.${d} is drawn by nothing in the catalogue`);
  }
  console.log(`${declared.length} letterings in the table, ${sidewalls.length} on sale, and the two sets match`);
}

// --- 5. It goes on the face you can see -------------------------------
// The tyre geometry is shared between all four wheels without mirroring,
// so +X is outboard on the right of the car and inboard on the left.
// Reading the wheel's own `side` is what keeps the lettering visible on
// all four; reading the geometry would hide it on two.
{
  const cars = readFileSync("src/game/cars.ts", "utf8");
  check(/if \(side < 0\) band\.scale\.x = -1;/.test(cars),
    "the band must be placed from the wheel's side, not from the shared geometry");
  check(/addTyreSticker\(w, side, opts\?\.sticker\)/.test(cars),
    "both wheel builds must lay the band");
  check((cars.match(/addTyreSticker\(w, side/g) || []).length === 2,
    "the detailed wheel and the traffic wheel must both get it");
  // Baked into the tread texture it would repeat TREAD_BLOCKS times.
  check(!/tyreSticker|TYRE_STICKERS/.test(cars.slice(cars.indexOf("function tireSurface"), cars.indexOf("const canvas = ()"))),
    "lettering must not be baked into the tread texture — it repeats 18 times around");
  console.log("the band is placed from the wheel's own side, on both wheel builds, off the tread texture");
}

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
