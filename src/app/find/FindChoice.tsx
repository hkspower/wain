"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ShouqCallButton from "@/components/ShouqCallButton";
import { IconSearch } from "@/components/icons";
import { WAIN_AI_COPY } from "@/lib/wain-ai";

/**
 * The two ways to say what you want — one call, one box — drawn full-bleed,
 * شوق's half over the typing half, rather than two cards in a page.
 *
 * This used to be the dial's own in-place panel: tap «إلى وين؟», get the
 * five nearest places, ranked live against a GPS fix taken in the same
 * gesture. That panel is gone — this page replaces it, on request, so a tap
 * on the dial now asks HOW you want to look before showing you anything,
 * rather than assuming "nearest" is always the question. /search still
 * answers the "nearest" case (شوق can ask where you are; nothing here
 * requests location any more).
 *
 * The lower half is labelled «اكتب», not «سالم» — asked and confirmed the
 * same session this went from two plain cards to this fuller page. سالم is
 * a mid-call voice swap (`WainAiCall`'s «بصوت سالم» button), not a second
 * persona to put up front: naming him here would promise a different
 * assistant when it is the same one, in a different voice, one tap deeper.
 * A visual design explored him as a second character; the product decision
 * that ruled that out stands regardless of what a mockup drew.
 */
export default function FindChoice() {
  const router = useRouter();
  const [q, setQ] = useState("");

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = q.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
  }

  return (
    <div className="relative">
      {/* ---------- شوق: the call ---------- */}
      <section
        aria-label="كلّم شوق"
        className="relative flex min-h-[50vh] items-center justify-center overflow-hidden bg-gradient-to-b from-sun-100 to-sand-50 px-4 pb-20 pt-10 sm:pb-24 sm:pt-14"
      >
        {/* A glow, not a photo to pan across — see the comment over
            glow-drift-a in globals.css for why this is the live page's
            version of the camera drift a design exploration of this page
            used on a portrait. */}
        <div
          aria-hidden="true"
          className="animate-glow-drift-a pointer-events-none absolute start-1/2 top-1/3 size-[26rem] -translate-x-1/2 rounded-full bg-sun-300/40 blur-3xl"
        />
        <div className="relative mx-auto flex max-w-sm flex-col items-center gap-4 text-center">
          {/* A pill, not bare text — bare text at this weight read as loose
              on the gradient, one more label floating with nothing to hold
              it. The pill vocabulary is already the site's own (the tag
              chips, the category rail's counts). The equalizer beside it
              names her as a VOICE the same way the kicker's words do. */}
          <span className="animate-reveal-up inline-flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-1.5 text-sm font-semibold text-sun-900 shadow-sm [animation-delay:80ms]">
            {WAIN_AI_COPY.role}
            <span aria-hidden="true" className="inline-flex h-3.5 items-end gap-[3px] text-sun-600">
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "0.9s" }} />
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "1.25s", animationDelay: "-0.4s" }} />
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "0.7s", animationDelay: "-0.1s" }} />
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "1.1s", animationDelay: "-0.7s" }} />
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "0.8s", animationDelay: "-0.3s" }} />
            </span>
          </span>
          <h2 className="animate-reveal-up font-display text-4xl font-bold text-ink-900 [animation-delay:180ms] sm:text-5xl">
            كلّم {WAIN_AI_COPY.name}
          </h2>
          {/* text-pretty so the last line never strands one short word on its
              own — «وأدلّك.» was doing exactly that before this. */}
          <p className="animate-reveal-up text-pretty text-base leading-relaxed text-ink-600 [animation-delay:280ms]">
            {WAIN_AI_COPY.greeting}
          </p>
          <div className="animate-reveal-up mt-1 flex flex-col items-center gap-2 [animation-delay:380ms]">
            <ShouqCallButton size="lg" className="bg-white shadow-md" onTapped={() => router.push("/search")} />
            {/* ink-700, matching SearchHub's identical call-hint span —
                ink-500 was a shade lighter than the site's own convention
                for this exact role. */}
            <span className="text-sm font-semibold text-ink-700">{WAIN_AI_COPY.callHint}</span>
          </div>
        </div>
      </section>

      {/* ---------- seam: one question over both halves ----------
          The page's real heading is the sr-only <h1> in page.tsx, read
          first regardless of where this sits visually — this pill is a
          decorative echo of it, so it carries no heading role and is
          hidden from the accessibility tree rather than read twice. */}
      <div aria-hidden="true" className="relative z-10 flex justify-center">
        <span className="animate-badge-pop -mt-6 inline-flex items-center gap-2 rounded-full border-2 border-ink-900 bg-white px-5 py-2.5 font-display text-base font-bold text-ink-900 shadow-lg sm:-mt-7 sm:px-6 sm:py-3 sm:text-lg">
          كيف تبي تدوّر؟
        </span>
      </div>

      {/* ---------- اكتب: the box ---------- */}
      <section
        aria-label="اكتب"
        className="relative flex min-h-[50vh] items-center justify-center overflow-hidden bg-sea-950 px-4 pb-14 pt-20 text-white sm:pb-16 sm:pt-24"
      >
        <div
          aria-hidden="true"
          className="animate-glow-drift-b pointer-events-none absolute bottom-1/4 end-1/2 size-[26rem] translate-x-1/2 rounded-full bg-sea-500/30 blur-3xl"
        />
        <div className="relative mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <span className="animate-reveal-up text-sm font-semibold text-sea-300 [animation-delay:580ms]">
            بالكتابة
          </span>
          <h2 className="animate-reveal-up font-display text-4xl font-bold text-white [animation-delay:680ms] sm:text-5xl">
            اكتب
          </h2>
          <p className="animate-reveal-up text-base leading-relaxed text-sea-100 [animation-delay:780ms]">
            دوّر باسم المكان أو المنطقة — يطلع لك اللي تبيه على الخريطة وبالقائمة.
          </p>
          <form onSubmit={submitSearch} className="animate-reveal-up mt-1 flex w-full items-stretch gap-2 [animation-delay:880ms]">
            <label htmlFor="find-q" className="sr-only">
              دوّر باسم المكان أو المنطقة
            </label>
            <input
              id="find-q"
              name="q"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="دوّر باسم المكان…"
              className="h-14 min-w-0 flex-1 rounded-full bg-white px-5 text-base text-ink-900 placeholder:text-ink-400"
            />
            <button
              type="submit"
              className="animate-cta-breathe inline-flex min-h-6 items-center gap-2 rounded-full bg-sea-600 px-6 font-display font-semibold text-white transition hover:bg-sea-700"
            >
              <IconSearch className="size-5" />
              ابحث
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
