import { WAIN_AI_AGENT_ENABLED } from "@/lib/wain-ai";

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
export const AGENT_OFF_FOR_MS = 15 * 60_000;
let refusedAt = 0;

export function markAgentUnavailable(now = Date.now()): void {
  refusedAt = now;
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    /* private mode — the copy above covers this page */
  }
}

export function agentAvailable(now = Date.now()): boolean {
  if (!WAIN_AI_AGENT_ENABLED) return false;
  let at = refusedAt;
  try {
    at = Math.max(at, Number(localStorage.getItem(KEY)) || 0);
  } catch {
    /* storage unreadable — the copy in memory still counts */
  }
  return !(at > 0 && now - at >= 0 && now - at < AGENT_OFF_FOR_MS);
}

/**
 * The words the server and the widget use for an account out of credits.
 * One test, shared, so the chat and the call cannot disagree about it.
 */
export function isQuotaRefusal(text: string): boolean {
  return /quota_exceeded|run out of credits|insufficient[_ ]credits/i.test(text);
}
