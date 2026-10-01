/**
 * What /find says at each hour of each month (src/lib/find-moment.ts).
 *
 * The page used to be one sentence at every hour, and in summer that sentence
 * offered the beach at noon. These hold the rule the change exists for — no
 * open-air example by day in summer — across all 288 moments, not the two
 * that were looked at, and hold the HTML's default to the greeting the call
 * sheet already uses, so the two cannot drift.
 */
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "wain-find-"));
const bundle = (rel, name) => {
  const out = join(tmp, name);
  execSync(
    `npx -y esbuild ${JSON.stringify(join(ROOT, rel))} --bundle --format=esm ` +
      `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(out)} --log-level=error`,
    { cwd: ROOT, stdio: "pipe" }
  );
  return pathToFileURL(out).href;
};
const F = await import(bundle("src/lib/find-moment.ts", "find-moment.mjs"));
const A = await import(bundle("src/lib/wain-ai.ts", "wain-ai.mjs"));

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); }
};

console.log("\n── the HTML's line is the one the call sheet already says ──");
ok("شوق's default is WAIN_AI_COPY.greeting, word for word",
  F.findGreeting(A.WAIN_AI_COPY.name, F.FIND_DEFAULT) === A.WAIN_AI_COPY.greeting,
  F.findGreeting(A.WAIN_AI_COPY.name, F.FIND_DEFAULT));
ok("سالم's default is SALEM_GREETING, word for word",
  F.findGreeting(A.SALEM_NAME, F.FIND_DEFAULT) === A.SALEM_GREETING);

console.log("\n── every moment of the year ──");
const all = [];
for (let month = 0; month < 12; month++)
  for (let hour = 0; hour < 24; hour++) all.push({ month, hour, m: F.findMoment(hour, month) });
ok("all 288 have an opener and three examples",
  all.every(({ m }) => m.opener.length > 0 && m.examples.split("، ").length === 3));
const summerDay = all.filter(({ month, hour }) => month >= 5 && month <= 8 && hour >= 5 && hour < 16);
ok(`summer by day (${summerDay.length} moments) never offers the sea or a walk outside`,
  summerDay.every(({ m }) => !/بحر|مشي/.test(m.examples)),
  summerDay.filter(({ m }) => /بحر|مشي/.test(m.examples)).map(({ month, hour }) => `${month}/${hour}`).join(" "));
ok("a summer evening offers the sea after sunset, said so",
  F.findMoment(18, 6).examples.includes("بحر عقب المغرب"));
ok("a winter morning offers the walk by the sea", F.findMoment(8, 0).examples.includes("مشي على البحر"));
ok("the opener follows the hour",
  F.findMoment(7, 3).opener === "صباح الخير!" && F.findMoment(13, 3).opener === "هلا!" &&
    F.findMoment(18, 3).opener === "مساء الخير!" && F.findMoment(2, 3).opener === "هلا بالسهرانين!");
ok("the edges fall where the comment says: 05 morning, 12 noon, 16 evening, 21 night",
  F.dayPart(4) === "night" && F.dayPart(5) === "morning" && F.dayPart(11) === "morning" &&
    F.dayPart(12) === "noon" && F.dayPart(16) === "evening" && F.dayPart(21) === "night");

console.log("\n── in Kuwait's time, not the phone's ──");
// 21:30 UTC on 31 May is 00:30 on 1 June in Kuwait: night, and summer.
const edge = F.findMomentNow(new Date("2026-05-31T21:30:00Z"));
ok("21:30 UTC on 31 May is a June night in Kuwait", edge.part === "night" && edge.summer, JSON.stringify(edge));

console.log(`\n${fails.length ? "✗" : "✓"} find-moment: ${pass} passed` + (fails.length ? `, ${fails.length} failed\n  ${fails.join("\n  ")}` : ""));
process.exit(fails.length ? 1 : 0);
