// Gulf Road Nights — online hub server.
//
// A single shared room ("the Gulf Road cruise"): relays player positions
// at 10 Hz, chat, and keeps a session best-lap leaderboard. In-memory
// only — restart wipes it. Run with: npm run hub  (default port 8787)
//
// Protocol (JSON over WebSocket):
//   client → server: {t:"join",name,color} {t:"state",s,lat,speed}
//                    {t:"chat",text}       {t:"lap",ms}
//   server → client: {t:"welcome",id,players,leaderboard}
//                    {t:"joined",id,name,color} {t:"left",id}
//                    {t:"states",players:[[id,s,lat,speed],...]}
//                    {t:"chat",name,text}       {t:"leaderboard",entries}

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
      send(ws, { t: "welcome", id, players: roster(), leaderboard: leaderboard() });
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
      broadcast({ t: "left", id });
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
