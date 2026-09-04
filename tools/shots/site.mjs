#!/usr/bin/env node
// The game's website, in a browser, in both languages.
//
//   npm run dev            # in another shell
//   npm run check:site
//
// tests/site.mjs checks that the CONTENT is whole — both halves of every
// pair, every image on disk, no drift from the game. None of that proves
// the page works. This does: it loads /game, presses the language
// switch, and asks the browser rather than the source.
//
// The three failures it exists for, all of which look fine in the
// source: an image whose path is right on disk and wrong in the srcset,
// so it 404s; a hydration mismatch, which React reports to the console
// and nowhere else; and a direction switch that changes the words and
// leaves the page laid out left to right.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found."); process.exit(2); }

const OUT = "press/shots";
mkdirSync(OUT, { recursive: true });

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const b = await chromium.launch({
  executablePath: exe,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(120000);

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
// Every failed request, with its status and its path. "2 runtime
// errors" told me a request had 500ed and nothing about which one, and
// the two candidates — the page itself and Next's dev overlay — need
// completely different responses.
const bad = [];
page.on("response", (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`);
});

await page.goto("http://localhost:3000/game", { waitUntil: "networkidle" });

// English first — the first paint is English on the server and on the
// client, and anything else is a hydration mismatch waiting to happen.
const en = await page.evaluate(() => {
  const root = document.querySelector("[lang]");
  return { dir: document.querySelector("div[dir]")?.getAttribute("dir"), lang: root?.getAttribute("lang") };
});
console.log(`english: dir=${en.dir}  ${check(en.dir === "ltr", `the page opened in dir=${en.dir}`)}`);

// Every image the page actually asked for, loaded. naturalWidth is 0 for
// an image that 404ed or decoded badly — and lazy ones below the fold
// have not been fetched at all, so scroll the page first.
await page.evaluate(async () => {
  // behavior: "instant", and NOT back to the top until the images have
  // settled. globals.css sets `html { scroll-behavior: smooth }`, so a
  // plain window.scrollTo starts an ANIMATION — each step here cancelled
  // the last one, the page never actually reached the showroom, and its
  // sixteen lazy portraits were reported broken without a single request
  // for them ever being made. The evidence was in the count: thirteen
  // images loaded, which is the hero and the gallery, reached from the
  // top by Chromium's own lazy-loading margin rather than by scrolling.
  for (let y = 0; y < document.body.scrollHeight; y += 600) {
    window.scrollTo({ top: y, behavior: "instant" });
    await new Promise((r) => setTimeout(r, 80));
  }
});
// WAIT FOR THE CONDITION, not for a number of milliseconds.
//
// This was `waitForTimeout(1500)` and it reported all sixteen car
// portraits broken on a page where every one of them loads: the images
// were still in flight when it measured, and a fixed sleep cannot know
// that. `complete` goes true on success AND on failure, so a real 404
// still lands in the broken list below — the wait only stops the test
// from measuring an image that has not finished either way.
const settled = await page
  .waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
check(settled, "some images never finished loading or failing within 30s");
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
const imgs = await page.evaluate(() =>
  [...document.images].map((i) => ({ src: new URL(i.currentSrc || i.src).pathname, w: i.naturalWidth }))
);
const broken = imgs.filter((i) => i.w === 0);
console.log(`images: ${imgs.length} on the page, ${broken.length} broken  ` +
  check(broken.length === 0, `broken images: ${broken.map((i) => i.src).join(", ")}`));
console.log(`  widths served: ${[...new Set(imgs.map((i) => i.src.includes("@800") ? "800w" : "full"))].join(", ")}`);
await page.screenshot({ path: `${OUT}/site-en.png`, fullPage: true });

// Now Arabic, through the button a reader would press.
await page.click("text=العربية");
await page.waitForTimeout(600);
const ar = await page.evaluate(() => {
  const el = document.querySelector("div[dir]");
  const h1 = document.querySelector("h1");
  return {
    dir: el?.getAttribute("dir"),
    lang: el?.getAttribute("lang"),
    // The computed direction, not the attribute: an attribute that CSS
    // overrides is a page that still reads left to right.
    computed: el ? getComputedStyle(el).direction : "",
    h1: (h1?.textContent ?? "").slice(0, 40),
  };
});
console.log(`arabic: dir=${ar.dir} computed=${ar.computed} lang=${ar.lang}  ` +
  check(ar.dir === "rtl" && ar.computed === "rtl", "the Arabic page is not laid out right to left"));
console.log(`  h1 reads "${ar.h1}"  ` +
  check(/[؀-ۿ]/.test(ar.h1), "the Arabic page's heading has no Arabic in it"));
await page.screenshot({ path: `${OUT}/site-ar.png`, fullPage: true });

// And that the choice survives a reload, which is the whole point of
// storing it.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const kept = await page.evaluate(() => document.querySelector("div[dir]")?.getAttribute("dir") ?? `no dir'd div; body starts "${document.body.innerText.slice(0, 60)}"`);
console.log(`after reload: dir=${kept}  ${check(kept === "rtl", "the language choice did not survive a reload")}`);

if (bad.length) console.log(`failed requests: ${[...new Set(bad)].join(", ")}`);
check(bad.length === 0, `failed requests: ${[...new Set(bad)].join(", ")}`);
console.log(`page errors: ${errors.length}  ${check(errors.length === 0, `runtime errors: ${errors.slice(0, 3).join(" | ")}`)}`);

await b.close();
console.log(fail.length ? `\nFAILURES:\n - ${fail.join("\n - ")}` : `\n=== THE PAGE WORKS IN BOTH LANGUAGES ===\n${OUT}/site-en.png, ${OUT}/site-ar.png`);
process.exit(fail.length ? 1 : 0);
