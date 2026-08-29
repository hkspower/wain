// Nothing on screen is very large AND very bold at the same time.
//
//   npm run dev            (in another terminal)
//   npm run test:weight
//
// THE LAW
//
// Size and weight are two ways of saying the same thing, and spending
// both on the same words says it twice. Big type is already emphatic;
// weight is what you spend on small type that has to compete with it.
// Past a certain size, more weight stops adding emphasis and starts
// filling in the counters, which is why the ceiling comes DOWN as the
// type gets bigger:
//
//     44px and up   weight 600 at most
//     32 - 44px     weight 700 at most
//     under 32px    as heavy as it needs to be
//
// WHY THIS IS MEASURED AND NOT REVIEWED
//
// Off the COMPUTED style, never off class names. A class name does not
// tell you what the cascade did: most of this game's headings take their
// weight from .grn-display rather than from anything in the markup, and
// .grn-display is unlayered CSS, so a font-bold in the markup would lose
// to it silently. Reading the markup would have reported a page of
// perfectly reasonable utilities over type that renders at 700.
//
// WHAT THIS DOES NOT REACH
//
// Idle screens only. The VS card, the results podium and the HUD in
// motion all need a race driven to reach them, and headless Chromium
// runs this game at about two frames a second. They are not unchecked,
// though: every one of them wears .grn-display, and that class sets the
// weight for all of them at once in unlayered CSS that markup cannot
// override. What this test cannot see is a violation introduced by an
// inline style on a screen it cannot open.
//
// It is also why the threshold is in PIXELS. The same `text-4xl` is 36px
// on a phone and 60px at a breakpoint above it; only one of those is a
// violation, and only the rendered size knows which.

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}

/** The ceiling, as a function rather than a table, so the test states
 *  the law once and the reporting reads it back. */
const ceilingFor = (px) => (px >= 44 ? 600 : px >= 32 ? 700 : 1000);

const PAGES = ["/", "/hub", "/race", "/about", "/explore", "/places/kuwait-towers"];
// Two widths, because a heading's size is a function of the viewport and
// the violation may only exist at one of them. 1280 is where the sm:
// step is in force; 700 is a small laptop, where it usually is not.
const WIDTHS = [1280, 700];

const b = await chromium.launch({
  executablePath: exe,
  args: ["--no-sandbox", "--use-gl=angle", "--enable-webgl", "--disable-dev-shm-usage"],
  headless: true,
});

const fail = [];
let inspected = 0;
let biggest = { size: 0, text: "", weight: 0 };

for (const width of WIDTHS) {
  for (const path of PAGES) {
    const page = await b.newPage({ viewport: { width, height: 900 } });
    try {
      await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle", timeout: 45000 });
    } catch {
      // The race page renders forever and never goes idle. Its menu is
      // up either way, which is the screen with the wordmark on it.
    }
    await page.waitForTimeout(2500);

    const runs = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("*")) {
        // Only elements holding their OWN text. Without this every
        // ancestor of a heading is reported as well, and the same
        // violation is counted eight times up the tree.
        const text = [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim())
          .join(" ")
          .trim();
        if (!text) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.05) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        out.push({
          text: text.slice(0, 44),
          size: Math.round(parseFloat(cs.fontSize)),
          weight: parseInt(cs.fontWeight, 10) || 400,
          cls: String(el.className?.baseVal ?? el.className ?? "").slice(0, 76),
        });
      }
      return out;
    });

    for (const r of runs) {
      inspected++;
      if (r.size > biggest.size) biggest = r;
      const ceiling = ceilingFor(r.size);
      if (r.weight > ceiling) {
        fail.push(
          `${path} @${width}  "${r.text}"  ${r.size}px at weight ${r.weight} ` +
          `(the ceiling at that size is ${ceiling})\n        ${r.cls}`
        );
      }
    }
    await page.close();
  }
}
await b.close();

console.log(`${inspected} runs of text read across ${PAGES.length} pages at ${WIDTHS.join(" and ")} px wide`);
console.log(`the largest was ${biggest.size}px at weight ${biggest.weight} — "${biggest.text}"`);
console.log(`   at ${biggest.size}px the ceiling is ${ceilingFor(biggest.size)}`);

if (fail.length) {
  console.error(`\n${fail.length} run${fail.length === 1 ? "" : "s"} of very large AND very bold:\n`);
  for (const f of fail) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log("\nnothing on screen shouts with size and weight at the same time");
