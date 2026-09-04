// FULL RUN RACE — play the game end to end, as a player would:
// boot fresh, drive a complete lap of the Gulf Road under autopilot,
// hunt down the rival, flash them with the real F key, accept the
// challenge card in the real UI, survive the cinematic, win the battle,
// and collect the rewards.
//
// Two techniques make a real-time game testable at speed:
//   1. A VIRTUAL CLOCK replaces performance.now() before any page script
//      runs, advanced in lockstep with the simulation. Lap timing, the
//      3-second flash window and the cinematic all use that clock, so
//      they behave exactly as they would in real time — just faster.
//   2. The sim is stepped by hand at a fixed 1/60 s, so a lap is
//      deterministic instead of hostage to headless frame pacing.
// Input still goes through the real paths: analog autopilot through
// setTouchInput (the touch/gamepad API) and real keyboard events for F.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);

const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.log("PAGEERROR:", e.message); });
// The community hub is OPTIONAL and the menu already knows it: the
// status probe is a two-second fetch with `.catch(() => {})`, and a hub
// that does not answer "simply is not mentioned". Nothing is running on
// 8787 in a bare checkout, so the browser logs ERR_CONNECTION_REFUSED
// for a request the game deliberately expects to fail. Counting that as
// a runtime error failed the whole race test over a server the test
// never asked for. Only the hub's own origin is forgiven; every other
// console error still fails the run.
const HUB = /localhost:8787/;
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const loc = m.location?.();
  const line = `${m.text().slice(0, 120)}${loc?.url ? ` @ ${loc.url}` : ""}`;
  if (HUB.test(line)) return;
  errors.push(line);
});
const http404 = [];
page.on("response", (r) => { if (r.status() === 404) http404.push(new URL(r.url()).pathname); });

// --- 1. virtual clock, installed before the app boots ---
await page.addInitScript(() => {
  const real = performance.now.bind(performance);
  const start = real();
  window.__vclock = { t: 0, real: false };
  performance.now = () => (window.__vclock.real ? real() - start : window.__vclock.t);
});

await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear(); // a brand-new player
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
  // PIN THE CLOCK. The game ships with sky "kuwait" — the world runs on
  // the real time in Kuwait, and racing is gated to 00:00-05:50 — so a
  // test that flashes a rival at 11:35 in the morning gets the lamps
  // blinked at it and "Nobody races before midnight." Correct game,
  // useless test: it passed or failed by the hour it was run at, about
  // one day in four. "night" is the fixed hour the settings screen
  // offers for exactly this, and it maps to 00:30 — inside the window.
  localStorage.setItem("gulf-road-nights-settings", JSON.stringify({ sky: "night" }));
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// Say it out loud before driving 8.5 km on it. Every later step —
// flashing, the challenge card, the battle — is gated behind this one
// boolean, so if the pin above ever stops working the run should name
// the clock rather than report "three flashes did not issue a
// challenge" a hundred thousand simulated frames later.
// Read off the engine, not off __grnDebug: that object has 47 keys and
// `hour` is not one of them, so an earlier version of this line printed
// "00:00" for a clock reading 00:30 — a readout that agrees with the
// truth by accident is worse than none.
const clock = await page.evaluate(() => {
  const e = window.__grnEngine;
  return { hour: e.timeHours, open: e.racingOpen(), cycling: e.timeCycling, real: e.timeReal };
});
const hh = String(Math.floor(clock.hour)).padStart(2, "0");
const mm = String(Math.floor((clock.hour % 1) * 60)).padStart(2, "0");
console.log(`clock: ${hh}:${mm} ${clock.real ? "(live Kuwait)" : clock.cycling ? "(cycling)" : "(fixed)"}` +
  ` — racing ${clock.open ? "open" : "CLOSED"}  ` +
  check(clock.open, "the racing window is shut: nothing can be challenged") + " " +
  // Fixed means fixed. A cycling clock would walk the run towards 05:50
  // and close the window somewhere in the middle of it.
  check(!clock.cycling && !clock.real, "the clock is still moving — the run is not reproducible"));

