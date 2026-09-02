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
 *   ELEVENLABS_API_KEY=...            # api key — the only required one
 *   ELEVEN_VOICE_SHOUQ=<voice-id>     # override شوق's voice
 *   ELEVEN_VOICE_SALEM=<voice-id>     # override سالم's voice
 *   ELEVEN_MODEL=eleven_multilingual_v2   # optional override
 *   ELEVEN_FORMAT=mp3_44100_64            # optional override
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

/**
 * The voices, when the environment does not name one.
 *
 * Chosen from what the workspace and the library actually hold, not from a
 * wishlist. The constraint that settled شوق: there is no young Kuwaiti female
 * voice in the ElevenLabs library at all. The only two `ar-kuwaiti` female
 * voices are both «Maryam», both recorded middle-aged, calm and unhurried for
 * storytelling. Everything young and female in Arabic is Levantine, Egyptian,
 * Syrian or Omani — and a Kuwaiti hears a Levantine «شلونك» instantly, while
 * the difference between twenty-five and forty is a thing you can push with
 * delivery. So accent wins the voice and RENDITION carries the age.
 *
 * سالم takes the Gulf male voice rather than either Modern Standard one, for
 * the same reason.
 *
 * ELEVEN_VOICE_SHOUQ / ELEVEN_VOICE_SALEM still override, and swapping either
 * now re-records — see the digest below, which did not use to include it.
 */
const DEFAULT_VOICE_IDS = {
  shouq: "w0uhBAmNIG5kUDeaFEsA", // Maryam Essa — ar-kuwaiti, female, warm
  salem: "Ywuz3KyW2N5pqKNpwcCL", // Eid — Gulf male, warm and clear
};
const VOICE_IDS = {
  shouq: process.env.ELEVEN_VOICE_SHOUQ || DEFAULT_VOICE_IDS.shouq,
  salem: process.env.ELEVEN_VOICE_SALEM || DEFAULT_VOICE_IDS.salem,
};

/**
 * How each persona is voiced.
 *
 * This used to be one flat block shared by both, which is wrong twice over.
 * شوق and سالم are not the same person, and the voice شوق has to use is
 * recorded calm and unhurried — which is not what someone answering «وين
 * أروح؟» sounds like.
 *
 * Stability is the lever. Lower means more varied and more expressive, and
 * expressiveness is most of what reads as young; style exaggerates the
 * speaker's own delivery on top of that, but past roughly 0.5 it starts
 * inventing artefacts on Arabic, so 0.45 is as far as this goes. Speed carries
 * the rest: a guide is brisk, a narrator is not.
 *
 * These follow the documented meaning of each parameter and the direction the
 * brief asks for; they are not a claim about how the result sounds. Run
 * `--sample` — one call — and listen before spending the other 225.
 */
const RENDITION = {
  shouq: {
    stability: 0.35,
    similarity_boost: 0.8,
    style: 0.45,
    use_speaker_boost: true,
    speed: 1.06,
  },
  salem: {
    stability: 0.45,
    similarity_boost: 0.8,
    style: 0.3,
    use_speaker_boost: true,
    speed: 1.0,
  },
};

// eleven_multilingual_v2 on purpose, not turbo: turbo trades quality for
// latency, and nothing here is realtime — every clip is rendered once at build
// time and served as a static file.
const MODEL = process.env.ELEVEN_MODEL ?? "eleven_multilingual_v2";

// 64kbps rather than 128. These are short spoken lines over a mobile
// connection, where speech at 64 is indistinguishable and the file is half the
// size — and this site counts its bytes everywhere else.
const OUTPUT_FORMAT = process.env.ELEVEN_FORMAT ?? "mp3_44100_64";

if (!DRY && !API_KEY) {
  if (CI) {
    console.log("gen-voice: ELEVENLABS_API_KEY not set — skipping clip generation.");
    process.exit(0);
  }
  console.error("gen-voice: ELEVENLABS_API_KEY is required (see docs/voice-setup.md).");
  process.exit(1);
}
// The two guards that used to stand here refused to run without
// ELEVEN_VOICE_SHOUQ and ELEVEN_VOICE_SALEM. Both voices now have a default
// chosen from the library, so there is nothing left to refuse: an override that
// is set is used, and one that is not falls back to a real voice rather than to
// an error message telling somebody to go and pick one.

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

const { buildClipLines, forSpeech, PERSONAS, places } = await loadLines();
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
  ]
    .map(forSpeech)
    .join(" ");

  const outDir = path.join(root, "docs/voice-sample");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "shouq-elevenlabs.mp3");

  console.log(`\nشوق — one sample, ${MODEL}, voice ${voiceId}\n`);
  console.log(text + "\n");
  await tts(voiceId, text, outFile, RENDITION.shouq);
  console.log(`Wrote ${path.relative(root, outFile)}. Listen before generating the rest.`);
}

