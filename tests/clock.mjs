// The Kuwait clock, checked against a machine that is not in Kuwait.
//
// A clock is the easiest thing in a game to get wrong in a way that
// looks right: render `new Date()` on a dial and it is correct for
// whoever wrote it and wrong for everybody else, and nothing on screen
// says so. So this test never runs in Kuwait's timezone. It opens the
// page from Los Angeles and from Tokyo — one behind, one ahead, and
// neither the same date as Kuwait for part of the day — and demands the
// same answer from both.
//
// The hands are read as the DOM has them, not as the component intended
// them. The rotation on each hand group is the only thing the clock
// writes, so parsing that back and converting to a time is a genuinely
// independent measurement: it goes through the SVG, and a hand that is
// drawn but never rotated fails it.

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
if (!exe) { console.error("no chromium"); process.exit(2); }

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});

/** What Kuwait's wall clock says right now, computed here in node. */
function kuwaitNow() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kuwait",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date())
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, Number(x.value)])
  );
  return { h: p.hour % 24, m: p.minute, s: p.second };
}

const ZONES = [
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "Asia/Tokyo", label: "Tokyo" },
];

const readings = [];
for (const z of ZONES) {
  const ctx = await browser.newContext({
    viewport: { width: 1000, height: 620 },
    timezoneId: z.id,
  });
  const page = await ctx.newPage();
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
  await page.waitForTimeout(1200);

  const r = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="kuwait-clock"]');
    if (!root) return { missing: true };
    const svg = root.querySelector("svg");
    const groups = svg ? [...svg.querySelectorAll("g")] : [];
    const angles = groups.map((g) => {
      const t = g.getAttribute("transform") || "";
      const m = /rotate\(([-0-9.]+)\)/.exec(t);
      return m ? Number(m[1]) : null;
    });
    const digits = root.querySelector('[data-testid="kuwait-clock-digits"]');
    // Where the panel actually sits, so "upper right" is checked rather
    // than assumed.
    const box = root.getBoundingClientRect();
    return {
      angles,
      digits: digits ? digits.textContent : null,
      box: { x: box.x, y: box.y, w: box.width, h: box.height },
      vw: window.innerWidth,
      vh: window.innerHeight,
      // What the BROWSER thinks its own timezone is — the thing the
      // clock must not be using.
      localZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      localHour: new Date().getHours(),
    };
  });
  const truth = kuwaitNow();
  readings.push({ zone: z, r, truth });
  await ctx.close();
}

