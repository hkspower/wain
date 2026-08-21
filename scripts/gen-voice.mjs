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
 *   node scripts/gen-voice.mjs --sample   # ONE call: hear شوق before the rest
 *   node scripts/gen-voice.mjs            # generate missing and changed clips
 *   node scripts/gen-voice.mjs --force    # regenerate everything
 *   node scripts/gen-voice.mjs --dry-run  # print the lines, call nothing
 *   node scripts/gen-voice.mjs --ci       # exit 0 quietly when no key is set
 *
 * Start with --sample. The library is 226 paid calls and everything likely to
 * be wrong the first time is audible in the first five seconds.
 *
 * See docs/voice-setup.md for picking the two voices.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const DRY = args.has("--dry-run");
const CI = args.has("--ci");
const SAMPLE = args.has("--sample");

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
// --sample only records شوق, so it only needs her voice — somebody smoke-testing
// their key has usually picked one voice, not both.
if (!DRY && SAMPLE && !VOICE_IDS.shouq) {
  console.error("gen-voice --sample: set ELEVEN_VOICE_SHOUQ to an ElevenLabs voice ID.");
  process.exit(1);
}
if (!DRY && !SAMPLE && (!VOICE_IDS.shouq || !VOICE_IDS.salem)) {
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

/**
 * One line, one API call, one file you can actually listen to.
 *
 * Generating the library is 226 calls against a paid quota, and the things
 * most likely to be wrong on the first attempt — a mistyped key, a voice ID
 * from the wrong account, a model that renders Arabic badly, a voice that
 * turns out to sound nothing like a young Kuwaiti woman — are all audible in
 * the first five seconds. So hear those five seconds before spending the rest.
 *
 * The text is a real utterance in the shape she actually speaks: greeting,
 * suggestion, best time, the summer warning. Joined into one call rather than
 * four, because this is about the voice, not the queueing.
 */
async function sample() {
  const voiceId = VOICE_IDS.shouq;
  const lines = buildClipLines("shouq", places);
  const first = places[0];
  const text = [
    lines.hello,
    lines["suggest-intro"],
    lines[`place-${first.slug}`],
    lines[`best-${first.slug}`],
    lines["summer-outdoor"],
  ].join(" ");

  const outDir = path.join(root, "docs/voice-sample");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "shouq-elevenlabs.mp3");

  console.log(`\nشوق — one sample, ${MODEL}, voice ${voiceId}\n`);
  console.log(text + "\n");
  await tts(voiceId, text, outFile);
  console.log(`Wrote ${path.relative(root, outFile)}. Listen before generating the rest.`);
}

async function tts(voiceId, text, outFile) {
  // Overridable so the pipeline itself can be tested — the hashing, the
  // staleness decision and the manifest are worth exercising without spending
  // 226 paid calls to do it. See tests/voice-pipeline.test.mjs.
  const base = process.env.ELEVEN_API_BASE ?? "https://api.elevenlabs.io";
  const url = `${base}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
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

/**
 * Which line each clip was recorded from.
 *
 * voice-lines.ts says audio and fallback text "can never drift apart", and
 * that was not true: this script skipped any clip whose .mp3 already existed,
 * so editing a sentence left the old recording in place for ever. She would
 * then say one thing aloud and a different thing through the browser voice —
 * and the wrong one is the one people actually hear, because the clip path
 * wins whenever clips exist. Nothing would have reported it.
 *
 * The manifest now carries a hash of the exact text behind every clip, and a
 * clip whose text no longer matches is re-recorded. That is what makes the
 * promise in voice-lines.ts true rather than merely stated.
 */
const digest = (text) => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);

const previous = (() => {
  try {
    return JSON.parse(readFileSync(path.join(root, "public/voice/manifest.json"), "utf8"));
  } catch {
    return { clips: {}, hashes: {} };
  }
})();

if (SAMPLE) {
  await sample();
  process.exit(0);
}

const manifest = { version: 2, model: MODEL, personas: {}, clips: {}, hashes: {} };
let generated = 0;
let restated = 0;
let skipped = 0;

for (const persona of personaIds) {
  const voiceId = VOICE_IDS[persona];
  manifest.personas[persona] = { voiceId };
  const outDir = path.join(root, "public/voice", persona);
  await mkdir(outDir, { recursive: true });

  const lines = buildClipLines(persona, places);
  for (const [key, text] of Object.entries(lines)) {
    const id = `${persona}/${key}`;
    const outFile = path.join(outDir, `${key}.mp3`);
    const hash = digest(text);
    // A clip is current only if the file is there AND it was recorded from
    // this exact sentence. A version-1 manifest has no hashes at all, so its
    // clips are all treated as stale once — which is correct, since nothing
    // recorded what they say.
    const stale = previous.hashes?.[id] !== hash;
    if (existsSync(outFile) && !FORCE && !stale) {
      skipped++;
    } else {
      const why = existsSync(outFile) && stale ? "line changed" : "new";
      process.stdout.write(`  ${id} (${why}) … `);
      await tts(voiceId, text, outFile);
      console.log("ok");
      if (why === "line changed") restated++;
      generated++;
      await sleep(350); // be gentle with the API
    }
    manifest.clips[id] = `/voice/${persona}/${key}.mp3`;
    manifest.hashes[id] = hash;
  }
}

await writeFile(
  path.join(root, "public/voice/manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);
console.log(
  `\ngen-voice: ${generated} generated (${restated} because the line changed), ` +
    `${skipped} kept, ${Object.keys(manifest.clips).length} clips in manifest.`
);
