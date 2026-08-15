#!/usr/bin/env node
// One command to answer "is ElevenLabs reachable yet, and do we have a
// key" for all three generators at once.
//
//   npm run audio:check
//
// The three pipelines — sound effects, rival voices, race music — all
// hit the same host, so they are all blocked or all working together.
// Checking them one at a time was three commands to learn one fact.

import { spawnSync } from "node:child_process";

const JOBS = [
  ["sound effects", "tools/elevenlabs/generate-sfx.mjs"],
  ["rival voices", "scripts/generate-voices.mjs"],
  ["race music", "tools/elevenlabs/generate-music.mjs"],
];

let ready = 0;
for (const [label, script] of JOBS) {
  const r = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const endpoint = out.split("\n").find((l) => l.startsWith("endpoint")) ?? "endpoint  no answer";
  const keyLine = out.split("\n").find((l) => l.startsWith("key")) ?? "key       unknown";
  console.log(`${label.padEnd(14)} ${keyLine.replace(/^key\s+/, "key: ")}`);
  console.log(`${"".padEnd(14)} ${endpoint.replace(/^endpoint\s+/, "")}`);
  if (r.status === 0) ready++;
}

console.log();
if (ready === JOBS.length) {
  console.log("All three are ready. Generate everything:");
  console.log("  npm run sfx && node scripts/generate-voices.mjs && npm run music");
  console.log("  npm run sfx:verify     # then check the drop before committing");
} else {
  console.log(`${ready}/${JOBS.length} ready.`);
  console.log("If the endpoint says BLOCKED, that is this environment's egress policy,");
  console.log("not a key or API problem — the request never reaches ElevenLabs. Add");
  console.log("api.elevenlabs.io to the environment's network egress allowlist, or run");
  console.log("the generators from a machine with direct internet access and commit");
  console.log("public/sfx/, public/voices/ and public/music/.");
}
process.exit(ready === JOBS.length ? 0 : 1);
