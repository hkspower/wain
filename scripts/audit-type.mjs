#!/usr/bin/env node
/**
 * Measure the type across the built site:  npm run audit:type
 *
 * Reading the classes tells you what was written; it does not tell you what a
 * reader gets. This walks every visible text node on a phone and on a desktop,
 * records the computed size, and reports the whole scale in use — how many
 * distinct sizes there are, how much text sits at each, and anything below the
 * floor.
 *
 * The floor matters more in Arabic than the same number would in Latin. The
 * script carries meaning in dots and short connecting strokes — ب ت ث ن ي
 * differ by dots alone — and those are the first thing to go when the size
 * drops. 10px Latin is small; 10px Arabic is ambiguous.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = 4198;
/** Below this, Arabic stops being comfortably readable. */
const FLOOR = 11;

if (!existsSync(join(OUT, "index.html"))) {
  console.error("out/ is missing — run npm run build first.");
  process.exit(1);
}

/**
 * No sizes invented at the call site.
 *
 * `text-[11px]` is how a scale rots: it is easy, it is invisible in review,
 * and twenty-two of them had accumulated before anyone counted. A size that
 * deserves to exist deserves a token in @theme, where it is one decision
 * instead of twenty-two.
 */
{
  const { execFileSync } = await import("node:child_process");
  let hits = [];
  try {
    hits = execFileSync("grep", ["-rn", "-E", String.raw`text-\[[0-9]`, "src/"], {
      cwd: ROOT, encoding: "utf8",
    }).trim().split("\n").filter(Boolean);
  } catch {
    // grep exits 1 when it finds nothing, which is the outcome we want.
  }
  if (hits.length) {
    console.error(`\n${hits.length} arbitrary font size(s) in the source. Add a token to @theme instead:\n`);
    hits.forEach((h) => console.error("  " + h));
    process.exit(1);
  }
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

const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath: CHROMIUM });

const PAGES = ["/", "/explore/", "/search/", "/places/kuwait-towers/", "/orders/",
  "/queue/", "/add/", "/about/", "/privacy/", "/admin/"];
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
];

/** size -> { count, samples:Set, pages:Set } */
const scale = new Map();
/** size -> { count, samples:Set } — pills only. */
const badges = new Map();
/** Every text node, for the leading check; and every long paragraph, for the
 *  measure. Both are cross-page totals, so they are collected here. */
const all = [];
const measures = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "ar-KW" });
  const page = await ctx.newPage();
  for (const url of PAGES) {
    await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: "networkidle" });
    const found = await page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent.trim();
        if (!text) continue;
        const el = n.parentElement;
        if (!el) continue;
        const cs = getComputedStyle(el);
        // Invisible text is not read by anyone; a 0-size icon label is not a
        // type problem.
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
        if (!el.offsetParent && cs.position !== "fixed") continue;
        // A pill that tightly wraps its own short label.
        //
        // Walking up to the nearest rounded ancestor was wrong: it found the
        // navbar's rounded *container* and called every link inside it a
        // badge. Only the text's own element or its immediate parent counts,
        // and only when the label is short — a container holding a nav is
        // neither.
        const chip = [el, el.parentElement].find((c) => {
          if (!c || c === document.body) return false;
          const s = getComputedStyle(c);
          return parseFloat(s.borderTopLeftRadius) >= 99 &&
            s.backgroundColor !== "rgba(0, 0, 0, 0)" &&
            (c.textContent || "").trim().length <= 30;
        });
        const badge = !!chip && !chip.matches("a, button, [role=button], label, select, input");
        const px = parseFloat(cs.fontSize);
        out.push({
          size: Math.round(px * 10) / 10,
          weight: cs.fontWeight,
          badge,
          text: text.slice(0, 40),
          tag: el.tagName.toLowerCase(),
          leading: Math.round((parseFloat(cs.lineHeight) / px) * 100) / 100,
        });
      }

      // Characters to the line, for running text only. Measured rather than
      // assumed: `ch` is the width of the "0" glyph, a tabular Latin numeral
      // and one of the widest things in the font, so a ch-based cap fits far
      // more Arabic than the same number of Latin characters. 68ch measured
      // 103 Arabic characters here before the cap was recalibrated.
      const cv = document.createElement("canvas");
      const cx = cv.getContext("2d");
      const measures = [];
      for (const el of document.querySelectorAll("p, li")) {
        const t = [...el.childNodes].filter((n) => n.nodeType === 3)
          .map((n) => n.textContent).join("").trim();
        if (t.length < 90) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none") continue;
        cx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const avg = cx.measureText(t).width / t.length;
        if (!avg) continue;
        measures.push({
          cpl: Math.round(el.getBoundingClientRect().width / avg),
          px: Math.round(parseFloat(cs.fontSize)),
          text: t.slice(0, 36),
        });
      }
      return { nodes: out, measures };
    });
    all.push(...found.nodes);
    measures.push(...found.measures);
    for (const f of found.nodes) {
      const key = `${f.size}`;
      if (!scale.has(key)) scale.set(key, { count: 0, samples: new Set(), pages: new Set(), weights: new Set() });
      const e = scale.get(key);
      e.count += 1;
      e.weights.add(f.weight);
      if (e.samples.size < 4) e.samples.add(`${f.tag}: ${f.text}`);
      e.pages.add(`${url}@${vp.name}`);
      if (f.badge) {
        if (!badges.has(f.size)) badges.set(f.size, { count: 0, samples: new Set() });
        const b = badges.get(f.size);
        b.count += 1;
        if (b.samples.size < 3) b.samples.add(f.text);
      }
    }
  }
  await ctx.close();
}

