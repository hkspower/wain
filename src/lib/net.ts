"use client";

/**
 * Everything the browser sends over the network, given a deadline.
 *
 * Until this file existed, no request in wain could ever fail from taking too
 * long. `fetch` has no timeout: a phone that walks out of Wi-Fi coverage
 * mid-request leaves the socket open and the promise pending, and the app
 * waits for it forever. Every spinner in the site — the admin list, «أرسل
 * الطلب», «طلباتي» — would sit there with no error and no way out, which is
 * the worst of both worlds: it has failed, and it will not say so.
 *
 * Three things happen here, and nothing else:
 *
 *   1. Every request gets a deadline, and uploads get a much longer one.
 *   2. A request made while the device is definitely offline fails at once,
 *      instead of burning the deadline discovering what the browser already
 *      knew.
 *   3. A failure is classified, so the sentence shown to a person can say
 *      which of the three things went wrong.
 *
 * ## Who retries what
 *
 * Exactly one layer retries any given request, and this is not it.
 *
 * postgrest-js already retries GET and HEAD by itself — three further attempts
 * on a transport failure or a 503/520, backing off 1s, 2s, 4s. Adding a retry
 * loop here would multiply with that instead of adding to it: three of theirs
 * inside three of ours inside a `retry()` at the call site is thirty-six
 * requests to read one list. So reads are left to them.
 *
 * What they will not retry is a POST, which is every RPC — including the
 * order-status read, which is a POST only because that is how PostgREST calls
 * a function. Those are retried at the call site with `retry()` below, by code
 * that can see whether repeating the request is actually safe. `order_status`
 * is a `stable` function, so asking twice changes nothing; the order insert
 * carries its own primary key, so a repeat collides with itself rather than
 * duplicating. Nothing else is retried anywhere.
 */

/** Ordinary queries. Long enough for a cold Postgrest round trip on a slow
 *  mobile connection, short enough that a dead socket is noticed. */
export const REQUEST_DEADLINE_MS = 15_000;

/** Uploads carry megabytes, so the same ceiling would kill a large photo on a
 *  slow connection halfway through — and that is a real photo of a real shop,
 *  sent once. It still needs *a* ceiling, or a stalled upload hangs forever. */
export const UPLOAD_DEADLINE_MS = 180_000;

export type NetErrorKind = "offline" | "timeout" | "network";

/**
 * Markers, not prose.
 *
 * A fetch rejection travels back through supabase-js, which keeps only the
 * message, so the message is where the classification has to live. It is never
 * shown to anyone — `describeNetError` turns it into Arabic at the edge.
 */
const MARK: Record<NetErrorKind, string> = {
  offline: "wain/offline",
  timeout: "wain/timeout",
  network: "wain/network",
};

export class NetError extends Error {
  readonly kind: NetErrorKind;
  constructor(kind: NetErrorKind) {
    super(MARK[kind]);
    this.name = "NetError";
    this.kind = kind;
  }
}

/** `false` means definitely offline. `true` means only "an interface is up",
 *  which is not the same as reachable — so it is never treated as proof. */
export function isDefinitelyOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** What kind of failure this was, whether it arrived as a thrown NetError or
 *  as a Supabase error object that carries only the message. */
export function classifyError(err: unknown): NetErrorKind | null {
  if (err instanceof NetError) return err.kind;
  const message =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message ?? "")
        : "";
  for (const [kind, mark] of Object.entries(MARK)) {
    if (message.includes(mark)) return kind as NetErrorKind;
  }
  // Whatever the browser calls a dead connection this week. Chrome says "Failed
  // to fetch", Safari "Load failed", Firefox "NetworkError when attempting…".
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(message)) {
    return "network";
  }
  return null;
}

/** One Arabic sentence per failure, saying what happened and what to do. */
export function describeNetError(err: unknown, fallback: string): string {
  switch (classifyError(err)) {
    case "offline":
      return "ما فيه اتصال بالإنترنت. تأكد من الشبكة وجرّب مرة ثانية.";
    case "timeout":
      return "الاتصال طوّل ولا رد. جرّب مرة ثانية.";
    case "network":
      return "الاتصال انقطع. تأكد من الشبكة وجرّب مرة ثانية.";
    default:
      return fallback;
  }
}

