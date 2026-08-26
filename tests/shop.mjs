// The dealership, as rules.
//
//   npm run test:shop      (no browser, no dev server)
//
// Selling is the kind of feature whose bugs are all quiet: a trade-in
// that refunds the sticker turns every purchase into an undo button; a
// dealer who pays for the GTR's factory parts on the way out makes
// buy-and-flip a money printer; a sale that leaves the seat pointing at
// a car you no longer own crashes the garage the next time it opens.
// None of those shows up in a screenshot of the shop working, so each
// one is a check here.

import {
  CARS,
  PARTS,
  getCar,
  freshBuild,
  editBuild,
  tradeInValue,
  sellCar,
  RESALE_CAR_FRAC,
  RESALE_PART_FRAC,
} from "../src/game/mods.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

/** A save, built by hand — these tests own their state. */
function save(cars, driving, kd = 0) {
  const g = { kd, cars: [...cars], car: driving, builds: {} };
  for (const id of cars) g.builds[id] = freshBuild(id);
  return g;
}

// --- 1. The dealer pays less than you did ----------------------------
{
  const g = save(["wain-special", "salmiya-turbo"], "wain-special");
  const car = getCar("salmiya-turbo");
  const v = tradeInValue(g, "salmiya-turbo");
  console.log(
    `trade-in     ${car.name} bought at ${car.price}, dealer pays ${v} ` +
    `(${Math.round((v / car.price) * 100)}%)`
  );
  check(v === Math.round(car.price * RESALE_CAR_FRAC), "a stock car's trade-in is not the car fraction of its sticker");
  check(v < car.price, "the dealer refunds the sticker — every purchase is now an undo button");
  check(v > 0, "the dealer pays nothing for a real car");
}

// --- 2. Aftermarket parts add value, at the part fraction -------------
{
  const g = save(["wain-special", "salmiya-turbo"], "wain-special");
  const part = PARTS.find((p) => p.cat === "brakes" && p.price > 0);
  const b = editBuild(g, "salmiya-turbo");
  b.owned.push(part.id);
  const stock = Math.round(getCar("salmiya-turbo").price * RESALE_CAR_FRAC);
  const v = tradeInValue(g, "salmiya-turbo");
  console.log(
    `parts        ${part.name} (${part.price}) lifts the trade-in by ${v - stock}`
  );
  check(
    v === Math.round(getCar("salmiya-turbo").price * RESALE_CAR_FRAC + part.price * RESALE_PART_FRAC),
    "a fitted part does not add its fraction to the trade-in"
  );
  check(v - stock < part.price, "a used part resells at full price");
}

// --- 3. Factory parts are not paid for twice --------------------------
//
// The GTR ships with a dozen parts bolted in, and its sticker price
// already includes them. If the dealer priced them again on the way
// out, buying and immediately selling the GTR would net money.
{
  const built = CARS.find((c) => (c.factoryBuild ?? []).length > 0);
  if (built) {
    const g = save(["wain-special", built.id], "wain-special");
    const v = tradeInValue(g, built.id);
    console.log(
      `factory      ${built.name} ships with ${built.factoryBuild.length} parts; ` +
      `trade-in ${v} against sticker ${built.price}`
    );
    check(
      v === Math.round(built.price * RESALE_CAR_FRAC),
      `factory parts are priced into the trade-in — buy-and-flip nets ${v - Math.round(built.price * RESALE_CAR_FRAC)}`
    );
    check(v < built.price, "flipping the built car is profitable");
  } else {
    fail.push("no factory-built car in the roster — the double-pay check ran against nothing");
  }
}

// --- 4. A sale is a sale ----------------------------------------------
{
  const g = save(["wain-special", "salmiya-turbo"], "wain-special", 100);
  const v = tradeInValue(g, "salmiya-turbo");
  const r = sellCar(g, "salmiya-turbo");
  console.log(`\nsale         paid ${r.paid}, balance ${g.kd}, driveway [${g.cars.join(", ")}]`);
  check(r.ok, "a legal sale was refused");
  check(r.paid === v, "the sale paid a different number than the quote");
  check(g.kd === 100 + v, "the money did not arrive");
  check(!g.cars.includes("salmiya-turbo"), "the sold car is still in the driveway");
  check(!("salmiya-turbo" in g.builds), "the sold car's build survives — buying it back would deliver the old parts free");
}

// --- 5. Selling the car under you moves the seat ----------------------
{
  const g = save(["wain-special", "salmiya-turbo"], "salmiya-turbo");
  const r = sellCar(g, "salmiya-turbo");
  console.log(`seat         sold the car being driven; now driving ${g.car}`);
  check(r.ok, "selling the driven car was refused");
  check(g.car === "wain-special", "the seat points at a car that was just sold");
  check(g.cars.includes(g.car), "the seat points at a car not in the driveway");
}

// --- 6. The driveway can never be empty -------------------------------
{
  const g = save(["wain-special"], "wain-special", 0);
  const r = sellCar(g, "wain-special");
  console.log(`last car     ${r.ok ? "SOLD — the game is softlocked" : `refused (${r.reason})`}`);
  check(!r.ok, "the last car can be sold — a driving game with no car");
  check(g.cars.length === 1 && g.kd === 0, "the refused sale still changed the save");
}

// --- 7. You cannot sell what you do not own ---------------------------
{
  const g = save(["wain-special", "salmiya-turbo"], "wain-special", 50);
  const r = sellCar(g, "zeta-300-gtr");
  check(!r.ok && g.kd === 50 && g.cars.length === 2,
    "selling an unowned car was accepted, or changed the save");
}

// --- 8. Sell and re-buy is a loss, not a loop -------------------------
//
// The whole economy in one number: the round trip must cost money, on
// every car in the roster, parts or no parts.
{
  let worst = null;
  for (const c of CARS) {
    if (c.price <= 0) continue;
    const g = save(["wain-special", c.id], "wain-special", 0);
    const v = tradeInValue(g, c.id);
    const loss = c.price - v;
    if (loss <= 0) fail.push(`${c.id}: sell-and-rebuy nets ${-loss} — a money loop`);
    if (!worst || loss / c.price < worst.frac) worst = { id: c.id, frac: loss / c.price };
  }
  console.log(
    `round trip   every car loses money on sell-and-rebuy; ` +
    `tightest is ${worst.id} at ${Math.round(worst.frac * 100)}% lost`
  );
}

console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\nthe dealer buys, the dealer sells, and nobody prints money"
);
process.exit(fail.length ? 1 : 0);
