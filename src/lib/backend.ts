"use client";

import { classifyError, deadlineFetch, describeNetError } from "@/lib/net";

/**
 * The site's own back end: `/api/wain.php` on wain's own origin.
 *
 * Every dynamic feature — ordering, the queue, business registration, live
 * place edits and the admin board — talks to one PHP file through this module
 * (`scripts/publish/wain-api.php`, whose header says what it is and why). It
 * replaced Supabase on 4 October, which was never configured on any build:
 * four finished features sat inert behind a pair of variables nobody could
 * fill without a third-party account.
 *
 * ## The switch
 *
 * `NEXT_PUBLIC_WAIN_BACKEND` is read at BUILD time — this is a static export,
 * so the value is baked into the bundle and nothing can supply it later.
 *
 *   unset / empty → `/api/wain.php`, same origin, the default. No CORS, no
 *                   allowlist to keep in step with a new subdomain, the same
 *                   string on staging and in production.
 *   `none`        → off. Every feature behind it is inert and says so, the
 *                   way the site shipped before the back end existed. The
 *                   WhatsApp order channel takes over where a place has a
 *                   number (see `orderChannel` in orders.ts).
 *   a URL         → an absolute endpoint, for a bundle with no origin (the
 *                   apps), the same case `NEXT_PUBLIC_WAIN_TTS_URL` was for.
 *
 * `||` rather than `??`, for the reason written up in wain-ai.ts: CI expands an
 * unset variable to the empty string, and `??` would ship that as the URL.
 *
 * ## The shape of an answer
 *
 * The server answers JSON with `ok`. `call()` returns that object as it came
 * when `ok` is true, and a flat failure — `{ ok: false, error, status, field? }`
 * — when it is not. A transport failure (offline, timeout, the socket dropped)
 * THROWS a `NetError`, because that is what `retry()` in net.ts knows how to
 * repeat; a refusal the server made is returned, because sending it again gets
 * the same refusal more slowly. Callers that can prove a repeat is safe wrap
 * `call()` in `retry()` themselves.
 *
 * ## The admin
 *
 * One shared secret, `storage/admin.secret` on the server, sent as
 * `X-Wain-Admin`. It lives in sessionStorage here — gone when the tab closes,
 * never in a cookie (so no CSRF surface), never in the URL. Until the owner
 * fills the file in, every admin action answers 503 `admin_unset` and the
 * board says so instead of pretending a password would work.
 */

const RAW = process.env.NEXT_PUBLIC_WAIN_BACKEND || "/api/wain.php";

/** The endpoint, or "" when the back end is switched off for this build. */
export const BACKEND_URL: string = RAW === "none" ? "" : RAW;

export const backendEnabled = BACKEND_URL !== "";

/** "" for a same-origin endpoint, the origin for an absolute one — what a
 *  relative URL the server hands back (a signed media URL, a published image)
 *  has to be prefixed with to resolve from a bundle with no origin. */
export function backendOrigin(): string {
  if (!/^https?:\/\//i.test(BACKEND_URL)) return "";
  try {
    return new URL(BACKEND_URL).origin;
  } catch {
    return "";
  }
}

export interface ApiFailure {
  ok: false;
  /** The server's own word (`invalid`, `duplicate`, `closed`, `rate_limited`,
   *  `admin_unset`…), or one of three this module adds: `disabled` (the build
   *  has no back end), `not_installed` (the host answered with its 404 page —
   *  the file is not there), `bad_reply` (something that was not JSON). */
  error: string;
  status: number;
  field?: string;
  message?: string;
}

export type ApiResult<T extends object> = ({ ok: true } & T) | ApiFailure;

export interface CallOptions {
  /** Send the admin token. Without one stored the call is not made at all. */
  admin?: boolean;
  signal?: AbortSignal | null;
}

const ADMIN_KEY = "wain:admin";

export function adminToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(ADMIN_KEY, token);
    else sessionStorage.removeItem(ADMIN_KEY);
  } catch {
    /* private mode: the session simply does not survive a reload */
  }
}

