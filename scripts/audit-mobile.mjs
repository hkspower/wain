#!/usr/bin/env node
/**
 * The site on a phone:  npm run audit:mobile   (needs npm run build)
 *
 * Kuwait browses on phones. Everything else here is measured on a phone
 * viewport already — the colour audit, the runtime audit, the journey — but
 * only for whether it *works*. This measures whether it can be *used* with a
 * thumb, one-handed, on a device that is 390 CSS pixels wide and has a notch.
 *
 * Five things, each of which is invisible on a desktop:
 *
 *   1. Anything wider than the screen. One overflowing element makes the whole
 *      page slide sideways, and the visitor blames the site, not the element.
 *   2. Tap targets under 44px. Below that a thumb misses, and the miss usually
 *      lands on something else.
 *   3. Small targets crowded together, where a miss is not a miss but a wrong
 *      action. Size and spacing trade off against each other — two comfortable
 *      44px controls four pixels apart are a segmented control, which is a
 *      pattern rather than a defect — so this only fires when one of the pair
 *      is undersized as well as close.
 *   4. Text below the palette's declared floor. globals.css sets text-2xs at
 *      11px and says "nothing on the site goes below this" — Arabic carries
 *      meaning in dots and short connecting strokes, so it has further to fall
 *      than Latin. Anything under that is improvised, not chosen.
 *   5. Inputs under 16px, which is not a readability problem: iOS Safari zooms
 *      the whole page in when you focus one, and never zooms back out.
 *
 * Two widths, because 390 is a comfortable modern phone and 320 is the floor
 * that still exists — an iPhone SE, and any phone with display zoom turned on.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = 4213;

if (!existsSync(join(OUT, "index.html"))) {
  console.error("out/ is missing — run npm run build first.");
  process.exit(1);
}

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  let f = join(OUT, p);
  if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
  if (!existsSync(f) || !f.startsWith(OUT)) { res.writeHead(404); return res.end("nope"); }
  res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));

function routes(dir = OUT, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) routes(full, acc);
    else if (name === "index.html") {
      const r = "/" + relative(OUT, dirname(full)).replace(/\\/g, "/");
      acc.push(r === "/." ? "/" : r + "/");
    }
  }
  return acc;
}
const PAGES = routes().sort().filter((r) => !r.startsWith("/places/") || r === "/places/kuwait-towers/");

/**
 * Targets that are deliberately smaller, and why.
 *
 * WCAG 2.5.8 exempts a control whose size is essential to the information it
 * conveys. A map pin is exactly that: its position *is* its meaning, so padding
 * it out to 44px would either move it off its place or bury its neighbours.
 * Everything else has to earn its size.
 */
const SMALL_BY_DESIGN = [
  { match: (el) => el.closest("[data-map-frame]") !== null, why: "a map pin — its position is its meaning (WCAG 2.5.8)" },
];

const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath: CHROMIUM });

let problems = 0;
const say = (msg) => { console.log("  ✗ " + msg); problems++; };

const WIDTHS = [
  { name: "390 (a modern phone)", width: 390, height: 844 },
  { name: "320 (an SE, or display zoom)", width: 320, height: 700 },
];

const overflow = [];
const smallTargets = new Map();
const crowded = new Map();
const smallText = new Map();
const zoomyInputs = new Map();
let elementsSeen = 0;
let targetsSeen = 0;
let hiddenTargets = 0;

