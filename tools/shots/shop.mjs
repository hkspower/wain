// Screenshots of the mod shop, with a driveway that has something in it.
//
//   npm run dev
//   node tools/shots/shop.mjs
//
// The shop is the one screen whose whole job is per-car state, and the
// only way to see whether it is showing the right car's build is to put
// three cars in the driveway with different builds and look.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
  localStorage.setItem(
    "gulf-road-nights-garage",
    JSON.stringify({
      kd: 60000,
      car: "zeta-300",
      cars: ["wain-special", "zeta-300", "kaiju-r"],
      builds: {
        // One car built, two stock — so the shop has something to get wrong.
        "zeta-300": {
          owned: ["twin-turbo", "weight", "brakes-race", "tires-race"],
          equipped: { aspiration: "twin-turbo", brakes: "brakes-race", tires: "tires-race", paint: "paint-white", glow: "glow-none" },
        },
        "wain-special": { owned: [], equipped: { paint: "paint-white", glow: "glow-none" } },
        "kaiju-r": { owned: [], equipped: { paint: "paint-white", glow: "glow-none" } },
      },
    })
  );
});
await page.reload({ waitUntil: "networkidle" });
mkdirSync("press/shop", { recursive: true });

await page.getByRole("button", { name: /GARAGE/ }).first().click();
await page.waitForTimeout(1400);
await page.getByRole("tab", { name: /PERFORMANCE/ }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: "press/shop/ramp-zeta.png" });
console.log("  press/shop/ramp-zeta.png");

// Move the ramp to a stock car: the spec bars and every part card must
// switch with it.
await page.getByRole("button", { name: /^Kaiju R/ }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: "press/shop/ramp-kaiju.png" });
console.log("  press/shop/ramp-kaiju.png");

await browser.close();
