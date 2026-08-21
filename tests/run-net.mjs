#!/usr/bin/env node
/**
 * The network suite:  npm run test:net
 *
 * Bundles the real src/lib/net.ts, src/lib/orders.ts and src/lib/usePoll.ts
 * onto two blank pages, serves them, and lets Playwright play the server. No
 * Next build is involved and no Supabase is required: the client is pointed at
 * an address on the test's own origin, and every request to it is intercepted,
 * so the test decides whether a request fails in transit, stalls forever,
 * returns 503, or comes back with a duplicate-key error.
 *
 * That is the only way to check most of this. "Retries three times", "does not
 * replay a POST", "a stalled request eventually gives up" and "a duplicate key
 * means the order is already there" are all statements about what happens on a
 * bad network, and a good network never demonstrates any of them.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = 4194;
/** Same origin as the pages, so interception is simple and nothing real is
 *  ever contacted even if a route were somehow missed. */
const SUPABASE_URL = `http://127.0.0.1:${PORT}/sb`;
const ANON_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.test-key-not-real";

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
    child.on("close", (code) => resolve(code ?? 1));
  });

const dir = mkdtempSync(join(tmpdir(), "wain-net-"));

const bundle = (entry, outfile) =>
  run("npx", [
    "esbuild", entry,
    "--bundle", "--format=iife", "--jsx=automatic",
    `--alias:@=${join(ROOT, "src")}`,
    `--define:process.env.NEXT_PUBLIC_SUPABASE_URL="${SUPABASE_URL}"`,
    `--define:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY="${ANON_KEY}"`,
    "--define:process.env.NODE_ENV=\"production\"",
    `--outfile=${join(dir, outfile)}`,
    "--log-level=error",
  ]);

console.log("\n════ bundling the real modules ════");
if ((await bundle("tests/harness/net-harness.ts", "net.js")) !== 0) {
  console.error("could not bundle the net harness");
  process.exit(1);
}
if ((await bundle("tests/harness/poll-harness.tsx", "poll.js")) !== 0) {
  console.error("could not bundle the poll harness");
  process.exit(1);
}

const page = (script, body = "") =>
  `<!doctype html><meta charset="utf-8"><title>harness</title>${body}<script src="/${script}"></script>`;
writeFileSync(join(dir, "net.html"), page("net.js"));
writeFileSync(join(dir, "poll.html"), page("poll.js", '<div id="root"></div>'));

const { createServer } = await import("node:http");
const { readFileSync, existsSync } = await import("node:fs");
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const f = join(dir, p === "/" ? "net.html" : p);
  if (!f.startsWith(dir) || !existsSync(f)) {
    res.writeHead(404);
    return res.end("nope");
  }
  res.writeHead(200, {
    "content-type": f.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8",
  });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

console.log("\n════ the network layer under a bad network ════");
let failed = 0;
if (!existsSync(CHROMIUM)) {
  console.log(`  chromium not found at ${CHROMIUM} — set CHROMIUM_PATH.`);
  failed = 1;
} else {
  failed =
    (await run("node", ["tests/net.test.mjs"], {
      env: { ...process.env, WAIN_URL: `http://127.0.0.1:${PORT}`, WAIN_SB: SUPABASE_URL },
    })) === 0
      ? 0
      : 1;
}

server.close();
rmSync(dir, { recursive: true, force: true });
console.log(failed ? "\nnetwork suite failed" : "\nالشبكة: all checks passed");
process.exit(failed);
