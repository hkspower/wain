// Gulf Road Nights — online hub server.
//
// A single shared room ("the Gulf Road cruise"): relays player positions
// at 10 Hz, chat, and keeps a session best-lap leaderboard. Positions,
// chat and the leaderboard are in-memory and a restart wipes them —
// they describe a moment. Referrals and crews are on disk, because they
// describe a promise. Run with: npm run hub  (default port 8787)
//
// Protocol (JSON over WebSocket):
//   client → server: {t:"join",name,color} {t:"state",s,lat,speed}
//                    {t:"chat",text}       {t:"lap",ms}
//                    {t:"team-create",name,tag,logo} {t:"team-join",id}
//                    {t:"team-leave"}
//                    {t:"duel-challenge",targetId,wager} {t:"duel-answer",accept}
//                    {t:"duel-quit"}
//   server → client: {t:"welcome",id,players,leaderboard,teams,team}
//                    {t:"joined",id,name,color} {t:"left",id}
//                    {t:"states",players:[[id,s,lat,speed],...]}
//                    {t:"chat",name,text}       {t:"leaderboard",entries}
//                    {t:"teams",teams}          {t:"team-you",team}
//                    {t:"team-taken",name,tag}
//                    {t:"duel-invite",from,name,tag,wager}
//                    {t:"duel-start",opponent} {t:"duel-sp",you,them,gap}
//                    {t:"duel-end",won,reason,wager} {t:"duel-declined"}
//
//   Referrals (see the ledger below):
//   client → server: {t:"join",...,pid,code}   {t:"ref-claim",code}
//                    {t:"ref-banked",tokens:[...]}
//   server → client: {t:"ref-state",code,invited,owed:[{token,kd,why}]}
//                    {t:"ref-result",ok,reason}

import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PORT = Number(process.env.HUB_PORT || 8787);
const TICK_MS = 100;
const MAX_NAME = 24;
const MAX_CHAT = 200;

// One HTTP server hosts both: REST for the Unreal client (and any other
// engine) and the WebSocket upgrade for the live cruise.
const http = await import("node:http");
const httpServer = http.createServer((req, res) => handleRest(req, res));
// maxPayload, because the default is 100 MB.
//
// The biggest message this protocol has is a crew badge and a 200
// character chat line — a few hundred bytes. Left at the default, one
// connection could ask the hub to buffer a hundred megabytes, and a
// handful of them could exhaust it without ever sending a valid message.
const MAX_FRAME_BYTES = 16 * 1024;
const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_FRAME_BYTES });
let nextId = 1;

/** id -> { ws, name, color, state: {s,lat,speed} | null, lastChatAt, pid } */
const players = new Map();
/** name -> best lap ms */
const bestLaps = new Map();

// ---------------------------------------------------------------- referrals
//
// The one part of this server that has to survive a restart.
//
// Everything else here is a session: who is online, what the fastest lap
// of the evening was, which duel is running. Losing that on a restart is
// fine, because none of it is a promise. A referral is a promise — "your
// friend joined, here is your ten dinars" — and a promise that a process
// restart forgets is worse than not making it.
//
// What the server is the authority on, and what it is not:
//
//   IT DECIDES  whether a code belongs to anybody, whether it is your
//               own, whether you have already claimed one, and whether a
//               reward has already been paid out. All four are the parts
//               that involve another person, and a client cannot mint
//               them for itself.
//
//   IT CANNOT   stop somebody editing their own save. The wallet is a
//               number in the player's browser. This ledger makes the
//               referral honest; it does not make the economy secure,
//               and it was never going to.
//
// The store is a small JSON file rather than a database because it holds
// one row per player and is written a handful of times an hour. Written
// atomically — temp file, then rename — so a crash mid-write leaves the
// previous ledger rather than half of the new one.

const LEDGER_PATH = process.env.HUB_LEDGER || "server/data/referrals.json";

/** code -> pid, first come first served. */
const codeOwner = new Map();
/**
 * pid -> {
 *   code,            the invite code this save published
 *   usedCode,        the code this save redeemed, if any — once only
 *   invited: [pid],  saves that redeemed this one's code
 *   owed: [{token, kd, why}],   earned, not yet banked by the client
 *   paid: [token],              banked
 * }
 */
