"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { IconCheck, IconClock, IconClose, IconCoins, IconGo } from "@/components/icons";
import { CollectionDetails, OrderLines } from "@/components/OrderSummary";
import { fieldClass, hintClass, labelClass } from "@/lib/form-classes";
import { haptic } from "@/lib/haptics";
import { toArabicDigits } from "@/lib/place-kit";
import type { Place } from "@/lib/places";
import {
  MAX_QTY_PER_ITEM,
  formatKwd,
  newOrderAttempt,
  orderChannel,
  orderTotal,
  pickupSlots,
  sendWhatsAppOrder,
  submitOrder,
  validateOrder,
  type OrderAttempt,
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
 *
 * Two modes, decided by `orderChannel()` and never both at once:
 *
 *   - **db**: the order is a row the business reads on its board. Name, phone
 *     and the rest go to the database; the tracker polls for «جاهز».
 *   - **whatsapp**: no database (every build to date). The order becomes a
 *     WhatsApp message to the place's own number, opened from the tap, and the
 *     device remembers it. No phone field — the shop answers in the thread
 *     the customer just opened. If the popup is blocked, the text is shown
 *     with its own copy button and a plain link, which a tap can always open.
 */
/** One shared empty array, so a place with no menu does not hand out a fresh
 *  one on every render and defeat the memo below. */
const NO_MENU: NonNullable<Place["menuAr"]> = [];

type Placed =
  | { channel: "db"; reference: string }
  | { channel: "whatsapp"; reference: string; opened: boolean; text: string; url: string };

export default function OrderPanel({ place }: { place: Place }) {
  const menu = place.menuAr ?? NO_MENU;
  const channel = orderChannel(place);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [pickupAt, setPickupAt] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [copied, setCopied] = useState(false);

  // One clock reading for the life of the panel: reading it again on each
  // render would let a slot the customer is looking at expire underneath them
  // between choosing it and sending.
  const slots = useMemo(() => pickupSlots(new Date(), 8, place.orderPrepMinutes), [place.orderPrepMinutes]);

  const lines: OrderLine[] = useMemo(
    () =>
      menu
        .filter((m) => !m.soldOut && (qty[m.id] ?? 0) > 0)
        .map((m) => ({ id: m.id, nameAr: m.nameAr, priceFils: m.priceFils, qty: qty[m.id] })),
    [menu, qty]
  );
  const total = orderTotal(lines);
  const count = lines.reduce((n, l) => n + l.qty, 0);

  /**
   * The identity this basket is being sent under.
   *
   * Held across presses of «أرسل الطلب», and replaced only when what is being
   * ordered actually changes. Same basket, same time, pressed twice because
   * the first reply never came back — that is one order, and the stable id
   * makes the database say so. A different basket is a different order and
   * gets a new id, because pretending otherwise would leave someone collecting
   * a coffee they had already removed.
   *
   * Name, phone and note are not part of the signature: correcting a typo in
   * your own phone number is not a second order. In WhatsApp mode the same
   * identity keeps the reference in the message stable across a blocked popup
   * and the «افتح واتساب» link that follows it.
   */
  const signature = JSON.stringify([lines, pickupAt]);
  const attemptRef = useRef<{ signature: string; attempt: OrderAttempt } | null>(null);
  if (attemptRef.current?.signature !== signature) {
    attemptRef.current = { signature, attempt: newOrderAttempt() };
  }

  // A customer who navigates away mid-send is not waiting for the answer.
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);

  if (!channel) return null;

  const bump = (id: string, by: number) => {
    setQty((q) => {
      const next = Math.min(MAX_QTY_PER_ITEM, Math.max(0, (q[id] ?? 0) + by));
      haptic(next === (q[id] ?? 0) ? "error" : "tap");
      return { ...q, [id]: next };
    });
  };

  const input = () => ({
    placeSlug: place.slug,
    placeNameAr: place.nameAr,
    lines,
    pickupAt,
    customerName: name,
    customerPhone: phone,
    noteAr: note,
  });

  /** WhatsApp mode. Synchronous end to end — see sendWhatsAppOrder: a
   *  window.open after an await is a blocked popup on Safari and Chrome. */
  function sendByWhatsApp() {
    const result = sendWhatsAppOrder(
      input(),
      place.orderWhatsApp!,
      attemptRef.current!.attempt,
      `${window.location.origin}/places/${place.slug}/`
    );
    if (!result.ok) {
      haptic("error");
      setErrors([result.message]);
      return;
    }
    setErrors([]);
    haptic(result.opened ? "success" : "error");
    setPlaced({ channel: "whatsapp", ...result });
  }

  async function send() {
    if (channel === "whatsapp") return sendByWhatsApp();
    const problems = validateOrder(input());
    if (problems.length) {
      haptic("error");
      setErrors(problems);
      return;
    }
    setErrors([]);
    setBusy(true);
    // One send at a time. Without this, an impatient double-tap put two
    // requests on the wire and the slower one's answer overwrote the faster
    // one's — the classic pair of racing XHRs.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const result = await submitOrder(input(), attemptRef.current!.attempt, controller.signal);
    if (controller.signal.aborted) return;
    inFlight.current = null;
    setBusy(false);
    if (result.ok) {
      haptic("success");
      setPlaced({ channel: "db", reference: result.reference });
    } else {
      haptic("error");
      setErrors([result.message]);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      haptic("success");
    } catch {
      setCopied(false);
      haptic("error");
    }
  }

  if (placed) {
    const wa = placed.channel === "whatsapp" ? placed : null;
    const blocked = !!wa && !wa.opened;
    return (
      <section
        className={`mt-5 rounded-3xl border p-4 ${
          blocked ? "border-sun-500/40 bg-sun-100/60" : "border-palm-500/30 bg-palm-500/8"
        }`}
        data-order-placed={placed.channel}
      >
        <h2 className="flex items-center gap-2 font-display text-xl font-bold text-ink-900">
          <IconCheck className="size-5 text-palm-600" />
          {wa ? (blocked ? "جهّزنا رسالتك" : "فتحنا لك واتساب") : "وصل طلبك"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          {wa && !blocked && <>اضغط «إرسال» هناك عشان توصل للمكان. </>}
          رقم طلبك <strong className="font-display text-lg text-ink-900" dir="ltr">{placed.reference}</strong>{" "}
          — قوله لهم عند الاستلام.
        </p>
        <p className="mt-1 text-sm font-semibold text-ink-700">
          الدفع عند الاستلام في {place.nameAr}
          {pickupAt && <> الساعة {slots.find((s) => s.value === pickupAt)?.labelAr}</>}.
        </p>
        {place.orderNoteAr && <p className={hintClass}>{place.orderNoteAr}</p>}

        {/* The popup was blocked: the message IS the order, so here it is,
            with its own copy button and a link a tap can always open — the
            hangout's failed-send shape. */}
        {wa && blocked && (
          <div className="mt-3" role="alert">
            <p className="text-sm font-semibold text-ink-700">
              ما انفتح واتساب من هني — افتحه بالزر، أو انسخ الطلب والصقه برسالة للمكان.
            </p>
            <textarea
              readOnly
              value={wa.text}
              rows={8}
              dir="rtl"
              aria-label="نص الطلب"
              className="mt-2 w-full resize-none rounded-2xl border border-line bg-white p-3 text-sm leading-relaxed text-ink-800"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <a
                href={wa.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-tap items-center gap-1.5 rounded-xl bg-palm-600 px-4 text-sm font-semibold text-white transition hover:bg-palm-700"
              >
                افتح واتساب
              </a>
              <button
                type="button"
                onClick={() => copyText(wa.text)}
                className="inline-flex min-h-tap items-center gap-1.5 rounded-xl border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300 hover:text-sea-700"
              >
                {copied ? "انتسخ ✓" : "انسخ"}
              </button>
            </div>
          </div>
        )}

        {/* What they just ordered. It used to say only the reference, which is
            the one thing they cannot check against. */}
        <OrderLines lines={lines} totalFils={total} />
        <CollectionDetails slug={place.slug} />

        {/* The device is the only thing holding this order's key, so the way
            back to it is a link and not an account. Said here, once, while the
            customer is still looking at the screen. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href="/orders"
            className="inline-flex min-h-tap items-center gap-1.5 rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white transition hover:bg-ink-800 active:scale-[0.98]"
          >
            تابع طلبك
            <IconGo className="size-4" />
          </Link>
          {wa && !blocked && (
            <a
              href={wa.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-tap items-center px-2 text-sm font-semibold text-ink-600 transition hover:text-palm-700"
            >
              ما انفتح؟ افتح واتساب
            </a>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-500">
          {wa
            ? "تلقاه في «طلباتي» على هذا الجهاز. المكان يرد عليك بالواتساب."
            : "تلقاه في «طلباتي» على هذا الجهاز، وتشوف فيه إذا صار جاهز."}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-5 rounded-3xl border border-line bg-white p-4 shadow-sm" data-order-channel={channel}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-bold text-ink-900">اطلب مقدّماً</h2>
        <span className="rounded-full bg-sand-100 px-3 py-1 text-xs font-semibold text-ink-600">
          الدفع عند الاستلام
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-500">
        {channel === "whatsapp"
          ? "اختر اللي تبيه ووقت الاستلام، ويوصل طلبك للمكان على واتساب وهم يردون عليك هناك. ما ندفع ولا نمسك فلوسك — تدفع لهم مباشرة."
          : "اختر اللي تبيه ووقت الاستلام، ويكون جاهز لك. ما ندفع ولا نمسك فلوسك — تدفع لهم مباشرة."}
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
                    className="grid size-6 place-items-center rounded-xl border border-line-control bg-white text-lg font-bold text-ink-700 transition hover:border-sea-300 disabled:opacity-35"
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
                    className="grid size-6 place-items-center rounded-xl border border-line-control bg-white text-lg font-bold text-ink-700 transition hover:border-sea-300 disabled:opacity-35"
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
        {/* No phone in WhatsApp mode: the shop answers in the thread the
            customer opens, so the number they would type is the number they
            are writing from. A field nobody reads is a field to leave out. */}
        {channel === "db" && (
          <div>
            <label htmlFor="o-phone" className={labelClass}>تلفونك</label>
            <input id="o-phone" dir="ltr" inputMode="numeric" className={fieldClass} value={phone}
              maxLength={20} onChange={(e) => setPhone(e.target.value)} placeholder="5xxxxxxx" />
            <p className={hintClass}>يوصل للمكان بس، عشان يتواصلون معك لو احتاجوا.</p>
          </div>
        )}
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
        className={`mt-5 min-h-12 w-full rounded-2xl px-6 font-display text-base font-semibold text-white transition disabled:opacity-40 ${
          channel === "whatsapp" ? "bg-palm-600 hover:bg-palm-700" : "bg-ink-900 hover:bg-ink-800"
        }`}
      >
        {channel === "whatsapp" ? "أرسل عبر واتساب" : busy ? "نرسل الطلب…" : "أرسل الطلب"}
      </button>
      <p className="mt-2 text-center text-2xs leading-relaxed text-ink-500">
        ما تدفع شي هنا. الطلب يوصل للمكان وتدفع لهم وقت الاستلام.
        {place.orderNoteAr ? ` ${place.orderNoteAr}` : ""}
      </p>
    </section>
  );
}
