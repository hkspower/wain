// The type, as it is actually set on screen.
//
//   npm run dev
//   node tools/shots/type.mjs
//
// "Improve the text style" is not answerable from the stylesheet. A
// Tailwind class says 0.55rem; what reaches the eye depends on the root
// size, on whatever scale the panel is under, on which family in the
// stack actually had the glyph, and on what colour it ended up against.
// So this walks every visible run of text on every screen and reports
// what the browser computed, not what the source asked for.
//
// WHAT IS FLAGGED, and why each one is a defect rather than a taste:
//
//   tiny     rendered below MIN_PX. This is a game played on a phone
//            held at arm's length and on a monitor across a desk, not a
//            spreadsheet. Below about eleven pixels the counters of a
//            condensed face close up and the text becomes a texture
//            that means "there is information here" without delivering
//            any of it.
//   faint    contrast below the WCAG floor for its size — 4.5:1 for
//            body, 3:1 once the text is large or bold. Measured against
//            the colour actually behind it, walked up the ancestor
//            chain until something opaque is found, because a panel with
//            a translucent tint over a dark scene is not the colour its
//            own background property claims.
//   tracked  letter-spacing on Arabic. Arabic is cursive: the letters
//            join, and spacing them apart does not letterspace the word,
//            it BREAKS it into disconnected glyphs. This is the one
//            typographic error in this project that is not a matter of
//            degree — it is either wrong or it is not there.
//   crammed  line-height below CRAMP on text that actually wrapped.
//            Single-line text can be set solid; a wrapped paragraph at
//            1.1 has ascenders touching descenders.
//
// It also reports the SCALE: every distinct rendered size, with a count.
// That is the number that says whether this interface has a type scale
// or just has sizes. Fifteen sizes between 8 and 13 pixels are not
// fifteen decisions, they are one decision made fifteen times by hand.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

/** The floor for anything a player is expected to read. */
const MIN_PX = 11;
/** Below this, a wrapped paragraph is touching itself. */
const CRAMP = 1.15;

const SIZES = [
  { name: "phone portrait", w: 390, h: 844 },
  { name: "desktop", w: 1600, h: 900 },
];

// Every screen from a fresh load — the same lesson align.mjs paid for:
// the garage and the race are branches off the menu, not steps through
// it, so walking them in sequence measures whatever is left on screen
// rather than the screen named.
const screens = [
  { name: "menu", go: async () => {} },
  {
    name: "garage",
    go: async (page) => {
      await page.click("text=GARAGE");
      await page.waitForTimeout(900);
    },
  },
  {
    name: "race HUD",
    go: async (page) => {
      await page.click("text=START ENGINE");
      await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.__grnEngine?.skipCinematic?.());
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("span,div")].some(
            (e) => e.textContent === "km/h" &&
              e.checkVisibility({ opacityProperty: true, visibilityProperty: true })
          ),
        null,
        { timeout: 60000 }
      );
      await page.waitForTimeout(600);
    },
  },
];

const COLLECT = `(() => {
  const vis = (e) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const ARABIC = /[\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF]/;

  const parse = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const relLum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  // The colour actually behind a run of text. A panel is very often a
  // translucent tint over a dark scene, so its own background-color is
  // not what the eye sees; composite up the ancestors until the stack is
  // opaque, and fall back to the page's own base.
  const behind = (el) => {
    let acc = null;
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (!c || c.a === 0) continue;
      acc = acc ? over(acc, c) : c;
      if (acc.a >= 0.999) return acc;
    }
    const base = { r: 8, g: 8, b: 10, a: 1 };
    return acc ? over(acc, base) : base;
  };

  const rows = [];
  const range = document.createRange();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const raw = n.textContent;
    if (!raw || !raw.trim()) continue;
    const el = n.parentElement;
    if (!el || !vis(el)) continue;
    range.selectNodeContents(n);
    const boxes = [...range.getClientRects()].filter((b) => b.width > 0.5 && b.height > 0.5);
    if (!boxes.length) continue;

    const cs = getComputedStyle(el);
    // The rendered size has to include any transform scale sitting over
    // the element — a HUD at 1.22 is not the size its font-size says.
    let scale = 1;
    for (let p = el; p; p = p.parentElement) {
      const t = getComputedStyle(p).transform;
      if (t && t !== "none") {
        const m = t.match(/matrix\\(([^)]+)\\)/);
        if (m) {
          const v = m[1].split(",").map(Number);
          const sx = Math.hypot(v[0], v[1]);
          if (sx > 0) scale *= sx;
        }
      }
    }
    const px = parseFloat(cs.fontSize) * scale;
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const lhRaw = cs.lineHeight;
    const lh = lhRaw === "normal" ? 1.2 : parseFloat(lhRaw) / parseFloat(cs.fontSize);
    const tracking = cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing);

    const fg0 = parse(cs.color) || { r: 255, g: 255, b: 255, a: 1 };
    const bg = behind(el);
    const fg = fg0.a < 1 ? over(fg0, bg) : fg0;
    const L1 = relLum(fg), L2 = relLum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);

    // WCAG's own definition of large: 24px, or 18.66px when bold.
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const floor = large ? 3 : 4.5;
    const arabic = ARABIC.test(raw);
    // Did it wrap? More than one client rect for one text node, or a box
    // taller than roughly one line.
    const wrapped = boxes.length > 1 || boxes[0].height > px * lh * 1.6;

    rows.push({
      text: raw.trim().slice(0, 34),
      px: +px.toFixed(2),
      weight,
      lh: +lh.toFixed(2),
      tracking: +tracking.toFixed(2),
      family: cs.fontFamily.split(",")[0].replace(/["']/g, "").slice(0, 22),
      transform: cs.textTransform,
      ratio: +ratio.toFixed(2),
      floor,
      arabic,
      wrapped,
      tiny: px < ${MIN_PX},
      faint: ratio < floor,
      tracked: arabic && tracking > 0.01,
      crammed: wrapped && lh < ${CRAMP},
    });
  }
  return rows;
})()`;

