// Every new mod has to change how the car behaves, measurably. A part
// that only appears in a shop list is a lie told to the player, so each
// one here is fitted and then metered against the same car without it,
// stepping the sim by hand at a fixed 1/60 s.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// Fit a build, then run one of the measurement rigs against it.
const measure = (owned, equipped, rig) =>
  page.evaluate(([owned, equipped, rig]) => {
    const e = window.__grnEngine;
    // Builds are per car now, so a part has to be fitted to the car that
    // is about to be measured rather than to the player.
    const g = JSON.parse(localStorage.getItem("gulf-road-nights-garage") ?? "{}");
    g.builds = g.builds ?? {};
    const b = (g.builds[g.car] = g.builds[g.car] ?? { owned: [], equipped: {} });
    b.owned = [...new Set([...(b.owned ?? []), ...owned])];
    b.equipped = { ...(b.equipped ?? {}), ...equipped };
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify(g));
    e.applyGarage();

    e.setPaused(true);
    const reset = () => {
      e.player.s = 2400;
      e.player.lat = 0;
      e.player.speed = 0;
      e.heading = 0; e.steerSmooth = 0; e.driftYaw = 0; e.slipVel = 0; e.shake = 0;
      e.scrapeCooldown = 0;
      for (const t of e.traffic) t.s = e.track.wrap(e.player.s + e.track.length / 2);
      e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
      e.touch.drift = false;
    };

    if (rig === "launch") {
      reset();
      let spinPeak = 0, t100 = null;
      for (let i = 0; i < 60 * 12; i++) {
        e.setTouchInput({ throttle: 1 });
        e.update(1 / 60);
        spinPeak = Math.max(spinPeak, e.wheelspin);
        if (t100 === null && e.player.speed * 3.6 >= 100) t100 = (i + 1) / 60;
      }
      return { spinPeak: +spinPeak.toFixed(2), t100: +(t100 ?? 99).toFixed(2),
               top: +(e.player.speed * 3.6).toFixed(0) };
    }

    if (rig === "topSpeed") {
      // Pin the car dead straight: this measures the accel/drag
      // equilibrium, not how well an unsteered car survives corners.
      reset();
      for (let i = 0; i < 60 * 90; i++) {
        e.setTouchInput({ throttle: 1 });
        e.heading = 0; e.slipVel = 0; e.player.lat = 0;
        for (const t of e.traffic) t.s = e.track.wrap(e.player.s + e.track.length / 2);
        e.update(1 / 60);
      }
      return { top: +(e.player.speed * 3.6).toFixed(0) };
    }

    if (rig === "rollOn") {
      // 100 -> 200 km/h in top: the power-limited regime where gearing
      // and engine mods actually argue with each other.
      reset();
      e.player.speed = 180 / 3.6;
      let frames = 0;
      while (e.player.speed * 3.6 < 260 && frames < 60 * 90) {
        e.setTouchInput({ throttle: 1 });
        e.heading = 0; e.slipVel = 0; e.player.lat = 0;
        for (const t of e.traffic) t.s = e.track.wrap(e.player.s + e.track.length / 2);
        e.update(1 / 60);
        frames++;
      }
      return { secs: +(frames / 60).toFixed(2) };
    }

    if (rig === "turnIn") {
      // Heading built in half a second of full lock WHILE braking hard —
      // the friction-circle case coilovers are supposed to rescue
      reset();
      e.player.speed = 30;
      for (let i = 0; i < 30; i++) {
        e.player.speed = 30;
        e.setTouchInput({ steer: 1, brake: 1, throttle: 0 });
        e.update(1 / 60);
        e.player.lat = 0;
      }
      return { heading: +Math.abs(e.heading).toFixed(4) };
    }

    if (rig === "steerResponse") {
      // TIME TO 90% OF LOCK, not position at a fixed instant.
      //
      // This used to hold full lock for 0.1 s and compare how far the
      // wheel had turned. Both racks are exponentials converging on the
      // same ceiling, so that measurement compresses as the base gets
      // quicker: at rate 13 the standard rack is already at 0.73 after
      // 0.1 s and a rack of INFINITE speed could only read 1.0 — a
      // ratio of 1.37, against a check that wanted 1.2. There was
      // almost no room left in it, and when the base steering was made
      // faster the check failed on a rack that had not changed.
      //
      // The difference between the two is a rate, so measure a rate.
      // Time to 90% is 1/rate x ln(10), which keeps the full 1.4x
      // whatever the base becomes — and it is the number mods.ts quotes
      // in its own comment: 127 ms against 177.
      reset();
      let ms = 0;
      for (let i = 0; i < 240; i++) {
        e.player.speed = 30;
        e.setTouchInput({ steer: 1 });
        e.update(1 / 60);
        e.player.lat = 0;
        ms += 1000 / 60;
        if (e.steerSmooth >= 0.9) break;
      }
      return { smooth: +e.steerSmooth.toFixed(3), ms: Math.round(ms) };
    }

    if (rig === "drift") {
      reset();
      e.player.speed = 45;
      let peak = 0;
      let spun = false;
      for (let i = 0; i < 150; i++) {
        e.player.speed = Math.max(e.player.speed, 35);
        // Half lock, not full. Pinned at full lock both tire types
        // over-rotated and spun, and this read the spin sweep — an
        // identical 126° on slicks and on drift rubber, which is the
        // reading a comparison gives you when neither side is measuring
        // what it names. Half lock and part throttle is the same input
        // for both, so the difference between them is the tires — and it
        // is gentle enough that the angle settles where the entry puts it
        // instead of creeping toward whichever spin threshold arrives
        // first, which flattened a real 1.4x difference to 1.1x.
        e.setTouchInput({ throttle: 0.3, steer: 0.5 });
        e.touch.drift = true;
        e.update(1 / 60);
        if (e.ds.spinT > 0) spun = true;
        peak = Math.max(peak, Math.abs(e.driftYaw));
        e.player.lat = 0;
      }
      e.touch.drift = false;
      return { peak: +peak.toFixed(3), spun };
    }

    if (rig === "crash") {
      reset();
      e.player.speed = 45;
      e.heading = 0.42;
      let frames = 0;
      while (frames < 240) {
        e.setTouchInput({ throttle: 0.6 });
        e.heading = 0.42;
        e.update(1 / 60);
        frames++;
        if (e.shake > 0.05) break;
      }
      return { kept: +e.player.speed.toFixed(1) };
    }
    return {};
  }, [owned, equipped, rig]);

