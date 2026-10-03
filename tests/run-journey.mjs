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
 *   - **No back end on a plain static server.** Ordering through the database
 *     cannot complete without `/api/wain.php` answering.
 *
 * So this builds in a git worktree — see tests/fixture-build.mjs, which holds
 * the checkout-patch-build dance for this suite and for the WhatsApp order
 * flow in run-orders.mjs. The fixture adds a menu to one existing place, and
 * the build keeps the default back end (`/api/wain.php` on the test's own
 * origin) so Playwright can intercept every request and play the server —
 * or, in tests/run-backend.mjs, the real PHP file answers instead.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  FIXTURE_SLUG,
  ROOT,
  buildFixture,
  removeFixture,
  serveDir,
} from "./fixture-build.mjs";

export { FIXTURE_SLUG };

const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = 4201;
const TREE = "/tmp/wain-journey";
/** The same-origin default the site ships with; the journey intercepts every
 *  request to it and plays the shop's side, unless WAIN_REAL_BACKEND names a
 *  server that is really there (tests/run-backend.mjs). */
const API_URL = "/api/wain.php";

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
    c.on("close", (code) => resolve(code ?? 1));
  });

if (!existsSync(CHROMIUM)) {
  console.error(`chromium not found at ${CHROMIUM} — set CHROMIUM_PATH.`);
  process.exit(1);
}

console.log("\n▸ preparing an isolated checkout and building the journey fixture…");
let out;
try {
  out = buildFixture({
    tree: TREE,
    env: { NEXT_PUBLIC_WAIN_BACKEND: API_URL },
  });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const stop = await serveDir(out, PORT);

console.log("\n════ the whole journey ════");
const failed = (await run("node", ["tests/journey.test.mjs"], {
  env: { ...process.env, WAIN_URL: `http://127.0.0.1:${PORT}`, WAIN_API: API_URL,
         WAIN_FIXTURE_SLUG: FIXTURE_SLUG },
})) === 0 ? 0 : 1;

stop();
removeFixture(TREE);

console.log(failed ? "\nthe journey broke" : "\nالرحلة كاملة: from the first tap to the collected order");
process.exit(failed);
