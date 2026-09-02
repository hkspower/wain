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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_AGENT = process.argv.includes("--skip-agent");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT_FLOW = 4189;
const PORT_AGENT = 4190;
const PORT_VOICE = 4197;
const PORT_BRIDGE = 4198;

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
if (await run("npx", ["esbuild", "tests/shouq-answers.test.mjs", "--bundle", "--format=esm",
                `--alias:@=${join(ROOT, "src")}`, `--outfile=${bundle}`, "--log-level=error"]) !== 0) {
  console.error("could not bundle the answer tests"); process.exit(1);
}
failed += (await run("node", [bundle])) === 0 ? 0 : 1;

/* 1b — is the answer right, not just well-formed. */
console.log("\n════ شوق: the question battery ════");
const battery = join(tmp, "battery.mjs");
if (await run("npx", ["esbuild", "tests/shouq-battery.test.mjs", "--bundle", "--format=esm",
                `--alias:@=${join(ROOT, "src")}`, `--outfile=${battery}`, "--log-level=error"]) !== 0) {
  console.error("could not bundle the question battery"); process.exit(1);
}
failed += (await run("node", [battery])) === 0 ? 0 : 1;
rmSync(tmp, { recursive: true, force: true });

/* 2 — the knowledge base the agent is briefed on. No browser, no build. */
console.log("\n════ شوق: the knowledge base ════");
failed += (await run("node", ["tests/shouq-brief.test.mjs"])) === 0 ? 0 : 1;

/* 2b — the clip generator, against a stub ElevenLabs. No browser, no build,
   no paid API calls: what is under test is which clips get re-recorded. */
console.log("\n════ شوق: the clip pipeline ════");
failed += (await run("node", ["tests/voice-pipeline.test.mjs"])) === 0 ? 0 : 1;

