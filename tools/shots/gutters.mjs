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
// and measures the boxes the GLYPHS occupy rather than the boxes their
// elements do. That distinction is most of the difference between this
// tool and a tool that cries wolf: a full-width row whose only text is a
// label at the left has a box across the whole screen, and a display
// face set with tight leading has line boxes that overlap by design
// while its letters never come near each other.
//
// Then it asks three questions:
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

  // elementFromPoint answers a question about POINTERS, not about
  // pixels: it skips anything with pointer-events:none, and a game HUD
  // is pointer-events:none from end to end so the player can steer
  // through it. Asking it straight reported the entire race HUD — every
  // gauge, the speed, the gear — as hidden behind the canvas, so the one
  // screen this tool exists for measured zero elements and passed.
  // Pointer-events do not affect layout, so turning them all on for the
  // length of the measurement makes the hit test answer about the
  // visual stack, which is the question.
  const shim = document.createElement("style");
  shim.textContent = "*{pointer-events:auto !important}";
  document.head.appendChild(shim);
  try {

  /** Every ancestor that clips, and whether any of them scrolls.
   *
   *  A truncating cell is overflow:hidden, and overflow:hidden clips PAINTING
   *  but not geometry: a name that ends in an ellipsis still reports
   *  client rects for the letters nobody can see. That is where "وين
   *  سبيشال overlaps NORMAL CARS" came from — a truncated car name whose
   *  invisible tail ran under the label beside it. Clipping the rects
   *  the way the browser clips the pixels is the only way to ask about
   *  what is on the screen.
   *
   *  Scrolling is tracked separately because it means something else
   *  entirely: hidden is lost, scrollable is a scroll away. */
  const clippers = (el) => {
    const out = [];
    let scrolls = false;
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const ov = cs.overflowX + " " + cs.overflowY;
      if (/hidden|clip|auto|scroll/.test(ov)) {
        out.push(n.getBoundingClientRect());
        if (/auto|scroll/.test(ov)) scrolls = true;
      }
    }
    return { boxes: out, scrolls };
  };

  /** A rect, cut down to what actually reaches the screen. Null if the
   *  clip leaves nothing of it. */
  const clip = (r, boxes) => {
    let x = r.left, y = r.top, x2 = r.right, y2 = r.bottom;
    for (const b of boxes) {
      x = Math.max(x, b.left);
      y = Math.max(y, b.top);
      x2 = Math.min(x2, b.right);
      y2 = Math.min(y2, b.bottom);
    }
    if (x2 - x < 1 || y2 - y < 1) return null;
    return { x, y, w: x2 - x, h: y2 - y };
  };

  /** The boxes the GLYPHS occupy, not the box the element occupies.
   *
   *  A gutter is the space between things you can read, and an element's
   *  bounding box is not that: a full-width flex row whose only text is
   *  a label at the left reports a box across the whole screen, so its
   *  centre lands on whatever sits in the empty middle and the hit test
   *  below rejects a label that is plainly visible. That is exactly what
   *  happened to the race HUD — eighteen live readouts, sixteen of them
   *  reported hidden, and the one screen this tool exists for measured
   *  two elements and passed.
   *
   *  A Range over the element's own text gives the inline boxes instead,
   *  one per line, sized by the font's own metrics. It is the difference
   *  between "these two boxes overlap" and "these two words overlap" —
   *  and a display face set with tight leading has line boxes that
   *  overlap by design while its letters never touch. */
  const textRects = (el, boxes) => {
    const rects = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        const c = clip(r, boxes);
        if (c) rects.push(c);
      }
      range.detach?.();
    }
    return rects;
  };

  const els = [];
  for (const el of document.querySelectorAll("body *")) {
    // checkVisibility walks the ANCESTORS. Reading the element's own
    // computed display and opacity does not: half this game's UI is a
    // live component inside a container the game has faded to zero, and
    // on the element itself every one of those reads as visible. That is
    // where "Online Hub overlaps Rival SP" came from — two screens that
    // are never on at the same time.
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
    let own = "";
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    own = own.trim();
    if (!own) continue;
    // Clipped to what the browser actually paints. Nothing left means
    // nothing on the screen — scrolled out of its panel, or truncated
    // away — and it drops out here rather than being reported as an
    // overlap with whatever its invisible tail runs under.
    const { boxes, scrolls } = clippers(el);
    const rects = textRects(el, boxes);
    if (!rects.length) continue;

    // And is it actually the thing under those pixels? A word behind a
    // full-screen overlay is not on screen however solid its own styles
    // are. Sampled on the glyph boxes, at three points across each,
    // because a letter's own gap can miss on a single one.
    let seen = false;
    for (const r of rects) {
      for (const fx of [0.5, 0.15, 0.85]) {
        const px = Math.min(vw - 1, Math.max(0, r.x + r.w * fx));
        const py = Math.min(vh - 1, Math.max(0, r.y + r.h * 0.5));
        const hit = document.elementFromPoint(px, py);
        if (hit && (hit === el || el.contains(hit) || hit.contains(el))) { seen = true; break; }
      }
      if (seen) break;
    }
    if (!seen) continue;

    els.push({
      text: own.replace(/\\s+/g, " ").slice(0, 28),
      tag: el.tagName.toLowerCase(),
      rects,
      scrolls,
      el,
    });
  }

  const out = { vw, vh, count: els.length, offscreen: [], cramped: [], overlaps: [] };
  for (const a of els) {
    // A word in a scrolling panel is a scroll away, not lost. The edge
    // questions are for layout that has nowhere else to go.
    if (a.scrolls) continue;
    const off = a.rects.find((r) =>
      r.x < -1 || r.y < -1 || r.x + r.w > vw + 1 || r.y + r.h > vh + 1
    );
    if (off) {
      out.offscreen.push({ text: a.text, x: Math.round(off.x), y: Math.round(off.y),
        w: Math.round(off.w), h: Math.round(off.h) });
      continue;
    }
    let m = Infinity;
    for (const r of a.rects) {
      m = Math.min(m, r.x, r.y, vw - (r.x + r.w), vh - (r.y + r.h));
    }
    if (m < ${EDGE}) out.cramped.push({ text: a.text, margin: Math.round(m) });
  }
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      let worst = null;
      for (const ra of a.rects) {
        for (const rb of b.rects) {
          const ox = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
          const oy = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
          if (ox > ${SLOP} && oy > ${SLOP} && (!worst || ox * oy > worst.ox * worst.oy)) {
            worst = { ox, oy };
          }
        }
      }
      if (worst) {
        out.overlaps.push({ a: a.text, b: b.text, ox: Math.round(worst.ox), oy: Math.round(worst.oy) });
      }
    }
  }
  return out;
  } finally {
    shim.remove();
  }
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
