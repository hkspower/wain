#!/usr/bin/env node
/**
 * lib/agent-job.ts — the job a visitor carries between the call-centre agents:
 *   node tests/agent-job.test.mjs
 *
 * Written by whichever agent held it last and read by the next one, so what is
 * held here is the ticket itself: it round-trips, it goes stale, a bad value
 * is no job rather than a crash, an agent is never handed its own job back,
 * and the context line the next agent is told says what was asked, shown and
 * picked — and nothing it cannot name.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
import { makeCheck } from './harness/check.mjs';
const { ok, fails, counts } = makeCheck();

const tmp = mkdtempSync(join(tmpdir(), "wain-agent-job-"));
const entry = join(tmp, "entry.ts");
writeFileSync(
  entry,
  `export * from ${JSON.stringify(join(ROOT, "src/lib/agent-job.ts"))};\n` +
    `export * from ${JSON.stringify(join(ROOT, "src/lib/agent-job-context.ts"))};\n`
);
const bundle = join(tmp, "entry.mjs");
execSync(
  `npx -y esbuild ${JSON.stringify(entry)} --bundle --format=esm ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundle)} --log-level=error`,
  { cwd: ROOT, stdio: "pipe" }
);
const { readJob, writeJob, pickInJob, jobFor, jobToTell, pruneJob, jobContext, JOB_KEY, JOB_TTL_MS } = await import(pathToFileURL(bundle).href);
rmSync(tmp, { recursive: true, force: true });

/** A section that names a function this build does not have (a red from a
 *  missing export) is one red line, not an uncaught TypeError that ends the file. */
function attempt(label, fn) {
  try {
    fn();
  } catch (e) {
    ok(label, false, String(e?.message ?? e));
  }
}

/** A Storage double: a Map, and a switch that makes every call throw. */
function store() {
  const m = new Map();
  return {
    m,
    blocked: false,
    getItem(k) { if (this.blocked) throw new Error("SecurityError"); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (this.blocked) throw new Error("SecurityError"); m.set(k, String(v)); },
    removeItem(k) { if (this.blocked) throw new Error("SecurityError"); m.delete(k); },
  };
}
const T = 1_800_000_000_000;
const NAMES = { "mubarakiya-tea-houses": "مقاهي المباركية", "gulf-road-cafes": "كافيهات شارع الخليج", "souq-sharq": "سوق شرق", "marina-mall": "مارينا مول" };
const nameOf = (s) => NAMES[s];

console.log("\n── the ticket round-trips, and goes stale ──");
{
  const s = store();
  writeJob("shouq-call", { asked: "  قهوة هادية  ", shown: ["mubarakiya-tea-houses", "gulf-road-cafes"], ranked: ["mubarakiya-tea-houses", "gulf-road-cafes", "souq-sharq"] }, s, T);
  const j = readJob(s, T + 1000);
  ok("what was written is read back", j && j.by === "shouq-call" && j.asked === "قهوة هادية" && j.shown.length === 2 && j.ranked.length === 3 && j.picked === null, JSON.stringify(j));
  ok("under the key the next agent reads", s.m.has(JOB_KEY));
  ok("half an hour on, it is another visit's", readJob(s, T + JOB_TTL_MS + 1) === null);
  ok("a ticket from the future is no ticket", readJob(s, T - 120_000) === null);
  ok("ranked defaults to what was shown", (() => { const s2 = store(); writeJob("salem-chat", { asked: "بحر", shown: ["marina-mall"] }, s2, T); return readJob(s2, T).ranked.join() === "marina-mall"; })());
}

console.log("\n── a bad value is no job, never a crash ──");
{
  const s = store();
  for (const raw of ["{", "null", "[]", JSON.stringify({ v: 2, by: "shouq-call", asked: "x", at: T }), JSON.stringify({ v: 1, by: "someone", asked: "x", at: T }), JSON.stringify({ v: 1, by: "salem-chat", asked: "", shown: [], at: T })]) {
    s.m.set(JOB_KEY, raw);
    ok(`«${raw.slice(0, 40)}» reads as no job`, readJob(s, T) === null);
  }
  s.m.set(JOB_KEY, JSON.stringify({ v: 1, by: "salem-chat", asked: "قهوة", shown: ["ok-slug", "<script>", 7, "Bad Slug"], ranked: [], picked: "../etc", at: T }));
  const j = readJob(s, T);
  ok("only well-formed slugs survive, and a bad pick is dropped", j && j.shown.join() === "ok-slug" && j.picked === null, JSON.stringify(j));
  s.blocked = true;
  ok("storage that throws reads as no job", readJob(s, T) === null);
  let threw = false;
  try { writeJob("salem-chat", { asked: "x", shown: [] }, s, T); } catch { threw = true; }
  ok("and writing to it does not throw", !threw);
  ok("no storage at all is no job", readJob(null, T) === null);
}

