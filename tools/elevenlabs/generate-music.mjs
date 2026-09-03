#!/usr/bin/env node
// Generate the race score with ElevenLabs Music and drop it into
// public/music/, where src/game/music.ts crossfades between the two
// moods and falls back to its synthesized score when they are absent.
//
//   node tools/elevenlabs/generate-music.mjs --check     # key + reach
//   node tools/elevenlabs/generate-music.mjs --dry-run   # the brief
//   ELEVENLABS_API_KEY=sk_... node tools/elevenlabs/generate-music.mjs
//   ... --force                                          # re-generate
//
// Two tracks, because the game has two states and crossfades between
// them on the SP bar: `cruise` is the road when nothing is at stake,
// `battle` is a rival alongside you. They must share key, tempo and
// kit or the crossfade sounds like a radio being retuned mid-corner —
// that constraint is written into both prompts rather than hoped for.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "public", "music");
const API = "https://api.elevenlabs.io/v1/music";
// Match generate-sfx.mjs and ask for the best MP3 the account allows.
// Without it the API returns 128 kbps, and a music bed loses more to that
// than a half-second sound effect does.
const FORMAT = "?output_format=mp3_44100_192";

// One musical brief, split in two. Rocky techno: a live-sounding drum
// kit and distorted guitar over a four-on-the-floor techno spine —
// driving rather than euphoric, because this is a road at 2 a.m. and
// not a festival.
const COMMON =
  "Instrumental only, no vocals, no vocal chops. 128 BPM, A minor. " +
  "Rocky techno: hard four-on-the-floor kick, tight live-sounding snare " +
  "and hats, distorted electric guitar riffing in palm-muted eighths, " +
  "gritty analogue bass. Seamless loop with no intro and no ending. " +
  "Dry, close, punchy mix with room for engine noise on top — nothing " +
  "in the 80-250 Hz range should fight a V6.";

const TRACKS = {
  cruise: {
    file: "cruise.mp3",
    lengthMs: 96000,
    prompt:
      `${COMMON} This is the CRUISE state: the same groove held back. ` +
      "Guitar muted and low in the mix, drums steady without fills, one " +
      "hypnotic bass figure repeating. Tension held, never released — " +
      "the sound of looking for someone to race rather than racing.",
  },
  battle: {
    file: "battle.mp3",
    lengthMs: 96000,
    prompt:
      `${COMMON} This is the BATTLE state: the same key, tempo and kit ` +
      "as the cruise track, opened up. Distorted guitar riff forward and " +
      "aggressive, drums driving with fills, an octave-up synth lead " +
      "cutting over the top, bass distorted. Relentless, no breakdown, " +
      "no drop — it has to hold for a three-minute duel at full pace.",
  },
};

const args = process.argv.slice(2);
const force = args.includes("--force");
const names = args.filter((a) => !a.startsWith("--"));
const wanted = names.length ? names : Object.keys(TRACKS);

if (args.includes("--dry-run")) {
  console.log(`Would request ${wanted.length} track(s) from ${API}\n`);
  for (const n of wanted) {
    const t = TRACKS[n];
    if (!t) { console.error(`unknown track "${n}"`); continue; }
    console.log(`${n}  ->  public/music/${t.file}   ${t.lengthMs / 1000}s, looping`);
    console.log(`  "${t.prompt}"\n`);
  }
  console.log("Nothing was written. Drop --dry-run and set ELEVENLABS_API_KEY.");
  process.exit(0);
}

const key = process.env.ELEVENLABS_API_KEY;

if (args.includes("--check")) {
  console.log(`tracks    ${Object.keys(TRACKS).length} (${Object.keys(TRACKS).join(", ")})`);
  console.log(`key       ${key ? `present (${key.length} chars, ends ${key.slice(-4)})` : "MISSING — set ELEVENLABS_API_KEY"}`);
  let reach;
  try {
    const res = await fetch(API + FORMAT, {
      method: "POST",
      headers: { "xi-api-key": key || "none", "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test", music_length_ms: 10000 }),
    });
    const body = await res.text();
    if (res.status === 403 && /allowlist|egress/i.test(body)) {
      reach = "BLOCKED by this environment's egress policy — api.elevenlabs.io is not allowlisted";
    } else if (res.status === 401) reach = "reachable, but the key was rejected (401)";
    else if (res.ok) reach = "reachable, key accepted";
    else reach = `reachable, HTTP ${res.status}: ${body.slice(0, 90)}`;
  } catch (e) {
    reach = `unreachable: ${e.cause?.message || e.message}`;
  }
  console.log(`endpoint  ${reach}`);
  const good = /key accepted/.test(reach);
  console.log(good ? "\nready — run: node tools/elevenlabs/generate-music.mjs" : "\nnot ready; see tools/elevenlabs/README.md");
  process.exit(good ? 0 : 1);
}

if (!key) {
  console.error("Set ELEVENLABS_API_KEY (or pass --dry-run to review the brief).");
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, "manifest.json");
let have = [];
try {
  const cur = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (Array.isArray(cur)) have = cur;
} catch { /* fresh */ }

for (const name of wanted) {
  const t = TRACKS[name];
  if (!t) { console.error(`unknown track "${name}"`); continue; }
  const dest = join(OUT, t.file);
  if (existsSync(dest) && !force) {
    console.log(`${name.padEnd(7)} exists, skipping (--force to regenerate)`);
    if (!have.includes(name)) have.push(name);
    continue;
  }
  const res = await fetch(API + FORMAT, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: t.prompt, music_length_ms: t.lengthMs }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403 && /allowlist|egress/i.test(body)) {
      console.error(
        `${name}: blocked by this environment's network policy, not by ElevenLabs.\n` +
        `        ${body.trim().slice(0, 160)}\n` +
        `        Fix: allowlist api.elevenlabs.io, or run this from a machine with\n` +
        `        direct internet access and commit public/music/.`
      );
      break;
    }
    console.error(`${name}: HTTP ${res.status} ${body.slice(0, 120)}`);
    continue;
  }
  const audio = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, audio);
  if (!have.includes(name)) have.push(name);
  console.log(`${name.padEnd(7)} ${t.file}  ${(audio.length / 1024).toFixed(0)} KB`);
}

writeFileSync(manifestPath, JSON.stringify(have, null, 2) + "\n");
console.log(`\nmanifest lists ${have.length}/${Object.keys(TRACKS).length} tracks.`);
console.log("The game swaps from its synth score to these on next load.");
