// The space between things.
//
//   npm run dev
//   node tools/shots/gutters.mjs
//
// A layout is checked by looking at it, and looking at it is done at one
// window size — usually a wide one, usually the developer's. Everything
// that goes wrong with a gutter goes wrong somewhere else: two readouts
// that sit comfortably apart at 1440 touch at 1024 and overlap at 820,
// and a panel that clears the bottom of a desktop window is under the
// thumb rest on a phone.
//
// So this measures rather than looks. At each size, on each screen, it
// finds every element that actually carries TEXT — a word is the thing a
// gutter exists to protect, and restricting to text leaves is what keeps
// this from reporting every decorative layer in the tree as an overlap —
// and then asks three questions of them:
//
//   overlap   do two pieces of text share pixels
//   inside    does any text run off the edge of the window
//   margin    does any text come closer to an edge than the gutter the
//             rest of the screen keeps
//
// It reports rather than asserts. A layout has deliberate exceptions —
// a badge ON a card, a label INSIDE a meter — and a tool that fails on
// those is a tool nobody runs.

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

/** The sizes a browser game actually gets opened at. */
const SIZES = [
  { name: "phone portrait", w: 390, h: 844 },
  { name: "phone landscape", w: 844, h: 390 },
  { name: "small laptop", w: 1280, h: 720 },
  { name: "desktop", w: 1600, h: 900 },
  { name: "ultrawide", w: 2560, h: 1080 },
];

/** How close to an edge a word may come before it is cramped. */
const EDGE = 6;
/** Overlap smaller than this is a rounding artefact, not a collision. */
const SLOP = 2;

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});

const measure = `() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const els = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    if (parseFloat(cs.opacity) < 0.05) continue;
    // A text LEAF: it has words of its own rather than only in children.
    let own = "";
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    own = own.trim();
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    els.push({
      text: own.replace(/\\s+/g, " ").slice(0, 28),
      tag: el.tagName.toLowerCase(),
      x: r.left, y: r.top, w: r.width, h: r.height,
      // Which ancestors it has, so a label inside its own card is not
      // reported as colliding with the card's other label.
      path: (() => { const p = []; let n = el; while (n && n !== document.body) { p.push(n); n = n.parentElement; } return p.length; })(),
      id: els.length,
      el,
    });
  }
  const out = { vw, vh, count: els.length, offscreen: [], cramped: [], overlaps: [] };
  for (const a of els) {
    if (a.x < -1 || a.y < -1 || a.x + a.w > vw + 1 || a.y + a.h > vh + 1) {
      out.offscreen.push({ text: a.text, x: Math.round(a.x), y: Math.round(a.y),
        w: Math.round(a.w), h: Math.round(a.h) });
      continue;
    }
    const m = Math.min(a.x, a.y, vw - (a.x + a.w), vh - (a.y + a.h));
    if (m < ${EDGE}) out.cramped.push({ text: a.text, margin: Math.round(m) });
  }
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > ${SLOP} && oy > ${SLOP}) {
        out.overlaps.push({ a: a.text, b: b.text, ox: Math.round(ox), oy: Math.round(oy) });
      }
    }
  }
  return out;
}`;

const screens = [
  {
    name: "menu",
    go: async (page) => {},
  },
  {
    name: "garage",
    go: async (page) => {
      await page.click("text=GARAGE");
      await page.waitForTimeout(700);
    },
  },
  {
    name: "settings",
    go: async (page) => {
      await page.getByRole("button", { name: /SETTINGS/ }).first().click();
      await page.waitForTimeout(700);
    },
  },
  {
    name: "race HUD",
    go: async (page) => {
      await page.click("text=START ENGINE");
      await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
      await page.waitForTimeout(2500);
    },
  },
];

let problems = 0;
for (const size of SIZES) {
  console.log(`\n=== ${size.name}  ${size.w}x${size.h} ===`);
  for (const screen of screens) {
    const page = await browser.newPage({ viewport: { width: size.w, height: size.h } });
    page.setDefaultTimeout(240000);
    page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
    await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("gulf-road-nights-onboarded", "2");
      localStorage.setItem("gulf-road-nights-coach", "3");
    });
    await page.reload({ waitUntil: "networkidle" });
    try {
      await screen.go(page);
    } catch (e) {
      console.log(`  ${screen.name.padEnd(10)} could not open: ${String(e).slice(0, 60)}`);
      await page.close();
      continue;
    }
    await page.waitForTimeout(400);
    // An arrow function passed as a STRING evaluates to the function
    // itself, not to its result — which arrives back as undefined,
    // because a function is not serialisable. Call it.
    const r = await page.evaluate(`(${measure})()`);
    const bad = r.offscreen.length + r.overlaps.length;
    problems += bad;
    console.log(
      `  ${screen.name.padEnd(10)} ${String(r.count).padStart(3)} text elements  ` +
        `${r.overlaps.length} overlap  ${r.offscreen.length} off screen  ${r.cramped.length} tight`
    );
    for (const o of r.overlaps.slice(0, 6))
      console.log(`      OVERLAP  "${o.a}" × "${o.b}"  ${o.ox}×${o.oy} px`);
    if (r.overlaps.length > 6) console.log(`      … and ${r.overlaps.length - 6} more`);
    for (const o of r.offscreen.slice(0, 6))
      console.log(`      OFF      "${o.text}"  at ${o.x},${o.y} size ${o.w}×${o.h}`);
    if (r.offscreen.length > 6) console.log(`      … and ${r.offscreen.length - 6} more`);
    for (const o of r.cramped.slice(0, 4))
      console.log(`      TIGHT    "${o.text}"  ${o.margin} px from an edge`);
    await page.close();
  }
}

console.log(
  `\n${problems} overlap or off-screen problem${problems === 1 ? "" : "s"} across ` +
    `${SIZES.length} sizes and ${screens.length} screens.`
);
await browser.close();
