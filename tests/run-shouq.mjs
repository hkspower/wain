#!/usr/bin/env node
/**
 * The whole شوق AI suite, in one command:  npm run test:shouq
 *
 * Three layers, because they fail for different reasons:
 *
 *   shouq-answers  — what she says, run against the real search index with no
 *                    browser. Covers the answer shape, the summer rule, and
 *                    the parity between her recorded clips and the spoken
 *                    fallback (they are the same sentences under one key, and
 *                    have silently disagreed before).
 *   shouq-flow     — the button and the local voice path in a real browser,
 *                    with the speech recogniser scripted and the synthesiser
 *                    captured. Covers the three-second gesture and every way
 *                    it can fail.
 *   shouq-agent    — the ElevenLabs path, built with an agent id and the
 *                    widget bundle stubbed. Covers the mode switch and the two
 *                    client tools the agent drives the interface with.
 *
 * The agent layer needs its own build (the agent id is baked in at build
 * time), so this script builds twice and leaves the shipping build in place
 * at the end. Pass --skip-agent to run only the first two against whatever is
 * already in out/.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_AGENT = process.argv.includes("--skip-agent");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT_FLOW = 4189;
const PORT_AGENT = 4190;

/**
 * Async on purpose. The static server below runs in this same process, so a
 * blocking spawnSync would hold the event loop and the server could never
 * answer the browser — every page load timed out at networkidle while the
 * server sat there, unable to run.
 */
const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
    child.on("close", (code) => resolve(code ?? 1));
  });

function build(env) {
  console.log(`\n▸ building${env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ? " (with a test agent id)" : ""}…`);
  const r = spawnSync("npm", ["run", "build"], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (r.status !== 0) { console.error("build failed"); process.exit(1); }
}

/** Serve out/ on a port, returning a stop function. */
async function serve(port) {
  const { createServer } = await import("node:http");
  const { readFileSync, existsSync: has } = await import("node:fs");
  const { extname } = await import("node:path");
  const OUT = join(ROOT, "out");
  const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
    ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
    ".txt": "text/plain", ".xml": "application/xml", ".ico": "image/x-icon" };
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

if (!existsSync(CHROMIUM)) {
  console.error(`chromium not found at ${CHROMIUM} — set CHROMIUM_PATH.`);
  process.exit(1);
}

let failed = 0;

/* 1 — what she says. No browser, no build. */
console.log("\n════ شوق: what she says ════");
const tmp = mkdtempSync(join(tmpdir(), "shouq-"));
const bundle = join(tmp, "answers.mjs");
if (await run("npx", ["-y", "esbuild", "tests/shouq-answers.test.mjs", "--bundle", "--format=esm",
                `--alias:@=${join(ROOT, "src")}`, `--outfile=${bundle}`, "--log-level=error"]) !== 0) {
  console.error("could not bundle the answer tests"); process.exit(1);
}
failed += (await run("node", [bundle])) === 0 ? 0 : 1;
rmSync(tmp, { recursive: true, force: true });

/* 2 — the button and the local voice path, against the shipping build. */
if (!existsSync(join(ROOT, "out", "index.html"))) build({});
console.log("\n════ شوق: the button and the voice flow ════");
{
  const stop = await serve(PORT_FLOW);
  failed += (await run("node", ["tests/shouq-flow.test.mjs"], { env: { ...process.env, WAIN_URL: `http://localhost:${PORT_FLOW}` } })) === 0 ? 0 : 1;
  stop();
}

/* 3 — agent mode, which needs the id compiled in. */
if (!SKIP_AGENT) {
  build({ NEXT_PUBLIC_ELEVENLABS_AGENT_ID: "agent_test_0123456789" });
  console.log("\n════ شوق: agent mode ════");
  const stop = await serve(PORT_AGENT);
  failed += (await run("node", ["tests/shouq-agent.test.mjs"], { env: { ...process.env, WAIN_URL: `http://localhost:${PORT_AGENT}` } })) === 0 ? 0 : 1;
  stop();
  // Leave the shipping build behind, never the one with a fake agent in it.
  build({});
}

console.log(failed ? `\n${failed} suite(s) failed` : "\nشوق: all suites passed");
process.exit(failed ? 1 : 0);