const referrals = new Map();

function ledgerEntry(pid) {
  let e = referrals.get(pid);
  if (!e) {
    e = { code: null, usedCode: null, invited: [], owed: [], paid: [] };
    referrals.set(pid, e);
  }
  return e;
}

/**
 * The crews, and who is in them.
 *
 * teamId -> { id, name, tag, logo, founder, members: Map<name, id|null> }
 *
 * Declared up here rather than beside the rest of the team code because
 * it goes in the ledger, and the ledger is read before anything else
 * runs. A crew used to live only in this Map, which meant a restart
 * dropped every roster: your own crew came back — the client keeps it
 * beside the save and republishes on connect — but everyone else in it
 * did not, and each of them re-founding their crew on reconnect hit the
 * "one crew at a time" guard and got silence back.
 */
const teams = new Map();
let nextTeamId = 1;

function loadLedger() {
  try {
    const raw = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
    for (const [pid, e] of Object.entries(raw.referrals ?? {})) {
      referrals.set(pid, {
        code: e.code ?? null,
        usedCode: e.usedCode ?? null,
        invited: e.invited ?? [],
        owed: e.owed ?? [],
        paid: e.paid ?? [],
      });
      if (e.code) codeOwner.set(e.code, pid);
    }
    // Members come back offline, every one of them: a connection is the
    // only thing that makes somebody online, and the ledger is not a
    // connection. syncTeamPresence() lights them up as they arrive.
    for (const t of raw.teams ?? []) {
      if (!t?.id || !t.name || !t.tag) continue;
      teams.set(String(t.id), {
        id: String(t.id),
        name: String(t.name),
        tag: String(t.tag),
        logo: sanitizeLogo(t.logo),
        founder: String(t.founder ?? ""),
        founderPid: t.founderPid ? String(t.founderPid) : null,
        members: new Map((t.members ?? []).map((n) => [String(n), null])),
        pids: new Map(
          (Array.isArray(t.pids) ? t.pids : []).map(([n, q]) => [String(n), String(q)])
        ),
      });
    }
    // Past the highest id that was ever handed out, so a restart cannot
    // mint an id a persisted crew already owns.
    nextTeamId = Math.max(
      Number(raw.nextTeamId) || 1,
      ...[...teams.keys()].map((k) => (Number(String(k).replace(/^t/, "")) || 0) + 1)
    );
    console.log(
      `[hub] ledger: ${referrals.size} saves, ${codeOwner.size} codes, ` +
        `${teams.size} crew${teams.size === 1 ? "" : "s"}`
    );
  } catch (err) {
    if (err.code !== "ENOENT") console.warn(`[hub] could not read the ledger: ${err.message}`);
  }
}

