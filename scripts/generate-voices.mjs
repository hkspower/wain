#!/usr/bin/env node
// Pre-render the game's Kuwaiti voice lines through ElevenLabs into
// public/voices/*.mp3 (+ manifest.json).
//
//   ELEVENLABS_API_KEY=sk_... node scripts/generate-voices.mjs
//   node scripts/generate-voices.mjs --check     # key + reachability
//   node scripts/generate-voices.mjs --dry-run   # the script, no key
//   node scripts/generate-voices.mjs --force     # re-render everything
//
// The web VoiceBox plays these clips when present and falls back to the
// browser's Arabic speech synthesis when they are absent. The Unity port
// caches the same lines at runtime (unity/Assets/Scripts/ElevenLabsVoice.cs).
//
// The roster is READ FROM src/game/rivals.ts, never copied. The previous
// version carried a hand-maintained table with the instruction "keep
// this table in sync" written above it, and it had already drifted: two
// rivals had been added to the game with no lines here at all, so they
// silently fell back to speech synthesis while the other six spoke in
// real voices. That is the same rot the UE5 and Unity generators exist
// to prevent, and it is prevented the same way — by parsing the source.

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

const API = "https://api.elevenlabs.io/v1/text-to-speech";
// Ask for the best MP3 the account is entitled to. Without this the API
// falls back to 128 kbps, which is what every clip generated before this
// line existed was rendered at. 192 needs Creator or above; on a lower
// tier the request is rejected rather than silently downgraded, so a 400
// here means the key, not the code.
const FORMAT = "?output_format=mp3_44100_192";
const MODEL = "eleven_multilingual_v2";

// Two voices, because one of the rivals is a woman and the roster says
// so. Generating her lines with the male voice — which is what happened
// before — is not a subtle flaw.
const VOICE_M = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB"; // Adam
const VOICE_F = process.env.ELEVENLABS_VOICE_ID_F || "EXAVITQu4vr4xnSDxMaL"; // Sarah

// Delivery per character. Missing entries fall back to the default, so a
// new rival still gets lines — just in a neutral read until tuned here.
const DELIVERY = {
  "abu-shanab": 0.4,
  "bint-aldeera": 0.5,
  "al-daboos": 0.4,
  "bu-machboos": 0.45,
  "al-saqer": 0.6,
  "shabah-alkhaleej": 0.9, // the ghost speaks slow and steady
};
const DEFAULT_STABILITY = 0.5;

// ---- the roster, read from the game -----------------------------------
const src = readFileSync("src/game/rivals.ts", "utf8");
const rivals = src
  .split(/\n  \{\n/)
  .slice(1)
  .map((b) => {
    const f = (re) => b.match(re)?.[1];
    const id = f(/\bid: "([^"]+)"/);
    if (!id) return null;
    const lines = {
      intro: f(/intro: "([^"]+)"/),
      win: f(/win: "([^"]+)"/),
      lose: f(/lose: "([^"]+)"/),
    };
    return { id, lines, female: /female:\s*true/.test(b) };
  })
  .filter(Boolean);

if (rivals.length < 4) {
  console.error(`rival parse failed (${rivals.length} found) — has rivals.ts changed shape?`);
  process.exit(1);
}
for (const r of rivals) {
  for (const k of ["intro", "win", "lose"]) {
    if (!r.lines[k]) {
      console.error(`${r.id}: no ${k} line in rivals.ts`);
      process.exit(1);
    }
  }
}

// The announcer and the UI confirmations are not tied to a rival.
const LINES = [
  ["announcer-start", "يلا! دور على خصمك", 0.5, false],
  ["announcer-champion", "مبروك! إنت ملك شارع الخليج", 0.5, false],
  ["voices-on", "الأصوات شغالة", 0.5, false],
  ...rivals.flatMap((r) =>
    ["intro", "win", "lose"].map((k) => [
      `${r.id}-${k}`,
      r.lines[k],
      DELIVERY[r.id] ?? DEFAULT_STABILITY,
      r.female,
    ])
  ),
];

const args = process.argv.slice(2);
const force = args.includes("--force");

if (args.includes("--dry-run")) {
  console.log(`${rivals.length} rivals, ${LINES.length} clips\n`);
  for (const [id, text, stability, female] of LINES) {
    console.log(`${id.padEnd(26)} ${female ? "F" : "M"}  stability ${stability}`);
    console.log(`  ${text}`);
  }
  console.log("\nNothing was written. Drop --dry-run and set ELEVENLABS_API_KEY to generate.");
  process.exit(0);
}

const KEY = process.env.ELEVENLABS_API_KEY;

if (args.includes("--check")) {
  console.log(`roster    ${rivals.length} rivals from src/game/rivals.ts, ${LINES.length} clips`);
  console.log(`key       ${KEY ? `present (${KEY.length} chars, ends ${KEY.slice(-4)})` : "MISSING — set ELEVENLABS_API_KEY"}`);
  let reach;
  try {
    const res = await fetch(`${API}/${VOICE_M}${FORMAT}`, {
      method: "POST",
      headers: { "xi-api-key": KEY || "none", "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: "test", model_id: MODEL }),
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
  console.log(good ? "\nready — run: node scripts/generate-voices.mjs" : "\nnot ready; see tools/elevenlabs/README.md");
  process.exit(good ? 0 : 1);
}

if (!KEY) {
  console.error("Set ELEVENLABS_API_KEY (or pass --dry-run to review the script).");
  process.exit(1);
}

await mkdir("public/voices", { recursive: true });
const done = [];
for (const [id, text, stability, female] of LINES) {
  const out = `public/voices/${id}.mp3`;
  if (existsSync(out) && !force) {
    console.log(`skip (exists): ${id}`);
    done.push(id);
    continue;
  }
  const res = await fetch(`${API}/${female ? VOICE_F : VOICE_M}${FORMAT}`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: { stability, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403 && /allowlist|egress/i.test(body)) {
      console.error(
        `${id}: blocked by this environment's network policy, not by ElevenLabs.\n` +
        `        ${body.trim().slice(0, 160)}\n` +
        `        Fix: allowlist api.elevenlabs.io, or run this from a machine with\n` +
        `        direct internet access and commit public/voices/.`
      );
      break; // a policy denial will not clear on the next line
    }
    console.error(`FAILED ${id}: ${res.status} ${body.slice(0, 120)}`);
    continue;
  }
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log(`generated: ${id}${female ? "  (F)" : ""}`);
  done.push(id);
}
await writeFile("public/voices/manifest.json", JSON.stringify(done, null, 2) + "\n");
console.log(`\nmanifest.json written with ${done.length}/${LINES.length} clips.`);
