/**
 * What only Safari does, held in plain Node:  npm run test:safari
 *
 * Every browser suite here runs Chromium, so a rule that exists because of
 * Safari is invisible to all of them — they pass with the rule and without
 * it. These run the shipped modules against stand-ins that behave the way
 * WebKit does, one rule each, measured or read out of WebKit before it was
 * written down (8 October, «fix safari issue»).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative, extname } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "wain-safari-"));
const bundle = (rel, name) => {
  const out = join(tmp, name);
  execSync(
    `npx -y esbuild ${JSON.stringify(join(ROOT, rel))} --bundle --format=esm ` +
      `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(out)} --log-level=error`,
    { cwd: ROOT, stdio: "pipe" }
  );
  return pathToFileURL(out).href;
};

/** The attribute text of each JSX opening tag named `names`, read with the
 *  braces and quotes counted: a `>` inside `onChange={(e) => …}` is not the
 *  end of the tag, and a regex that stops there misses every prop after it. */
function jsxTags(text, names) {
  const out = [];
  const open = new RegExp(`<(${names.join("|")})\\b`, "g");
  for (let m; (m = open.exec(text)); ) {
    let i = m.index + m[0].length, depth = 0, quote = null;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) { if (c === quote && text[i - 1] !== "\\") quote = null; continue; }
      if (c === '"' || c === "'" || c === "`") { if (depth > 0 || c === '"') quote = c; continue; }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ tag: m[1], attrs: text.slice(m.index + m[0].length, i), line: text.slice(0, m.index).split("\n").length });
  }
  return out;
}

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); }
};

const unhandled = [];
process.on("unhandledRejection", (e) => unhandled.push(String(e?.message ?? e)));

/* ── the shared AudioContext and Safari's «interrupted» ─────────────────────
   WebKit parks a running context in «interrupted» when a phone call, FaceTime,
   Siri or another app takes the audio, and leaves it there until the page
   resumes it (BaseAudioContext.state, Safari since 9). The module kept its one
   context for the life of the page and resumed only «suspended», so every tone
   after an interruption — the call's ring-back, its connect and hang-up tones,
   the admin's order chime — played into a context that was not running. */
console.log("\n── the shared AudioContext resumes from Safari's «interrupted» ──");
const audioUrl = bundle("src/lib/audio-context.ts", "audio-context.mjs");
let n = 0;
async function contextIn(state, { refuse = false } = {}) {
  class FakeContext {
    constructor() { this.state = state; this.resumed = 0; FakeContext.made = this; }
    resume() {
      this.resumed++;
      if (refuse) return Promise.reject(new Error("InvalidStateError: the interruption is not over"));
      this.state = "running";
      return Promise.resolve();
    }
  }
  globalThis.window = { AudioContext: FakeContext };
  // A fresh module per case: the module keeps its one context for the page.
  const mod = await import(`${audioUrl}?case=${n++}`);
  const ctx = mod.audioContext();
  await new Promise((r) => setTimeout(r, 0));
  return { ctx, made: FakeContext.made };
}
{
  const { made } = await contextIn("suspended");
  ok("a suspended context is resumed (the gesture case)", made.resumed === 1, `resumed ${made.resumed}×`);
}
{
  const { made } = await contextIn("interrupted");
  ok("an interrupted context is resumed — Safari's state after a phone call or Siri", made.resumed === 1, `resumed ${made.resumed}×`);
}
{
  const { made } = await contextIn("running");
  ok("a running context is left alone", made.resumed === 0, `resumed ${made.resumed}×`);
}
{
  const { made } = await contextIn("closed");
  ok("a closed context is not resumed", made.resumed === 0, `resumed ${made.resumed}×`);
}
{
  const { ctx } = await contextIn("interrupted", { refuse: true });
  await new Promise((r) => setTimeout(r, 10));
  ok("a resume Safari refuses mid-interruption still hands back the context", !!ctx);
  ok("…and leaves no unhandled rejection behind", unhandled.length === 0, unhandled.join("; "));
}
delete globalThis.window;

