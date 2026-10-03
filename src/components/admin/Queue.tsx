"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconClose, IconPhone } from "@/components/icons";
import { chime, chimeEnabled } from "@/lib/chime";
import { toArabicDigits } from "@/lib/place-kit";
import { backendEnabled, callSafe, describeApiFailure, type ApiResult } from "@/lib/backend";
import { useLatestRequest } from "@/lib/useLatest";
import { usePoll } from "@/lib/usePoll";
import { newQueueAttempt, normalisePhone, type TicketStatus } from "@/lib/queue";

/**
 * الطابور — the salon's side of the line.
 *
 * Two jobs, and the second is what makes the first honest: move people along,
 * and add the ones who walked in. A queue that counts only the customers who
 * used the app tells everybody a position the room disagrees with, so «أضف
 * زبون» goes through the same numbering function as the app does and lands in
 * the same line.
 */

interface TicketRow extends Record<string, unknown> {
  id: string;
  number: number;
  status: TicketStatus;
  source: "online" | "walk_in";
  place_slug: string;
  place_name_ar: string;
  customer_name: string;
  customer_phone: string;
  day: string;
  created_at: string;
  called_at: string | null;
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  waiting: "ينتظر",
  called: "ناديناه",
  served: "خلص",
  no_show: "ما حضر",
  left: "ألغى",
};

const STATUS_TONE: Record<TicketStatus, string> = {
  waiting: "bg-sun-100 text-sun-900",
  called: "bg-sea-50 text-sea-700",
  served: "bg-palm-500/12 text-palm-700",
  no_show: "bg-coral-50 text-coral-700",
  left: "bg-sand-200 text-ink-600",
};

const POLL_MS = 20_000;

type Result = ApiResult<{ day: string; tickets: TicketRow[] }>;

