// The racing window, and the world outside it.
//
//   npm run dev
//   node tests/night.mjs
//
// Racing on the corniche happens between midnight and 05:50. The world
// is open the rest of the time — the car drives, the petrol station
// sells petrol, the traffic keeps moving — you just cannot start a race.
//
// A rule like this is worth exactly as much as its enforcement, and it
// has two failure modes that look identical from the outside: a window
// that never closes, and a window that closes on things it should not.
// So both are checked:
//
//   closed    a flash outside the hours starts nothing
//   open      and inside them it does
//   running   the clock actually moves, and moves at the night rate
//             while the window is open
//   mid-race  a race already under way survives the window closing,
//             because taking a win away two corners from the end is a
//             rule enforcing itself against the point of having it
//   rolling   and the car still drives with the window shut
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
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
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
await page.waitForTimeout(3000);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// --- 1. The window opens and closes at the stated hours --------------
const gate = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  const at = (h) => {
    e.timeHours = h;
    return e.racingOpen();
  };
  return {
    beforeMidnight: at(23.5),
    justOpen: at(0.02),
    middle: at(3),
    justBefore: at(5.8),
    justAfter: at(5.9),
    morning: at(9),
    open: window.__grnEngine.constructor.RACE_OPEN_H,
    close: window.__grnEngine.constructor.RACE_CLOSE_H,
  };
});
console.log(
  `window    ${check(
    !gate.beforeMidnight && gate.justOpen && gate.middle && gate.justBefore &&
      !gate.justAfter && !gate.morning,
    `the window is ${JSON.stringify(gate)} — that is not midnight to 05:50`
  )}  23:30 shut, 00:01 open, 03:00 open, 05:48 open, 05:54 shut, 09:00 shut`
);
console.log(
  `hours     ${check(
    gate.open === 0 && Math.abs(gate.close - (5 + 50 / 60)) < 1e-9,
    `the window is declared as ${gate.open} to ${gate.close}`
  )}  opens at ${gate.open}:00, closes at 05:${Math.round((gate.close % 1) * 60)}`
);

// --- 2. A flash outside the hours starts nothing ---------------------
// The whole point: the world is open, the race is not.
const flash = (hour) =>
  page.evaluate((h) => {
    const e = window.__grnEngine;
    e.setPaused(true);
    e.timeHours = h;
    e.world.setTimeOfDay(h);
    e.applyDaylight();
    e.inBattle = false;
    e.challengePending = false;
    e.cine = null;
    e.locked = false;
    e.flashCount = 0;
    e.flashWindowUntil = 0;
    // Put the rival where a flash is legal: just ahead, cruising.
    const r = e.rival;
    if (r) {
      r.state = "cruise";
      r.s = e.track.wrap(e.player.s + 30);
    }
    let msg = "";
    const realMsg = e.events.onMessage;
    e.events.onMessage = (m) => { msg = m; };
    for (let i = 0; i < 4; i++) e.tryFlash();
    e.events.onMessage = realMsg;
    return { challengePending: !!e.challengePending, inBattle: !!e.inBattle, msg };
  }, hour);

const shut = await flash(7.5);
console.log(
  `closed    ${check(
    !shut.challengePending && !shut.inBattle,
    `flashing at 07:30 started something: pending=${shut.challengePending} battle=${shut.inBattle}`
  )}  three flashes at 07:30 start nothing — "${shut.msg}"`
);
console.log(
  `told      ${check(
    /night|midnight/i.test(shut.msg),
    `the game said "${shut.msg}", which does not explain why nothing happened`
  )}  and the player is told why`
);

const openNow = await flash(2.5);
console.log(
  `open      ${check(
    openNow.challengePending || openNow.inBattle,
    `flashing at 02:30, inside the window, started nothing either — the gate is stuck shut`
  )}  three flashes at 02:30 issue a challenge`
);

