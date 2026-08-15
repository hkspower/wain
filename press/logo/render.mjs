// Render the plates through Chromium: it is the only renderer here that
// shapes Arabic and Japanese correctly, and PIL would set both as
// disconnected letterforms.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const jobs = [
  { file: "plate.html", out: "gulf-road-nights-plate.png", w: 1200, h: 1600, scale: 2 },
  { file: "lockup.html", out: "gulf-road-nights-logo.png", w: 1600, h: 900, scale: 2 },
  { file: "lockup.html?bare=1", out: "gulf-road-nights-logo-transparent.png", w: 1600, h: 900, scale: 2, alpha: true },
  { file: "badge.html", out: "gulf-road-nights-badge.png", w: 900, h: 900, scale: 2, alpha: true },
];

mkdirSync("press/logo", { recursive: true });
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"] });
for (const j of jobs) {
  const [name, query] = j.file.split("?");
  if (!existsSync(`press/logo/${name}`)) { console.log(`skip ${name}`); continue; }
  const page = await b.newPage({
    viewport: { width: j.w, height: j.h },
    deviceScaleFactor: j.scale,
  });
  const url = "file://" + resolve(`press/logo/${name}`) + (query ? `?${query}` : "");
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  await page.screenshot({
    path: `press/logo/${j.out}`,
    omitBackground: !!j.alpha,
    clip: { x: 0, y: 0, width: j.w, height: j.h },
  });
  console.log(`${j.out}  ${j.w * j.scale}x${j.h * j.scale}`);
  await page.close();
}
await b.close();
