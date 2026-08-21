// A crew has to survive the hub being restarted.
//
//   node tests/crews.mjs
//
// No browser and no dev server: this starts the real hub on a spare port
// with a throwaway ledger, founds a crew with real WebSocket clients,
// kills the process, starts it again on the same ledger, and asks
// whether the crew is still there.
//
// It used not to be. A crew lived in one `Map` and nowhere else, so a
// restart dropped every roster. Your OWN crew came back — the client
// keeps it beside the save and republishes it on connect — but nobody
// else in it did, and when they reconnected and republished theirs, the
// "one crew at a time" guard answered with silence. The visible symptom
// was a player looking at their own crew badge while the hub insisted
// they had no crew, which is indistinguishable from a network fault.
//
// So the two halves are tested separately: the roster is on disk, and
// republishing an existing crew is answered rather than swallowed.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const PORT = 8801;
const dir = mkdtempSync(join(tmpdir(), "grn-crews-"));
const LEDGER = join(dir, "referrals.json");

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

let server = null;
function startHub() {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["server/hub-server.mjs"], {
      env: { ...process.env, HUB_PORT: String(PORT), HUB_LEDGER: LEDGER },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const onData = (b) => {
      out += b.toString();
      if (out.includes("listening") || out.includes(String(PORT))) resolve(p);
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    setTimeout(() => resolve(p), 1500);
  });
}

function stopHub(p) {
  return new Promise((resolve) => {
    if (!p || p.exitCode !== null) return resolve();
    p.on("exit", resolve);
    p.kill("SIGTERM");
    setTimeout(resolve, 1500);
  });
}

/** A connected save. Records what arrives; works nothing out itself. */
function connect(pid, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const client = {
      ws,
      name,
      you: undefined,          // the last team-you, including a null one
      teams: [],
      close: () => ws.close(),
      create: (n, tag, logo) =>
        ws.send(JSON.stringify({ t: "team-create", name: n, tag, logo })),
      join: (id) => ws.send(JSON.stringify({ t: "team-join", id })),
      leave: () => ws.send(JSON.stringify({ t: "team-leave" })),
    };
    ws.on("open", () =>
      ws.send(JSON.stringify({ t: "join", name, color: "#ffffff", pid, code: null }))
    );
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.t === "welcome") { client.teams = msg.teams ?? []; resolve(client); }
      else if (msg.t === "teams") client.teams = msg.teams ?? [];
      else if (msg.t === "team-you") client.you = msg.team;
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("no welcome within 4s")), 4000);
  });
}

const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const LOGO = { shape: "hex", symbol: "🦅", fg: "#ffffff", bg: "#007a3d" };

try {
  server = await startHub();

  // --- 1. Two drivers, one crew ---------------------------------------
  const alia = await connect("pid-alia", "Alia");
  const badr = await connect("pid-badr", "Badr");
  alia.create("Gulf Road Kings", "GRK", LOGO);
  await settle();
  const founded = alia.you;
  console.log(`founded    ${founded ? `"${founded.name}" [${founded.tag}] id=${founded.id}` : "NOTHING"}  ` +
    check(!!founded, "founding a crew produced no team-you"));
  badr.join(founded.id);
  await settle();
  console.log(`joined     ${badr.you?.members?.length ?? 0} members  ` +
    check(badr.you?.members?.length === 2, `Badr's crew has ${badr.you?.members?.length} members, expected 2`));

  // --- 2. It is on disk before anything is killed ----------------------
  await settle(400);
  const onDisk = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {};
  const savedCrew = (onDisk.teams ?? []).find((t) => t.tag === "GRK");
  console.log(`on disk    ${savedCrew ? `${savedCrew.members.join(", ")}` : "NOTHING"}  ` +
    check(!!savedCrew && savedCrew.members.length === 2,
      `the ledger holds ${savedCrew ? savedCrew.members.length : 0} members, expected 2`));
  // Ids are per-connection. Persisting one would be persisting a lie.
  console.log(`no ids     ${check(!JSON.stringify(onDisk.teams ?? []).includes('"id":1'),
    "a per-connection player id was written to the ledger")}`);

  // --- 3. Restart the hub ----------------------------------------------
  alia.close();
  badr.close();
  await stopHub(server);
  server = await startHub();
  await settle(400);

  const back = await connect("pid-carla", "Carla");
  const crew = back.teams.find((t) => t.tag === "GRK");
  console.log(`survived   ${crew ? `"${crew.name}" with ${crew.members.length} members` : "NOTHING"}  ` +
    check(!!crew && crew.members.length === 2,
      `after the restart the crew has ${crew ? crew.members.length : "no"} members, expected 2`));
  console.log(`offline    ${check(!!crew && crew.members.every((m) => !m.online),
    "the restarted hub reported members as online with no connection behind them")}`);

  // --- 4. A member republishing their crew is re-adopted, not ignored ---
  // This is the message the game actually sends: the crew is built in
  // the garage and re-sent on every connect.
  const badr2 = await connect("pid-badr", "Badr");
  badr2.you = undefined;
  badr2.create("Gulf Road Kings", "GRK", LOGO);
  await settle();
  console.log(`re-adopt   ${badr2.you ? `back in "${badr2.you.name}"` : "SILENCE"}  ` +
    check(!!badr2.you && badr2.you.tag === "GRK", "republishing an existing crew was ignored"));
  console.log(`one crew   ${check(badr2.teams.filter((t) => t.tag === "GRK").length === 1,
    `${badr2.teams.filter((t) => t.tag === "GRK").length} crews now carry the tag GRK`)}`);
  const meOnline = badr2.you?.members?.find((m) => m.name === "Badr");
  console.log(`online now ${check(!!meOnline?.online, "the re-adopted member is still listed offline")}`);

  // --- 5. And it is somebody else's crew if it is not yours ------------
  const thief = await connect("pid-thief", "Thief");
  thief.create("Gulf Road Kings", "GRK", LOGO);
  await settle();
  console.log(`no theft   ${thief.you ? `got "${thief.you.name}"` : "refused"}  ` +
    check(!thief.you, "a stranger claiming an existing crew's name was let in"));

  // --- 6. Leaving still leaves, and the ledger agrees -------------------
  badr2.leave();
  await settle(400);
  const after = JSON.parse(readFileSync(LEDGER, "utf8"));
  const left = (after.teams ?? []).find((t) => t.tag === "GRK");
  console.log(`left       ${left ? left.members.join(", ") : "crew folded"}  ` +
    check(!!left && !left.members.includes("Badr"),
      "leaving a crew did not reach the ledger"));

  badr2.close();
  thief.close();
  back.close();
} finally {
  await stopHub(server);
  rmSync(dir, { recursive: true, force: true });
}

if (fail.length) {
  console.log(`\n${fail.length} FAILED`);
  for (const f of fail) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\ncrews survive a restart");