// The autopilot: a lane-holding PD steer plus a curvature-aware speed
// target, installed page-side so the driving loop never round-trips.
await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);          // we drive the clock, not requestAnimationFrame
  window.__tel = {
    frames: 0, dist: 0, topSpeed: 0, laps: [], bumps: 0,
    minSp: 100, offTrack: 0, maxDrift: 0, sumSpeed: 0,
  };

  window.__drive = (frames, opts = {}) => {
    const tel = window.__tel;
    const dt = 1 / 60;
    for (let i = 0; i < frames; i++) {
      const p = e.player;
      // Look ahead for the corner rather than reacting to the one we are
      // already in: sample the track's heading change 70 m out.
      const a = e.track.tangentAt(p.s + 10, new e.v1.constructor());
      const b = e.track.tangentAt(p.s + 70, new e.v1.constructor());
      const cross = a.x * b.z - a.z * b.x;
      const kappa = Math.abs(Math.asin(Math.max(-1, Math.min(1, cross)))) / 60;
      // v = sqrt(a_lat / kappa), capped to something sane
      const grip = e.tune.gripAccel * 0.85;
      const vTarget = Math.max(14, Math.min(opts.vMax ?? 92, Math.sqrt(grip / Math.max(kappa, 1e-5))));

      const lane = opts.lane ?? 0;
      const latErr = p.lat - lane;
      const steer = Math.max(-1, Math.min(1, -(latErr * 0.11 + e.heading * 2.4)));
      const throttle = p.speed < vTarget ? 1 : 0;
      const brake = p.speed > vTarget * 1.06 ? Math.min(1, (p.speed / vTarget - 1) * 6) : 0;
      e.setTouchInput({ throttle, brake, steer });

      const before = p.s;
      e.update(dt);
      window.__vclock.t += dt * 1000; // the clock the engine reads

      // Telemetry
      const adv = e.track.deltaAhead(before, p.s);
      if (adv > 0) tel.dist += adv;
      tel.frames++;
      tel.sumSpeed += p.speed;
      tel.topSpeed = Math.max(tel.topSpeed, p.speed * 3.6);
      tel.maxDrift = Math.max(tel.maxDrift, Math.abs(e.driftYaw));
      if (e.inBattle) tel.minSp = Math.min(tel.minSp, p.sp);
      if (Math.abs(p.lat) > e.track.halfWidthAt(p.s) - 1.15) tel.offTrack++;
      if (opts.until && opts.until(e)) return { stopped: true, i };
    }
    return { stopped: false };
  };
});

// Count laps through the engine's own callback path
await page.evaluate(() => {
  const e = window.__grnEngine;
  const prev = e.events.onLap;
  e.events.onLap = (ms) => { window.__tel.laps.push(Math.round(ms)); prev?.(ms); };
  const prevBump = e.events.onBump;
  e.events.onBump = () => { window.__tel.bumps++; prevBump?.(); };
});

// ---------------------------------------------------------------- LAP
console.log("=== LAP 1 — a full circuit of the Gulf Road ===");
const lapStart = await page.evaluate(() => ({
  s: window.__grnEngine.player.s,
  len: window.__grnEngine.track.length,
}));
console.log(`track length ${lapStart.len.toFixed(0)} m, starting at s=${lapStart.s.toFixed(0)}`);