const strip = (car = "wain-special") => page.evaluate((car) => {
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    car, cars: [car], kd: 99999,
    builds: { [car]: { owned: [], equipped: { paint: "paint-white", glow: "glow-none" } } },
  }));
  window.__grnEngine.applyGarage();
}, car);
// Gearing is measured on a car whose governor is above the test band:
// the starter is limited to 180 km/h, so a 180-260 roll-on on it would
// measure the limiter, not the gearbox.
const FAST = "falcon-720";

console.log("=== NEW MODS, MEASURED ===\n");

// 1. Limited-slip differential — less wheelspin, quicker launch
await strip();
const baseLaunch = await measure([], {}, "launch");
await strip();
const lsdLaunch = await measure(["lsd"], {}, "launch");
console.log(`LSD          wheelspin ${baseLaunch.spinPeak} -> ${lsdLaunch.spinPeak} m/s², 0-100 ${baseLaunch.t100}s -> ${lsdLaunch.t100}s  ` +
  check(lsdLaunch.spinPeak < baseLaunch.spinPeak - 0.3, "LSD did not reduce wheelspin") + " " +
  check(lsdLaunch.t100 < baseLaunch.t100, "LSD did not improve the launch"));

// 2. Coilovers — turn-in survives heavy braking
await strip();
const baseTurn = await measure([], {}, "turnIn");
await strip();
const coilTurn = await measure(["coilovers"], {}, "turnIn");
console.log(`Coilovers    braking turn-in ${baseTurn.heading} -> ${coilTurn.heading} rad  ` +
  check(coilTurn.heading > baseTurn.heading * 1.05, "coilovers did not restore turn-in under braking"));

// 3. Quick rack — the wheel answers faster
await strip();
const baseSteer = await measure([], {}, "steerResponse");
await strip();
const rackSteer = await measure(["rack"], {}, "steerResponse");
console.log(`Quick rack   90% of lock in ${baseSteer.ms} ms -> ${rackSteer.ms} ms  ` +
  check(
    rackSteer.ms <= baseSteer.ms * 0.8,
    `the quick rack takes ${rackSteer.ms} ms to the standard rack's ${baseSteer.ms} — that is not a quicker rack`
  ));