let ledgerDirty = false;
function saveLedger() {
  if (!ledgerDirty) return;
  ledgerDirty = false;
  try {
    mkdirSync(dirname(LEDGER_PATH), { recursive: true });
    const out = {
      referrals: Object.fromEntries(referrals),
      // Names only. Player ids are per-connection and mean nothing after
      // a restart; writing them down would persist a lie about who is
      // online.
      teams: [...teams.values()].map((t) => ({
        id: t.id,
        name: t.name,
        tag: t.tag,
        logo: t.logo,
        founder: t.founder,
        founderPid: t.founderPid ?? null,
        members: [...t.members.keys()],
        pids: [...t.pids.entries()],
      })),
      nextTeamId,
    };
    const tmp = `${LEDGER_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(out));
    renameSync(tmp, LEDGER_PATH);
  } catch (err) {
    console.warn(`[hub] could not write the ledger: ${err.message}`);
    ledgerDirty = true;
  }
}

/** A crew changed. Persist it, not in a minute — a restart is not polite. */
function teamsChanged() {
  ledgerDirty = true;
  saveLedger();
}

/** The bonus, in KD. Kept in step with REFERRAL_KD in the web build. */
const REFERRAL_KD = 10;

/** Register the code a save publishes. First claim on a code wins; a
 *  collision is a one-in-a-billion event and the loser simply keeps a
 *  code nobody can look up, which is better than two saves answering to
 *  the same one. */
function registerCode(pid, code) {
  if (!pid || !code) return;
  const e = ledgerEntry(pid);
  const owner = codeOwner.get(code);
  if (owner && owner !== pid) return;
  if (e.code !== code) {
    if (e.code) codeOwner.delete(e.code);
    e.code = code;
    ledgerDirty = true;
  }
  codeOwner.set(code, pid);
}

function refState(pid) {
  const e = ledgerEntry(pid);
  return {
    t: "ref-state",
    code: e.code,
    invited: e.invited.length,
    used: !!e.usedCode,
    owed: e.owed,
  };
}

/**
 * Redeem somebody's code.
 *
 * Every refusal here is a rule about other people, which is why they
 * live on this side of the wire: your own code is not an invitation,
 * a code nobody published is not a code, and a save gets to be new
 * exactly once.
 */
function claimReferral(pid, rawCode) {
  const code = String(rawCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const e = ledgerEntry(pid);
  if (!code) return { ok: false, reason: "That is not a code." };
  if (e.usedCode) return { ok: false, reason: "You have already used an invite." };
  if (e.code === code) return { ok: false, reason: "That is your own code." };
  const owner = codeOwner.get(code);
  if (!owner) return { ok: false, reason: "Nobody is using that code." };
  if (owner === pid) return { ok: false, reason: "That is your own code." };

  const host = ledgerEntry(owner);
  // The token identifies the REWARD, not the person.
  //
  // It used to be `invited:${pid}` — the invitee's save id — and it is
  // sent to the host in ref-state. So inviting somebody handed you their
  // save id, and a save id is the only credential this hub has: with it
  // you could rejoin as them, bank away their unclaimed rewards, take
  // their crew seat, or claim an invite in their name. An opaque token
  // does the same job, because all the ledger ever asks of it is "have I
  // paid this one already".
  const stamp = randomUUID();
  e.usedCode = code;
  e.owed.push({ token: `joined:${stamp}`, kd: REFERRAL_KD, why: "Joined on an invite" });
  if (!host.invited.includes(pid)) host.invited.push(pid);
  host.owed.push({ token: `invited:${stamp}`, kd: REFERRAL_KD, why: "A friend joined on your code" });
  ledgerDirty = true;
  saveLedger();

  // If the friend who invited them is online, tell them now.
  for (const [, other] of players) {
    if (other.pid === owner) send(other.ws, refState(owner));
  }
  return { ok: true, reason: `Invite accepted — ${REFERRAL_KD} KD each.` };
}

/** The client banked these rewards into its own save; stop offering
 *  them. A token it was never owed is ignored rather than argued with. */
function bankReferrals(pid, tokens) {
  const e = ledgerEntry(pid);
  const wanted = new Set(Array.isArray(tokens) ? tokens.map(String) : []);
  const before = e.owed.length;
  e.owed = e.owed.filter((o) => {
    if (!wanted.has(o.token)) return true;
    if (!e.paid.includes(o.token)) e.paid.push(o.token);
    return false;
  });
  if (e.owed.length !== before) {
    ledgerDirty = true;
    saveLedger();
  }
}

loadLedger();
setInterval(saveLedger, 10_000).unref?.();

/**
 * Live player-vs-player duels. The server is the referee: it owns the SP
 * clock, reading the position stream both sides already send at 10 Hz,
 * so neither client can simply declare itself the winner.
 *   id -> { a, b, spA, spB, wager, startedAt }
 */
const duels = new Map();
let nextDuelId = 1;
/** playerId -> duelId, for O(1) lookup from either side */
const duelOf = new Map();
/** playerId -> { from, wager, at } — one pending invite per player */
const invites = new Map();

const DUEL_MAX_WAGER = 100000;
const INVITE_TTL_MS = 45000; // a challenged driver may be mid-corner

function endDuel(duelId, winnerId, reason) {
  const d = duels.get(duelId);
  if (!d) return;
  duels.delete(duelId);
  duelOf.delete(d.a);
  duelOf.delete(d.b);
  for (const pid of [d.a, d.b]) {
    const p = players.get(pid);
    if (!p) continue;
    send(p.ws, {
      t: "duel-end",
      won: winnerId === pid,
      reason,
      wager: d.wager,
    });
  }
  const w = players.get(winnerId);
  console.log(
    `[hub] duel #${duelId} won by ${w ? w.name : "?"} (${reason}), ${d.wager} KD`
  );
}

