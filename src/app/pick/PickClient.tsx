"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AddToCalendar from "@/components/AddToCalendar";
import PlaceCard from "@/components/PlaceCard";
import SearchMap from "@/components/SearchMap";
import { IconCheck, IconSend } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import { countAr, getCategory, VOTES_COUNT } from "@/lib/place-kit";
import { usePlaces } from "@/lib/usePlaces";
import { castVote, leader, myVote, readVotes, type Tally } from "@/lib/votes";
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
  const [read, setRead] = useState<{ slugs: string[]; when: WhenId | null; day: Day | null; poll: string | null } | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [voted, setVoted] = useState<{ slug: string; outcome: ShareOutcome } | null>(null);
  const [busy, setBusy] = useState(false);
  // The group's count, when the link carries a poll (lib/votes.ts). Read on
  // arrival and every twenty seconds while the page is in front of someone,
  // so a friend's vote shows without a reload; nothing at all for an old
  // link with no poll, or when the server cannot be reached.
  const [tally, setTally] = useState<Tally | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const poll = read?.poll ?? null;
  const slugsKey = read?.slugs.join(",") ?? "";
  useEffect(() => {
    if (!poll || !slugsKey) return;
    setMine(myVote(poll));
    const options = slugsKey.split(",");
    let live = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void readVotes(poll, options).then((t) => { if (live && t) setTally(t); });
    };
    refresh();
    const timer = setInterval(refresh, 20_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [poll, slugsKey]);

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
    // Counted first, and not waited on: the share sheet holds the page until
    // it closes, and the count is worth showing the moment it is in.
    if (poll) {
      setMine(place.slug);
      void castVote(poll, place.slug, read.slugs).then((t) => t && setTally(t));
    }
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

  const top = leader(tally);
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
      {tally && tally.total > 0 && (
        <p className="mt-2 text-sm font-semibold text-ink-700" role="status" data-tally-summary="">
          {`صوّتوا: ${countAr(tally.total, VOTES_COUNT)}`}
          {top ? ` — الأكثر: ${list.find((p) => p.slug === top)?.nameAr ?? ""}` : " — متعادلين"}
        </p>
      )}

      <ol className="mt-5 space-y-3">
        {list.map((place, i) => {
          const replied = voted?.slug === place.slug;
          const chosen = mine === place.slug;
          const n = tally?.tally[place.slug] ?? 0;
          const share = tally && tally.total > 0 ? Math.round((n / tally.total) * 100) : 0;
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
                  aria-pressed={poll ? chosen : undefined}
                  className={`inline-flex min-h-tap items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition disabled:opacity-50 ${
                    replied || chosen ? "bg-palm-700 text-white" : "bg-coral-700 text-white hover:bg-coral-800"
                  }`}
                >
                  {replied || chosen ? <IconCheck className="size-4" /> : <IconSend className="size-4" />}
                  {replied ? "رديت" : chosen ? "صوتك هني" : "أنا معه"}
                </button>
                {tally && (
                  <span className="mt-1.5 text-center text-xs font-semibold text-ink-600" data-tally={place.slug}>
                    {countAr(n, VOTES_COUNT)}
                  </span>
                )}
                {tally && tally.total > 0 && (
                  <span aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand-200">
                    <span
                      className={`block h-full rounded-full ${top === place.slug ? "bg-palm-600" : "bg-sand-500"}`}
                      style={{ width: `${share}%` }}
                    />
                  </span>
                )}
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
