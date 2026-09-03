/**
 * The schema, against a real PostgreSQL.   npm run test:db
 *
 * `supabase/schema.sql` is generated, committed, and — until this file existed
 * — had never been run by anything in this repository. It was read carefully
 * and reasoned about, which is not the same thing. Two defects were sitting in
 * the committed file, and both are the kind only a database will tell you
 * about:
 *
 *  1. Eight of the 44 places have no `rating`, and the generator wrote the
 *     bare word `undefined` for them. PostgreSQL reads a bare word as a column
 *     name: «ERROR: column "undefined" does not exist», which aborts the whole
 *     INSERT. Applying the file to a fresh project produced the tables and
 *     **zero places**.
 *
 *  2. Every admin policy inlined «exists (select 1 from public.admins …)».
 *     PostgreSQL evaluates ALL permissive policies for a command and ORs them,
 *     so an anonymous «select … from places» ran that subquery too — and anon
 *     holds no grant on admins: «ERROR: permission denied for table admins».
 *     Not zero rows, an error, on the one query the whole public site is built
 *     from. Every place page, the search index, the map.
 *
 * Neither is visible by reading TypeScript, and neither would have surfaced
 * until the day someone finally enabled Supabase — at which point the site
 * would have gone dark and the cause would have been two commits and several
 * months behind.
 *
 * So this stands up a throwaway cluster, applies the real file, and asks the
 * database the questions that matter, as the roles that will actually ask
 * them. It skips cleanly where PostgreSQL is not installed rather than
 * failing, because a missing binary is not a broken schema.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); }
};

/* ── find a server ───────────────────────────────────────────────────────── */
const BINDIR = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", "/usr/local/bin", "/usr/bin"]
  .find((d) => existsSync(join(d, "initdb")) && existsSync(join(d, "pg_ctl")));
if (!BINDIR) {
  console.log("\nPostgreSQL is not installed here — skipping the schema tests.");
  console.log("Install postgresql-16 to run them; CI and the sandbox both have it.");
  process.exit(0);
}

const PORT = process.env.WAIN_PGPORT || "54331";
const DATA = mkdtempSync(join(tmpdir(), "wain-db-"));
const SOCK = mkdtempSync(join(tmpdir(), "wain-sock-"));
/* initdb refuses to run as root, which is how this sandbox runs. */
const AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;
const RUNNER = "pgtest";

function sh(cmd, { check = true } = {}) {
  const full = AS_ROOT ? ["su", RUNNER, "-c", `PATH=${BINDIR}:$PATH ${cmd}`] : ["sh", "-c", `PATH=${BINDIR}:$PATH ${cmd}`];
  const r = spawnSync(full[0], full.slice(1), { encoding: "utf8" });
  if (check && r.status !== 0) throw new Error(`${cmd}\n${r.stdout}\n${r.stderr}`);
  return (r.stdout || "") + (r.stderr || "");
}

if (AS_ROOT) {
  spawnSync("useradd", ["-m", RUNNER], { encoding: "utf8" });
  spawnSync("chown", ["-R", RUNNER, DATA, SOCK], { encoding: "utf8" });
}

let started = false;
function stop() {
  if (started) sh(`pg_ctl -D ${DATA} -m immediate stop`, { check: false });
  rmSync(DATA, { recursive: true, force: true });
  rmSync(SOCK, { recursive: true, force: true });
}
process.on("exit", stop);

console.log("\n── the file applies to a real database at all ──");
sh(`initdb -D ${DATA} -A trust -U postgres`);
sh(`pg_ctl -D ${DATA} -o '-p ${PORT} -k ${SOCK}' -l ${DATA}/log start`);
started = true;
// pg_ctl returns once the postmaster reports ready, but give the socket a beat.
for (let i = 0; i < 30; i++) {
  if (sh(`pg_isready -h ${SOCK} -p ${PORT}`, { check: false }).includes("accepting")) break;
  execFileSync("sleep", ["0.2"]);
}

const psql = (sqlText, { db = "wain", role = null, uid = null } = {}) => {
  const prefix = [role && `set role ${role};`, uid && `set request.jwt.claim.sub = '${uid}';`]
    .filter(Boolean).join(" ");
  const r = spawnSync("psql", ["-h", SOCK, "-p", PORT, "-U", "postgres", "-d", db, "-At", "-q", "-c", prefix + sqlText],
    { encoding: "utf8", env: { ...process.env, PATH: `${BINDIR}:${process.env.PATH}` } });
  return { out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), code: r.status };
};

psql("create database wain;", { db: "postgres" });

/* Supabase supplies these; the schema assumes them. Their absence is not a
   defect in the file, so they are scaffolded rather than asserted. */
const scaffold = `
create schema if not exists auth;
create schema if not exists storage;
create role anon nologin; create role authenticated nologin;
create extension if not exists pgcrypto;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text unique, created_at timestamptz default now());
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now(), metadata jsonb);
alter table storage.objects enable row level security;
create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $fn$;
create or replace function auth.role() returns text language sql stable as $fn$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $fn$;
grant usage on schema public to anon, authenticated;
`;
psql(scaffold);

const applied = spawnSync("psql",
  ["-h", SOCK, "-p", PORT, "-U", "postgres", "-d", "wain", "-v", "ON_ERROR_STOP=1", "-f", "supabase/schema.sql"],
  { encoding: "utf8", env: { ...process.env, PATH: `${BINDIR}:${process.env.PATH}` } });
