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
 * keeps her places as its own answer, and an agent session is told the job in
 * one contextual update (`jobContext`), which the agent reads as background
 * and never answers aloud. Nothing here leaves the device by itself: the job
 * sits in this tab's sessionStorage for half an hour, and only an agent
 * session the visitor has opened is told it.
 *
 * Catalogue-free, like place-kit: the call component is in the root layout,
 * and the names `jobContext` needs are passed in.
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
  /** The whole answer they came from, for «غيره» (at most 40). */
  ranked: string[];
  /** The one the visitor pointed at or opened, if any. */
  picked: string | null;
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

type Store = Pick<Storage, "getItem" | "setItem">;

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
 *  not parse — a hand-edited or older-shaped value is no job, never a crash. */
export function readJob(store: Store | null = session(), now = Date.now()): AgentJob | null {
  try {
    const raw = store?.getItem(JOB_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<AgentJob>;
    if (j?.v !== 1 || typeof j.asked !== "string" || typeof j.at !== "number") return null;
    if (now - j.at > JOB_TTL_MS || j.at > now + 60_000) return null;
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
      at: j.at,
    };
  } catch {
    return null;
  }
}

/** Write what this agent is holding now. `ranked` defaults to what is shown. */
export function writeJob(
  by: JobAgent,
  job: { asked: string; shown: string[]; ranked?: string[]; picked?: string | null },
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
    at: now,
  };
  try {
    store?.setItem(JOB_KEY, JSON.stringify(value));
  } catch {
    // Full or blocked: the next agent starts fresh, as it did before.
  }
}

/** The place the visitor pointed at or opened, kept with the job it belongs
 *  to. A place outside the job starts a job of its own: what was asked is the
 *  place itself. */
export function pickInJob(by: JobAgent, slug: string, name: string, store: Store | null = session(), now = Date.now()): void {
  const job = readJob(store, now);
  if (job && (job.shown.includes(slug) || job.ranked.includes(slug))) {
    writeJob(by, { ...job, picked: slug }, store, now);
  } else {
    writeJob(by, { asked: name, shown: [slug], picked: slug }, store, now);
  }
}

/** The job, if the agent starting now did not write it itself — an agent is
 *  never handed back its own last answer as news. */
export function jobFor(agent: JobAgent, store: Store | null = session(), now = Date.now()): AgentJob | null {
  const job = readJob(store, now);
  return job && job.by !== agent ? job : null;
}

/** Where the job was, as the next agent hears it. */
const WHERE: Record<JobAgent, string> = {
  "shouq-call": "مكالمته مع شوق",
  "shouq-answer": "جواب شوق المكتوب في صفحة البحث",
  "salem-chat": "محادثته المكتوبة مع سالم",
  "salem-call": "مكالمته مع سالم",
  "call-center": "مركز الاتصال",
};

/**
 * The job as one contextual update for the agent picking it up: background it
 * reads, not a message it answers. Arabic, because the agent's prompt is, and
 * short, because it rides in every turn after it. `nameOf` turns a slug into
 * the place's name; a slug it does not know is left out rather than read out.
 */
export function jobContext(job: AgentJob, nameOf: (slug: string) => string | undefined): string {
  const names = job.shown.map(nameOf).filter((n): n is string => !!n).slice(0, 3);
  const picked = job.picked ? nameOf(job.picked) : undefined;
  return [
    `سياق للتسليم: الزائر جاي من ${WHERE[job.by]}.`,
    job.asked ? `طلبه: «${job.asked}».` : "",
    names.length ? `الأماكن اللي طلعت له: ${names.join("، ")}.` : "",
    picked ? `واختار منها: ${picked}.` : "",
    "كمّل معه من هني، ولا تعيد عليه سؤال جاوبه.",
  ]
    .filter(Boolean)
    .join(" ");
}
