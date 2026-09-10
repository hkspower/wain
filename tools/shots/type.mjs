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

    // FLUID vs STATIC — two type systems, and only one of them has a
    // scale.
    //
    // The HUD's instruments size their own type from the gauge: the
    // gear reads fontSize: size * 0.125, the rev counter's unit is
    // fontSize 7 inside a 100-unit viewBox. Those are PROPORTIONS of a
    // dial, and they must scale with the dial — a tachometer whose
    // legend snapped to a 16px UI step would have the legend grow
    // relative to the face every time the face shrank.
    //
    // Measured against the static scale they land on arbitrary values
    // (14.82px, 25px) and look exactly like somebody hand-typing sizes,
    // which is the one thing the STEPS check below is for. So they are
    // marked here and counted separately. An inline font-size or an SVG
    // text node is the whole of the rule, because those are the only
    // two ways this project sets type from a measurement.
    const fluid = !!(el.style && el.style.fontSize) || el.ownerSVGElement != null ||
      el.tagName.toLowerCase() === "text";
    rows.push({
      text: raw.trim().slice(0, 34),
      fg: hex(fg),
      bg: hex(bg),
      path,
      fluid,
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

// Screens the walk could not get to. A screen that times out reports one
// line and then leaves no trace in any of the four findings, so the
// summary below reads exactly like a clean sweep of everything — see the
// note by the count.
const unreached = [];
for (const size of SIZES) {
  for (const s of screens) {
    let page = await browser.newPage({ viewport: { width: size.w, height: size.h } });
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
    // One retry, on a fresh page.
    //
    // The race HUD boots a WebGL scene, and on the software rasteriser
    // this runs on that is minutes of solid CPU. Measured alone it is up
    // in ten seconds; measured while another browser is grinding through
    // a render sweep it can miss a four-minute deadline. A screen that
    // drops out of the walk for that reason takes its whole type census
    // with it and turns four clean findings into four unknowns, so it is
    // worth one more attempt before believing it.
    let reached = false;
    for (let attempt = 0; attempt < 2 && !reached; attempt++) {
      try {
        await s.go(page);
        reached = true;
      } catch (e) {
        if (attempt === 0) {
          console.log(`${size.name} / ${s.name}: timed out, retrying once`);
          await page.close();
          page = await browser.newPage({ viewport: { width: size.w, height: size.h } });
          page.setDefaultTimeout(240000);
          page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
          await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
          await page.evaluate(() => {
            localStorage.clear();
            localStorage.setItem("gulf-road-nights-onboarded", "2");
            localStorage.setItem("gulf-road-nights-coach", "3");
          });
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForSelector("text=START ENGINE", { timeout: 120000 });
          await page.evaluate(() => document.fonts.ready);
          continue;
        }
        console.log(`${size.name} / ${s.name}: could not reach it — ${e.message.split("\n")[0]}`);
        unreached.push(`${size.name} / ${s.name}`);
      }
    }
    if (!reached) { await page.close(); continue; }
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
const staticRuns = all.filter((r) => !r.fluid);
const fluidRuns = all.filter((r) => r.fluid);
for (const r of staticRuns) byPx.set(r.px, (byPx.get(r.px) || 0) + 1);
const scale = [...byPx.entries()].sort((a, b) => a[0] - b[0]);
// COUNT WHAT WAS WALKED, NOT WHAT WAS PLANNED.
//
// This said `SIZES.length * screens.length` — the number of screens the
// tool INTENDED to visit — and printed it whether or not it got to any of
// them. The race HUD timed out at both sizes and this line still claimed
// six combinations, above a report of 0 tiny, 0 tracked and 0 crammed.
// Every one of those zeroes was true of the four screens it reached and
// unknown of the two it did not, and nothing in the output said which.
//
// The HUD is the screen with the most type on it and the only one a
// player reads at speed, so "could not reach it" is the most serious
// thing this tool can say, not a note in passing. It is a failure now.
const planned = SIZES.length * screens.length;
const walked = planned - unreached.length;
console.log(
  `\n${all.length} runs of text across ${walked} of ${planned} screen/size combinations` +
    (unreached.length ? ` — NOT MEASURED: ${unreached.join(", ")}` : "") +
    `\n`
);
// THE SCALE, CLUSTERED — because 41 was never 41 decisions.
//
// This used to print every distinct FLOAT it measured and call the count
// "distinct sizes". It read 41, which sounds like an interface with no
// scale at all. It is not: 11.14 / 11.19 / 11.2 / 11.46 / 11.51 / 11.52
// are one authored size seen through rem rounding, a 0.96 panel scale
// and two viewport widths. Counting them separately turns rounding noise
// into a design finding, and buries the real one underneath it.
//
// Grouped at 4%, the same measurements are eleven sizes. THAT is the
// scale, and it is where the actual fault lives: two steps in it are
// too small to be steps.
const CLUSTER = 1.04;
/** A step below this ratio is not a step — see the note under STEPS. */
const MIN_STEP = 1.08;
const clusters = [];
for (const [px, n] of scale) {
  const last = clusters[clusters.length - 1];
  // Anchored on the cluster's FIRST value, not its last.
  //
  // Chaining on the running maximum lets a cluster walk: 11.18 admits
  // 11.46, which admits 11.9, which admits 12.16, and a group whose
  // members are each within 4% of a neighbour spans 8.8% end to end. It
  // swallowed a genuine step — 11.5 and 12 are different sizes — and
  // whether it did so depended on whether the intermediate values
  // happened to be on screen that run. One walk reported eleven values
  // in that cluster and no step; the next, with one screen missing,
  // reported two clusters and a step. Same interface, same stylesheet,
  // opposite findings.
  if (last && px <= last.lo * CLUSTER) {
    last.hi = px;
    last.n += n;
    last.values.push(px);
  } else {
    clusters.push({ lo: px, hi: px, n, values: [px] });
  }
}
// The size a cluster IS: the value most of its runs are actually set at,
// not the midpoint of a range that only exists because of rounding.
for (const c of clusters) {
  let best = null;
  for (const v of c.values) {
    const n = byPx.get(v) || 0;
    if (!best || n > best.n) best = { px: v, n };
  }
  c.px = best.px;
}
console.log("THE SCALE — static type, grouped at 4% (rounding is not a decision)");
for (const c of clusters) {
  const spread = c.values.length > 1 ? ` (${c.lo}–${c.hi}, ${c.values.length} values)` : "";
  console.log(`  ${String(c.px).padStart(6)}px  ${String(c.n).padStart(3)} runs${spread}`);
}
console.log(
  `  ${clusters.length} sizes from ${scale.length} measured values; ` +
    `${scale.filter(([p]) => p < MIN_PX).length} below ${MIN_PX}px`
);

// The instrument type, listed rather than scored. It has no scale to be
// off, but it should not be invisible either — a gauge legend that has
// drifted to a tenth of its dial is still worth being able to see.
if (fluidRuns.length) {
  const fl = new Map();
  for (const r of fluidRuns) fl.set(r.px, (fl.get(r.px) || 0) + 1);
  console.log(
    `  fluid (sized from an instrument, not from the scale): ` +
      [...fl.entries()].sort((a, b) => a[0] - b[0]).map(([px, n]) => `${px}px x${n}`).join("  ")
  );
}

// ---- STEPS: sizes too close together to be different ----------------
//
// A type scale works because its steps are big enough to SEE. Two sizes
// 4% apart are not a large and a small — they are one size that two
// people set slightly differently, and every screen carrying both looks
// subtly misaligned without anything being identifiably wrong. This is
// the fault the raw list of 41 floats was hiding.
const steps = [];
for (let i = 1; i < clusters.length; i++) {
  const ratio = clusters[i].px / clusters[i - 1].px;
  if (ratio < MIN_STEP) steps.push({ a: clusters[i - 1], b: clusters[i], ratio });
}
console.log("");
console.log(`STEPS — sizes closer than ${Math.round((MIN_STEP - 1) * 100)}% apart: ${steps.length}`);
for (const st of steps) {
  console.log(
    `    ${st.a.px}px and ${st.b.px}px are ${((st.ratio - 1) * 100).toFixed(1)}% apart` +
      `  (${st.a.n} and ${st.b.n} runs)`
  );
  // Name them, or there is no way to act on the finding.
  for (const c of [st.a, st.b]) {
    const ex = staticRuns.filter((r) => c.values.includes(r.px)).slice(0, 3);
    for (const r of ex) {
      console.log(`      ${String(c.px).padStart(6)}px  ${r.screen.padEnd(7)} ${JSON.stringify(r.text.slice(0, 34))}  ${r.path ?? ""}`.slice(0, 190));
    }
  }
}

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
  measured: scale.map(([px, n]) => ({ px, n })),
  scale: clusters.map((c) => ({ px: c.px, n: c.n, values: c.values })),
  steps: steps.map((s) => ({ a: s.a.px, b: s.b.px, ratio: +s.ratio.toFixed(3) })),
  unreached,
  tiny, faint, tracked, crammed,
}, null, 2));

const fails = [];
// An unreachable screen is a failure, not a footnote. Nothing else in
// this report distinguishes "no bad type here" from "never looked".
if (unreached.length)
  fails.push(`${unreached.length} screen/size combination(s) never measured: ${unreached.join(", ")}`);
if (steps.length)
  fails.push(
    `${steps.length} pair(s) of sizes closer than ${Math.round((MIN_STEP - 1) * 100)}% — ` +
      steps.map((s) => `${s.a.px}/${s.b.px}`).join(", ")
  );
if (tiny.length) fails.push(`${tiny.length} runs of text below ${MIN_PX}px`);
if (faint.length) fails.push(`${faint.length} runs under the contrast floor`);
if (tracked.length) fails.push(`${tracked.length} runs of Arabic with letter-spacing on them`);
if (crammed.length) fails.push(`${crammed.length} wrapped runs set tighter than ${CRAMP}`);
console.log("");
console.log(fails.length ? `FAILURES:\n - ${fails.join("\n - ")}` : "every screen was walked, and every run of text is legible, contrasty and set on a scale");
console.log("\npress/type/type.json");
process.exit(fails.length ? 1 : 0);
