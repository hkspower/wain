"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { IconCheck, IconClock, IconClose, IconCoins, IconGo } from "@/components/icons";
import { fieldClass, hintClass, labelClass } from "@/lib/form-classes";
import { haptic } from "@/lib/haptics";
import { toArabicDigits, type Place } from "@/lib/places";
import {
  MAX_QTY_PER_ITEM,
  acceptsOrders,
  formatKwd,
  orderReference,
  orderTotal,
  pickupSlots,
  submitOrder,
  validateOrder,
  type OrderLine,
} from "@/lib/orders";

/**
 * طلب مسبق — order ahead, collect and pay at the place.
 *
 * Everything the customer is told here has to survive the moment they walk in
 * and hand over money that wain never saw. So the panel says «الدفع عند
 * الاستلام» where a shop would say "pay now", the button says «أرسل الطلب»
 * rather than "checkout", and the total is labelled «المجموع التقريبي» —
 * approximate, because the business's till is the authority on the price and
 * this is a message, not a receipt.
 */
export default function OrderPanel({ place }: { place: Place }) {
  const menu = place.menuAr ?? [];
  const [qty, setQty] = useState<Record<string, number>>({});
  const [pickupAt, setPickupAt] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [placed, setPlaced] = useState<string | null>(null);

  // One clock reading for the life of the panel: reading it again on each
  // render would let a slot the customer is looking at expire underneath them
  // between choosing it and sending.
  const slots = useMemo(() => pickupSlots(new Date()), []);

  const lines: OrderLine[] = useMemo(
    () =>
      menu
        .filter((m) => !m.soldOut && (qty[m.id] ?? 0) > 0)
        .map((m) => ({ id: m.id, nameAr: m.nameAr, priceFils: m.priceFils, qty: qty[m.id] })),
    [menu, qty]
  );
  const total = orderTotal(lines);
  const count = lines.reduce((n, l) => n + l.qty, 0);

  if (!acceptsOrders(place)) return null;

  const bump = (id: string, by: number) => {
    setQty((q) => {
      const next = Math.min(MAX_QTY_PER_ITEM, Math.max(0, (q[id] ?? 0) + by));
      haptic(next === (q[id] ?? 0) ? "error" : "tap");
      return { ...q, [id]: next };
    });
  };

  async function send() {
    const input = {
      placeSlug: place.slug,
      placeNameAr: place.nameAr,
      lines,
      pickupAt,
      customerName: name,
      customerPhone: phone,
      noteAr: note,
    };
    const problems = validateOrder(input);
    if (problems.length) {
      haptic("error");
      setErrors(problems);
      return;
    }
    setErrors([]);
    setBusy(true);
    const result = await submitOrder(input);
    setBusy(false);
    if (result.ok) {
      haptic("success");
      setPlaced(result.reference);
    } else {
      haptic("error");
      setErrors([result.message]);
    }
  }

  if (placed) {
    return (
      <section className="mt-9 rounded-3xl border border-palm-500/30 bg-palm-500/8 p-6 standalone:mt-5 standalone:p-4">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold text-ink-900">
          <IconCheck className="size-5 text-palm-600" />
          وصل طلبك
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          رقم طلبك <strong className="font-display text-lg text-ink-900" dir="ltr">{placed}</strong>{" "}
          — قوله لهم عند الاستلام.
        </p>
        <p className="mt-1 text-sm font-semibold text-ink-700">
          الدفع عند الاستلام في {place.nameAr}.
        </p>
        {place.orderNoteAr && <p className={hintClass}>{place.orderNoteAr}</p>}
        {/* The device is the only thing holding this order's key, so the way
            back to it is a link and not an account. Said here, once, while the
            customer is still looking at the screen. */}
        <Link
          href="/orders"
          className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white transition hover:bg-ink-800 active:scale-[0.98]"
        >
          تابع طلبك
          <IconGo className="size-4" />
        </Link>
        <p className="mt-2 text-xs text-ink-500">
          تلقاه في «طلباتي» على هذا الجهاز، وتشوف فيه إذا صار جاهز.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-9 rounded-3xl border border-line bg-white p-6 shadow-sm standalone:mt-5 standalone:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-bold text-ink-900">اطلب مقدّماً</h2>
        <span className="rounded-full bg-sand-100 px-3 py-1 text-xs font-semibold text-ink-600">
          الدفع عند الاستلام
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-500">
        اختر اللي تبيه ووقت الاستلام، ويكون جاهز لك. ما ندفع ولا نمسك فلوسك — تدفع لهم مباشرة.
      </p>

      {/* ---- the menu ---- */}
      <ul className="mt-5 divide-y divide-line">
        {menu.map((item) => {
          const n = qty[item.id] ?? 0;
          return (
            <li key={item.id} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className={`block font-semibold ${item.soldOut ? "text-ink-500 line-through" : "text-ink-900"}`}>
                  {item.nameAr}
                </span>
                {item.noteAr && <span className="mt-0.5 block text-xs text-ink-500">{item.noteAr}</span>}
                <span className="mt-0.5 block text-sm text-ink-600">{formatKwd(item.priceFils)}</span>
              </span>

              {item.soldOut ? (
                <span className="shrink-0 rounded-full bg-sand-200 px-3 py-1 text-xs font-semibold text-ink-600">
                  خلصت
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => bump(item.id, -1)}
                    disabled={n === 0}
                    aria-label={`أنقص ${item.nameAr}`}
                    className="grid size-11 place-items-center rounded-xl border border-line-control bg-white text-lg font-bold text-ink-700 transition hover:border-sea-300 disabled:opacity-35"
                  >
                    −
                  </button>
                  <span
                    aria-live="polite"
                    aria-label={`الكمية ${n}`}
                    className="w-8 text-center font-display text-base font-bold text-ink-900"
                  >
                    {toArabicDigits(n)}
                  </span>
                  <button
                    type="button"
                    onClick={() => bump(item.id, 1)}
                    disabled={n >= MAX_QTY_PER_ITEM}
                    aria-label={`زد ${item.nameAr}`}
                    className="grid size-11 place-items-center rounded-xl border border-line-control bg-white text-lg font-bold text-ink-700 transition hover:border-sea-300 disabled:opacity-35"
                  >
                    +
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {/* ---- total ---- */}
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-sand-100 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-700">
          <IconCoins className="size-4 text-sand-600" />
          المجموع التقريبي
          {count > 0 && (
            <span className="font-normal text-ink-500">({toArabicDigits(count)} صنف)</span>
          )}
        </span>
        <span className="font-display text-lg font-bold text-ink-900">{formatKwd(total)}</span>
      </div>

      {/* ---- when, and who ---- */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="o-time" className={labelClass}>
            <span className="inline-flex items-center gap-1.5">
              <IconClock className="size-4 text-sea-600" />
              وقت الاستلام
            </span>
          </label>
          <select
            id="o-time"
            className={fieldClass}
            value={pickupAt}
            onChange={(e) => setPickupAt(e.target.value)}
          >
            <option value="">اختر وقت…</option>
            {slots.map((s) => (
              <option key={s.value} value={s.value}>
                {s.labelAr}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="o-name" className={labelClass}>اسمك</label>
          <input id="o-name" className={fieldClass} value={name} maxLength={80}
            onChange={(e) => setName(e.target.value)} placeholder="عشان ينادونك" />
        </div>
        <div>
          <label htmlFor="o-phone" className={labelClass}>تلفونك</label>
          <input id="o-phone" dir="ltr" inputMode="numeric" className={fieldClass} value={phone}
            maxLength={20} onChange={(e) => setPhone(e.target.value)} placeholder="5xxxxxxx" />
          <p className={hintClass}>يوصل للمكان بس، عشان يتواصلون معك لو احتاجوا.</p>
        </div>
        <div>
          <label htmlFor="o-note" className={labelClass}>ملاحظة (اختياري)</label>
          <input id="o-note" className={fieldClass} value={note} maxLength={200}
            onChange={(e) => setNote(e.target.value)} placeholder="بدون سكر، مثلاً" />
        </div>
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="mt-4 space-y-1 rounded-2xl bg-coral-50 p-3 text-sm font-semibold text-coral-700">
          {errors.map((e) => (
            <li key={e} className="flex items-start gap-2">
              <IconClose className="mt-0.5 size-3.5 shrink-0" />
              {e}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={send}
        disabled={busy || count === 0}
        className="mt-5 min-h-12 w-full rounded-2xl bg-ink-900 px-6 font-display text-base font-semibold text-white transition hover:bg-ink-800 disabled:opacity-40"
      >
        {busy ? "نرسل الطلب…" : "أرسل الطلب"}
      </button>
      <p className="mt-2 text-center text-[11px] leading-relaxed text-ink-500">
        ما تدفع شي هنا. الطلب يوصل للمكان وتدفع لهم وقت الاستلام.
        {place.orderNoteAr ? ` ${place.orderNoteAr}` : ""}
      </p>
    </section>
  );
}