// 4. Roll cage — contact costs less speed
await strip();
const baseCrash = await measure([], {}, "crash");
await strip();
const cageCrash = await measure(["cage"], {}, "crash");
console.log(`Roll cage    speed kept in a crash ${baseCrash.kept} -> ${cageCrash.kept} m/s  ` +
  check(cageCrash.kept > baseCrash.kept + 1, "the cage absorbed nothing"));

// 5. Drift tires — bigger angle than slicks, which are the grip peak
await strip();
const slickDrift = await measure(["x"], { tires: "tires-slick" }, "drift");
await strip();
const driftDrift = await measure(["x"], { tires: "tires-drift" }, "drift");
console.log(`Drift tires  drift angle ${(slickDrift.peak * 57.3).toFixed(0)}° on slicks -> ${(driftDrift.peak * 57.3).toFixed(0)}°  ` +
  check(driftDrift.peak > slickDrift.peak * 1.2, "drift tires do not hang the tail out further"));
check(!slickDrift.spun && !driftDrift.spun,
  "a slide held on measured lock spun anyway — the angles above are spins, not drift angles");

// 8. Exhaust systems — audible, visible, and each tier its own thing
//
// The old catalogue sold "+7% power, deeper voice" and carried an
// exhaustLevel that nothing in the codebase read, so the voice half of
// that sentence was never true. Every field is checked against something
// that consumes it.
const exhaustOf = (equipped) =>
  page.evaluate(async (eq) => {
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
      car: "wain-special", cars: ["wain-special"], owned: Object.values(eq), kd: 99999,
      equipped: { paint: "paint-white", glow: "glow-none", ...eq },
    }));
    const e = window.__grnEngine;
    e.applyGarage();
    await new Promise((r) => setTimeout(r, 120));
    const tips = e.carBody.userData.exhaustTips ?? [];
    // The tip finish, read off the material the pipes were actually built
    // with rather than off the spec that asked for it.
    let finish = null;
    let pipes = 0;
    const shapes = new Set();
    const xs = new Set();
    const ys = new Set();
    e.carBody.traverse((o) => {
      if (!o.isMesh || !o.userData.exhaustPipe) return;
      pipes++;
      finish = o.material.color.getHexString();
      shapes.add(o.userData.tipShape ?? "round");
      xs.add(+o.position.x.toFixed(3));
      ys.add(+o.position.y.toFixed(3));
    });
    return {
      spec: e.tune.exhaust,
      power: e.tune.accelMult,
      tips: tips.length,
      // Backfire is born at the tips; both must sit behind the tail.
      tipZ: tips.length ? +Math.min(...tips.map((t) => t.z)).toFixed(2) : null,
      finish,
      pipes,
      shapes: [...shapes],
      // How many places across the car the pipes come out of, and how
      // many heights they sit at. A twin-tube system is FOUR pipes at
      // TWO positions, stacked — which is a different car from four
      // pipes spread across the bumper, and the counts are how you tell
      // them apart without looking.
      clusters: xs.size,
      levels: ys.size,
    };
  }, equipped);

await strip();
const exStock = await exhaustOf({});
await strip();
const exSport = await exhaustOf({ exhaust: "exhaust" });
await strip();
const exRace = await exhaustOf({ exhaust: "exhaust-race" });
await strip();
const exTi = await exhaustOf({ exhaust: "exhaust-ti" });
await strip();
const exSquare = await exhaustOf({ exhaust: "exhaust-square" });
await strip();
const exTwin = await exhaustOf({ exhaust: "exhaust-twin" });

console.log(`Exhaust      stock ${exStock.tips} tips  ->  sport ${exSport.tips}  race ${exRace.tips}  titanium ${exTi.tips}`);
console.log(`             power ${exStock.power.toFixed(2)} -> ${exSport.power.toFixed(2)} -> ${exRace.power.toFixed(2)} -> ${exTi.power.toFixed(2)}`);
console.log(`             voice pitch ${exStock.spec.pitch} -> ${exSport.spec.pitch} -> ${exRace.spec.pitch}, rasp ${exStock.spec.rasp} -> ${exTi.spec.rasp}`);
console.log(`             tip finish ${exStock.finish} / ${exSport.finish} / ${exRace.finish} / ${exTi.finish}`);
check(exSport.power > exStock.power && exRace.power > exSport.power && exTi.power > exRace.power,
  "the exhaust tiers do not step on power");
check(exSport.spec.pitch < 1 && exRace.spec.pitch < exSport.spec.pitch,
  "the aftermarket systems are no deeper than the factory one");
