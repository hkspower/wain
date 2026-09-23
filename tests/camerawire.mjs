// The camera laws are wired into the engine, and the engine behaves.
//
//   npm run dev
//   npm run test:camerawire
//
// tests/camera.mjs proves the LAWS without a browser. This asks the one
// thing only a running engine can answer: whether the engine actually
// drives its camera through them. Each check below was first taken as a
// golden number on the engine BEFORE the change, so the thresholds are
// set against what the game really did rather than against a model:
//
//   bumper -> chase    lens 77.2 deg on the frame after the cut (chase 52)
//   100 km/h trailing  11.02 / 11.49 / 11.76 m at 30 / 60 / 144 Hz
//   film hand-off      camera moved 3.54 m in the frame the car moved 0.30
//
// The film runs on WALL time (performance.now()), not on update(dt), so
// a check that just calls update() a few times may never reach the end
// of it — or may, depending on how long each frame takes on the box. Film
// time is driven explicitly here by moving `cine.start`, and the test
// fails loudly if it never sees the film end.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const C = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH."); process.exit(2); }
const b = await chromium.launch({ executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"] });
// Headless Chromium forces prefers-reduced-motion, which skips the film.
const page = await b.newPage({ viewport: { width: 900, height: 520 }, reducedMotion: "no-preference" });
page.setDefaultTimeout(240000);
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.log("PAGEERROR:", e.message); });
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3"); });
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
await page.waitForTimeout(1500);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const r = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.skipCinematic?.();
  const V3 = e.camera.position.constructor;
  const out = {};
  const behind = () => {
    const p = e.player, T = new V3(), car = new V3(), up = new V3();
    e.track.tangentAt(p.s, T);
    e.track.pose(p.s, p.lat, car, up);
    return -e.camera.position.clone().sub(car).dot(T);
  };
  // 1. The session's lens is the chase's, not a stale 62 — read BEFORE any
  //    setView, which would be a cut and measure that instead. The game
  //    has been running since START ENGINE; with the old initialiser this
  //    read 60.5 at this point.
  out.chaseLens = e.fovCurrent;
  out.sessionView = e.view;
  e.setView("chase");
  e.player.speed = 0; e.setTouchInput({ throttle: 0 });
  e.update(1 / 60);
  // 2. A view change cuts the lens with the position.
  e.setView("bumper");
  for (let i = 0; i < 30; i++) { e.player.speed = 0; e.update(1 / 60); }
  out.bumperLens = e.fovCurrent;
  e.setView("chase");
  e.player.speed = 0; e.update(1 / 60);
  out.lensAfterCut = e.fovCurrent;
  // 3. The chase trails the same at every frame rate.
  const V = 27.78;
  out.trail = {};
  for (const hz of [30, 60, 144]) {
    e.setView("chase");
    const s0 = e.player.s;
    for (let i = 0; i < hz * 2; i++) { e.player.speed = V; e.update(1 / hz); }
    out.trail[hz] = behind();
    e.player.s = s0;
  }
  // 4. The film hands the camera over without a jump.
  out.handoff = null;
  if (e.rival) {
    e.setView("chase");
    e.player.speed = 20;
    for (let i = 0; i < 30; i++) e.update(1 / 60);
    e.beginBattleCinematic(e.rival);
    let filmT = e.cineLength - 0.4;
    const carAt = () => { const c = new V3(), u = new V3(); e.track.pose(e.player.s, e.player.lat, c, u); return c; };
    let last = null, lastCar = null, sawEnd = false, worst = 0, worstCar = 0;
    const steps = [];
    for (let i = 0; i < 120; i++) {
      if (e.cine) e.cine.start = performance.now() - filmT * 1000;
      const wasCine = !!e.cine;
      e.update(1 / 60);
      const now = e.camera.position.clone(), car = carAt();
      if (last) {
        const cs = now.distanceTo(last), ks = car.distanceTo(lastCar);
        // The camera's step against the car's step, around the flag.
        if (sawEnd || (wasCine && !e.cine)) {
          steps.push(+(cs - ks).toFixed(3));
          worst = Math.max(worst, Math.abs(cs - ks));
          worstCar = Math.max(worstCar, ks);
        }
      }
      if (wasCine && !e.cine) sawEnd = true;
      last = now; lastCar = car;
      filmT += 1 / 60;
      if (sawEnd && steps.length >= 45) break;
    }
    out.handoff = { sawEnd, worst: +worst.toFixed(3), worstCar: +worstCar.toFixed(3), first: steps.slice(0, 6), lens: e.fovCurrent };
    // 5. A STALLED film — the tab hidden mid-film — must cut, not sweep in
    //    from a shot that was never settled. Draw the film at 8 s (the
    //    flank shot), then let the wall clock run past the end without
    //    drawing anything in between, the way a hidden tab does.
    if (e.rival) {
      e.inBattle = false; e.duel = null;
      e.player.speed = 20;
      e.beginBattleCinematic(e.rival);
      e.cine.start = performance.now() - 8000;
      e.update(1 / 60);
      if (e.cine) e.cine.start = performance.now() - (e.cineLength + 1) * 1000;
      const trail = [];
      for (let i = 0; i < 30; i++) { e.player.speed = 20; e.update(1 / 60); trail.push(behind()); }
      out.stalled = { ended: !e.cine, drift: +(Math.max(...trail) - Math.min(...trail)).toFixed(3), first: +trail[0].toFixed(2) };
    }
  }
  return out;
});

