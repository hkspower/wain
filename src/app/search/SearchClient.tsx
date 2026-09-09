"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import SearchMap from "@/components/SearchMap";
import SearchResults, { optionId } from "@/components/SearchResults";
import SearchPlan from "@/components/SearchPlan";
import ShouqAnswer from "@/components/ShouqAnswer";
import VoiceControls from "@/components/VoiceControls";
import ShouqCallButton from "@/components/ShouqCallButton";
import { IconClose, IconCompass, IconSearch } from "@/components/icons";
import { toArabicDigits } from "@/lib/places";
import { usePlaces } from "@/lib/usePlaces";
import { buildIndex, search, type DocKind } from "@/lib/search";
import { useListboxKeys } from "@/lib/useListboxKeys";
import { answerParts } from "@/lib/voice-lines";
import { speak, stop as stopVoice, useVoice } from "@/lib/voice";
import { haptic } from "@/lib/haptics";

const FILTERS: { id: DocKind | "all"; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "place", label: "أماكن" },
  { id: "category", label: "تصنيفات" },
  { id: "area", label: "مناطق" },
  { id: "page", label: "صفحات" },
];

/** The results list, named so the box can point at the option that moved. */
const LISTBOX_ID = "wain-search-results";

const SUGGESTIONS = ["قهوة هادية", "طلعة مع العيال", "بحر", "أكل كويتي", "متحف", "السالمية"];