for (const { zone, r, truth } of readings) {
  if (r.missing) {
    fail.push(`no clock in the HUD when the browser is in ${zone.label}`);
    continue;
  }
  const [ha, ma, sa] = r.angles;
  if (ha == null || ma == null || sa == null) {
    fail.push(`a hand is drawn but never rotated in ${zone.label} (${JSON.stringify(r.angles)})`);
    continue;
  }
  // Read the hands back as a time. The minute hand is the one to trust:
  // the hour hand is only 30 degrees per hour, so a degree of slop there
  // is two minutes, while the minute hand is 6 degrees a minute.
  const minFromHand = (ma / 360) * 60;
  const hourFromHand = (ha / 360) * 12;
  console.log(
    `${zone.label.padEnd(12)} browser zone ${r.localZone}, its own clock says ${String(r.localHour).padStart(2, "0")}h`
  );
  console.log(
    `             hands read ${hourFromHand.toFixed(2)}h ${minFromHand.toFixed(1)}m, ` +
    `digits "${r.digits}", Kuwait is ${String(truth.h).padStart(2, "0")}:${String(truth.m).padStart(2, "0")}`
  );

  // The digits are the plain statement of intent — within a minute.
  //
  // Not slack for its own sake. The claim under test is that the dial
  // reads KUWAIT rather than the machine's own zone, and the zones it is
  // opened in are hours away, so a minute of tolerance still catches
  // every failure this exists to catch. What it stops catching is the
  // clock component's own tick: it repaints once a second in a tab that
  // renders the game at about two frames a second, so the digits on
  // screen can be seconds old by the time the reading is taken, and a
  // reading that lands near a minute boundary failed on the rollover
  // rather than on the timezone. Both zones failed that way in the same
  // run — Los Angeles read 20:00 against a truth of 20:01, and Tokyo,
  // sampled forty seconds later, read 20:02.
  const want = `${String(truth.h).padStart(2, "0")}:${String(truth.m).padStart(2, "0")}`;
  const [dh, dm] = String(r.digits ?? "99:99").split(":").map(Number);
  const digitsOff = Math.abs(
    ((dh * 60 + dm - (truth.h * 60 + truth.m) + 720 + 1440) % 1440) - 720
  );
  console.log(
    `             ${check(digitsOff <= 1, `${zone.label}: clock reads ${r.digits}, Kuwait is ${want}`)}`
  );

  // ...and the HANDS have to agree with the digits, or the dial is
  // decoration sitting next to a correct number.
  const minDelta = Math.abs(((minFromHand - truth.m + 30 + 60) % 60) - 30);
  check(
    minDelta < 1.2,
    `${zone.label}: the minute hand is at ${minFromHand.toFixed(1)} but Kuwait is at ${truth.m} minutes`
  );
  const hourDelta = Math.abs(((hourFromHand - (truth.h % 12) - truth.m / 60 + 6 + 12) % 12) - 6);
  check(
    hourDelta < 0.2,
    `${zone.label}: the hour hand is at ${hourFromHand.toFixed(2)} but Kuwait is at ${(truth.h % 12) + truth.m / 60}`
  );

  // Upper right, as asked for: in the top third and the right third.
  const cx = r.box.x + r.box.w / 2;
  const cy = r.box.y + r.box.h / 2;
  check(
    cx > r.vw * 0.66 && cy < r.vh * 0.33,
    `the clock is at (${Math.round(cx)}, ${Math.round(cy)}) in a ${r.vw}x${r.vh} window — not the upper right`
  );
}

// The whole point: two machines on opposite sides of the world, one
// answer. If this passes only because both browsers happen to agree
// with each other AND with Kuwait, the zones above were chosen badly.
if (readings.length === 2 && !readings.some((x) => x.r.missing)) {
  const [a, b] = readings;
  console.log(
    `\nagreement    ${a.zone.label} showed "${a.r.digits}", ${b.zone.label} showed "${b.r.digits}"` +
    ` — sampled in sequence, so a minute may roll between them`
  );
  // Within a minute of each other, not identical. The two browsers are
  // launched in sequence and a page load is not instant — these were
  // sampled about forty seconds apart, and demanding the same string
  // fails whenever a minute happens to roll over between them. That is
  // the test being wrong about time, not the clock.
  //
  // The claim that matters is already made above: each reading was
  // checked against Kuwait at the moment IT was taken, on a machine
  // whose own clock said something else entirely. This is the weaker,
  // time-safe version of the same thing.
  const mins = readings.map((x) => {
    const [hh, mm] = String(x.r.digits ?? "0:0").split(":").map(Number);
    return hh * 60 + mm;
  });
  const apart = Math.abs(((mins[0] - mins[1] + 720 + 1440) % 1440) - 720);
  // Two, for the reason above and one more: these readings are taken in
  // sequence and a page load in this browser is the better part of a
  // minute, so the wall clock genuinely moves between them. Two
  // timezones that disagree about the HOUR are still hours apart, which
  // is what this is looking for.
  check(
    apart <= 2,
    `two machines in different timezones disagree by ${apart} minutes: ${a.r.digits} vs ${b.r.digits}`
  );
  check(
    a.r.localZone !== b.r.localZone,
    "both test browsers ended up in the same timezone — this proves nothing"
  );
}

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe clock reads Kuwait, wherever it is opened");
await browser.close();
process.exit(fail.length ? 1 : 0);