console.log(`lens       session ${r.chaseLens.toFixed(2)} deg; bumper ${r.bumperLens.toFixed(1)} -> chase ${r.lensAfterCut.toFixed(2)} on the frame after the cut (was 75.9)`);
check(r.sessionView !== "chase" || Math.abs(r.chaseLens - 52) < 1.5, `the session opened at ${r.chaseLens.toFixed(1)} deg in the chase view — the 62-degree start lens is back`);
check(Math.abs(r.lensAfterCut - 52) < 1, `the frame after bumper -> chase is at ${r.lensAfterCut.toFixed(1)} deg: the cut moved the camera and eased the lens`);
const t = r.trail;
const spread = Math.max(t[30], t[60], t[144]) - Math.min(t[30], t[60], t[144]);
console.log(`trailing   100 km/h after 2 s: ${t[30].toFixed(3)} / ${t[60].toFixed(3)} / ${t[144].toFixed(3)} m at 30/60/144 Hz (was 11.02 / 11.49 / 11.76)`);
check(spread < 0.02, `the chase trails ${spread.toFixed(3)} m differently at 30 and 144 Hz`);
check(Math.abs(t[60] - 11.49) < 0.15, `the 60 Hz framing moved: ${t[60].toFixed(2)} m against 11.49 before`);
if (!r.handoff) {
  fail.push("there was no rival on the road to start a film against");
} else {
  const h = r.handoff;
  console.log(`hand-off   film end seen: ${h.sawEnd}; worst camera-vs-car step across the flag ${h.worst} m (car moving ${h.worstCar} m/frame; was a 3.54 m jump); lens ${h.lens.toFixed(1)}`);
  check(h.sawEnd, "the film never ended inside the driven window — the check measured nothing");
  check(h.worst < 0.15, `the camera stepped ${h.worst} m more or less than the car in one frame at the flag`);
}
if (r.stalled) {
  console.log(`stalled    film left while hidden: ended ${r.stalled.ended}; camera held ${r.stalled.first} m back, moved ${r.stalled.drift} m over the next half-second (a sweep would move metres)`);
  check(r.stalled.ended, "the stalled film never ended");
  check(r.stalled.drift < 0.25, `after a stalled film the camera swept ${r.stalled.drift} m — it handed over from a shot that was never settled`);
}
check(errors.length === 0, `page errors: ${errors.join(" | ")}`);
console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe engine drives its camera through the laws, and nothing jumps");
await b.close();
process.exit(fail.length ? 1 : 0);
