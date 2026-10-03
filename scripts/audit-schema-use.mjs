#!/usr/bin/env node
/**
 * Does the site ask the back end for actions the back end has?
 *   npm run audit:schema
 *
 * This is the blind spot. TypeScript cannot check a string, the linter cannot
 * either, and none of the browser suites can — they all run against a fake
 * back end that answers whatever it is asked. An action renamed in
 * `wain-api.php` and not in the client, or a client calling an admin action
 * without the admin flag, is a runtime failure that appears only once the site
 * is actually connected, in front of a customer, and looks like "ordering is
 * broken".
 *
 * So this reads both sides and compares them. The server's side is asked of
 * the PHP BY the PHP (`php wain-api.php actions`), the way audit:tts asks each
 * voice table for itself — a regex over the source would pass the day it was
 * written. The client's side is every `call("…")` / `callSafe("…")` in src/.
 *
 * It also still holds `supabase/schema.sql` to one promise: every table the
 * API writes is described there with the same name, so the Postgres route
 * stays a true alternative rather than a stale one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let problems = 0;
const say = (msg) => { console.log("  ✗ " + msg); problems++; };

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

// ---- what the server offers ------------------------------------------------
let server;
try {
  server = JSON.parse(
    execFileSync("php", [join(ROOT, "scripts/publish/wain-api.php"), "actions"], { encoding: "utf8" })
  );
} catch (e) {
  say(`\`php scripts/publish/wain-api.php actions\` did not answer: ${String(e.message).split("\n")[0]}`);
  process.exit(1);
}
const offered = new Set([...server.read, ...server.publicWrites, ...server.admin]);
const adminOnly = new Set(server.admin);
console.log(`\nThe API offers ${offered.size} actions (${server.admin.length} admin-only).`);

// ---- what the client asks for -------------------------------------------------
console.log("\n── actions the client calls ──");
/** action -> [{file, admin}] */
const used = new Map();
const CALL = /\bcall(?:Safe)?(?:<[^>]*>)?\(\s*["'`]([a-z_]+)["'`]/g;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (!/from "@\/lib\/backend"/.test(src)) continue;
  for (const m of src.matchAll(CALL)) {
    const action = m[1];
    // The options object is the last argument, and the call's arguments can
    // hold their own parentheses (and a type argument its own `;`) — so walk
    // to the paren that closes THIS call, and look for `admin: true` inside.
    const open = src.indexOf("(", m.index + m[0].indexOf("("));
    let depth = 0, i = open;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "(") depth++;
      else if (ch === ")" && --depth === 0) break;
    }
    const admin = /admin:\s*true/.test(src.slice(open, i + 1));
    if (!used.has(action)) used.set(action, []);
    used.get(action).push({ file: f.replace(ROOT + "/", ""), admin });
  }
}
for (const [a, sites] of [...used].sort()) {
  const where = [...new Set(sites.map((s) => s.file))].join(", ");
  if (!offered.has(a)) {
    say(`«${a}» is called by ${where} but the API has no such action`);
    continue;
  }
  const needsAdmin = adminOnly.has(a);
  const withoutFlag = sites.filter((s) => needsAdmin && !s.admin);
  if (withoutFlag.length) {
    say(`«${a}» is admin-only, and ${withoutFlag.map((s) => s.file).join(", ")} calls it without { admin: true }`);
    continue;
  }
  const withFlag = sites.filter((s) => !needsAdmin && s.admin && a !== "queue_join");
  if (withFlag.length) {
    say(`«${a}» is public, and ${withFlag.map((s) => s.file).join(", ")} sends the admin token for no reason`);
    continue;
  }
  console.log(`  ✓ ${a}${needsAdmin ? " (admin)" : ""}`);
}
if (used.size === 0) say("no call() to the back end was found anywhere under src/ — the regex or the client moved");

// ---- the Postgres alternative still describes the same tables -------------------
console.log("\n── supabase/schema.sql still names every table the API writes ──");
const schema = readFileSync(join(ROOT, "supabase/schema.sql"), "utf8");
const php = readFileSync(join(ROOT, "scripts/publish/wain-api.php"), "utf8");
const apiTables = new Set([...php.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).filter((t) => t !== "locks"));
const pgTables = new Set([...schema.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]));
for (const t of [...apiTables].sort()) {
  if (pgTables.has(t)) console.log(`  ✓ ${t}`);
  else say(`the API has a table «${t}» that schema.sql does not describe`);
}

console.log(problems ? `\n${problems} problem(s)` : "\nالخادم والموقع متفقين — every action the site calls exists, with the right gate");
process.exit(problems ? 1 : 0);