for (const vp of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "ar-KW",
  });
  const page = await ctx.newPage();
  for (const url of PAGES) {
    await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);

    const found = await page.evaluate((smallByDesignCount) => {
      const out = { overflow: null, wide: [], small: [], crowded: [], text: [], inputs: [], seen: 0, targets: 0, hidden: 0 };
      const vw = document.documentElement.clientWidth;

      // 1. Does the page itself slide sideways?
      if (document.documentElement.scrollWidth > vw + 1) {
        out.overflow = { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw };
        // Name the culprits rather than the symptom.
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.position === "fixed") continue;
          // An element inside its own horizontal scroller is meant to be wide.
          let scroller = false;
          for (let n = el.parentElement; n; n = n.parentElement) {
            const o = getComputedStyle(n).overflowX;
            if (o === "auto" || o === "scroll") { scroller = true; break; }
          }
          if (scroller) continue;
          if (r.right > vw + 1 || r.left < -1) {
            out.wide.push({
              tag: el.tagName.toLowerCase(),
              cls: (el.className?.toString?.() ?? "").slice(0, 70),
              left: Math.round(r.left), right: Math.round(r.right),
            });
          }
        }
      }

      const visible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      /**
       * Hidden until focused — the skip link, and the file inputs a styled
       * button stands in for. They measure 1×1 because that is how sr-only
       * works, and reporting them as unhittable targets was this audit calling
       * correct accessibility practice a defect. Counted, not failed.
       */
      const hiddenUntilFocused = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 4 || r.height > 4) return false;
        const cs = getComputedStyle(el);
        return cs.position === "absolute" || cs.clipPath !== "none" || cs.clip !== "auto";
      };

      // 2 & 3. Tap targets.
      const targets = [...document.querySelectorAll("a[href], button, input, select, textarea, [role=button]")]
        .filter(visible)
        // A control nested inside another control is one target, not two.
        .filter((el) => !el.parentElement?.closest("a[href], button, [role=button]"));
      out.targets = targets.length;
      out.hidden = 0;
      const boxes = [];
      for (const el of targets) {
        if (hiddenUntilFocused(el)) { out.hidden++; continue; }
        const r = el.getBoundingClientRect();
        const inMap = el.closest("[data-map-frame]") !== null;
        // A fixed control floats over the page by definition — شوق's launcher
        // is *meant* to sit above whatever is scrolled under it. Measuring its
        // distance to whatever happens to be beneath it at scroll zero is
        // measuring the scroll position, not the design. What matters is that
        // the page ends with room to clear it, which is the body padding.
        const floating = getComputedStyle(el).position === "fixed" ||
          el.closest(".wain-ai-fab") !== null;
        boxes.push({ r, el, inMap, floating });
        if (inMap) continue;
        if (r.width < 44 || r.height < 44) {
          out.small.push({
            tag: el.tagName.toLowerCase(),
            label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 32),
            w: Math.round(r.width), h: Math.round(r.height),
            cls: (el.className?.toString?.() ?? "").slice(0, 60),
          });
        }
      }
      // Crowding: two separate targets whose boxes are within 8px of each other.
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          if (boxes[i].inMap || boxes[j].inMap) continue;
          if (boxes[i].floating || boxes[j].floating) continue;
          // Spacing only matters when there was not much to aim at.
          const tight = (b) => b.r.width < 44 || b.r.height < 44;
          if (!tight(boxes[i]) && !tight(boxes[j])) continue;
          const a = boxes[i].r, b = boxes[j].r;
          const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
          const dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
          if (dx === 0 && dy === 0) continue; // overlapping or nested: not crowding
          const gap = Math.hypot(dx, dy);
          if (gap > 0 && gap < 8) {
            out.crowded.push({
              a: (boxes[i].el.getAttribute("aria-label") || boxes[i].el.textContent || "").trim().slice(0, 24),
              b: (boxes[j].el.getAttribute("aria-label") || boxes[j].el.textContent || "").trim().slice(0, 24),
              gap: Math.round(gap),
            });
          }
        }
      }

      // 4. Text too small to read outdoors.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent.trim();
        if (!t) continue;
        const el = n.parentElement;
        if (!el || !visible(el)) continue;
        out.seen++;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 11) {
          out.text.push({ size: Math.round(size * 10) / 10, text: t.slice(0, 34),
            cls: (el.className?.toString?.() ?? "").slice(0, 50) });
        }
      }

      // 5. Inputs iOS will zoom into.
      for (const el of document.querySelectorAll("input, select, textarea")) {
        if (!visible(el)) continue;
        const type = (el.getAttribute("type") || "text").toLowerCase();
        if (["checkbox", "radio", "range", "file", "submit", "button", "hidden", "color"].includes(type)) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 16) {
          out.inputs.push({ type, size, name: el.getAttribute("name") || el.getAttribute("aria-label") || "" });
        }
      }
      void smallByDesignCount;
      return out;
    }, SMALL_BY_DESIGN.length);

    elementsSeen += found.seen;
    targetsSeen += found.targets;
    hiddenTargets += found.hidden;
    const at = `${url} [${vp.width}]`;
    if (found.overflow) overflow.push({ at, ...found.overflow, wide: found.wide.slice(0, 4) });
    for (const s of found.small) {
      const key = `${s.tag}|${s.label}|${s.w}x${s.h}`;
      if (!smallTargets.has(key)) smallTargets.set(key, { ...s, at, n: 0 });
      smallTargets.get(key).n++;
    }
    for (const c of found.crowded) {
      const key = `${c.a}|${c.b}|${c.gap}`;
      if (!crowded.has(key)) crowded.set(key, { ...c, at, n: 0 });
      crowded.get(key).n++;
    }
    for (const t of found.text) {
      const key = `${t.size}|${t.cls}`;
      if (!smallText.has(key)) smallText.set(key, { ...t, at, n: 0 });
      smallText.get(key).n++;
    }
    for (const i of found.inputs) {
      const key = `${i.type}|${i.size}|${i.name}`;
      if (!zoomyInputs.has(key)) zoomyInputs.set(key, { ...i, at, n: 0 });
      zoomyInputs.get(key).n++;
    }
  }
  await ctx.close();
}
await browser.close();
server.close();