/** True while the two signals are usefully distinct — avoids AbortSignal.any,
 *  which Safari only learned in 17.4 and this site still runs on older. */
function linkAbort(controller: AbortController, outer: AbortSignal | null | undefined) {
  if (!outer) return () => {};
  if (outer.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = () => controller.abort();
  outer.addEventListener("abort", onAbort, { once: true });
  return () => outer.removeEventListener("abort", onAbort);
}

export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new NetError("network"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new NetError("network"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Resolves as soon as the device is back on the network, or when `ms` is up.
 *
 * Waiting for the `online` event beats sleeping blindly: someone whose train
 * comes out of a tunnel gets their request the moment the signal returns
 * rather than at the end of an arbitrary backoff.
 */
export function waitForOnline(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (typeof window === "undefined" || !isDefinitelyOffline()) return sleep(ms, signal);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      removeEventListener("online", done);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    addEventListener("online", done, { once: true });
    signal?.addEventListener("abort", done, { once: true });
  });
}

function isUpload(init?: RequestInit): boolean {
  const body = init?.body;
  if (!body) return false;
  return (
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    (typeof FormData !== "undefined" && body instanceof FormData) ||
    (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer)
  );
}

/** Exponential backoff with full jitter, so a hundred phones coming back onto
 *  the network together do not retry in lockstep. */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(4_000, 400 * 2 ** attempt);
  return Math.round(ceiling * (0.5 + Math.random() * 0.5));
}

/**
 * The `fetch` every Supabase request goes through.
 *
 * Installed once, in loadSupabase(), which is why it covers Postgrest, auth
 * token refreshes and storage alike rather than only the calls somebody
 * remembered to wrap. One request in, one request out — the retrying happens
 * above this, where the code knows what it is repeating.
 */
export async function deadlineFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  // Nothing can be sent, and the browser is certain of it. Say so now rather
  // than after fifteen seconds of silence.
  if (isDefinitelyOffline()) throw new NetError("offline");

  const limit = isUpload(init) ? UPLOAD_DEADLINE_MS : REQUEST_DEADLINE_MS;
  const controller = new AbortController();
  const unlink = linkAbort(controller, init?.signal);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limit);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    // An abort the caller asked for is not a failure — it means the component
    // went away and nobody is waiting for this any more. Rethrown as it came
    // so the layers above can tell the two apart by name.
    if (init?.signal?.aborted) throw err;
    throw new NetError(timedOut ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

export interface RetryOptions<T> {
  /** Total attempts, not extra ones. */
  attempts?: number;
  signal?: AbortSignal | null;
  /** Decides whether a *returned* value counts as a failure worth repeating —
   *  Supabase resolves with `{ error }` rather than throwing. */
  shouldRetry?: (result: T) => boolean;
}

/**
 * Repeat something that is safe to repeat.
 *
 * Used at the call sites that can prove it: reads, and the one write that
 * carries its own primary key. `shouldRetry` exists because supabase-js
 * resolves with `{ data, error }` instead of throwing, so a transport failure
 * arrives as an ordinary value and would otherwise sail straight through.
 */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions<T> = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  let last: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (opts.signal?.aborted) throw new NetError("network");
    try {
      const result = await fn();
      if (attempt < attempts - 1 && opts.shouldRetry?.(result)) {
        await waitForOnline(backoffMs(attempt), opts.signal);
        continue;
      }
      return result;
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      last = err;
      // A refusal is not a transport failure: sending it again gets the same
      // refusal, more slowly.
      if (classifyError(err) === null || attempt === attempts - 1) throw err;
      await waitForOnline(backoffMs(attempt), opts.signal);
    }
  }
  throw last;
}

/** Whether a Supabase `{ error }` is worth sending again: transport trouble,
 *  yes; a constraint the database refused, never. */
export function isRetryableSupabaseError(error: unknown): boolean {
  if (!error) return false;
  const code = (error as { code?: string }).code ?? "";
  // A PostgreSQL SQLSTATE means the request arrived and was understood.
  if (/^[0-9A-Z]{5}$/.test(code)) return false;
  return classifyError(error) !== null;
}
