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

// Every plate is delivered at 4K on its long edge. The sources are
// vector and text, so the scale factor costs nothing but pixels — there
// is no resampling anywhere in this pipeline.
const LONG_EDGE = 3840;

const jobs = [
  { file: "plate.html", out: "gulf-road-nights-plate.png", w: 1200, h: 1600 },
  { file: "lockup.html", out: "gulf-road-nights-logo.png", w: 1600, h: 900 },
  { file: "lockup.html?bare=1", out: "gulf-road-nights-logo-transparent.png", w: 1600, h: 900, alpha: true },
  { file: "badge.html", out: "gulf-road-nights-badge.png", w: 900, h: 900, alpha: true },
  { file: "nr-lockup.html", out: "night-racers-logo.png", w: 1600, h: 900 },
  { file: "nr-lockup.html?bare=1", out: "night-racers-logo-transparent.png", w: 1600, h: 900, alpha: true },
  { file: "nr-emblem.html", out: "night-racers-emblem.png", w: 900, h: 900, alpha: true },
].map((j) => ({ ...j, scale: LONG_EDGE / Math.max(j.w, j.h) }));

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
  console.log(`${j.out}  ${Math.round(j.w * j.scale)}x${Math.round(j.h * j.scale)}`);
  await page.close();
}
await b.close();
