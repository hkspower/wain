// The server and the browser must agree on the first frame.
//
//   npm run dev
//   node tests/hydration.mjs
//
// A hydration mismatch is the quietest kind of bug: nothing is visibly
// wrong, React just throws away the subtree it rendered on the server
// and builds it again, and every returning player gets a console error
// they will never report. It only happens to people who have PLAYED —
// a fresh browser has nothing saved, so the server's guess and the
// client's read agree and the warning never fires. Which is why it
// survived: every check anyone ran started from a cleared save.
//
// So this one does the opposite. It plants a save, reloads, and reads
// the console.

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
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(120000);

const console_ = [];
page.on("console", (m) => console_.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => console_.push(`pageerror: ${e.message}`));

// --- Plant a save that differs from the server's default ------------
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});

// The car has to be one the footer would name DIFFERENTLY from the
// default, or a mismatch cannot show up even if the bug is back.
const planted = await page.evaluate(() => {
  // Written the way the game writes it: mods.ts's GarageState under
  // "gulf-road-nights-garage". loadGarage migrates whatever it finds,
  // so the minimum a save needs is the car and the money.
  const g = { kd: 400, cars: ["wain-special", "gulf-coupe-rs"], car: "gulf-coupe-rs", builds: {} };
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify(g));
  return { car: g.car };
});
console.log(`planted      car=${planted.car}`);

console_.length = 0;
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("nav[aria-label='Main menu']");
await page.waitForTimeout(1500);

// --- 1. No hydration complaint ---------------------------------------
const hydration = console_.filter((l) =>
  /hydrat|did not match|server (?:rendered|HTML)|Text content does not match/i.test(l)
);
console.log(`console      ${console_.length} lines, ${hydration.length} about hydration`);
for (const h of hydration.slice(0, 5)) console.log(`   ${h.slice(0, 160)}`);
console.log(`hydration    ${check(hydration.length === 0, `${hydration.length} hydration warning(s): ${hydration[0]?.slice(0, 200)}`)}`);

// --- 2. And the footer still ends up naming the saved car ------------
// A mismatch is trivially avoidable by rendering nothing ever. The
// point is that the name arrives — one tick later, from the effect.
const named = await page.evaluate(() => {
  const el = [...document.querySelectorAll("span")].find((s) =>
    s.textContent?.includes("في الكراج")
  );
  return el?.textContent?.trim() ?? null;
});
console.log(`footer       ${named ?? "(nothing)"}`);
console.log(`names it     ${check(!!named && !/^في الكراج/.test(named), "the footer never named the saved car")}`);

// --- 3. And the server's own HTML does not name it --------------------
// The other half of the contract: if the server ever starts guessing a
// car it cannot know, the mismatch is back whatever the client does.
const res = await fetch("http://localhost:3000/race");
const html = await res.text();
const serverNames = /في الكراج/.test(html)
  ? html.slice(Math.max(0, html.indexOf("في الكراج") - 200), html.indexOf("في الكراج"))
  : "";
const guessed = /Gulf Coupe|Zeta|Corniche/i.test(serverNames);
console.log(`server html  ${guessed ? "names a car" : "names no car"}`);
console.log(`no guess     ${check(!guessed, "the server rendered a car name it cannot know")}`);

await browser.close();

if (fail.length) {
  console.log(`\n${fail.length} FAILED`);
  for (const f of fail) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nall ok");