const MAX_TEAM_NAME = 28;
const MAX_TEAMS = 500;

function teamView(t) {
  return {
    id: t.id,
    name: t.name,
    tag: t.tag,
    logo: t.logo,
    founder: t.founder,
    members: [...t.members.entries()].map(([name, id]) => ({
      id: id ?? -1,
      name,
      online: id !== null,
    })),
  };
}

function teamList() {
  return [...teams.values()].map(teamView);
}

function teamOf(playerName) {
  for (const t of teams.values()) if (t.members.has(playerName)) return t;
  return null;
}

function broadcastTeams() {
  broadcast({ t: "teams", teams: teamList() });
}

/** Keep a team's online flags in step with who is connected. */
function syncTeamPresence() {
  const onlineByName = new Map();
  for (const [id, p] of players) onlineByName.set(p.name, id);
  for (const t of teams.values()) {
    for (const name of t.members.keys()) {
      t.members.set(name, onlineByName.get(name) ?? null);
    }
  }
}

function sanitizeLogo(raw) {
  const hex = (v, fallback) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? v : fallback);
  const shapes = ["shield", "circle", "hex", "diamond"];
  return {
    shape: shapes.includes(raw?.shape) ? raw.shape : "shield",
    symbol: String(raw?.symbol ?? "🦅").slice(0, 4),
    bg: hex(raw?.bg, "#0d1b2a"),
    fg: hex(raw?.fg, "#f5a524"),
  };
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId = null) {
  const data = JSON.stringify(msg);
  for (const [id, p] of players) {
    if (id !== exceptId && p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  }
}

/** name -> career blob, for engines without their own cloud save. */
/**
 * Career blobs, and the leaderboard, are keyed by a NAME the caller
 * chooses — which means any caller can create as many keys as it likes.
 *
 * Both are capped. Without a cap, `while(true) POST /api/v1/lap` with a
 * fresh name each time is a memory-exhaustion attack that needs no
 * cleverness at all and leaves nothing in a log to explain the crash.
 * The caps are far above what a real hub sees: 20 names are shown on the
 * leaderboard and a busy night is dozens of players.
 *
 * WHAT IS STILL TRUE AND IS NOT A BUG TO FIX HERE. Neither endpoint is
 * authenticated, because there are no accounts in this game and a
 * leaderboard keyed by a typed name cannot be. Anybody can claim a lap
 * under any name. That is the cost of the design and it is written down
 * rather than quietly forgotten: the fix is accounts, not a filter.
 */
const MAX_CAREERS = 5000;
const MAX_LAP_NAMES = 5000;
const careers = new Map();
const MAX_CAREER_BYTES = 4096;
const API_VERSION = 1;

function sendJson(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    // The Unreal client and the web build may live on different origins
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-GRN-Api-Version": String(API_VERSION),
  });
  res.end(payload);
}

