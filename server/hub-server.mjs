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
//   server → client: {t:"welcome",id,players,leaderboard,teams,team}
//                    {t:"joined",id,name,color} {t:"left",id}
//                    {t:"states",players:[[id,s,lat,speed],...]}
//                    {t:"chat",name,text}       {t:"leaderboard",entries}
//                    {t:"teams",teams}          {t:"team-you",team}

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
      players.delete(id);
      syncTeamPresence();
      broadcast({ t: "left", id });
      if (teamOf(p.name)) broadcastTeams();
      console.log(`[hub] ${p.name}#${id} left (${players.size} online)`);
    }
  });

  ws.on("error", () => {});
});

setInterval(() => {
  if (players.size === 0) return;
  const states = [];
  for (const [id, p] of players) {
    if (p.state) states.push([id, p.state.s, p.state.lat, p.state.speed]);
  }
  if (states.length) broadcast({ t: "states", players: states });
}, TICK_MS);

console.log(`[hub] Gulf Road Nights hub listening on ws://0.0.0.0:${PORT}`);