export default function SearchClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { places } = usePlaces();

  const [q, setQ] = useState(params.get("q") ?? "");
  const [kind, setKind] = useState<DocKind | "all">("all");
  // Shared between the map and the list: pointing at either end highlights the
  // other, so the two read as one view of the same results.
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * The query the RESULTS are for, which is allowed to lag the query the BOX
   * shows.
   *
   * Measured on a 4× throttled phone, a keystroke took up to 615ms to paint
   * and typing one phrase produced fourteen long tasks. Almost none of it was
   * the search: `search()` costs 0.09ms over this catalogue. It was the
   * rendering hanging off it — up to sixty result cards, and a map that
   * re-fits its frame and re-spreads every pin, all synchronously, between the
   * key going down and the letter appearing.
   *
   * useDeferredValue splits the two. `q` still updates instantly, so the box
   * echoes the finger; everything derived from `deferredQ` re-renders at a
   * lower priority and is interruptible, so the next keystroke pre-empts a
   * results render still in flight instead of queueing behind it.
   */
  const deferredQ = useDeferredValue(q);
  /** True while the results on screen are for an older query than the box. */
  const settling = deferredQ !== q;

  // Rebuilt whenever the place data changes (admin edits arrive live).
  const index = useMemo(() => buildIndex(places), [places]);

  const hits = useMemo(
    () => search(deferredQ, index, { limit: 40, kinds: kind === "all" ? undefined : [kind] }),
    [deferredQ, index, kind]
  );

  // The place hits, in result order, resolved back to full records so the map
  // can plot them. Only places carry coordinates — categories, areas and pages
  // have nothing to pin.
  const hitPlaces = useMemo(() => {
    const bySlug = new Map(places.map((p) => [p.slug, p]));
    return hits
      .filter((h) => h.doc.kind === "place")
      .map((h) => bySlug.get(h.doc.id.replace(/^place:/, "")))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  }, [hits, places]);

  /**
   * A `?q=` that arrives from somewhere else on this same page.
   *
   * `q` was seeded from the URL once, at mount, which is right for arriving
   * here from another route and wrong for everything that pushes `/search?q=…`
   * while /search is already on screen. Two things do: the ⌘K palette's «شوف
   * كل النتائج», which is in the navbar and therefore available here, and
   * شوق's `show_places`, now that the call is placed from this page. Both are
   * same-route pushes, so nothing remounts, `q` never hears about it, and the
   * URL and the box disagree — the address bar says «قهوة هادية» and the
   * results are for whatever was typed before.
   *
   * Adopting it only when it differs from what the box holds is what keeps
   * this from fighting the effect below, which writes the URL *from* `q`: the
   * echo of our own write is a no-op, an outside push is not.
   */
  useEffect(() => {
    const incoming = params.get("q") ?? "";
    setQ((current) => (incoming && incoming !== current ? incoming : current));
  }, [params]);

  // Keep ?q= in step with the box so a search can be shared or bookmarked,
  // replacing rather than pushing so Back leaves the page instead of
  // walking through every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search";
      router.replace(next, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [q, router]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const counts = useMemo(() => {
    const all = search(deferredQ, index, { limit: 200 });
    return {
      all: all.length,
      place: all.filter((h) => h.doc.kind === "place").length,
      category: all.filter((h) => h.doc.kind === "category").length,
      area: all.filter((h) => h.doc.kind === "area").length,
      page: all.filter((h) => h.doc.kind === "page").length,
    };
  }, [deferredQ, index]);

  // A kind filter chosen for an earlier query can have nothing for the new
  // one. Left alone it becomes a dead end: the chip stays selected but
  // disabled, and the page shows "ما لقينا شي" while the الكل chip is still
  // counting results. Drop back to الكل so the visitor sees them.
  useEffect(() => {
    if (kind !== "all" && counts[kind] === 0 && counts.all > 0) setKind("all");
  }, [kind, counts]);

  /**
   * A question asked out loud, handed over by وين AI.
   *
   * Not «read once at mount» any more, for the same reason as the `?q=` above:
   * the call is placed from this page now, so handing the question over is a
   * same-route push and there is no mount to read on. She wrote the key and
   * pushed, and the page never looked — so she repeated nothing and said
   * nothing, on the one flow that exists to be spoken.
   *
   * Still read-and-delete, so it stays a property of the arrival rather than
   * of every later edit of the box: the key is gone the moment it is taken,
   * and re-running on a URL change cannot resurrect it.
   */
  const [asked, setAsked] = useState<string | null>(null);
  useEffect(() => {
    try {
      const value = sessionStorage.getItem("wain:asked");
      if (value) {
        sessionStorage.removeItem("wain:asked");
        setAsked(value);
      }
    } catch {
      /* private mode — no echo */
    }
  }, [params]);

  /**
   * What شوق says about this search — once, for the page and for the voice.
   *
   * This used to be built inside the speaking effect, which meant it existed
   * only while صوت وين was switched on. Off — the default — the page computed
   * nothing and showed nothing, so a typed search met a list of cards with no
   * sign that anyone had been asked anything. Hoisted, it is the same object
   * rendered above the results and handed to `speak()`, so the written answer
   * and the spoken one cannot say different things.
   */
  /**
   * Note the guard: a query, not a query WITH RESULTS.
   *
   * `hits.length` used to be part of it, which made `answerParts`'s
   * no-results branch unreachable from the site. That branch returns the one
   * line written for the worst moment — «ما لقيت شي بهالكلمة. قول لي الجو
   * اللي تبيه — قهوة، بحر، مطعم، ولا طلعة عيال.» — and it is in the clip
   * library, so the generator would have paid ElevenLabs to record a sentence
   * that could never play.
   *
   * What shipped instead was a card saying «جرّب كلمة أقصر». That tells
   * somebody they failed; her line tells them the four things she is good at,
   * which after a MISHEARD spoken question is the only useful reply. A service
   * call never goes quiet on a failed lookup, and this was the one place she
   * did.
   */
  const answer = useMemo(
    () =>
      deferredQ.trim()
        ? answerParts(hits, hitPlaces, {
            asked: asked && asked === deferredQ.trim() ? asked : undefined,
            // Read at render, not at module load: an installed app can sit
            // open across midnight, and across the end of a month.
            month: new Date().getMonth(),
          })
        : [],
    [deferredQ, hits, hitPlaces, asked]
  );

  // صوت وين: once a search settles, say the best suggestion out loud —
  // only while the visitor has the voice toggle on, and never twice for the
  // same outcome.
  const { enabled: voiceEnabled } = useVoice();
  const lastSpokenRef = useRef("");
  useEffect(() => {
    if (!voiceEnabled) return;
    if (!q.trim()) {
      lastSpokenRef.current = "";
      return;
    }
    // The 900ms wait exists to let typing settle. A spoken question is already
    // finished when it arrives, so waiting only leaves the visitor listening
    // to silence after they have stopped talking.
    const spokenQuestion = asked && asked === q.trim() ? asked : null;
    const t = setTimeout(
      () => {
        const signature = `${hits[0]?.doc.id ?? "none"}|${hits.length}`;
        if (signature === lastSpokenRef.current) return;
        lastSpokenRef.current = signature;
        speak(answer);
      },
      spokenQuestion ? 220 : 900
    );
    return () => clearTimeout(t);
  }, [q, hits, voiceEnabled, asked, answer]);

  // Leaving the page shouldn't leave a voice talking.
  useEffect(() => () => stopVoice(), []);

  /* The box's own microphone is gone, and شوق is in its place.
   *
   * It was added so the page شوق hands you to could also be USED by voice —
   * «the search box is the same brain with typed input» — and it did that with
   * the same engine and the same ar-KW, dictating straight into `q` so the
   * results moved while the sentence was still being said.
   *
   * What it became, once the call moved onto this page, was the second
   * microphone on it: a mic in the box that dictates, and a coral launcher
   * beside it that calls, two icons a visitor reads as one offer. In local
   * mode a call already ends where the mic ended — the sentence lands in `q`
   * via the `wain:asked` handover above, this page searches it and reads the
   * answer back — so the behaviour survives the button that is left.
   * `ShouqCallButton` is that button, in the box, below.
   */

  /**
   * The keyboard, which this page did not answer at all.
   *
   * The ⌘K palette has had ↑/↓/Enter since it was written, and this — the
   * page that exists to search — had nothing, so anyone who learned the keys
   * in the overlay lost them the moment they landed here. Same hook on both
   * now, so the two cannot drift.
   *
   * Reset on `deferredQ` rather than `q`: the cursor belongs to the list on
   * screen, and the list on screen is the one for the deferred query. Keyed
   * to `q` it jumped back to the top on a keystroke whose results had not
   * arrived yet, which reads as the selection flickering while you type.
   */
  const choose = useCallback(
    (i: number) => {
      const target = hits[i]?.doc.url;
      if (target) router.push(target);
    },
    [hits, router]
  );
  const { active, onKeyDown } = useListboxKeys({
    count: hits.length,
    onChoose: choose,
    resetOn: deferredQ,
    optionIdAt: useCallback((i: number) => optionId(LISTBOX_ID, i), []),
  });

  return (
    <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">
          دوّر في وين
        </h1>
        <VoiceControls />
      </div>

      {/* Query box */}
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-ink-500"
        >
          <IconSearch className="size-5" />
        </span>
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={hits.length ? optionId(LISTBOX_ID, active) : undefined}
          aria-label="ابحث في كل محتوى وين"
          placeholder="اكتب اسم مكان، منطقة، أو جو…"
          className="w-full rounded-2xl border border-line-control bg-white py-4 pe-4 ps-12 text-lg text-ink-800 shadow-sm outline-none transition placeholder:text-ink-500/60 focus:border-sea-400 focus:ring-4 focus:ring-sea-100"
        />
        {/* Unconditional, unlike the mic it replaces. That was rendered only
            where `canListen()` was true, because a microphone that opens a
            permission prompt and then does nothing is worse than none. A call
            has somewhere to go on every browser: without recognition it says
            so and leaves the visitor in this box, typing. */}
        <ShouqCallButton className="absolute inset-y-0 end-3 my-auto" />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="مسح البحث"
            className="absolute inset-y-0 end-14 my-auto grid size-11 place-items-center rounded-full text-ink-500 transition hover:bg-sand-200 hover:text-ink-800"
          >
            <IconClose className="size-4" />
          </button>
        )}
      </div>

      {/* The listening line went with the mic. The call has its own sheet, and
          it says «يرن…» / «متصل» / why it failed with far more room than a
          caption under a text field ever had. */}

      {/* Filters */}
      {q.trim() && (
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="نوع النتيجة">
          {FILTERS.map((f) => {
            const n = counts[f.id as keyof typeof counts];
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => { haptic("select"); setKind(f.id); }}
                aria-pressed={kind === f.id}
                disabled={n === 0}
                className={`min-h-11 rounded-full px-4 text-sm font-semibold transition disabled:opacity-40 ${
                  kind === f.id
                    ? "bg-ink-900 text-white"
                    : "border border-line-control bg-white text-ink-600 hover:border-sea-300"
                }`}
              >
                {/* opacity-70 put the count at 3.97:1 on white — it reads as a
                    dimmed detail but it is the number the reader is choosing
                    by, so it has to clear 4.5:1 like any other text. */}
                {f.label} {n > 0 && <span className="opacity-80">{toArabicDigits(n)}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-7">
        {/* Above the branch, not inside it.
            She used to be rendered in the `hits.length > 0` arm only, so the
            one moment a service call must not go quiet — the failed lookup —
            was the one moment she could not appear. Here she covers both
            outcomes and renders nothing on an empty box, because
            `answerParts` returns no parts for one. */}
        <ShouqAnswer parts={answer} />

        {!q.trim() ? (
          <section>
            {/* The second thing that happens: the visitor hits the search
                bar, and the page asks. It read «جرّب تدوّر عن» — a caption
                introducing the chips as examples — so the first move was
                the visitor's and the page only labelled it. As a question
                the chips become answers to it, which is what they are.

                Same words as the category band on the home page and the
                empty palette, on purpose: one question, asked at each of
                the three points where it can be answered.

                A step up from text-sm/ink-600 because the role changed. At
                caption weight a question reads as a footnote to the chips
                rather than the thing they answer. */}
            <h2 className="mb-3 text-base font-semibold text-ink-800">شنو تدوّر؟</h2>
            <ul className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => setQ(s)}
                    className="flex min-h-11 items-center rounded-full border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300 hover:text-sea-700"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : hits.length > 0 ? (
          /* Dimmed, not blanked, while the results are still for an older
             query than the box. Blanking would make every keystroke a flash
             of empty page; this says «catching up» quietly and keeps what is
             on screen readable, which is usually still the right answer. */
          <div className={settling ? "opacity-60 transition-opacity duration-150" : "transition-opacity duration-150"}>
            {/* Before the count, the map and the list, because it is the only
                thing on this page that finishes the errand. Everything under
                it is browsing. */}
            <SearchPlan
              places={hitPlaces}
              activeSlug={activeSlug}
              onActiveSlug={setActiveSlug}
            />
            {/* Not a live region any more: ShouqAnswer took the role, and it
                says what the top result IS rather than how many there are. */}
            <p className="mb-4 text-sm text-ink-500">
              {toArabicDigits(hits.length)} نتيجة
            </p>
            <SearchMap places={hitPlaces} active={activeSlug} onActive={setActiveSlug} />
            <SearchResults
              hits={hits}
              activeIndex={active}
              activeSlug={activeSlug}
              onActiveSlug={setActiveSlug}
              listboxId={LISTBOX_ID}
            />
          </div>
        ) : settling ? (
          /* Nothing yet for the newest query, but the older one is still being
             replaced — so this is «not finished», not «nothing there». The
             empty state below announces a dead end, and announcing one mid-word
             is the single most annoying thing a live search box can do. */
          null
        ) : (
          <div className="rounded-3xl border border-dashed border-line-strong bg-sand-100/70 py-16 text-center">
            <span
              aria-hidden="true"
              className="mx-auto grid size-16 place-items-center rounded-3xl bg-sand-100 text-sand-600"
            >
              <IconCompass className="size-9" />
            </span>
            <h2 className="mt-4 font-display text-xl font-semibold text-ink-900">
              ما لقينا شي عن «{q.trim()}»
            </h2>
            {/* The advice that used to sit here is شوق's now, in the block
                above — «قول لي الجو اللي تبيه»، which names what she can
                actually do instead of telling somebody their word was too
                long. What is left is the escape hatch. */}
            <Link
              href="/explore"
              className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800"
            >
              تصفّح الأماكن
            </Link>
          </div>
        )}
      </div>

    </div>
  );
}
