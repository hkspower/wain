#!/usr/bin/env node
/**
 * Level the recorded clips.   npm run voice:levels
 *
 * ElevenLabs renders each line as its own request, and each comes back at
 * whatever level that generation produced. Nothing in the pipeline looked at
 * the result: gen-voice writes the bytes it is handed, and audit-voice checked
 * only that a file exists and is bigger than 512 bytes.
 *
 * That would be a small thing if clips were played one at a time. They are
 * not — an answer is four or five of them back to back inside a single
 * utterance, so a level that moves between them is heard as شوق changing
 * distance from the microphone mid-sentence. It is the kind of fault nobody
 * can point at and everybody notices.
 *
 * This measures every clip and writes a playback volume for each into the
 * manifest, which voice.ts applies as it plays. Nothing is re-encoded: the
 * files on disk are untouched and the correction is a number, so running this
 * again after re-recording one line simply produces a new number.
 *
 * It reads the manifest and writes the manifest, and nothing else, so it is
 * safe to run at any time — including with no clips at all, which is what it
 * finds today.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { measureClips, gainsFor, heardRms, LEVEL_SPREAD_DB, SILENCE_PEAK_DB } from "./lib/clip-levels.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = process.env.WAIN_VOICE_MANIFEST || join(ROOT, "public/voice/manifest.json");
const PUBLIC = dirname(dirname(MANIFEST));

if (!existsSync(MANIFEST)) {
  console.error(`voice:levels: ${MANIFEST} does not exist.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const clips = manifest.clips ?? {};

const files = Object.entries(clips)
  .map(([key, rel]) => {
    const path = typeof rel === "string" ? rel : rel?.url ?? "";
    return { key, file: join(PUBLIC, path.replace(/^\//, "")) };
  })
  .filter(({ file }) => existsSync(file));

if (files.length === 0) {
  // Not an error. This is the state the repository ships in, and a script that
  // fails on it would fail every scan for a reason that is not a fault.
  console.log("voice:levels: no clips on disk yet — nothing to level.");
  // Any gains left from a previous run would now refer to files that are gone.
  if (manifest.gains) {
    delete manifest.gains;
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
    console.log("  (cleared stale gains from the manifest)");
  }
  process.exit(0);
}

console.log(`voice:levels: measuring ${files.length} clip(s)…`);
const levels = await measureClips(files);

const broken = levels.filter((l) => l.broken);
const silent = levels.filter((l) => !l.broken && l.peak < SILENCE_PEAK_DB);
for (const b of broken) console.log(`  ⚠ ${b.key} did not decode — left at full volume`);
for (const s of silent) console.log(`  ⚠ ${s.key} peaks at ${s.peak.toFixed(1)} dBFS, which is silence — left alone`);

const { gains, target, median } = gainsFor(levels);
const heard = levels.filter((l) => !l.broken && l.peak >= SILENCE_PEAK_DB);
const before = heard.map((l) => l.rms);
const after = heard.map((l) => heardRms(l, gains[l.key] ?? 1));
const spread = (xs) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);

const trimmed = Object.entries(gains).filter(([, g]) => g < 0.999);
console.log(
  `  middle of the set ${median.toFixed(1)} dBFS, levelled to ${target.toFixed(1)} dBFS\n` +
    `  ${trimmed.length} clip(s) turned down; spread ${spread(before).toFixed(1)} dB → ${spread(after).toFixed(1)} dB`
);

// Anything still outside the band after levelling is a take the bound above
// deliberately refused to chase. Name it here as well as in the audit — this
// is the script the operator runs right after recording, when re-recording one
// line is cheap.
const stubborn = heard
  .map((l) => ({ key: l.key, delta: heardRms(l, gains[l.key] ?? 1) - target }))
  .filter((x) => Math.abs(x.delta) > LEVEL_SPREAD_DB);
if (stubborn.length) {
  console.log(`  ⚠ ${stubborn.length} clip(s) are still more than ${LEVEL_SPREAD_DB} dB off and need re-recording:`);
  for (const s of stubborn.slice(0, 8)) console.log(`      ${s.key} — ${s.delta > 0 ? "+" : ""}${s.delta.toFixed(1)} dB`);
}

manifest.gains = Object.fromEntries(Object.entries(gains).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`  wrote ${Object.keys(manifest.gains).length} volume(s) to ${MANIFEST.replace(ROOT + "/", "")}`);
