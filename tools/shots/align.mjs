// Alignment and padding.
//
//   npm run dev
//   node tools/shots/align.mjs
//
// tools/shots/gutters.mjs measures the space BETWEEN things: overlaps,
// run-off, margins. This measures two different faults that a gutter
// check cannot see, because in both of them everything is comfortably
// apart and the layout still looks wrong.
//
//   ALIGNMENT   Two panels whose left edges are 3 px apart. Nobody
//               chose 3 px. Either they were meant to line up and do
//               not, or they were meant to be clearly apart and are
//               not — and at 3 px the eye reads it as a mistake either
//               way, without being able to say what is wrong.
//
//   PADDING     A plate with 16 px of breathing room beside one with
//               14. Same problem, one level down: a layout reads as
//               considered when its internal spacing comes from a small
//               vocabulary of values, and as sloppy when every panel has
//               its own.
//
// THE WHOLE TRICK IS FLAGGING NEAR-MISSES, NOT DIFFERENCES.
//
// A tool that reported every pair of unequal edges would report a
// correct layout as thousands of faults, and nobody would run it twice.
// Two elements at x=16 and x=64 are deliberately different. Two at
// x=16 and x=18 are a bug. So the report is: values that are CLOSE but
// not EQUAL, which is the signature of a mistake rather than a decision.
//
// Padding is read from the computed style rather than inferred from
// where the glyphs landed. That distinction is the difference between
// this tool being useful and it being noise: a glyph box excludes the
// ascent and descent the line box reserves, so two panels with identical
// CSS padding measure differently as soon as their font sizes differ,
// and an inferred measurement reports the typography as a fault.

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

/** Two values this close, without being equal, are a mistake. */
const NEAR = 4;
/** Below this they are the same value and the difference is rounding. */
const SAME = 0.75;

const SIZES = [
  { name: "phone portrait", w: 390, h: 844 },
  { name: "desktop", w: 1600, h: 900 },
];

const screens = [
  { name: "menu", go: async () => {} },
  {
    name: "garage",
    go: async (page) => {
      await page.click("text=GARAGE");
      await page.waitForTimeout(700);
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
            (e) =>
              e.textContent === "km/h" &&
              e.checkVisibility({ opacityProperty: true, visibilityProperty: true })
          ),
        null,
        { timeout: 60000 }
      );
      await page.waitForTimeout(400);
    },
  },
];

const COLLECT = `(() => {
  const vis = (e) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });

  // ONE pass for the glyph boxes, then assign them to panels by
  // containment. The first version walked every descendant of every
  // candidate panel, which is quadratic in the size of the tree — on
  // this HUD it did not finish. The boxes do not change between panels,
  // so there is no reason to find them more than once.
  const texts = [];
  {
    const range = document.createRange();
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim()) continue;
      const parent = n.parentElement;
      if (!parent || !vis(parent)) continue;
      range.selectNodeContents(n);
      for (const b of range.getClientRects()) {
        if (b.width < 0.5 || b.height < 0.5) continue;
        texts.push({ l: b.left, t: b.top, r: b.right, b: b.bottom });
      }
    }
  }
  if (!texts.length) return [];

  // Panels: something with a visible surface of its own. Padding is
  // measured against walls, and a bare <div> has none.
  const panels = [];
  for (const el of document.querySelectorAll("div,section,aside,header,footer")) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    const hasBg = cs.backgroundImage !== "none" ||
      (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent");
    const hasBorder = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
    if (!hasBg && !hasBorder) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 40 || b.height < 20) continue;
    // A full-bleed backdrop is not a panel, it is the screen.
    if (b.width >= innerWidth - 2 && b.height >= innerHeight - 2) continue;

    // Only panels that actually contain words — an empty decorative
    // surface has no padding worth having an opinion about.
    let holdsText = false;
    for (const t of texts) {
      if (t.l >= b.left - 0.5 && t.r <= b.right + 0.5 &&
          t.t >= b.top - 0.5 && t.b <= b.bottom + 0.5) { holdsText = true; break; }
    }
    if (!holdsText) continue;

    // Padding read as PADDING, not inferred from where the glyphs landed.
    //
    // The first version measured from the panel's box to the box of the
    // text inside it, which is the right measurement for a gutter and
    // the wrong one for this. A glyph box is not a content box: it
    // excludes the ascent and descent the line box reserves, so two
    // panels with byte-identical CSS padding measure differently the
    // moment their font sizes differ. The tool duly reported "16 px and
    // 17 px, 1.0 px apart" as a fault dozens of times, and every one of
    // them was typography rather than a padding decision. Padding is a
    // property; ask for the property.
    panels.push({
      cls: (el.className || "").toString().slice(0, 56),
      box: { l: b.left, t: b.top, r: b.right, b: b.bottom },
      pad: {
        l: parseFloat(cs.paddingLeft) || 0,
        t: parseFloat(cs.paddingTop) || 0,
        r: parseFloat(cs.paddingRight) || 0,
        b: parseFloat(cs.paddingBottom) || 0,
      },
      area: b.width * b.height,
    });
  }

  // Keep the innermost panel around any given text, or one panel's
  // padding is reported once per ancestor that also has a background.
  panels.sort((a, b) => a.area - b.area);
  const kept = [];
  for (const p of panels) {
    const wraps = kept.some(
      (q) =>
        q.box.l >= p.box.l - 1 && q.box.r <= p.box.r + 1 &&
        q.box.t >= p.box.t - 1 && q.box.b <= p.box.b + 1
    );
    if (!wraps) kept.push(p);
  }
  return kept;
})()`;

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});

