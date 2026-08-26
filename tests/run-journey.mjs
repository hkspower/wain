#!/usr/bin/env node
/**
 * The whole customer journey, end to end:  npm run test:journey
 *
 * Every other suite tests a layer. This one walks the path a person actually
 * takes — open the site, search, pick a place, order from it, watch the order
 * through to collected — and it is the only one that can catch a break
 * *between* two layers that are each fine on their own.
 *
 * ## Why it needs its own build
 *
 * Two things are missing from the shipping build, both on purpose:
 *
 *   - **No place has a menu.** Inventing a price list for a real café and
 *     showing it to customers who will be charged at that café's counter is
 *     not something wain should do, so the order panel has never rendered in a
 *     test and the browser order suite has always skipped.
 *   - **No Supabase.** Ordering cannot complete without a database.
 *
 * So this builds in a **git worktree** — a clean checkout of HEAD, patched
 * there and never in the working tree, because a test that edits places.ts in
 * place leaves it edited when somebody kills the run. The fixture adds a menu
 * to one existing place, and the build points at a Supabase URL on the test's
 * own origin so Playwright can intercept every request and play the server.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = 4201;
const TREE = "/tmp/wain-journey";
const SUPABASE_URL = `http://127.0.0.1:${PORT}/sb`;
const ANON = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.journey-test-key";
/** The place the fixture gives a menu to. */
export const FIXTURE_SLUG = "mubarakiya-tea-houses";

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
    c.on("close", (code) => resolve(code ?? 1));
  });

if (!existsSync(CHROMIUM)) {
  console.error(`chromium not found at ${CHROMIUM} — set CHROMIUM_PATH.`);
  process.exit(1);
}

// ---- a clean checkout to patch ---------------------------------------------
console.log("\n▸ preparing an isolated checkout…");
rmSync(TREE, { recursive: true, force: true });
spawnSync("git", ["worktree", "prune"], { cwd: ROOT, stdio: "ignore" });
const wt = spawnSync("git", ["worktree", "add", "--detach", TREE, "HEAD"], {
  cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
});
if (wt.status !== 0) {
  console.error("could not create the worktree:\n" + (wt.stderr || wt.stdout));
  process.exit(1);
}
// The worktree is a checkout of HEAD, so anything uncommitted has to be
// carried over by hand or the journey tests yesterday's code.
//
// `git diff HEAD` alone was not enough: it lists modified *tracked* files and
// says nothing about new ones. A change that adds a component and imports it
// from a page therefore carried the page across without the component, and the
// build failed with "Module not found" for a file sitting right there in the
// working directory. That happened twice before it was worth fixing properly.
// --others adds the untracked files, --exclude-standard keeps node_modules and
// everything else .gitignore already rules out.
const changed = spawnSync("git", ["diff", "HEAD", "--name-only"], {
  cwd: ROOT, encoding: "utf8",
}).stdout.trim().split("\n").filter(Boolean);
const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
  cwd: ROOT, encoding: "utf8",
}).stdout.trim().split("\n").filter(Boolean);
const dirty = [...new Set([...changed, ...untracked])];
for (const f of dirty) {
  if (!existsSync(join(ROOT, f))) continue;
  const { mkdirSync, copyFileSync } = await import("node:fs");
  mkdirSync(dirname(join(TREE, f)), { recursive: true });
  copyFileSync(join(ROOT, f), join(TREE, f));
}
if (dirty.length) console.log(`  carried ${dirty.length} uncommitted file(s) across`);
symlinkSync(join(ROOT, "node_modules"), join(TREE, "node_modules"));

// ---- the fixture -----------------------------------------------------------
{
  const p = join(TREE, "src/lib/places.ts");
  const s = readFileSync(p, "utf8");
  const anchor = `    slug: "${FIXTURE_SLUG}",`;
  if (!s.includes(anchor)) {
    console.error(`fixture place ${FIXTURE_SLUG} not found in places.ts`);
    process.exit(1);
  }
  writeFileSync(p, s.replace(anchor, `${anchor}
    acceptsOrders: true,
    orderPrepMinutes: 15,
    orderNoteAr: "الاستلام من الكاشير.",
    menuAr: [
      { id: "m1", nameAr: "چاي كرك", priceFils: 250 },
      { id: "m2", nameAr: "قهوة عربية", priceFils: 500 },
      { id: "m3", nameAr: "كيك اليوم", priceFils: 1750, soldOut: true },
    ],`));
  console.log(`  gave ${FIXTURE_SLUG} a three-item menu`);
}

console.log("\n▸ building the journey fixture…");
const build = spawnSync("npx", ["next", "build"], {
  cwd: TREE,
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  },
  stdio: ["ignore", "pipe", "inherit"],
});
if (build.status !== 0) { console.error("build failed"); process.exit(1); }

// ---- serve it --------------------------------------------------------------
const { createServer } = await import("node:http");
const { extname } = await import("node:path");
const OUT = join(TREE, "out");
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
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

console.log("\n════ the whole journey ════");
const failed = (await run("node", ["tests/journey.test.mjs"], {
  env: { ...process.env, WAIN_URL: `http://127.0.0.1:${PORT}`, WAIN_SB: SUPABASE_URL,
         WAIN_FIXTURE_SLUG: FIXTURE_SLUG },
})) === 0 ? 0 : 1;

server.close();
rmSync(TREE, { recursive: true, force: true });
spawnSync("git", ["worktree", "prune"], { cwd: ROOT, stdio: "ignore" });

console.log(failed ? "\nthe journey broke" : "\nالرحلة كاملة: from the first tap to the collected order");
process.exit(failed);