/* ── no CSS filter on anything INSIDE an <svg> ──────────────────────────────
   Safari applies a CSS filter function to an <svg> box and to every HTML box,
   and to nothing inside an <svg>: WebKit's SVG renderer takes only url(#…)
   filters on SVG elements (BCD css.properties.filter.svg_elements has no
   Safari). So `style="filter: drop-shadow(…)"` on a <g> is a shadow Chrome
   draws and Safari silently does not — it was on every place page's drawing
   until 8 October. Read off the export, the thing Safari is actually given:
   a style or a Tailwind filter class on a child of an <svg> fails. */
console.log("\n── no CSS filter inside an <svg> (Safari draws none of them) ──");
const OUT = join(ROOT, "out");
if (!existsSync(join(OUT, "index.html"))) {
  ok("out/ exists — run `npm run build` first", false);
} else {
  const pages = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".html")) pages.push(p);
    }
  };
  walk(OUT);
  const FILTER_CLASS = /^(?:[a-z0-9-]+:)*(?:drop-shadow|blur|brightness|contrast|grayscale|hue-rotate|invert|saturate|sepia)(?:-|$)/;
  const offenders = [];
  let svgs = 0;
  for (const file of pages) {
    const html = readFileSync(file, "utf8");
    for (const m of html.matchAll(/<svg\b[^>]*>([\s\S]*?)<\/svg>/g)) {
      svgs++;
      const inner = m[1];
      for (const s of inner.matchAll(/\sstyle="([^"]*)"/g)) {
        if (/(?:^|;)\s*filter\s*:\s*(?!url\()/i.test(s[1])) offenders.push(`${relative(OUT, file)}: style="${s[1].slice(0, 60)}"`);
      }
      for (const c of inner.matchAll(/\sclass="([^"]*)"/g)) {
        const hit = c[1].split(/\s+/).find((t) => FILTER_CLASS.test(t));
        if (hit) offenders.push(`${relative(OUT, file)}: class "${hit}"`);
      }
    }
  }
  ok(
    `no element inside an <svg> carries a CSS filter (${svgs} drawings on ${pages.length} pages)`,
    offenders.length === 0,
    `${offenders.length}: ${[...new Set(offenders)].slice(0, 4).join(" · ")}`
  );

  /* ── no Arabic word split across two text nodes ───────────────────────────
     Safari shapes each text node on its own, so a word whose letters sit in
     two of them is drawn unjoined at the seam: «اكتب ل{SALEM_NAME}» put the ل
     in one node and سالم in the next, and WebKit drew «اكتب ل سالم» on /find
     (8 October; 26px wider than the joined word, measured in WebKit). React
     marks the seam between two adjacent text nodes with <!-- --> in the HTML,
     so a letter that joins forward, the marker, then a letter is the defect. */
  const JOINS_FORWARD = "بتثجحخسشصضطظعغفقكلمنهيئ";
  const seams = [];
  for (const file of pages) {
    const html = readFileSync(file, "utf8");
    for (const m of html.matchAll(new RegExp(`([${JOINS_FORWARD}])<!-- -->([\u0621-\u064A])`, "g")))
      seams.push(`${relative(OUT, file)}: «${html.slice(Math.max(0, m.index - 8), m.index + 1)}|${m[2]}…»`);
  }
  ok(`no Arabic word is split across two text nodes (${pages.length} pages)`, seams.length === 0, `${seams.length}: ${seams.slice(0, 3).join(" · ")}`);

  /* ── the keyboard's key says what it does ──────────────────────────────────
     iOS names the return key Search or Go only for a box inside a <form
     action>; /search's box is in none and سالم's form has no action, so both
     showed a bare return. enterkeyhint names it (Safari iOS 13.4+). */
  const keyHint = (page, id) => {
    const html = existsSync(join(OUT, page)) ? readFileSync(join(OUT, page), "utf8") : "";
    const tag = html.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? html.match(/<input[^>]*type="search"[^>]*>/)?.[0] ?? "";
    return tag.match(/\benterkeyhint="([^"]+)"/i)?.[1] ?? null;
  };
  // سالم's box is in the static HTML; /search's is drawn on the client (the
  // page reads its query string), so that one is read in the browser below.
  ok(`سالم's box has a «send» key (${keyHint("salem/index.html", "salem-q")})`, keyHint("salem/index.html", "salem-q") === "send");

  /* ── content-visibility only where the scroll is anchored ─────────────────
     Safari renders `content-visibility: auto` (since 18) and has no scroll
     anchoring, so a skipped card coming in above the reader at its real height
     moves the page: measured in WebKit on /explore, a jump deep into the list
     and 800px back up left the card being read 74px off (Chromium: 0, it
     anchors). Every selector the shipped CSS defers must be switched back to
     `visible` under `@supports not (overflow-anchor: auto)`. Read off the
     built stylesheets, the bytes Safari is given. */
  console.log("\n── content-visibility is off where the scroll is not anchored (Safari) ──");
  const cssDir = join(OUT, "_next/static/css");
  const css = existsSync(cssDir)
    ? readdirSync(cssDir).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(cssDir, f), "utf8")).join("\n")
    : "";
  const deferred = new Set();
  for (const m of css.matchAll(/([^{}@]+)\{[^{}]*content-visibility:\s*auto/g)) {
    for (const sel of m[1].split(",")) deferred.add(sel.trim());
  }
  const undone = new Set();
  for (const block of css.matchAll(/@supports\s+not\s*\(\s*overflow-anchor:\s*auto\s*\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    for (const m of block[1].matchAll(/([^{}]+)\{[^{}]*content-visibility:\s*visible/g)) {
      for (const sel of m[1].split(",")) undone.add(sel.trim());
    }
  }
  const left = [...deferred].filter((s) => !undone.has(s));
  ok(`the build defers something, so the check means something (${[...deferred].join(", ")})`, deferred.size > 0);
  ok("every deferred selector is visible again where overflow-anchor is unsupported", left.length === 0, left.join(", "));
}

/* ── every list says it is one ──────────────────────────────────────────────
   Tailwind's preflight takes the bullets off every <ul> and <ol>, and Safari's
   VoiceOver does not announce a list whose markers are gone: the results, the
   places to vote on, the steps of an order are read as loose lines, with no
   «list, 6 items» to say how many there are or where one ends. Writing the
   role down is the documented way back (WebKit's heuristic, and Tailwind's own
   preflight note). Read off the source, so a list that only appears after a
   tap — the results, سالم's rail — is covered as well as the static pages.
   `SAFARI_SRC` points it at another tree, to prove it red on an older one. */
console.log("\n── every list says it is one (VoiceOver in Safari) ──");
{
  const SRC = process.env.SAFARI_SRC || join(ROOT, "src");
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx")) files.push(p);
    }
  };
  walk(SRC);
  const bare = [];
  let lists = 0;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const t of jsxTags(text, ["ul", "ol"])) {
      lists++;
      if (!/\brole=/.test(t.attrs)) bare.push(`${relative(SRC, f)}:${t.line}`);
    }
  }
  ok(`there are lists to check (${lists})`, lists > 0);
  ok("every <ul> and <ol> carries a role", bare.length === 0, `${bare.length}: ${bare.slice(0, 6).join(" · ")}`);
}

