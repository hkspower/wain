"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconCheck, IconClock, IconClose } from "@/components/icons";
import { CollectionDetails } from "@/components/OrderSummary";
import { haptic } from "@/lib/haptics";
import { toArabicDigits } from "@/lib/places";
import { supabaseEnabled } from "@/lib/supabase";
import { usePoll } from "@/lib/usePoll";
import {
  SALON_LABEL,
  aheadAr,
  fetchTicketState,
  forgetTicket,
  isFromToday,
  isTicketFinished,
  leaveQueue,
  listTickets,
  waitEstimateAr,
  type HeldTicket,
  type TicketState,
  type TicketStateResult,
  type TicketStatus,
} from "@/lib/queue";

/**
 * دوري — where you are in the line.
 *
 * The number is the whole screen, because that is the one thing somebody
 * glancing at a phone across a room needs to read. Everything else is support
 * for it.
 *
 * Polled a good deal faster than an order: a haircut queue moves, and being
 * called is a thing you have minutes to act on rather than hours.
 */

const POLL_MS = 20_000;

const TONE: Record<TicketStatus, string> = {
  waiting: "bg-sun-100 text-sun-900",
  called: "bg-palm-500/12 text-palm-700",
  served: "bg-sand-200 text-ink-600",
  no_show: "bg-sand-200 text-ink-600",
  left: "bg-sand-200 text-ink-600",
};

const LABEL: Record<TicketStatus, string> = {
  waiting: "بالطابور",
  called: "دورك الحين",
  served: "خلص",
  no_show: "ما حضرت",
  left: "ألغيته",
};

function TicketCard({ ticket, onForget }: { ticket: HeldTicket; onForget: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");

  const { value, settled, failures, refresh } = usePoll<TicketStateResult>(
    (signal) => fetchTicketState(ticket.id, ticket.token, signal),
    {
      intervalMs: POLL_MS,
      enabled: supabaseEnabled,
      isFinal: (r) => r.ok && !!r.state && isTicketFinished(r.state.status),
    }
  );

  const state: TicketState | null = value?.ok ? value.state : null;
  const unreachable = !supabaseEnabled || (settled && (failures > 0 || (!!value && !value.ok)));
  const missing = !!value && value.ok && value.state === null;
  const status: TicketStatus = state?.status ?? "waiting";
  const live = status === "waiting" || status === "called";

  async function leave() {
    if (!window.confirm(`تبي تلغي دورك رقم ${toArabicDigits(ticket.number)}؟`)) return;
    setLeaveError("");
    setLeaving(true);
    const result = await leaveQueue(ticket.id, ticket.token);
    setLeaving(false);
    haptic(result.ok ? "success" : "error");
    refresh();
    if (!result.ok) setLeaveError(result.message);
  }

  return (
    <li className="rounded-3xl border border-line bg-white p-5 shadow-sm standalone:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/places/${ticket.placeSlug}/`}
            className="text-sm font-semibold text-ink-700 transition hover:text-sea-700"
          >
            {ticket.placeNameAr}
          </Link>
          <p className="mt-0.5 text-xs text-ink-500">صالون {SALON_LABEL[ticket.salonKind]}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[status]}`}>
          {LABEL[status]}
        </span>
      </div>

      {/* The number, at the size somebody can read at arm's length. */}
      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-ink-500">رقمك</p>
          <p className="font-display text-6xl font-bold leading-none text-ink-900">
            {toArabicDigits(state?.number ?? ticket.number)}
          </p>
        </div>
        {state?.nowServing != null && (
          <div className="text-end">
            <p className="text-xs font-semibold text-ink-500">الحين عندهم</p>
            <p className="font-display text-3xl font-bold leading-none text-ink-600">
              {toArabicDigits(state.nowServing)}
            </p>
          </div>
        )}
      </div>

      {status === "called" ? (
        <p className="mt-4 rounded-2xl bg-palm-500/12 p-3 text-sm font-semibold text-palm-700" role="status">
          <IconCheck className="me-1.5 inline size-4" />
          نادوا على رقمك — روح لهم الحين.
        </p>
      ) : status === "waiting" ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-sand-100 p-3">
          <IconClock className="size-4 shrink-0 text-sea-600" />
          <span className="text-sm font-semibold text-ink-800">
            {state ? aheadAr(state.ahead) : "نشوف وين وصل الطابور…"}
          </span>
          {state && (
            <span className="text-sm text-ink-600">
              · {waitEstimateAr(state.ahead, state.serviceMinutes)}
            </span>
          )}
        </div>
      ) : (
        <p className="mt-4 rounded-2xl bg-sand-100 p-3 text-sm text-ink-600">
          {status === "served"
            ? "خلص دورك. عساك دوم بخير."
            : status === "left"
              ? "ألغيت دورك."
              : "ما حضرت وقت ما نادوا عليك. تقدر تاخذ دور جديد."}
        </p>
      )}

      {live && <CollectionDetails slug={ticket.placeSlug} />}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <span className="text-xs text-ink-500">
          الدور لليوم بس — الأرقام تبدأ من جديد كل يوم.
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {live && (
            <button
              type="button"
              onClick={leave}
              disabled={leaving}
              className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-ink-500 transition hover:text-coral-700 disabled:opacity-50"
            >
              <IconClose className="size-4" />
              {leaving ? "نلغي…" : "ألغِ دوري"}
            </button>
          )}
          <button
            type="button"
            onClick={() => { forgetTicket(ticket.id); onForget(); }}
            className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-ink-500 transition hover:text-coral-700"
          >
            احذفه من القائمة
          </button>
        </span>
      </div>

      {leaveError && (
        <p className="mt-2 rounded-2xl bg-sun-100 p-3 text-sm font-semibold text-sun-900" role="alert">
          {leaveError}
        </p>
      )}
      {unreachable && (
        <p className="mt-2 text-xs text-ink-500">
          ما قدرنا نتأكد من الطابور الحين — رقمك محفوظ، وبنحدّثه أول ما يرجع الاتصال.
        </p>
      )}
      {missing && (
        <p className="mt-2 text-xs text-ink-500">
          ما لقينا دورك عند الصالون. اتصل فيهم ومعك رقم {toArabicDigits(ticket.number)}.
        </p>
      )}
    </li>
  );
}

export default function QueueTracker() {
  const [tickets, setTickets] = useState<HeldTicket[] | null>(null);

  // After mount: localStorage does not exist during prerender, and the
  // exported HTML is shared by everybody.
  const reload = () =>
    // Yesterday's ticket is over whatever the server would say, and showing it
    // would put a stale number on a screen whose whole job is to show the
    // right one.
    setTickets(listTickets().filter((t) => isFromToday(t)));
  useEffect(reload, []);

  if (tickets === null) return null;

  if (tickets.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-line-strong bg-sand-100/70 py-14 text-center">
        <p className="font-display text-lg font-semibold text-ink-900">ما عندك دور اليوم</p>
        <p className="mt-1 text-sm text-ink-500">
          خذ دورك من صفحة الصالون، وانتظر مكان ما تحب بدل ما تقعد بالمحل.
        </p>
        <Link
          href="/explore"
          className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800"
        >
          تصفّح الأماكن
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {tickets.map((t) => (
        <TicketCard key={t.id} ticket={t} onForget={reload} />
      ))}
    </ul>
  );
}
