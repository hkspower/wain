// Patrol cars: on the road, wearing the livery, with a bar that alternates.
//
//   npm run dev
//   npm run test:police
//
// What this does NOT test: the pursuit. It used to say "because it is
// deliberately not there" — a patrol car held a lane and took no
// interest in the player, and a check that pretended otherwise would
// have been describing a game this was not. There is one now: race past
// a patrol car and it comes after you until you lose it.
//
// It is still not tested HERE, and that is the division of labour this
// repo already uses for policeLamps. The chase is a pure law in
// src/game/police.ts and npm run test:chase drives it through every
// situation that matters without a browser at all; what is left for
// this file is the thing that genuinely needs one — a patrol car on the
// road, wearing the livery, with a bar on the roof that alternates.
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

// --- 1b. The rest of the road ------------------------------------------
// Civilians used to be the street saloon, every one of them. The road
// this game is set on is mostly SUVs, so a share of the traffic wears
// that silhouette now — enough to be met every few cars, not so many
// that the saloon stops being the default — and none of them are patrol
// cars, which stay on the saloon shell their livery was drawn for.
const mix = await page.evaluate(() => {
  const e = window.__grnEngine;
  const by = {};
  for (const t of e.traffic) {
    const s = t.mesh.userData.style ?? "?";
    by[s] = (by[s] ?? 0) + 1;
  }
  return {
    by,
    suvPolice: e.traffic.filter((t) => t.mesh.userData.police && t.mesh.userData.style === "suv").length,
  };
});
const suvs = mix.by.suv ?? 0, sedans = mix.by.sedan ?? 0;
console.log(`the mix       ${Object.entries(mix.by).map(([k, v]) => `${v} ${k}`).join(", ")}  ` +
  check(suvs >= road.total / 6 && suvs <= road.total / 3,
    `${suvs} SUVs of ${road.total} — the road should carry a real share of them, and the saloon should still be the default`) + " " +
  check(sedans > suvs, `${sedans} saloons to ${suvs} SUVs — the saloon is no longer the road's default`) + " " +
  check(mix.suvPolice === 0, `${mix.suvPolice} patrol cars are on the SUV shell, whose flank the livery was never fitted to`));

// --- 2. What one is wearing -------------------------------------------
const built = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const g = window.__grnBuildCar({ body: 0xeef1f4, livery: "police", simple: true, lengthM: 4.7 });
  g.updateMatrixWorld(true);
  let band = 0, lamps = 0, housing = 0;
  const barParts = [];
  let roof = null;
  g.traverse((o) => {
    if (o.userData?.decal === "police-band") band++;
    if (o.material?.name === "police-lamp") lamps++;
    if (o.material?.name === "police-bar") housing++;
    if (o.userData?.barPart) barParts.push(o.userData.barPart);
    if (o.userData?.shell === "roof") roof = o;
  });
  roof.geometry.computeBoundingBox();
  const rb = roof.geometry.boundingBox;
  const bar = g.userData.police.bar;
  return {
    band, lamps, housing, barParts: barParts.sort(),
    barY: +bar.position.y.toFixed(3), barZ: +bar.position.z.toFixed(3),
    roofTop: +rb.max.y.toFixed(3), roofFront: +rb.max.z.toFixed(3), roofBack: +rb.min.z.toFixed(3),
  };
});
console.log(`livery        ${built.band} wrap ribbons, ${built.lamps} lens banks, ${built.housing} housing+feet  ` +
  check(built.band === 2 && built.lamps === 2 && built.housing === 3,
    `a patrol car came out with ${built.band} wraps, ${built.lamps} lens banks and ${built.housing} housing pieces`));
// Every piece the Blender bar can replace has to be tagged, or the swap
// silently leaves a stand-in in a car wearing an authored bar.
console.log(`bar parts     ${built.barParts.join(", ")}  ` +
  check(built.barParts.join() === "bar,lampl,lampr",
    `the bar offers ${built.barParts.join()} to the authored swap, not bar,lampl,lampr`));
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
  let left = 0, right = 0, both = 0, neither = 0;
  for (let i = 0; i < N; i++) {
    const l = policeLamps((i / N) * T);
    const a = l.left > POLICE.lampOff, b = l.right > POLICE.lampOff;
    if (a) left++;
    if (b) right++;
    if (a && b) both++;
    if (!a && !b) neither++;
  }
  return { red: left / N, blue: right / N, both, neither: neither / N, on: POLICE.lampOn, off: POLICE.lampOff };
});
console.log(`the beat      left lit ${(beat.red * 100).toFixed(0)}% of a cycle, right ${(beat.blue * 100).toFixed(0)}%, ` +
  `dark ${(beat.neither * 100).toFixed(0)}%, both at once ${beat.both}  ` +
  check(beat.both === 0, `both sides are lit together on ${beat.both} samples — that is a lamp, not a bar`) + " " +
  check(beat.red > 0.1 && beat.blue > 0.1,
    `the left bank is lit ${(beat.red * 100).toFixed(0)}% and the right ${(beat.blue * 100).toFixed(0)}% of a cycle — one side is not working`) + " " +
  check(Math.abs(beat.red - beat.blue) < 0.03,
    `the banks are lit ${(beat.red * 100).toFixed(0)}% and ${(beat.blue * 100).toFixed(0)}% — the two sides take unequal turns`) + " " +
  check(beat.neither > 0.3,
    `the bar is dark only ${(beat.neither * 100).toFixed(0)}% of a cycle — it is a pair of lamps fading, not a bar flashing`));

