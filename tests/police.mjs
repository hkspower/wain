// Patrol cars: on the road, wearing the livery, with a bar that alternates.
//
//   npm run dev
//   npm run test:police
//
// What this does NOT test, because it is deliberately not there: any
// pursuit. A patrol car here is a civilian with a livery and a bar. It
// holds a lane and takes no interest in the player, and a check that
// pretended otherwise would be describing a game this is not.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const C = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH."); process.exit(2); }
const b = await chromium.launch({ executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"], headless: true });
const page = await b.newPage({ viewport: { width: 1000, height: 700 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3"); });
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// --- 1. They are on the road, and not all of them are on a call -------
const road = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  const pol = e.traffic.filter((t) => t.mesh.userData.police);
  return {
    total: e.traffic.length,
    count: pol.length,
    onCall: pol.filter((t) => t.onCall).length,
    phases: pol.map((t) => +t.mesh.userData.police.phase.toFixed(3)),
  };
});
console.log(`on the road   ${road.count} patrol cars of ${road.total}, ${road.onCall} with the bar running  ` +
  check(road.count >= 3 && road.count <= road.total / 6,
    `${road.count} patrol cars out of ${road.total} — a road is not a police convoy, and one is not a presence`) + " " +
  check(road.onCall > 0 && road.onCall < road.count,
    `${road.onCall} of ${road.count} are on a call — some should be running and some should be driving somewhere`));
// Distinct beats. Every patrol car is the same white, so anything the
// BUILDER derives puts them all in lockstep; the engine spaces them.
const distinct = new Set(road.phases).size;
console.log(`beats         ${road.phases.join(", ")}  ` +
  check(distinct === road.count,
    `${distinct} distinct beats over ${road.count} cars — the bars are in lockstep`));

// --- 2. What one is wearing -------------------------------------------
const built = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const g = window.__grnBuildCar({ body: 0xeef1f4, livery: "police", simple: true, lengthM: 4.7 });
  g.updateMatrixWorld(true);
  let band = 0, lamps = 0, housing = 0;
  let roof = null;
  g.traverse((o) => {
    if (o.userData?.decal === "police-band") band++;
    if (o.material?.name === "police-lamp") lamps++;
    if (o.material?.name === "police-bar") housing++;
    if (o.userData?.shell === "roof") roof = o;
  });
  roof.geometry.computeBoundingBox();
  const rb = roof.geometry.boundingBox;
  const bar = g.userData.police.bar;
  return {
    band, lamps, housing,
    barY: +bar.position.y.toFixed(3), barZ: +bar.position.z.toFixed(3),
    roofTop: +rb.max.y.toFixed(3), roofFront: +rb.max.z.toFixed(3), roofBack: +rb.min.z.toFixed(3),
  };
});
console.log(`livery        ${built.band} band ribbons, ${built.lamps} lamps, ${built.housing} housing  ` +
  check(built.band === 2 && built.lamps === 2 && built.housing === 1,
    `a patrol car came out with ${built.band} bands, ${built.lamps} lamps and ${built.housing} housings`));
// ON THE ROOF. The first version of this took its z from STYLE_DIMS.roof
// — the profile's control points, not the panel's edges — and put the
// bar on the wiper cowl, 0.65 m forward of the roof and 0.46 m below it.
console.log(`the bar       y ${built.barY} against a roof top of ${built.roofTop}, ` +
  `z ${built.barZ} in a roof running ${built.roofBack}..${built.roofFront}  ` +
  check(built.barY > built.roofTop - 0.12,
    `the bar sits at y ${built.barY} and the roof is at ${built.roofTop} — it is not on the roof`) + " " +
  check(built.barZ > built.roofBack && built.barZ < built.roofFront + 0.02,
    `the bar sits at z ${built.barZ}, outside the roof's own ${built.roofBack}..${built.roofFront}`));

// --- 3. The beat itself ------------------------------------------------
const beat = await page.evaluate(() => {
  const { POLICE, policeLamps } = window.__grnPolice;
  const N = 400, T = 0.94;
  let red = 0, blue = 0, both = 0, neither = 0;
  for (let i = 0; i < N; i++) {
    const l = policeLamps((i / N) * T);
    const r = l.red > POLICE.lampOff, u = l.blue > POLICE.lampOff;
    if (r) red++;
    if (u) blue++;
    if (r && u) both++;
    if (!r && !u) neither++;
  }
  return { red: red / N, blue: blue / N, both, neither: neither / N, on: POLICE.lampOn, off: POLICE.lampOff };
});
console.log(`the beat      red lit ${(beat.red * 100).toFixed(0)}% of a cycle, blue ${(beat.blue * 100).toFixed(0)}%, ` +
  `dark ${(beat.neither * 100).toFixed(0)}%, both at once ${beat.both}  ` +
  check(beat.both === 0, `both sides are lit together on ${beat.both} samples — that is a lamp, not a bar`) + " " +
  check(beat.red > 0.1 && beat.blue > 0.1,
    `red is lit ${(beat.red * 100).toFixed(0)}% and blue ${(beat.blue * 100).toFixed(0)}% of a cycle — one side is not working`) + " " +
  check(Math.abs(beat.red - beat.blue) < 0.03,
    `red is lit ${(beat.red * 100).toFixed(0)}% and blue ${(beat.blue * 100).toFixed(0)}% — the two sides take unequal turns`) + " " +
  check(beat.neither > 0.3,
    `the bar is dark only ${(beat.neither * 100).toFixed(0)}% of a cycle — it is a pair of lamps fading, not a bar flashing`));

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\npatrol cars are on the road, liveried, and their bars alternate");
await b.close();
process.exit(fail.length ? 1 : 0);
