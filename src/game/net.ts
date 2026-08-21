import type { Team, TeamLogo } from "./teams";
import { playerId, inviteCode } from "./community";

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

/** A reward the server says this save has earned and not yet banked. */
export interface ReferralReward {
  token: string;
  kd: number;
  why: string;
}

/** The server's account of this save's invites. The client never works
 *  any of this out for itself — it asks. */
export interface ReferralState {
  /** The code this save publishes, as the server has it registered. */
  code: string | null;
  /** How many people have joined on it. */
  invited: number;
  /** Whether this save has already redeemed somebody's code. */
  used: boolean;
  owed: ReferralReward[];
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
  /** The server's view of this save's referrals, sent on join and again
   *  whenever it changes — including when a friend redeems your code
   *  while you are sitting in the lobby. */
  onReferralState?(state: ReferralState): void;
  /** The answer to a code this player just entered. */
  onReferralResult?(ok: boolean, reason: string): void;
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
    // The save's id and its invite code go up with the join, so the
    // server can recognise a returning player and answer questions about
    // a code that belongs to them. Both are empty when storage is off,
    // and the server treats that as "no community features".
    this.ws.onopen = () =>
      this.send({ t: "join", name, color, pid: playerId(), code: inviteCode() });
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
        case "ref-state":
          events.onReferralState?.({
            code: msg.code ?? null,
            invited: msg.invited ?? 0,
            used: !!msg.used,
            owed: Array.isArray(msg.owed) ? msg.owed : [],
          });
          break;
        case "ref-result":
          events.onReferralResult?.(!!msg.ok, msg.reason ?? "");
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

  /** Redeem a friend's invite code. The server answers with
   *  onReferralResult and then a fresh onReferralState. */
  claimInvite(code: string): void {
    this.send({ t: "ref-claim", code });
  }

  /** Tell the server these rewards have been paid into the save, so it
   *  stops offering them. Sent AFTER the KD has landed: a bonus the
   *  server has forgotten and the client never banked is money nobody
   *  can get back. */
  bankRewards(tokens: string[]): void {
    if (tokens.length) this.send({ t: "ref-banked", tokens });
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
  // A crew used to be mirrored here as three loose fields, written on
  // every hub update and read by nowhere — the comment said it was so
  // "the race scene can decal the car", which it never did. The crew has
  // one home now, teams.ts, which the car and the garage both read.
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
