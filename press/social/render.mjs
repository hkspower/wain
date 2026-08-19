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

const jobs = [
  // Instagram / Facebook / WhatsApp story, and TikTok: all 1080x1920.
  { file: "story.html", out: "instagram-story.png", w: 1080, h: 1920 },
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
