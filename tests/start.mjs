// How a race begins.
//
//   npm run dev
//   node tests/start.mjs
//
// The green flag used to fall wherever the two cars happened to be. The
// rival is spawned 260 m up the road and cruises; you catch it, flash,
// sit through the intro film and the fight starts from whatever gap that
// left — sometimes half a length up, sometimes six lengths back. The
// start decided the race before the flag did, and it decided it
// differently every time.
//
// A street race starts rolling and abreast. Both cars level, one lane
// apart, at the same speed, racing from the first metre:
//
//   level      no head start either way at the drop
//   abreast    one lane between them, not two and not none
//   matched    the same speed, and neither of them stationary
//   own lane   the player is not moved — the car under the driver's
//              hands stays where the driver put it
//   no film    the same start when the intro film is skipped, which is
//              the path that had no line-up at all
//   clear      and it does not put either car against the barrier
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
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(2000);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// Start the battle from a set of deliberately awkward positions: the
// rival far ahead, far behind, in the player's own lane, and with the
// player hard against each barrier.
const runs = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  const cases = [
    { name: "rival 180 m ahead", ds: 180, lat: 0, rlat: 5.25, speed: 40 },
    { name: "rival 90 m behind", ds: -90, lat: 0, rlat: -5.25, speed: 55 },
    { name: "same lane, 8 m up", ds: 8, lat: 1.75, rlat: 1.75, speed: 30 },
    { name: "player on the left kerb", ds: 40, lat: -5.6, rlat: 0, speed: 25 },
    { name: "player on the right kerb", ds: 40, lat: 5.6, rlat: 0, speed: 25 },
    { name: "player nearly stopped", ds: 30, lat: 0, rlat: 3.5, speed: 1 },
  ];
  const out = [];
  for (const c of cases) {
    e.rivalIndex = 0;
    e.spawnRival();
    const r = e.rival;
    e.inBattle = false;
    e.locked = false;
    e.cine = null;
    e.player.s = 2400;
    e.player.lat = c.lat;
    e.player.speed = c.speed / 3.6;
    e.heading = 0;
    e.steerSmooth = 0;
    e.slipVel = 0;
    r.s = e.track.wrap(2400 + c.ds);
    r.lat = c.rlat;
    r.speed = 30;
    r.state = "cruise";
    const beforeLat = e.player.lat;
    const beforeS = e.player.s;
    // The flag, straight down: this is the path a skipped film takes.
    e.startBattle(r);
    const half = e.track.halfWidthAt(e.player.s);
    out.push({
      name: c.name,
      gap: +e.track.deltaAhead(e.player.s, r.s).toFixed(3),
      apart: +Math.abs(r.lat - e.player.lat).toFixed(2),
      dSpeed: +Math.abs(r.speed - e.player.speed).toFixed(3),
      speed: +(e.player.speed * 3.6).toFixed(0),
      movedPlayer: +Math.max(
        Math.abs(e.player.lat - beforeLat),
        Math.abs(e.track.deltaAhead(beforeS, e.player.s))
      ).toFixed(3),
      roomL: +(half + r.lat).toFixed(2),
      roomR: +(half - r.lat).toFixed(2),
    });
  }
  e.inBattle = false;
  return out;
});

console.log("case                        gap    lanes apart   Δspeed   rival room L/R");
for (const r of runs) {
  console.log(
    `  ${r.name.padEnd(26)} ${String(r.gap).padStart(6)} m  ${String(r.apart).padStart(5)} m  ` +
      `${String(r.dSpeed).padStart(7)}   ${r.roomL} / ${r.roomR}`
  );
}
console.log(
  `level     ${check(
    runs.every((r) => Math.abs(r.gap) < 0.5),
    `the flag drops with up to ${Math.max(...runs.map((r) => Math.abs(r.gap))).toFixed(1)} m ` +
      `between them — that is a head start, not a start`
  )}  every start within half a metre of level`
);
console.log(
  `abreast   ${check(
    runs.every((r) => r.apart > 2.6 && r.apart < 4.4),
    `lane separation runs ${Math.min(...runs.map((r) => r.apart))} to ` +
      `${Math.max(...runs.map((r) => r.apart))} m — a lane is about 3.5`
  )}  one lane between them on every start`
);
console.log(
  `matched   ${check(
    runs.every((r) => r.dSpeed < 0.01) && runs.every((r) => r.speed >= 50),
    runs.some((r) => r.dSpeed >= 0.01)
      ? "the two cars start at different speeds"
      : `a start rolled away at ${Math.min(...runs.map((r) => r.speed))} km/h — a rolling start rolls`
  )}  same speed, never below ${Math.min(...runs.map((r) => r.speed))} km/h`
);
// The player's car may not be teleported at the green flag. Whatever is
// wrong with the formation, it is the RIVAL that moves to fix it.
console.log(
  `own lane  ${check(
    runs.every((r) => r.movedPlayer < 0.01),
    `the player's car was moved ${Math.max(...runs.map((r) => r.movedPlayer))} m at the drop`
  )}  the player's car is never moved to line the start up`
);
// And the rival must not be parked against the steel.
console.log(
  `clear     ${check(
    runs.every((r) => r.roomL > 1.6 && r.roomR > 1.6),
    `a start put the rival ${Math.min(...runs.flatMap((r) => [r.roomL, r.roomR])).toFixed(2)} m ` +
      `from the barrier`
  )}  never closer than ${Math.min(...runs.flatMap((r) => [r.roomL, r.roomR])).toFixed(2)} m to the steel`
);

// --- And the film hands over to the same formation --------------------
const film = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.rivalIndex = 0;
  e.spawnRival();
  const r = e.rival;
  e.inBattle = false;
  e.locked = false;
  e.player.s = 2400;
  e.player.lat = -1.75;
  e.player.speed = 45 / 3.6;
  r.s = e.track.wrap(2400 + 120);
  r.lat = 5.25;
  r.speed = 30;
  r.state = "cruise";
  e.cine = { start: performance.now(), r };
  // Run the film's own frames: the rival holds formation through it.
  for (let i = 0; i < 90; i++) e.update(1 / 60);
  const during = {
    gap: e.track.deltaAhead(e.player.s, r.s),
    apart: Math.abs(r.lat - e.player.lat),
  };
  e.cine = null;
  e.startBattle(r, true);
  const after = {
    gap: e.track.deltaAhead(e.player.s, r.s),
    apart: Math.abs(r.lat - e.player.lat),
  };
  e.inBattle = false;
  return { during, after };
});
console.log(
  `film      ${check(
    Math.abs(film.during.gap) < 3 &&
      film.during.apart > 2.6 &&
      film.during.apart < 4.4 &&
      Math.abs(film.after.apart - film.during.apart) < 0.6,
    Math.abs(film.during.gap) >= 3
      ? `the two-shot has them ${film.during.gap.toFixed(1)} m apart along the road`
      : `the rival changes lane at the drop: ${film.during.apart.toFixed(2)} m during the film, ` +
        `${film.after.apart.toFixed(2)} m at the flag`
  )}  ${film.during.apart.toFixed(2)} m apart in the film, ${film.after.apart.toFixed(2)} m at the flag`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nevery race starts rolling and abreast.");
