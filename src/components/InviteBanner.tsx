"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconGo, IconSend } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import type { Place } from "@/lib/places";
import {
  hangoutTitle,
  inviteAcceptMessage,
  invitePassed,
  phraseFor,
  readInvite,
  shareHangout,
  type ShareOutcome,
  type WhenId,
} from "@/lib/hangout";

/**
 * The other end of «رسّلها للربع».
 *
 * Everything about sharing was built from the sender's side: pick a time,
 * compose a proposal, hand it to WhatsApp. The person who received it got a
 * place page — the same page they would have seen from a search — with no
 * sign that they had been invited to anything, and no way to answer except to
 * go back to the chat and type. Half a feature, and the missing half is the
 * one with more people in it: an invitation goes to five.
 *
 * So when the link carries a time, the page opens by saying so, and offers
 * the one reply that ends the thread.
 *
 * Read after mount, never during render. The export is one HTML file served
 * to everybody, so the query string does not exist at build time and neither
 * does the clock — the same reason ShareHangout picks its hour on mount.
 * Until then this renders nothing, which is also exactly right for the many
 * visitors who arrived without an invitation.
 */
export default function InviteBanner({ place }: { place: Place }) {
  const [when, setWhen] = useState<WhenId | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setWhen(readInvite(window.location.search));
    setNow(new Date());
  }, []);

  if (!when || !now) return null;

  const passed = invitePassed(when, now);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    haptic("tap");
    const result = await shareHangout({
      text: inviteAcceptMessage(place, when),
      title: hangoutTitle(place),
    });
    if (result === "shared" || result === "whatsapp" || result === "copied") haptic("success");
    setOutcome(result);
    setBusy(false);
  };

  return (
    <section
      // Announced, because for this visitor it is the point of the page and it
      // appears after hydration rather than in the markup they first saw.
      aria-label="دعوة"
      className={`mt-6 rounded-3xl border p-5 shadow-sm ${
        passed ? "border-line bg-sand-100" : "border-coral-200 bg-coral-50"
      }`}
    >
      <p className="font-display text-lg font-semibold text-ink-900">
        {passed ? "الدعوة هذي راحت" : "ربعك عازمينك هني"}
      </p>

      <p className="mt-1 text-ink-700">
        <strong className="text-ink-900">{place.nameAr}</strong> — {place.areaAr}
        {"، "}
        {phraseFor(when)}
      </p>

      {/* A passed invitation is not hidden and not dressed up. The group is
          still talking about this place, and the reader needs to know which
          of the two things they are looking at — an outing to get ready for,
          or one that already happened. Saying nothing would let them turn up
          to the second thinking it was the first. */}
      {passed ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-600">
          الوقت اللي بالدعوة عدّى. المكان نفسه بعده هني — شوفه واقترح وقت ثاني
          للربع.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={accept}
            disabled={busy}
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-coral-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-coral-800 disabled:opacity-60"
          >
            {outcome ? <IconCheck className="size-4" /> : <IconSend className="size-4" />}
            {outcome ? "رديت عليهم" : "تمام، أنا معكم"}
          </button>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl border border-line bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-coral-300 hover:text-coral-700"
          >
            الطريق
            <IconGo className="size-4" />
          </a>
        </div>
      )}

      {/* The clipboard path is the one that needs saying out loud: nothing
          opened, and without this the button looks like it did nothing. */}
      {outcome === "copied" && (
        <p className="mt-2 text-sm text-ink-600">نسخنا ردّك — الصقه بالجروب.</p>
      )}
      {outcome === "failed" && (
        <p className="mt-2 text-sm text-ink-600">ما قدرنا نرسل الرد — رد عليهم بالجروب.</p>
      )}
    </section>
  );
}
