/**
 * The job a visitor carries between the call-centre agents — شوق's call, her
 * written answer on /search, سالم's typed chat and his call — so the next one
 * picks it up where the last one left it (14 October: «improve to transfer
 * jobs and tasks between all call center agents»).
 *
 * Until then a move between them carried one string: «كمّل مع سالم» handed
 * over `?q=` and nothing else. The places she had put on screen, the one the
 * visitor had picked, and everything the agent had already been told were
 * gone, so the next agent asked again what the visitor had just finished
 * saying, and «الثاني» in his chat meant nothing. September's call-centre
 * notes said «there is nobody to transfer to»; there are two agents now, and a
 * transfer that makes the caller repeat themselves is the one call-centre
 * habit worth importing.
 *
 * So every agent writes the job it is holding — what was asked, the places it
 * showed, the one picked — and the next one reads it when it starts: his chat
 * keeps her pick as its own and asks the question again in the same order (the
 * handover effect in SalemChat), and an agent session is told the job in one
 * contextual update (`jobContext`, in agent-job-context.ts so /search does not
 * carry its text), which the agent reads as background and never answers
 * aloud. The job is kept in this tab's sessionStorage for half an hour, and an
 * agent session the visitor opens is told it.
 *
 * Words answered on the device are not told to an agent. A job written from a
 * typed or spoken question that never left the device is marked `local`, and
 * `jobToTell` gives no agent that job, so the sentence under سالم's box («اللي
 * تكتبه يبقى بجهازك») holds for a call opened later as well.
 *
 * Catalogue-free, like place-kit: the call component is in the root layout.
 */

/** Who held the job last. */
export type JobAgent = "shouq-call" | "shouq-answer" | "salem-chat" | "salem-call" | "call-center";

export interface AgentJob {
  v: 1;
  by: JobAgent;
  /** What the visitor asked — the latest question, narrowing included. */
  asked: string;
  /** The places put on screen for it, in order (at most 8). */
  shown: string[];
  /** The whole answer they came from (at most 40): what pickInJob tests a pick against. */
  ranked: string[];
  /** The one the visitor pointed at or opened, if any. */
  picked: string | null;
  /**
   * Written from words answered on this device and sent nowhere: the free
   * answer on his chat, the spoken question of a free call. The pages that show
   * the job still read it (jobFor); no agent is told it (jobToTell). Agents'
   * own tool writes and «كمّل مع سالم» on /search are not marked — the agent
   * was sent that question already, or the handover is explicit.
   */
  local?: true;
  /** When it was written, ms since the epoch. */
  at: number;
}

export const JOB_KEY = "wain:job:v1";
/** A job older than this is a different visit's, not this one's. */
export const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_SHOWN = 8;
const MAX_RANKED = 40;
const MAX_ASKED = 160;
const SLUG = /^[a-z0-9-]{1,80}$/;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function session(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Safari with storage blocked throws on the read of the property itself.
    return null;
  }
}

const slugs = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && SLUG.test(s)).slice(0, max) : [];

/** The job in this tab, or null when there is none, it is stale, or it does
 *  not parse — a hand-edited or older-shaped value is no job, never a crash.
 *  A stale or future-stamped job is removed here as well as ignored: the
 *  privacy page says the job is kept for half an hour, and a job nobody reads
 *  would otherwise stay in the tab for ever. */