// --- The pursuit, wired up -------------------------------------------
//
// npm run test:chase drives the LAW without a browser and does it far
// more thoroughly than this can. What only a running engine can answer
// is whether the law is connected to anything: whether a patrol car
// actually takes up the chase, whether it is only patrol cars that do,
// and whether one that gives up goes back to being traffic.
//
// That last pair is not padding. The first wiring of this gated on
// `t.onCall !== undefined` — and `onCall` is `false`, not absent, on
// every civilian, because `police && ...` on a car that is not police
// is false. Every one of the forty-six would have joined in. The pure
// test cannot see a bug like that, because the bug is not in the law.
const chase = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.skipCinematic?.();
  const pol = e.traffic.filter((t) => t.mesh.userData.police);
  const civ = e.traffic.filter((t) => !t.mesh.userData.police);
  const t = pol[0];
  const before = { chase: t.chase, speed: t.speed, lat: t.lat };
  // Race past it: just ahead, in its lane, at a speed nobody would
  // mistake for traffic.
  e.player.s = e.track.wrap(t.s + 14);
  e.player.lat = t.lat;
  for (let i = 0; i < 120; i++) {
    e.player.speed = 50;
    e.player.s = e.track.wrap(e.player.s + 50 / 60);
    e.update(1 / 60);
  }
  const on = { chase: t.chase, speed: t.speed, lat: t.lat, onCall: t.onCall };
  const civChasing = civ.filter((c) => c.chase > 0).length;
  // Then vanish, and hold long enough for the patience to run out and
  // the car to come back down off it.
  e.player.s = e.track.wrap(t.s + 900);
  for (let i = 0; i < 60 * 26; i++) {
    e.player.speed = 50;
    e.update(1 / 60);
  }
  return {
    before, on, civChasing,
    off: { chase: t.chase, speed: t.speed, lat: t.lat, onCall: t.onCall },
    homeLat: t.homeLat, homeSpeed: t.homeSpeed, homeOnCall: t.homeOnCall,
  };
});
console.log(`pursuit       idle ${chase.before.speed.toFixed(1)} m/s in lane ${chase.before.lat} ` +
  `-> chasing ${chase.on.speed.toFixed(1)} m/s at lat ${chase.on.lat.toFixed(2)} ` +
  `-> gave up at ${chase.off.speed.toFixed(1)} m/s back in lane ${chase.off.lat.toFixed(2)}`);
console.log(`  ${check(chase.on.chase > 0, "racing past a patrol car did not start a chase")}  it takes up the chase`);
console.log(`  ${check(chase.on.speed > chase.before.speed + 8,
  `it only reached ${chase.on.speed.toFixed(1)} m/s from ${chase.before.speed.toFixed(1)} — it is not actually coming`)}  and gets after it`);
console.log(`  ${check(chase.civChasing === 0,
  `${chase.civChasing} civilian cars joined the pursuit — the gate is letting the whole road chase the player`)}  and only patrol cars do`);
console.log(`  ${check(chase.off.chase === 0, "it never gave up")}  it lets go once you are gone`);
console.log(`  ${check(Math.abs(chase.off.lat - chase.homeLat) < 0.1,
  `it gave up in lane ${chase.off.lat.toFixed(2)} instead of going back to ${chase.homeLat}`)}  goes back to its lane`);
console.log(`  ${check(chase.off.speed < chase.on.speed - 8,
  `it broke off at ${chase.off.speed.toFixed(1)} m/s having chased at ${chase.on.speed.toFixed(1)} — that is a car still racing`)}  and slows down again`);
console.log(`  ${check(chase.off.onCall === chase.homeOnCall,
  `its bar is ${chase.off.onCall} after the chase and was ${chase.homeOnCall} before it`)}  and its bar goes back to what it was`);

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\npatrol cars are on the road, liveried, their bars alternate, and they chase");
await b.close();
process.exit(fail.length ? 1 : 0);
