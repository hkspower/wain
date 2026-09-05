#!/usr/bin/env node
/**
 * Does شوق actually have a voice?   npm run audit:voice
 *
 * She did not, and nothing said so.
 *
 * `public/voice/manifest.json` shipped as `{"version": 0, "clips": {}}` — not
 * one recorded line for either persona — and the site behaves perfectly well
 * with that: `speak()` finds no clip, falls through to the browser's own
 * Arabic synthesiser, and says the sentence. Every test passes. Every audit
 * passes. The only symptom is that شوق sounds like a screen reader instead of
 * a Kuwaiti woman, which is invisible to everything except a person listening.
 *
 * That is the same shape as the export that sat on the server for months
 * referencing fourteen `/_next/` assets nobody had uploaded: a fallback quiet
 * enough that the failure never reaches anyone who could fix it. So this
 * counts what was recorded against what should be, and says it out loud.
 *
 * It does not fail the build on zero. The fallback is real and the site works;
 * refusing to build would be a lie about severity, and a scan that cannot go
 * green is a scan people stop reading. It warns, loudly, with the reason.
 *
 * It DOES fail on a manifest that promises clips it does not have, because
 * that is not a degraded voice — it is a 404 mid-sentence.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  measureClips,
  gainsFor,
  heardRms,
  LEVEL_SPREAD_DB,
  SILENCE_PEAK_DB,
} from "./lib/clip-levels.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "public/voice/manifest.json");

let problems = 0;

/* ── what should exist ───────────────────────────────────────────────────────
   Asked of the generator rather than re-derived here. `--dry-run` needs no API
   key and prints exactly the lines it would record, so the expected set cannot
   drift from the thing that produces it — which a second copy of the line
   builder in this file certainly would. */