let lapDone = false;
for (let chunk = 0; chunk < 20 && !lapDone; chunk++) {
  const r = await page.evaluate(() =>
    window.__drive(1800, { until: (e) => window.__tel.laps.length > 0 })
  );
  const t = await page.evaluate(() => ({ ...window.__tel, s: window.__grnEngine.player.s }));
  console.log(`  ${(t.dist / 1000).toFixed(2)} km covered, ${(t.sumSpeed / t.frames * 3.6).toFixed(0)} km/h avg, top ${t.topSpeed.toFixed(0)}`);
  lapDone = r.stopped;
}
const lap = await page.evaluate(() => ({ ...window.__tel }));
const simMin = Math.floor(lap.laps[0] / 60000), simSec = ((lap.laps[0] % 60000) / 1000).toFixed(1);
console.log(`lap completed: ${simMin}:${simSec.padStart(4, "0")} (simulated)  distance ${(lap.dist / 1000).toFixed(2)} km`);
console.log(`  top speed ${lap.topSpeed.toFixed(0)} km/h, avg ${(lap.sumSpeed / lap.frames * 3.6).toFixed(0)} km/h`);
console.log(`  contacts ${lap.bumps}, frames off the drivable width ${lap.offTrack}`);
check(lap.laps.length >= 1, "no lap was ever recorded");
check(lap.dist > lapStart.len * 0.95, `only ${(lap.dist / 1000).toFixed(2)} km covered — the lap did not complete`);
check(lap.laps[0] > 60000 && lap.laps[0] < 400000, `lap time ${lap.laps[0]}ms is implausible`);
check(lap.topSpeed > 150, `top speed ${lap.topSpeed.toFixed(0)} km/h is too low for a full-throttle lap`);
check(lap.offTrack < lap.frames * 0.15, "the autopilot spent too long scraping the walls");

// ------------------------------------------------------------- CHALLENGE
console.log("\n=== CHALLENGE — hunt the rival down and flash them ===");
const rivalInfo = await page.evaluate(() => {
  const e = window.__grnEngine;
  return e.rival ? { name: e.rival.def.name, gap: e.track.deltaAhead(e.player.s, e.rival.s), state: e.rival.state } : null;
});
console.log(`rival: ${rivalInfo?.name ?? "NONE"} — ${rivalInfo ? Math.round(rivalInfo.gap) : "?"} m away (${rivalInfo?.state})`);
check(!!rivalInfo, "no rival on the road at all");

// Close to flashing range (60 m) — drive until the gap is inside it
for (let chunk = 0; chunk < 25; chunk++) {
  const r = await page.evaluate(() =>
    window.__drive(900, {
      until: (e) => {
        const g = e.track.deltaAhead(e.player.s, e.rival.s);
        return e.rival.state === "cruise" && g > 4 && g < 50;
      },
    })
  );
  if (r.stopped) break;
}
const gapNow = await page.evaluate(() => {
  const e = window.__grnEngine;
  return { gap: e.track.deltaAhead(e.player.s, e.rival.s), state: e.rival.state, speed: e.player.speed * 3.6 };
});
console.log(`closed to ${gapNow.gap.toFixed(0)} m at ${gapNow.speed.toFixed(0)} km/h  ` +
  check(gapNow.gap > 0 && gapNow.gap < 60, `gap ${gapNow.gap.toFixed(0)} m is outside flashing range`));

// Three real F presses inside the engine's 3-second window, with the
// sim stepping between them so the window is measured on the same clock
for (let i = 0; i < 3; i++) {
  await page.keyboard.press("f");
  await page.evaluate(() => window.__drive(12, {}));
}
await page.waitForFunction(() => !!window.__grnEngine.challengePending, null, { timeout: 8000 })
  .catch(() => {});
const pending = await page.evaluate(() => window.__grnEngine.challengePending);
console.log(`challenge card raised: ${pending}  ${check(pending === true, "three flashes did not issue a challenge")}`);

