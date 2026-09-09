// The differential is a choice, and every rung of it is worth its price.
//
//   npm run test:traction
//
// Pure arithmetic, no browser: every claim here is a question about
// mods.ts and accel.ts agreeing, and it should answer in milliseconds.
//
// This exists because the thing it replaced did not work. Traction was
// one always-on tick-box — buy the 1300 KD Limited-Slip Diff or do not —
// and measured across the roster it bought NOTHING on fifteen of the
// seventeen cars: a standing start on a standard car never reaches the
// traction cap, so raising the cap changes nothing at all. The shop said
// "far less wheelspin off the line" with no condition attached, and the
// player most likely to buy it was the player it did least for. That is
// not a balance complaint, it is a part that does not do what it says.
//
// So the checks below are in two halves. The ladder must be a real
// ladder — ordered, exclusive, with a free rung underneath so the slot
// is never empty — and it must PAY, in seconds, on the car a player
// would be fitting it to.
import { CARS, PARTS, EXCLUSIVE_CATS, computeEffects, freshBuild, loadGarage } from "../src/game/mods.ts";
import { launchThrustFor, timeTo100 } from "../src/game/accel.ts";
import { getEngine } from "../src/game/engines.ts";
import { driveShareFor } from "../src/game/grip.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const DIFFS = PARTS.filter((p) => p.cat === "diff");
const byId = (id) => DIFFS.find((d) => d.id === id);

// ---- 1. One axle, one diff, never none ------------------------------
{
  const free = DIFFS.filter((d) => d.price === 0);
  console.log(
    `${DIFFS.length} differentials, ${free.length} free  ` +
      check(EXCLUSIVE_CATS.has("diff"), `"diff" is not an exclusive slot: a car could run two differentials`) +
      check(free.length === 1, `${free.length} free diffs; exactly one is the stock axle`)
  );
  // A car with an empty axle would silently fall back to the open diff's
  // numbers and read as if nothing were wrong, which is the failure the
  // free rung exists to make impossible.
  const empty = CARS.filter((c) => {
    const b = freshBuild(c.id);
    return !b.equipped.diff || !b.owned.includes(b.equipped.diff);
  });
  console.log(
    `every new car rolls out with a diff fitted  ` +
      check(empty.length === 0, `no diff fitted on: ${empty.map((c) => c.id).join(", ")}`)
  );
  const bad = CARS.filter((c) => !byId(freshBuild(c.id).equipped.diff));
  console.log(
    `and it is a diff that exists  ` +
      check(bad.length === 0, `fitted a non-diff: ${bad.map((c) => `${c.id} -> ${freshBuild(c.id).equipped.diff}`).join(", ")}`)
  );
}

// ---- 2. Nobody loses a part they paid for ---------------------------
//
// The diff moved out of "chassis" (own it and every car has one) into a
// slot. Two old saves, both of which have to survive: one that bought
// the LSD and one that never did.
{
  const KEY = "gulf-road-nights-garage";
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  };
  const legacy = (owned) =>
    JSON.stringify({
      kd: 4000,
      car: "zeta-300",
      cars: ["zeta-300"],
      builds: { "zeta-300": { owned, equipped: { tires: "tires-race" } } },
    });

  store.set(KEY, legacy(["lsd", "coilovers"]));
  const paid = loadGarage().builds["zeta-300"];
  console.log(
    `a save that bought the LSD keeps it, fitted  ` +
      check(paid.equipped.diff === "lsd", `got "${paid.equipped.diff}"`) +
      check(paid.owned.includes("lsd"), `the LSD fell out of the owned list`) +
      check(paid.owned.includes("coilovers"), `it lost its coilovers on the way through`)
  );

  store.set(KEY, legacy(["coilovers"]));
  const never = loadGarage().builds["zeta-300"];
  console.log(
    `a save that never did gets the open diff free  ` +
      check(never.equipped.diff === "diff-open", `got "${never.equipped.diff}"`) +
      check(never.owned.includes("diff-open"), `it is fitted but not owned`) +
      check(!never.owned.includes("lsd"), `it was handed a 1300 KD part it never bought`)
  );
  delete globalThis.localStorage;
}