// --- 3. The clock runs, and runs slower while the window is open -----
const clock = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.challengePending = false;
  e.inBattle = false;
  const run = (from, seconds) => {
    e.timeHours = from;
    const t0 = e.timeHours;
    for (let i = 0; i < seconds * 60; i++) e.update(1 / 60);
    return e.timeHours - t0;
  };
  const night = run(2, 10);
  const day = run(9, 10);
  return { night: +night.toFixed(5), day: +day.toFixed(5), cycling: e.timeCycling };
});
console.log(
  `clock     ${check(
    clock.cycling && clock.night > 0,
    clock.cycling ? "the clock does not advance" : "the clock is not running at all"
  )}  ten seconds of play moves it ${(clock.night * 60).toFixed(1)} min inside the window`
);
// The window is five hours fifty; at the full-day rate that is under
// four minutes of play, which is not a night.
console.log(
  `pace      ${check(
    clock.night > 0 && clock.night < clock.day * 0.5,
    `the clock runs at ${(clock.night * 60).toFixed(2)} min inside the window and ` +
      `${(clock.day * 60).toFixed(2)} outside it — the night is not being given its own pace`
  )}  ${(clock.night * 60).toFixed(1)} min per ten seconds at night against ` +
    `${(clock.day * 60).toFixed(1)} after dawn`
);

// --- 4. A race already running survives the close --------------------
const midRace = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  // A REAL battle, started through the engine's own entry point. Setting
  // inBattle by hand makes a state the battle logic has never seen — no
  // rival in a battle state, no scoreboard — and it tidies it away on
  // the next frame, which reads exactly like "the window ended my race"
  // and is nothing of the kind.
  e.timeHours = 2;
  e.challengePending = false;
  e.locked = false;
  e.cine = null;
  if (e.rival) {
    e.rival.state = "cruise";
    e.rival.s = e.track.wrap(e.player.s + 30);
  }
  e.startBattle(e.rival);
  const startedIn = !!e.inBattle;
  // Close enough to the edge that the run carries the clock over it:
  // inside the window it moves about a minute and a half of game time
  // per ten seconds of play.
  e.timeHours = 5.82;
  // Step until the window actually closes and read the battle AT THAT
  // MOMENT, not twenty seconds later. An SP duel resolves on its own in
  // far less time than that — with the player parked, the player loses —
  // so a check made at the end of a long run cannot tell "the window
  // ended my race" apart from "I lost".
  let atClose = null;
  for (let i = 0; i < 4000; i++) {
    e.update(1 / 60);
    if (!e.racingOpen()) { atClose = !!e.inBattle; break; }
  }
  return {
    hour: +e.timeHours.toFixed(3),
    open: e.racingOpen(),
    startedIn,
    stillIn: atClose,
  };
});
console.log(
  `mid-race  ${check(
    !midRace.open && midRace.stillIn,
    !midRace.startedIn
      ? "the test could not start a race inside the window to begin with"
      : midRace.stillIn === null
        ? `the clock only reached ${midRace.hour} — the window never closed during the test`
        : "the window closing ended a race that was already running"
  )}  clock ran to ${midRace.hour}, window shut, the race is still on`
);

// --- 5. And the car still drives with the window shut ----------------
const rolling = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  // Every lockout cleared explicitly. The section before this one issues
  // a real challenge, and a car held for a pre-race countdown ignores the
  // throttle — which reads exactly like "the world is shut outside the
  // window" and is nothing of the kind.
  e.inBattle = false;
  e.challengePending = false;
  e.locked = false;
  e.cine = null;
  e.timeHours = 9;
  e.player.speed = 0;
  e.player.lat = 0;
  e.player.s = 2400;
  e.prevSpeed = 0;
  const park = () => {
    const away = e.track.wrap(2400 + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
  };
  for (let i = 0; i < 240; i++) {
    park();
    e.setTouchInput({ throttle: 1, brake: 0, steer: 0 });
    e.update(1 / 60);
  }
  return { speedKmh: +(e.player.speed * 3.6).toFixed(1), open: e.racingOpen() };
});
console.log(
  `rolling   ${check(
    !rolling.open && rolling.speedKmh > 40,
    `with the window shut the car reached ${rolling.speedKmh} km/h — the world is not open, it is closed`
  )}  ${rolling.speedKmh} km/h at 09:00 with racing shut`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe night opens at midnight and closes at 05:50.");
