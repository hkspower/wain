#!/usr/bin/env node
/**
 * Row level security, read off the schema:  npm run audit:rls
 *
 * Asked for on 1 October — «enable rls». It was already on for every table,
 * and nothing said so except a person reading 1,000 lines of SQL; the day a
 * table is added without it, a public anon key can read and write it whole.
 * So the claim is a check now, and it found two real gaps on its first run:
 *
 *   - Two trigger functions resolved names through the caller's search_path.
 *     Supabase's own linter flags exactly that (function_search_path_mutable);
 *     the security definer functions beside them already pinned it.
 *   - The grants only ever ADDED. Supabase's default privileges hand anon and
 *     authenticated ALL on every new table in public — TRUNCATE included, and
 *     TRUNCATE is not subject to RLS. PostgREST does not expose it, so it was
 *     not reachable through the API, but «the grants are what this file says»
 *     was not true until each table revoked first.
 *
 * It reads supabase/schema.sql and nothing else, so it needs no database.
 * `npm run test:db` is the other half: it runs the file on a real PostgreSQL
 * and proves the policies behave. This one proves they are all there.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = process.argv[2] ?? join(ROOT, "supabase/schema.sql");
// Comments are prose here and quote SQL freely; only statements count.
const sql = readFileSync(FILE, "utf8").replace(/--[^\n]*/g, "");

const fails = [];
const fail = (m) => fails.push(m);

const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
// A selector that drifts must not pass by finding nothing to check.
if (tables.length === 0) fail("found no tables — the pattern no longer matches schema.sql");

for (const t of tables) {
  if (!new RegExp(`alter table public\\.${t}\\s+enable row level security`).test(sql))
    fail(`${t}: no «enable row level security»`);
  // Every table here is reached by the API, so every one needs at least one
  // policy; a table with RLS on and no policy is closed to everyone, which is
  // a decision that belongs in this list with its reason, not an accident.
  if (!new RegExp(`create policy "[^"]+"\\s+on public\\.${t}\\b`).test(sql))
    fail(`${t}: RLS is on but no policy names it`);

  const grant = sql.search(new RegExp(`grant [^;]*\\bon public\\.${t}\\s+to [^;]*\\b(anon|authenticated)\\b`));
  if (grant >= 0) {
    const revoke = sql.search(new RegExp(`revoke all on public\\.${t}\\s+from anon, authenticated`));
    if (revoke < 0 || revoke > grant)
      fail(`${t}: granted to anon/authenticated without «revoke all … from anon, authenticated» first — the default privileges stay on top`);
  }
}

// Policies that open a write to everyone.
for (const m of sql.matchAll(/create policy "([^"]+)"\s+on ([\w.]+)\s+for (\w+)([^;]*);/g)) {
  const [, name, on, cmd, body] = m;
  if (cmd !== "select" && /\b(using|with check)\s*\(\s*true\s*\)/.test(body))
    fail(`policy «${name}» on ${on}: ${cmd} with (true)`);
  if (on === "storage.objects" && !/bucket_id\s*=/.test(body))
    fail(`policy «${name}» on storage.objects is not scoped to a bucket`);
  // 2 October: photo uploads go to /api/media.php, so the anonymous upload
  // policy on business-pending was a write nobody called — 12MB a file and no
  // limit on how many, through a public key. Nothing anonymous writes to
  // storage now; one that comes back must be a decision, not a leftover.
  if (on === "storage.objects" && cmd === "insert" && /\bto\b[^()]*\banon\b/.test(body))
    fail(`policy «${name}»: anonymous upload into storage`);
}

// A grant only opens a door the policies then govern, and an INSERT grant to
// anon with no insert policy for anon is a door nothing walks through — until
// somebody adds a policy and finds the grant already there. queue_tickets
// carried one for weeks; join_queue() is security definer and never needed it.
for (const t of tables) {
  if (!new RegExp(`grant [^;]*\\binsert\\b[^;]*\\bon public\\.${t}\\s+to [^;]*\\banon\\b`).test(sql)) continue;
  const policies = [...sql.matchAll(new RegExp(`create policy "[^"]+"\\s+on public\\.${t}\\s+for insert([^;]*);`, "g"))];
  if (!policies.some((p) => /\bto\b[^()]*\banon\b/.test(p[1])))
    fail(`${t}: INSERT granted to anon, but no insert policy lets anon in — a dead grant`);
}

// Functions: a pinned search_path on all of them, and no PUBLIC execute on a
// security definer one.
for (const m of sql.matchAll(/create or replace function public\.(\w+)\s*\(([^)]*)\)([\s\S]*?)as \$\$/g)) {
  const [, name, , header] = m;
  if (!/set search_path\s*=/.test(header)) fail(`function ${name}(): search_path is not pinned`);
  if (/security definer/.test(header) &&
      !new RegExp(`revoke all on function public\\.${name}\\s*\\([^)]*\\)\\s+from public`).test(sql))
    fail(`function ${name}(): security definer, but PUBLIC's execute is never revoked`);
}

if (fails.length) {
  console.error(`audit:rls — ${fails.length} problem${fails.length === 1 ? "" : "s"} in schema.sql:`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`audit:rls: ${tables.length} tables, RLS on and a policy for each; grants exact; every function pins search_path ✓`);
