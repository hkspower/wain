#!/usr/bin/env node
/**
 * The طلب مسبق suite:  npm run test:orders
 *
 * Two layers. The first is the one that matters most: money. Kuwait's dinar
 * has three decimal places, so every price is integer fils and never a float,
 * and those tests exist because a total that is out by a thousandth is a total
 * that is wrong. The second drives the panel in a browser and checks, among
 * other things, that it never tells anyone they have paid — they have not, and
 * they will not until they are standing at the counter.
 *
 * The browser layer needs a place with a menu, and no shipped place has one
 * (no business has registered yet). It skips cleanly when the fixture is
 * absent rather than reporting a false pass or a false failure.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = 4192;

// Async: the static server runs in this process, so a blocking spawnSync would
// hold the event loop and the browser's page loads would time out.
const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
    child.on("close", (code) => resolve(code ?? 1));
  });

async function serve(port) {
  const { createServer } = await import("node:http");
  const { readFileSync, existsSync: has } = await import("node:fs");
  const { extname } = await import("node:path");
  const OUT = join(ROOT, "out");
  const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
    ".svg": "image/svg+xml", ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json", ".txt": "text/plain",
    ".xml": "application/xml", ".ico": "image/x-icon" };
  const server = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    let f = join(OUT, p);
    if (!has(f) && has(f + ".html")) f += ".html";
    if (!has(f) || !f.startsWith(OUT)) { res.writeHead(404); return res.end("nope"); }
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((r) => server.listen(port, r));
  return () => server.close();
}

let failed = 0;

const tmp = mkdtempSync(join(tmpdir(), "wain-orders-"));

/** Bundled, because these import from src/ through the @ alias. */
async function runLogic(entry, outName, title) {
  console.log(`\n════ ${title} ════`);
  const bundle = join(tmp, outName);
  if ((await run("npx", ["esbuild", entry, "--bundle", "--format=esm",
        `--alias:@=${join(ROOT, "src")}`, `--outfile=${bundle}`, "--log-level=error"])) !== 0) {
    console.error(`could not bundle ${entry}`);
    process.exit(1);
  }
  return (await run("node", [bundle])) === 0 ? 0 : 1;
}

failed += await runLogic("tests/orders.test.mjs", "orders.mjs", "money and order rules");
failed += await runLogic("tests/queue.test.mjs", "queue.mjs", "the queue's own rules");
rmSync(tmp, { recursive: true, force: true });

console.log("\n════ the order panel in a browser ════");
if (!existsSync(join(ROOT, "out", "index.html"))) {
  console.log("  out/ is missing — run npm run build first.");
  failed += 1;
} else if (!existsSync(CHROMIUM)) {
  console.log(`  chromium not found at ${CHROMIUM} — set CHROMIUM_PATH.`);
  failed += 1;
} else {
  const stop = await serve(PORT);
  const env = { ...process.env, WAIN_URL: `http://localhost:${PORT}` };
  failed += (await run("node", ["tests/order-flow.test.mjs"], { env })) === 0 ? 0 : 1;
  console.log("\n════ طلباتي — tracking ════");
  failed += (await run("node", ["tests/order-tracking.test.mjs"], { env })) === 0 ? 0 : 1;
  console.log("\n════ دوري — the queue screen ════");
  failed += (await run("node", ["tests/queue-page.test.mjs"], { env })) === 0 ? 0 : 1;
  stop();
}

console.log(failed ? `\n${failed} suite(s) failed` : "\nطلب مسبق: all suites passed");
process.exit(failed ? 1 : 0);
