// The hub, attacked.
//
//   npm run test:hubsec        (starts its own hub on a spare port)
//
// Every case here is an attack that WORKED before the fix beside it. A
// security fix nobody tried to break is a comment, so each one is run as
// the attacker would run it: connect, send the message, and see what the
// hub does.
//
// WHAT THIS HUB IS, SO THAT WHAT IT IS NOT IS NOT REPORTED AS A BUG
//
// There are no accounts. The wallet is a number in the player's own
// browser and the game says so in three files. So "a player can give
// themselves money" is not in scope and cannot be fixed here — it needs
// accounts, which is a different game.
//
// What IS in scope is everything one player can do to ANOTHER: take
// their crew, delete it, spend their unclaimed rewards, learn the one
// credential this hub has, or take the hub down for everybody.

import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8899;
const URL = `ws://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "grn-hubsec-"));
const ledger = join(dir, "referrals.json");

const hub = spawn(process.execPath, ["server/hub-server.mjs"], {
  env: { ...process.env, HUB_PORT: String(PORT), HUB_LEDGER: ledger },
  stdio: ["ignore", "pipe", "pipe"],
});
let hubLog = "";
hub.stdout.on("data", (d) => { hubLog += d; });
hub.stderr.on("data", (d) => { hubLog += d; });

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Report on the way out, however we leave.
//
// One of these attacks KILLS the hub — that is the point of it — and
// when it did, the run died on the next connect and never printed the
// findings it had already made. I read that silence as "those checks
// passed" and it meant the opposite. A test that only reports when it
// survives to the end is a test that hides its results exactly when
// there is most to report.
let reported = false;
function report() {
  if (reported) return;
  reported = true;
  try { hub.kill(); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  if (fail.length) {
    console.error(`\n${fail.length} FAILURE${fail.length === 1 ? "" : "S"}:`);
    for (const f of fail) console.error(`  - ${f}`);
    if (process.env.HUB_LOG) console.error(`\n--- hub output ---\n${hubLog}`);
  } else {
    console.log("\none player cannot take another's crew, their rewards, their id, or the hub");
  }
}
process.on("exit", report);
process.on("uncaughtException", (err) => {
  fail.push(`the run itself died: ${err.message} — the hub was probably gone`);
  report();
  process.exit(1);
});

/** A player: connects, collects everything the hub says. */
async function connect(join) {
  const ws = new WebSocket(URL);
  const seen = [];
  ws.on("message", (raw) => { try { seen.push(JSON.parse(raw.toString())); } catch {} });
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  if (join) ws.send(JSON.stringify({ t: "join", ...join }));
  await sleep(150);
  return {
    ws,
    seen,
    send: (m) => ws.send(JSON.stringify(m)),
    last: (t) => [...seen].reverse().find((m) => m.t === t),
    all: (t) => seen.filter((m) => m.t === t),
    close: () => ws.close(),
  };
}

// Wait for the hub to be listening.
for (let i = 0; i < 60; i++) {
  try {
    const probe = new WebSocket(URL);
    await new Promise((res, rej) => { probe.once("open", res); probe.once("error", rej); });
    probe.close();
    break;
  } catch { await sleep(250); }
}

// --- 1. Crew takeover by typing somebody's name -----------------------
//
// BEFORE: connect as "Bu Machboos", send team-create with their crew's
// name and tag, and the hub agreed you founded it — handing you the
// roster and letting you rewrite the name, tag and badge on disk.
{
  const owner = await connect({ name: "Bu Machboos", color: "#c1121f", pid: "PID-OWNER" });
  owner.send({ t: "team-create", name: "Salmiya Kings", tag: "SK", logo: { shape: "hex", symbol: "🦅" } });
  await sleep(200);
  const mine = owner.last("team-you");
  check(!!mine?.team, "the founder could not found a crew at all");

  const thief = await connect({ name: "Bu Machboos", color: "#0d0e11", pid: "PID-THIEF" });
  thief.send({ t: "team-create", name: "Salmiya Kings", tag: "SK", logo: { shape: "circle", symbol: "💀" } });
  await sleep(250);

  const after = thief.last("teams")?.teams ?? owner.last("teams")?.teams ?? [];
  const crew = after.find((t) => t.tag === "SK");
  check(!!crew, "the crew vanished");
  check(crew?.name === "Salmiya Kings", `the crew was renamed to "${crew?.name}"`);
  check(
    crew?.logo?.symbol !== "💀",
    "an impersonator restyled somebody else's crew badge"
  );
  console.log(`crew takeover   badge is still ${JSON.stringify(crew?.logo?.symbol)}, name "${crew?.name}"`);

  // --- 2. Crew deletion by leaving as somebody else -------------------
  //
  // BEFORE: team-leave removed the member whose NAME you had typed. As
  // the only member, that deleted the crew from disk.
  thief.send({ t: "team-leave" });
  await sleep(250);
  const still = (thief.last("teams")?.teams ?? []).find((t) => t.tag === "SK");
  check(!!still, "an impersonator deleted somebody else's crew by leaving it");
  console.log(`crew deletion   the crew is ${still ? "still there" : "GONE"}`);

  owner.close();
  thief.close();
  await sleep(150);
}

// --- 3. A reward token must not carry the other save's id -------------
//
// BEFORE: the host's owed list held `invited:<the invitee's pid>`, and
// ref-state sends owed to the host. Inviting somebody handed you their
// save id — the only credential this hub has.
{
  const host = await connect({ name: "Host", color: "#f2f4f7", pid: "PID-HOST", code: "HOSTAA" });
  await sleep(150);
  const guest = await connect({ name: "Guest", color: "#f2f4f7", pid: "PID-GUEST-SECRET", code: "GUESTB" });
  guest.send({ t: "ref-claim", code: "HOSTAA" });
  await sleep(300);

  const res = guest.last("ref-result");
  check(res?.ok === true, `the invite was refused: ${res?.reason}`);

  const hostState = host.last("ref-state");
  const blob = JSON.stringify(hostState ?? {});
  check(
    !blob.includes("PID-GUEST-SECRET"),
    `the host's ref-state leaks the guest's save id: ${blob}`
  );
  check((hostState?.owed?.length ?? 0) > 0, "the host was owed nothing after a successful invite");
  console.log(`pid leak        host sees ${hostState?.owed?.length} reward(s), none naming the guest`);

  host.close();
  guest.close();
  await sleep(150);
}

