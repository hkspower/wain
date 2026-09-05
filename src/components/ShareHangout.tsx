"use client";

import { useEffect, useMemo, useState } from "react";
import { IconCheck, IconSend } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import type { Place } from "@/lib/places";
import {
  defaultWhen,
  hangoutMessage,
  hangoutTitle,
  inviteUrl,
  msToNextKuwaitHour,
  shareHangout,
  whenOptions,
  type ShareOutcome,
  type WhenId,
} from "@/lib/hangout";

/**
 * «رسّلها للربع» — send this place to the group, with a time on it.
 *
 * Inline rather than a dialog, like the order and queue panels beside it. A
 * modal would need a focus trap and a way out for one decision with four taps
 * in it, and it would cover the page the visitor is still deciding about.
 *
 * The time is chosen before sending and never after, because the message is
 * composed from it — there is no editing a WhatsApp message once it is in
 * somebody's chat.
 */
export default function ShareHangout({ place }: { place: Place }) {
  const [when, setWhen] = useState<WhenId | null>(null);
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  // The hour decides both which options exist and which is preselected, and
  // the hour is not knowable while this is prerendered — the exported HTML is
  // shared by everybody, so a default baked in at build time would be wrong
  // for every visitor after the one whose build it was. Chosen on mount.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  /**
   * The hour keeps moving, and this panel used to stop watching it.
   *
   * hangout.ts drops each evening option as it passes, «because offering ٧
   * مساءً at nine o'clock is offering a plan that already failed» — and it did
   * that once, on mount, and never again. A place page is exactly the kind of
   * page somebody leaves open while the group argues, so one opened at 18:55
   * was still offering «الليلة الساعة ٧» at half past seven, still had it
   * selected, and would still send it. The guarantee was real and honoured for
   * a single instant.
   *
   * One timeout to the next Kuwait hour rather than a ticking interval: every
   * boundary in that list is on the hour, so there is nothing in between worth
   * a render. A second past it, so a slow timer cannot land on the wrong side.
   */
  useEffect(() => {
    if (!now) return;
    const id = window.setTimeout(() => setNow(new Date()), msToNextKuwaitHour(now) + 1_000);
    return () => window.clearTimeout(id);
  }, [now]);

  // The place is passed so the summer rule reaches the chips: an unshaded
  // place in July stops offering «الحين» rather than offering a plan the rest
  // of the site would refuse to make. See whenOptions.
  const options = useMemo(() => (now ? whenOptions(now, place) : []), [now, place]);

  // Picks the first time, and re-picks when the chosen one expires — which is
  // the half that matters. An expired selection is not merely shown, it is
  // what gets sent: the chip disappears from the row while `when` still holds
  // its id, and the message is composed from `when`.
  useEffect(() => {
    if (!now) return;
    // Checked against the same list the chips are drawn from — place included.
    // Without the place this asked a different question than the row answered,
    // so a slot the summer rule had just removed still counted as valid and
    // still got sent.
    if (when === null || !whenOptions(now, place).some((o) => o.id === when)) {
      setWhen(defaultWhen(place, now));
    }
  }, [now, when, place]);

  const send = async () => {
    if (!when || busy) return;
    setBusy(true);
    setOutcome(null);
    haptic("tap");
    // Canonical, and carrying the time — see inviteUrl. Built here rather than
    // in an effect so it is composed at the moment of sending, from the choice
    // that is actually selected.
    const url =
      typeof window === "undefined" ? "" : inviteUrl(place, when, window.location.origin);
    const text = hangoutMessage({ place, when, url });
    const result = await shareHangout({ text, title: hangoutTitle(place) });
    if (result === "shared" || result === "whatsapp" || result === "copied") haptic("success");
    setOutcome(result);
    setBusy(false);
  };

  // Nothing to say while the clock is unknown: rendering the chips with a
  // build-time hour would show «٧ مساءً» to somebody at midnight.
  if (!now || !when) return null;

  return (
    <section className="mt-9 rounded-3xl border border-line bg-white p-6 shadow-sm standalone:mt-5 standalone:p-4">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
        <IconSend className="size-5 text-coral-700" />
        رسّلها للربع
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
        اختر الوقت وارسل المكان للجروب — بالموقع والرابط، وخلّص النقاش.
      </p>

      <fieldset className="mt-4">
        <legend className="text-xs font-semibold text-ink-600">متى؟</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((o) => {
            const active = o.id === when;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => { setWhen(o.id); setOutcome(null); }}
                aria-pressed={active}
                className={`min-h-11 rounded-full px-4 text-sm font-semibold transition ${
                  active
                    ? "bg-coral-700 text-white shadow-sm"
                    : "bg-sand-100 text-ink-700 ring-1 ring-line hover:bg-sand-200"
                }`}
              >
                {o.labelAr}
              </button>
            );
          })}
        </div>
      </fieldset>

      <button
        type="button"
        onClick={send}
        disabled={busy}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-coral-700 px-5 text-sm font-semibold text-white transition hover:bg-coral-800 disabled:opacity-60"
      >
        <IconSend className="size-4" />
        {busy ? "لحظة…" : "رسّلها"}
      </button>

      {/* Only ever one line, and never one that scolds somebody for changing
          their mind — a cancelled share sheet says nothing at all. */}
      {outcome === "copied" && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-palm-700" role="status">
          <IconCheck className="size-4" />
          انتسخت — الصقها بالجروب.
        </p>
      )}
      {outcome === "whatsapp" && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-palm-700" role="status">
          <IconCheck className="size-4" />
          فتحنا لك واتساب.
        </p>
      )}
      {outcome === "failed" && (
        <p className="mt-3 text-sm font-semibold text-ink-600" role="alert">
          ما قدرنا نرسلها — انسخ الرابط من فوق وأرسله.
        </p>
      )}
    </section>
  );
}