function readBody(req, limit = MAX_CAREER_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * REST surface, versioned under /api/v1:
 *   GET  /api/v1/status              — health + live player count
 *   GET  /api/v1/leaderboard         — session best laps
 *   POST /api/v1/lap  {name,ms}      — submit a lap, get the new board
 *   GET  /api/v1/career/:name        — cloud career blob
 *   PUT  /api/v1/career/:name        — store one (4 KB cap)
 */
async function handleRest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "");

  if (req.method === "OPTIONS") return sendJson(res, 204, {});

  if (path === "/api/v1/status") {
    return sendJson(res, 200, {
      apiVersion: API_VERSION,
      game: "Gulf Road Nights",
      online: players.size,
      teams: teams.size,
      uptimeSec: Math.round(process.uptime()),
    });
  }

  if (path === "/api/v1/leaderboard") {
    return sendJson(res, 200, { apiVersion: API_VERSION, entries: leaderboard() });
  }

  if (path === "/api/v1/lap" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const name = String(body?.name ?? "").slice(0, MAX_NAME).trim();
      const ms = Number(body?.ms);
      if (!name || !Number.isFinite(ms) || ms < 20000 || ms > 3600000) {
        return sendJson(res, 400, { error: "name and a plausible lap ms required" });
      }
      const prev = bestLaps.get(name);
      if (prev === undefined && bestLaps.size >= MAX_LAP_NAMES) {
        return sendJson(res, 507, { error: "the leaderboard is full" });
      }
      const isBest = prev === undefined || ms < prev;
      if (isBest) {
        bestLaps.set(name, Math.round(ms));
        broadcast({ t: "leaderboard", entries: leaderboard() });
      }
      return sendJson(res, 200, { accepted: true, personalBest: isBest, entries: leaderboard() });
    } catch {
      return sendJson(res, 400, { error: "bad json" });
    }
  }

  const career = path.match(/^\/api\/v1\/career\/(.+)$/);
  if (career) {
    const name = decodeURIComponent(career[1]).slice(0, MAX_NAME).trim();
    if (!name) return sendJson(res, 400, { error: "name required" });
    if (req.method === "GET") {
      const blob = careers.get(name);
      return blob
        ? sendJson(res, 200, { apiVersion: API_VERSION, name, career: blob })
        : sendJson(res, 404, { error: "no career stored" });
    }
    if (req.method === "PUT") {
      try {
        const blob = JSON.parse(await readBody(req));
        if (!careers.has(name) && careers.size >= MAX_CAREERS) {
          return sendJson(res, 507, { error: "the hub is holding as many careers as it can" });
        }
        careers.set(name, blob);
        return sendJson(res, 200, { apiVersion: API_VERSION, name, stored: true });
      } catch {
        return sendJson(res, 400, { error: "bad json or payload too large" });
      }
    }
  }

  return sendJson(res, 404, { error: "unknown endpoint", see: "/api/v1/status" });
}

function leaderboard() {
  return [...bestLaps.entries()]
    .map(([name, ms]) => ({ name, ms }))
    .sort((a, b) => a.ms - b.ms)
    .slice(0, 20);
}

function roster() {
  return [...players.entries()].map(([id, p]) => ({ id, name: p.name, color: p.color }));
}

/** How many sockets the hub will hold at once. A cruise is a few dozen
 *  cars; this is far above that and far below what would run the process
 *  out of memory, and refusing at the door is cheaper than dying. */
const MAX_SOCKETS = 400;

