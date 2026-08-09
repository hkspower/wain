// Gulf Road Nights — online hub server.
//
// A single shared room ("the Gulf Road cruise"): relays player positions
// at 10 Hz, chat, and keeps a session best-lap leaderboard. In-memory
// only — restart wipes it. Run with: npm run hub  (default port 8787)
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
//                    {t:"duel-invite",from,name,tag,wager}
//                    {t:"duel-start",opponent} {t:"duel-sp",you,them,gap}
//                    {t:"duel-end",won,reason,wager} {t:"duel-declined"}

import { WebSocketServer } from "ws";

const PORT = Number(process.env.HUB_PORT || 8787);
const TICK_MS = 100;
const MAX_NAME = 24;
const MAX_CHAT = 200;

const wss = new WebSocketServer({ port: PORT });
let nextId = 1;

/** id -> { ws, name, color, state: {s,lat,speed} | null, lastChatAt } */
const players = new Map();
/** name -> best lap ms */
const bestLaps = new Map();
/** teamId -> { id, name, tag, logo, founder, members: Map<name, id|null> } */
const teams = new Map();
let nextTeamId = 1;

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

const DUEL_MAX_WAGER = 25000;
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
const MAX_TEAMS = 200;

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

function leaderboard() {
  return [...bestLaps.entries()]
    .map(([name, ms]) => ({ name, ms }))
    .sort((a, b) => a.ms - b.ms)
    .slice(0, 10);
}

function roster() {
  return [...players.entries()].map(([id, p]) => ({ id, name: p.name, color: p.color }));
}

wss.on("connection", (ws) => {
  const id = nextId++;
  let joined = false;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.t === "join" && !joined) {
      const name = String(msg.name ?? "racer").slice(0, MAX_NAME).trim() || "racer";
      const color = /^#[0-9a-fA-F]{6}$/.test(String(msg.color)) ? msg.color : "#f2f4f7";
      players.set(id, { ws, name, color, state: null, lastChatAt: 0 });
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
      if (teams.size >= MAX_TEAMS) return;
      if (teamOf(p.name)) return; // one crew at a time
      const tname = String(msg.name ?? "").slice(0, MAX_TEAM_NAME).trim();
      const tag = String(msg.tag ?? "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 4);
      if (!tname || !tag) return;
      const team = {
        id: "t" + nextTeamId++,
        name: tname,
        tag,
        logo: sanitizeLogo(msg.logo),
        founder: p.name,
        members: new Map([[p.name, id]]),
      };
      teams.set(team.id, team);
      console.log(`[hub] team "${tname}" [${tag}] founded by ${p.name}`);
      send(ws, { t: "team-you", team: teamView(team) });
      broadcastTeams();
    } else if (msg.t === "team-join") {
      const team = teams.get(String(msg.id));
      if (!team || teamOf(p.name)) return;
      team.members.set(p.name, id);
      send(ws, { t: "team-you", team: teamView(team) });
      broadcastTeams();
    } else if (msg.t === "team-leave") {
      const team = teamOf(p.name);
      if (!team) return;
      team.members.delete(p.name);
      // A crew with nobody left folds
      if (team.members.size === 0) teams.delete(team.id);
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
      endDuel(duelId, d.a === id ? d.b : d.a, "opponent quit");
    } else if (msg.t === "lap") {
      const ms = Number(msg.ms);
      // Sanity: a 7.3 km lap takes at least ~80 s flat out
      if (!Number.isFinite(ms) || ms < 75000 || ms > 3600000) return;
      const prev = bestLaps.get(p.name);
      if (prev === undefined || ms < prev) {
        bestLaps.set(p.name, Math.round(ms));
        broadcast({ t: "leaderboard", entries: leaderboard() });
      }
    }
  });

  ws.on("close", () => {
    const p = players.get(id);
    if (p) {
      const duelId = duelOf.get(id);
      if (duelId !== undefined) {
        const d = duels.get(duelId);
        endDuel(duelId, d.a === id ? d.b : d.a, "opponent disconnected");
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

console.log(`[hub] Gulf Road Nights hub listening on ws://0.0.0.0:${PORT}`);
