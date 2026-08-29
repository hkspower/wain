"use client";

import { loadSupabase, supabaseEnabled } from "@/lib/supabase";
import {
  describeNetError,
  isDefinitelyOffline,
  isRetryableSupabaseError,
  retry,
} from "@/lib/net";
import {
  DEFAULT_SERVICE_MINUTES,
  clampServiceMinutes,
  toArabicDigits,
} from "@/lib/place-kit";
// A type only — `import type` is erased at compile time, so naming the
// catalogue's own module here costs nothing in the bundle.
import type { Place } from "@/lib/places";

/**
 * الطابور — take your turn at the salon.
 *
 * A ticket is a place in a line, not a booking. You take a number from your
 * phone instead of standing in the shop, and the salon adds whoever walks in
 * to the same line — which is the only arrangement where the number means
 * anything. A queue counting only the people who used the app would tell
 * everybody a position the room disagrees with.
 *
 * The number is assigned by the database, not here. Two people tapping at the
 * same moment would pick the same one, and two customers who are both «رقم ٧»
 * is worse than no queue at all. Verified with forty simultaneous joins:
 * forty distinct numbers, one to forty.
 *
 * The id and the token are still made on the device, for the same reason as
 * orders: anon has no SELECT policy, and asking the database to hand back a
 * row it just wrote makes it check that policy and refuse.
 */

export type SalonKind = "men" | "women";

export const SALON_LABEL: Record<SalonKind, string> = {
  men: "رجالي",
  women: "نسائي",
};

/** Whether this place is running a queue a customer can join right now. */
export function takesQueue(place: Place): boolean {
  return Boolean(place.takesQueue && place.salonKind);
}

export type TicketStatus = "waiting" | "called" | "served" | "no_show" | "left";

/** Nothing changes after these, so there is nothing left to poll for. */
export function isTicketFinished(status: TicketStatus): boolean {
  return status === "served" || status === "no_show" || status === "left";
}

/**
 * The wait, in words, and deliberately vague.
 *
 * Rounded to five minutes and always hedged, because this is position times an
 * average and the average is a number a salon typed into a form once. Telling
 * somebody «١٧ دقيقة» would imply a precision that does not exist, and they
 * would hold us to it.
 */
export function waitEstimateAr(ahead: number, serviceMinutes: number): string {
  if (ahead <= 0) return "دورك الحين تقريباً";
  const raw = ahead * clampServiceMinutes(serviceMinutes);
  const rounded = Math.max(5, Math.round(raw / 5) * 5);
  if (rounded < 60) return `تقريباً ${toArabicDigits(rounded)} دقيقة`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  const hourWord = hours === 1 ? "ساعة" : hours === 2 ? "ساعتين" : `${toArabicDigits(hours)} ساعات`;
  return mins === 0
    ? `تقريباً ${hourWord}`
    : `تقريباً ${hourWord} و${toArabicDigits(mins)} دقيقة`;
}

/** "٣ قدامك" — Arabic counts the small numbers differently. */
export function aheadAr(ahead: number): string {
  if (ahead <= 0) return "ما فيه أحد قدامك";
  if (ahead === 1) return "واحد قدامك";
  if (ahead === 2) return "اثنين قدامك";
  return `${toArabicDigits(ahead)} قدامك`;
}

/* ── the device's own tickets ─────────────────────────────────────────── */

export interface HeldTicket {
  id: string;
  token: string;
  number: number;
  placeSlug: string;
  placeNameAr: string;
  salonKind: SalonKind;
  /** ISO date in Kuwait terms, so a ticket from yesterday is recognisable. */
  day: string;
  joinedAt: string;
}

const STORE_KEY = "wain:queue";
const KEEP = 10;

export function rememberTicket(ticket: HeldTicket): void {
  try {
    const all = [ticket, ...listTickets().filter((t) => t.id !== ticket.id)].slice(0, KEEP);
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* private mode — the ticket is real, it just is not remembered */
  }
}

export function listTickets(): HeldTicket[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is HeldTicket =>
        !!t &&
        typeof t.id === "string" &&
        typeof t.token === "string" &&
        typeof t.number === "number"
    );
  } catch {
    return [];
  }
}

export function forgetTicket(id: string): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(listTickets().filter((t) => t.id !== id)));
  } catch {
    /* nothing to forget */
  }
}