/**
 * One action, one request. GET when there is no body (the public reads), POST
 * with a JSON body otherwise. Throws a NetError on a transport failure; returns
 * the server's refusal as a value.
 */
export async function call<T extends object = Record<string, unknown>>(
  action: string,
  body?: Record<string, unknown>,
  opts: CallOptions = {}
): Promise<ApiResult<T>> {
  if (!backendEnabled) return { ok: false, error: "disabled", status: 0 };

  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.admin) {
    const token = adminToken();
    if (!token) return { ok: false, error: "admin_required", status: 0 };
    headers["X-Wain-Admin"] = token;
  }

  const url = `${BACKEND_URL}${BACKEND_URL.includes("?") ? "&" : "?"}a=${encodeURIComponent(action)}`;
  const init: RequestInit =
    body === undefined
      ? { method: "GET", headers }
      : { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) };
  if (opts.signal) init.signal = opts.signal;

  const res = await deadlineFetch(url, init);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (json && typeof json === "object" && "ok" in json) {
    const j = json as Record<string, unknown>;
    if (j.ok === true) return j as ApiResult<T>;
    return {
      ok: false,
      error: typeof j.error === "string" ? j.error : "error",
      status: res.status,
      field: typeof j.field === "string" ? j.field : undefined,
      message: typeof j.message === "string" ? j.message : undefined,
    };
  }
  // Not the API's JSON: the host's own 404 page (the file is not installed),
  // a 405 from a server that does not run PHP here, or a proxy's error page.
  return {
    ok: false,
    error: res.status === 404 || res.status === 405 ? "not_installed" : "bad_reply",
    status: res.status,
  };
}

/**
 * `call()` for a caller that cannot catch — the admin panels run their
 * requests through `useLatestRequest`, which drops anything thrown so an
 * abandoned request has nobody to report to. A transport failure comes back
 * as a failure VALUE here, named by kind (`offline`, `timeout`, `network`) and
 * already carrying its Arabic sentence.
 */
export async function callSafe<T extends object = Record<string, unknown>>(
  action: string,
  body?: Record<string, unknown>,
  opts: CallOptions = {}
): Promise<ApiResult<T>> {
  try {
    return await call<T>(action, body, opts);
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    return {
      ok: false,
      error: classifyError(err) ?? "network",
      status: 0,
      message: describeNetError(err, "ما وصلنا للسيرفر. تأكد من الاتصال وجرّب مرة ثانية."),
    };
  }
}

/**
 * Whether a refusal is worth sending again. Only the server saying it could
 * not reach its own database, or a gateway in front of it failing — never a
 * rule it applied, which is the same refusal the second time, more slowly.
 */
export function isRetryableApiFailure(r: ApiResult<object>): boolean {
  if (r.ok) return false;
  return r.error === "db_unavailable" || r.status === 502 || r.status === 503 || r.status === 504;
}

/** The failures every caller meets the same way, in Arabic. Anything else
 *  keeps the caller's own sentence. */
export function describeApiFailure(r: ApiFailure, fallback: string): string {
  switch (r.error) {
    case "offline":
    case "timeout":
    case "network":
      return r.message || fallback;
    case "disabled":
    case "not_installed":
    case "db_unavailable":
    case "db_error":
      return "الخدمة مو متاحة حالياً. جرّب بعد شوي.";
    case "rate_limited":
      return "طلبات كثيرة بسرعة. استنى شوي وجرّب مرة ثانية.";
    case "admin_unset":
      return "لوحة التحكّم مو مفعّلة على السيرفر بعد — ما فيه كلمة سر في storage/admin.secret.";
    case "admin_required":
    case "admin_forbidden":
      return "كلمة السر مو مضبوطة.";
    default:
      return fallback;
  }
}
