#!/usr/bin/env node
// Generate the UI and reward sound effects with the ElevenLabs
// Sound Effects API and drop them in public/sfx/, where the game picks
// them up automatically.
//
//   ELEVENLABS_API_KEY=sk_... node scripts/generate-sfx.mjs
//
// Without them the game falls back to its procedural synth stings
// (src/game/sound.ts), so this step is optional — it just makes the
// interface sound like a shipped product instead of a prototype.
//
// Generation is billed per request, so an effect that already exists is
// never regenerated. Delete the mp3 to redo one.

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("Set ELEVENLABS_API_KEY (https://elevenlabs.io → profile → API key).");
  process.exit(1);
}

// Short, dry, and mixed to sit under the engine note rather than over it.
const EFFECTS = [
  {
    id: "ui-tap",
    seconds: 0.4,
    prompt:
      "Short crisp UI tap for a premium racing game menu. Tight synthetic click " +
      "with a soft low thump underneath, no reverb tail, dry and modern.",
  },
  {
    id: "ui-confirm",
    seconds: 0.8,
    prompt:
      "Confident UI confirm sound for a racing game. Two-note synthetic rise, " +
      "warm analog, slight metallic sheen, quick decay, no melody.",
  },
  {
    id: "xp-tick",
    seconds: 0.3,
    prompt:
      "Very short bright counter tick for numbers counting up on a scoreboard. " +
      "Tiny digital blip, dry, no tail.",
  },
  {
    id: "level-up",
    seconds: 2.2,
    prompt:
      "Level-up flourish for a night street racing game. Rising synth swell with " +
      "a bright shimmer at the peak and a deep sub drop underneath. Triumphant " +
      "but restrained, cinematic, no vocals, no melody line.",
  },
  {
    id: "unlock",
    seconds: 1.6,
    prompt:
      "Reward unlock sound: a mechanical latch release followed by a warm synth " +
      "bloom and a light metallic shimmer. Premium, satisfying, short tail.",
  },
  {
    id: "victory",
    seconds: 3,
    prompt:
      "Victory sting for a midnight street race. Dark cinematic hit, wide synth " +
      "brass swell, subtle darbuka hit at the front, deep sub tail. Confident, " +
      "Middle Eastern flavour, no vocals.",
  },
  {
    id: "defeat",
    seconds: 2.6,
    prompt:
      "Defeat sting for a street racing game. Descending detuned synth pad, " +
      "muted low piano note, air brake hiss far in the background. Deflating " +
      "but not comic, dark, no vocals.",
  },
  {
    id: "challenge",
    seconds: 1.8,
    prompt:
      "Tense challenge alert for a night racing game: headlights flashing. Two " +
      "hard synth stabs with a rising filtered noise sweep between them. " +
      "Aggressive, urgent, dry.",
  },
];

await mkdir("public/sfx", { recursive: true });
const done = [];

for (const { id, prompt, seconds } of EFFECTS) {
  const out = `public/sfx/${id}.mp3`;
  if (existsSync(out)) {
    console.log(`skip (exists): ${id}`);
    done.push(id);
    continue;
  }
  console.log(`generating ${id} (${seconds}s)…`);
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: {
      "xi-api-key": KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: seconds,
      // Lean towards the prompt rather than the model's own taste — these
      // need to be consistent with each other, not interesting.
      prompt_influence: 0.6,
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

await writeFile("public/sfx/manifest.json", JSON.stringify(done, null, 2));
console.log(
  `\nmanifest.json written with ${done.length}/${EFFECTS.length} effects.` +
    (done.length ? "\nStart the game — the interface picks them up automatically." : "")
);