await browser.close();
server.close();

// ---- report ---------------------------------------------------------------
const rows = [...scale.entries()]
  .map(([size, e]) => ({ size: parseFloat(size), ...e }))
  .sort((a, b) => a.size - b.size);

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${rows.length} distinct text sizes render across ${PAGES.length} pages × ${VIEWPORTS.length} viewports.\n`);
console.log(pad("px", 8) + pad("nodes", 8) + pad("weights", 12) + "sample");

let problems = 0;
for (const r of rows) {
  const notes = [];
  if (r.size < FLOOR) { notes.push(`BELOW THE ${FLOOR}px FLOOR`); problems++; }
  console.log(
    pad(r.size, 8) + pad(r.count, 8) + pad([...r.weights].sort().join("/"), 12) +
    [...r.samples][0] + (notes.length ? `   ← ${notes.join("; ")}` : "")
  );
  if (notes.length) {
    for (const s of [...r.samples].slice(0, 4)) console.log(" ".repeat(28) + "· " + s);
    console.log(" ".repeat(28) + "seen on: " + [...r.pages].slice(0, 6).join(", "));
  }
}

/**
 * One role, one size.
 *
 * A bare list of sizes cannot tell a deliberate step from a slip — 11px and
 * 12px sitting next to each other is fine if they do different jobs and wrong
 * if they do the same one. Pills are the role you can identify from the
 * outside, so they are the one this checks, and they are where the slip was:
 * the same semibold chip rendered at 11px in six places and 12px in
 * ninety-three, which nobody would ever choose on purpose.
 */
const badgeSizes = [...badges.entries()].sort((a, b) => b[1].count - a[1].count);
console.log("\nPill-shaped labels, by size — a report, not a verdict:");
for (const [size, e] of badgeSizes) {
  console.log(`  ${size}px — ${e.count} nodes: ${[...e.samples].join(", ")}`);
}
if (badgeSizes.length > 1) {
  console.log("  More than one size here is worth a look: a status pill and a\n" +
              "  call-to-action are different roles and legitimately differ, but the\n" +
              "  same pill at two sizes is a slip. Judge it by eye — the shape alone\n" +
              "  cannot tell them apart, and a check that guesses would cry wolf.");
}

// Reported, not failed: two adjacent steps can be a real distinction.
const near = [];
for (let i = 1; i < rows.length; i++) {
  const gap = rows[i].size - rows[i - 1].size;
  if (gap > 0 && gap < 1.5) near.push(`${rows[i - 1].size}/${rows[i].size}`);
}
if (near.length) console.log(`Adjacent steps, worth a glance: ${near.join(", ")}`);

console.log(`\nLargest: ${rows[rows.length - 1].size}px — ${[...rows[rows.length - 1].samples][0]}`);
/* ── leading ───────────────────────────────────────────────────────────────
   Tailwind's defaults are tuned for Latin, and Arabic needs more room: deep
   descenders plus dots above and below. globals.css declares a value for every
   step for that reason. A body size showing Tailwind's default here means a
   step was added to the scale and never given one. */
const LATIN_DEFAULTS = { 12: 1.33, 14: 1.43, 16: 1.5, 18: 1.56, 20: 1.4 };
console.log("\n── leading, by size ──");
{
  const seen = new Map();
  for (const n of all) {
    if (!n.leading) continue;
    const key = Math.round(n.size);
    if (!seen.has(key)) seen.set(key, new Map());
    const m = seen.get(key);
    m.set(n.leading, (m.get(n.leading) ?? 0) + 1);
  }
  for (const [px, ratios] of [...seen].sort((a, b) => a[0] - b[0])) {
    const parts = [...ratios].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}×${n}`);
    console.log(`  ${String(px).padStart(3)}px  ${parts.join("  ")}`);
    const latin = LATIN_DEFAULTS[px];
    // Only running text: a badge is one line, where the ratio sets a box
    // height rather than the gap between two lines of reading.
    const bodyish = px >= 12 && px <= 20;
    if (latin && bodyish && ratios.has(latin) && ratios.get(latin) > 20) {
      console.log(`       ✗ on Tailwind's Latin default (${latin}) for ${ratios.get(latin)} nodes — declare --text-*--line-height`);
      problems++;
    }
  }
}

/* ── measure ───────────────────────────────────────────────────────────── */
console.log("\n── characters to the line ──");
{
  const worst = measures.sort((a, b) => b.cpl - a.cpl).slice(0, 5);
  if (!measures.length) console.log("  No running text long enough to measure.");
  else {
    for (const m of worst) console.log(`  ${String(m.cpl).padStart(3)} chars  ${m.px}px  «${m.text}…»`);
    const over = measures.filter((m) => m.cpl > 80);
    if (over.length) {
      console.log(`  ✗ ${over.length} line(s) run past 80 characters — longest ${worst[0].cpl}. Cap the running text with .measure`);
      problems++;
    } else {
      console.log(`  Longest is ${worst[0].cpl}. Comfortable reading is 45–75; past about 80 the eye`);
      console.log("  starts finding the wrong line on the way back.");
    }
  }
}

console.log(problems ? `\n${problems} thing(s) to look at.` : "\nThe scale is clean.");
