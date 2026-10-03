"use client";

import { useEffect, useState } from "react";
import { IconClock } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import { hasCalendarEntry, type Day, type WhenId } from "@/lib/plan-date";
import type { Place } from "@/lib/places";

/**
 * «أضفها للتقويم» — the plan onto the phone's calendar, from the page that
 * holds it: the invitation banner, /pick after a vote, the panel after a
 * send. One component rather than three buttons so the entry it produces is
 * composed once (hangout-calendar.ts) and the rule for WHICH plans get one
 * lives in one place too (plan-date.ts, hasCalendarEntry).
 *
 * Two ways, drawn side by side rather than one behind the other's failure:
 * the file, which every calendar app opens, and Google's own «add this»
 * page for whoever lives there. Nothing is fetched and nothing is kept.
 *
 * The builder is loaded on demand. ShareHangout sits on /search, whose
 * JavaScript is within 3K of its budget, and the entry is needed only once
 * a plan has gone out — so the folding and the escaping ride in their own
 * chunk, fetched when this renders rather than with the page.
 *
 * Renders nothing at all for a plan that cannot go on a calendar — «الحين»,
 * or a link with no day in it — rather than a button that makes an entry
 * with a date the message never said.
 */
type Builder = typeof import("@/lib/hangout-calendar");

export default function AddToCalendar({
  place,
  when,
  day,
  phrase,
  url,
  mapsUrl,
  className = "",
}: {
  place: Place;
  when: WhenId;
  day: Day | null | undefined;
  phrase: string;
  url: string;
  mapsUrl: string;
  className?: string;
}) {
  const [cal, setCal] = useState<Builder | null>(null);
  const wanted = hasCalendarEntry(when, day) && !!day;
  useEffect(() => {
    if (!wanted || cal) return;
    let live = true;
    import("@/lib/hangout-calendar").then((m) => { if (live) setCal(m); });
    return () => { live = false; };
  }, [wanted, cal]);
  if (!wanted || !cal || !day) return null;
  const entry = () => cal.calendarEntry({ place, when, day, phrase, url, mapsUrl });

  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <button
        type="button"
        data-calendar=""
        onClick={() => {
          haptic("tap");
          cal.downloadCalendar(entry());
        }}
        className="inline-flex min-h-tap items-center gap-1.5 rounded-2xl border border-line bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-coral-300 hover:text-coral-700"
      >
        <IconClock className="size-4" />
        أضفها للتقويم
      </button>
      <a
        href={entry().google}
        target="_blank"
        rel="noopener noreferrer"
        data-calendar-google=""
        className="inline-flex min-h-tap items-center text-xs font-semibold text-sea-700 underline-offset-2 hover:underline"
      >
        قوقل كالندر
      </a>
    </span>
  );
}
