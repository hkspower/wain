"use client";

import { useCallback, useEffect, useState } from "react";
import { IconCheck, IconClock, IconClose, IconPhone } from "@/components/icons";
import { loadSupabase } from "@/lib/supabase";
import { describeNetError } from "@/lib/net";
import { useLatestRequest } from "@/lib/useLatest";
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

export default function Orders({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const { run } = useLatestRequest();

  const load = useCallback(async () => {
    setLoading(true);
    await run(
      async (signal) => {
        const sb = await loadSupabase();
        if (!sb) return { fatal: "لوحة التحكّم غير مربوطة بقاعدة بيانات." } as const;
        return await sb
          .from("orders")
          // Named columns, not *: track_token is the customer's key to their
          // own order and the queue has no use for it, so it never leaves the
          // database.
          .select(
            "id,status,place_slug,place_name_ar,lines,total_fils,pickup_at,customer_name,customer_phone,note_ar,created_at"
          )
          .order("created_at", { ascending: false })
          .limit(200)
          .abortSignal(signal);
      },
      (result) => {
        setLoading(false);
        if ("fatal" in result) return setError(result.fatal);
        const { data, error: e } = result;
        if (e) {
          setError(describeNetError(e, `ما قدرنا نقرأ الطلبات: ${e.message}`));
          return;
        }
        setError("");
        const list = (data ?? []) as OrderRow[];
        setRows(list);
        onCountChange?.(list.filter((r) => r.status === "placed").length);
      }
    );
  }, [onCountChange, run]);

  useEffect(() => { void load(); }, [load]);

  async function setStatus(row: OrderRow, status: OrderRow["status"]) {
    const sb = await loadSupabase();
    if (!sb) return;
    const { error: e } = await sb.from("orders").update({ status }).eq("id", row.id);
    if (e) setError(`ما قدرنا نحدّث الطلب: ${e.message}`);
    else void load();
  }

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
          الطلبات المسبقة — الدفع يتم عند الاستلام، وين ما تمسك أي مبلغ.
        </p>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="min-h-11 rounded-xl border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
        >
          {showAll ? "المفتوحة بس" : "كل الطلبات"}
        </button>
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
            return (
              <li key={row.id} className="rounded-3xl border border-line bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-lg font-bold text-ink-900" dir="ltr">
                        {orderReference(row.id)}
                      </span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[row.status]}`}>
                        {STATUS_LABEL[row.status]}
                      </span>
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
