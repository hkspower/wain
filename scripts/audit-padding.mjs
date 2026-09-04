#!/usr/bin/env node
/**
 * Measure the spacing across the built site:  npm run audit:padding
 *
 * Two questions the source cannot answer.
 *
 * ## Does every page sit the same distance from the edge?
 *
 * Gutters are the most visible spacing decision on a phone and the easiest to
 * get quietly wrong: one page written with `px-4` and its neighbour with
 * `px-6` reads as sloppiness long before anyone can say why. Reading classes
 * does not settle it — the value that lands is the one on the outermost
 * container that actually rendered, which depends on the breakpoint and on
 * which wrapper the route happened to use. So this measures the rendered
 * padding of every max-width container, per route, per viewport.
 *
 * ## Does anything fixed to an edge ignore the safe area?
 *
 * This is the one that shipped. `body` reserved
 * `calc(5.5rem + env(safe-area-inset-bottom))` — scroll room for شوق's
 * launcher, inset included — while the launcher itself sat at a flat
 * `bottom-5`. Twenty pixels, inside the ~34px home-indicator strip on every
 * recent iPhone, which is most of Kuwait's traffic. Not merely an overlap:
 * that strip is iOS's swipe-up gesture area, so the tap that opens شوق was
 * competing with the gesture that leaves the site.
 *
 * env() resolves to 0 in a desktop Chromium, so no amount of measuring the
 * rendered value can see this — 20px and calc(20px + 0px) are the same number.
 * The check therefore reads the shipped stylesheet: anything pinned to the
 * bottom or top edge must mention env(safe-area-inset-*) or be named here as
 * deliberately exempt.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = 4199;

if (!existsSync(join(OUT, "index.html"))) {
  console.error("out/ is missing — run npm run build first.");
  process.exit(1);
}

let problems = 0;

/* ── the edges ─────────────────────────────────────────────────────────────
   Selectors that pin something to a screen edge and legitimately need no
   inset of their own, with the reason. Everything else must carry one. */
const NO_INSET_NEEDED = {
  ".wain-ai-panel": "anchored above the launcher, which carries the inset for both",
};

/**
 * Tailwind's positional utilities are named after their value — `.bottom-0`,
 * `.bottom-full` — and are applied in dozens of unrelated places: a map
 * callout, a badge, the tab bar. Asking whether `.bottom-0` carries a
 * safe-area inset is not a question with an answer.
 *
 * The chrome this is about is named for what it IS, and each such class is one
 * element in one place. `.app-chrome` (the navbar and the tab bar) is also
 * skipped for a different reason: it clears the hardware with its own PADDING
 * — `pt-[env(safe-area-inset-top)]`, `pb-[env(safe-area-inset-bottom)]` — so
 * its `bottom` has nothing to answer for.
 */
const isUtility = (sel) => /^\.(bottom|top|left|right|inset|start|end)-/.test(sel);
const SELF_PADDED = new Set([".app-chrome"]);

