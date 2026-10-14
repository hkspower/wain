import { SALEM_AGENT_ENABLED, WAIN_AI_ANY_AGENT_ENABLED } from "@/lib/wain-ai";

/**
 * Is the voice agent worth trying right now?
 *
 * The agent build depends on an account that can run dry, and on 7 October it
 * did: every call and every typed سالم chat on the live site was refused with
 * «[quota_exceeded] You've run out of credits», so both said «مو متاح» and
 * stopped, while the free path — our own search, which needs no account — sat
 * in the same bundle unused. A refusal for credits does not change for a
 * while, so it is remembered here and both fall back to that path.
 *
 * Per device, in localStorage, for AGENT_OFF_FOR_MS: a visitor who met the
 * refusal is answered locally for the rest of that quarter hour instead of
 * being refused on every page, and after it the agent is tried again. Nothing
 * about the visitor is stored — one timestamp.
 *
 * Also kept in memory for this page, because storage can refuse the write
 * (private mode, a full origin). Without that copy the call's «اتصل مرة ثانية»
 * after a refusal rang the agent again, every time.
 */
const KEY = "wain:agent-off";
const LINE_KEY = "wain:salem-off";
export const AGENT_OFF_FOR_MS = 15 * 60_000;
let refusedAt = 0;
let lineRefusedAt = 0;

/*
 * Two memories, because there are two agents (14 October). A refusal for
 * credits is the account, so it is KEY and turns both agents off here. A line
 * that never opened — refused at the door, no answer in time — is سالم's typed
 * chat alone: LINE_KEY. With one memory for both, a dropped line for سالم took
 * شوق's calls down for the quarter hour as well.
 */
export function markAgentUnavailable(now = Date.now()): void {
  refusedAt = now;
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    /* private mode — the copy above covers this page */
  }
}

export function markSalemLineUnavailable(now = Date.now()): void {
  lineRefusedAt = now;
  try {
    localStorage.setItem(LINE_KEY, String(now));
  } catch {
    /* private mode — the copy above covers this page */
  }
}

function recent(memory: number, now: number): boolean {
  return memory > 0 && now - memory >= 0 && now - memory < AGENT_OFF_FOR_MS;
}

/** Calls, and the account in general: the account is not out of credits. */
export function agentAvailable(now = Date.now()): boolean {
  if (!WAIN_AI_ANY_AGENT_ENABLED) return false;
  let at = refusedAt;
  try {
    at = Math.max(at, Number(localStorage.getItem(KEY)) || 0);
  } catch {
    /* storage unreadable — the copy in memory still counts */
  }
  return !recent(at, now);
}

/** سالم's typed chat: the account is fine AND his own line did not just fail. */
export function salemLineAvailable(now = Date.now()): boolean {
  if (!SALEM_AGENT_ENABLED || !agentAvailable(now)) return false;
  let at = lineRefusedAt;
  try {
    at = Math.max(at, Number(localStorage.getItem(LINE_KEY)) || 0);
  } catch {
    /* storage unreadable — the copy in memory still counts */
  }
  return !recent(at, now);
}

/**
 * The words the server and the widget use for an account out of credits.
 * One test, shared, so the chat and the call cannot disagree about it.
 */
export function isQuotaRefusal(text: string): boolean {
  return /quota_exceeded|run out of credits|insufficient[_ ]credits/i.test(text);
}
