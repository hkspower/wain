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
 *
 * Both halves are full-bleed AI-illustrated portraits now (public/find/),
 * matching the design exploration — a bottom-weighted scrim carries the
 * text instead of the flat colour this used to be. `object-position` is
 * tuned per breakpoint because the mobile crop (tall, narrow) and the
 * desktop crop (short, wide) need different framing of the same photo to
 * keep the subject in frame — see the object-[…] classes below.
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
        className="relative flex min-h-[50vh] items-center justify-center overflow-hidden bg-ink-900 px-4 pb-20 pt-10 sm:pb-24 sm:pt-14"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimiser */}
        <img
          src="/find/shouq.jpg"
          alt=""
          aria-hidden="true"
          width={1280}
          height={720}
          loading="eager"
          decoding="async"
          className="animate-kb-a absolute inset-0 size-full object-cover object-[34%_20%] sm:object-[12%_40%]"
        />
        {/* Bottom-weighted so the photo still reads at the top; the content
            stack sits vertically centered, which is already inside the
            strong part of this gradient. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-900/40 via-ink-900/75 to-ink-900/90"
        />
        <div className="relative mx-auto flex max-w-sm flex-col items-center gap-4 text-center">
          {/* A pill, not bare text — bare text at this weight read as loose
              on the gradient, one more label floating with nothing to hold
              it. The pill vocabulary is already the site's own (the tag
              chips, the category rail's counts). The equalizer beside it
              names her as a VOICE the same way the kicker's words do. */}
          <span className="animate-reveal-up inline-flex items-center gap-2 rounded-full bg-white/90 px-3.5 py-1.5 text-sm font-semibold text-sun-900 shadow-sm [animation-delay:80ms]">
            {WAIN_AI_COPY.role}
            <span aria-hidden="true" className="inline-flex h-3.5 items-end gap-[3px] text-sun-600">
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "0.9s" }} />
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "1.25s", animationDelay: "-0.4s" }} />
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "0.7s", animationDelay: "-0.1s" }} />
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "1.1s", animationDelay: "-0.7s" }} />
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "0.8s", animationDelay: "-0.3s" }} />
            </span>
          </span>
          <h2 className="animate-reveal-up font-display text-4xl font-bold text-white [animation-delay:180ms] sm:text-5xl">
            كلّم{" "}
            <span className="relative isolate inline-block px-1.5 text-sun-300">
              <i aria-hidden="true" className="absolute -inset-y-2 inset-x-0 -z-10 rounded-lg bg-ink-900" />
              {WAIN_AI_COPY.name}
            </span>
          </h2>
          {/* text-pretty so the last line never strands one short word on its
              own — «وأدلّك.» was doing exactly that before this. */}
          <p className="animate-reveal-up text-pretty text-base leading-relaxed text-sand-100 [animation-delay:280ms]">
            {WAIN_AI_COPY.greeting}
          </p>
          <div className="animate-reveal-up mt-1 flex flex-col items-center gap-2 [animation-delay:380ms]">
            <ShouqCallButton size="lg" className="bg-white shadow-md" onTapped={() => router.push("/search")} />
            {/* sand-200 over the photo — ink-700 (the flat-background value)
                was unreadable against the scrim. */}
            <span className="text-sm font-semibold text-sand-200">{WAIN_AI_COPY.callHint}</span>
          </div>
        </div>
      </section>

      {/* ---------- seam: one question over both halves ----------
          The page's real heading is the sr-only <h1> in page.tsx, read
          first regardless of where this sits visually — this pill is a
          decorative echo of it, so it carries no heading role and is
          hidden from the accessibility tree rather than read twice. */}
      <div aria-hidden="true" className="relative z-10 flex justify-center">
        {/* A warm+cool glow breathing behind the pill, tying the two photo
            halves together — it floats over both, so it needs its own
            light source rather than borrowing either half's. */}
        <span className="animate-seam-glow pointer-events-none absolute size-64 -translate-y-1 rounded-full bg-[radial-gradient(closest-side,rgba(252,203,77,.65),rgba(49,148,209,.45),transparent_100%)] blur-2xl" />
        {/* relative: an absolutely-positioned sibling paints above a static
            one regardless of DOM order, so without this the glow above
            covered the pill instead of sitting behind it. */}
        <span className="animate-badge-pop relative -mt-6 inline-flex items-center gap-2 rounded-full border-2 border-ink-900 bg-white px-5 py-2.5 font-display text-base font-bold text-ink-900 shadow-lg sm:-mt-7 sm:px-6 sm:py-3 sm:text-lg">
          كيف تبي تدوّر؟
        </span>
      </div>

      {/* ---------- اكتب: the box ---------- */}
      <section
        aria-label="اكتب"
        className="relative flex min-h-[50vh] items-center justify-center overflow-hidden bg-sea-950 px-4 pb-14 pt-20 text-white sm:pb-16 sm:pt-24"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimiser */}
        <img
          src="/find/salem.jpg"
          alt=""
          aria-hidden="true"
          width={1280}
          height={720}
          loading="lazy"
          decoding="async"
          className="animate-kb-b absolute inset-0 size-full object-cover object-[70%_18%] sm:object-[82%_45%]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sea-950/40 via-sea-950/78 to-sea-950/92"
        />
        <div className="relative mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <span className="animate-reveal-up text-sm font-semibold text-sea-200 [animation-delay:580ms]">
            بالكتابة
          </span>
          <h2 className="animate-reveal-up font-display text-4xl font-bold text-white [animation-delay:680ms] sm:text-5xl">
            اكتب
          </h2>
          <p className="animate-reveal-up text-base leading-relaxed text-sand-100 [animation-delay:780ms]">
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
            {/* relative + overflow-hidden so the shimmer span clips to the
                pill instead of spilling a square corona past its curve. */}
            <button
              type="submit"
              className="animate-cta-breathe relative isolate inline-flex min-h-6 items-center gap-2 overflow-hidden rounded-full bg-sea-600 px-6 font-display font-semibold text-white transition hover:bg-sea-700"
            >
              <span
                aria-hidden="true"
                className="animate-shimmer pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,.5)_50%,transparent_65%)] bg-[length:250%_100%]"
              />
              <IconSearch className="relative z-10 size-5" />
              <span className="relative z-10">ابحث</span>
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
