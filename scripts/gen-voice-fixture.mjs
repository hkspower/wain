#!/usr/bin/env node
/**
 * Placeholder audio for شوق, with no API key:  npm run voice:fixture
 *
 * This is NOT her voice, and is not meant to be mistaken for it. espeak-ng is
 * a formant synthesiser from the 1990s reading unvowelled Arabic; it sounds
 * like a robot and gets some words wrong. What it gives us is two things the
 * real voice cannot give us yet, because the real voice needs a paid key that
 * is not set:
 *
 *   1. Something audible. The lines شوق speaks have only ever existed as
 *      strings in a TypeScript file. Hearing the actual sequence — greeting,
 *      then a suggestion, then when to go, then the summer warning — is how
 *      you notice that a sentence runs on, or that two clips collide, or that
 *      an Arabic-Indic numeral is read as digits. Those are faults in the
 *      script, and the script is what we can fix today.
 *
 *   2. Real MP3s to test with. voice.ts has two playback paths and only the
 *      synthetic one was ever tested, because the other needs actual files:
 *      manifest lookup, all-or-nothing clip resolution, and a queue that
 *      advances on 'ended'. That path is the one that runs in production the
 *      moment the clips are generated. It now has fixtures.
 *
 * Outputs:
 *   docs/voice-sample/shouq-placeholder.mp3   one continuous utterance, to hear
 *   tests/fixtures/voice/<key>.mp3            one file per clip, to test with
 *
 * Requires espeak-ng and lame. Both are packaged everywhere:
 *   apt-get install -y espeak-ng lame
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const tool of ["espeak-ng", "lame"]) {
  try {
    execFileSync("sh", ["-c", `command -v ${tool}`], { stdio: "pipe" });
  } catch {
    console.error(`voice:fixture needs ${tool} — apt-get install -y espeak-ng lame`);
    process.exit(1);
  }
}

// Same trick gen-voice.mjs uses: the lines live in TypeScript, so bundle the
// module rather than duplicating a single sentence of it here. Duplicated
// copy is exactly the drift this whole pipeline is built to avoid.
function loadLines() {
  const dir = mkdtempSync(path.join(tmpdir(), "wain-fixture-"));
  const entry = path.join(dir, "entry.ts");
  const bundle = path.join(dir, "lines.mjs");
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, "src/lib/voice-lines.ts"))};\n` +
      `export { places } from ${JSON.stringify(path.join(root, "src/lib/places.ts"))};\n`
  );
  execSync(
    `npx esbuild ${JSON.stringify(entry)} --bundle --format=esm ` +
      `--alias:@=${JSON.stringify(path.join(root, "src"))} ` +
      `--outfile=${JSON.stringify(bundle)}`,
    { stdio: "pipe", cwd: root }
  );
  return { href: pathToFileURL(bundle).href, dir };
}

const { href, dir } = loadLines();
const { buildClipLines, places } = await import(href);
rmSync(dir, { recursive: true, force: true });

const lines = buildClipLines("shouq", places);

/**
 * -p 70 lifts the pitch: espeak's Arabic voice is male and شوق is not. It does
 * not make it a woman's voice, it makes it an obviously-synthetic one that is
 * at least in the right register to listen to a script through.
 * -s 140 is a shade under conversational, because unvowelled Arabic run at
 * full speed is genuinely hard to follow.
 */
const VOICE = ["-v", "ar", "-p", "70", "-s", "140"];

function say(text, outMp3, kbps) {
  const wav = outMp3.replace(/\.mp3$/, ".wav");
  execFileSync("espeak-ng", [...VOICE, text, "-w", wav], { stdio: "pipe" });
  execFileSync("lame", ["--quiet", "-b", String(kbps), "-m", "m", wav, outMp3], { stdio: "pipe" });
  rmSync(wav, { force: true });
  return statSync(outMp3).size;
}
// The sample is for a person to listen to; the fixtures exist to be decoded by
// a test that never listens, and they live in git for ever, so they are encoded
// at the lowest bitrate that is still unambiguously speech.
const SAMPLE_KBPS = 96;
const FIXTURE_KBPS = 32;

