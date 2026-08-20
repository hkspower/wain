// Fuel, measured on the live game.
//
//   npm run dev
//   node tests/fuel.mjs
//
// A fuel gauge is trivial to add and almost as trivial to add wrongly.
// The failure modes are all quiet ones: a needle that moves at a rate
// nobody chose, a tank that never actually empties, a station that is
// scenery because the car cannot reach it, a pump that fills for free.
// So each is provoked:
//
//   the burn      is physical — the V8 drinks more than the 1.6, at the
//                 same throttle, in the right ratio, because it is a
//                 bigger air pump and for no other reason
//   the tank      empties, and the engine stops when it does
//   the forecourt is somewhere a car can actually be: the road opens,
//                 and no building is standing on it
//   the pump      fills, charges in fils, and stops at the brim
//   the gauge     tracks it, in litres, and says so when it is dry
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

// --- 1. The burn is an air pump, not a table -------------------------
const burn = await page.evaluate(() => {
  const { fuelLitresPerHour } = window.__grnEngineMath;
  return window.__grnEngines.map((e) => ({
    id: e.id,
    litres: e.litres,
    idle: +fuelLitresPerHour(e, 0, 0).toFixed(2),
    cruise: +fuelLitresPerHour(e, 0.3, 0.4).toFixed(1),
    full: +fuelLitresPerHour(e, 1, 0.95).toFixed(1),
  }));
});
console.log("burn      engine     idle L/h   cruise   flat out");
for (const b of burn) {
  console.log(
    `          ${b.id.padEnd(9)} ${String(b.idle).padStart(6)}   ${String(b.cruise).padStart(6)}   ${String(b.full).padStart(6)}`
  );
}
// An idling car uses about a litre an hour and a big V8 flat out uses
// about a hundred. Both ends have to land in the right decade or the
// model is not describing an engine.
const idles = burn.map((b) => b.idle);
console.log(
  `idle      ${check(
    Math.min(...idles) > 0.5 && Math.max(...idles) < 4,
    `idle burn spans ${Math.min(...idles)}-${Math.max(...idles)} L/h; a real engine idles on about one`
  )}  ${Math.min(...idles)}-${Math.max(...idles)} L/h across the five`
);
const v8 = burn.find((b) => b.id === "v8-57");
const small = burn.find((b) => b.id === "i4-16");
console.log(
  `flat out  ${check(
    v8.full > 90 && v8.full < 130 && small.full > 30 && small.full < 50,
    `flat out the V8 pulls ${v8.full} L/h and the 1.6 ${small.full} — one of those is not a real number`
  )}  V8 ${v8.full} L/h, 1.6 ${small.full} L/h`
);
// The ratio is the giveaway that this is displacement and revs rather
// than a thirst number typed in per engine. Same throttle, same rev
// fraction: the burn should track litres x rpm.
const wantRatio =
  (v8.litres * (700 + (6200 - 700) * 0.95)) / (small.litres * (850 + (8400 - 850) * 0.95));
console.log(
  `physical  ${check(
    Math.abs(v8.full / small.full - wantRatio) / wantRatio < 0.02,
    `V8/1.6 burn ratio is ${(v8.full / small.full).toFixed(2)}, but displacement x revs says ${wantRatio.toFixed(2)}`
  )}  ratio ${(v8.full / small.full).toFixed(2)} matches displacement x revs (${wantRatio.toFixed(2)})`
);
// Throttle has to matter, or the gauge falls at one rate forever.
console.log(
  `throttle  ${check(
    burn.every((b) => b.full > b.cruise * 2.5 && b.cruise > b.idle * 3),
    `a burn does not separate idle, cruise and full throttle: ${JSON.stringify(burn[0])}`
  )}  full throttle costs ${(v8.full / v8.cruise).toFixed(1)}x cruising on the V8`
);