check(exTi.spec.rasp > exRace.spec.rasp, "the titanium system is not the raspiest");
check(exRace.spec.pop > exSport.spec.pop && exSport.spec.pop > exStock.spec.pop,
  "the systems do not bark progressively harder");
check(exTi.tips === 4, `the titanium quad has ${exTi.tips} tips`);
const finishes = [exStock.finish, exSport.finish, exRace.finish, exTi.finish];
check(finishes.every((f) => typeof f === "string"),
  `a tier built no exhaust pipes at all: ${JSON.stringify(finishes)}`);
check(new Set(finishes).size >= 3, `the tips only come in ${new Set(finishes).size} finishes`);
check(exStock.pipes === exStock.tips && exTi.pipes === exTi.tips,
  `pipes built (${exStock.pipes}/${exTi.pipes}) do not match the flame anchors (${exStock.tips}/${exTi.tips})`);
// --- Shape and clustering -------------------------------------------
//
// Every system in this game used to be a round cylinder, and only the
// count, the bore and the finish changed — which is not how exhausts
// differ. The two added here are the two that read differently from ten
// metres behind, which is the view a rival has for the whole race.
console.log(`             square ${exSquare.pipes} pipes, shape ${exSquare.shapes.join("/")}; ` +
  `twin ${exTwin.pipes} pipes in ${exTwin.clusters} clusters at ${exTwin.levels} heights`);
check(exSquare.shapes.length === 1 && exSquare.shapes[0] === "square",
  `the square system built ${exSquare.shapes.join("/")} tips`);
check(exSport.shapes[0] === "round" && exRace.shapes[0] === "round",
  "a round system stopped being round");
// Four pipes, two positions, two heights: one exit split in two, stacked.
check(exTwin.pipes === 4, `the twin-tube system built ${exTwin.pipes} pipes`);
check(exTwin.clusters === 2, `the twin-tube system spread its pipes across ${exTwin.clusters} positions, not 2`);
check(exTwin.levels === 2, `the twin-tube system's pipes all sit at ${exTwin.levels} height(s) — they are meant to stack`);
// ...against the quad, which IS four holes across the bumper.
check(exTi.clusters === 4, `the titanium quad clustered into ${exTi.clusters} positions instead of 4`);
check(exTi.levels === 1, `the titanium quad's tips sit at ${exTi.levels} heights, not one`);
check(exSquare.power > exSport.power && exTwin.power > exRace.power,
  "the two new systems do not sit where their prices put them on power");

// The flame comes out of the pipe, not the boot floor: the anchors used
// to be hardcoded at z -2.08 while the tail sits at -2.4.
for (const [name, r] of [["stock", exStock], ["sport", exSport], ["race", exRace], ["titanium", exTi]]) {
  check(r.tips > 0 && r.tipZ < -2.3,
    `${name} backfire spawns at z ${r.tipZ}, which is inside the car`);
}
console.log(`             flame origin z ${exStock.tipZ} / ${exSport.tipZ} / ${exRace.tipZ} / ${exTi.tipZ}  ` +
  check(true, ""));

// 6/7. Gearboxes — opposite ends of the same road
await strip(FAST);
const closeBox = await measure(["x"], { gearbox: "gearbox-close" }, "rollOn");
await strip(FAST);
const tallBox = await measure(["x"], { gearbox: "gearbox-tall" }, "rollOn");
await strip(FAST);
const closeTop = await measure(["x"], { gearbox: "gearbox-close" }, "topSpeed");
await strip(FAST);
const tallTop = await measure(["x"], { gearbox: "gearbox-tall" }, "topSpeed");
console.log(`Gearboxes    180-260 km/h: close ${closeBox.secs}s vs tall ${tallBox.secs}s  |  top: close ${closeTop.top} vs tall ${tallTop.top} km/h  ` +
  check(closeBox.secs < tallBox.secs, "the close-ratio box is not quicker in the roll-on") + " " +
  check(tallTop.top > closeTop.top + 5, "the tall final drive gains no top end"));

