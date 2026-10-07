/**
 * A shortlist's vote, counted on wain's own back end (`vote_cast` /
 * `votes_get` in scripts/publish/wain-api.php).
 *
 * Before 7 October a vote was only a WhatsApp reply, so nobody could see
 * where the group stood without reading the whole chat. The reply still
 * goes — it is how the chat hears — and the count is the part anyone with
 * the link can now read.
 *
 * Nothing names a voter: the device keeps a random id so a second tap moves
 * its vote rather than adding one, and what the server gives back is the
 * tally alone. Storage can be refused (private mode, blocked site data); the
 * id then lives for the visit, and a vote from the next visit counts again —
 * the cost of not asking anyone who they are.
 */
import { callSafe } from "@/lib/backend";

const VOTER_KEY = "wain:voter";
const MINE_KEY = "wain:my-votes";

export type Tally = { tally: Record<string, number>; total: number };

let memoryVoter: string | null = null;

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function voterId(): string {
  try {
    const kept = localStorage.getItem(VOTER_KEY);
    if (kept && /^[a-f0-9]{32}$/.test(kept)) return kept;
    const fresh = randomToken();
    localStorage.setItem(VOTER_KEY, fresh);
    return fresh;
  } catch {
    return (memoryVoter ??= randomToken());
  }
}

/** The place this device voted for in this poll, if it remembers one. */
export function myVote(poll: string): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(MINE_KEY) ?? "{}") as Record<string, string>;
    return typeof all[poll] === "string" ? all[poll] : null;
  } catch {
    return null;
  }
}

function rememberVote(poll: string, slug: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(MINE_KEY) ?? "{}") as Record<string, string>;
    all[poll] = slug;
    // Thirty polls is months of hangouts; older ones are no use to anyone.
    const keep = Object.keys(all).slice(-30);
    localStorage.setItem(MINE_KEY, JSON.stringify(Object.fromEntries(keep.map((k) => [k, all[k]]))));
  } catch {
    /* storage refused — the vote is still counted, only not remembered */
  }
}

const asTally = (r: { tally?: unknown; total?: unknown }): Tally | null =>
  r.tally && typeof r.tally === "object" && typeof r.total === "number"
    ? { tally: r.tally as Record<string, number>, total: r.total }
    : null;

/** Cast (or move) this device's vote. Null when the server could not count it. */
export async function castVote(poll: string, slug: string, options: string[]): Promise<Tally | null> {
  const r = await callSafe<{ tally: Record<string, number>; total: number }>("vote_cast", {
    poll,
    voter: voterId(),
    place_slug: slug,
    options,
  });
  if (!r.ok) return null;
  rememberVote(poll, slug);
  return asTally(r);
}

/** Where the group stands. Null on any failure — the page then shows no count. */
export async function readVotes(poll: string, options: string[]): Promise<Tally | null> {
  const r = await callSafe<{ tally: Record<string, number>; total: number }>("votes_get", { poll, options });
  return r.ok ? asTally(r) : null;
}

/** The slug with the most votes, when exactly one has the most. */
export function leader(t: Tally | null): string | null {
  if (!t || t.total === 0) return null;
  const sorted = Object.entries(t.tally).sort((a, b) => b[1] - a[1]);
  return sorted.length > 1 && sorted[0][1] === sorted[1][1] ? null : sorted[0][0];
}
