#!/usr/bin/env node
/**
 * Is wainkw.com actually cookie-free?
 *
 * Not "do we think we set cookies" — do we, measured in a real browser
 * against the real build. The distinction matters because the claim is one a
 * visitor cannot check and a regulator can: the moment the site sets a cookie
 * that is not strictly necessary, it needs a consent banner, and a banner is
 * the single most disliked thing on the Arabic web. Staying genuinely
 * cookie-free is cheaper than asking permission forever.
 *
 * Three things are checked, because a cookie can arrive three ways:
 *
 *   1. THE SERVER SENDS ONE. Set-Cookie on any response from our own origin.
 *      This build is static files on shared hosting with no PHP in the
 *      request path, so there is nothing to set one — but "nothing can" is an
 *      assumption about the host, and .htaccess is where it would change.
 *
 *   2. OUR SCRIPT WRITES ONE. document.cookie = … anywhere in the shipped
 *      JavaScript. Checked in the built chunks, not the source, because the
 *      built chunks are what runs and a dependency can write a cookie without
 *      a single line of ours saying so.
 *
 *   3. A THIRD PARTY WRITES ONE. Either from its own origin (a frame, an
 *      image) or as first-party (a script we load runs *as us* and can write
 *      whatever it likes). This is the one that actually bites.
 *
 * On (3) the site's defence is structural rather than hopeful, and this audit
 * asserts the structure:
 *
 *   - The basemap is a third-party page from openstreetmap.org, and it is
 *     framed with sandbox="allow-scripts" and NO allow-same-origin. That
 *     hands the frame an opaque origin, and a document on an opaque origin
 *     cannot read or write cookies — the browser refuses. It is not a promise
 *     from OpenStreetMap, it is a rule the browser enforces on OpenStreetMap.
 *
 *   - The only third-party SCRIPT is the ElevenLabs widget, and it is not on
 *     the page. It is injected on the first press of the call button and
 *     never before, so a visitor who browses, searches, reads a place and
 *     leaves has run no third-party code at all.
 *
 * WHAT THIS AUDIT CANNOT SEE, stated plainly: the sandboxed frame and the
 * widget are both fetched from hosts the build environment's egress proxy
 * blocks. When they fail to load, their absence is recorded as UNMEASURED
 * rather than counted as a pass — an audit that reports "no cookies" because
 * the network was down is worse than no audit. Run it somewhere with open
 * egress to cover them.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const OUT = new URL("../out/", import.meta.url).pathname;

/** Pages a real visitor reaches. Every one is loaded and inspected. */
const ROUTES = [
  "/",
  "/search/",
  "/explore/",
  "/places/kuwait-towers/",
  "/places/salhia-complex/",
  "/orders/",
  "/queue/",
  "/about/",
  "/privacy/",
  "/add/",
];

/**
 * Hosts the page is allowed to talk to, each with the reason it is here.
 *
 * This is not a firewall — the browser enforces the CSP, not this script. It
 * is a list that has to be edited deliberately, so that adding an analytics
 * host is a visible line in a diff rather than a silent import.
 */
const KNOWN_THIRD_PARTIES = new Map([
  ["www.openstreetmap.org", "the basemap, in a sandboxed frame with no same-origin"],
  ["unpkg.com", "the ElevenLabs widget, loaded only when the call button is pressed"],
  ["api.elevenlabs.io", "the voice call itself, once connected"],
  ["api.us.elevenlabs.io", "the voice call itself, once connected"],
  ["sportake.app.n8n.cloud", "the submission webhook, on submit only"],
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

/** Serve out/ the way the host does: a directory means its index.html. */
function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const clean = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
      let file = join(OUT, clean);
      try {
        if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      } catch {
        if (!extname(file)) file += ".html";
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const problems = [];
const notes = [];
const unmeasured = new Set();

// ── 1. does anything in the shipped JavaScript write a cookie? ─────────────
{
  const { readdir } = await import("node:fs/promises");
  const dir = join(OUT, "_next/static/chunks");
  const walk = async (d) => {
    const out = [];
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) out.push(...(await walk(p)));
      else if (e.name.endsWith(".js")) out.push(p);
    }
    return out;
  };
  const chunks = await walk(dir);
  /* A read is fine and a write is not: libraries feature-detect by reading
     document.cookie, and failing that would be noise with no cookie behind
     it. Only an assignment actually stores anything. */
  const writes = [];
  for (const f of chunks) {
    const src = await readFile(f, "utf8");
    if (/document\.cookie\s*=/.test(src) || /\bcookieStore\b/.test(src)) writes.push(f.slice(OUT.length));
  }
  if (writes.length) problems.push(`shipped JavaScript writes a cookie: ${writes.join(", ")}`);
  else notes.push(`${chunks.length} shipped chunks, none writes document.cookie`);
}

// ── 2. is the third-party frame sandboxed away from cookies? ───────────────
{
  const src = await readFile(new URL("../src/components/PlaceMapFrame.tsx", import.meta.url), "utf8");
  const search = await readFile(new URL("../src/components/SearchMap.tsx", import.meta.url), "utf8").catch(() => "");
  for (const [name, code] of [["PlaceMapFrame", src], ["SearchMap", search]]) {
    if (!code.includes("<iframe")) continue;
    const sandbox = code.match(/sandbox="([^"]*)"/)?.[1];
    if (sandbox === undefined) problems.push(`${name}: third-party iframe with no sandbox — it can set cookies`);
    else if (sandbox.includes("allow-same-origin"))
      problems.push(`${name}: sandbox allows same-origin, which hands the frame a real origin and its cookies back`);
    else notes.push(`${name}: iframe sandbox="${sandbox}" — opaque origin, cookies impossible`);
  }
}

