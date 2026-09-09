#!/usr/bin/env node
/**
 * Did the deploy land?   npm run deploy:verify -- --observed <file.json>
 *
 * `build.json` is a root file. On 2026-09-09 a deploy put it and the eleven
 * other root files in place, and all 232 files in subdirectories arrived
 * later — so `curl https://www.wainkw.com/build.json` returned the right
 * version and the right digest while the site had no CSS and every route but
 * `/` was a 404. The check that was supposed to catch a bad deploy was the
 * reason nobody noticed one.
 *
 * So this refuses to answer from the root. `npm run deploy:plan` writes down
 * every file in the export with its size and marks six of them — a hashed
 * stylesheet, a hashed route chunk, the build-id directory, and three
 * different subdirectory depths — as required. All six have to be present and
 * byte-exact before this says yes.
 *
 * Nothing here can read the live site: www.wainkw.com resolves through the
 * same egress policy that refuses the upload host. The readings come from the
 * `hosa` connector, whose read tools reach Hostinger's API server-side, and
 * are handed in as JSON:
 *
 *   { "buildJson": "<the file's text>",
 *     "files": { "index.html": 139974, "_next/static/css/ab.css": 87269 } }
 *
 * A bare { path: bytes } map is accepted too, and then build.json is checked
 * from the map's sizes alone.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};

const planPath = arg("--plan") ?? join(ROOT, "deploy-plan.json");
const observedPath = arg("--observed");

if (!observedPath) {
  console.error(`\nusage: npm run deploy:verify -- --observed <file.json>\n`);
  process.exit(2);
}
if (!existsSync(planPath)) {
  console.error(`\n${planPath} is missing. Run \`npm run deploy:plan\` first.\n`);
  process.exit(2);
}

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const raw = JSON.parse(readFileSync(observedPath, "utf8"));
const observed = raw.files ?? raw;
const buildJsonText = raw.buildJson ?? null;

console.log(`\nwain ${plan.version} — did it land?`);
console.log(`  expecting  ${plan.commit.slice(0, 8)} · digest ${plan.digest}`);
console.log(`  observed   ${Object.keys(observed).length} entries\n`);

let failures = 0;
const problem = (msg) => { failures++; console.log(`  ✗ ${msg}`); };

/* ── build.json says what it should ──────────────────────────────────────── */
console.log(`── the stamp ──`);
if (buildJsonText) {
  let live;
  try {
    live = JSON.parse(buildJsonText);
  } catch {
    problem("build.json is on the server but is not valid JSON");
  }
  if (live) {
    for (const key of ["version", "commit", "digest"]) {
      const want = plan[key] ?? plan.archive?.[key];
      if (live[key] !== want) problem(`build.json ${key} is ${live[key]}, expected ${want}`);
      else console.log(`  ✓ ${key.padEnd(8)} ${live[key]}`);
    }
    if (live.dirty) problem("build.json says the deployed build came from a dirty tree");
  }
} else {
  console.log(`  – build.json text was not supplied; checking sizes only`);
}

/**
 * A correct stamp is the weakest evidence available, and it is the evidence
 * that misled once. Say so, every time, so nobody stops reading here.
 */
console.log(`\n  A correct stamp proves one root file arrived. It is not the answer.`);

/* ── the proofs that are not at the root ─────────────────────────────────── */
console.log(`\n── the six that are not at the root ──`);
for (const { path, why } of plan.required) {
  const want = plan.files[path];
  const got = observed[path];
  if (got === undefined) problem(`${path}\n      MISSING — ${why}`);
  else if (got !== want) problem(`${path}\n      ${got} bytes, expected ${want} — ${why}`);
  else console.log(`  ✓ ${path}  ${want}`);
}

/* ── everything else that was observed ───────────────────────────────────── */
console.log(`\n── the rest of the export ──`);
const expected = Object.keys(plan.files);
const seen = expected.filter((p) => p in observed);
const wrong = seen.filter((p) => observed[p] !== plan.files[p]);
const absent = expected.filter((p) => !(p in observed));

console.log(`  ${seen.length}/${expected.length} expected files were in the reading`);
if (wrong.length) {
  problem(`${wrong.length} file(s) are the wrong size:`);
  for (const p of wrong.slice(0, 10)) console.log(`      ${p}  ${observed[p]} ≠ ${plan.files[p]}`);
  if (wrong.length > 10) console.log(`      …and ${wrong.length - 10} more`);
} else if (seen.length) {
  console.log(`  ✓ every one of them is byte-exact`);
}

/**
 * "Not in the reading" is not "not on the server" — a listing can be shallow
 * or paged. Only a reading that covered the whole export can say a file is
 * missing, so the two cases are reported differently.
 */
if (absent.length) {
  const deep = absent.filter((p) => p.includes("/"));
  console.log(`  – ${absent.length} not covered by this reading (${deep.length} of them below the root)`);
  console.log(`    Widen the listing before reading anything into that.`);
}

/**
 * unzip merges, so the previous build's hashed assets stay behind. Nothing
 * points at them and they are harmless, but they accumulate one set per
 * deploy, and seeing the count is the only way anyone will ever notice.
 */
const extra = Object.keys(observed).filter((p) => !(p in plan.files));
if (extra.length) {
  console.log(`\n── left over from earlier deploys ──`);
  console.log(`  ${extra.length} file(s) on the server are not in this export.`);
  for (const p of extra.slice(0, 8)) console.log(`      ${p}`);
  if (extra.length > 8) console.log(`      …and ${extra.length - 8} more`);
  console.log(`  unzip merges, so these are expected. Nothing references them.`);
}

/* ── the failure that started all this ───────────────────────────────────── */
const rootFiles = expected.filter((p) => !p.includes("/"));
const rootLanded = rootFiles.every((p) => observed[p] === plan.files[p]);
const deepLanded = plan.required.every(({ path }) => observed[path] === plan.files[path]);
if (rootLanded && !deepLanded) {
  console.log(`\n  ⚠  Every root file is correct and the deep ones are not.`);
  console.log(`     This is exactly the 9 September failure: the root arrived first`);
  console.log(`     and the subdirectories had not arrived yet. Wait and re-read`);
  console.log(`     before concluding the deploy is broken.`);
}

console.log(
  failures === 0
    ? `\n✓ ${plan.commit.slice(0, 8)} is live — verified at the root and ${plan.required.length} levels below it.\n`
    : `\n✗ ${failures} check(s) failed. This deploy has not landed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
