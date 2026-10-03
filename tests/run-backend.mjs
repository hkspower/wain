#!/usr/bin/env node
/**
 * The whole site against the REAL back end:  npm run test:backend
 *
 * Every other browser suite that touches ordering plays the server itself:
 * Playwright intercepts `/api/wain.php` and answers in the shapes
 * tests/wain-api.test.mjs proved against the PHP. That checks the client's
 * reading of the server and the server's rules, each on its own — and never
 * the two of them together on one wire. This does.
 *
 * It builds the journey fixture (the catalogue with a three-item menu injected
 * into one place), writes the export's `data/places.json`, installs the two
 * endpoints into the export's own `api/`, gives it a `storage/` beside the
 * docroot the way the host has one, seeds the SQLite database from the export,
 * sets an admin secret, and serves all of it from one `php -S` with a router
 * that maps `/x/` to `/x/index.html` the way Apache does. Then:
 *
 *   1. tests/journey.test.mjs, with WAIN_REAL_BACKEND — the same customer's
 *      path as test:journey, with the shop's side driven through the admin
 *      actions instead of an in-memory row;
 *   2. tests/admin.test.mjs — the board itself, in a browser: the gate, the
 *      sign-in, the seeded list, a publish toggle round trip, the orders the
 *      journey just placed.
 *
 * Not in `scan` (it builds, and it needs php and Chromium), like the other
 * browser suites.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_SLUG, ROOT, buildFixture, removeFixture } from "./fixture-build.mjs";

const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = 4221;
const TREE = "/tmp/wain-backend";
const SECRET = "backend-suite-secret-" + "k".repeat(24);

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
    c.on("close", (code) => resolve(code ?? 1));
  });
const php = (args, opts = {}) => {
  const r = spawnSync("php", args, { encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error(`php ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};

if (!existsSync(CHROMIUM)) {
  console.error(`chromium not found at ${CHROMIUM} — set CHROMIUM_PATH.`);
  process.exit(1);
}
if (spawnSync("php", ["-v"]).status !== 0) {
  console.error("php is not installed here.");
  process.exit(1);
}

console.log("\n▸ building the fixture with the back end on (the default)…");
let out;
try {
  out = buildFixture({ tree: TREE });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

console.log("\n▸ the export's data/places.json, from the fixture's own catalogue…");
// From the worktree, so the injected menu is in the seed — the server must
// know the fixture place accepts orders, or order_place answers `closed`.
const gen = spawnSync("node", [join(TREE, "scripts/gen-places-json.mjs"), "--out", join(out, "data", "places.json")],
  { cwd: TREE, stdio: "inherit" });
if (gen.status !== 0) { console.error("gen-places-json failed"); removeFixture(TREE); process.exit(1); }

console.log("\n▸ installing the endpoints beside the export, with a storage/ above the docroot…");
const api = join(out, "api");
mkdirSync(api, { recursive: true });
copyFileSync(join(ROOT, "scripts/publish/wain-api.php"), join(api, "wain.php"));
copyFileSync(join(ROOT, "scripts/publish/media-endpoint.php"), join(api, "media.php"));
const storage = join(TREE, "storage");
mkdirSync(storage, { recursive: true });
writeFileSync(join(storage, "admin.secret"), SECRET + "\n");
console.log(php([join(api, "wain.php"), "migrate"]).trim().split("\n").slice(0, 3).join(" "));
const seeded = JSON.parse(php([join(api, "wain.php"), "seed"]));
console.log(`  seeded ${seeded.inserted} places (${seeded.refused.length} refused)`);
if (!seeded.ok || seeded.inserted < 50) { console.error("the seed did not land: " + JSON.stringify(seeded)); removeFixture(TREE); process.exit(1); }
const fixtureRow = JSON.parse(readFileSync(join(out, "data", "places.json"), "utf8")).find((r) => r.slug === FIXTURE_SLUG);
if (!fixtureRow?.accepts_orders || !fixtureRow.menu_ar?.length) {
  console.error(`the fixture place ${FIXTURE_SLUG} did not carry its menu into the seed`);
  removeFixture(TREE);
  process.exit(1);
}

/* The router: what Apache does for the export. A file is served (or, for
   .php, run); a directory with an index.html is that page; anything else is
   the export's 404 page. `return false` hands the request back to php -S. */
const router = join(TREE, "router.php");
writeFileSync(router, `<?php
// Decoded, as Apache does: the place pages' shared chunk lives under
// app/places/[slug]/ and arrives as %5Bslug%5D — undecoded it 404s, the chunk
// never loads, and no client component on a place page hydrates.
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/');
$root = $_SERVER['DOCUMENT_ROOT'];
$file = $root . $path;
if ($path !== '/' && is_file($file)) return false;
if (is_dir($file) && is_file(rtrim($file, '/') . '/index.html')) {
    header('Content-Type: text/html; charset=utf-8');
    readfile(rtrim($file, '/') . '/index.html');
    return true;
}
if (is_file($file . '.html')) { header('Content-Type: text/html; charset=utf-8'); readfile($file . '.html'); return true; }
http_response_code(404);
header('Content-Type: text/html; charset=utf-8');
if (is_file("$root/404.html")) readfile("$root/404.html"); else echo 'not found';
return true;
`);

const server = spawn("php", ["-S", `127.0.0.1:${PORT}`, "-t", out, router], {
  stdio: "ignore",
  env: { ...process.env, WAIN_API_WRITES_PER_MIN: "500", WAIN_API_RATE_PER_MIN: "5000" },
});
await new Promise((r) => setTimeout(r, 800));

const base = `http://127.0.0.1:${PORT}`;
const ping = await fetch(`${base}/api/wain.php?a=ping`).then((r) => r.json()).catch(() => null);
if (!ping?.ok) {
  console.error("the server did not answer ping: " + JSON.stringify(ping));
  server.kill();
  removeFixture(TREE);
  process.exit(1);
}
console.log(`  ${base} is up — ${ping.engine}, admin ${ping.admin}`);

const env = {
  ...process.env,
  WAIN_URL: base,
  WAIN_API: "/api/wain.php",
  WAIN_REAL_BACKEND: "1",
  WAIN_ADMIN_SECRET: SECRET,
  WAIN_FIXTURE_SLUG: FIXTURE_SLUG,
};

console.log("\n════ the journey, against the real back end ════");
let failed = (await run("node", ["tests/journey.test.mjs"], { env })) === 0 ? 0 : 1;

console.log("\n════ the admin board, in a browser ════");
if ((await run("node", ["tests/admin.test.mjs"], { env })) !== 0) failed = 1;

server.kill();
removeFixture(TREE);

console.log(failed ? "\nthe back end suite failed" : "\nالخادم والموقع: one wire, end to end");
process.exit(failed);