console.log("\n── the sizes are bounded ──");
{
  const s = store();
  const many = Array.from({ length: 60 }, (_, i) => `place-${i}`);
  writeJob("shouq-call", { asked: "ق".repeat(400), shown: many, ranked: many }, s, T);
  const j = readJob(s, T);
  ok("at most eight shown", j.shown.length === 8);
  ok("at most forty ranked", j.ranked.length === 40);
  ok("what was asked is cut to 160", j.asked.length === 160);
}

console.log("\n── an agent is never handed its own job back ──");
{
  const s = store();
  writeJob("salem-chat", { asked: "قهوة", shown: ["souq-sharq"] }, s, T);
  ok("سالم's chat does not pick up its own answer", jobFor("salem-chat", s, T) === null);
  ok("شوق's call does", jobFor("shouq-call", s, T)?.by === "salem-chat");
}

console.log("\n── a pick stays with its job ──");
{
  const s = store();
  writeJob("shouq-call", { asked: "قهوة", shown: ["mubarakiya-tea-houses", "gulf-road-cafes"] }, s, T);
  pickInJob("shouq-call", "gulf-road-cafes", "كافيهات شارع الخليج", s, T + 5);
  const j = readJob(s, T + 5);
  ok("a place from the answer is picked inside it", j.asked === "قهوة" && j.picked === "gulf-road-cafes" && j.shown.length === 2, JSON.stringify(j));
  pickInJob("salem-chat", "marina-mall", "مارينا مول", s, T + 10);
  const k = readJob(s, T + 10);
  ok("a place outside it starts a job of its own", k.by === "salem-chat" && k.asked === "مارينا مول" && k.shown.join() === "marina-mall" && k.picked === "marina-mall", JSON.stringify(k));
}

console.log("\n── a pick does not restart the half hour (round three, review) ──");
{
  // The privacy page says the job lasts half an hour from when it was asked.
  // A pick rewrites the job; the rewrite used to stamp the pick's own time, so
  // a job picked from at the twenty-fifth minute lived to the fifty-fifth.
  const s = store();
  writeJob("shouq-call", { asked: "قهوة", shown: ["marina-mall"] }, s, T);
  pickInJob("shouq-call", "marina-mall", "مارينا مول", s, T + 25 * 60_000);
  ok("the job is still there before its half hour, picked", readJob(s, T + 29 * 60_000)?.picked === "marina-mall", JSON.stringify(readJob(s, T + 29 * 60_000)));
  ok("a pick at the twenty-fifth minute does not keep it past the thirtieth", readJob(s, T + 31 * 60_000) === null, JSON.stringify(readJob(s, T + 31 * 60_000)));
}

console.log("\n── what the next agent is told ──");
{
  const job = { v: 1, by: "shouq-call", asked: "قهوة هادية", shown: ["mubarakiya-tea-houses", "gulf-road-cafes", "souq-sharq", "marina-mall"], ranked: [], picked: "gulf-road-cafes", at: T };
  const line = jobContext(job, nameOf);
  ok("where the job was", line.includes("مكالمته مع شوق"), line);
  ok("what was asked", line.includes("«قهوة هادية»"));
  ok("the first three places, by name", line.includes("مقاهي المباركية، كافيهات شارع الخليج، سوق شرق") && !line.includes("مارينا مول"), line);
  ok("the one picked", line.includes("واختار منها: كافيهات شارع الخليج"));
  ok("and to carry on rather than ask again", line.includes("كمّل معه من هني"));
  const unknown = jobContext({ ...job, shown: ["not-in-catalogue", "souq-sharq"], picked: "not-in-catalogue" }, nameOf);
  ok("a place it cannot name is left out, not read out as a slug", !unknown.includes("not-in-catalogue") && unknown.includes("سوق شرق") && !unknown.includes("واختار"), unknown);
  const bare = jobContext({ ...job, by: "call-center", shown: [], picked: null }, nameOf);
  ok("a job from the call-centre page with nothing shown says only what was asked", bare.includes("مركز الاتصال") && bare.includes("«قهوة هادية»") && !bare.includes("الأماكن"), bare);
}