// --- 2. The tank empties, and the engine stops -----------------------
const dry = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const clearRoad = () => {
    const away = e.track.wrap(e.player.s + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
  };
  e.setPaused(true);
  e.player.s = 2400;
  e.player.lat = 0;
  e.player.speed = 40;
  e.heading = 0;
  e.driftYaw = 0;
  e.fuel = 0.6;                      // a splash, so this does not take a minute
  e.outOfFuel = false;
  e.setTouchInput({ throttle: 1, brake: 0, steer: 0 });
  const start = e.fuel;
  let ranDry = false;
  let speedWhenDry = 0;
  for (let i = 0; i < 3000; i++) {
    e.player.s = 2400;
    e.player.lat = 0;
    e.heading = 0;
    clearRoad();
    e.update(1 / 60);
    if (!ranDry && e.outOfFuel) {
      ranDry = true;
      speedWhenDry = e.player.speed;
    }
  }
  return {
    start,
    left: e.fuel,
    ranDry,
    speedWhenDry: +(speedWhenDry * 3.6).toFixed(1),
    speedAfter: +(e.player.speed * 3.6).toFixed(1),
    throttleNow: e.throttle,
  };
});
console.log(
  `empties   ${check(dry.ranDry && dry.left === 0, `tank went ${dry.start} -> ${dry.left} L and dry=${dry.ranDry}`)}` +
    `  ${dry.start} L burned to ${dry.left} at full throttle`
);
console.log(
  `cut-out   ${check(
    dry.throttleNow === 0 && dry.speedAfter < dry.speedWhenDry,
    `dry at ${dry.speedWhenDry} km/h and still doing ${dry.speedAfter} with throttle ${dry.throttleNow}`
  )}  ran dry at ${dry.speedWhenDry} km/h, coasted down to ${dry.speedAfter}`
);

// --- 3. The forecourt is somewhere a car can be ----------------------
const forecourt = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const stations = window.__grnStations;
  const out = [];
  for (const st of stations) {
    // The road has to open wide enough to get off the through lanes.
    const openAt = e.track.halfWidthAt(st.s);
    const openBefore = e.track.halfWidthAt(st.s - 90);
    // And the station has to actually be in the scene, near the road.
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    e.track.pose(st.s, st.lat, p, tmp);
    let found = null;
    e.scene.traverse((o) => {
      if (o.name && o.name.startsWith("fuel-station")) {
        const d = Math.hypot(o.position.x - p.x, o.position.z - p.z);
        if (!found || d < found.d) found = { d, name: o.name };
      }
    });
    out.push({
      s: st.s,
      lat: st.lat,
      openAt: +openAt.toFixed(1),
      openBefore: +openBefore.toFixed(1),
      placedWithin: found ? +found.d.toFixed(1) : null,
    });
  }
  return out;
});
for (const f of forecourt) {
  console.log(
    `station   at ${f.s} m, apron ${f.lat} m out: road opens ${f.openBefore} -> ${f.openAt} m, ` +
      `structure ${f.placedWithin} m away`
  );
  check(f.openAt > f.openBefore + 5, `the road does not open at the ${f.s} m forecourt`);
  check(f.placedWithin !== null && f.placedWithin < 2, `no station stands at ${f.s} m`);
}
// Reachable means the drivable width gets you past the through lanes to
// where the pumps are. A forecourt you cannot drive onto is scenery.
const reach = forecourt.every((f) => f.openAt >= 14);
console.log(
  `reachable ${check(reach, `the widest a forecourt opens is ${Math.max(...forecourt.map((f) => f.openAt))} m`)}` +
    `  ${forecourt[0].openAt} m of drivable width at the pumps`
);
// And nothing was built on top of one.
//
// Measured in ROAD space, not world space. A first attempt compared
// axis-aligned world distances against half the apron's LONG side on
// both axes, which flags a tower two blocks inland as standing on the
// forecourt whenever the road happens to bend the right way. The apron
// is 22 m across the road and 40 m along it, and those are different
// numbers, so the test has to know which is which.
const clash = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  let blocks = null;
  e.scene.traverse((o) => { if (o.name === "cityBlocks") blocks = o; });
  if (!blocks) return { checked: 0, hits: [] };

  // A coarse table of the centreline, for projecting a world position
  // back onto the road.
  const N = 3000;
  const L = e.track.length;
  const pts = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    e.track.pointAt((i / N) * L, p);
    pts.push([p.x, p.z]);
  }
  const side = new THREE.Vector3();
  const roadSpace = (x, z) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const d = (pts[i][0] - x) ** 2 + (pts[i][1] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const s = (best / N) * L;
    e.track.pointAt(s, p);
    e.track.sideAt(s, side);
    return { s, lat: (x - p.x) * side.x + (z - p.z) * side.z };
  };

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const hits = [];
  for (let i = 0; i < blocks.count; i++) {
    blocks.getMatrixAt(i, m);
    m.decompose(pos, q, scale);
    const rs = scale.z / 2;   // frontage, along the road
    const rl = scale.x / 2;   // depth, across it
    const rp = roadSpace(pos.x, pos.z);
    for (const st of window.__grnStations) {
      const ds = Math.abs(e.track.deltaAhead(st.s, rp.s));
      if (ds < 20 + rs && Math.abs(rp.lat - st.lat) < 11 + rl) {
        hits.push({ s: Math.round(rp.s), lat: Math.round(rp.lat), w: Math.round(scale.z), d: Math.round(scale.x) });
      }
    }
  }
  return { checked: blocks.count, hits };
});
console.log(
  `clear     ${check(
    clash.hits.length === 0,
    `${clash.hits.length} buildings stand on a forecourt: ${JSON.stringify(clash.hits)}`
  )}  ${clash.checked} buildings placed, ${clash.hits.length} on a forecourt`
);