wss.on("connection", (ws) => {
  if (wss.clients.size > MAX_SOCKETS) {
    send(ws, { t: "full", reason: "The cruise is full — try again in a minute." });
    ws.close();
    return;
  }
  const id = nextId++;
  let joined = false;

  // A message budget, refilled every second.
  //
  // The protocol's busiest client sends position at 10 Hz plus the
  // occasional chat line. Sixty a second is six times that and still
  // three orders of magnitude below what a loop can push down a socket.
  // Without it one connection can spin the hub's event loop flat out and
  // every other player's car stops moving.
  const BUDGET = 60;
  let budget = BUDGET;
  let budgetAt = Date.now();

  ws.on("message", (raw) => {
    const now = Date.now();
    if (now - budgetAt >= 1000) { budget = BUDGET; budgetAt = now; }
    if (budget-- <= 0) return;

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // Everything below runs on input from the network. A throw here is
    // an uncaught exception inside a socket handler, which ends the
    // process — so one malformed message from one player would end the
    // night for everybody. The handler is allowed to be wrong; it is not
    // allowed to be fatal.
    try {
      handle(msg);
    } catch (err) {
      console.warn(`[hub] dropped a message from #${id}: ${err.message}`);
    }
  });

  function handle(msg) {

    if (msg.t === "join" && !joined) {
      const name = String(msg.name ?? "racer").slice(0, MAX_NAME).trim() || "racer";
      const color = /^#[0-9a-fA-F]{6}$/.test(String(msg.color)) ? msg.color : "#f2f4f7";
      // The save's own id, so a returning player is the same player.
      // Absent for clients that predate this or have no storage; they
      // simply get no community features rather than an error.
      const pid = typeof msg.pid === "string" ? msg.pid.slice(0, 64) : "";
      const code = typeof msg.code === "string" ? msg.code.slice(0, 8).toUpperCase() : "";
      if (pid && code) registerCode(pid, code);
      players.set(id, { ws, name, color, state: null, lastChatAt: 0, pid });
      joined = true;
      syncTeamPresence();
      const mine = teamOf(name);
      send(ws, {
        t: "welcome",
        id,
        players: roster(),
        leaderboard: leaderboard(),
        teams: teamList(),
        team: mine ? teamView(mine) : null,
      });
      if (pid) send(ws, refState(pid));
      if (mine) broadcastTeams();
      broadcast({ t: "joined", id, name, color }, id);
      console.log(`[hub] ${name}#${id} joined (${players.size} online)`);
      return;
    }

    const p = players.get(id);
    if (!p) return;

    if (msg.t === "state") {
      const s = Number(msg.s);
      const lat = Number(msg.lat);
      const speed = Number(msg.speed);
      if (Number.isFinite(s) && Number.isFinite(lat) && Number.isFinite(speed)) {
        p.state = { s, lat: Math.max(-8, Math.min(8, lat)), speed: Math.max(0, Math.min(120, speed)) };
      }
    } else if (msg.t === "chat") {
      const now = Date.now();
      if (now - p.lastChatAt < 1000) return; // 1 msg/sec
      p.lastChatAt = now;
      const text = String(msg.text ?? "").slice(0, MAX_CHAT).trim();
      if (text) broadcast({ t: "chat", name: p.name, text });
    } else if (msg.t === "team-create") {
      const tname = String(msg.name ?? "").slice(0, MAX_TEAM_NAME).trim();
      // Must match sanitizeTag() in src/game/teams.ts. Arabic letters and
      // Arabic-Indic digits are tag characters here too — stripping them
      // left the tag empty, and the guard below then discarded the team
      // silently, so an Arabic crew name simply never created a crew.
      const tag = String(msg.tag ?? "")
        .toUpperCase()
        .replace(/[^A-Z0-9\u0621-\u064A\u0660-\u0669]/g, "")
        .slice(0, 4);
      if (!tname || !tag) return;

      // Re-adopt before founding.
      //
      // A crew is built in the garage and republished on every connect,
      // so "create" is what an existing member sends too — and the old
      // handler answered that with silence, because they were already in
      // a crew or a crew of that name already stood. The result was a
      // player looking at their own crew badge while the hub behaved as
      // though they had none.
      //
      // The crew you get back is yours if you are already in it, or if
      // it carries your name and tag and you founded it. Anything else
      // stays somebody else's crew.
      const mineAlready = teamOf(p.name);
      const sameName = [...teams.values()].find(
        (t) => t.name === tname && t.tag === tag
      );
      // Founding is proved by the SAVE ID, not by the name on it.
      //
      // A name is whatever somebody typed into a box, and this used to be
      // the whole of the check: join as "Bu Machboos" and the hub agreed
      // you were the founder of Bu Machboos's crew, handed you the roster,
      // and let you rewrite its name, tag and badge — on disk, for
      // everyone. Leaving then removed the real founder from their own
      // crew, and if they were its only member it deleted the crew
      // permanently.
      //
      // A save id is not typed. It cannot be guessed from anything the
      // hub publishes, so this is the one claim on the wire worth
      // believing. A crew founded before this ran has no founderPid; it
      // adopts the first id that presents the founder's name, and from
      // then on that is who it belongs to.
      const foundedByMe = (t) =>
        t.founderPid ? !!p.pid && t.founderPid === p.pid : t.founder === p.name;
      const adopt =
        mineAlready && (!sameName || sameName === mineAlready)
          ? mineAlready
          : sameName && !mineAlready && foundedByMe(sameName)
            ? sameName
            : null;
      if (adopt) {
        if (p.pid && !adopt.pids.has(p.name)) adopt.pids.set(p.name, p.pid);
        if (p.pid && adopt.pids.get(p.name) !== p.pid) return;
        adopt.members.set(p.name, id);
        // The founder may have restyled the badge in the garage since.
        if (foundedByMe(adopt)) {
          if (!adopt.founderPid && p.pid) adopt.founderPid = p.pid;
          adopt.name = tname;
          adopt.tag = tag;
          adopt.logo = sanitizeLogo(msg.logo);
        }
        console.log(`[hub] ${p.name} rejoined "${adopt.name}" [${adopt.tag}]`);
        send(ws, { t: "team-you", team: teamView(adopt) });
        teamsChanged();
        broadcastTeams();
        return;
      }
      if (mineAlready) return; // one crew at a time
      // Somebody else's crew, and now a permanent somebody else's: the
      // roster is on disk, so two crews sharing a name and tag would
      // share them forever. Say so rather than founding a twin — a
      // silent refusal and a successful creation looked identical from
      // the lobby.
      if (sameName) {
        send(ws, { t: "team-taken", name: tname, tag });
        return;
      }
      if (teams.size >= MAX_TEAMS) return;

      const team = {
        id: "t" + nextTeamId++,
        name: tname,
        tag,
        logo: sanitizeLogo(msg.logo),
        founder: p.name,
        founderPid: p.pid || null,
        members: new Map([[p.name, id]]),
        pids: p.pid ? new Map([[p.name, p.pid]]) : new Map(),
      };
      teams.set(team.id, team);
      console.log(`[hub] team "${tname}" [${tag}] founded by ${p.name}`);
      send(ws, { t: "team-you", team: teamView(team) });
      teamsChanged();
      broadcastTeams();
    } else if (msg.t === "team-join") {
      const team = teams.get(String(msg.id));
      if (!team || teamOf(p.name)) return;
      // A seat in a crew belongs to the save that took it. Recorded here
      // so that leaving can be checked — see team-leave.
      if (p.pid && !team.pids.has(p.name)) team.pids.set(p.name, p.pid);
      if (p.pid && team.pids.get(p.name) !== p.pid) return;
      team.members.set(p.name, id);
      send(ws, { t: "team-you", team: teamView(team) });
      teamsChanged();
      broadcastTeams();
    } else if (msg.t === "team-leave") {
      const team = teamOf(p.name);
      if (!team) return;
      // Only the save that holds the seat may give it up.
      //
      // Membership is keyed by name because that is what the roster
      // shows, and a name is typed. Without this, connecting as another
      // member's name and sending one message removed them from their
      // crew — and if they were its last member, the crew was deleted
      // from disk. A seat taken before this ran has no id recorded and
      // stays as it was: nothing is locked out retroactively.
      const seat = team.pids.get(p.name);
      if (seat && seat !== p.pid) return;
      team.members.delete(p.name);
      team.pids.delete(p.name);
      // A crew with nobody left folds
      if (team.members.size === 0) teams.delete(team.id);
      teamsChanged();
      send(ws, { t: "team-you", team: null });
      broadcastTeams();
    } else if (msg.t === "duel-challenge") {
      const targetId = Number(msg.targetId);
      const target = players.get(targetId);
      if (!target || targetId === id) return;
      if (duelOf.has(id) || duelOf.has(targetId)) return; // already racing
      const wager = Math.max(0, Math.min(DUEL_MAX_WAGER, Math.round(Number(msg.wager) || 0)));
      invites.set(targetId, { from: id, wager, at: Date.now() });
      const mine = teamOf(p.name);
      send(target.ws, {
        t: "duel-invite",
        from: id,
        name: p.name,
        tag: mine ? mine.tag : null,
        wager,
      });
    } else if (msg.t === "duel-answer") {
      const inv = invites.get(id);
      if (!inv) return;
      invites.delete(id);
      const challenger = players.get(inv.from);
      if (!challenger) return;
      if (!msg.accept) {
        send(challenger.ws, { t: "duel-declined" });
        return;
      }
      if (duelOf.has(id) || duelOf.has(inv.from)) return;
      const duelId = nextDuelId++;
      duels.set(duelId, {
        a: inv.from,
        b: id,
        spA: 100,
        spB: 100,
        wager: inv.wager,
        startedAt: Date.now(),
      });
      duelOf.set(inv.from, duelId);
      duelOf.set(id, duelId);
      send(challenger.ws, { t: "duel-start", opponent: p.name, wager: inv.wager });
      send(ws, { t: "duel-start", opponent: challenger.name, wager: inv.wager });
      console.log(`[hub] duel #${duelId}: ${challenger.name} vs ${p.name} for ${inv.wager} KD`);
    } else if (msg.t === "duel-quit") {
      const duelId = duelOf.get(id);
      if (duelId === undefined) return;
      const d = duels.get(duelId);
      // duelOf and duels are kept in step by endDuel, so this should
      // never be missing — and "should never" is exactly the condition
      // worth guarding when the cost of being wrong is a TypeError
      // inside a socket handler, which ends the process and takes every
      // other player offline with it.
      if (!d) { duelOf.delete(id); return; }
      endDuel(duelId, d.a === id ? d.b : d.a, "opponent quit");
    } else if (msg.t === "ref-claim") {
      if (!p.pid) {
        send(ws, { t: "ref-result", ok: false, reason: "This save has no id — storage is off." });
        return;
      }
      const r = claimReferral(p.pid, msg.code);
      send(ws, { t: "ref-result", ...r });
      send(ws, refState(p.pid));
    } else if (msg.t === "ref-banked") {
      if (p.pid) {
        bankReferrals(p.pid, msg.tokens);
        send(ws, refState(p.pid));
      }
    } else if (msg.t === "lap") {
      const ms = Number(msg.ms);
      // Sanity: a 7.3 km lap takes at least ~80 s flat out
      if (!Number.isFinite(ms) || ms < 75000 || ms > 3600000) return;
      const prev = bestLaps.get(p.name);
      if (prev === undefined && bestLaps.size >= MAX_LAP_NAMES) return;
      if (prev === undefined || ms < prev) {
        bestLaps.set(p.name, Math.round(ms));
        broadcast({ t: "leaderboard", entries: leaderboard() });
      }
    }
  }

  ws.on("close", () => {
    const p = players.get(id);
    if (p) {
      const duelId = duelOf.get(id);
      if (duelId !== undefined) {
        const d = duels.get(duelId);
        if (d) endDuel(duelId, d.a === id ? d.b : d.a, "opponent disconnected");
        else duelOf.delete(id);
      }
      invites.delete(id);
      players.delete(id);
      syncTeamPresence();
      broadcast({ t: "left", id });
      if (teamOf(p.name)) broadcastTeams();
      console.log(`[hub] ${p.name}#${id} left (${players.size} online)`);
    }
  });

  ws.on("error", () => {});
});

