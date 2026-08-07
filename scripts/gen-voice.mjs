#!/usr/bin/env node
/**
 * صوت وين — pre-renders every voice line as an ElevenLabs MP3.
 *
 * The site is a static export, so an API key can never ship in browser code;
 * instead this script runs at build time (locally or in CI) and writes the
 * finished clips into public/voice/, catalogued by manifest.json. The lines
 * themselves come from src/lib/voice-lines.ts — the same module the browser
 * engine reads — so audio and fallback text cannot drift apart.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=...            # api key (required)
 *   ELEVEN_VOICE_SHOUQ=<voice-id>     # young Kuwaiti female voice (required)
 *   ELEVEN_VOICE_SALEM=<voice-id>     # young Kuwaiti male voice (required)
 *   ELEVEN_MODEL=eleven_multilingual_v2   # optional override
 *
 *   node scripts/gen-voice.mjs            # generate missing clips
 *   node scripts/gen-voice.mjs --force    # regenerate everything
 *   node scripts/gen-voice.mjs --dry-run  # print the lines, call nothing
 *   node scripts/gen-voice.mjs --ci       # exit 0 quietly when no key is set
 *
 * See docs/voice-setup.md for picking the two voices.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const DRY = args.has("--dry-run");
const CI = args.has("--ci");

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_IDS = {
  shouq: process.env.ELEVEN_VOICE_SHOUQ,
  salem: process.env.ELEVEN_VOICE_SALEM,
};
const MODEL = process.env.ELEVEN_MODEL ?? "eleven_multilingual_v2";

if (!DRY && !API_KEY) {
  if (CI) {
    console.log("gen-voice: ELEVENLABS_API_KEY not set — skipping clip generation.");
    process.exit(0);
  }
  console.error("gen-voice: ELEVENLABS_API_KEY is required (see docs/voice-setup.md).");
  process.exit(1);
}
if (!DRY && (!VOICE_IDS.shouq || !VOICE_IDS.salem)) {
  console.error(
    "gen-voice: set ELEVEN_VOICE_SHOUQ and ELEVEN_VOICE_SALEM to ElevenLabs voice IDs.\n" +
      "Pick them from the ElevenLabs Voice Library (docs/voice-setup.md)."
  );
  process.exit(1);
}

// voice-lines.ts is TypeScript — bundle it (plus the place data it needs)
// into a temp ESM file we can import from Node.
async function loadLines() {
  const dir = await mkdtemp(path.join(tmpdir(), "wain-voice-"));
  const entry = path.join(dir, "entry.ts");
  const bundle = path.join(dir, "voice-lines.bundle.mjs");
  await writeFile(
    entry,
    `export * from ${JSON.stringify(path.join(root, "src/lib/voice-lines.ts"))};\n` +
      `export { places } from ${JSON.stringify(path.join(root, "src/lib/places.ts"))};\n`
  );
  execSync(
    `npx -y esbuild ${JSON.stringify(entry)} --bundle --format=esm ` +
      `--alias:@=${JSON.stringify(path.join(root, "src"))} ` +
      `--outfile=${JSON.stringify(bundle)}`,
    { stdio: "pipe", cwd: root }
  );
  const mod = await import(pathToFileURL(bundle).href);
  await rm(dir, { recursive: true, force: true });
  return mod;
}

const { buildClipLines, PERSONAS, places } = await loadLines();
const personaIds = Object.keys(PERSONAS);

if (DRY) {
  for (const persona of personaIds) {
    const lines = buildClipLines(persona, places);
    console.log(`\n=== ${persona} (${Object.keys(lines).length} clips) ===`);
    for (const [key, text] of Object.entries(lines)) console.log(`  ${key}: ${text}`);
  }
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tts(voiceId, text, outFile) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.3,
          use_speaker_boost: true,
        },
      }),
    });
    if (res.ok) {
      await writeFile(outFile, Buffer.from(await res.arrayBuffer()));
      return;
    }
    const body = await res.text().catch(() => "");
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = 1500 * 2 ** (attempt - 1);
      console.warn(`  ${res.status} — retrying in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    throw new Error(`ElevenLabs ${res.status} for ${path.basename(outFile)}: ${body.slice(0, 300)}`);
  }
}

const manifest = { version: 1, model: MODEL, personas: {}, clips: {} };
let generated = 0;
let skipped = 0;

for (const persona of personaIds) {
  const voiceId = VOICE_IDS[persona];
  manifest.personas[persona] = { voiceId };
  const outDir = path.join(root, "public/voice", persona);
  await mkdir(outDir, { recursive: true });

  const lines = buildClipLines(persona, places);
  for (const [key, text] of Object.entries(lines)) {
    const outFile = path.join(outDir, `${key}.mp3`);
    if (existsSync(outFile) && !FORCE) {
      skipped++;
    } else {
      process.stdout.write(`  ${persona}/${key} … `);
      await tts(voiceId, text, outFile);
      console.log("ok");
      generated++;
      await sleep(350); // be gentle with the API
    }
    manifest.clips[`${persona}/${key}`] = `/voice/${persona}/${key}.mp3`;
  }
}

await writeFile(
  path.join(root, "public/voice/manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);
console.log(
  `\ngen-voice: ${generated} generated, ${skipped} kept, ` +
    `${Object.keys(manifest.clips).length} clips in manifest.`
);