async function tts(voiceId, text, outFile, settings) {
  // Overridable so the pipeline itself can be tested — the hashing, the
  // staleness decision and the manifest are worth exercising without spending
  // 226 paid calls to do it. See tests/voice-pipeline.test.mjs.
  const base = process.env.ELEVEN_API_BASE ?? "https://api.elevenlabs.io";
  const url = `${base}/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        voice_settings: settings,
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
    // The one failure that is a setup step rather than a fault, and the one
    // most likely to be hit on a first run. Both default voices are LIBRARY
    // voices; the API refuses any voice the workspace does not itself hold,
    // and says so in a way that reads like the id is wrong. It is not — it has
    // simply never been added. There is no API for adding it either, so the
    // only useful thing this can do is name the click.
    if (/voice_not_found/.test(body)) {
      throw new Error(
        `ElevenLabs does not have voice ${voiceId} in this workspace.\n` +
          `  It is a Voice Library voice, and a library voice has to be added before it can be used.\n` +
          `  Open https://elevenlabs.io/app/voice-library, find the voice, and press "Add to my voices".\n` +
          `  Then run this again — the id is correct, it is the workspace that is missing it.\n` +
          `  Which voices, and why those: docs/voice-setup.md`
      );
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
/**
 * ...and the same hole existed one level up.
 *
 * The hash covered the sentence and nothing else, so the manifest recorded the
 * voice and the model but never compared them. Change شوق's voice, her
 * stability, her speed, or the model, and every existing clip counted as
 * current: the site kept playing the old rendition for ever and nothing said
 * so. That is exactly the failure described above, and it bites hardest at the
 * moment someone sets out to improve how she sounds — the change appears to
 * succeed and is silently discarded.
 *
 * The rendition is now part of the identity of a clip, because it is.
 */
const digest = (text, voiceId, settings) =>
  createHash("sha256")
    .update(
      JSON.stringify({ text, voiceId, model: MODEL, format: OUTPUT_FORMAT, settings }),
      "utf8"
    )
    .digest("hex")
    .slice(0, 16);

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

const manifest = {
  version: 2,
  model: MODEL,
  format: OUTPUT_FORMAT,
  personas: {},
  clips: {},
  hashes: {},
  texts: {},
};
let generated = 0;
let restated = 0;
let skipped = 0;

for (const persona of personaIds) {
  const voiceId = VOICE_IDS[persona];
  const settings = RENDITION[persona];
  manifest.personas[persona] = { voiceId, settings };
  const outDir = path.join(root, "public/voice", persona);
  await mkdir(outDir, { recursive: true });

  // forSpeech before both the hash and the request, so what ElevenLabs
  // records is the same string the browser fallback utters — ١٨٧ read as a
  // number by both, an em dash pausing in both. Hashing the normalised text
  // also means a change to forSpeech itself re-records the affected clips,
  // which is the behaviour that keeps the two paths from drifting.
  const lines = buildClipLines(persona, places);
  for (const [key, raw] of Object.entries(lines)) {
    const text = forSpeech(raw);
    const id = `${persona}/${key}`;
    const outFile = path.join(outDir, `${key}.mp3`);
    const hash = digest(text, voiceId, settings);
    // A clip is current only if the file is there AND it was recorded from
    // this exact sentence. A version-1 manifest has no hashes at all, so its
    // clips are all treated as stale once — which is correct, since nothing
    // recorded what they say.
    const stale = previous.hashes?.[id] !== hash;
    if (existsSync(outFile) && !FORCE && !stale) {
      skipped++;
    } else {
      // "line changed" is no longer the only reason a clip goes stale — the
      // voice, the settings, the model and the format are all part of the hash
      // now, so say "rendition changed" when the sentence itself is the same.
      const why = !existsSync(outFile)
        ? "new"
        : previous.texts?.[id] === text
          ? "rendition changed"
          : "line changed";
      process.stdout.write(`  ${id} (${why}) … `);
      await tts(voiceId, text, outFile, settings);
      console.log("ok");
      if (why !== "new") restated++;
      generated++;
      await sleep(350); // be gentle with the API
    }
    manifest.clips[id] = `/voice/${persona}/${key}.mp3`;
    manifest.hashes[id] = hash;
    // The sentence itself, alongside the hash of the whole rendition. Kept so
    // the next run can tell a changed LINE from a changed VOICE — a hash can
    // only say that something moved, not which thing.
    manifest.texts[id] = text;
  }
}

await writeFile(
  path.join(root, "public/voice/manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);
console.log(
  `\ngen-voice: ${generated} generated (${restated} re-recorded), ` +
    `${skipped} kept, ${Object.keys(manifest.clips).length} clips in manifest.`
);