// ---- 3. A ladder, not a list ----------------------------------------
//
// Straight-line drive and willingness to turn are OPPOSITE orders, and
// that is the whole design: the welded spool wins the drag and loses the
// corner, the clutch pack costs the most because it is the one that does
// not make you choose. If these two ever agree, one of the four parts
// has become strictly better than another and the slot is a list again.
{
  const tune = (id) => {
    const b = freshBuild("zeta-300");
    if (!b.owned.includes(id)) b.owned.push(id);
    b.equipped.diff = id;
    return computeEffects({ kd: 1, car: "zeta-300", cars: ["zeta-300"], builds: { "zeta-300": b } }, "zeta-300");
  };
  const drive = ["diff-open", "lsd", "diff-clutch", "diff-spool"];
  const turn = ["diff-spool", "diff-open", "lsd", "diff-clutch"];
  const asc = (order, key) => order.every((id, i) => i === 0 || tune(order[i - 1])[key] < tune(id)[key]);
  console.log(
    `drive  ${drive.map((id) => `${byId(id).name.split(" ")[0]} ${tune(id).tractionMult.toFixed(2)}`).join(" < ")}  ` +
      check(asc(drive, "tractionMult"), `traction is not ordered open < LSD < clutch < spool`)
  );
  console.log(
    `turn   ${turn.map((id) => `${byId(id).name.split(" ")[0]} ${tune(id).understeerMult.toFixed(2)}`).join(" > ")}  ` +
      check(asc([...turn].reverse(), "understeerMult"), `understeer is not ordered spool worst, clutch best`)
  );
  // The spool is the cheapest thing that is not free AND the strongest
  // in a straight line. That is deliberate, and it is only honest if it
  // is genuinely the worst thing to steer.
  console.log(
    `the cheap one is the violent one  ` +
      check(byId("diff-spool").price < byId("lsd").price, `the spool is not the cheapest paid rung`) +
      check(tune("diff-spool").understeerMult > tune("diff-open").understeerMult, `the spool costs nothing in the corners`) +
      check(byId("diff-clutch").price > byId("lsd").price, `the no-downside diff is not the dear one`)
  );
}