let expected;
try {
  const out = execFileSync("node", ["scripts/gen-voice.mjs", "--dry-run"], {
    cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  expected = {};
  let persona = null;
  for (const line of out.split("\n")) {
    const head = line.match(/^=== (\w+) \((\d+) clips\) ===/);
    if (head) { persona = head[1]; expected[persona] = new Set(); continue; }
    const clip = line.match(/^ {2}([\w-]+):/);
    if (clip && persona) expected[persona].add(clip[1]);
  }
} catch (e) {
  console.error("  ✗ could not ask gen-voice what it would record:", e.message);
  process.exit(1);
}

const personas = Object.keys(expected);
const want = personas.reduce((n, p) => n + expected[p].size, 0);

console.log("\n── صوت وين: what is actually recorded ──");

if (!existsSync(MANIFEST)) {
  console.log("  ✗ public/voice/manifest.json is missing entirely.");
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch (e) {
  console.log(`  ✗ manifest.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

const clips = manifest.clips ?? {};
const have = Object.keys(clips).length;

/* ── every clip the manifest claims must be on disk ────────────────────────
   A manifest entry is a promise that a file is there. speak() queues the URL
   and plays it; a missing file is silence in the middle of a sentence, after
   the visitor has already heard the first half. */
const missing = [];
const empty = [];
for (const [key, rel] of Object.entries(clips)) {
  const path = typeof rel === "string" ? rel : rel?.url ?? "";
  const file = join(ROOT, "public", path.replace(/^\//, ""));
  if (!existsSync(file)) { missing.push(`${key} → ${path}`); continue; }
  // A zero-length or near-zero mp3 plays as silence, which is the same
  // failure wearing a file's clothes.
  if (statSync(file).size < 512) empty.push(`${key} (${statSync(file).size}B)`);
}

if (missing.length) {
  console.log(`  ✗ ${missing.length} clip(s) named in the manifest are not on disk:`);
  for (const m of missing.slice(0, 8)) console.log(`      ${m}`);
  problems += missing.length;
}
if (empty.length) {
  console.log(`  ✗ ${empty.length} clip file(s) are too small to be audio:`);
  for (const m of empty.slice(0, 8)) console.log(`      ${m}`);
  problems += empty.length;
}

/* ── how loud is she, actually ─────────────────────────────────────────────
   Everything above this point checks that a file exists and is bigger than
   512 bytes. A valid MP3 of near-silence passes both, and so does a clip that
   came back six decibels under the one before it — and clips are played back
   to back inside a single answer, so a level that moves between them is a
   voice that lurches mid-sentence.

   The measurement and the correction live together in lib/clip-levels, and
   this reads the same numbers voice:levels wrote by. Two copies of the same
   decibel arithmetic is exactly how a pipeline ends up correcting to one
   target and grading against another.

   Chromium is only launched when there is something to listen to, so the
   common case — no clips recorded yet — costs nothing. */

if (have > 0) {
  const onDisk = Object.entries(clips)
    .map(([key, rel]) => {
      const path = typeof rel === "string" ? rel : rel?.url ?? "";
      return { key, file: join(ROOT, "public", path.replace(/^\//, "")) };
    })
    .filter(({ file }) => existsSync(file));

  console.log(`\n── and how loud is she? (${onDisk.length} clip(s)) ──`);
  let levels = null;
  try {
    levels = await measureClips(onDisk);
  } catch (e) {
    console.log(`  ⚠ could not decode the clips to measure them: ${e.message}`);
  }

  if (levels) {
    const broken = levels.filter((r) => r.broken);
    const silent = levels.filter((r) => !r.broken && r.peak < SILENCE_PEAK_DB);
    const audible = levels.filter((r) => !r.broken && r.peak >= SILENCE_PEAK_DB);

    if (broken.length) {
      console.log(`  ✗ ${broken.length} file(s) are not decodable audio: ` +
        broken.slice(0, 6).map((r) => r.key).join(", "));
      problems += broken.length;
    }
    if (silent.length) {
      console.log(`  ✗ ${silent.length} clip(s) are silence in an mp3's clothing ` +
        `(peak under ${SILENCE_PEAK_DB} dBFS):`);
      for (const r of silent.slice(0, 6)) console.log(`      ${r.key} — peak ${r.peak.toFixed(1)} dBFS`);
      problems += silent.length;
    }

    if (audible.length) {
      /* Graded on what a listener HEARS, which is the file's own level plus
         whatever volume voice:levels wrote for it. Grading the raw files would
         report a set as uneven after the pipeline had already evened it out —
         and, worse, would go on passing a set whose corrections were computed
         against clips that have since been re-recorded. */
      const gains = manifest.gains ?? {};
      const raw = audible.map((r) => r.rms);
      const now = audible.map((r) => heardRms(r, gains[r.key] ?? 1));
      const span = (xs) => Math.max(...xs) - Math.min(...xs);
      const sorted = [...now].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      const levelled = Object.keys(gains).length > 0;
      console.log(
        `  level: ${median.toFixed(1)} dBFS in the middle, ` +
          `${sorted[0].toFixed(1)} to ${sorted[sorted.length - 1].toFixed(1)} across the set` +
          (levelled
            ? ` — ${span(raw).toFixed(1)} dB apart as recorded, ${span(now).toFixed(1)} dB as played`
            : ` (${span(raw).toFixed(1)} dB apart, and nothing has levelled them)`)
      );

      const off = audible
        .map((r) => ({ key: r.key, delta: heardRms(r, gains[r.key] ?? 1) - median }))
        .filter((r) => Math.abs(r.delta) > LEVEL_SPREAD_DB)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      if (off.length) {
        console.log(`  ⚠ ${off.length} clip(s) still sit more than ${LEVEL_SPREAD_DB} dB off the rest,`);
        console.log("    which is audible as her voice jumping between two sentences of one answer:");
        for (const r of off.slice(0, 6)) {
          console.log(`      ${r.key} — ${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)} dB`);
        }
        console.log("    Playback volume can only turn a clip DOWN, so these are past what");
        console.log("    levelling can fix: delete those files and re-run the generator.");
      } else if (!levelled) {
        console.log(`  ✓ every clip is within ${LEVEL_SPREAD_DB} dB of the rest, even unlevelled.`);
        console.log("    Run `npm run voice:levels` to flatten the rest of the difference.");
      } else {
        console.log(`  ✓ every clip plays within ${LEVEL_SPREAD_DB} dB of the rest — no jumps mid-answer.`);
      }

      /* Are the stored volumes still the right ones?
         The target depends on the whole set, so re-recording a single line
         changes what every other clip should be played at. A manifest whose
         gains were computed against files that have since been replaced is
         worse than one with no gains at all: it looks levelled, and it is
         levelled to a set that no longer exists. */
      if (levelled) {
        const fresh = gainsFor(levels).gains;
        const stale = Object.keys({ ...fresh, ...gains }).filter(
          (k) => Math.abs((fresh[k] ?? 1) - (gains[k] ?? 1)) > 0.01
        );
        if (stale.length) {
          console.log(`  ✗ ${stale.length} stored volume(s) no longer match the files on disk` +
            ` — a clip was re-recorded without re-levelling: ${stale.slice(0, 5).join(", ")}`);
          console.log("    Fix: npm run voice:levels");
          problems += stale.length;
        }
      }
    }
  }
}

/* ── coverage ─────────────────────────────────────────────────────────────── */
const pct = want === 0 ? 0 : Math.round((have / want) * 100);
console.log(`  ${have} of ${want} lines recorded (${pct}%)` +
  personas.map((p) => `\n      ${p}: ${expected[p].size} lines`).join(""));

if (have === 0) {
  console.log("\n  ⚠ شوق has NO recorded voice. Every spoken line falls back to the");
  console.log("    browser's own Arabic synthesiser — which works, and does not sound");
  console.log("    like her. Nothing else in the build reports this, which is why this");
  console.log("    check exists.");
  console.log("\n    The blocker that used to sit here is gone. شوق pointed at a LIBRARY");
  console.log("    voice the workspace does not own, so every call answered");
  console.log("    voice_not_found and no clip could ever be made. She is on Talya now");
  console.log("    (ar-omani, female, young) — a real workspace voice, verified by");
  console.log("    generating her greeting through it.");
  console.log("\n    What is left is the API key, and it is not in this repository:");
  console.log("      ELEVENLABS_API_KEY=… npm run voice:sample   # one call, then listen");
  console.log("      ELEVENLABS_API_KEY=… node scripts/gen-voice.mjs");
  console.log("    The generator levels the set on the way out, so nothing else is owed.");
} else if (have < want) {
  // `persona/key`, which is how gen-voice writes the manifest and how speak()
  // looks a clip up. Comparing the bare key against those never matched, so a
  // half-recorded library reported every line as missing — «276 will fall
  // back» printed directly under «7 of 276 recorded».
  const short = [];
  for (const p of personas) for (const k of expected[p]) if (!(`${p}/${k}` in clips)) short.push(`${p}/${k}`);
  console.log(`  ⚠ ${short.length} line(s) will fall back to the browser voice, e.g. ` +
    short.slice(0, 4).join(", "));
}

console.log(problems
  ? `\n${problems} thing(s) to look at.`
  : have === 0
    ? "\nThe manifest is honest — it promises nothing and delivers nothing."
    : "\nEvery clip the manifest promises is on disk and playable.");
process.exit(problems ? 1 : 0);
