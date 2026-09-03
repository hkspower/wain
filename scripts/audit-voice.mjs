#!/usr/bin/env node
/**
 * Does شوق actually have a voice?   npm run audit:voice
 *
 * She did not, and nothing said so.
 *
 * `public/voice/manifest.json` shipped as `{"version": 0, "clips": {}}` — not
 * one recorded line for either persona — and the site behaves perfectly well
 * with that: `speak()` finds no clip, falls through to the browser's own
 * Arabic synthesiser, and says the sentence. Every test passes. Every audit
 * passes. The only symptom is that شوق sounds like a screen reader instead of
 * a Kuwaiti woman, which is invisible to everything except a person listening.
 *
 * That is the same shape as the export that sat on the server for months
 * referencing fourteen `/_next/` assets nobody had uploaded: a fallback quiet
 * enough that the failure never reaches anyone who could fix it. So this
 * counts what was recorded against what should be, and says it out loud.
 *
 * It does not fail the build on zero. The fallback is real and the site works;
 * refusing to build would be a lie about severity, and a scan that cannot go
 * green is a scan people stop reading. It warns, loudly, with the reason.
 *
 * It DOES fail on a manifest that promises clips it does not have, because
 * that is not a degraded voice — it is a 404 mid-sentence.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "public/voice/manifest.json");

let problems = 0;

/* ── what should exist ───────────────────────────────────────────────────────
   Asked of the generator rather than re-derived here. `--dry-run` needs no API
   key and prints exactly the lines it would record, so the expected set cannot
   drift from the thing that produces it — which a second copy of the line
   builder in this file certainly would. */
let expected;
try {
  const out = execFileSync("node", ["scripts/gen-voice.mjs", "--dry-run"], {
    cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  expected = {};
  let persona = null;
  for (const line of out.split("\n")) {
    const head = line.match(/^=== (\w+) \((\d+) clips\) ===/);
    if (head) { persona = head[1]; expected[persona] = new Set(); continue; }
    const clip = line.match(/^ {2}([\w-]+):/);
    if (clip && persona) expected[persona].add(clip[1]);
  }
} catch (e) {
  console.error("  ✗ could not ask gen-voice what it would record:", e.message);
  process.exit(1);
}

const personas = Object.keys(expected);
const want = personas.reduce((n, p) => n + expected[p].size, 0);

console.log("\n── صوت وين: what is actually recorded ──");

if (!existsSync(MANIFEST)) {
  console.log("  ✗ public/voice/manifest.json is missing entirely.");
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch (e) {
  console.log(`  ✗ manifest.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

const clips = manifest.clips ?? {};
const have = Object.keys(clips).length;

/* ── every clip the manifest claims must be on disk ────────────────────────
   A manifest entry is a promise that a file is there. speak() queues the URL
   and plays it; a missing file is silence in the middle of a sentence, after
   the visitor has already heard the first half. */
const missing = [];
const empty = [];
for (const [key, rel] of Object.entries(clips)) {
  const path = typeof rel === "string" ? rel : rel?.url ?? "";
  const file = join(ROOT, "public", path.replace(/^\//, ""));
  if (!existsSync(file)) { missing.push(`${key} → ${path}`); continue; }
  // A zero-length or near-zero mp3 plays as silence, which is the same
  // failure wearing a file's clothes.
  if (statSync(file).size < 512) empty.push(`${key} (${statSync(file).size}B)`);
}

if (missing.length) {
  console.log(`  ✗ ${missing.length} clip(s) named in the manifest are not on disk:`);
  for (const m of missing.slice(0, 8)) console.log(`      ${m}`);
  problems += missing.length;
}
if (empty.length) {
  console.log(`  ✗ ${empty.length} clip file(s) are too small to be audio:`);
  for (const m of empty.slice(0, 8)) console.log(`      ${m}`);
  problems += empty.length;
}

/* ── coverage ─────────────────────────────────────────────────────────────── */
const pct = want === 0 ? 0 : Math.round((have / want) * 100);
console.log(`  ${have} of ${want} lines recorded (${pct}%)` +
  personas.map((p) => `\n      ${p}: ${expected[p].size} lines`).join(""));

if (have === 0) {
  console.log("\n  ⚠ شوق has NO recorded voice. Every spoken line falls back to the");
  console.log("    browser's own Arabic synthesiser — which works, and does not sound");
  console.log("    like her. Nothing else in the build reports this, which is why this");
  console.log("    check exists.");
  console.log("\n    The blocker is one thing, and it is not the code:");
  console.log("      شوق's voice w0uhBAmNIG5kUDeaFEsA (Maryam Essa) is a LIBRARY voice,");
  console.log("      not a workspace voice, so the API answers voice_not_found. The");
  console.log("      workspace's four Arabic voices are all male.");
  console.log("      Fix: ElevenLabs → Voice Library → Add to my voices, then");
  console.log("           ELEVENLABS_API_KEY=… npm run voice:sample");
  console.log("      Same blocker stops the live agent — see docs/voice-setup.md.");
} else if (have < want) {
  const short = [];
  for (const p of personas) for (const k of expected[p]) if (!(k in clips)) short.push(k);
  console.log(`  ⚠ ${short.length} line(s) will fall back to the browser voice, e.g. ` +
    short.slice(0, 4).join(", "));
}

console.log(problems
  ? `\n${problems} thing(s) to look at.`
  : have === 0
    ? "\nThe manifest is honest — it promises nothing and delivers nothing."
    : "\nEvery clip the manifest promises is on disk and playable.");
process.exit(problems ? 1 : 0);