console.log(`\n${PAGES.length} routes at ${WIDTHS.map((w) => w.width).join(" and ")} CSS pixels.`);
console.log(`${targetsSeen} tap targets and ${elementsSeen} text nodes measured.`);
if (hiddenTargets) console.log(`${hiddenTargets} sr-only target(s) skipped — hidden until focused, which is the point of them.`);

console.log("\n── does the page slide sideways? ──");
if (!overflow.length) console.log("  No. Nothing is wider than the screen.");
else for (const o of overflow) {
  say(`${o.at} scrolls to ${o.scrollWidth}px in a ${o.clientWidth}px viewport`);
  for (const w of o.wide) console.log(`        ${w.tag}.${w.cls} spans ${w.left}…${w.right}`);
}

console.log("\n── can a thumb hit everything? (44px) ──");
if (!smallTargets.size) console.log("  Yes. Every target outside the map clears 44px.");
else for (const s of [...smallTargets.values()].sort((a, b) => a.w * a.h - b.w * b.h)) {
  say(`${s.w}×${s.h}  <${s.tag}> «${s.label}»  ×${s.n}  first at ${s.at}`);
}

console.log("\n── is anything small AND crowded enough to mis-tap? (<44px, <8px apart) ──");
if (!crowded.size) console.log("  No. Every pair of targets has room between them.");
else for (const c of [...crowded.values()].sort((a, b) => a.gap - b.gap)) {
  say(`${c.gap}px between «${c.a}» and «${c.b}»  ×${c.n}  first at ${c.at}`);
}

console.log("\n── is anything below the palette's 11px floor? ──");
if (!smallText.size) console.log("  No. Every visible string is 11px or larger — the declared floor.");
else for (const t of [...smallText.values()].sort((a, b) => a.size - b.size)) {
  say(`${t.size}px  «${t.text}»  ×${t.n}  first at ${t.at}`);
}

console.log("\n── will iOS zoom into a field and stay there? (16px) ──");
if (!zoomyInputs.size) console.log("  No. Every text field is 16px or larger.");
else for (const i of zoomyInputs.values()) {
  say(`${i.size}px  <input type=${i.type}> ${i.name}  ×${i.n}  first at ${i.at}`);
}

console.log(
  problems
    ? `\n${problems} thing(s) a thumb would struggle with.`
    : "\nThe whole site is usable one-handed on a 320px phone."
);
process.exit(problems ? 1 : 0);