// --- 4. The pump ------------------------------------------------------
const pump = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const st = window.__grnStations[0];
  const clearRoad = () => {
    const away = e.track.wrap(st.s + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
  };
  const park = (lat, speedKmh) => {
    e.setPaused(true);
    e.player.s = st.s;
    e.player.lat = lat;
    e.player.speed = speedKmh / 3.6;
    e.heading = 0;
    e.driftYaw = 0;
    clearRoad();
    e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
  };
  const run = (frames) => {
    for (let i = 0; i < frames; i++) {
      e.player.s = st.s;
      e.player.lat = e.player.lat;
      clearRoad();
      e.update(1 / 60);
    }
  };

  // Make sure the save exists before reading a balance out of it: the
  // test cleared localStorage on the way in, and the garage is written
  // lazily. saveFuel() is the cheapest thing that creates it.
  e.saveFuel();
  const kd = () => JSON.parse(localStorage.getItem("gulf-road-nights-garage")).kd;

  // Driving past in the through lanes: no pump.
  e.fuel = 5;
  park(0, 90);
  run(10);
  const passing = e.pumpState;

  // On the apron but still moving too fast: prompt, no flow.
  e.fuel = 5;
  park(11, 60);
  run(10);
  const rolling = { pump: e.pumpState, fuel: e.fuel };

  // Stopped on the apron: it fills.
  e.fuel = 5;
  e.outOfFuel = false;
  park(11, 0);
  const kdBefore = kd();
  const fuelBefore = e.fuel;
  run(120); // two seconds
  const fillingFuel = e.fuel;
  // And keeps going to the brim, then stops.
  run(1200);
  const kdAfter = kd();
  return {
    passing,
    rolling,
    fuelBefore,
    afterTwoSeconds: +fillingFuel.toFixed(2),
    full: +e.fuel.toFixed(2),
    capacity: e.tune.tankLitres,
    kdBefore,
    kdAfter,
    stillFilling: e.pumpState?.filling ?? null,
  };
});
console.log(
  `passing   ${check(pump.passing === null, "the pumps engage from the through lanes at 90 km/h")}` +
    `  no pump at lane centre and speed`
);
// Not "the level is unchanged": a rolling car is still burning idle
// fuel, so the level falls a fraction of a millilitre while this runs
// and an equality check reports the pump as having filled it. What
// matters is that it did not RISE.
console.log(
  `rolling   ${check(
    pump.rolling.pump !== null && !pump.rolling.pump.filling && pump.rolling.fuel <= 5,
    pump.rolling.pump === null
      ? "no prompt on the apron at 60 km/h"
      : `the pump ran at 60 km/h: ${5} L -> ${pump.rolling.fuel} L, filling=${pump.rolling.pump.filling}`
  )}  prompt shown at 60 km/h on the apron, nothing pumped (${pump.rolling.fuel.toFixed(4)} L)`
);
const rate = (pump.afterTwoSeconds - pump.fuelBefore) / 2;
console.log(
  `filling   ${check(
    rate > 4 && rate < 12,
    `the pump runs at ${rate.toFixed(1)} L/s`
  )}  ${pump.fuelBefore} L -> ${pump.afterTwoSeconds} L in two seconds (${rate.toFixed(1)} L/s)`
);
console.log(
  `brim      ${check(
    Math.abs(pump.full - pump.capacity) < 0.05 && pump.stillFilling === false,
    `filled to ${pump.full} of a ${pump.capacity} L tank, still filling: ${pump.stillFilling}`
  )}  stopped at ${pump.full} / ${pump.capacity} L`
);
const spent = pump.kdBefore - pump.kdAfter;
const wantSpent = (pump.capacity - pump.fuelBefore) * 0.085;
console.log(
  `charged   ${check(
    Math.abs(spent - wantSpent) < 0.06,
    `filling ${(pump.capacity - pump.fuelBefore).toFixed(1)} L cost ${spent.toFixed(2)} KD; ` +
      `at 85 fils it should be ${wantSpent.toFixed(2)}`
  )}  ${(pump.capacity - pump.fuelBefore).toFixed(1)} L cost ${spent.toFixed(2)} KD at 85 fils/L`
);