// Accept it through the real UI button
// Sixty seconds, not eight, and the result is CHECKED rather than
// swallowed.
//
// Both halves of that mattered. This click used to be
// `.catch(() => {})` on an eight-second budget, and on a box rendering
// 1.5 M triangles through a software rasteriser it silently missed:
// Playwright resolved the button, found it visible, enabled, stable and
// the top thing under its own centre, and then ran out of budget in the
// hit-target check. The test carried on, waited forty seconds for a
// challenge nobody had sent, and reported "the challenge never became a
// battle" — a failure two steps downstream of the actual event, with
// the real one thrown away. A click that does not happen has to say so.
const btn = page.locator("text=SEND CHALLENGE");
// Actionability first, and separately from the click.
//
// These are the properties a player needs — the button is on the screen,
// it is enabled, and nothing is lying over it — and they are cheap to
// assert. What is NOT cheap is Playwright's own hit-target check, which
// re-renders and re-measures: against three million triangles through a
// software rasteriser it exhausts a sixty-second budget on a button that
// is perfectly clickable.
const box = await btn.boundingBox().catch(() => null);
const usable = await btn
  .isVisible()
  .then(async (v) => v && (await btn.isEnabled()))
  .catch(() => false);
check(usable && !!box, "the SEND CHALLENGE button is not on the screen, or is disabled");
// The overlay check Playwright would have done, done once instead of in
// a loop: ask the document what is actually under that point.
const cx = box ? box.x + box.width / 2 : 0;
const cy = box ? box.y + box.height / 2 : 0;
const onTop = box
  ? await page.evaluate(([x, y]) => {
      // The label is "SEND CHALLENGE — تحداه", so the point may land on
      // the Arabic span inside the button. Walk up: what matters is that
      // the thing under the cursor belongs to the button, not that the
      // innermost node happens to carry the English half.
      let el = document.elementFromPoint(x, y);
      for (let i = 0; el && i < 4; i++, el = el.parentElement)
        if (/SEND CHALLENGE/i.test(el.textContent ?? "")) return true;
      return false;
    }, [cx, cy])
  : false;