// --- 4. A malformed message must not end the night --------------------
//
// Every branch below runs on network input. An uncaught throw in a
// socket handler ends the process and takes every other player with it.
{
  const p = await connect({ name: "Fuzzer", color: "#f2f4f7", pid: "PID-FUZZ" });
  const nasty = [
    { t: "duel-quit" },
    { t: "duel-answer", accept: true },
    { t: "team-join", id: { toString: null } },
    { t: "team-create", name: null, tag: null, logo: 7 },
    { t: "state", s: "NaN", lat: [], speed: {} },
    { t: "chat", text: { toString: null } },
    { t: "lap", ms: Infinity },
    { t: "ref-banked", tokens: "not-an-array" },
    { t: "ref-claim", code: 12345 },
    { t: "duel-challenge", targetId: "abc", wager: -1e30 },
    { t: "__proto__" },
    { t: "join", name: "x".repeat(5000) },
  ];
  for (const m of nasty) { p.send(m); await sleep(30); }
  await sleep(300);

  const alive = await connect({ name: "Still here", color: "#f2f4f7" });
  check(!!alive.last("welcome"), "the hub stopped answering after a malformed message");
  console.log(`fuzz            ${nasty.length} malformed messages, hub still answering`);
  p.close();
  alive.close();
  await sleep(150);
}

// --- 5. One socket must not be able to spin the hub flat out ----------
{
  const p = await connect({ name: "Flood", color: "#f2f4f7" });
  for (let i = 0; i < 2000; i++) p.send({ t: "state", s: i, lat: 0, speed: 40 });
  await sleep(400);
  const alive = await connect({ name: "After flood", color: "#f2f4f7" });
  check(!!alive.last("welcome"), "the hub stopped answering after a message flood");
  console.log("flood           2,000 messages from one socket, hub still answering");
  p.close();
  alive.close();
  await sleep(150);
}

// --- 6. The name-keyed stores are bounded ------------------------------
//
// Both are written by unauthenticated callers with a name of their
// choosing, so both can be filled with junk. They are capped; the cap is
// checked by reading the constant rather than by sending five thousand
// requests, because the point is that a cap EXISTS.
{
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("server/hub-server.mjs", "utf8");
  for (const name of ["MAX_CAREERS", "MAX_LAP_NAMES", "MAX_SOCKETS", "MAX_FRAME_BYTES"]) {
    const m = src.match(new RegExp(`const ${name} = ([^;]+);`));
    check(!!m, `${name} is gone — an unauthenticated caller can grow that store without limit`);
    if (m) console.log(`cap             ${name} = ${m[1].trim()}`);
  }
  // The frame cap has to be small enough to matter: ws defaults to 100 MB.
  const frame = src.match(/const MAX_FRAME_BYTES = ([^;]+);/);
  if (frame) {
    const bytes = Function(`return (${frame[1]})`)();
    check(bytes <= 64 * 1024, `frames up to ${bytes} bytes are allowed`);
  }
}

report();
process.exit(fail.length ? 1 : 0);