export function readJob(store: Store | null = session(), now = Date.now()): AgentJob | null {
  try {
    const raw = store?.getItem(JOB_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<AgentJob>;
    if (j?.v !== 1 || typeof j.asked !== "string" || typeof j.at !== "number") return null;
    if (now - j.at > JOB_TTL_MS || j.at > now + 60_000) {
      store?.removeItem(JOB_KEY);
      return null;
    }
    const by = j.by;
    if (by !== "shouq-call" && by !== "shouq-answer" && by !== "salem-chat" && by !== "salem-call" && by !== "call-center") {
      return null;
    }
    const asked = j.asked.trim().slice(0, MAX_ASKED);
    const shown = slugs(j.shown, MAX_SHOWN);
    if (!asked && shown.length === 0) return null;
    return {
      v: 1,
      by,
      asked,
      shown,
      ranked: slugs(j.ranked, MAX_RANKED),
      picked: typeof j.picked === "string" && SLUG.test(j.picked) ? j.picked : null,
      ...(j.local === true ? { local: true as const } : {}),
      at: j.at,
    };
  } catch {
    return null;
  }
}

/**
 * Write what this agent is holding now. `ranked` defaults to what is shown.
 * The key holds one job, so a write replaces whatever was there.
 *
 * Also armed to sweep itself at the end of its half hour, so a tab that is left
 * open drops the job on time without anything reading it. Browser only: a test
 * passes its own store and sweeps with pruneJob.
 */
export function writeJob(
  by: JobAgent,
  job: { asked: string; shown: string[]; ranked?: string[]; picked?: string | null; local?: boolean; at?: number },
  store: Store | null = session(),
  now = Date.now()
): void {
  const value: AgentJob = {
    v: 1,
    by,
    asked: job.asked.trim().slice(0, MAX_ASKED),
    shown: slugs(job.shown, MAX_SHOWN),
    ranked: slugs(job.ranked ?? job.shown, MAX_RANKED),
    picked: job.picked && SLUG.test(job.picked) ? job.picked : null,
    ...(job.local ? { local: true as const } : {}),
    // A rewrite keeps the stamp it was asked at: the half hour runs from the
    // question, not from the last pick (round three, review).
    at: typeof job.at === "number" ? job.at : now,
  };
  try {
    store?.setItem(JOB_KEY, JSON.stringify(value));
  } catch {
    // Full or blocked: the next agent starts fresh, as it did before.
  }
  if (typeof window !== "undefined" && store) window.setTimeout(() => pruneJob(store), JOB_TTL_MS + 1000);
}

/** Drops the job if it is stale, and does nothing otherwise. Called on each
 *  page load and on coming back to the tab (WainAi), and by the timer that
 *  writeJob arms. */
export function pruneJob(store: Store | null = session(), now = Date.now()): void {
  readJob(store, now);
}

/** The place the visitor pointed at or opened, kept with the job it belongs
 *  to. It stays in the job where the job showed it, or where the agent that
 *  wrote the answer offered it — the question stays with it. Anything else
 *  starts a job of its own, named by the place: a place that is only in
 *  another agent's answer was never part of the question the job was asked
 *  under (14 October, the handover sweep, #3). `local` marks a job that starts
 *  from words answered on this device; a job that is rewritten keeps its own
 *  mark, whoever picks. */
export function pickInJob(
  by: JobAgent,
  slug: string,
  name: string,
  store: Store | null = session(),
  now = Date.now(),
  local = false
): void {
  const job = readJob(store, now);
  if (job && (job.shown.includes(slug) || (job.by === by && job.ranked.includes(slug)))) {
    writeJob(by, { ...job, picked: slug, at: job.at }, store, now);
  } else {
    writeJob(by, { asked: name, shown: [slug], picked: slug, local }, store, now);
  }
}

/** The job, if the agent starting now did not write it itself — an agent is
 *  never handed back its own last answer as news. For the pages that show the
 *  job on the device, a marked job is included. */
export function jobFor(agent: JobAgent, store: Store | null = session(), now = Date.now()): AgentJob | null {
  const job = readJob(store, now);
  return job && job.by !== agent ? job : null;
}

/** What an agent session is told when it opens: the job, unless the agent
 *  wrote it itself, or it was written from words answered on this device. */
export function jobToTell(agent: JobAgent, store: Store | null = session(), now = Date.now()): AgentJob | null {
  const job = jobFor(agent, store, now);
  return job && !job.local ? job : null;
}