/** Kuwait's date, which is the one the numbering resets on. */
export function kuwaitToday(now: Date = new Date()): string {
  // UTC+3 all year — Kuwait has no daylight saving, so this is exact rather
  // than an approximation that drifts twice a year.
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

/** A ticket from a previous day is over, whatever the server last said. */
export function isFromToday(ticket: HeldTicket, now: Date = new Date()): boolean {
  return ticket.day === kuwaitToday(now);
}

/* ── talking to the database ──────────────────────────────────────────── */

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const h = () => Math.floor(Math.random() * 65536).toString(16).padStart(4, "0");
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

function newToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface QueueAttempt {
  id: string;
  token: string;
}

export function newQueueAttempt(): QueueAttempt {
  return { id: newId(), token: newToken() };
}

/** Kuwaiti mobile: eight digits starting 5, 6 or 9. */
export function normalisePhone(value: string): string | null {
  const digits = value
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^\d]/g, "")
    .replace(/^00965/, "")
    .replace(/^965(?=\d{8}$)/, "");
  return /^[569]\d{7}$/.test(digits) ? digits : null;
}

export interface JoinInput {
  placeSlug: string;
  placeNameAr: string;
  salonKind: SalonKind;
  customerName: string;
  customerPhone: string;
}

export function validateJoin(input: JoinInput): string[] {
  const errs: string[] = [];
  if (input.customerName.trim().length < 2) errs.push("اكتب اسمك.");
  if (!normalisePhone(input.customerPhone)) errs.push("اكتب رقم كويتي صحيح (٨ أرقام).");
  return errs;
}

export type JoinResult =
  | { ok: true; number: number; ticket: HeldTicket }
  | { ok: false; reason: "disabled" | "invalid" | "closed" | "duplicate" | "network"; message: string };

/**
 * Take a number.
 *
 * Not retried. join_queue writes a row and hands back the number it assigned,
 * and unlike the order insert there is no client-supplied key to collide on —
 * the id is ours but a retry after a lost reply would hit the primary key, so
 * a repeat is safe. It is still not repeated automatically: a second ticket
 * for the same person is exactly the failure this feature must not have, and
 * the unique index that would catch it is the last line of defence, not the
 * first. The customer can press again.
 */
export async function joinQueue(
  input: JoinInput,
  attempt: QueueAttempt = newQueueAttempt(),
  signal?: AbortSignal | null
): Promise<JoinResult> {
  const problems = validateJoin(input);
  if (problems.length) return { ok: false, reason: "invalid", message: problems[0] };

  if (!supabaseEnabled) {
    return { ok: false, reason: "disabled", message: "الطابور مو متاح حالياً. اتصل بالصالون." };
  }
  const sb = await loadSupabase();
  if (!sb) return { ok: false, reason: "disabled", message: "الطابور مو متاح حالياً." };

  const q = sb.rpc("join_queue", {
    p_id: attempt.id,
    p_token: attempt.token,
    p_place_slug: input.placeSlug,
    p_place_name_ar: input.placeNameAr,
    p_customer_name: input.customerName.trim(),
    p_customer_phone: normalisePhone(input.customerPhone) ?? "",
    p_source: "online",
  });
  const { data, error } = await (signal ? q.abortSignal(signal) : q);

  if (error) {
    // The unique index on (place, day, phone) where the ticket is still live.
    if (error.code === "23505") {
      return {
        ok: false,
        reason: "duplicate",
        message: "عندك دور بهذا الصالون اليوم. افتح «دوري» عشان تشوفه.",
      };
    }
    // Raised by join_queue when the salon has the queue switched off.
    if (error.code === "23514") {
      return {
        ok: false,
        reason: "closed",
        message: "الصالون مو مستقبل أدوار حالياً.",
      };
    }
    return {
      ok: false,
      reason: "network",
      message: describeNetError(error, "ما قدرنا نأخذ لك دور. جرّب مرة ثانية."),
    };
  }

  const number = Number(data);
  if (!Number.isFinite(number) || number < 1) {
    return { ok: false, reason: "network", message: "ما قدرنا نأخذ لك دور. جرّب مرة ثانية." };
  }

  const ticket: HeldTicket = {
    id: attempt.id,
    token: attempt.token,
    number,
    placeSlug: input.placeSlug,
    placeNameAr: input.placeNameAr,
    salonKind: input.salonKind,
    day: kuwaitToday(),
    joinedAt: new Date().toISOString(),
  };
  rememberTicket(ticket);
  return { ok: true, number, ticket };
}

export interface TicketState {
  status: TicketStatus;
  number: number;
  ahead: number;
  nowServing: number | null;
  placeSlug: string;
  placeNameAr: string;
  serviceMinutes: number;
  day: string;
  createdAt: string;
  calledAt: string | null;
  servedAt: string | null;
  endedAt: string | null;
}