// --- 5. The gauge -----------------------------------------------------
const gauge = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const read = () => {
    const track = document.querySelectorAll(".nos-meter");
    const fuelTrack = [...track].find((t) => t.querySelector(".fuel-fill"));
    if (!fuelTrack) return null;
    const fill = fuelTrack.querySelector(".fuel-fill");
    const label = fuelTrack.parentElement.querySelector("span:last-child");
    return {
      state: fuelTrack.dataset.state,
      width: fill.offsetWidth,
      inner: fuelTrack.clientWidth,
      label: label.textContent.trim(),
      bg: getComputedStyle(fill).backgroundImage,
    };
  };
  const at = async (litres, dryFlag) => {
    e.setPaused(true);
    e.player.s = 2400;
    e.player.lat = 0;
    e.player.speed = 0;
    e.fuel = litres;
    e.outOfFuel = dryFlag;
    for (const t of e.traffic) t.s = e.track.wrap(2400 + e.track.length / 2);
    e.update(1 / 60);
    await new Promise((r) => setTimeout(r, 60));
    return read();
  };
  const cap = e.tune.tankLitres;
  return {
    cap,
    full: await at(cap, false),
    half: await at(cap / 2, false),
    low: await at(cap * 0.15, false),
    dry: await at(0, true),
  };
});
if (!gauge.full) {
  check(false, "there is no fuel gauge in the HUD");
} else {
  console.log(
    `gauge     full ${gauge.full.width}/${gauge.full.inner}px "${gauge.full.label}" · ` +
      `half ${gauge.half.width}px · low ${gauge.low.state} · dry "${gauge.dry.label}"`
  );
  check(
    Math.abs(gauge.full.width - gauge.full.inner) <= 2,
    `a full tank draws ${gauge.full.width}px of a ${gauge.full.inner}px gauge`
  );
  check(
    Math.abs(gauge.half.width - gauge.full.inner / 2) <= 3,
    `half a tank draws ${gauge.half.width}px, not half of ${gauge.full.inner}`
  );
  check(gauge.full.state === "ok", `a full tank reads state "${gauge.full.state}"`);
  check(gauge.low.state === "low", `a sixth of a tank reads state "${gauge.low.state}", not "low"`);
  check(gauge.dry.state === "dry", `an empty tank reads state "${gauge.dry.state}"`);
  check(
    gauge.full.label.includes(`${Math.round(gauge.cap)} L`),
    `the gauge reads "${gauge.full.label}" and the tank holds ${gauge.cap} L`
  );
  check(gauge.dry.label === "DRY", `an empty tank reads "${gauge.dry.label}"`);
  check(
    new Set([gauge.full.bg, gauge.low.bg, gauge.dry.bg]).size === 3,
    "full, low and dry are painted the same colour"
  );
  console.log(
    `states    ${check(true, "")}  ok / low / dry are three different colours`
  );
}

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nfuel burns, runs out, and can be bought back.");
