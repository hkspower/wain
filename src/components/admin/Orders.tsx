"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconClock, IconClose, IconPhone, IconSpeaker, IconSpeakerOff } from "@/components/icons";
import { loadSupabase, supabaseEnabled } from "@/lib/supabase";
import { chime, chimeEnabled, setChimeEnabled } from "@/lib/chime";
import { describeNetError } from "@/lib/net";
import { useLatestRequest } from "@/lib/useLatest";
import { usePoll } from "@/lib/usePoll";
import { toArabicDigits } from "@/lib/places";
import { formatKwd, orderReference, orderTotal, type OrderLine } from "@/lib/orders";

/**
 * The pre-order queue.
 *
 * Not an order-management system and not a till. A row here is a message from
 * a customer saying "have this ready at this time"; the money changes hands at
 * the counter, so there is nothing to refund, capture or reconcile — only a
 * state to move along so the person behind the counter knows what is still
 * outstanding.
 */

interface OrderRow extends Record<string, unknown> {
  id: string;
  status: "placed" | "ready" | "collected" | "cancelled";
  place_slug: string;
  place_name_ar: string;
  lines: OrderLine[];
  total_fils: number;
  pickup_at: string;
  customer_name: string;
  customer_phone: string;
  note_ar: string;
  created_at: string;
}

const STATUS_LABEL = {
  placed: "جديد",
  ready: "جاهز",
  collected: "تسلّم",
  cancelled: "ملغي",
} as const;

const STATUS_TONE = {
  placed: "bg-sun-100 text-sun-900",
  ready: "bg-sea-50 text-sea-700",
  collected: "bg-palm-500/12 text-palm-700",
  cancelled: "bg-sand-200 text-ink-600",
} as const;

