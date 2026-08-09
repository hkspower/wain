#!/usr/bin/env node
// Pre-render the game's Kuwaiti voice lines through ElevenLabs into
// public/voices/*.mp3 (+ manifest.json). Run once with your key:
//
//   ELEVENLABS_API_KEY=sk_... node scripts/generate-voices.mjs
//   ELEVENLABS_VOICE_ID=<voice> to override the default male voice
//
// The web VoiceBox plays these clips when present and falls back to the
// browser's Arabic speech synthesis when they're absent. The Unity port
// caches the same lines at runtime (unity/Assets/Scripts/ElevenLabsVoice.cs).
//
// NOTE: keep this table in sync with src/game/rivals.ts.

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB"; // "Adam"
if (!KEY) {
  console.error("Set ELEVENLABS_API_KEY (get one at https://elevenlabs.io).");
  process.exit(1);
}

const LINES = [
  // announcer
  ["announcer-start", "يلا! دور على خصمك", 0.5],
  ["announcer-champion", "مبروك! إنت ملك شارع الخليج", 0.5],
  ["voices-on", "الأصوات شغالة", 0.5],
  // Abu Shanab
  ["abu-shanab-intro", "هلا والله! يلا ورني شنو عندك يا بطل", 0.4],
  ["abu-shanab-win", "هاهاها! روح تعلم السواقة وبعدين تعال", 0.4],
  ["abu-shanab-lose", "ما شاء الله عليك... خذت الليلة مني", 0.4],
  // Bint Al-Deera
  ["bint-aldeera-intro", "تبي تتحداني؟ يلا نشوف شطارتك", 0.5],
  ["bint-aldeera-win", "قلت لك، شارع الخليج لي أنا", 0.5],
  ["bint-aldeera-lose", "زين لعبت... بس هالمرة وبس", 0.5],
  // Al-Daboos
  ["al-daboos-intro", "أنا الدبوس! محد يعديني في حولي", 0.4],
  ["al-daboos-win", "ولا يهمك، تدرب زين وتعال مرة ثانية", 0.4],
  ["al-daboos-lose", "عيل صدق إنك سريع... احترمتك", 0.4],
  // Bu Machboos
  ["bu-machboos-intro", "اللي يخسر يعزم على المجبوس... اتفقنا؟", 0.45],
  ["bu-machboos-win", "يلا! المجبوس عليك الليلة، هاهاها", 0.45],
  ["bu-machboos-lose", "خذ فوزك... بس مجبوسي أطيب، صدقني", 0.45],
  // Al-Saqer
  ["al-saqer-intro", "الصقر يصيد في الليل... انتبه لنفسك", 0.6],
  ["al-saqer-win", "الصقر ما يطيح مرتين", 0.6],
  ["al-saqer-lose", "صدت الصقر... لك كل الاحترام", 0.6],
  // Shabah Al-Khaleej — the ghost speaks slow and steady
  ["shabah-alkhaleej-intro", "وصلت للنهاية... بس الشبح ما ينهزم", 0.9],
  ["shabah-alkhaleej-win", "ارجع لما تكون جاهز", 0.9],
  ["shabah-alkhaleej-lose", "الشارع لك... يا ملك الخليج", 0.9],
];

await mkdir("public/voices", { recursive: true });
const done = [];
for (const [id, text, stability] of LINES) {
  const out = `public/voices/${id}.mp3`;
  if (existsSync(out)) {
    console.log(`skip (exists): ${id}`);
    done.push(id);
    continue;
  }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`, {
    method: "POST",
    headers: {
      "xi-api-key": KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    console.error(`FAILED ${id}: ${res.status} ${await res.text()}`);
    continue;
  }
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log(`generated: ${id}`);
  done.push(id);
}
await writeFile("public/voices/manifest.json", JSON.stringify(done, null, 2));
console.log(`\nmanifest.json written with ${done.length}/${LINES.length} clips.`);
