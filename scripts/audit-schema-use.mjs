#!/usr/bin/env node
/**
 * Does the app ask the database for things the database has?
 *   npm run audit:schema
 *
 * This is the blind spot. TypeScript cannot check a string, the linter cannot
 * either, and none of the test suites can — they all run without Supabase or
 * against a fake one that answers whatever it is asked. A table renamed in
 * schema.sql and not in the client, a column dropped from a select list, an
 * RPC whose argument names drifted: every one of those is a runtime failure
 * that appears only once the site is actually connected, in front of a
 * customer, and looks like "ordering is broken".
 *
 * So this reads both sides and compares them.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = readFileSync(join(ROOT, "supabase/schema.sql"), "utf8");

/** Every .ts/.tsx under src/. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}
const files = walk(join(ROOT, "src"));

// ---- what the database offers ---------------------------------------------
const tables = new Set(
  [...schema.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1])
);
/** name -> Set of argument names, from the CREATE FUNCTION signature. */
const functions = new Map();
for (const m of schema.matchAll(/create or replace function public\.(\w+)\s*\(([^)]*)\)/g)) {
  const args = [...m[2].matchAll(/(?:^|,)\s*(\w+)\s+\w/g)].map((a) => a[1]);
  functions.set(m[1], new Set(args));
}
/** table -> Set of column names, from the CREATE TABLE body. */
const columns = new Map();
for (const m of schema.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
  const cols = new Set();
  for (const line of m[2].split("\n")) {
    const c = line.match(/^\s{2}(\w+)\s+\S/);
    if (c && !/^(primary|unique|check|constraint|foreign)$/i.test(c[1])) cols.add(c[1]);
  }
  // Columns added later by the upgrade blocks count too.
  for (const a of schema.matchAll(
    new RegExp(`alter table public\\.${m[1]}[\\s\\S]*?;`, "g")
  )) {
    for (const c of a[0].matchAll(/add column if not exists\s+(\w+)/g)) cols.add(c[1]);
  }
  columns.set(m[1], cols);
}

let problems = 0;
const say = (msg) => { console.log("  ✗ " + msg); problems++; };

console.log(`\nSchema offers ${tables.size} tables and ${functions.size} functions.`);

// ---- what the app asks for -------------------------------------------------
console.log("\n── tables the client reads or writes ──");
const usedTables = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\.from\(\s*["'](\w+)["']\s*\)/g)) {
    if (!usedTables.has(m[1])) usedTables.set(m[1], new Set());
    usedTables.get(m[1]).add(f.replace(ROOT + "/", ""));
  }
}
for (const [t, where] of [...usedTables].sort()) {
  // storage.from() is the storage client, not a table.
  if (t === "business-pending" || t === "business-media") continue;
  if (tables.has(t)) console.log(`  ✓ ${t}`);
  else say(`public.${t} is used by ${[...where].join(", ")} but is not in schema.sql`);
}

console.log("\n── functions the client calls, and the arguments it passes ──");
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\.rpc\(\s*["'](\w+)["']\s*,\s*\{([^}]*)\}/g)) {
    const [, name, argBlock] = m;
    const where = f.replace(ROOT + "/", "");
    if (!functions.has(name)) { say(`public.${name}() called from ${where} does not exist`); continue; }
    const passed = [...argBlock.matchAll(/(\w+)\s*:/g)].map((a) => a[1]);
    const declared = functions.get(name);
    const unknown = passed.filter((a) => !declared.has(a));
    if (unknown.length) say(`${name}() called with ${unknown.join(", ")} — not in its signature (${[...declared].join(", ")})`);
    else console.log(`  ✓ ${name}(${passed.join(", ")})`);
  }
}

console.log("\n── columns named in select lists ──");
for (const f of files) {
  const src = readFileSync(f, "utf8");
  // .from("t")….select("a,b,c") — the explicit lists, which are the ones that
  // can name a column that is not there.
  for (const m of src.matchAll(/\.from\(\s*["'](\w+)["']\s*\)([\s\S]{0,400}?)\.select\(\s*\n?\s*["']([^"']+)["']/g)) {
    const [, table, , list] = m;
    if (list.trim() === "*" || !columns.has(table)) continue;
    const known = columns.get(table);
    const missing = list.split(",").map((c) => c.trim()).filter((c) => c && !c.includes("(") && !known.has(c));
    if (missing.length) say(`${table}.select names ${missing.join(", ")}, which ${table} does not have`);
    else console.log(`  ✓ ${table}: ${list.split(",").length} columns all exist`);
  }
}

console.log("\n── columns used in filters, inserts and updates ──");
let checked = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\.from\(\s*["'](\w+)["']\s*\)/g)) {
    const table = m[1];
    if (!columns.has(table)) continue;
    const known = columns.get(table);
    // The chain belongs to this .from() until the next one starts. A fixed
    // window instead read straight past the end of the query: the window after
    // .from("places") swallowed the .from("submissions").update() below it and
    // reported four submissions columns as missing from places. Bounded here,
    // so a chain is never blamed for the one after it.
    const next = src.indexOf(".from(", m.index + 6);
    const end = next === -1 ? src.length : next;
    const tail = src.slice(m.index, Math.min(end, m.index + 900));
    for (const eq of tail.matchAll(/\.(?:eq|neq|gt|lt|gte|lte|order)\(\s*["'](\w+)["']/g)) {
      checked++;
      if (!known.has(eq[1])) say(`${table}: filtered or ordered on "${eq[1]}", which it does not have`);
    }
    // The object handed to insert()/update(): its keys are column names, and a
    // wrong one is rejected by PostgREST at runtime and nowhere earlier.
    for (const w of tail.matchAll(/\.(?:insert|update)\(\s*\{([\s\S]{0,700}?)\n\s*\}\)/g)) {
      for (const key of w[1].matchAll(/^\s{2,}(\w+):/gm)) {
        checked++;
        if (!known.has(key[1])) say(`${table}: written with "${key[1]}", which it does not have`);
      }
    }
  }
}
console.log(`  ${checked} column reference(s) checked.`);
if (checked === 0) say("nothing was checked here — the scanner matched no filters, which cannot be right");

console.log(
  problems
    ? `\n${problems} mismatch(es) between the client and schema.sql.`
    : "\nEvery table, function, argument and column the client names exists in schema.sql."
);
process.exit(problems ? 1 : 0);