// Track length must match src/game/track.ts so the wrap-around maths
// agrees with what the clients are driving.
const TRACK_LENGTH = 7342;

/** Signed shortest distance from a to b around the loop. */
function deltaAhead(from, to) {
  let d = ((to - from) % TRACK_LENGTH + TRACK_LENGTH) % TRACK_LENGTH;
  if (d > TRACK_LENGTH / 2) d -= TRACK_LENGTH;
  return d;
}

setInterval(() => {
  if (players.size === 0) return;
  const states = [];
  for (const [id, p] of players) {
    if (p.state) states.push([id, p.state.s, p.state.lat, p.state.speed]);
  }
  if (states.length) broadcast({ t: "states", players: states });

  // --- duel referee: whoever trails bleeds SP, same rules as the
  // single-player battles, but judged here from both position streams
  const dt = TICK_MS / 1000;
  for (const [duelId, d] of duels) {
    const A = players.get(d.a);
    const B = players.get(d.b);
    if (!A || !B) continue;
    if (!A.state || !B.state) continue;

    // Positive gap => B is ahead of A
    const gap = deltaAhead(A.state.s, B.state.s);
    const lead = Math.abs(gap);
    const drain = lead < 4 ? 0 : 1.7 + Math.min(lead, 160) * 0.04 + (lead > 230 ? 16 : 0);

    if (gap > 4) d.spA = Math.max(0, d.spA - drain * dt);
    else if (gap < -4) d.spB = Math.max(0, d.spB - drain * dt);

    send(A.ws, { t: "duel-sp", you: d.spA, them: d.spB, gap });
    send(B.ws, { t: "duel-sp", you: d.spB, them: d.spA, gap: -gap });

    if (d.spA <= 0) endDuel(duelId, d.b, "SP drained");
    else if (d.spB <= 0) endDuel(duelId, d.a, "SP drained");
  }

  // Expire stale invitations
  const now = Date.now();
  for (const [pid, inv] of invites) {
    if (now - inv.at > INVITE_TTL_MS) invites.delete(pid);
  }
}, TICK_MS);

httpServer.listen(PORT, () => {
  console.log(`[hub] Gulf Road Nights hub listening on ws://0.0.0.0:${PORT}`);
  console.log(`[hub] REST API: http://localhost:${PORT}/api/v1/status`);
});