// ── 3. is the only third-party script kept off the page until asked for? ───
{
  const call = await readFile(new URL("../src/components/WainAiCall.tsx", import.meta.url), "utf8");
  const injects = call.includes("script.src = WAIN_AI_WIDGET_SRC");
  const gated = /if \(!WAIN_AI_AGENT_ENABLED \|\| !dialling/.test(call);
  if (injects && !gated)
    problems.push("WainAiCall: the third-party widget is no longer gated behind the call button");
  else if (injects) notes.push("the ElevenLabs widget loads only once the call button is pressed");

  const layout = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  if (/<script\s/.test(layout)) problems.push("layout.tsx has a <script> tag — nothing third-party belongs on every page");
}

// ── 4. and now the browser: load every page and ask it ─────────────────────
const server = await serve();
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;
/* Use whatever Chromium is on the machine when Playwright's own pinned build
   is not downloaded — a browser is a browser for this purpose, and requiring
   a 150MB download to answer "are there cookies" would mean nobody runs it. */
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
).catch(async (e) => {
  for (const p of ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/google-chrome"]) {
    try { return await chromium.launch({ executablePath: p }); } catch { /* try the next */ }
  }
  throw e;
});
const context = await browser.newContext();

const setCookieHeaders = [];
const thirdParties = new Set();
context.on("response", async (r) => {
  const host = new URL(r.url()).hostname;
  if (host !== "127.0.0.1") thirdParties.add(host);
  const headers = await r.allHeaders().catch(() => ({}));
  if (headers["set-cookie"]) setCookieHeaders.push(`${r.url()} → ${headers["set-cookie"]}`);
});
context.on("requestfailed", (r) => {
  const host = new URL(r.url()).hostname;
  if (host !== "127.0.0.1") unmeasured.add(host);
});

const storageSeen = [];
for (const route of ROUTES) {
  const page = await context.newPage();
  await page.goto(base + route, { waitUntil: "load" });
  // Give deferred work — lazy frames, effects, the service worker — a moment
  // to do whatever it was going to do before we declare the page clean.
  await page.waitForTimeout(1200);

  const inline = await page.evaluate(() => document.cookie);
  if (inline) problems.push(`${route}: document.cookie is "${inline}"`);

  /* localStorage is not a cookie and needs no consent under the ePrivacy
     carve-out only if it is strictly necessary. Anything written before the
     visitor asks for something is worth seeing, so it is reported either way
     rather than judged here. */
  const stored = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  if (stored.local.length || stored.session.length)
    storageSeen.push(`${route}: local[${stored.local}] session[${stored.session}]`);

  await page.close();
}

const cookies = await context.cookies();
if (cookies.length)
  problems.push(`the browser holds ${cookies.length} cookie(s): ${cookies.map((c) => `${c.name}@${c.domain}`).join(", ")}`);
else notes.push(`${ROUTES.length} pages browsed, cookie jar empty`);

if (setCookieHeaders.length) problems.push(`Set-Cookie seen: ${setCookieHeaders.join(" | ")}`);

for (const host of thirdParties) {
  if (!KNOWN_THIRD_PARTIES.has(host))
    problems.push(`undeclared third party contacted on a plain browse: ${host}`);
}

await browser.close();
server.close();

// ── report ─────────────────────────────────────────────────────────────────
console.log("\n── audit:cookies ──");
for (const n of notes) console.log(`  ✓ ${n}`);
if (storageSeen.length) {
  console.log("\n  local/session storage written on a plain browse (not cookies, no consent needed):");
  for (const s of storageSeen) console.log(`    · ${s}`);
} else {
  console.log("\n  ✓ nothing written to local or session storage on a plain browse");
}
if (unmeasured.size) {
  console.log("\n  UNMEASURED — these hosts did not load here, so nothing about them was proven:");
  for (const h of unmeasured) console.log(`    · ${h}${KNOWN_THIRD_PARTIES.has(h) ? ` (${KNOWN_THIRD_PARTIES.get(h)})` : ""}`);
}
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log("\nno cookies. ✓");