console.log("\n── anything fixed to an edge clears the notch and the home bar ──");
{
  const cssDir = join(OUT, "_next/static/css");
  const css = existsSync(cssDir)
    ? readdirSync(cssDir).filter((f) => f.endsWith(".css"))
        .map((f) => readFileSync(join(cssDir, f), "utf8")).join("\n")
    : "";
  if (!css) {
    console.log("  ✗ no stylesheet in out/_next/static/css");
    problems++;
  } else {
    // Rules that place something against the bottom or top edge by name.
    const edge = [...css.matchAll(/([.#][\w-]+(?:\[[^\]]*\])?)\{([^}]*\b(?:bottom|top):[^;}]*)\}/g)]
      .map(([, sel, body]) => ({ sel, body }))
      .filter(({ body }) => /\b(bottom|top):\s*(calc\()?[\d.]/.test(body));

    const bottoms = edge.filter(
      ({ sel, body }) => /\bbottom:/.test(body) && !isUtility(sel) && !SELF_PADDED.has(sel)
    );
    const missing = bottoms.filter(
      ({ sel, body }) => !/env\(safe-area-inset/.test(body) && !NO_INSET_NEEDED[sel]
    );
    const covered = bottoms.filter(({ body }) => /env\(safe-area-inset/.test(body));

    for (const { sel, body } of missing)
      console.log(`  ✗ ${sel} is pinned to the bottom without env(safe-area-inset-bottom): ${body.trim()}`);
    if (missing.length) {
      console.log("      On a notched phone this lands inside the home-indicator strip,");
      console.log("      which is also iOS's swipe-up gesture area. Add the inset, or add");
      console.log("      the selector to NO_INSET_NEEDED here with the reason.");
      problems += missing.length;
    } else {
      console.log(`  ${covered.length} bottom-pinned rule(s), every one inset-aware:`);
      for (const { sel, body } of covered) console.log(`      ${sel}  ${body.trim()}`);
      for (const [sel, why] of Object.entries(NO_INSET_NEEDED))
        if (css.includes(sel)) console.log(`      ${sel}  — exempt: ${why}`);
    }
  }
}

/* ── the gutters ──────────────────────────────────────────────────────────── */
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
  // /404/ was missing, and it was the route with the bug: px-4 and no sm:px-6,
  // so its desktop gutter was 16px where every other route is 24. The page
  // nobody plans to visit is exactly the one no one checks.
  "/queue/", "/add/", "/about/", "/privacy/", "/admin/", "/404/"];

/**
 * Routes whose page box legitimately does not carry the site rhythm.
 *
 * Named, with the reason, rather than silently tolerated — an exception list
 * that does not say why is how a real defect gets added to it later.
 */
const RHYTHM_EXEMPT = new Map([
  ["/", "a full-bleed hero; the sections inside it carry their own spacing"],
  ["/404/", "a centred, near-empty page — it wants the extra air"],
]);

for (const vp of [{ name: "phone", width: 390 }, { name: "desktop", width: 1280 }]) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: 844 } });
  const seen = new Map();
  for (const url of PAGES) {
    await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: "networkidle" });
    for (const v of await page.evaluate(() => {
      const main = document.querySelector("main") || document.body;
      const out = [];
      for (const el of main.querySelectorAll("div,section")) {
        const cs = getComputedStyle(el);
        const mw = parseFloat(cs.maxWidth);
        if (!(mw > 0 && mw < 9999)) continue;
        if (cs.display === "none" || !el.offsetParent) continue;
        out.push(`${Math.round(parseFloat(cs.paddingLeft))}/${Math.round(parseFloat(cs.paddingRight))}`);
      }
      return out;
    })) {
      if (!seen.has(v)) seen.set(v, new Set());
      seen.get(v).add(url);
    }
  }
  await page.close();

  const rows = [...seen.entries()].sort((a, b) => b[1].size - a[1].size);
  console.log(`\n── the page's own gutter, ${vp.name} ${vp.width}px ──`);
  for (const [pad, urls] of rows)
    console.log(`  ${pad.padEnd(9)} on ${String(urls.size).padStart(2)} route(s)${urls.size <= 2 ? "  ← " + [...urls].join(", ") : ""}`);
  if (rows.length > 1) {
    console.log(`  ✗ ${rows.length} different gutters at one width. A route that steps out of`);
    console.log("      line reads as sloppiness long before anyone can say why.");
    problems++;
  } else {
    console.log("  One gutter, every route.");
  }
}

/* ── the vertical rhythm ───────────────────────────────────────────────────
   The gutter check above has always covered left and right. Nothing covered
   up and down, and the site had drifted into FIVE different vertical rhythms
   for what is one set of pages: 32/56 on explore, search, add and the place
   page; 40/56 on orders and queue; 40/64 on about and privacy — which also
   had no `standalone:` variant at all, so the installed app showed them at
   40/64 while every other screen compacted to 16.

   Nobody can name the difference between 32 and 40 on a page they are
   reading. Everybody feels a site where the answer changes per route. */
for (const vp of [{ name: "phone", width: 390 }, { name: "desktop", width: 1280 }]) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: 844 } });
  const seen = new Map();
  const exempt = [];
  for (const url of PAGES) {
    await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: "networkidle" });
    const v = await page.evaluate(() => {
      // The page's own outermost box — the thing that sets the rhythm. Inner
      // cards have padding of their own and are none of this check's business.
      const box = (document.querySelector("main") || document.body).firstElementChild;
      if (!box) return null;
      const cs = getComputedStyle(box);
      return `${Math.round(parseFloat(cs.paddingTop))}/${Math.round(parseFloat(cs.paddingBottom))}`;
    });
    if (v === null) continue;
    if (RHYTHM_EXEMPT.has(url)) { exempt.push(`${url} ${v} — ${RHYTHM_EXEMPT.get(url)}`); continue; }
    if (!seen.has(v)) seen.set(v, new Set());
    seen.get(v).add(url);
  }
  await page.close();

  const rows = [...seen.entries()].sort((a, b) => b[1].size - a[1].size);
  console.log(`\n── the page's own vertical rhythm, ${vp.name} ${vp.width}px ──`);
  for (const [pad, urls] of rows)
    console.log(`  ${pad.padEnd(9)} on ${String(urls.size).padStart(2)} route(s)${urls.size <= 2 ? "  ← " + [...urls].join(", ") : ""}`);
  for (const e of exempt) console.log(`  · ${e}`);
  if (rows.length > 1) {
    console.log(`  ✗ ${rows.length} different vertical rhythms at one width. Same argument as`);
    console.log("      the gutter: nobody can name it, everybody feels it.");
    problems++;
  } else {
    console.log("  One rhythm, every route.");
  }
}

await browser.close();
server.close();

console.log(problems ? `\n${problems} thing(s) to look at.` : "\nSpacing is consistent, and every edge clears the hardware.");
process.exit(problems ? 1 : 0);
