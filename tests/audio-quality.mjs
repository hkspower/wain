#!/usr/bin/env node
// Every generator must ask the API for full-quality audio.
//
//   npm run test:audio-quality
//
// ElevenLabs defaults to mp3_44100_128 when output_format is absent. It
// does not warn: the request succeeds, the file plays, and the only sign
// is a bitrate nobody reads. Three of the four generators had no
// output_format at all, so the music beds and every voice line the repo
// would have produced were 128 kbps while generate-sfx.mjs — the one
// generator that did ask — produced 192.
//
// Also asserted here: nothing in the exported catalogue is below 192 for
// music. Bitrate lives in the MPEG frame header, so it is readable
// without a decoder and this stays a pure-node test.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WANT = "mp3_44100_192";
const fail = [];
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { fail.push(m); console.log(`  FAIL  ${m}`); };

// ---- 1. every generator asks for the format ---------------------------
console.log("generators request full quality");
const GENERATORS = [
  "scripts/generate-voices.mjs",
  "scripts/generate-music.mjs",
  "tools/elevenlabs/generate-sfx.mjs",
  "tools/elevenlabs/generate-music.mjs",
];
for (const g of GENERATORS) {
  const src = readFileSync(g, "utf8");
  // Count the POSTs that actually reach ElevenLabs, and the format asks.
  const posts = (src.match(/await fetch\(/g) || []).length;
  if (!src.includes(WANT)) { bad(`${g} never names ${WANT}`); continue; }
  // A generator that names the format once but posts twice (a --check
  // probe and the real call) would still ship one request at 128.
  const asks = src.includes("FORMAT")
    ? (src.match(/\$\{FORMAT\}|API \+ FORMAT/g) || []).length
    : (src.match(new RegExp(WANT, "g")) || []).length;
  if (asks < posts) bad(`${g}: ${posts} POSTs but only ${asks} ask for ${WANT}`);
  else ok(`${g} (${asks}/${posts} POSTs)`);
}

// ---- 2. nothing claims a lower format anywhere ------------------------
console.log("no generator asks for a lesser format");
for (const g of GENERATORS) {
  const src = readFileSync(g, "utf8");
  const lesser = src.match(/mp3_\d+_(?:32|64|96|128)\b/g);
  if (lesser) bad(`${g} still asks for ${[...new Set(lesser)].join(", ")}`);
  else ok(g);
}

// ---- 3. the exported music is actually 192 ----------------------------
// Speech and effects come back at 128 through the MCP connector, which
// stamps the format server-side and rejects output_format; only music is
// served at 192 there. So this asserts the one set the connector lets us
// control, and does not pretend about the other two.
const MUSIC = "sound-export/music";
if (existsSync(MUSIC)) {
  console.log("exported music is 192 kbps");
  const RATES = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
  for (const f of readdirSync(MUSIC).filter((n) => n.endsWith(".mp3"))) {
    const buf = readFileSync(join(MUSIC, f));
    let i = 0;
    if (buf.toString("latin1", 0, 3) === "ID3") {           // skip the tag
      i = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);
    }
    while (i < buf.length - 4 && !(buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0)) i++;
    const kbps = RATES[buf[i + 2] >> 4];
    if (kbps === 192) ok(`${f} ${kbps} kbps`);
    else bad(`${f} is ${kbps} kbps, expected 192`);
  }
} else {
  console.log("exported music is 192 kbps\n  skip  sound-export/music not present");
}

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