export default function Queue({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [walkName, setWalkName] = useState("");
  const [walkPhone, setWalkPhone] = useState("");
  const [slug, setSlug] = useState("");
  const { run } = useLatestRequest();

  // Not paused while hidden, for the same reason as the orders queue: the tab
  // sits in the background at the counter all day, and that is exactly when a
  // new arrival has to be noticed.
  // `queue_list` is today's tickets only — the server's Kuwait day, not this
  // browser's clock. Yesterday's numbers restarted this morning, so mixing
  // them in would show two people holding «رقم ٣». track_token is the
  // customer's own key and the counter has no use for it; it never leaves the
  // server.
  const { value, settled, refresh } = usePoll<Result>(
    (signal) => callSafe<{ day: string; tickets: TicketRow[] }>("queue_list", undefined, { admin: true, signal }),
    { intervalMs: POLL_MS, enabled: backendEnabled, pauseWhenHidden: false }
  );

  const rows: TicketRow[] = useMemo(() => (value?.ok ? value.tickets : []), [value]);

  useEffect(() => {
    if (!value) return;
    if (!value.ok) return setError(describeApiFailure(value, `ما قدرنا نقرأ الطابور: ${value.error}`));
    setError("");
  }, [value]);

  const waitingIds = useMemo(
    () => rows.filter((r) => r.status === "waiting").map((r) => r.id),
    [rows]
  );
  useEffect(() => { onCountChange?.(waitingIds.length); }, [waitingIds.length, onCountChange]);

  // Same rule as the orders queue: whatever was already waiting when this was
  // opened is not news, only what turns up afterwards.
  const seen = useRef<Set<string> | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!settled || !value?.ok) return;
    if (seen.current === null) { seen.current = new Set(waitingIds); return; }
    const fresh = waitingIds.filter((id) => !seen.current!.has(id));
    waitingIds.forEach((id) => seen.current!.add(id));
    if (fresh.length === 0) return;
    setFreshIds((prev) => new Set([...prev, ...fresh]));
    if (chimeEnabled()) chime();
  }, [waitingIds, settled, value]);

  const slugs = useMemo(
    () => Array.from(new Set(rows.map((r) => r.place_slug))).sort(),
    [rows]
  );
  const visible = showAll
    ? rows
    : rows.filter((r) => r.status === "waiting" || r.status === "called");

  async function setStatus(row: TicketRow, status: TicketStatus) {
    await run(
      (signal) => callSafe("queue_set_status", { id: row.id, status }, { admin: true, signal }),
      (r) => {
        if (!r.ok) setError(describeApiFailure(r, `ما قدرنا نحدّث الدور: ${r.error}`));
        else {
          setFreshIds((prev) => { const next = new Set(prev); next.delete(row.id); return next; });
          refresh();
        }
      }
    );
  }

  /** The next person in line, which is the button the counter actually wants. */
  const next = rows.find((r) => r.status === "waiting");

  async function addWalkIn() {
    const chosen = slug || slugs[0];
    if (!chosen) {
      setError("ما فيه صالون محدد. خذ أول دور من صفحة الصالون عشان نعرف وين.");
      return;
    }
    if (walkName.trim().length < 2) { setError("اكتب اسم الزبون."); return; }
    const phone = walkPhone.trim() ? normalisePhone(walkPhone) : "";
    if (phone === null) { setError("رقم الهاتف مو مضبوط. خلّه فاضي إذا ما عندك."); return; }

    const attempt = newQueueAttempt();
    const placeName = rows.find((r) => r.place_slug === chosen)?.place_name_ar ?? chosen;
    setAdding(true);
    // The same action the app uses, with `walk_in` — which the server accepts
    // only with the admin token: a visitor claiming to be a walk-in would be
    // inserting a customer who is not there.
    const r = await callSafe(
      "queue_join",
      {
        id: attempt.id,
        track_token: attempt.token,
        place_slug: chosen,
        place_name_ar: placeName,
        customer_name: walkName.trim(),
        customer_phone: phone,
        source: "walk_in",
      },
      { admin: true }
    );
    setAdding(false);
    if (!r.ok) {
      setError(
        r.error === "duplicate"
          ? "هذا الرقم عنده دور اليوم بالفعل."
          : r.error === "closed"
            ? "الصالون مو مستقبل أدوار: مو منشور، أو الطابور مطفي في بياناته."
            : describeApiFailure(r, `ما قدرنا نضيفه: ${r.error}`)
      );
      return;
    }
    setError("");
    setWalkName("");
    setWalkPhone("");
    refresh();
  }

  if (!settled) return <p className="py-10 text-center text-sm text-ink-500">نحمّل الطابور…</p>;

  return (
    <section>
      {error && (
        <p role="alert" className="mb-4 rounded-2xl bg-coral-50 p-3 text-sm font-semibold text-coral-700">
          {error}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-500">
          طابور اليوم. الأرقام تبدأ من ١ كل يوم، ولكل صالون طابوره.
        </p>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="min-h-tap rounded-xl border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
        >
          {showAll ? "المفتوحة بس" : "كل الأدوار"}
        </button>
      </div>

      {/* Call next — the one action a counter repeats all day. */}
      {next && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-sea-200 bg-sea-50 p-4">
          <span className="text-sm font-semibold text-sea-800">
            التالي: رقم{" "}
            <strong className="font-display text-2xl">{toArabicDigits(next.number)}</strong>
            <span className="ms-2 font-normal text-sea-700">{next.customer_name}</span>
          </span>
          <button
            type="button"
            onClick={() => setStatus(next, "called")}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-xl bg-sea-600 px-5 text-sm font-semibold text-white transition hover:bg-sea-700"
          >
            نادِ التالي
          </button>
        </div>
      )}

      {/* Walk-ins. Without this the queue is a lie. */}
      <div className="mb-5 rounded-3xl border border-line bg-sand-100/60 p-4">
        <p className="text-sm font-semibold text-ink-800">أضف زبون جا للمحل</p>
        <p className="mt-0.5 text-xs text-ink-500">
          ياخذ رقم من نفس الطابور، عشان اللي طالبين من التطبيق يشوفون مكانهم صح.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {slugs.length > 1 && (
            <select
              aria-label="الصالون"
              value={slug || slugs[0]}
              onChange={(e) => setSlug(e.target.value)}
              className="min-h-tap rounded-xl border border-line-control bg-white px-3 text-sm text-ink-800"
            >
              {slugs.map((s) => (
                <option key={s} value={s}>
                  {rows.find((r) => r.place_slug === s)?.place_name_ar ?? s}
                </option>
              ))}
            </select>
          )}
          <input
            aria-label="اسم الزبون"
            value={walkName}
            maxLength={80}
            onChange={(e) => setWalkName(e.target.value)}
            placeholder="الاسم"
            className="min-h-tap flex-1 rounded-xl border border-line-control bg-white px-3 text-sm text-ink-800"
          />
          <input
            aria-label="رقم الزبون (اختياري)"
            value={walkPhone}
            maxLength={20}
            dir="ltr"
            onChange={(e) => setWalkPhone(e.target.value)}
            placeholder="الرقم (اختياري)"
            className="min-h-tap w-40 rounded-xl border border-line-control bg-white px-3 text-sm text-ink-800"
          />
          <button
            type="button"
            onClick={addWalkIn}
            disabled={adding}
            className="min-h-tap rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:opacity-50"
          >
            {adding ? "نضيفه…" : "أضفه"}
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-500">
          {rows.length === 0 ? "ما فيه أدوار اليوم." : "الطابور فاضي."}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => {
            const isFresh = freshIds.has(row.id);
            return (
              <li
                key={row.id}
                className={`flex flex-wrap items-center gap-3 rounded-3xl border bg-white p-4 shadow-sm ${
                  isFresh ? "border-sea-400 ring-2 ring-sea-200" : "border-line"
                }`}
              >
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-sand-100 font-display text-2xl font-bold text-ink-900">
                  {toArabicDigits(row.number)}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink-900">{row.customer_name}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[row.status]}`}>
                      {STATUS_LABEL[row.status]}
                    </span>
                    {row.source === "walk_in" && (
                      <span className="rounded-full bg-sand-200 px-2.5 py-1 text-xs font-semibold text-ink-600">
                        جا للمحل
                      </span>
                    )}
                    {isFresh && (
                      <span role="status" className="rounded-full bg-sea-600 px-2.5 py-1 text-xs font-semibold text-white">
                        وصل الحين
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-500">{row.place_name_ar}</span>
                </span>

                {row.customer_phone && (
                  <a
                    href={`tel:+965${row.customer_phone}`}
                    className="inline-flex min-h-tap items-center gap-1.5 rounded-xl border border-line-control bg-white px-3 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
                  >
                    <IconPhone className="size-4 text-palm-600" />
                    <span dir="ltr">{row.customer_phone}</span>
                  </a>
                )}

                <span className="flex flex-wrap gap-2">
                  {row.status === "waiting" && (
                    <button
                      type="button"
                      onClick={() => setStatus(row, "called")}
                      className="inline-flex min-h-tap items-center rounded-xl bg-sea-600 px-4 text-sm font-semibold text-white transition hover:bg-sea-700"
                    >
                      نادِ
                    </button>
                  )}
                  {(row.status === "waiting" || row.status === "called") && (
                    <>
                      <button
                        type="button"
                        onClick={() => setStatus(row, "served")}
                        className="inline-flex min-h-tap items-center gap-1.5 rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white transition hover:bg-ink-800"
                      >
                        <IconCheck className="size-4" />
                        خلص
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatus(row, "no_show")}
                        aria-label={`رقم ${row.number} ما حضر`}
                        className="inline-flex min-h-tap items-center rounded-xl border border-line-control bg-white px-3 text-sm font-semibold text-ink-600 transition hover:border-coral-300 hover:text-coral-700"
                      >
                        <IconClose className="size-4" />
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
