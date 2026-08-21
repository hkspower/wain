"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconCheck, IconClock, IconGo } from "@/components/icons";
import { fieldClass, hintClass, labelClass } from "@/lib/form-classes";
import { haptic } from "@/lib/haptics";
import { toArabicDigits, type Place } from "@/lib/places";
import { supabaseEnabled } from "@/lib/supabase";
import { usePoll } from "@/lib/usePoll";
import {
  SALON_LABEL,
  aheadAr,
  fetchQueueSize,
  joinQueue,
  newQueueAttempt,
  takesQueue,
  validateJoin,
  waitEstimateAr,
  type QueueAttempt,
  type QueueSize,
} from "@/lib/queue";

/**
 * «خذ دورك» — take your turn without standing in the shop.
 *
 * The busy-ness is shown *before* the join button, on purpose. A queue app that
 * makes you commit before telling you the wait has taken something from you
 * rather than given you something: the whole point is deciding whether to go
 * now, later, or somewhere else.
 *
 * The number itself comes from the database. Nothing here picks it — see
 * joinQueue.
 */
export default function QueuePanel({ place }: { place: Place }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [joined, setJoined] = useState<number | null>(null);

  // One identity per attempt, held across presses: a lost reply followed by a
  // second press must not become a second person in the line.
  const attempt = useRef<QueueAttempt>(newQueueAttempt());
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);

  const open = takesQueue(place);

  // Refreshed while the page is open so somebody reading the panel is not
  // deciding on a queue length from five minutes ago.
  const { value: size } = usePoll<QueueSize | null>(
    (signal) => fetchQueueSize(place.slug, signal),
    { intervalMs: 30_000, enabled: supabaseEnabled && open }
  );

  if (!open) return null;
  const kind = place.salonKind!;

  async function join() {
    const input = {
      placeSlug: place.slug,
      placeNameAr: place.nameAr,
      salonKind: kind,
      customerName: name,
      customerPhone: phone,
    };
    const problems = validateJoin(input);
    if (problems.length) {
      haptic("error");
      setErrors(problems);
      return;
    }
    setErrors([]);
    setBusy(true);
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const result = await joinQueue(input, attempt.current, controller.signal);
    if (controller.signal.aborted) return;
    inFlight.current = null;
    setBusy(false);
    if (result.ok) {
      haptic("success");
      setJoined(result.number);
    } else {
      haptic("error");
      setErrors([result.message]);
    }
  }

  if (joined !== null) {
    return (
      <section className="mt-9 rounded-3xl border border-palm-500/30 bg-palm-500/8 p-6 standalone:mt-5 standalone:p-4">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold text-ink-900">
          <IconCheck className="size-5 text-palm-600" />
          خذيت دورك
        </h2>
        <p className="mt-3 text-sm text-ink-600">رقمك اليوم في {place.nameAr}</p>
        <p className="font-display text-6xl font-bold leading-none text-ink-900">
          {toArabicDigits(joined)}
        </p>
        <p className="mt-3 text-sm text-ink-600">
          تابع دورك وشوف كم واحد قدامك — ولا تحتاج تنتظر بالصالون.
        </p>
        <Link
          href="/queue"
          className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white transition hover:bg-ink-800 active:scale-[0.98]"
        >
          تابع دورك
          <IconGo className="size-4" />
        </Link>
      </section>
    );
  }

  return (
    <section className="mt-9 rounded-3xl border border-line bg-white p-6 shadow-sm standalone:mt-5 standalone:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-bold text-ink-900">خذ دورك</h2>
        <span className="rounded-full bg-sand-100 px-3 py-1 text-xs font-semibold text-ink-600">
          صالون {SALON_LABEL[kind]}
        </span>
      </div>

      {/* How busy it is, before the button and not after it. */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-sand-100 p-4">
        <IconClock className="size-5 shrink-0 text-sea-600" />
        {size ? (
          <span className="text-sm text-ink-700">
            <strong className="font-display text-base text-ink-900">
              {size.waiting === 0 ? "ما فيه أحد ينتظر" : `${toArabicDigits(size.waiting)} بالطابور`}
            </strong>
            <span className="ms-2 text-ink-600">
              {waitEstimateAr(size.waiting, size.serviceMinutes)}
            </span>
            {size.nowServing !== null && (
              <span className="ms-2 text-ink-500">
                · الحين رقم {toArabicDigits(size.nowServing)}
              </span>
            )}
          </span>
        ) : (
          <span className="text-sm text-ink-500">
            {supabaseEnabled ? "نشوف كم واحد بالطابور…" : "الطابور مو متاح حالياً."}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-ink-500">
        الوقت تقديري — يعتمد على شنو يبي كل واحد قبلك، فخذه كدليل مو كوعد.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="q-name" className={labelClass}>اسمك</label>
          <input
            id="q-name"
            className={fieldClass}
            value={name}
            maxLength={80}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
            placeholder="سالم"
          />
        </div>
        <div>
          <label htmlFor="q-phone" className={labelClass}>رقمك</label>
          <input
            id="q-phone"
            className={fieldClass}
            value={phone}
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            dir="ltr"
            onChange={(e) => setPhone(e.target.value)}
            placeholder="5x xxx xxx"
          />
          <p className={hintClass}>عشان يتصلون فيك إذا جا دورك ومو موجود.</p>
        </div>
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="mt-4 space-y-1 rounded-2xl bg-coral-50 p-3">
          {errors.map((e) => (
            <li key={e} className="text-sm font-semibold text-coral-700">{e}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={join}
        disabled={busy || !supabaseEnabled}
        className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink-900 px-6 font-semibold text-white transition hover:bg-ink-800 active:scale-[0.99] disabled:opacity-50 sm:w-auto"
      >
        {busy ? "ناخذ لك دور…" : "خذ دوري"}
      </button>
      {size && size.waiting > 0 && (
        <p className="mt-2 text-xs text-ink-500">
          بتكون بعد {aheadAr(size.waiting).replace(" قدامك", "")} — رقمك يطلع لك أول ما تضغط.
        </p>
      )}
    </section>
  );
}
