// The part-proposal queue, driven as an operator or an attacker would.
//
//   npm run test:hubparts        (starts its own hub on a spare port)
//
// This is the admin dashboard's one write path (see the "part proposals"
// block in server/hub-server.mjs for what it is and is not: a queue a
// human reviews, never a way to ship a part into the game). What has to
// be true of it:
//
//   accepts     a well-formed proposal is queued and comes back in the
//               GET list
//   rejects     every one of the six required fields is checked, with a
//               message naming what was wrong
//   bilingual   the same discipline tests/names.mjs already holds CARS,
//               RIVALS and LANDMARKS to — Arabic in the English name,
//               no Arabic in the Arabic name, Western digits in the
//               Arabic name, all refused
//   duplicate   an id already shipped in mods.ts is refused, and so is
//               one already queued
//   bounded     the queue has a cap, checked by reading the constant —
//               this endpoint is unauthenticated like every other one
//               in this file, so it can be filled with junk the same
//               way the lap/career stores can
//   persists    a proposal survives a restart — it is on disk, not in
//               memory, the same promise the referral ledger keeps
//   rejectable  DELETE clears a queued proposal
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8898;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "grn-hubparts-"));
const proposals = join(dir, "part-proposals.json");
const ledger = join(dir, "referrals.json");

function startHub() {
  const hub = spawn(process.execPath, ["server/hub-server.mjs"], {
    env: { ...process.env, HUB_PORT: String(PORT), HUB_LEDGER: ledger, HUB_PART_PROPOSALS: proposals },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  hub.stdout.on("data", (d) => { log += d; });
  hub.stderr.on("data", (d) => { log += d; });
  return { hub, log: () => log };
}
let { hub } = startHub();

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let reported = false;
function report() {
  if (reported) return;
  reported = true;
  try { hub.kill(); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  if (fail.length) {
    console.error(`\n${fail.length} FAILURE${fail.length === 1 ? "" : "S"}:`);
    for (const f of fail) console.error(`  - ${f}`);
  } else {
    console.log("\nthe queue accepts a real part, refuses a bad one by field, and never ships one");
  }
}
process.on("exit", report);
process.on("uncaughtException", (err) => {
  fail.push(`the run itself died: ${err.message}`);
  report();
  process.exit(1);
});

const post = (body) =>
  fetch(`${BASE}/api/v1/admin/parts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));
const list = () => fetch(`${BASE}/api/v1/admin/parts`).then((r) => r.json());
const del = (id) => fetch(`${BASE}/api/v1/admin/parts/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => r.json());

const GOOD = { id: "paint-desert-storm", cat: "paint", name: "Desert Storm", ar: "عاصفة صحراوية", price: 900, desc: "A flat sand that reads as armour under the lamps." };

// Wait for the hub to be listening.
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${BASE}/api/v1/status`);
    if (r.ok) break;
  } catch {}
  await sleep(250);
}

// --- 1. A well-formed proposal is accepted and comes back in the list --
{
  const r = await post(GOOD);
  check(r.status === 200 && r.json.accepted === true, `a well-formed proposal was refused: ${JSON.stringify(r.json)}`);
  const proposalId = r.json.proposal?.proposalId;
  check(!!proposalId, "an accepted proposal has no proposalId to look it up by");
  const l = await list();
  check(l.proposals.some((p) => p.proposalId === proposalId && p.id === GOOD.id), "the accepted proposal is not in the list");
  console.log(`accepts       proposalId ${proposalId} for "${GOOD.id}"`);
}

// --- 2. Every required field is actually checked ------------------------
{
  const bad = [
    [{ ...GOOD, id: "Paint Navy" }, "id"],
    [{ ...GOOD, id: "paint-navy-2", cat: "not-a-real-category" }, "an unknown cat"],
    [{ ...GOOD, id: "paint-navy-3", name: "" }, "empty name"],
    [{ ...GOOD, id: "paint-navy-4", name: "x".repeat(200) }, "an overlong name"],
    [{ ...GOOD, id: "paint-navy-5", ar: "" }, "an empty Arabic name"],
    [{ ...GOOD, id: "paint-navy-6", price: -1 }, "a negative price"],
    [{ ...GOOD, id: "paint-navy-7", price: 999999 }, "a price with no ceiling"],
    [{ ...GOOD, id: "paint-navy-8", price: "free" }, "a non-numeric price"],
    [{ ...GOOD, id: "paint-navy-9", desc: "x".repeat(2000) }, "an overlong description"],
  ];
  for (const [body, why] of bad) {
    const r = await post(body);
    check(r.status === 400 && typeof r.json.error === "string" && r.json.error.length > 0,
      `${why} was accepted (or refused with no message): ${JSON.stringify(r.json)}`);
  }
  console.log(`rejects       ${bad.length} malformed proposals, each with a reason`);
}

// --- 3. The bilingual discipline the rest of the catalogue keeps --------
{
  const cases = [
    [{ ...GOOD, id: "bi-1", name: "لون كحلي" }, "Arabic in the English name"],
    [{ ...GOOD, id: "bi-2", ar: "Navy Blue" }, "no Arabic in the Arabic name"],
    [{ ...GOOD, id: "bi-3", ar: "كحلي 5" }, "Western digits in an Arabic name"],
  ];
  for (const [body, why] of cases) {
    const r = await post(body);
    check(r.status === 400, `${why} was accepted: ${JSON.stringify(r.json)}`);
  }
  console.log(`bilingual     Arabic-in-English, no-Arabic-in-Arabic and Western digits all refused`);
}

// --- 4. Duplicates: against the shipped catalogue, and against the queue
{
  const shipped = await post({ ...GOOD, id: "paint-white" }); // a real, shipped id
  check(shipped.status === 400 && /shipped/.test(shipped.json.error ?? ""),
    `an id already in mods.ts was accepted: ${JSON.stringify(shipped.json)}`);
  const dupe = await post(GOOD); // GOOD.id was queued in case 1
  check(dupe.status === 400 && /proposed/.test(dupe.json.error ?? ""),
    `an id already queued was accepted a second time: ${JSON.stringify(dupe.json)}`);
  console.log(`duplicate     a shipped id and an already-queued id both refused`);
}

// --- 5. The queue is bounded, the same way the other unauthenticated
//        stores in this file are (read the constant, not five hundred
//        requests) --------------------------------------------------
{
  const src = readFileSync("server/hub-server.mjs", "utf8");
  const m = src.match(/const MAX_PART_PROPOSALS = ([^;]+);/);
  check(!!m, "MAX_PART_PROPOSALS is gone — an unauthenticated caller can grow the queue without limit");
  if (m) console.log(`bounded       MAX_PART_PROPOSALS = ${m[1].trim()}`);
}

// --- 6. It persists — kill the hub, start a fresh one on the same files
{
  hub.kill();
  await sleep(300);
  ({ hub } = startHub());
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/v1/status`)).ok) break; } catch {}
    await sleep(250);
  }
  const l = await list();
  check(l.proposals.some((p) => p.id === GOOD.id), "a queued proposal did not survive a restart");
  console.log(`persists      ${l.proposals.length} proposal(s) survived a restart`);
}

// --- 7. DELETE clears one, and only the one asked for --------------------
{
  const l0 = await list();
  const mine = l0.proposals.find((p) => p.id === GOOD.id);
  const other = l0.proposals.find((p) => p.id !== GOOD.id);
  const r = await del(mine.proposalId);
  check(r.deleted === true, "a real proposalId was not deleted");
  const l1 = await list();
  check(!l1.proposals.some((p) => p.proposalId === mine.proposalId), "the deleted proposal is still listed");
  check(!other || l1.proposals.some((p) => p.proposalId === other.proposalId), "deleting one proposal deleted another");
  const again = await del(mine.proposalId);
  check(again.deleted === false, "deleting an already-gone proposalId did not say so");
  console.log(`rejectable    one proposal cleared, the rest untouched, a repeat delete reports false`);
}

report();
process.exit(fail.length ? 1 : 0);