// 8. A build belongs to a car, not to the player.
// One owned list used to follow the driver into whatever he sat in, so
// the first turbo upgraded the whole driveway and every car bought after
// the first arrived fully built. This is the check that it does not.
//
// B is compared against B — its OWN stock numbers — not against A. The
// first version of this compared B's total against A's and passed even
// with builds forced global, because B's base is 140 km/h slower than
// A's and swallowed the whole inherited build.
const perCar = await page.evaluate(() => {
  const e = window.__grnEngine;
  const A = "falcon-720", B = "deera-sedan";
  const FITTED = { owned: ["twin-turbo", "weight", "ecu"], equipped: { aspiration: "twin-turbo" } };
  const read = (car, builds, cars) => {
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify({ car, cars, kd: 99999, builds }));
    e.applyGarage();
    return { accel: +e.tune.accelMult.toFixed(3), top: e.tune.topSpeedKmh };
  };
  return {
    // A alone, stock and built: the parts must do something at all.
    bareA: read(A, { [A]: { owned: [], equipped: {} } }, [A]),
    builtA: read(A, { [A]: FITTED }, [A]),
    // B alone, stock — the reference.
    bareB: read(B, { [B]: { owned: [], equipped: {} } }, [B]),
    // B in a driveway where A is fully built. B must be untouched.
    bWithBuiltA: read(B, { [A]: FITTED, [B]: { owned: [], equipped: {} } }, [A, B]),
  };
});
console.log(
  `per-car      A stock ${perCar.bareA.accel}/${perCar.bareA.top} -> built ${perCar.builtA.accel}/${perCar.builtA.top}  |  ` +
    `B alone ${perCar.bareB.accel}/${perCar.bareB.top} -> beside a built A ${perCar.bWithBuiltA.accel}/${perCar.bWithBuiltA.top}  ` +
    check(perCar.builtA.accel > perCar.bareA.accel, "the parts fitted to A did nothing to A") + " " +
    check(
      perCar.bWithBuiltA.accel === perCar.bareB.accel && perCar.bWithBuiltA.top === perCar.bareB.top,
      `B inherited A's build: ${perCar.bWithBuiltA.accel}/${perCar.bWithBuiltA.top} against its own stock ${perCar.bareB.accel}/${perCar.bareB.top}`
    )
);

// 9. An old save keeps what it paid for.
// Saves written before builds were per-car carry one owned list at the
// top level. It has to land on the car that was being driven, or every
// player loses their whole build the day this ships.
const migrated = await page.evaluate(() => {
  const e = window.__grnEngine;
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    car: "falcon-720", cars: ["falcon-720", "deera-sedan"], kd: 4242,
    owned: ["twin-turbo", "weight"], equipped: { aspiration: "twin-turbo" },
  }));
  e.applyGarage();
  const driven = { accel: +e.tune.accelMult.toFixed(3), top: e.tune.topSpeedKmh };
  const g = JSON.parse(localStorage.getItem("gulf-road-nights-garage"));
  return { driven, kd: g.kd, stillLegacy: Array.isArray(g.owned) };
});
console.log(`migration    old save -> driven car accel ${migrated.driven.accel} top ${migrated.driven.top}, ${migrated.kd} KD kept  ` +
  check(migrated.driven.top > 360, "an old save lost the parts it had bought") + " " +
  check(migrated.kd === 4242, "an old save lost its money"));