const all = [];
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--force-color-profile=srgb"],
});

for (const size of SIZES) {
  for (const s of screens) {
    const page = await browser.newPage({ viewport: { width: size.w, height: size.h } });
    page.setDefaultTimeout(240000);
    page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
    await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("gulf-road-nights-onboarded", "2");
      localStorage.setItem("gulf-road-nights-coach", "3");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=START ENGINE", { timeout: 120000 });
    await page.evaluate(() => document.fonts.ready);
    try {
      await s.go(page);
    } catch (e) {
      console.log(`${size.name} / ${s.name}: could not reach it — ${e.message.split("\n")[0]}`);
      await page.close();
      continue;
    }
    await page.evaluate(() => document.fonts.ready);
    const rows = await page.evaluate(COLLECT);
    for (const r of rows) all.push({ ...r, screen: s.name, size: size.name });
    await page.close();
  }
}
await browser.close();

if (!all.length) { console.error("no text was measured — the walk found nothing"); process.exit(2); }

// ---- the scale ----------------------------------------------------
const byPx = new Map();
for (const r of all) byPx.set(r.px, (byPx.get(r.px) || 0) + 1);
const scale = [...byPx.entries()].sort((a, b) => a[0] - b[0]);
console.log(`\n${all.length} runs of text across ${SIZES.length * screens.length} screen/size combinations\n`);
console.log("THE SCALE — every distinct rendered size");
let line = "";
for (const [px, n] of scale) {
  const cell = `${px}px x${n}`.padEnd(14);
  line += cell;
  if (line.length >= 84) { console.log("  " + line); line = ""; }
}
if (line) console.log("  " + line);
console.log(`  ${scale.length} distinct sizes; ${scale.filter(([p]) => p < MIN_PX).length} of them below ${MIN_PX}px`);

// ---- the faults ---------------------------------------------------
const fault = (k) => all.filter((r) => r[k]);
const uniq = (rows, extra) => {
  const seen = new Map();
  for (const r of rows) {
    const key = `${r.text}|${r.px}|${r.screen}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()].sort(extra);
};

const tiny = uniq(fault("tiny"), (a, b) => a.px - b.px);
const faint = uniq(fault("faint"), (a, b) => a.ratio - b.ratio);
const tracked = uniq(fault("tracked"), (a, b) => b.tracking - a.tracking);
const crammed = uniq(fault("crammed"), (a, b) => a.lh - b.lh);

const show = (name, rows, fmt, limit = 12) => {
  console.log(`\n${name}: ${rows.length}`);
  for (const r of rows.slice(0, limit)) console.log("  " + fmt(r));
  if (rows.length > limit) console.log(`  ...and ${rows.length - limit} more`);
};

show(`TINY — set below ${MIN_PX}px`, tiny,
  (r) => `${String(r.px).padStart(6)}px  ${r.screen.padEnd(9)} ${r.size.padEnd(15)} "${r.text}"`);
show("FAINT — under the contrast floor for its size", faint,
  (r) => `${String(r.ratio).padStart(6)}:1 (needs ${r.floor}) ${String(r.px).padStart(5)}px ${r.screen.padEnd(9)} "${r.text}"`);
show("TRACKED — letter-spacing on cursive Arabic", tracked,
  (r) => `${String(r.tracking).padStart(6)}px  ${r.screen.padEnd(9)} "${r.text}"`);
show("CRAMMED — wrapped text set tighter than " + CRAMP, crammed,
  (r) => `${String(r.lh).padStart(6)}    ${String(r.px).padStart(5)}px ${r.screen.padEnd(9)} "${r.text}"`);

mkdirSync("press/type", { recursive: true });
writeFileSync("press/type/type.json", JSON.stringify({
  scale: scale.map(([px, n]) => ({ px, n })),
  tiny, faint, tracked, crammed,
}, null, 2));

const fails = [];
if (tiny.length) fails.push(`${tiny.length} runs of text below ${MIN_PX}px`);
if (faint.length) fails.push(`${faint.length} runs under the contrast floor`);
if (tracked.length) fails.push(`${tracked.length} runs of Arabic with letter-spacing on them`);
if (crammed.length) fails.push(`${crammed.length} wrapped runs set tighter than ${CRAMP}`);
console.log("");
console.log(fails.length ? `FAILURES:\n - ${fails.join("\n - ")}` : "every run of text is legible, contrasty and set on a scale");
console.log("\npress/type/type.json");
process.exit(fails.length ? 1 : 0);