/** 24h "18:30" as the app writes it everywhere else. */
function timeAr(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "ص" : "م";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${toArabicDigits(h12)}:${toArabicDigits(String(m).padStart(2, "0"))} ${period}`;
}

/** Often enough that a customer walking over does not beat the alert, rarely
 *  enough to be nothing on a shop's connection. */
const QUEUE_POLL_MS = 30_000;

type QueueResult = { fatal: string } | { data: unknown; error: { message: string } | null };

export default function Orders({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [sound, setSound] = useState(true);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const { run } = useLatestRequest();

  useEffect(() => setSound(chimeEnabled()), []);

  /**
   * The queue reads itself.
   *
   * Before this it loaded once and then sat there: an order placed while the
   * tab was open simply never appeared, and the first anybody knew of it was
   * the customer arriving to collect something nobody had made. Polling is not
   * paused while the tab is hidden, because a shop keeps this open in the
   * background all day and that is exactly when the alert has to land.
   */
  const { value, settled, refresh } = usePoll<QueueResult>(
    async (signal) => {
      const sb = await loadSupabase();
      if (!sb) return { fatal: "لوحة التحكّم مو مربوطة بقاعدة بيانات." };
      return await sb
        .from("orders")
        // Named columns, not *: track_token is the customer's key to their own
        // order and the queue has no use for it, so it never leaves the
        // database.
        .select(
          "id,status,place_slug,place_name_ar,lines,total_fils,pickup_at,customer_name,customer_phone,note_ar,created_at"
        )
        .order("created_at", { ascending: false })
        .limit(200)
        .abortSignal(signal);
    },
    { intervalMs: QUEUE_POLL_MS, enabled: supabaseEnabled, pauseWhenHidden: false }
  );

  const rows: OrderRow[] = useMemo(() => {
    if (!value || "fatal" in value || value.error) return [];
    return (value.data ?? []) as OrderRow[];
  }, [value]);

  const openIds = useMemo(
    () => rows.filter((r) => r.status === "placed").map((r) => r.id),
    [rows]
  );
  const openCount = openIds.length;

  useEffect(() => {
    if (!value) return;
    if ("fatal" in value) return setError(value.fatal);
    if (value.error) return setError(describeNetError(value.error, `ما قدرنا نقرأ الطلبات: ${value.error.message}`));
    setError("");
  }, [value]);

  useEffect(() => { onCountChange?.(openCount); }, [openCount, onCountChange]);

  /**
   * Sound and a mark on anything that turned up since the last look.
   *
   * `seen` starts as whatever was outstanding on the very first read, so
   * opening the queue to four waiting orders does not set off an alarm about
   * orders that arrived yesterday. Only ids that appear after that are new.
   */
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!settled || !value || "fatal" in value || value.error) return;
    if (seen.current === null) {
      seen.current = new Set(openIds);
      return;
    }
    const fresh = openIds.filter((id) => !seen.current!.has(id));
    openIds.forEach((id) => seen.current!.add(id));
    if (fresh.length === 0) return;
    setFreshIds((prev) => new Set([...prev, ...fresh]));
    if (chimeEnabled()) chime();
  }, [openIds, settled, value]);

  /**
   * The count in the tab title.
   *
   * The one part of this that reaches somebody working in another tab, which
   * is where a shop's browser actually is most of the day.
   */
  useEffect(() => {
    const base = "لوحة التحكّم — وين؟";
    document.title = openCount > 0 ? `(${toArabicDigits(openCount)}) ${base}` : base;
    return () => { document.title = base; };
  }, [openCount]);

  async function setStatus(row: OrderRow, status: OrderRow["status"]) {
    const sb = await loadSupabase();
    if (!sb) return;
    await run(
      async (signal) => await sb.from("orders").update({ status }).eq("id", row.id).abortSignal(signal),
      ({ error: e }) => {
        if (e) setError(describeNetError(e, `ما قدرنا نحدّث الطلب: ${e.message}`));
        else {
          // Acted on, so it is no longer new to anybody.
          setFreshIds((prev) => { const next = new Set(prev); next.delete(row.id); return next; });
          refresh();
        }
      }
    );
  }

  const loading = !settled;
  const visible = showAll ? rows : rows.filter((r) => r.status === "placed" || r.status === "ready");

  if (loading) return <p className="py-10 text-center text-sm text-ink-500">نحمّل الطلبات…</p>;

  return (
    <section>
      {error && (
        <p role="alert" className="mb-4 rounded-2xl bg-coral-50 p-3 text-sm font-semibold text-coral-700">
          {error}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-500">
          الطلبات المسبقة — الدفع عند الاستلام، وين ما تمسك أي مبلغ.
        </p>
        <span className="flex items-center gap-2">
          {/* The chime is on by default and can be turned off, rather than off
              by default and easy to never find. A shop that misses an order
              because nobody switched the sound on has been let down by us. */}
          <button
            type="button"
            aria-pressed={sound}
            onClick={() => {
              const next = !sound;
              setSound(next);
              setChimeEnabled(next);
              // Play it when switching on, so they know what to listen for —
              // and so the click that enables it is also the gesture that lets
              // the browser make a sound at all.
              if (next) chime();
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line-control bg-white px-3 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
          >
            {sound ? <IconSpeaker className="size-4 text-palm-600" /> : <IconSpeakerOff className="size-4 text-ink-400" />}
            {sound ? "الصوت شغّال" : "الصوت مقفل"}
          </button>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="min-h-11 rounded-xl border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
          >
            {showAll ? "المفتوحة بس" : "كل الطلبات"}
          </button>
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-500">
          {rows.length === 0 ? "ما وصل أي طلب بعد." : "ما فيه طلبات مفتوحة."}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => {
            // Recomputed rather than trusted: the stored total is what the
            // customer was shown, and if it disagrees with its own lines the
            // person behind the counter should see that, not have it hidden.
            const recomputed = orderTotal(row.lines ?? []);
            const mismatch = recomputed !== row.total_fils;
            const isFresh = freshIds.has(row.id);
            return (
              <li
                key={row.id}
                className={`rounded-3xl border bg-white p-4 shadow-sm ${
                  isFresh ? "border-sea-400 ring-2 ring-sea-200" : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-lg font-bold text-ink-900" dir="ltr">
                        {orderReference(row.id)}
                      </span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[row.status]}`}>
                        {STATUS_LABEL[row.status]}
                      </span>
                      {isFresh && (
                        <span
                          role="status"
                          className="rounded-full bg-sea-600 px-2.5 py-1 text-xs font-semibold text-white"
                        >
                          وصل الحين
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-ink-700">{row.place_name_ar}</p>
                  </div>
                  <span className="flex items-center gap-1.5 rounded-full bg-sand-100 px-3 py-1.5 text-sm font-semibold text-ink-700">
                    <IconClock className="size-4 text-sea-600" />
                    {timeAr(row.pickup_at)}
                  </span>
                </div>

                <ul className="mt-3 divide-y divide-line text-sm">
                  {(row.lines ?? []).map((l, i) => (
                    <li key={`${l.id}-${i}`} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="text-ink-700">
                        <span className="font-semibold">{toArabicDigits(l.qty)}×</span> {l.nameAr}
                      </span>
                      <span className="shrink-0 text-ink-600">{formatKwd(l.priceFils * l.qty)}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                  <span className="text-sm font-semibold text-ink-700">المجموع</span>
                  <span className="font-display text-base font-bold text-ink-900">
                    {formatKwd(row.total_fils)}
                  </span>
                </div>
                {mismatch && (
                  <p className="mt-1 text-xs font-semibold text-coral-700">
                    تنبيه: مجموع الأصناف {formatKwd(recomputed)} — راجع السعر عند الاستلام.
                  </p>
                )}

                {row.note_ar && <p className="mt-2 text-sm text-ink-600">ملاحظة: {row.note_ar}</p>}

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <span className="text-sm text-ink-600">{row.customer_name}</span>
                  <a
                    href={`tel:+965${row.customer_phone}`}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line-control bg-white px-3 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
                  >
                    <IconPhone className="size-4 text-palm-600" />
                    <span dir="ltr">{row.customer_phone}</span>
                  </a>

                  <span className="ms-auto flex flex-wrap gap-2">
                    {row.status === "placed" && (
                      <button type="button" onClick={() => setStatus(row, "ready")}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-sea-600 px-4 text-sm font-semibold text-white transition hover:bg-sea-700">
                        <IconCheck className="size-4" />
                        جاهز
                      </button>
                    )}
                    {(row.status === "placed" || row.status === "ready") && (
                      <>
                        <button type="button" onClick={() => setStatus(row, "collected")}
                          className="inline-flex min-h-11 items-center rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white transition hover:bg-ink-800">
                          تسلّم
                        </button>
                        <button type="button" onClick={() => setStatus(row, "cancelled")}
                          aria-label={`ألغِ الطلب ${orderReference(row.id)}`}
                          className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-ink-500 transition hover:text-coral-700">
                          <IconClose className="size-4" />
                          إلغاء
                        </button>
                      </>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