// ---- 4. Traction breaks at all -------------------------------------
//
// The check that would have been red for the entire life of this game.
//
// The traction cap used the car's whole grip figure with no account of
// how many wheels drive or how much of the car is sitting on them, and
// measured over a full-throttle run through the gears — every car,
// standard and fully built — thrust peaked at 0.47 to 0.96 of it. Never
// above. So `wheelspin` was always zero, and everything written on top
// of it was unreachable: the power-over drift entry in drift.ts, the
// burnout in engine.ts, and every traction part in the shop, because
// raising a cap nothing reaches buys nothing.
//
// DRIVE_SHARE is the missing term. This asserts the consequence.
{
  // What the garage can actually sell, so the claim is about a car a
  // player can own rather than about an arbitrary multiplier.
  const BUY = ["twin-turbo", "intake", "ecu", "exhaust-ti", "weight", "carbon-full"];
  const SWAP = new Set(["aspiration", "intake", "exhaust", "gearbox", "carbon", "tires", "brakes", "diff"]);
  const tuneOf = (carId, extra) => {
    const b = freshBuild(carId);
    for (const id of extra) {
      const part = PARTS.find((p) => p.id === id);
      if (!part) throw new Error(`no such part: ${id}`);
      if (!b.owned.includes(id)) b.owned.push(id);
      if (SWAP.has(part.cat)) b.equipped[part.cat] = id;
    }
    return computeEffects({ kd: 1, car: carId, cars: [carId], builds: { [carId]: b } }, carId);
  };

  const spins = [];
  const dead = [];
  for (const car of CARS) {
    const stock = tuneOf(car.id, []);
    const limitMs = car.topSpeedKmh / 3.6;
    const lc = {
      ceiling: Math.max(115, limitMs * 1.25),
      gripAccel: stock.gripAccel, downforce: stock.downforce,
      tractionMult: stock.tractionMult, driveShare: stock.driveShare,
      engine: getEngine(car.engine), boostMult: stock.boostMult,
      twinTurbo: stock.aspiration === "twin",
    };
    let thrust = launchThrustFor(car.zeroTo100s, lc);
    const headroom = 1 - ((0.0012 * limitMs * limitMs + 1.2) * 0.35) / thrust;
    lc.ceiling = Math.max(115, headroom > 0.08 ? limitMs / headroom : limitMs * 12);
    thrust = launchThrustFor(car.zeroTo100s, lc);

    const built = tuneOf(car.id, BUY);
    const gain = built.accelMult / built.stockAccelMult;
    // A cap that BINDS is a cap that changes the answer when it moves.
    // Raising it and getting the same time back to the millisecond means
    // the thrust never reached it, which is the whole failure.
    const at = (tm) => timeTo100(thrust * gain, { ...lc, gripAccel: built.gripAccel,
      downforce: built.downforce, tractionMult: tm });
    const open = at(tuneOf(car.id, [...BUY, "diff-open"]).tractionMult);
    const rungs = ["diff-spool", "lsd", "diff-clutch"].map((id) =>
      ({ id, gain: open - at(tuneOf(car.id, [...BUY, id]).tractionMult) }));
    const binds = rungs.some((r) => r.gain > 0.005);
    if (binds) {
      spins.push(car.id);
      for (const r of rungs) if (r.gain <= 0.005) dead.push(`${car.id}/${r.id}`);
    }
  }
  console.log(
    `${spins.length}/${CARS.length} cars break traction on a build the shop sells  ` +
      check(spins.length > 0, `NO car in the game can spin a wheel: the traction cap is unreachable and every part in this slot is decoration`) +
      check(spins.length >= 6, `only ${spins.length} cars: ${spins.join(", ")}`)
  );
  // Where the shop's stated condition is met, all three rungs must pay.
  // Where it is not, the descriptions say so out loud, which is checked
  // below rather than left to the player to discover.
  console.log(
    `and where they do, every rung pays  ` +
      check(dead.length === 0, `bought nothing: ${dead.join(", ")}`)
  );
  const vague = PARTS.filter(
    (p) => p.cat === "diff" && p.price > 0 && !/out-pull the tires/.test(p.desc)
  );
  console.log(
    `every priced diff states the condition  ` +
      check(vague.length === 0, `sold without saying when it helps: ${vague.map((p) => p.id).join(", ")}`)
  );
}

// ---- 4b. All-wheel drive is a real advantage ------------------------
//
// Four driven wheels put down more than two, and a front axle that
// unloads under power puts down least. The game had no way to say this
// before: the cap was the same whole-car grip figure whatever drove.
{
  const share = (d) => driveShareFor(d);
  console.log(
    `awd ${share("awd").toFixed(2)} > rwd ${share("rwd").toFixed(2)} > fwd ${share("fwd").toFixed(2)}  ` +
      check(share("awd") > share("rwd"), `all-wheel drive puts down no more than rear`) +
      check(share("rwd") > share("fwd"), `a front driver puts down as much as a rear one`) +
      check(share("awd") <= 1, `a driven axle delivers more than the car's whole grip`)
  );
}

// ---- 5. And the showroom did not move -------------------------------
//
// Adding a slot must not restate a single card. Every car's delivered
// traction is checked against what it had when the diff was a tick-box:
// stock for fifteen of them, the LSD for the two that are sold already
// built and list it in their factory build.
{
  const wrong = CARS.filter((c) => {
    const t = computeEffects({ kd: 1, car: c.id, cars: [c.id], builds: { [c.id]: freshBuild(c.id) } }, c.id);
    const want = (c.factoryBuild ?? []).includes("lsd") ? 1.16 : 1;
    return Math.abs(t.tractionMult - want) > 1e-9;
  });
  console.log(
    `all ${CARS.length} cars deliver on the traction they always had  ` +
      check(wrong.length === 0, `restated: ${wrong.map((c) => c.id).join(", ")}`)
  );
}

if (fail.length) {
  console.error(`\n${fail.length} failed:\n`);
  for (const f of fail) console.error(`  ${f}`);
  process.exit(1);
}
console.log("\nthe differential is a real choice, and every rung of it pays.");
