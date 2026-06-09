// WebSocket client for the online hub (server/hub-server.mjs).
// Used by the /hub lobby page and by the race in online mode.

export interface HubPlayer {
  id: number;
  name: string;
  color: string;
}

export interface LapEntry {
  name: string;
  ms: number;
}

export interface HubEvents {
  onWelcome?(selfId: number, players: HubPlayer[], leaderboard: LapEntry[]): void;
  onJoined?(p: HubPlayer): void;
  onLeft?(id: number): void;
  onStates?(states: Array<[number, number, number, number]>): void; // [id, s, lat, speed]
  onChat?(name: string, text: string): void;
  onLeaderboard?(entries: LapEntry[]): void;
  onClose?(): void;
  onError?(): void;
}

export const DEFAULT_HUB_URL =
  process.env.NEXT_PUBLIC_HUB_WS || "ws://localhost:8787";

export class HubClient {
  private ws: WebSocket;
  selfId = -1;

  constructor(events: HubEvents, name: string, color: string, url = DEFAULT_HUB_URL) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.send({ t: "join", name, color });
    this.ws.onclose = () => events.onClose?.();
    this.ws.onerror = () => events.onError?.();
    this.ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data as string);
      } catch {
        return;
      }
      switch (msg.t) {
        case "welcome":
          this.selfId = msg.id;
          events.onWelcome?.(msg.id, msg.players, msg.leaderboard);
          break;
        case "joined":
          events.onJoined?.({ id: msg.id, name: msg.name, color: msg.color });
          break;
        case "left":
          events.onLeft?.(msg.id);
          break;
        case "states":
          events.onStates?.(msg.players);
          break;
        case "chat":
          events.onChat?.(msg.name, msg.text);
          break;
        case "leaderboard":
          events.onLeaderboard?.(msg.entries);
          break;
      }
    };
  }

  get connected(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  private send(msg: object): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendState(s: number, lat: number, speed: number): void {
    this.send({ t: "state", s, lat, speed });
  }

  sendChat(text: string): void {
    this.send({ t: "chat", text });
  }

  sendLap(ms: number): void {
    this.send({ t: "lap", ms });
  }

  close(): void {
    this.ws.onclose = null;
    this.ws.close();
  }
}

/** Profile (name + car colour) shared by the hub page and online races. */
const PROFILE_KEY = "gulf-road-nights-profile";

export interface Profile {
  name: string;
  color: string;
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.name === "string" && typeof p.color === "string") return p;
    }
  } catch {}
  return { name: "", color: "#f2f4f7" };
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {}
}

export function formatLap(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