// 10. What a brand new save is handed.
// Ten dinars and a free panel filter — the money buys nothing, which is
// the point, and the filter means the first thing in the shop is
// something already owned rather than a wall of prices.
const fresh = await page.evaluate(() => {
  const e = window.__grnEngine;
  localStorage.removeItem("gulf-road-nights-garage");
  e.applyGarage();
  const g = JSON.parse(localStorage.getItem("gulf-road-nights-garage") ?? "null");
  // applyGarage only reads; force the default to be written.
  const loaded = window.__grnLoadGarage();
  const b = loaded.builds[loaded.car];
  return {
    kd: loaded.kd,
    car: loaded.car,
    owns: b.owned.includes("intake-basic"),
    fitted: b.equipped.intake,
    accel: +e.tune.accelMult.toFixed(4),
    wrote: g !== null,
  };
});
console.log(
  `new save     ${fresh.kd} KD, driving the ${fresh.car}, intake fitted: ${fresh.fitted}  ` +
    check(fresh.kd === 10, `a new save starts with ${fresh.kd} KD, not 10`) + " " +
    check(fresh.owns && fresh.fitted === "intake-basic", "the free panel filter is not fitted from new")
);
// The free filter has to be worth something, or it is a label.
//
// There is no "no intake" state to compare against, and that is correct
// rather than a gap: loadGarage fits the basic filter to any save that
// lacks one, so every car in the game has at least that. So the worth is
// proved against the car's own bare figure — power x the engine's
// multiplier — which is what accelMult would be with nothing in the
// slot at all.
const intakeTiers = await page.evaluate(() => {
  const e = window.__grnEngine;
  const set = (id) => {
    const g = window.__grnLoadGarage();
    const b = g.builds[g.car];
    if (!b.owned.includes(id)) b.owned.push(id);
    b.equipped.intake = id;
    window.__grnSaveGarage(g);
    e.applyGarage();
    return +e.tune.accelMult.toFixed(4);
  };
  const basic = set("intake-basic");
  const cold = set("intake");
  const bare = +(e.tune.engine.powerMult * 1.0).toFixed(4); // wain-special, power 1.0
  return { bare, basic, cold };
});
console.log(
  `intake       bare ${intakeTiers.bare} -> basic ${intakeTiers.basic} -> cold ${intakeTiers.cold}  ` +
    check(
      Math.abs(intakeTiers.basic - (intakeTiers.bare + 0.02)) < 1e-3,
      `the free filter is worth ${(intakeTiers.basic - intakeTiers.bare).toFixed(3)}, not the 0.02 it claims`
    ) + " " +
    check(
      Math.abs(intakeTiers.cold - (intakeTiers.bare + 0.05)) < 1e-3,
      `the Cold Intake is worth ${(intakeTiers.cold - intakeTiers.bare).toFixed(3)}, not the 0.05 it claims`
    )
);
// And an old save that paid 250 KD for the Cold Intake keeps it fitted
// rather than finding an empty slot where its part used to be.
const intakeMigration = await page.evaluate(() => {
  const e = window.__grnEngine;
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    car: "deera-sedan", cars: ["deera-sedan"], kd: 900,
    builds: { "deera-sedan": { owned: ["intake"], equipped: {} } },
  }));
  const g = window.__grnLoadGarage();
  const b = g.builds["deera-sedan"];
  e.applyGarage();
  return { fitted: b.equipped.intake, owns: b.owned.includes("intake-basic") };
});
console.log(
  `intake save  an owned Cold Intake migrates to fitted: ${intakeMigration.fitted}  ` +
    check(intakeMigration.fitted === "intake", "a paid-for Cold Intake came unfitted") + " " +
    check(intakeMigration.owns, "an old save did not get the free basic filter")
);

// 11. The invite code.
// Six characters from an alphabet with no O/0 or I/1/L in it, stable for
// a given save, and different for different saves. This is asserted
// rather than looked at because the first version rendered
// "XundefinedundefinedKundefined5" — thirty characters, three of them
// the word "undefined" — and nothing anywhere threw.
const codes = await page.evaluate(() => {
  const c = window.__grnCommunity;
  const ids = [
    "d3d94468-2f0b-4b4a-9a0a-000000000001",
    "d3d94468-2f0b-4b4a-9a0a-000000000002",
    "totally-different-save",
  ];
  const made = ids.map((id) => c.inviteCode(id));
  return {
    made,
    stable: c.inviteCode(ids[0]) === made[0],
    mine: c.inviteCode(c.playerId()),
    shaped: made.every((x) => c.isCodeShaped(x)),
    tidy: c.normaliseCode(" ab-c2 34 "),
    empty: c.inviteCode(""),
  };
});
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
console.log(
  `invite code  ${codes.made.join(" / ")} (mine ${codes.mine})  ` +
    check(
      codes.made.every((x) => x.length === 6),
      `a code came out ${codes.made.map((x) => x.length).join("/")} characters long, not 6`
    ) + " " +
    check(
      codes.made.every((x) => [...x].every((ch) => ALPHABET.includes(ch))),
      `a code used a character outside the unambiguous alphabet: ${codes.made.join(",")}`
    )
);
check(codes.stable, "the same save produced two different codes");
check(
  new Set(codes.made).size === codes.made.length,
  `different saves collided: ${codes.made.join(",")}`
);
check(codes.made[0] !== codes.made[1], "two ids differing in one character share a code");
check(codes.shaped, "a generated code does not pass the game's own shape check");
check(codes.tidy === "ABC234", `a typed code tidied to "${codes.tidy}", not "ABC234"`);
check(codes.empty === "", "a save with no id still produced a code");
check(codes.mine.length === 6, `this save's own code is ${codes.mine.length} characters`);

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nevery new mod changes the car");
await browser.close();
process.exit(fail.length ? 1 : 0);
