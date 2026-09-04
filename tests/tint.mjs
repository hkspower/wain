// Window film: the three products, the maths, and the shelf.
//
//   npm run test:tint      (no browser, no dev server)
//
// Tint was a free slider from 0 to 100 with nothing to buy, which made
// it the one thing on the corniche that cost nothing. The shop sells
// the FILM now and the slider still sets the darkness — so what has to
// hold is that the three films are actually three different things, that
// none of them is a performance part in disguise, and that no save which
// already had tint loses it.

import { FILMS, FILM_IDS, FACTORY_GLASS, CLEAR_OPACITY, glassLook } from "../src/game/tint.ts";
import { PARTS, FILM_OF_PART, EXCLUSIVE_CATS, computeEffects, clampTint } from "../src/game/mods.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c; };
let mark = 0;
const verdict = () => { const n = fail.length - mark; mark = fail.length; return n ? `FAIL (${n})` : "ok"; };
const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;
const lum = (n) =>
  0.2126 * ((n >> 16) & 0xff) + 0.7152 * ((n >> 8) & 0xff) + 0.0722 * (n & 0xff);

// --- 1. No film is no tint -------------------------------------------
//
// The gate the whole feature rests on. A slider left at 100 with nothing
// bought must leave the car on factory glass, or the shop entry is
// decoration.
{
  const bare = glassLook(undefined, 100);
  check(bare.opacity === CLEAR_OPACITY, `no film at 100% still opened up to ${bare.opacity}`);
  check(bare.color === FACTORY_GLASS, `no film at 100% tinted the glass to ${hex(bare.color)}`);
  const zero = glassLook("ceramic", 0);
  check(zero.color === FACTORY_GLASS, "a film at 0% is still factory glass");
  console.log(`no film at 100%: factory glass, opacity ${bare.opacity}  ${verdict()}`);
}

// --- 2. Darkness is monotonic, and never reaches a painted panel -----
for (const f of FILM_IDS) {
  let last = -1;
  for (let p = 0; p <= 100; p += 5) {
    const o = glassLook(f, p).opacity;
    check(o > last, `${f}: opacity went backwards at ${p}%`);
    last = o;
  }
  check(last < 1, `${f} reaches opacity ${last} at 100% — that is a painted panel, not a window`);
}
console.log(`${FILM_IDS.length} films open monotonically to ${glassLook("carbon", 100).opacity}  ${verdict()}`);

// --- 3. The three are actually three ---------------------------------
//
// The point of the shelf. If two films land on the same colour, the
// same sheen and the same haze at full darkness, one of them is a
// second price tag on the first.
{
  const at100 = FILM_IDS.map((f) => ({ f, ...glassLook(f, 100) }));
  for (let i = 0; i < at100.length; i++) {
    for (let j = i + 1; j < at100.length; j++) {
      const a = at100[i], b = at100[j];
      check(a.color !== b.color, `${a.f} and ${b.f} go the same colour: ${hex(a.color)}`);
      // The surface on top, which is what actually tells the two dark
      // films apart in a rendered frame — see the note on `coat`.
      // Two films may share ONE of these and still be different
      // products — what they may not do is share all of them. The
      // ceramic roll that was cut differed only in the third decimal of
      // every one, which is what "the same film at two prices" means.
      const apart =
        (a.color !== b.color ? 1 : 0) +
        (Math.abs(a.envMapIntensity - b.envMapIntensity) > 0.1 ? 1 : 0) +
        (Math.abs(a.roughness - b.roughness) > 0.004 ? 1 : 0) +
        (Math.abs(a.clearcoat - b.clearcoat) > 0.15 ? 1 : 0) +
        (Math.abs(a.metalness - b.metalness) > 0.2 ? 1 : 0);
      check(apart >= 3, `${a.f} and ${b.f} differ in only ${apart} of the five properties`);
    }
  }
  console.log(
    "at 100%: " + at100.map((a) => `${a.f} ${hex(a.color)}`).join(", ") + `  ${verdict()}`
  );
}

