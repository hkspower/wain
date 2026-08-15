#!/usr/bin/env node
// Generate the game's sound effects with ElevenLabs, at the highest
// quality the API serves, and write them straight into public/sfx/
// where src/game/sound.ts picks them up through the manifest.
//
//   export ELEVENLABS_API_KEY=sk_...
//   node tools/elevenlabs/generate-sfx.mjs            # all effects
//   node tools/elevenlabs/generate-sfx.mjs bump skid  # a subset
//   node tools/elevenlabs/generate-sfx.mjs --force    # regenerate all
//
// Output is mp3_44100_192 — 44.1 kHz at 192 kbps, the top MP3 tier of
// the sound-generation endpoint. Every effect that lands is added to
// public/sfx/manifest.json; effects that fail are skipped and the game
// keeps its synth voice for them, so a partial run is never harmful.
//
// NOTE for this repo's cloud sessions: api.elevenlabs.io is typically
// blocked by the org's network policy (CONNECT 403). Run this from a
// machine with normal internet access and your own API key.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "public", "sfx");
const API = "https://api.elevenlabs.io/v1/sound-generation";

// The roster. Prompts are written the way the model listens: material,
// action, environment, perspective, and what the sound must NOT have.
// Durations are seconds; "loop" marks the seamless slide bed.
const EFFECTS = {
  bump: {
    file: "impact.mp3",
    gain: 1.0,
    duration: 1.0,
    prompt:
      "Single heavy car-on-car collision at street-racing speed: deep metallic " +
      "thud with crumpling sheet metal, a short plastic bumper crack, and light " +
      "glass tinkle decaying quickly. Close perspective, tight and punchy, " +
      "night street ambience only in the tail. No horn, no voices, no music.",
  },
  scrape: {
    file: "scrape.mp3",
    gain: 0.9,
    duration: 1.2,
    prompt:
      "Car body grinding along a steel guardrail at highway speed: harsh " +
      "metal-on-metal scrape with sparks, high screeching resonance over a " +
      "low grinding bed, fading as the car pulls away. Close perspective. " +
      "No impact thud, no voices, no music.",
  },
  blowoff: {
    file: "blowoff.mp3",
    gain: 0.8,
    duration: 0.9,
    prompt:
      "Turbocharger blow-off valve on throttle lift: a sharp pneumatic " +
      "PSSH-tututu flutter, compressed air venting fast then fluttering out. " +
      "Recorded close to the intake, dry. No engine tone underneath, no music.",
  },
  shift: {
    file: "shift.mp3",
    gain: 0.6,
    duration: 0.4,
    prompt:
      "Quick racing sequential gearshift: a short mechanical clack with a " +
      "faint pneumatic hiss, tight and immediate. Interior perspective, dry. " +
      "No engine sound, no music.",
  },
  flash: {
    file: "flash.mp3",
    gain: 0.7,
    duration: 0.3,
    prompt:
      "A single car headlight stalk click: small precise plastic-and-spring " +
      "switch snap, interior close-up, completely dry. Nothing else.",
  },
  skid: {
    file: "skid-loop.mp3",
    gain: 0.9,
    duration: 6.0,
    loop: true,
    prompt:
      "Seamless loop of a sports car tire skid during a sustained drift on " +
      "asphalt: continuous rubber squeal with a slow warble, broad tearing " +
      "scrub underneath, constant intensity with no start and no ending so it " +
      "loops cleanly. No engine tone, no impacts, no music.",
  },
};

const args = process.argv.slice(2);
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const names = args.filter((a) => !a.startsWith("--"));
const wanted = names.length ? names : Object.keys(EFFECTS);

// --dry-run prints the roster and the exact request each effect would
// make, without a key and without touching the network. It is how you
// review the prompts from a machine that cannot reach the API — which,
// in this repo's cloud sessions, is every machine.
if (dryRun) {
  console.log(`Would request ${wanted.length} effect(s) from ${API}\n`);
  for (const name of wanted) {
    const def = EFFECTS[name];
    if (!def) { console.error(`unknown effect "${name}"`); continue; }
    console.log(`${name}  ->  public/sfx/${def.file}`);
    console.log(`  ${def.duration}s, gain ${def.gain}${def.loop ? ", looping" : ""}, prompt_influence 0.75`);
    console.log(`  "${def.prompt}"\n`);
  }
  console.log("Nothing was written. Drop --dry-run and set ELEVENLABS_API_KEY to generate.");
  process.exit(0);
}

const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error("Set ELEVENLABS_API_KEY first (or pass --dry-run to review the prompts).");
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, "manifest.json");
let manifest = {};
try {
  const cur = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (cur && !Array.isArray(cur) && typeof cur === "object") manifest = cur;
} catch {
  /* fresh manifest */
}

const generate = async (name, def) => {
  const dest = join(OUT, def.file);
  if (existsSync(dest) && !force && manifest[name]) {
    console.log(`${name.padEnd(8)} exists, skipping (use --force to regenerate)`);
    return true;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(`${API}?output_format=mp3_44100_192`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: def.prompt,
          duration_seconds: def.duration,
          // High influence keeps the model on the written brief instead
          // of improvising ambience around it
          prompt_influence: 0.75,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        // The egress proxy answers with a real 403 response rather than
        // failing the tunnel, and its body names the fix. Say so once
        // instead of retrying a policy decision four times.
        if (res.status === 403 && /allowlist|egress/i.test(body)) {
          console.error(
            `${name}: blocked by this environment's network policy, not by ElevenLabs.\n` +
            `        ${body.trim().slice(0, 160)}\n` +
            `        Fix: add api.elevenlabs.io to the environment's network egress allowlist,\n` +
            `        or run this script from a machine with direct internet access and commit\n` +
            `        the resulting public/sfx/ files.`
          );
          return false;
        }
        console.error(`${name}: HTTP ${res.status} ${body.slice(0, 120)}`);
        if (res.status === 401 || res.status === 422) return false; // no point retrying
        continue;
      }
      const audio = Buffer.from(await res.arrayBuffer());
      writeFileSync(dest, audio);
      manifest[name] = { file: def.file, gain: def.gain, ...(def.loop ? { loop: true } : {}) };
      console.log(`${name.padEnd(8)} ${def.file}  ${(audio.length / 1024).toFixed(0)} KB`);
      return true;
    } catch (e) {
      // Distinguish "the network refused us" from "the API said no" —
      // they need completely different fixes, and the raw fetch error
      // ("fetch failed") says neither.
      const cause = e.cause?.message || e.message || "";
      if (/403/.test(cause) || /CONNECT/i.test(cause) || /tunnel/i.test(cause)) {
        console.error(
          `${name}: blocked before reaching ElevenLabs — the egress proxy answered 403 to CONNECT.\n` +
          `        This is a network policy, not an API or key problem. Run this from a machine\n` +
          `        with direct internet access and commit the resulting public/sfx/ files.`
        );
        return false; // retrying a policy denial only wastes time
      }
      if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED/.test(cause)) {
        console.error(`${name}: cannot resolve or reach api.elevenlabs.io (${cause})`);
        return false;
      }
      console.error(`${name}: ${e.message}`);
    }
  }
  return false;
};

let ok = 0;
for (const name of wanted) {
  const def = EFFECTS[name];
  if (!def) {
    console.error(`unknown effect "${name}" — known: ${Object.keys(EFFECTS).join(", ")}`);
    continue;
  }
  if (await generate(name, def)) ok++;
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`\n${ok}/${wanted.length} effects ready; manifest lists ${Object.keys(manifest).length}.`);
console.log("The game picks them up on next load — no code changes needed.");
