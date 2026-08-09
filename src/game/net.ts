import type { Team, TeamLogo } from "./teams";

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

export interface DuelInvite {
  from: number;
  name: string;
  tag: string | null;
  wager: number;
}

export interface HubEvents {
  onTeams?(teams: Team[]): void;
  onMyTeam?(team: Team | null): void;
  /** Someone wants to race you. */
  onDuelInvite?(invite: DuelInvite): void;
  /** Both sides agreed — the duel is live. */
  onDuelStart?(opponent: string, wager: number): void;
  /** Referee tick: SP for both sides and the signed gap. */
  onDuelSp?(you: number, them: number, gap: number): void;
  onDuelEnd?(won: boolean, reason: string, wager: number): void;
  onDuelDeclined?(): void;
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
          if (msg.teams) events.onTeams?.(msg.teams);
          events.onMyTeam?.(msg.team ?? null);
          break;
        case "teams":
          events.onTeams?.(msg.teams ?? []);
          break;
        case "team-you":
          events.onMyTeam?.(msg.team ?? null);
          break;
        case "duel-invite":
          events.onDuelInvite?.({
            from: msg.from,
            name: msg.name,
            tag: msg.tag ?? null,
            wager: msg.wager ?? 0,
          });
          break;
        case "duel-start":
          events.onDuelStart?.(msg.opponent, msg.wager ?? 0);
          break;
        case "duel-sp":
          events.onDuelSp?.(msg.you, msg.them, msg.gap);
          break;
        case "duel-end":
          events.onDuelEnd?.(!!msg.won, msg.reason ?? "", msg.wager ?? 0);
          break;
        case "duel-declined":
          events.onDuelDeclined?.();
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

  createTeam(name: string, tag: string, logo: TeamLogo): void {
    this.send({ t: "team-create", name, tag, logo });
  }

  joinTeam(id: string): void {
    this.send({ t: "team-join", id });
  }

  leaveTeam(): void {
    this.send({ t: "team-leave" });
  }

  // ---- player-vs-player duels

  challengePlayer(targetId: number, wager: number): void {
    this.send({ t: "duel-challenge", targetId, wager });
  }

  answerDuel(accept: boolean): void {
    this.send({ t: "duel-answer", accept });
  }

  quitDuel(): void {
    this.send({ t: "duel-quit" });
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
  country?: string;
  flag?: string;
  /** Crew identity, mirrored locally so solo play can show it too. */
  teamTag?: string;
  teamName?: string;
  teamLogo?: TeamLogo;
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.name === "string" && typeof p.color === "string") return p as Profile;
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