/** Values that are close but not equal — the signature of a mistake. */
function nearMisses(values) {
  const v = [...values].sort((a, b) => a.v - b.v);
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const d = v[i].v - v[i - 1].v;
    if (d > SAME && d <= NEAR) out.push({ a: v[i - 1], b: v[i], d });
  }
  return out;
}

let problems = 0;
for (const size of SIZES) {
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
  await page.waitForTimeout(1500);

  for (const screen of screens) {
    // Progress on stderr. Booting this game headless takes the best part
    // of a minute per window size, and a tool that prints nothing until
    // the end is indistinguishable from a hung one — which is exactly
    // how the first two runs of this were read.
    console.error(`  ${size.name} / ${screen.name} ...`);
    try {
      await screen.go(page);
    } catch (e) {
      console.error(`  ${size.name} / ${screen.name} unreachable: ${String(e).slice(0, 80)}`);
      continue; // a screen that is not reachable at this size is not a fault
    }
    const panels = await page.evaluate(COLLECT);
    if (!panels.length) continue;

    // --- Padding vocabulary, HORIZONTAL and VERTICAL kept apart.
    //
    // Pooling all four sides was wrong and it showed immediately: a
    // panel with px-3.5 py-2.5 has 14 px at the sides and 10 at the top,
    // and pooling reported its own two paddings as a 4 px near-miss.
    // That is not a mistake, it is the panel being wider than it is tall
    // — which is what nearly every panel is. The two axes are separate
    // vocabularies and only compare within themselves.
    const horiz = [];
    const vert = [];
    for (const p of panels) {
      for (const side of ["l", "r"]) horiz.push({ v: Math.round(p.pad[side] * 10) / 10, who: `${p.cls}:${side}` });
      for (const side of ["t", "b"]) vert.push({ v: Math.round(p.pad[side] * 10) / 10, who: `${p.cls}:${side}` });
    }
    const padValues = [...horiz, ...vert];
    const padMiss = [...nearMisses(horiz), ...nearMisses(vert)];

    // --- Edge alignment: left edges, then right edges
    const lefts = panels.map((p) => ({ v: Math.round(p.box.l * 10) / 10, who: p.cls }));
    const rights = panels.map((p) => ({ v: Math.round(p.box.r * 10) / 10, who: p.cls }));
    const edgeMiss = [...nearMisses(lefts), ...nearMisses(rights)];

    const vocab = [...new Set(padValues.map((x) => x.v))].sort((a, b) => a - b);
    console.log(
      `\n${size.name.padEnd(15)} ${screen.name.padEnd(10)} ${panels.length} panels, ` +
      `${vocab.length} distinct padding values`
    );
    if (padMiss.length) {
      problems += padMiss.length;
      for (const m of padMiss.slice(0, 4)) {
        console.log(
          `  padding   ${m.a.v} px and ${m.b.v} px — ${m.d.toFixed(1)} px apart` +
          `\n            ${m.a.who}\n            ${m.b.who}`
        );
      }
      if (padMiss.length > 4) console.log(`  padding   ...and ${padMiss.length - 4} more`);
    }
    if (edgeMiss.length) {
      problems += edgeMiss.length;
      for (const m of edgeMiss.slice(0, 4)) {
        console.log(
          `  edges     ${m.a.v} px and ${m.b.v} px — ${m.d.toFixed(1)} px apart` +
          `\n            ${m.a.who}\n            ${m.b.who}`
        );
      }
      if (edgeMiss.length > 4) console.log(`  edges     ...and ${edgeMiss.length - 4} more`);
    }
    if (!padMiss.length && !edgeMiss.length) console.log("  nothing within a hair of aligning");
  }
  await page.close();
}

console.log(
  problems
    ? `\n${problems} near-miss(es). Each is two values close enough that nobody chose the gap:\n` +
      `either make them equal or make them clearly different.`
    : "\nevery edge either lines up or is plainly apart, and the padding comes from one vocabulary"
);
await browser.close();
process.exit(problems ? 1 : 0);
