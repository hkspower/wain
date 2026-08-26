// The dealership, driven by hand once: seed two cars, sell one through
// the real buttons, watch the money arrive and the card flip.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
  // A save with two cars and pocket money, so a SELL button exists.
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    kd: 500,
    cars: ["wain-special", "salmiya-turbo"],
    car: "wain-special",
    builds: {},
  }));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.click("text=GARAGE");
await page.waitForTimeout(1200);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

// The quote is on the owned card.
const quote = await page.evaluate(() => {
  const els = [...document.querySelectorAll("span")];
  const t = els.find((e) => e.textContent?.startsWith("Trade-in"));
  return t?.textContent ?? null;
});
console.log("quote row:", quote);
check(quote && /14,880|14880/.test(quote), `the Salmiya's 14,880 KD quote is not shown: ${quote}`);

// Two taps: arm, then sell.
const sells = page.locator('button:has-text("SELL")');
console.log("sell buttons:", await sells.count());
check((await sells.count()) === 2, "expected two SELL buttons (both cars sellable while two exist)");
page.on("console", (m) => console.log("PAGE:", m.type(), m.text().slice(0, 160)));
await sells.first().click();
await page.waitForTimeout(300);
const armed = await sells.first().textContent();
console.log("armed label:", armed);
check(/sure\?/.test(armed ?? ""), "first tap did not arm the button");
// Screenshots are BUFFERED and written after the last interaction:
// press/ lives inside the repo, the dev server watches the repo, and
// writing a file here mid-test fires a Fast Refresh that resets the
// component state — which disarmed the very button being tested, twice,
// seventeen seconds into each run.
const shots = [];
// Confirm IMMEDIATELY — the armed state disarms itself by design, and
// anything slow between the taps (a screenshot most of all) turns the
// deliberate timeout into a phantom test failure. Click through the
// DOM, so a driver hit-test artifact cannot masquerade as a UI bug.
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /sure\?/.test(x.textContent ?? ""));
  if (!b) return "no armed button in the DOM";
  b.click();
  return "clicked: " + b.textContent;
});
console.log(clicked);
await page.waitForTimeout(800);

const after = await page.evaluate(() => {
  const g = JSON.parse(localStorage.getItem("gulf-road-nights-garage"));
  const balance = [...document.querySelectorAll("div")]
    .find((e) => e.className?.includes?.("text-sodium-400") && /KD/.test(e.textContent ?? ""))?.textContent;
  return { kd: g.kd, cars: g.cars, car: g.car, balance };
});
console.log("after sale:", JSON.stringify(after));
check(after.kd === 500 + 14880, `balance is ${after.kd}, wanted 15380`);
check(!after.cars.includes("salmiya-turbo"), "the sold car is still owned");
check(after.cars.length === 1 && after.car === "wain-special", "the driveway or seat is wrong");
check(/15,380/.test(after.balance ?? ""), `the header balance did not update: ${after.balance}`);
const sellsLeft = await page.locator('button:has-text("SELL")').count();
check(sellsLeft === 0, "the last car still offers a SELL button");
console.log("last-car row:", await page.locator('text=your last car').count() === 1 ? "shown" : "MISSING");
shots.push(["after.png", await page.screenshot()]);

mkdirSync("press/shop", { recursive: true });
for (const [n, buf] of shots) writeFileSync(`press/shop/${n}`, buf);
console.log(fail.length ? "FAILURES:\n - " + fail.join("\n - ") : "bought, sold, and the books balance");
await browser.close();
process.exit(fail.length ? 1 : 0);
