// The game reads the same on an Arabic phone as on an English one.
//
//   npm run dev
//   npm run test:digits
//
// `n.toLocaleString()` with no locale does not mean "format this
// number". It means "format it however this browser is set", and the
// browser this game was built for is a phone in Kuwait. Every price in
// the garage went through that call, so on an `ar-KW` device the shop
// read:
//
//     ٤٠٠ KD        ٣٤٬٠٠٠ KD        ٨٦٬٠٠٠        255 km/h
//
// Arabic-Indic digits inside English sentences — and beside them, in
// the same card, a top speed still in Western digits, because that one
// was never a toLocaleString call. Two digit systems on one screen, and
// which you got depended on a setting the game never read.
//
// None of this fails, throws or looks broken in a Latin locale, which
// is exactly why it survived: the machine that would have shown it is
// not the machine it was written on. So it is measured here, in both
// locales, against the screen rather than against the source.
//
// The Arabic half of the game has never had the problem, because it
// converts on purpose — `arabicNumber()` in world.ts writes ٠١٢٣٤٥٦٧٨٩
// into the way-markers and the pump board. src/game/format.ts is that
// same decision made on the English side: `num()`, one named locale.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium-1194/chrome-linux/chrome`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH."); process.exit(2); }

/** U+0660..U+0669 — the digits that must never appear in an English run. */
const AR_DIGIT = /[٠-٩]/;

const b = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});

const fail = [];
for (const locale of ["en-GB", "ar-KW"]) {
  const ctx = await b.newContext({ locale, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
  await page.waitForSelector("text=START ENGINE", { timeout: 120000 });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("gulf-road-nights-onboarded", "2");
    localStorage.setItem("gulf-road-nights-coach", "3");
    // Enough money that the showroom quotes real figures rather than
    // "need N more" on every card.
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
      car: "salmiya-turbo", cars: ["salmiya-turbo"], owned: [], kd: 34000,
      equipped: { paint: "paint-white", glow: "glow-none" },
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("text=START ENGINE", { timeout: 120000 });

  // The garage is the second item on the main menu, and it opens
  // without driving — which keeps this test off the WebGL path.
  await page.locator("nav[aria-label='Main menu'] button").nth(1).click();
  await page.waitForSelector("text=/KD/", { timeout: 60000 });
  await page.waitForTimeout(1200);

  const runs = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
      if (el.children.length) continue;                 // leaf text only
      const t = (el.textContent || "").trim();
      // A run that quotes money, speed or revs — the figures a player
      // reads off the shop and compares between cars.
      if (t && /\d|[٠-٩]/.test(t) && /KD|rpm|km\/h/.test(el.parentElement?.textContent || t))
        out.push(t);
    }
    return [...new Set(out)];
  });

  const wrong = runs.filter((t) => AR_DIGIT.test(t));
  console.log(`${locale}  ${runs.length} numeric runs on the garage screen  ${wrong.length ? "FAIL" : "ok"}`);
  if (runs.length < 4) fail.push(`${locale}: only ${runs.length} numeric runs found — the garage did not open`);
  for (const t of wrong) fail.push(`${locale}: Arabic-Indic digits in an English run — "${t.slice(0, 60)}"`);
  await ctx.close();
}
await b.close();

if (fail.length) {
  console.error(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:\n`);
  for (const f of fail) console.error(`  ${f}`);
  console.error("\nFormat numbers in English runs with num() from src/game/format.ts.");
  process.exit(1);
}
console.log("\nthe garage quotes the same figures in both locales: Western digits, one grouping.");
