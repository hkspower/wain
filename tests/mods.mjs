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
    const g = JSON.parse(localStorage.getItem("gulf-road-nights-garage") ?? "{}");
    g.owned = [...new Set([...(g.owned ?? []), ...owned])];
    g.equipped = { ...(g.equipped ?? {}), ...equipped };
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify(g));
    e.applyGarage();

    e.setPaused(true);
    const reset = () => {
      e.player.s = e.track.length * 0.62;
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
      reset();
      e.player.speed = 30;
      for (let i = 0; i < 6; i++) { // 0.1 s of full lock
        e.player.speed = 30;
        e.setTouchInput({ steer: 1 });
        e.update(1 / 60);
        e.player.lat = 0;
      }
      return { smooth: +e.steerSmooth.toFixed(3) };
    }

    if (rig === "drift") {
      reset();
      e.player.speed = 45;
      let peak = 0;
      for (let i = 0; i < 150; i++) {
        e.player.speed = Math.max(e.player.speed, 35);
        e.setTouchInput({ throttle: 0.9, steer: 1 });
        e.touch.drift = true;
        e.update(1 / 60);
        peak = Math.max(peak, Math.abs(e.driftYaw));
        e.player.lat = 0;
      }
      e.touch.drift = false;
      return { peak: +peak.toFixed(3) };
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

const strip = () => page.evaluate(() => {
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    car: "wain-special", cars: ["wain-special"], owned: [], kd: 99999,
    equipped: { paint: "paint-white", glow: "glow-none" },
  }));
  window.__grnEngine.applyGarage();
});

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
console.log(`Quick rack   steer after 0.1s ${baseSteer.smooth} -> ${rackSteer.smooth}  ` +
  check(rackSteer.smooth > baseSteer.smooth * 1.2, "the quick rack is no quicker"));

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

// 6/7. Gearboxes — opposite ends of the same road
await strip();
const closeBox = await measure(["x"], { gearbox: "gearbox-close" }, "rollOn");
await strip();
const tallBox = await measure(["x"], { gearbox: "gearbox-tall" }, "rollOn");
await strip();
const closeTop = await measure(["x"], { gearbox: "gearbox-close" }, "topSpeed");
await strip();
const tallTop = await measure(["x"], { gearbox: "gearbox-tall" }, "topSpeed");
console.log(`Gearboxes    180-260 km/h: close ${closeBox.secs}s vs tall ${tallBox.secs}s  |  top: close ${closeTop.top} vs tall ${tallTop.top} km/h  ` +
  check(closeBox.secs < tallBox.secs, "the close-ratio box is not quicker in the roll-on") + " " +
  check(tallTop.top > closeTop.top + 5, "the tall final drive gains no top end"));

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nevery new mod changes the car");
await browser.close();
process.exit(fail.length ? 1 : 0);
