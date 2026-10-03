"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AddToCalendar from "@/components/AddToCalendar";
import PlaceCard from "@/components/PlaceCard";
import SearchMap from "@/components/SearchMap";
import { IconCheck, IconSend } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import { getCategory } from "@/lib/place-kit";
import { usePlaces } from "@/lib/usePlaces";
import {
  invitePassed,
  inviteUrl,
  mapsUrl,
  planPhrase,
  readShortlist,
  shareHangout,
  shortlistTitle,
  shortlistVoteMessage,
  type Day,
  type ShareOutcome,
  type WhenId,
} from "@/lib/hangout";

/**
 * The other end of «خلّهم يختارون» — the shortlist a friend sent.
 *
 * The places, numbered as the message numbered them, on one map; and under
 * each one the reply that ends the thread, «أنا مع ٢», as a tap. Nothing is
 * counted here — there is no server to count on, and the group is already
 * counting in its own chat, which is where the votes go.
 *
 * Read after mount, like InviteBanner: the export is one HTML file for
 * everybody, so the query string and the clock do not exist at build time.
 * Its own route rather than a mode of /search, because /search is a search —
 * its list, its answer and its share panel would all be about a query nobody
 * typed.
 */
export default function PickClient() {
  const { places } = usePlaces();
  const [read, setRead] = useState<{ slugs: string[]; when: WhenId | null; day: Day | null } | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [voted, setVoted] = useState<{ slug: string; outcome: ShareOutcome } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const known = new Set(places.map((p) => p.slug));
    setRead(readShortlist(window.location.search, (s) => known.has(s)));
    setNow(new Date());
  }, [places]);

  const list = useMemo(
    () => (read?.slugs ?? []).flatMap((s) => places.find((p) => p.slug === s) ?? []),
    [read, places]
  );

  if (!read || !now) return null;
  const when = read.when;
  const day = read.day;
  const passed = when ? invitePassed(when, now, day) : false;
  const phrase = when ? planPhrase(when, day, now) : "";

  const vote = async (i: number) => {
    if (busy) return;
    const place = list[i];
    setBusy(true);
    setActive(place.slug);
    haptic("tap");
    // The vote carries the place's own link, so the chat ends up holding the
    // winner's plan the way a single proposal would have.
    const url = when ? inviteUrl(place, when, window.location.origin, day) : undefined;
    const outcome = await shareHangout({ text: shortlistVoteMessage(place, i, when, url, day), title: shortlistTitle() });
    if (outcome === "shared" || outcome === "whatsapp" || outcome === "copied") haptic("success");
    setVoted({ slug: place.slug, outcome });
    setBusy(false);
  };

  // A link with fewer than two places that exist is not a shortlist — a
  // place renamed since, or a link cut short in a forward.
  if (list.length < 2) {
    return (
      <div className="mx-auto max-w-3xl px-2.5 py-2 sm:px-4 sm:py-3">
        <h1 className="font-display text-2xl font-bold text-ink-900">ما لقينا الأماكن اللي بالرابط</h1>
        <p className="mt-2 text-ink-600">يمكن الرابط انقص وهو ينرسل. تقدر تدوّر بنفسك أو تسأل سالم.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/search/"
            className="inline-flex min-h-tap items-center rounded-xl bg-sea-600 px-4 text-sm font-semibold text-white transition hover:bg-sea-700"
          >
            دوّر
          </Link>
          <Link
            href="/salem/"
            className="inline-flex min-h-tap items-center rounded-xl border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
          >
            اسأل سالم
          </Link>
        </div>
      </div>
    );
  }

  const category = getCategory(list[0].category);
  const ask = category ? `${category.ar} ${list[0].areaAr}` : list[0].areaAr;

  return (
    <div className="mx-auto max-w-3xl px-2.5 py-2 sm:px-4 sm:py-3">
      <h1 className="font-display text-2xl font-bold text-ink-900 sm:text-3xl">
        {passed ? "الوقت اللي اختاروه عدّى" : "ربعك يختارون"}
      </h1>
      <p className="mt-1 text-ink-600">
        {when ? `وين نروح ${phrase}؟` : "وين نروح؟"} اختار واحد ورد عليهم.
      </p>

      <ol className="mt-5 space-y-3">
        {list.map((place, i) => {
          const mine = voted?.slug === place.slug;
          return (
            <li
              key={place.slug}
              onPointerEnter={() => setActive(place.slug)}
              className={`flex items-stretch gap-3 rounded-3xl border bg-white p-2 shadow-sm transition ${
                active === place.slug ? "border-sea-300" : "border-line"
              }`}
            >
              <span
                aria-hidden="true"
                className="grid w-9 shrink-0 place-items-center rounded-2xl bg-sand-100 font-display text-lg font-bold text-ink-800"
              >
                {["١", "٢", "٣"][i]}
              </span>
              <div className="min-w-0 flex-1">
                <PlaceCard place={place} />
              </div>
              <div className="flex shrink-0 flex-col justify-center">
                <button
                  type="button"
                  onClick={() => vote(i)}
                  disabled={busy || passed}
                  aria-label={`أنا مع ${["١", "٢", "٣"][i]}: ${place.nameAr}`}
                  className={`inline-flex min-h-tap items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition disabled:opacity-50 ${
                    mine ? "bg-palm-700 text-white" : "bg-coral-700 text-white hover:bg-coral-800"
                  }`}
                >
                  {mine ? <IconCheck className="size-4" /> : <IconSend className="size-4" />}
                  {mine ? "رديت" : "أنا معه"}
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {voted?.outcome === "copied" && (
        <p className="mt-3 text-sm text-ink-600" role="status">نسخنا ردّك — الصقه بالجروب.</p>
      )}
      {voted?.outcome === "failed" && (
        <p className="mt-3 text-sm text-ink-600" role="alert">ما قدرنا نرسل الرد — رد عليهم بالجروب.</p>
      )}
      {/* Having voted, the voter has a plan of their own to keep: the place
          they chose, at the list's time. */}
      {voted && voted.outcome !== "failed" && when && (() => {
        const chosen = list.find((p) => p.slug === voted.slug);
        return chosen ? (
          <AddToCalendar
            className="mt-3"
            place={chosen}
            when={when}
            day={day}
            phrase={phrase}
            url={inviteUrl(chosen, when, window.location.origin, day)}
            mapsUrl={mapsUrl(chosen)}
          />
        ) : null;
      })()}

      <div className="mt-6">
        <SearchMap places={list} active={active} onActive={setActive} />
      </div>

      {/* None of the three? The assistants are a tap away, already asked
          about something like the first one. */}
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-600">
        ولا واحد عاجبك؟
        <Link
          href={`/salem/?q=${encodeURIComponent(ask)}`}
          className="inline-flex min-h-tap items-center rounded-full border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300 hover:text-sea-700"
        >
          اسأل سالم عن غيرها
        </Link>
      </p>
    </div>
  );
}