// ---- 1. one continuous utterance, for a person to listen to ----------------
const first = places[0];
const script = [
  lines.hello,
  lines["suggest-intro"],
  lines[`place-${first.slug}`],
  lines[`best-${first.slug}`],
  lines["summer-outdoor"],
];
const sampleDir = path.join(root, "docs/voice-sample");
mkdirSync(sampleDir, { recursive: true });
const sampleFile = path.join(sampleDir, "shouq-placeholder.mp3");
const sampleBytes = say(script.join(" "), sampleFile, SAMPLE_KBPS);
writeFileSync(
  path.join(sampleDir, "shouq-placeholder.txt"),
  script.join("\n") + "\n"
);

// ---- 2. one file per clip, for the tests -----------------------------------
// A handful, not all 113: these are fixtures for the playback path, and the
// path does not care how many files exist. Chosen to cover one of each shape
// the resolver handles — a greeting, the two connectors, a place suggestion,
// a best-time line, and a short name.
const FIXTURES = [
  "hello",
  "suggest-intro",
  "related-intro",
  "search-empty",
  `place-${first.slug}`,
  `best-${first.slug}`,
  `name-${places[1].slug}`,
];
// Laid out exactly as public/voice/ is, so the test server can hand these to
// the browser under the real URLs and voice.ts cannot tell the difference.
const fixtureDir = path.join(root, "tests/fixtures/voice");
rmSync(fixtureDir, { recursive: true, force: true });
mkdirSync(path.join(fixtureDir, "shouq"), { recursive: true });

const clips = {};
for (const key of FIXTURES) {
  const text = lines[key];
  if (!text) {
    console.error(`voice:fixture: no line named "${key}" — voice-lines.ts changed shape.`);
    process.exit(1);
  }
  say(text, path.join(fixtureDir, "shouq", `${key}.mp3`), FIXTURE_KBPS);
  clips[`shouq/${key}`] = `/voice/shouq/${key}.mp3`;
}
// A manifest in exactly the shape voice.ts fetches, so the test serves these
// files as though gen-voice had produced them — including the per-clip volumes
// the real pipeline writes. Measured here rather than copied in, for the same
// reason gen-voice measures its own output: a fixture whose levels were typed
// by hand would let the playback tests pass against numbers no version of
// voice:levels would ever produce.
const fixtureManifest = { version: 2, model: "espeak-ng-placeholder", clips };
try {
  const { measureClips, gainsFor } = await import("./lib/clip-levels.mjs");
  const levels = await measureClips(
    Object.keys(clips).map((key) => ({
      key,
      file: path.join(fixtureDir, `${key}.mp3`),
    }))
  );
  const { gains } = gainsFor(levels);
  fixtureManifest.gains = Object.fromEntries(Object.entries(gains).sort(([a], [b]) => a.localeCompare(b)));
} catch (e) {
  console.warn(`  ⚠ could not level the fixtures: ${e.message}`);
  console.warn("    They will play at full volume, and the levelling tests will fail.");
}
writeFileSync(
  path.join(fixtureDir, "manifest.json"),
  JSON.stringify(fixtureManifest, null, 2) + "\n"
);

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
console.log(`\nشوق — placeholder audio (espeak-ng, NOT her real voice)\n`);
for (const l of script) console.log("  " + l);
console.log(`\n  docs/voice-sample/shouq-placeholder.mp3  ${kb(sampleBytes)}`);
console.log(`  tests/fixtures/voice/                    ${FIXTURES.length} clips + manifest.json`);
console.log(`\nFor her real voice: ELEVENLABS_API_KEY=… ELEVEN_VOICE_SHOUQ=… node scripts/gen-voice.mjs --sample`);
