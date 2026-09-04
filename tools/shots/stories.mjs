#!/usr/bin/env node
// Render the Story cards to 1080x1920 PNGs.
//
//   npm run stories && npm run stories:png
//
// The HTML is the source artifact — it is what goes to Adobe Express —
// and these are the files you actually post. Rendered from the same
// document, so the two cannot disagree.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found."); process.exit(2); }

const SRC = "press/stories/stories.html";
const OUT = "press/stories/png";
if (!existsSync(SRC)) { console.error(`no ${SRC} — run: npm run stories`); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"] });
const page = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
await page.goto(`file://${resolve(SRC)}`, { waitUntil: "networkidle" });

// The type is the point of these cards, and Typekit is the one thing
// here that arrives over the network. Wait for it rather than for a
// guess, or the first card renders in a fallback face.
const fonts = await page
  .waitForFunction(async () => {
    await document.fonts.ready;
    return document.fonts.check('900 italic 116px "condor"') &&
           document.fonts.check('900 62px "otta-arabic"');
  }, null, { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
if (!fonts) {
  console.error("Adobe Fonts did not load — the cards would render in a fallback face. Aborting.");
  await b.close();
  process.exit(1);
}

const cards = await page.$$(".story");
console.log(`${cards.length} cards, fonts loaded`);
let total = 0;
for (let i = 0; i < cards.length; i++) {
  const name = await cards[i].$eval(".name", (e) => e.textContent.trim());
  const id = String(i + 1).padStart(2, "0") + "-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (only.length && !only.some((o) => id.includes(o))) continue;
  const path = `${OUT}/${id}.png`;
  await cards[i].screenshot({ path });
  const kb = statSync(path).size / 1024;
  total += kb;
  console.log(`  ${id.padEnd(26)} ${kb.toFixed(0).padStart(4)} KB`);
}
console.log(`\n${OUT}/  —  ${(total / 1024).toFixed(1)} MB total`);
await b.close();
