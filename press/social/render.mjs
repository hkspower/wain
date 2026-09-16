// Render the social plates through Chromium, the same way press/logo does
// — it is the only renderer here that shapes Arabic correctly.
//
//   node press/social/render.mjs
//
// Output is at the exact pixel size each platform wants, so nothing is
// resampled on the way to the upload.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

// The four designs the manga set is cut into, at every size Instagram
// takes. Written by press/social/build-plates.mjs — edit that, not the
// plates, and re-run it before rendering.
const DESIGNS = ["cover", "road", "machines", "stops"];
const SIZES = [
  // Square. 1:1, the oldest feed shape.
  { prefix: "post-square", w: 1080, h: 1080 },
  // Portrait 4:5 — the feed unit, and the carousel.
  { prefix: "post-portrait", w: 1080, h: 1350 },
  // Landscape 1.91:1. Renders smallest in feed and is cropped hardest
  // on the profile grid; its real use is a link or ad preview.
  { prefix: "post-wide", w: 1080, h: 566 },
  // Story / Reel, and the same plate serves TikTok and WhatsApp.
  { prefix: "story", w: 1080, h: 1920 },
];

const jobs = [
  // Instagram / Facebook / WhatsApp story, and TikTok: all 1080x1920.
  { file: "story.html", out: "instagram-story.png", w: 1080, h: 1920 },
  ...SIZES.flatMap(({ prefix, w, h }) =>
    DESIGNS.map((d) => ({ file: `${prefix}-${d}.html`, out: `${prefix}-${d}.png`, w, h }))
  ),
];

const b = await chromium.launch({
  executablePath: exe,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});
for (const j of jobs) {
  const page = await b.newPage({ viewport: { width: j.w, height: j.h } });
  await page.goto("file://" + resolve(`press/social/${j.file}`), { waitUntil: "networkidle" });
  // The webfonts arrive over the network; a plate rendered before they
  // land is set in a fallback and the Arabic comes out unjoined.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `press/social/${j.out}`,
    clip: { x: 0, y: 0, width: j.w, height: j.h },
  });
  console.log(`${j.out}  ${j.w}x${j.h}`);
  await page.close();
}
await b.close();
