#!/usr/bin/env node
// Verify a sound drop before it is committed.
//
//   npm run sfx:verify
//
// The game is deliberately forgiving about audio: a missing file, a
// broken file or a malformed manifest all fall back to the synth voice
// in silence. That is right at runtime and useless at commit time —
// every failure mode looks exactly like success. So this checks the
// drop the way the game cannot afford to.

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SFX = join(ROOT, "public", "sfx");
const MANIFEST = join(SFX, "manifest.json");

const fail = [];
const bad = (m) => fail.push(m);
const ok = (m) => console.log(`  ok    ${m}`);

// --- the manifest itself ---------------------------------------------
if (!existsSync(MANIFEST)) {
  console.error("no public/sfx/manifest.json — nothing to verify");
  process.exit(2);
}
let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch (e) {
  console.error(`manifest.json is not valid JSON: ${e.message}`);
  process.exit(1);
}
// The loader rejects a non-object outright (src/game/sound.ts), so an
// array here means every sample silently never loads.
if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
  console.error("manifest.json must be a JSON object — an array or null is ignored by the game entirely");
  process.exit(1);
}

const names = Object.keys(manifest);
console.log(`manifest lists ${names.length} sample${names.length === 1 ? "" : "s"}`);
if (names.length === 0) {
  console.log("\nEmpty manifest: the game runs fully synthesized. That is the shipping default.");
  process.exit(0);
}

// The roster the game actually asks for, from the generator's own table.
const gen = readFileSync(join(ROOT, "tools", "elevenlabs", "generate-sfx.mjs"), "utf8");
const known = [...gen.matchAll(/^ {2}(\w+): \{$/gm)].map(([, k]) => k);

// --- each entry -------------------------------------------------------
for (const [name, e] of Object.entries(manifest)) {
  if (!e || typeof e !== "object") { bad(`${name}: entry is not an object`); continue; }
  if (typeof e.file !== "string" || !e.file) { bad(`${name}: no file`); continue; }
  if (known.length && !known.includes(name)) {
    bad(`${name}: not a sound the game asks for (known: ${known.join(", ")})`);
  }
  const p = join(SFX, e.file);
  if (!existsSync(p)) { bad(`${name}: ${e.file} is listed but not present`); continue; }

  const size = statSync(p).size;
  // A few hundred bytes is an error page or a truncated download, not audio.
  if (size < 2048) { bad(`${name}: ${e.file} is only ${size} B — truncated or an error body`); continue; }

  // Is it actually audio? MP3 (ID3 tag or an MPEG frame sync) or WAV.
  const head = readFileSync(p).subarray(0, 64);
  const isId3 = head.subarray(0, 3).toString("latin1") === "ID3";
  let isFrame = false;
  for (let i = 0; i < head.length - 1; i++) {
    if (head[i] === 0xff && (head[i + 1] & 0xe0) === 0xe0) { isFrame = true; break; }
  }
  const isWav = head.subarray(0, 4).toString("latin1") === "RIFF" &&
                head.subarray(8, 12).toString("latin1") === "WAVE";
  if (!isId3 && !isFrame && !isWav) {
    bad(`${name}: ${e.file} does not start like MP3 or WAV — check what the API actually returned`);
    continue;
  }

  const gain = e.gain ?? 1;
  if (typeof gain !== "number" || !(gain > 0) || gain > 4) {
    bad(`${name}: gain ${e.gain} is out of range`);
    continue;
  }
  // Only the slide bed loops; a looping one-shot drones forever.
  if (e.loop && name !== "skid") bad(`${name}: loop:true on a one-shot`);
  if (name === "skid" && !e.loop) bad("skid: the slide bed must be loop:true or it fires once and stops");

  ok(`${name.padEnd(8)} ${e.file.padEnd(16)} ${(size / 1024).toFixed(0).padStart(5)} KB  gain ${gain}${e.loop ? "  loop" : ""}`);
}

// Files present but unlisted are dead weight in the bundle.
for (const f of ["impact.mp3", "scrape.mp3", "blowoff.mp3", "shift.mp3", "flash.mp3", "skid-loop.mp3"]) {
  const listed = Object.values(manifest).some((e) => e && e.file === f);
  if (!listed && existsSync(join(SFX, f))) {
    bad(`${f} is in public/sfx but no manifest entry points at it — it ships and never plays`);
  }
}

if (fail.length) {
  console.error("\nFAILURES:\n - " + fail.join("\n - "));
  process.exit(1);
}
console.log("\nthe sound drop is well formed");
