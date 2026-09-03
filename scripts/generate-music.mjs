#!/usr/bin/env node
// Generate the game's two background tracks with the ElevenLabs Music API
// and drop them in public/music/, where the game picks them up
// automatically.
//
//   ELEVENLABS_API_KEY=sk_... node scripts/generate-music.mjs
//
// Without generated tracks the game falls back to a procedural synth
// score (src/game/music.ts), so this step is optional — it just makes the
// soundtrack a lot better.
//
// Music generation is a paid ElevenLabs feature and is billed per second
// of audio, so this script refuses to regenerate a track that already
// exists. Delete the mp3 to redo one.

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("Set ELEVENLABS_API_KEY (https://elevenlabs.io → profile → API key).");
  process.exit(1);
}

const LENGTH_MS = Number(process.env.MUSIC_LENGTH_MS || 60000); // 60 s loops

const TRACKS = [
  {
    id: "cruise",
    prompt:
      "Late-night Gulf Road cruising instrumental. Slow, hypnotic synthwave with " +
      "a warm analog bass pulse, sparse arpeggios, wide reverb pads, and a " +
      "subtle Middle Eastern oud motif drifting over the top. Minor key, " +
      "unhurried, atmospheric, no vocals, no drums for the first bars. " +
      "Feels like empty highway at 2am beside the sea. Seamless loop.",
  },
  {
    id: "battle",
    prompt:
      "High-tension street racing battle instrumental. Driving four-on-the-floor " +
      "kick, aggressive distorted synth bass, urgent staccato strings, and a " +
      "darbuka-flavoured percussion layer under it. Dark minor key, relentless " +
      "forward momentum, builds without ever resolving. No vocals. " +
      "Seamless loop.",
  },
];

await mkdir("public/music", { recursive: true });
const done = [];

for (const { id, prompt } of TRACKS) {
  const out = `public/music/${id}.mp3`;
  if (existsSync(out)) {
    console.log(`skip (exists): ${id}`);
    done.push(id);
    continue;
  }
  console.log(`generating ${id} (${LENGTH_MS / 1000}s)…`);
  const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192", {
    method: "POST",
    headers: {
      "xi-api-key": KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      prompt,
      music_length_ms: LENGTH_MS,
    }),
  });
  if (!res.ok) {
    console.error(`FAILED ${id}: ${res.status} ${await res.text()}`);
    continue;
  }
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log(`  wrote ${out}`);
  done.push(id);
}

await writeFile("public/music/manifest.json", JSON.stringify(done, null, 2));
console.log(
  `\nmanifest.json written with ${done.length}/${TRACKS.length} tracks.` +
    (done.length ? "\nStart the game — the tracks load and crossfade automatically." : "")
);
