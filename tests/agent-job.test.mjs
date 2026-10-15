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
let pass = 0;
const fails = [];
const ok = (n, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); } };

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
const { readJob, writeJob, pickInJob, jobFor, jobContext, JOB_KEY, JOB_TTL_MS } = await import(pathToFileURL(bundle).href);
rmSync(tmp, { recursive: true, force: true });

/** A Storage double: a Map, and a switch that makes every call throw. */
function store() {
  const m = new Map();
  return {
    m,
    blocked: false,
    getItem(k) { if (this.blocked) throw new Error("SecurityError"); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (this.blocked) throw new Error("SecurityError"); m.set(k, String(v)); },
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

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