console.log("\n── a job written from words answered here is marked, and the mark is kept ──");
attempt("the mark survives a read and a pick inside the job", () => {
  const s = store();
  writeJob("salem-chat", { asked: "قهوة", shown: ["mubarakiya-tea-houses", "souq-sharq"], local: true }, s, T);
  ok("the mark is read back", readJob(s, T)?.local === true, JSON.stringify(readJob(s, T)));
  pickInJob("shouq-call", "souq-sharq", "سوق شرق", s, T + 5);
  ok("a pick inside it, by another agent, keeps the mark", readJob(s, T + 5)?.local === true && readJob(s, T + 5)?.picked === "souq-sharq", JSON.stringify(readJob(s, T + 5)));
  ok("and keeps what was asked", readJob(s, T + 5)?.asked === "قهوة");
});
attempt("a pick that starts a job of its own takes the mark only from a local pick", () => {
  const s = store();
  writeJob("salem-chat", { asked: "قهوة", shown: ["souq-sharq"], local: true }, s, T);
  pickInJob("salem-chat", "marina-mall", "مارينا مول", s, T + 5, true);
  ok("a local pick outside the job is marked", readJob(s, T + 5)?.local === true && readJob(s, T + 5)?.asked === "مارينا مول", JSON.stringify(readJob(s, T + 5)));
  pickInJob("shouq-call", "gulf-road-cafes", "كافيهات شارع الخليج", s, T + 9);
  ok("an agent's pick outside the job is not", readJob(s, T + 9)?.local === undefined && readJob(s, T + 9)?.asked === "كافيهات شارع الخليج", JSON.stringify(readJob(s, T + 9)));
});

console.log("\n── an agent is never told a job written from words answered here ──");
attempt("a marked job reaches the on-device readers, and no agent", () => {
  const s = store();
  writeJob("salem-chat", { asked: "قهوة", shown: ["souq-sharq"], local: true }, s, T);
  ok("on-device, the job is still read (jobFor)", jobFor("shouq-call", s, T)?.local === true);
  ok("her call is not told it (jobToTell is null)", jobToTell("shouq-call", s, T) === null);
  ok("his call is not told it either", jobToTell("salem-call", s, T) === null);
  writeJob("salem-chat", { asked: "قهوة", shown: ["souq-sharq"] }, s, T + 1);
  ok("control: a job from an agent's own tool IS told to her call", jobToTell("shouq-call", s, T + 1)?.by === "salem-chat");
  ok("and an agent is still never handed its own", jobToTell("salem-chat", s, T + 1) === null);
});

console.log("\n── a pick stays with its job where it was shown, or where its own agent offered it ──");
attempt("a place only in another agent's answer starts its own job", () => {
  const s = store();
  writeJob("salem-chat", { asked: "بحر", shown: ["marina-mall"], ranked: ["marina-mall", "souq-sharq"] }, s, T);
  pickInJob("shouq-call", "souq-sharq", "سوق شرق", s, T + 5);
  const j = readJob(s, T + 5);
  ok("the pick is filed under its own name, not the old question", j.asked === "سوق شرق" && j.shown.join() === "souq-sharq", JSON.stringify(j));
});
attempt("her own pick from her own answer keeps the question", () => {
  const s = store();
  writeJob("shouq-call", { asked: "قهوة", shown: ["mubarakiya-tea-houses"], ranked: ["mubarakiya-tea-houses", "gulf-road-cafes"] }, s, T);
  pickInJob("shouq-call", "gulf-road-cafes", "كافيهات شارع الخليج", s, T + 5);
  ok("the question stays", readJob(s, T + 5).asked === "قهوة" && readJob(s, T + 5).picked === "gulf-road-cafes", JSON.stringify(readJob(s, T + 5)));
});
attempt("a place shown to the visitor stays with its job for any agent", () => {
  const s = store();
  writeJob("salem-chat", { asked: "قهوة", shown: ["mubarakiya-tea-houses", "gulf-road-cafes"] }, s, T);
  pickInJob("shouq-call", "gulf-road-cafes", "كافيهات شارع الخليج", s, T + 5);
  ok("a shown place keeps the question", readJob(s, T + 5).asked === "قهوة" && readJob(s, T + 5).picked === "gulf-road-cafes", JSON.stringify(readJob(s, T + 5)));
});

console.log("\n── a stale job leaves storage, and is not only ignored ──");
attempt("a read after half an hour removes the ticket from storage", () => {
  const s = store();
  writeJob("shouq-call", { asked: "قهوة", shown: ["souq-sharq"] }, s, T);
  ok("control: it is there before", s.m.has(JOB_KEY));
  ok("the read answers no job", readJob(s, T + JOB_TTL_MS + 1) === null);
  ok("and nothing is left under the key", !s.m.has(JOB_KEY));
});
attempt("a sweep removes a job nobody read, after half an hour", () => {
  const s = store();
  writeJob("shouq-call", { asked: "قهوة", shown: ["souq-sharq"] }, s, T);
  pruneJob(s, T + JOB_TTL_MS - 1000);
  ok("a sweep inside the half hour keeps it", s.m.has(JOB_KEY));
  pruneJob(s, T + JOB_TTL_MS + 1);
  ok("a sweep after it removes it", !s.m.has(JOB_KEY));
});
attempt("a ticket from the future is removed too", () => {
  const s = store();
  writeJob("shouq-call", { asked: "قهوة", shown: ["souq-sharq"] }, s, T);
  readJob(s, T - 120_000);
  ok("a future-stamped ticket is gone after the read", !s.m.has(JOB_KEY));
});

console.log(`\n${counts.pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