/* ── no field under 16px under a finger ─────────────────────────────────────
   iPhone Safari zooms the page into any text field smaller than 16px the
   moment it takes focus, and leaves it zoomed. audit:mobile holds the public
   pages to 16px, but it can only measure what a page renders on load: the
   admin board (after sign-in) and the copy-boxes of a failed send never are.
   So it is read off the source: a field set at text-xs/sm/2xs must grow on a
   touch screen (pointer-coarse:text-base), and so must the shared field
   classes in form-classes.ts. `SAFARI_SRC` as for the lists. */
console.log("\n── no text field under 16px on a touch screen (iPhone zoom) ──");
{
  const SRC = process.env.SAFARI_SRC || join(ROOT, "src");
  const small = (cls) => cls.split(/\s+/).some((t) => /^text-(2xs|xs|sm)$/.test(t));
  const grows = (cls) => cls.split(/\s+/).some((t) => /^pointer-coarse:text-(base|lg|xl|[2-9]xl)$/.test(t));
  const offenders = [];
  let fields = 0;
  const walkTsx = (d, out) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walkTsx(p, out);
      else if (e.name.endsWith(".tsx")) out.push(p);
    }
    return out;
  };
  for (const f of walkTsx(SRC, [])) {
    const text = readFileSync(f, "utf8");
    for (const t of jsxTags(text, ["input", "textarea", "select"])) {
      const type = (t.attrs.match(/\btype="([^"]+)"/) || [])[1] || "";
      if (/^(hidden|checkbox|radio|file|range|submit|button|color)$/.test(type)) continue;
      const cls = (t.attrs.match(/className="([^"]*)"/) || [])[1];
      if (cls === undefined || /\bsr-only\b/.test(cls)) continue;
      fields++;
      if (small(cls) && !grows(cls)) offenders.push(`${relative(SRC, f)}:${t.line}`);
    }
  }
  const formClasses = readFileSync(join(SRC, "lib/form-classes.ts"), "utf8");
  for (const m of formClasses.matchAll(/export const (field\w*) = `([^`]*)`/g)) {
    fields++;
    if (small(m[2]) && !grows(m[2])) offenders.push(`lib/form-classes.ts ${m[1]}`);
  }
  ok(`there are fields to check (${fields})`, fields > 10);
  ok("every small field grows to 16px on a touch screen", offenders.length === 0, `${offenders.length}: ${offenders.join(" · ")}`);
}

/* ── an installed iPhone app paints as the app ──────────────────────────────
   On an iPhone an installed web app whose manifest says `standalone` reports
   `display-mode: fullscreen` and never `standalone` (WebKit bug 264218, in
   BCD), so the CSS's media query does not match there and the app chrome
   waited for <html data-standalone>, which AppShell set after hydration: every
   launch from the home screen painted the website, and the tab bar arrived
   under the thumb a moment later. The head now decides it from
   `navigator.standalone` while it is still being parsed. Our JavaScript is
   held back here, so nothing hydration does can pass for the head's work. */
console.log("\n── an installed iPhone app paints as the app, before our scripts run ──");
if (existsSync(join(OUT, "index.html"))) {
  const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".txt": "text/plain",
    ".webp": "image/webp", ".avif": "image/avif", ".webmanifest": "application/manifest+json" };
  // The back end, as far as the worker check below needs one: a read that
  // answers a new number every time it is asked, and says it must not be kept.
  let pings = 0;
  const server = createServer((req, res) => {
    if (req.url.startsWith("/api/wain.php?a=ping")) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ ok: true, n: ++pings }));
    }
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const f = join(OUT, p);
    if (!f.startsWith(OUT) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
  for (const [label, installed, want] of [["launched from the home screen", true, "true"], ["in a Safari tab", false, "false"]]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript((installed) => {
      if (installed) Object.defineProperty(Navigator.prototype, "standalone", { configurable: true, get: () => true });
      // What <html> says the moment <body> exists: the first paint can come no earlier.
      new MutationObserver((_, o) => {
        if (!document.body) return;
        window.__atBody = document.documentElement.getAttribute("data-standalone");
        o.disconnect();
        // On `document`, not <html>: an init script runs before the parser has
        // made <html>, and observing null threw and recorded nothing.
      }).observe(document, { childList: true, subtree: true });
    }, installed);
    const page = await ctx.newPage();
    await page.route("**/_next/static/chunks/**", (r) => setTimeout(() => r.continue().catch(() => {}), 1500));
    await page.goto(base + "/explore/", { waitUntil: "domcontentloaded" });
    const at = await page.evaluate(() => window.__atBody ?? null);
    ok(`${label}: <html> already says so when the body arrives (${at})`, at === want);
    const bar = await page.evaluate(() => {
      const nav = document.querySelector("nav.app-chrome");
      return nav ? getComputedStyle(nav).display : "no bar";
    });
    ok(`${label}: the tab bar is ${installed ? "there" : "not there"} before our JavaScript has run (${bar})`,
      installed ? bar !== "none" && bar !== "no bar" : bar === "none");
    await ctx.close();
  }
  /* /find ends dark all the way down. The body's bottom padding is the home-
     indicator inset (~34px on a Face ID iPhone once the toolbar is gone) and
     it, like the rubber band past the page, is painted in the body's colour —
     white, under a dark half (8 October). DevTools stands in for the iPhone. */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const emulated = await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, left: 0, right: 0, bottom: 34 } }).then(() => true, () => false);
    await page.goto(base + "/find/", { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const end = await page.evaluate(() => {
      const pad = parseFloat(getComputedStyle(document.body).paddingBottom);
      // The colour a person sees at the very bottom: the first opaque
      // background under the last row of pixels.
      let el = document.elementFromPoint(innerWidth / 2, innerHeight - 4);
      let bg = "";
      for (; el; el = el.parentElement) {
        bg = getComputedStyle(el).backgroundColor;
        if (bg && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(bg)) break;
      }
      const overscroll = getComputedStyle(document.documentElement).overscrollBehaviorY;
      return { pad, bg, overscroll };
    });
    ok(`the strip is there to paint (${end.pad}px)`, emulated && end.pad >= 30);
    const [r, g, b] = (end.bg.match(/\d+/g) ?? []).map(Number);
    ok(`/find's last pixels are dark, not white (${end.bg})`, r + g + b < 200);
    ok(`and the page does not bounce white past its end (overscroll ${end.overscroll})`, end.overscroll === "none");
    await ctx.close();
  }

  /* /add's coordinates, typed. The box stored Number(text) on every key and
     React put the number back: «29.» became «29», so no browser could type a
     decimal point — and an iPhone's Arabic decimal pad types ٢٩٫٣٧, where
     Number('٢') is NaN and the box said «NaN» (8 October). */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar-KW" });
    const page = await ctx.newPage();
    await page.goto(base + "/add/", { waitUntil: "networkidle" });
    const lat = page.locator("#f-lat");
    const typed = async (text) => {
      await lat.fill("", { timeout: 4000 }).catch(() => {});
      await lat.click({ timeout: 4000 }).catch(() => {});
      await page.keyboard.type(text);
      return lat.inputValue({ timeout: 2000 }).catch(() => "(no box)");
    };
    const ascii = await typed("29.37");
    const arabic = await typed("٢٩٫٣٧");
    ok(`a decimal point can be typed into a coordinate («${ascii}»)`, ascii === "29.37");
    ok(`an Arabic pad's digits stay as typed («${arabic}»), not «NaN»`, arabic === "٢٩٫٣٧");
    // A submit with the form empty puts the cursor in the first field to fix —
    // on an iPhone, with its keyboard up. It focused nothing the first time:
    // the query ran before React had marked any field invalid.
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('form button[type="submit"]').click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(200);
    const focused = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || "");
    ok(`the first failed submit puts the cursor in the first field to fix (${focused})`, focused === "f-namear");
    await ctx.close();
  }

  /* The live map's tiles in Safari. Leaflet marks its container
     `.leaflet-safari` from the user agent and gives those tiles
     image-rendering: -webkit-optimize-contrast, which WebKit draws as
     crisp-edges: blocky tiles on every retina iPhone (8 October). The class is
     put on here by hand — Chromium never gets it — and the tile's computed
     value read. Tiles cannot load here; the <img> elements are enough. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(base + "/search/?q=" + encodeURIComponent("قهوة"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /حرّك الخريطة/ }).first().click({ timeout: 6000 }).catch(() => {});
    await page.locator(".leaflet-container").waitFor({ timeout: 15000 }).catch(() => {});
    await page.locator(".leaflet-tile").first().waitFor({ state: "attached", timeout: 8000 }).catch(() => {});
    const rendering = await page.evaluate(() => {
      const c = document.querySelector(".leaflet-container");
      if (!c) return "no live map";
      c.classList.add("leaflet-safari");
      const t = c.querySelector(".leaflet-tile");
      return t ? getComputedStyle(t).imageRendering : "no tile";
    });
    ok(`the live map's tiles are smoothed in Safari too (${rendering})`, rendering === "auto");
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(base + "/search/", { waitUntil: "networkidle" });
    const hint = await page.locator('input[type="search"]').first().getAttribute("enterkeyhint", { timeout: 6000 }).catch(() => null);
    ok(`/search's box has a «search» key (${hint})`, hint === "search");
    await ctx.close();
  }

  /* The home picture when its AVIF cannot be drawn. Safari's Lockdown Mode
     chooses the AVIF source (it answers image/avif as supported when picking)
     and then refuses to decode it, and a <picture> never falls back after a
     decode error: the hero — the wordmark is IN the picture — was a white box.
     Lockdown cannot be switched on here; an AVIF served as garbage fails the
     same way in Chromium, which is the part that matters: what the page does
     after an error on the source it chose. */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    let avifAsked = 0;
    await page.route("**/home/hero-*.avif", (r) => { avifAsked++; return r.fulfill({ status: 200, contentType: "image/avif", body: "not an image" }); });
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const img = document.querySelector(".home-hero img");
      return img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 8000 }).catch(() => {});
    const hero = await page.evaluate(() => {
      const img = document.querySelector(".home-hero img");
      return img ? { src: img.currentSrc.split("/").pop(), w: img.naturalWidth } : null;
    });
    ok(`the AVIF was the one chosen, so the check means something (${avifAsked} asked)`, avifAsked > 0);
    ok(`an AVIF that cannot be drawn gives way to the WebP (${JSON.stringify(hero)})`,
      !!hero && hero.w > 0 && /\.webp$/.test(hero.src));
    await ctx.close();
  }
  /* Speech on an iPhone. iOS lets speechSynthesis talk only once a speak()
     has run inside a tap, and drops every other one without an error or an
     end (WebKit, SpeechSynthesis.cpp). With the voice remembered as on, the
     answer read out after a search comes from a timer, outside any tap: a
     fresh page on an iPhone said nothing, and «اسمعها» read «وقّف الصوت»
     over the silence (8 October). The engine here is a stand-in that keeps
     WebKit's rule — a trusted input event, and the task it runs in, is a tap
     — and the page is told it is Apple's, since the fix is for Apple only. */
  {
    const engine = ({ ever }) => {
      Object.defineProperty(Navigator.prototype, "vendor", { configurable: true, get: () => "Apple Computer, Inc." });
      try { localStorage.setItem("wain-voice-enabled", "1"); } catch { /* the checks fail instead */ }
      let gesture = false;
      let unlocked = false;
      for (const t of ["pointerdown", "pointerup", "click", "keydown", "keyup", "touchend"])
        window.addEventListener(t, (e) => {
          if (!e.isTrusted) return;
          gesture = true;
          setTimeout(() => { gesture = false; }, 0);
        }, true);
      window.__spoken = [];
      window.__dropped = [];
      const synth = {
        speaking: false, pending: false, paused: false,
        getVoices: () => [], addEventListener() {}, removeEventListener() {},
        cancel() {}, pause() {}, resume() {},
        speak(u) {
          // `ever: false` is an engine that takes nothing at all — Lockdown,
          // say — for the button's sake.
          if (gesture && ever) unlocked = true;
          if (!unlocked) { window.__dropped.push(u.text); return; }
          window.__spoken.push(u.text);
          setTimeout(() => u.onend?.(new Event("end")), 20);
        },
      };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, get: () => synth });
    };
    const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

    let ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE, locale: "ar-KW" });
    await ctx.addInitScript(engine, { ever: true });
    let page = await ctx.newPage();
    await page.goto(base + "/search/", { waitUntil: "networkidle" });
    await page.locator('input[type="search"]').first().click({ timeout: 6000 }).catch(() => {});
    await page.keyboard.type("قهوة");
    await page.waitForFunction(() => window.__spoken.some((t) => t.trim()) || window.__dropped.some((t) => t.trim()),
      null, { timeout: 6000 }).catch(() => {});
    const heard = await page.evaluate(() => ({
      spoken: window.__spoken.filter((t) => t.trim()).length,
      dropped: window.__dropped.filter((t) => t.trim()).length,
    }));
    ok(`with the voice on, the answer after a search is read out (${heard.spoken} spoken, ${heard.dropped} dropped)`,
      heard.spoken > 0 && heard.dropped === 0);
    await ctx.close();

    ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE, locale: "ar-KW" });
    await ctx.addInitScript(engine, { ever: false });
    page = await ctx.newPage();
    await page.goto(base + "/search/?q=" + encodeURIComponent("قهوة"), { waitUntil: "networkidle" });
    const button = page.locator("button[aria-pressed]", { hasText: /اسمعها|وقّف الصوت/ }).first();
    await button.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const pressed = await button.getAttribute("aria-pressed", { timeout: 2000 }).catch(() => "(no button)");
    const tried = await page.evaluate(() => window.__dropped.length);
    ok(`the engine was asked and took nothing, so the check means something (${tried})`, tried > 0);
    ok(`and «اسمعها» comes back rather than sticking on «وقّف الصوت» (aria-pressed ${pressed})`, pressed === "false");
    await ctx.close();
  }

  /* «أضفها للتقويم» where a download cannot reach a calendar. An iPhone's
     installed web app and an app's own browser on iOS (a WKWebView, whose user
     agent has no «Safari/») do nothing with a downloaded .ics, or strand the
     app on an «Open in…» screen until it is force-quit — a WebKit defect years
     old (8 October). The file button stays out there, and the Google link
     beside it, which does work, stays in. Safari itself keeps both. */
  {
    const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    for (const [label, ua, installed, file] of [
      ["in Safari", `${IOS} Version/18.0 Mobile/15E148 Safari/604.1`, false, true],
      ["in the installed app", `${IOS} Mobile/15E148`, true, false],
      ["in Instagram's browser", `${IOS} Mobile/15E148 Instagram 350.0.0.0.0`, false, false],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: ua });
      if (installed) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "standalone", { configurable: true, get: () => true }));
      const page = await ctx.newPage();
      await page.goto(`${base}/places/marina-beach/?when=tomorrow&d=${today}`, { waitUntil: "networkidle" });
      const google = await page.locator("[data-calendar-google]").first().waitFor({ state: "attached", timeout: 8000 }).then(() => true, () => false);
      const button = await page.locator("[data-calendar]").count();
      ok(`${label}: the Google link is offered (so the check means something)`, google);
      ok(`${label}: the .ics button is ${file ? "offered" : "left out"} (${button})`, file ? button === 1 : button === 0);
      await ctx.close();
    }
  }

  /* Not Safari's, found on the way: the offline worker's last branch serves
     «cache first, refresh behind» for every same-origin GET, and the back
     end's reads are GETs — ping, whoami, the admin's order and queue lists,
     the live places. A kept answer is a board showing the previous orders, a
     status that snaps back, «the secret is unset» outliving the secret, and
     customers' names and numbers left on the device (8 October). The worker
     leaves /api/ to the network now.
     The old worker passes this too, and that is worth knowing rather than
     hiding: it clones each response after handing it to the page, which
     throws, so it never managed to keep one. With the clone taken first —
     the obvious tidy-up — it kept them, and this goes red (two checks). */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(base + "/about/", { waitUntil: "load" });
    const controlled = await page
      .waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 })
      .then(() => true, () => false);
    const reads = await page
      .evaluate(async () => {
        const one = async () => (await (await fetch("/api/wain.php?a=ping")).json()).n;
        const a = await one();
        await new Promise((r) => setTimeout(r, 400));
        const b = await one();
        await new Promise((r) => setTimeout(r, 400));
        const kept = [];
        for (const name of await caches.keys())
          for (const r of await (await caches.open(name)).keys()) {
            const u = new URL(r.url);
            if (u.pathname.startsWith("/api/")) kept.push(u.pathname + u.search);
          }
        return { a, b, kept };
      })
      .catch((e) => ({ a: 0, b: 0, kept: [String(e)] }));
    ok("the worker is in control of the page, so the check means something", controlled);
    ok(`a second read of the back end is a fresh one (${reads.a}, then ${reads.b})`, reads.b > reads.a);
    ok(`nothing from /api/ is kept in Cache Storage (${reads.kept.join(", ") || "none"})`, reads.kept.length === 0);
    await ctx.close();
  }
  await browser.close();
  server.close();
} else {
  ok("out/ exists — run `npm run build` first", false);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