/* 3 — the voice module, with the browser's audio APIs instrumented. */
console.log("\n════ شوق: the voice ════");
{
  const vtmp = mkdtempSync(join(tmpdir(), "shouq-voice-"));
  // Every process.env key voice.ts reads has to be defined here, not just the
  // ones it read yesterday. esbuild leaves an unmatched `process.env.X` in the
  // output verbatim, and in an IIFE bundle for a browser that is a
  // ReferenceError thrown before window.voice is ever assigned — so the suite
  // times out waiting for a harness that died on its first line, and the
  // timeout says nothing about which key was missing. Empty string is the
  // branch these two suites are for: the bridge unconfigured, the clips and the
  // browser voice doing all the work. The bundle further down turns it on.
  const okBundle = await run("npx", ["esbuild", "tests/harness/voice-harness.ts",
    "--bundle", "--format=iife", `--alias:@=${join(ROOT, "src")}`,
    '--define:process.env.NODE_ENV="production"',
    '--define:process.env.NEXT_PUBLIC_WAIN_TTS_URL=""',
    `--outfile=${join(vtmp, "voice.js")}`, "--log-level=error"]);
  if (okBundle !== 0) { console.error("could not bundle the voice harness"); process.exit(1); }
  writeFileSync(join(vtmp, "voice.html"),
    `<!doctype html><meta charset="utf-8"><title>voice</title><script src="./voice.js"></script>`);

  const { createServer } = await import("node:http");
  const { readFileSync } = await import("node:fs");
  // /voice/* comes from the fixtures rather than the temp bundle dir, so the
  // browser reaches a real manifest and real MP3s at exactly the URLs the
  // shipping site uses. Without this the manifest fetch 404s, every utterance
  // falls back to synthetic speech, and the clip path — the one that actually
  // runs once clips exist — is never executed by any test.
  const FIXTURES = join(ROOT, "tests/fixtures/voice");
  const TYPES = { ".js": "text/javascript", ".json": "application/json",
    ".mp3": "audio/mpeg", ".html": "text/html; charset=utf-8" };
  const srv = createServer((req, res) => {
    const url = req.url === "/" ? "/voice.html" : req.url.split("?")[0];
    const [base, name] = url.startsWith("/voice/")
      ? [FIXTURES, url.slice("/voice".length)]
      : [vtmp, url];
    const f = join(base, name);
    if (!f.startsWith(base) || !existsSync(f)) { res.writeHead(404); return res.end("nope"); }
    res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((r) => srv.listen(PORT_VOICE, "127.0.0.1", r));
  const voiceEnv = { ...process.env, WAIN_URL: `http://127.0.0.1:${PORT_VOICE}` };
  failed += (await run("node", ["tests/shouq-voice.test.mjs"], { env: voiceEnv })) === 0 ? 0 : 1;
  failed += (await run("node", ["tests/shouq-clips.test.mjs"], { env: voiceEnv })) === 0 ? 0 : 1;
  srv.close();
  rmSync(vtmp, { recursive: true, force: true });
}

/* 3b — the live bridge, which is a BUILD-TIME switch.
   NEXT_PUBLIC_WAIN_TTS_URL is inlined at bundle time, so the harness above —
   built without it — can only ever exercise the branch where the bridge does
   not exist. A second bundle with the switch on is the only way to reach the
   other half, and it costs one esbuild rather than a second Next build. Every
   bridge response is fulfilled inside the browser by Playwright, so this
   server only ever serves the harness and the clip fixtures. */
console.log("\n════ شوق: the live bridge ════");
{
  const btmp = mkdtempSync(join(tmpdir(), "shouq-bridge-"));
  const okBundle = await run("npx", ["esbuild", "tests/harness/voice-harness.ts",
    "--bundle", "--format=iife", `--alias:@=${join(ROOT, "src")}`,
    '--define:process.env.NODE_ENV="production"',
    '--define:process.env.NEXT_PUBLIC_WAIN_TTS_URL="/tts"',
    `--outfile=${join(btmp, "voice.js")}`, "--log-level=error"]);
  if (okBundle !== 0) { console.error("could not bundle the bridge harness"); process.exit(1); }
  writeFileSync(join(btmp, "voice.html"),
    `<!doctype html><meta charset="utf-8"><title>voice</title><script src="./voice.js"></script>`);

  const { createServer } = await import("node:http");
  const { readFileSync } = await import("node:fs");
  const FIXTURES = join(ROOT, "tests/fixtures/voice");
  const TYPES = { ".js": "text/javascript", ".json": "application/json",
    ".mp3": "audio/mpeg", ".html": "text/html; charset=utf-8" };
  const srv = createServer((req, res) => {
    const url = req.url === "/" ? "/voice.html" : req.url.split("?")[0];
    const [base, name] = url.startsWith("/voice/")
      ? [FIXTURES, url.slice("/voice".length)]
      : [btmp, url];
    const f = join(base, name);
    if (!f.startsWith(base) || !existsSync(f)) { res.writeHead(404); return res.end("nope"); }
    res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((r) => srv.listen(PORT_BRIDGE, "127.0.0.1", r));
  failed += (await run("node", ["tests/shouq-bridge.test.mjs"],
    { env: { ...process.env, WAIN_URL: `http://127.0.0.1:${PORT_BRIDGE}` } })) === 0 ? 0 : 1;
  srv.close();
  rmSync(btmp, { recursive: true, force: true });
}

/* 4 — the button and the local voice path, against the shipping build. */
if (!existsSync(join(ROOT, "out", "index.html"))) build({});
console.log("\n════ شوق: the button and the voice flow ════");
{
  const stop = await serve(PORT_FLOW);
  failed += (await run("node", ["tests/shouq-flow.test.mjs"], { env: { ...process.env, WAIN_URL: `http://localhost:${PORT_FLOW}` } })) === 0 ? 0 : 1;
  stop();
}

/* 5 — agent mode, which needs the id compiled in. */
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
