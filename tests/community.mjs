// The referral rules, measured against a real hub server.
//
//   node tests/community.mjs
//
// No browser and no dev server: this starts the actual hub on a spare
// port with a throwaway ledger, connects real WebSocket clients to it,
// and asks it the questions a referral system has to get right.
//
// It is worth being precise about what is being tested, because a
// referral feature invites a claim it cannot support. The wallet in this
// game is a number in the player's own local storage; anybody who wants
// to give themselves a million KD can, and no invite code changes that.
// What the SERVER can enforce is everything that involves another
// person, and that is exactly what is checked here:
//
//   a code has to belong to somebody
//   it cannot be your own
//   a save redeems once, ever
//   both sides are paid, once each
//   and none of it is forgotten when the process restarts
//
// The last one is the reason the ledger is a file rather than a Map. A
// referral is a promise, and a promise a restart forgets is worse than
// one never made.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const PORT = 8799;
const dir = mkdtempSync(join(tmpdir(), "grn-ledger-"));
const LEDGER = join(dir, "referrals.json");

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

let server = null;
function startHub() {
  return new Promise((resolve, reject) => {
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
    p.on("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`hub exited ${code}: ${out}`));
    });
    setTimeout(() => resolve(p), 1500);
  });
}

function stopHub(p) {
  return new Promise((resolve) => {
    if (!p || p.exitCode !== null) return resolve();
    p.on("exit", resolve);
    p.kill("SIGTERM");
    setTimeout(resolve, 1200);
  });
}

/** A connected save: its id, its code, and whatever the server has told
 *  it. Deliberately dumb — it records what arrives rather than working
 *  anything out, so the assertions below are about the SERVER. */
function connect(pid, code, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const client = {
      ws,
      pid,
      code,
      state: null,
      results: [],
      close: () => ws.close(),
      claim: (c) => ws.send(JSON.stringify({ t: "ref-claim", code: c })),
      bank: (tokens) => ws.send(JSON.stringify({ t: "ref-banked", tokens })),
    };
    ws.on("open", () => ws.send(JSON.stringify({ t: "join", name, color: "#ffffff", pid, code })));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.t === "ref-state") {
        client.state = msg;
        resolve(client);
      } else if (msg.t === "ref-result") {
        client.results.push(msg);
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("no ref-state within 3s")), 3000);
  });
}

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

try {
  server = await startHub();

  // --- two saves, each with its own code ------------------------------
  const alia = await connect("pid-alia", "AAA234", "Alia");
  const badr = await connect("pid-badr", "BBB567", "Badr");
  console.log(
    `codes     ${check(
      alia.state.code === "AAA234" && badr.state.code === "BBB567",
      `the server registered ${alia.state.code} / ${badr.state.code}`
    )}  Alia AAA234, Badr BBB567, ${alia.state.invited}/${badr.state.invited} invited so far`
  );

  // --- your own code is not an invitation -----------------------------
  badr.claim("BBB567");
  await settle();
  const own = badr.results.at(-1);
  console.log(
    `self      ${check(own && !own.ok, `claiming your own code returned ${JSON.stringify(own)}`)}` +
      `  refused: "${own?.reason}"`
  );

  // --- a code nobody published is not a code --------------------------
  badr.claim("ZZZ999");
  await settle();
  const unknown = badr.results.at(-1);
  console.log(
    `unknown   ${check(unknown && !unknown.ok, `an unpublished code returned ${JSON.stringify(unknown)}`)}` +
      `  refused: "${unknown?.reason}"`
  );

  // --- a real invite pays both sides ----------------------------------
  badr.claim("AAA234");
  await settle(400);
  const good = badr.results.at(-1);
  console.log(
    `redeem    ${check(good && good.ok, `redeeming a friend's code returned ${JSON.stringify(good)}`)}` +
      `  "${good?.reason}"`
  );
  const badrOwed = badr.state.owed.reduce((n, o) => n + o.kd, 0);
  const aliaOwed = alia.state.owed.reduce((n, o) => n + o.kd, 0);
  console.log(
    `paid      ${check(
      badrOwed === 10 && aliaOwed === 10,
      `the joiner is owed ${badrOwed} KD and the host ${aliaOwed} KD; both should be 10`
    )}  joiner ${badrOwed} KD, host ${aliaOwed} KD`
  );
  // The host was told without asking — they were sitting in the lobby.
  console.log(
    `live      ${check(
      alia.state.invited === 1,
      `the host's tally says ${alia.state.invited} after a friend joined`
    )}  host sees ${alia.state.invited} friend joined, unprompted`
  );

  // --- once, ever ------------------------------------------------------
  badr.claim("AAA234");
  await settle();
  const twice = badr.results.at(-1);
  console.log(
    `again     ${check(twice && !twice.ok, `redeeming twice returned ${JSON.stringify(twice)}`)}` +
      `  refused: "${twice?.reason}"`
  );
  // Including via a different friend's code.
  const dana = await connect("pid-dana", "DDD345", "Dana");
  badr.claim("DDD345");
  await settle();
  const another = badr.results.at(-1);
  console.log(
    `second    ${check(
      another && !another.ok && dana.state.invited === 0,
      `a second invite from a different friend returned ${JSON.stringify(another)}`
    )}  refused: "${another?.reason}"`
  );

  // --- banking clears the debt, and only the debt ----------------------
  const tokens = badr.state.owed.map((o) => o.token);
  badr.bank(tokens);
  await settle();
  console.log(
    `banked    ${check(
      badr.state.owed.length === 0,
      `after banking, ${badr.state.owed.length} rewards are still owed`
    )}  ${tokens.length} reward banked, nothing left owed`
  );
  // A token that was never owed is ignored rather than believed.
  badr.bank(["invited:somebody-else"]);
  await settle();
  console.log(
    `forged    ${check(badr.state.owed.length === 0, "a forged token changed the ledger")}` +
      `  a made-up token changes nothing`
  );

  // --- and it survives a restart ---------------------------------------
  alia.close();
  badr.close();
  dana.close();
  await settle(300);
  await stopHub(server);
  server = null;
  const onDisk = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : null;
  console.log(
    `written   ${check(onDisk !== null, "the ledger was never written to disk")}  ` +
      `${onDisk ? Object.keys(onDisk.referrals).length : 0} saves on disk`
  );

  server = await startHub();
  const badrAgain = await connect("pid-badr", "BBB567", "Badr");
  const aliaAgain = await connect("pid-alia", "AAA234", "Alia");
  console.log(
    `restart   ${check(
      badrAgain.state.used === true && aliaAgain.state.invited === 1,
      `after a restart the joiner's used flag is ${badrAgain.state.used} ` +
        `and the host's tally is ${aliaAgain.state.invited}`
    )}  the invite is still spent and the host is still credited`
  );
  // And the reward that was already banked is not offered a second time.
  console.log(
    `no double ${check(
      badrAgain.state.owed.length === 0,
      `a banked reward came back after the restart: ${JSON.stringify(badrAgain.state.owed)}`
    )}  a banked reward stays banked`
  );
  // The host never banked theirs, so it must still be there waiting.
  console.log(
    `kept      ${check(
      aliaAgain.state.owed.reduce((n, o) => n + o.kd, 0) === 10,
      `the host's unbanked 10 KD came back as ${JSON.stringify(aliaAgain.state.owed)}`
    )}  the host's unclaimed 10 KD survived the restart`
  );
  badrAgain.close();
  aliaAgain.close();
  await settle(200);
} finally {
  await stopHub(server);
  rmSync(dir, { recursive: true, force: true });
}

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\ninvites are the server's business, and it keeps them.");