const applyErr = (applied.stderr || "").split("\n").filter((l) => /ERROR/i.test(l)).slice(0, 3).join(" | ");
ok("supabase/schema.sql applies without error", applied.status === 0, applyErr);
if (applied.status !== 0) {
  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(1);
}

ok("and seeds every place the site ships",
  psql("select count(*) from public.places;").out === "44", psql("select count(*) from public.places;").out);
// The eight that have no rating are the reason the file used to be unappliable.
ok("including the eight with no rating, as NULL rather than a broken literal",
  psql("select count(*) from public.places where rating is null;").out === "8",
  psql("select count(*) from public.places where rating is null;").out);

console.log("\n── an anonymous visitor: the public site ──");
{
  /**
   * The assertion the whole file exists for. This returned
   * «permission denied for table admins» — an error, not a row count — because
   * the admin SELECT policy read a table anon cannot touch.
   */
  const r = psql("select count(*) from public.places;", { role: "anon" });
  ok("can read the published places", r.out === "44", r.err || r.out);
  ok("and gets no error doing it", !/permission denied/i.test(r.err), r.err);
}

console.log("\n── an anonymous visitor: everything they must not do ──");
{
  const denied = (label, sqlText) => {
    const r = psql(sqlText, { role: "anon" });
    ok(label, /permission denied|violates row-level security/i.test(r.err), r.err || `ALLOWED: ${r.out}`);
  };
  denied("cannot edit a place", "update public.places set rating = 1;");
  denied("cannot delete places", "delete from public.places;");
  denied("cannot read anyone's orders", "select customer_phone from public.orders;");
  denied("cannot read the queue", "select customer_phone from public.queue_tickets;");
  denied("cannot read submissions", "select * from public.submissions;");
  denied("cannot read the admin list", "select * from public.admins;");
  denied("cannot make themselves an admin",
    "insert into public.admins(user_id,email) values (gen_random_uuid(),'x@x');");
  ok("and is_admin() says no", psql("select public.is_admin();", { role: "anon" }).out === "f");
}

console.log("\n── an order belongs to whoever holds the token ──");
{
  const id = psql("select gen_random_uuid();").out;
  const tok = "tok_" + "a".repeat(24);
  psql(`update public.places set accepts_orders = true where slug = 'mubarakiya-tea-houses';`);
  const ins = psql(
    `insert into public.orders(id,track_token,place_slug,place_name_ar,lines,total_fils,pickup_at,customer_name,customer_phone,note_ar,admin_note)
     values ('${id}','${tok}','mubarakiya-tea-houses','مقاهي المباركية','[{"id":"m1","nameAr":"چاي","qty":2,"priceFils":250}]'::jsonb,500,'18:30','بدر','99887766','','');`,
    { role: "anon" });
  ok("an anonymous customer can place one", ins.code === 0, ins.err);
  ok("but still cannot read the table it went into",
    /permission denied/i.test(psql("select customer_phone from public.orders;", { role: "anon" }).err));

  ok("the right token returns it",
    psql(`select status from public.order_status('${id}','${tok}');`, { role: "anon" }).out === "placed");
  // The property the whole tracking design rests on.
  ok("a wrong token returns nothing at all",
    psql(`select count(*) from public.order_status('${id}','tok_${"b".repeat(24)}');`, { role: "anon" }).out === "0");
  ok("a wrong token cannot cancel it",
    psql(`select public.cancel_order('${id}','tok_${"b".repeat(24)}');`, { role: "anon" }).out !== "cancelled");
  ok("the right token can",
    psql(`select public.cancel_order('${id}','${tok}');`, { role: "anon" }).out === "cancelled");
}

console.log("\n── the queue, and who may add a walk-in ──");
{
  psql(`update public.places set takes_queue = true, salon_kind = 'men' where slug = 'hamad-al-mubarak-street';`);
  const id = psql("select gen_random_uuid();").out;
  const tok = "qtok_" + "c".repeat(24);
  ok("an anonymous customer takes ticket ١",
    psql(`select public.join_queue('${id}','${tok}','hamad-al-mubarak-street','شارع حمد المبارك','بدر');`,
      { role: "anon" }).out === "1");
  ok("and can watch their own ticket by token",
    psql(`select status from public.queue_status('${id}','${tok}');`, { role: "anon" }).out === "waiting");
  // A walk-in is someone standing at the counter; only staff can assert that.
  ok("but cannot add a walk-in, which only staff can",
    /only staff can add a walk-in/i.test(
      psql(`select public.join_queue(gen_random_uuid(),'qtok_${"d".repeat(24)}','hamad-al-mubarak-street','ش','x','','walk_in');`,
        { role: "anon" }).err));
}

console.log("\n── an admin ──");
{
  const uid = psql("insert into auth.users(email) values ('boss@wainkw.com') returning id;").out;
  psql(`insert into public.admins(user_id,email) values ('${uid}','boss@wainkw.com');`);
  const as = (sqlText) => psql(sqlText, { role: "authenticated", uid });
  ok("is recognised by is_admin()", as("select public.is_admin();").out === "t");
  ok("can read every place", as("select count(*) from public.places;").out === "44");
  ok("can edit one", as("update public.places set rating = 4.9 where slug = 'kuwait-towers';").code === 0);
  ok("and the edit lands", psql("select rating from public.places where slug='kuwait-towers';").out === "4.9");
  // The admins policy matches on the row, not via is_admin(), precisely so this
  // does not recurse — the schema records that failure and this proves the fix.
  ok("reads their own admin row without infinite recursion",
    as("select email from public.admins;").out === "boss@wainkw.com");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