export type TicketStateResult =
  | { ok: true; state: TicketState | null }
  | { ok: false; offline: boolean };

/** Retried: queue_status is `stable` and reads one row. */
export async function fetchTicketState(
  id: string,
  token: string,
  signal?: AbortSignal | null
): Promise<TicketStateResult> {
  if (!supabaseEnabled) return { ok: false, offline: false };
  const sb = await loadSupabase();
  if (!sb) return { ok: false, offline: false };

  let result;
  try {
    result = await retry(
      async () => {
        const q = sb.rpc("queue_status", { p_id: id, p_token: token });
        return await (signal ? q.abortSignal(signal) : q);
      },
      { signal, shouldRetry: (r) => isRetryableSupabaseError(r.error) }
    );
  } catch {
    return { ok: false, offline: isDefinitelyOffline() };
  }

  const { data, error } = result;
  if (error) return { ok: false, offline: isDefinitelyOffline() };
  if (!Array.isArray(data) || data.length === 0) return { ok: true, state: null };

  const r = data[0] as Record<string, unknown>;
  return {
    ok: true,
    state: {
      status: r.status as TicketStatus,
      number: Number(r.number ?? 0),
      ahead: Number(r.ahead ?? 0),
      nowServing: r.now_serving === null || r.now_serving === undefined ? null : Number(r.now_serving),
      placeSlug: String(r.place_slug ?? ""),
      placeNameAr: String(r.place_name_ar ?? ""),
      serviceMinutes: Number(r.service_minutes ?? DEFAULT_SERVICE_MINUTES),
      day: String(r.day ?? ""),
      createdAt: String(r.created_at ?? ""),
      calledAt: (r.called_at as string) ?? null,
      servedAt: (r.served_at as string) ?? null,
      endedAt: (r.ended_at as string) ?? null,
    },
  };
}

export interface QueueSize {
  waiting: number;
  nowServing: number | null;
  serviceMinutes: number;
}

/**
 * How busy the salon is, before you commit to anything.
 *
 * Exposes a count and nothing else — no names, no ticket numbers, nothing that
 * says anything about the people already in the line.
 */
export async function fetchQueueSize(
  placeSlug: string,
  signal?: AbortSignal | null
): Promise<QueueSize | null> {
  if (!supabaseEnabled) return null;
  const sb = await loadSupabase();
  if (!sb) return null;

  let result;
  try {
    result = await retry(
      async () => {
        const q = sb.rpc("queue_size", { p_place_slug: placeSlug });
        return await (signal ? q.abortSignal(signal) : q);
      },
      { signal, shouldRetry: (r) => isRetryableSupabaseError(r.error) }
    );
  } catch {
    return null;
  }

  const { data, error } = result;
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const r = data[0] as Record<string, unknown>;
  return {
    waiting: Number(r.waiting ?? 0),
    nowServing: r.now_serving === null || r.now_serving === undefined ? null : Number(r.now_serving),
    serviceMinutes: Number(r.service_minutes ?? DEFAULT_SERVICE_MINUTES),
  };
}

export type LeaveResult =
  | { ok: true }
  | { ok: false; reason: "too-late" | "unknown" | "network"; message: string };

/** Give up your place. Allowed while waiting and while called — someone who
 *  has been called and cannot make it should be able to say so, which is
 *  better for the salon than a no-show. */
export async function leaveQueue(
  id: string,
  token: string,
  signal?: AbortSignal | null
): Promise<LeaveResult> {
  if (!supabaseEnabled) {
    return { ok: false, reason: "network", message: "ما نقدر نلغي الحين. اتصل بالصالون." };
  }
  const sb = await loadSupabase();
  if (!sb) return { ok: false, reason: "network", message: "ما نقدر نلغي الحين." };

  const q = sb.rpc("leave_queue", { p_id: id, p_token: token });
  const { data, error } = await (signal ? q.abortSignal(signal) : q);

  if (error) {
    return {
      ok: false,
      reason: "network",
      message: describeNetError(error, "ما وصل الإلغاء. جرّب مرة ثانية."),
    };
  }
  if (data === null || data === undefined) {
    return { ok: false, reason: "unknown", message: "ما لقينا دورك. اتصل بالصالون." };
  }

  const status = String(data) as TicketStatus;
  if (status === "left") return { ok: true };
  return {
    ok: false,
    reason: "too-late",
    message:
      status === "served"
        ? "خلص دورك أصلاً."
        : "ما نقدر نلغي الدور الحين. اتصل بالصالون.",
  };
}
