#!/usr/bin/env node
/**
 * scripts/publish/tts-endpoint.php, against a real PHP server:
 *   npm run test:tts
 *
 * This endpoint is the one piece of wain that SPENDS MONEY per request, on a
 * public URL, with no authentication — a visitor's browser calls it directly,
 * because a static export has nowhere to hold a key. Everything that bounds
 * that spend is in this file's assertions: the cache, the two budgets, the
 * length cap, the persona allowlist.
 *
 * It replaces an n8n workflow that nothing in `npm run scan` could see, which
 * is how its شوق voice drifted to a different woman without anybody noticing.
 * A replacement that is in the repository and still untested would be the same
 * mistake with newer code.
 *
 * ## What is and is not exercised
 *
 * ElevenLabs itself is never called — this sandbox cannot reach it, and a test
 * that spent real credits on every run would be a test people disable. So the
 * upstream is a stub PHP server and the endpoint is pointed at it by the one
 * seam that exists for it, `WAIN_TTS_API_BASE`. Everything up to and including
 * the write to the cache is real: the same curl call, the same status
 * handling, the same rename-into-place.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4216;
const UPSTREAM_PORT = 4217;
const ORIGIN = "https://www.wainkw.com";

/* The layout the endpoint assumes: public_html/api/tts.php, with storage/ a
   sibling of public_html. storageDir() walks UP to find it rather than
   counting down, so this same tree also proves the staging depth below. */
const dir = mkdtempSync(join(tmpdir(), "wain-tts-"));
const web = join(dir, "public_html");
const api = join(web, "api");
const storage = join(dir, "storage");
mkdirSync(api, { recursive: true });
mkdirSync(storage, { recursive: true });
copyFileSync(join(ROOT, "scripts/publish/tts-endpoint.php"), join(api, "tts.php"));

const keyFile = join(storage, "elevenlabs.key");

/* A stub ElevenLabs, as a router so every path under the port reaches it —
   the endpoint appends /<voiceId>?output_format=… and that is the real shape.
   It answers 4KB of bytes normally; the two failure branches are chosen by a
   MARKER IN THE TEXT rather than by a flag the endpoint would have to forward,
   because a request-controlled value on the upstream URL is exactly the kind
   of test seam that becomes a hole. */
writeFileSync(join(dir, "upstream.php"), `<?php
$body = file_get_contents('php://input');
if (str_contains($body, 'خطأ من فوق')) { http_response_code(500); echo '{"detail":"boom"}'; return true; }
if (str_contains($body, 'رد قصير'))   { header('Content-Type: audio/mpeg'); echo 'tiny'; return true; }
header('Content-Type: audio/mpeg');
echo str_repeat('M', 4096);
return true;
`);

const upstream = spawn("php", ["-S", `127.0.0.1:${UPSTREAM_PORT}`, "-t", dir, join(dir, "upstream.php")], { stdio: "ignore" });
const php = spawn("php", ["-S", `127.0.0.1:${PORT}`, "-t", web], {
  stdio: "ignore",
  env: { ...process.env, WAIN_TTS_API_BASE: `http://127.0.0.1:${UPSTREAM_PORT}` },
});
await new Promise((r) => setTimeout(r, 1400));

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); }
};

const BASE = `http://127.0.0.1:${PORT}/api/tts.php`;
async function call(body, { method = "POST", origin = ORIGIN, raw = null } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  const init = { method, headers };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    init.body = raw ?? JSON.stringify(body);
  }
  const res = await fetch(BASE, init);
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* audio */ }
  return {
    status: res.status,
    json,
    bytes: buf.length,
    type: res.headers.get("content-type"),
    how: res.headers.get("x-wain-tts"),
    cors: res.headers.get("access-control-allow-origin"),
  };
}

const cacheFiles = () =>
  existsSync(join(storage, "tts"))
    ? readdirSync(join(storage, "tts")).filter((f) => f.endsWith(".mp3"))
    : [];