// --- 4. Each film is the thing its shop text says it is --------------
//
// Three claims are made on the shelf, and each is a number here.
{
  const d = glassLook("dyed", 100), c = glassLook("carbon", 100), m = glassLook("mirror", 100);
  // "never quite neutral" — the cheap one keeps a colour cast. Measured
  // as the spread between the darkest and lightest channel.
  const spread = (n) => {
    const ch = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    return Math.max(...ch) - Math.min(...ch);
  };
  check(spread(d.color) > spread(c.color),
    `dyed is meant to be the least neutral: ${spread(d.color)} vs carbon ${spread(c.color)}`);
  // "dye alone does not get you to black" — the cheap film is the one
  // that stays visibly lighter. Carbon and ceramic are NOT ordered
  // against each other here, and that is deliberate: at a given
  // darkness every film blocks the same light, so an ordering between
  // the two dark ones would be a claim with nothing behind it. This
  // guard exists because the first version of the module made exactly
  // that claim and this line is what refused it.
  check(lum(d.color) > lum(c.color),
    `dyed should be the lighter of the two dark films, got ${[d, c].map((x) => lum(x.color).toFixed(1)).join(" ")}`);
  // The mirrored roll is the exception to every line above it, and the
  // exception is the product: it reflects instead of absorbing, so its
  // glass ends up LIGHTER than bare factory glass rather than darker.
  // A mirror that came out dark would be a charcoal film with a
  // different name on it.
  check(lum(m.color) > lum(FACTORY_GLASS),
    `mirrored film should end up brighter than bare glass, got ${lum(m.color).toFixed(1)} against ${lum(FACTORY_GLASS).toFixed(1)}`);
  check(m.metalness > 0.8, `mirrored film should be metal, got metalness ${m.metalness.toFixed(2)}`);
  check(d.metalness < 0.2 && c.metalness < 0.2,
    "the absorbing films must not be metallic — that is the other product");
  // "keeps the corniche lights in it instead of going matte" — the
  // reflection rises with price and the haze falls with it.
  check(d.envMapIntensity < c.envMapIntensity, "carbon should reflect more than dyed");
  check(d.roughness > c.roughness, "dyed should be the hazier of the two");
  check(d.clearcoat < c.clearcoat, "carbon should have the better optical surface");
  check(glassLook("carbon", 0).clearcoat === 0,
    "bare glass with no film on it must carry no film surface");
  console.log(
    `luma ${[d, c, m].map((x) => lum(x.color).toFixed(1)).join(" / ")} ` +
    `(bare glass ${lum(FACTORY_GLASS).toFixed(1)}), ` +
    `metal ${[d, c, m].map((x) => x.metalness.toFixed(2)).join(" / ")}  ${verdict()}`
  );
}

// --- 5. The shelf ----------------------------------------------------
{
  const shelf = PARTS.filter((p) => p.cat === "film");
  check(shelf.length === FILM_IDS.length,
    `${FILM_IDS.length} films and ${shelf.length} on the shelf`);
  check(EXCLUSIVE_CATS.has("film"), "film must be an exclusive slot — one roll goes on a car");
  const seen = new Set();
  for (const p of shelf) {
    const f = FILM_OF_PART[p.id];
    if (!check(!!f, `shop part ${p.id} maps to no film`)) continue;
    check(!seen.has(f), `two shop parts fit the same film: ${f}`);
    seen.add(f);
    check(p.price > 0, `${p.id} is free — the whole point is that the roll is not`);
    check(!!p.ar && /[؀-ۿ]/.test(p.ar), `${p.id} has no Arabic name`);
    // Nothing on this shelf may claim a performance effect, because
    // none of them has one.
    check(/cosmetic/i.test(p.desc), `${p.id} does not say it is cosmetic`);
    check(!/\+\d|power|grip|brak/i.test(p.desc), `${p.id} claims a performance effect it does not have`);
  }
  const prices = shelf.map((p) => p.price);
  check(
    prices.every((v, i) => i === 0 || prices[i - 1] < v),
    `the shelf should read cheapest first: ${prices.join(", ")}`
  );
  // A roll on this shelf has to be a DIFFERENT WINDOW, not a different
  // price. A ceramic film sat here at 1400 KD until tools/shots/tint.mjs
  // measured it 2.95 of 255 from carbon over the glass, against the 23
  // that separates dyed from either. Anything added has to clear that
  // tool against every film already on the wall.
  check(shelf.length === FILM_IDS.length,
    `the shelf holds ${shelf.length} films and the module defines ${FILM_IDS.length}`);
  console.log(`shelf: ${shelf.map((p) => `${p.name} ${p.price} KD`).join(", ")}  ${verdict()}`);
}

// --- 6. The darkness is gated on the film, in the effects ------------
{
  const g = {
    kd: 0, cars: ["wain-special"], car: "wain-special",
    builds: { "wain-special": { owned: [], equipped: {}, tint: 80 } },
  };
  const bare = computeEffects(g, "wain-special");
  check(bare.tint === 0, `80% tint with no film came through as ${bare.tint}`);
  check(bare.tintFilm === undefined, "no film bought and a film came through anyway");

  g.builds["wain-special"].owned = ["film-carbon"];
  g.builds["wain-special"].equipped = { film: "film-carbon" };
  const fitted = computeEffects(g, "wain-special");
  check(fitted.tint === 80, `film fitted and the darkness came through as ${fitted.tint}`);
  check(fitted.tintFilm === "carbon", `expected carbon, got ${fitted.tintFilm}`);
  console.log(`gate: ${bare.tint}% without a film, ${fitted.tint}% with one  ${verdict()}`);
}

// --- 7. Nobody loses the tint they already had -----------------------
//
// Tint was free before this shelf existed, so there are saves out there
// carrying a darkness and owning no roll. Reading one must not quietly
// put the car back on clear glass.
{
  check(typeof clampTint(70) === "number", "clampTint should still take a number");
  const shelf = PARTS.find((p) => p.id === "film-dyed");
  check(!!shelf, "the migration grants film-dyed, so film-dyed has to exist");
}
console.log(`migration target present  ${verdict()}`);

console.log(fail.length ? `\nFAILURES:\n - ${fail.join("\n - ")}` : "\n=== THE FILM IS ON THE SHELF ===");
process.exit(fail.length ? 1 : 0);
