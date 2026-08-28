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

  // Colour is resolved by the browser, not by a regex here.
  //
  // The first version matched /rgba?\\(...\\)/ and silently returned null
  // for anything else. This project is on Tailwind v4, so getComputedStyle
  // hands back oklch() and oklab() — every parse failed, the text fell
  // back to white, the background fell through the translucent header to
  // the white body, and the tool reported forty-two runs of white on
  // white at exactly 1.00:1. A contrast of exactly 1.00 is not a finding,
  // it is a parser that gave up.
  //
  // A 1x1 canvas has the whole CSS colour engine behind it and composites
  // alpha correctly for free, which is also exactly what is needed to
  // stack translucent panels over a scene.
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const g2 = cv.getContext("2d", { willReadFrequently: true });
  const flatten = (stack, base) => {
    g2.globalCompositeOperation = "copy";
    g2.fillStyle = base;
    g2.fillRect(0, 0, 1, 1);
    g2.globalCompositeOperation = "source-over";
    for (const c of stack) {
      if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") continue;
      // An unparseable colour leaves fillStyle at its previous value,
      // which would paint the last layer twice and call it a new one.
      g2.fillStyle = "#000000";
      g2.fillStyle = c;
      if (g2.fillStyle === "#000000" && !/^(#000000|black|rgb\\(0, ?0, ?0\\))$/i.test(c.trim())) continue;
      g2.fillRect(0, 0, 1, 1);
    }
    const d = g2.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const relLum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);

  // Everything painted behind a run of text, outermost first. A panel is
  // very often a translucent tint over a dark scene, so its own
  // background-color is not what the eye receives.
  //
  // background-COLOR alone is not what is painted. The call to action in
  // this game is a sodium gradient with near-black text on it, and a
  // walk that reads only background-color sees a transparent button over
  // a dark page: it reported #140d02 on #060608, 1.05:1, three times, on
  // the most legible control on the screen. A gradient is a paint like
  // any other, so it goes on the stack — and a gradient is judged at
  // whichever of its stops gives the text the LEAST contrast, because
  // that end of the button is as real as the other.
  const GRAD_COLOR = /(?:rgba?|oklch|oklab|hsla?|lab|lch)\\([^()]*\\)|#[0-9a-f]{3,8}/gi;
  const stackOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs2 = getComputedStyle(n);
      const bi = cs2.backgroundImage || "";
      layers.push({
        bg: cs2.backgroundColor,
        stops: bi.includes("gradient") ? bi.match(GRAD_COLOR) || [] : [],
      });
    }
    return layers.reverse();
  };
  /** Every paint stack this text could be sitting on: one per stop of
   *  the gradient nearest the text, which is the one painting over the
   *  rest. Elsewhere a gradient contributes its first stop — a distant
   *  ancestor's gradient is under everything else anyway. */
  const stackVariants = (layers) => {
    let at = -1;
    for (let i = layers.length - 1; i >= 0; i--) if (layers[i].stops.length > 1) { at = i; break; }
    const plain = (l) => (l.stops.length ? [l.bg, l.stops[0]] : [l.bg]);
    if (at < 0) return [layers.flatMap(plain)];
    return layers[at].stops.map((stop) =>
      layers.flatMap((l, i) => (i === at ? [l.bg, stop] : plain(l)))
    );
  };
  const rootBase = (() => {
    for (const n of [document.body, document.documentElement]) {
      const c = n && getComputedStyle(n).backgroundColor;
      if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
    }
    return "#ffffff";
  })();

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
    // What size this actually lands at on the glass.
    //
    // Two things move it and both had to be handled. A HUD panel under
    // transform: scale(1.22) is not the size its font-size claims. And
    // SVG is worse: the tachometer is drawn in a 100x100 viewBox scaled
    // to its container, so its unit label is authored fontSize="5" and
    // getComputedStyle dutifully reports 5px — a number in USER units
    // that has no bearing on the screen. Reporting that as "5px text"
    // would have been a fabricated finding. getScreenCTM is the map from
    // user units to CSS pixels and already carries every transform above
    // it, so for SVG it replaces the walk rather than adding to it.
    let px;
    if (el.ownerSVGElement && el.getScreenCTM) {
      const ctm = el.getScreenCTM();
      px = parseFloat(cs.fontSize) * (ctm ? Math.hypot(ctm.a, ctm.b) : 1);
    } else {
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
      px = parseFloat(cs.fontSize) * scale;
    }
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const lhRaw = cs.lineHeight;
    const lh = lhRaw === "normal" ? 1.2 : parseFloat(lhRaw) / parseFloat(cs.fontSize);
    const tracking = cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing);

    const layers = stackOf(el);
    let bg = null, fg = null, ratio = Infinity;
    for (const stack of stackVariants(layers)) {
      const b = flatten(stack, rootBase);
      const f = flatten([...stack, cs.color], rootBase);
      const L1 = relLum(f), L2 = relLum(b);
      const r = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      if (r < ratio) { ratio = r; bg = b; fg = f; }
    }

    // WCAG's own definition of large: 24px, or 18.66px when bold.
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const floor = large ? 3 : 4.5;
    const arabic = ARABIC.test(raw);
    // Did it wrap? More than one client rect for one text node — and
    // nothing else. The height test that used to sit here flagged a
    // single "0" on the speedometer as a wrapped paragraph set too
    // tight, which a one-character text node cannot be.
    const wrapped = boxes.length > 1;

    // The two colours, and where the run lives. A report that says a
    // line is at 2.51:1 and stops there is a report you have to go and
    // reproduce by hand; the colours and the DOM path are what make it
    // a thing you can fix.
    const hex = (c) => "#" + [c.r, c.g, c.b].map((v)=>v.toString(16).padStart(2,"0")).join("");
    const path = (() => {
      const parts = [];
      for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
        const cls = (n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) || "";
        const own = String(cls).split(/\\s+/).filter((c)=>c && !/^(flex|grid|block|inline|absolute|relative|w-|h-|p[xytblr]?-|m[xytblr]?-|gap-|min-|max-)/.test(c)).slice(0,3).join(".");
        parts.unshift(n.tagName.toLowerCase() + (own ? "." + own : ""));
      }
      return parts.join(" > ");
    })();

    rows.push({
      text: raw.trim().slice(0, 34),
      fg: hex(fg),
      bg: hex(bg),
      path,
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

// The instrument, against markup whose answer is known before it runs.
//
// This exists because the first version of this tool reported 42 runs of
// text failing contrast at exactly 1.00:1, and every one of them was
// invented: getComputedStyle returns oklch() on Tailwind v4, the regex
// here only matched rgb(), and the fallbacks put white text on a white
// page. It also called a tachometer label "5px" — the authored value in
// a 100x100 viewBox, not a size anything renders at. Both are the same
// mistake: believing a number without checking what it is a number OF.
async function selfTest(browser) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(
    "data:text/html," + encodeURIComponent(`
      <body style="margin:0;background:#ffffff">
        <div id="a" style="color:#000000">plain black on white</div>
        <div id="b" style="color:oklch(0 0 0)">oklch black on white</div>
        <div id="c" style="background:rgba(0,0,0,0.5)"><span style="color:#ffffff">white on a half-black tint</span></div>
        <svg viewBox="0 0 100 100" width="200" height="200">
          <text x="10" y="50" font-size="5" fill="#000">svg five</text>
        </svg>
      </body>`),
    { waitUntil: "domcontentloaded" }
  );
  const rows = await page.evaluate(COLLECT);
  await page.close();
  const find = (t) => rows.find((r) => r.text.startsWith(t));
  const fails = [];
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  const a = find("plain black");
  if (!a || !near(a.ratio, 21, 0.3)) fails.push(`black on white read ${a ? a.ratio : "nothing"}:1, expected 21:1`);
  const b = find("oklch black");
  if (!b || !near(b.ratio, 21, 0.3)) {
    fails.push(
      `oklch black on white read ${b ? b.ratio : "nothing"}:1, expected 21:1 — ` +
      `the colour engine is not resolving modern CSS colour syntax`
    );
  }
  // White over 50% black over white composites to white on rgb(128,128,128).
  const c = find("white on a half");
  if (!c || !near(c.ratio, 3.95, 0.25)) {
    fails.push(`white on a half-black tint read ${c ? c.ratio : "nothing"}:1, expected about 3.95:1 — alpha is not compositing`);
  }
  // font-size 5 in a 100-unit viewBox drawn at 200px is 10 real pixels.
  const d = find("svg five");
  if (!d || !near(d.px, 10, 0.2)) {
    fails.push(`svg text authored at 5 units in a viewBox drawn at 2x read ${d ? d.px : "nothing"}px, expected 10px`);
  }
  if (fails.length) {
    console.error("the type instrument is wrong:\n - " + fails.join("\n - "));
    process.exit(2);
  }
  console.log(
    `instrument   21:1 on black/white, resolves oklch, composites alpha to ` +
    `${c.ratio}:1, and reads svg 5-in-viewBox as ${d.px}px\n`
  );
}

const all = [];
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--force-color-profile=srgb"],
});

await selfTest(browser);
if (process.argv.includes("--self-test")) { await browser.close(); process.exit(0); }

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
  (r) => `${String(r.ratio).padStart(6)}:1 (needs ${r.floor}) ${String(r.px).padStart(5)}px ${r.fg} on ${r.bg}  ${r.screen.padEnd(9)} "${r.text}"\n${" ".repeat(12)}${r.path}`);
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