check(onTop, "something is lying over the SEND CHALLENGE button");
// Then a real mouse click at real coordinates. page.click() re-verifies
// the hit target on every retry and timed out here on a button that was
// visible, enabled and on top — sixty seconds spent re-measuring a
// scene, not waiting for a button. mouse.click() sends the same
// browser-level move/down/up the player's hand does, and the
// verification above is ours.
if (box) await page.mouse.click(cx, cy);
// And then the thing that actually matters: did the challenge go out?
//
// NOT `challengePending`, which this used to ask. That flag was already
// true — the card being on the screen is what raised it — so the check
// passed whether the button was pressed or not, and a click that never
// landed was reported as "challenge went out". confirmChallenge() is
// what a press runs, and it queues the rival's 2.2 s answer; a timer in
// that list is proof the press reached the engine.
const sent = await page
  .waitForFunction(() => {
    const e = window.__grnEngine;
    return !!(e && (e.challengeTimers?.length > 0 || e.cine || e.inBattle));
  }, null, { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
console.log(`  press ${sent ? "landed" : "did NOT reach the engine"}`);
check(sent, "SEND CHALLENGE did not send a challenge");
console.log("waiting for the rival's answer");
// The rival's answer is a real 2.2 s setTimeout inside the engine, and
// timers in this headless browser run two to three and a half times slow
// — a 1500 ms timeout measures 3400-5100 ms here — so 2.2 s of game time
// is five to eight seconds of wall clock.
//
// This used to wait a fixed sixteen iterations, about 3.2 s, which raced
// that timer and lost often enough to fail roughly one run in three, on a
// change that had touched nothing but colours. Wait for the STATE rather
// than for a budget of wall clock; the small drive per poll only keeps
// the game moving, since a setTimeout does not need the sim to advance.
const answerT0 = Date.now();
const answered = await page
  .waitForFunction(
    () => {
      window.__drive(8, {});
      const e = window.__grnEngine;
      return !!e.cine || e.inBattle;
    },
    null,
    { timeout: 40000, polling: 200 }
  )
  .then(() => true)
  .catch(() => false);
console.log(
  `  rival answered after ${((Date.now() - answerT0) / 1000).toFixed(1)}s of wall clock` +
    (answered ? "" : " — TIMED OUT at 40s")
);
const battleState = await page.evaluate(() => {
  const e = window.__grnEngine;
  return { cine: !!e.cine, inBattle: e.inBattle, sp: e.player.sp, rivalSp: e.rival?.sp };
});
console.log(`after acceptance: cinematic=${battleState.cine} inBattle=${battleState.inBattle}`);

// The pre-race film runs on the virtual clock too
if (battleState.cine) {
  for (let i = 0; i < 40 && (await page.evaluate(() => !!window.__grnEngine.cine)); i++) {
    await page.evaluate(() => window.__drive(120, {}));
  }
}
const inBattle = await page.evaluate(() => window.__grnEngine.inBattle);
console.log(`battle started: ${inBattle}  ${check(inBattle === true, "the challenge never became a battle")}`);

// ---------------------------------------------------------------- BATTLE
// Win or lose is not the assertion — the autopilot is a lane-holder, not
// a racing driver, and the rival rubber-bands. What must hold is that the
// battle RESOLVES and the result is banked.
console.log("\n=== BATTLE — run it out until someone's SP is gone ===");
let battleOver = false, result = null;
for (let chunk = 0; chunk < 40 && !battleOver; chunk++) {
  const r = await page.evaluate(() => window.__drive(900, { until: (e) => !e.inBattle }));
  const st = await page.evaluate(() => {
    const e = window.__grnEngine;
    return { you: Math.round(e.player.sp), them: Math.round(e.rival?.sp ?? 0), inBattle: e.inBattle,
             gap: e.rival ? Math.round(e.track.deltaAhead(e.player.s, e.rival.s)) : 0 };
  });
  if (chunk % 3 === 0 || r.stopped)
    console.log(`  SP you ${st.you} — them ${st.them}   gap ${st.gap > 0 ? `${st.gap} m behind` : `${-st.gap} m ahead`}`);
  battleOver = r.stopped;
}
result = await page.evaluate(() => window.__grnResult ?? null);
const after = await page.evaluate(() => {
  const e = window.__grnEngine;
  const garage = JSON.parse(localStorage.getItem("gulf-road-nights-garage") ?? "{}");
  const career = JSON.parse(localStorage.getItem("gulf-road-nights-career") ?? "{}");
  return { inBattle: e.inBattle, kd: garage.kd, career };
});
console.log(`battle finished: inBattle=${after.inBattle}`);
console.log(`rewards — KD ${after.kd}, career ${JSON.stringify(after.career)}`);
check(after.inBattle === false, "the battle never resolved");
check((after.career.xp ?? 0) > 0 || (after.career.wins ?? 0) > 0 || (after.career.beaten?.length ?? 0) > 0,
  `the finished battle paid out nothing: ${JSON.stringify(after.career)}`);

// ------------------------------------------------------------ RENDERING
// One real rendered frame at the end: the sim ran headless-stepped, so
// prove the renderer still draws the scene it has been simulating.
const shot = await page.evaluate(() => {
  const e = window.__grnEngine;
  // renderer.info resets at the START of every render() — after
  // composer.render() it describes only the last fullscreen post pass.
  // Render the scene itself to meter what the world actually costs.
  e.renderer.render(e.scene ?? e.world.scene, e.camera);
  const px = e.renderer.getContext();
  return { tris: e.renderer.info.render.triangles, calls: e.renderer.info.render.calls,
           ctxLost: px.isContextLost() };
});
console.log(`\nrenderer: ${shot.tris.toLocaleString()} triangles in ${shot.calls} draw calls, context lost=${shot.ctxLost}  ` +
  check(!shot.ctxLost, "the WebGL context was lost during the run") + " " +
  check(shot.tris > 100000, `only ${shot.tris} triangles drawn — the scene looks empty`));

if (http404.length) console.log(`404s: ${[...new Set(http404)].join(", ")}`);
console.log(`\npage errors: ${errors.length}  ${check(errors.length === 0, `${errors.length} runtime errors: ${errors.slice(0, 3).join(" | ")}`)}`);
console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\n=== FULL RACE COMPLETED CLEAN ===");
await browser.close();
process.exit(fail.length ? 1 : 0);