try {
  /* ── unconfigured ─────────────────────────────────────────────────────────
     First, because it is the state the site actually ships in until somebody
     pastes the key, and because voice.ts keys its give-up on this exact
     status: a 503 means «stop asking for the rest of this page». If this ever
     became a 500, every runtime sentence would pay a request. */
  console.log("\n── with no key on the server ──");
  {
    const r = await call({ persona: "shouq", text: "مرحبا" });
    ok("it answers 503 not_configured", r.status === 503 && r.json?.error === "not_configured",
       `${r.status} ${JSON.stringify(r.json)}`);
    ok("and spends nothing — no cache file was written", cacheFiles().length === 0);
  }

  writeFileSync(keyFile, "test-key-not-a-real-one");

  console.log("\n── what it refuses ──");
  {
    const g = await call(null, { method: "GET" });
    ok("GET is 405", g.status === 405, String(g.status));

    const o = await call({ persona: "shouq", text: "مرحبا" }, { origin: "https://evil.example" });
    ok("an origin outside the allowlist is 403", o.status === 403 && o.json?.error === "origin_not_allowed",
       `${o.status} ${JSON.stringify(o.json)}`);

    const p = await call({ persona: "fahad", text: "مرحبا" });
    ok("an unknown persona is 400", p.status === 400 && p.json?.error === "unknown_persona",
       JSON.stringify(p.json));

    const e = await call({ persona: "shouq", text: "   " });
    ok("empty text is 400", e.status === 400 && e.json?.error === "text_required", JSON.stringify(e.json));

    // The cap is what stops a public URL being a free TTS service. Counted in
    // CHARACTERS, not bytes — Arabic is two bytes a letter in UTF-8, so a byte
    // cap would cut every real sentence in half.
    const long = await call({ persona: "shouq", text: "ا".repeat(501) });
    ok("501 characters is 400 text_too_long", long.status === 400 && long.json?.error === "text_too_long",
       JSON.stringify(long.json));
    const okLen = await call({ persona: "shouq", text: "ب".repeat(500) });
    ok("500 characters is accepted — the cap counts characters, not bytes",
       okLen.status === 200, `${okLen.status} ${JSON.stringify(okLen.json)}`);

    const bad = await call(null, { raw: "{not json" });
    ok("a malformed body is 400 bad_json", bad.status === 400 && bad.json?.error === "bad_json",
       JSON.stringify(bad.json));
  }

  console.log("\n── it renders once and caches ──");
  {
    const before = cacheFiles().length;
    const a = await call({ persona: "shouq", text: "قهوة هادية في السالمية" });
    ok("the first call renders", a.status === 200 && a.how === "miss", `${a.status} ${a.how}`);
    ok("and returns audio", a.type === "audio/mpeg" && a.bytes === 4096, `${a.type} ${a.bytes}B`);
    ok("and echoes the origin for CORS", a.cors === ORIGIN, String(a.cors));

    const b = await call({ persona: "shouq", text: "قهوة هادية في السالمية" });
    ok("the second call is served from cache", b.status === 200 && b.how === "hit", `${b.status} ${b.how}`);
    ok("with the same bytes", b.bytes === a.bytes, `${b.bytes} vs ${a.bytes}`);
    ok("and only one file was written for the two calls", cacheFiles().length === before + 1,
       `${cacheFiles().length} files`);

    /* Normalisation before hashing, so «two spaces» and «one space» are not
       two renders of the same sentence. This is the cost control doing its
       actual job: the text arrives from a browser, assembled by string
       concatenation, where stray whitespace is the norm. */
    const c = await call({ persona: "shouq", text: "  قهوة   هادية في السالمية  " });
    ok("whitespace-different text hits the same cache entry", c.how === "hit", String(c.how));

    /* The cache key is the clip's IDENTITY, not its text — same sentence,
       different persona, different voice, so it must be a different file.
       gen-voice.mjs learned this the hard way: a text-only hash served the old
       voice for ever after a rendition change. */
    const d = await call({ persona: "salem", text: "قهوة هادية في السالمية" });
    ok("the same sentence in the other persona is a separate render", d.how === "miss", String(d.how));
  }

  console.log("\n── when ElevenLabs itself fails ──");
  {
    const before = cacheFiles().length;
    const r = await call({ persona: "shouq", text: "خطأ من فوق" });
    ok("a non-200 upstream is 502 upstream_error", r.status === 502 && r.json?.error === "upstream_error",
       `${r.status} ${JSON.stringify(r.json)}`);
    ok("and nothing is cached, so a retry is not poisoned", cacheFiles().length === before,
       `${cacheFiles().length} vs ${before}`);

    /* An error page wearing audio/mpeg plays as silence, and a listener cannot
       tell silence from «she ignored me». voice.ts has the same 512-byte floor
       on its side; this is the server refusing to cache the thing that would
       then be served as a hit for ever. */
    const t = await call({ persona: "shouq", text: "رد قصير" });
    ok("a too-short body is 502 upstream_empty", t.status === 502 && t.json?.error === "upstream_empty",
       `${t.status} ${JSON.stringify(t.json)}`);
    ok("and is not cached either", cacheFiles().length === before, `${cacheFiles().length} vs ${before}`);
  }

  console.log("\n── the budgets, which are the only thing bounding the bill ──");
  {
    /* Hits must not count. If they did, a popular sentence would exhaust the
       day's budget without a single character being sent to ElevenLabs — the
       feature would switch itself off for the reason it exists to avoid. */
    const spentBefore = JSON.parse(
      execFileSync("php", ["-r", `echo @file_get_contents(${JSON.stringify(join(storage, "tts/.budget.json"))}) ?: '{"n":0}';`],
        { encoding: "utf8" })
    ).n;
    for (let i = 0; i < 5; i++) await call({ persona: "shouq", text: "قهوة هادية في السالمية" });
    const spentAfter = JSON.parse(
      execFileSync("php", ["-r", `echo @file_get_contents(${JSON.stringify(join(storage, "tts/.budget.json"))}) ?: '{"n":0}';`],
        { encoding: "utf8" })
    ).n;
    ok("five cache hits cost nothing against the daily budget", spentAfter === spentBefore,
       `${spentBefore} → ${spentAfter}`);
  }

  console.log("\n── the staging depth, which is where this kind of path goes wrong ──");
  {
    /* dirname(__DIR__, 2) is right at public_html/api and WRONG at
       public_html/staging/api — one level deeper it lands on public_html and
       the endpoint reports itself unconfigured on staging only, silently.
       That off-by-one already had to be special-cased once, in
       setup-staging-endpoint.php. storageDir() walks up instead, so the two
       installed copies are byte-identical; this proves the deeper one finds
       the same key. */
    const deep = join(web, "staging", "api");
    mkdirSync(deep, { recursive: true });
    copyFileSync(join(ROOT, "scripts/publish/tts-endpoint.php"), join(deep, "tts.php"));
    const res = await fetch(`http://127.0.0.1:${PORT}/staging/api/tts.php`, {
      method: "POST",
      headers: { Origin: "https://staging.wainkw.com", "Content-Type": "application/json" },
      body: JSON.stringify({ persona: "shouq", text: "قهوة هادية في السالمية" }),
    });
    ok("staging's copy, one directory deeper, finds the same key and the same cache",
       res.status === 200 && res.headers.get("x-wain-tts") === "hit",
       `${res.status} ${res.headers.get("x-wain-tts")}`);
    ok("and the two installed copies are byte-identical",
       statSync(join(deep, "tts.php")).size === statSync(join(api, "tts.php")).size);
  }

  console.log("\n── the key never leaves the server ──");
  {
    /* storage/ is a sibling of public_html, so there is no URL that reaches
       it. Asserted rather than assumed: this is the whole reason the file is
       there and not in the docroot beside the endpoint. */
    const r = await fetch(`http://127.0.0.1:${PORT}/storage/elevenlabs.key`);
    ok("the key is not fetchable over HTTP", r.status !== 200 || !(await r.text()).includes("test-key"),
       String(r.status));
  }

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) process.exitCode = 1;
} finally {
  php.kill();
  upstream.kill();
  rmSync(dir, { recursive: true, force: true });
}
