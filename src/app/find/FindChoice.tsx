"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import ShouqCallButton from "@/components/ShouqCallButton";
import { SALEM_AI_COPY, WAIN_AI_COPY } from "@/lib/wain-ai";

/**
 * The two ways to say what you want — one call, one chat — drawn full-bleed,
 * شوق's half over سالم's, rather than two cards in a page.
 *
 * This used to be the dial's own in-place panel: tap «إلى وين؟», get the
 * five nearest places, ranked live against a GPS fix taken in the same
 * gesture. That panel is gone — this page replaces it, on request, so a tap
 * on the dial now asks HOW you want to look before showing you anything,
 * rather than assuming "nearest" is always the question. /search still
 * answers the "nearest" case (شوق can ask where you are; nothing here
 * requests location any more).
 *
 * The lower half used to be a plain «اكتب» typing box, and سالم was
 * deliberately left off it — a design canvas had explored him as a second
 * character and this repository ruled that out, reasoning that a second full
 * agent was a disproportionate answer to one voice option. That decision was
 * reversed on request: this half is now سالم's own card, matching شوق's
 * structure exactly, leading to `/salem` — his own typed-chat page (see the
 * note over `SALEM_VOICE_ID` in `lib/wain-ai.ts` for what actually changed
 * under the hood, which is less than "a second agent" sounds like). The
 * plain "type a place name" box this replaced is not lost to the site — the
 * search button in the bottom rail and /search's own box are one tap away
 * from every page, including this one.
 *
 * Both halves are full-bleed AI-illustrated portraits (public/find/),
 * matching the design exploration — a bottom-weighted scrim carries the
 * text instead of the flat colour this used to be. `object-position` is
 * tuned per breakpoint because the mobile crop (tall, narrow) and the
 * desktop crop (short, wide) need different framing of the same photo to
 * keep the subject in frame — see the object-[…] classes below.
 */
export default function FindChoice() {
  const router = useRouter();

  return (
    <div className="relative">
      {/* ---------- شوق: the call ---------- */}
      <section
        aria-label="اتصال"
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
          {/* «اتصال» rather than «كلّم شوق» — her name and role are already
              said, by the pill above and the greeting below; this is now a
              short label naming what the button DOES (place a call), the
              same register a phone app's own call screen uses, not a second
              sentence repeating what the section is already labelled. */}
          <h2 className="animate-reveal-up font-display text-4xl font-bold text-white [animation-delay:180ms] sm:text-5xl">
            <span className="relative isolate inline-block px-1.5 text-sun-300">
              <i aria-hidden="true" className="absolute -inset-y-2 inset-x-0 -z-10 rounded-lg bg-ink-900" />
              اتصال
            </span>
          </h2>
          {/* text-pretty so the last line never strands one short word on its
              own — «وأدلّك.» was doing exactly that before this. */}
          <p className="animate-reveal-up text-pretty text-base leading-relaxed text-sand-100 [animation-delay:280ms]">
            {WAIN_AI_COPY.greeting}
          </p>
          <div className="animate-reveal-up mt-1 flex flex-col items-center gap-2 [animation-delay:380ms]">
            {/* isolate: an ambient ring around the button and a shimmer
                across its face, both added here rather than inside
                ShouqCallButton itself — that component is shared across the
                whole site (search box, ⌘K palette, …) and its own ringing
                state already owns `absolute inset-0`; a second, unrelated
                animation belongs on this one standalone use, not baked into
                every size-8 instance elsewhere. `-z-10` on the glow and
                z-index:auto on the shimmer both paint correctly around the
                button without touching its own className logic — see the
                stacking-order note the seam badge's glow needed above for
                why plain sibling order does not decide this on its own. */}
            <div className="relative isolate inline-flex">
              {/* The glow ring extends past the button's own edge, so it
                  needs an UNCLIPPED wrapper of its own — the shimmer below
                  is the opposite, it must not spill past the circle, so
                  it gets a second, inner, clipped one. Same div for both
                  would force one of the two to look wrong. */}
              <span
                aria-hidden="true"
                className="animate-seam-glow pointer-events-none absolute -inset-3 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(220,47,37,.5),transparent_75%)] blur-lg"
              />
              <div className="relative isolate inline-flex overflow-hidden rounded-full">
                <ShouqCallButton size="lg" onTapped={() => router.push("/search")} />
                <span
                  aria-hidden="true"
                  className="animate-shimmer pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(115deg,transparent_35%,rgba(220,47,37,.22)_50%,transparent_65%)] bg-[length:250%_100%]"
                />
              </div>
            </div>
            {/* sand-200 over the photo — ink-700 (the flat-background value)
                was unreadable against the scrim. */}
            <span className="text-sm font-semibold text-sand-200">{WAIN_AI_COPY.callHint}</span>
          </div>
        </div>
      </section>

      {/* ---------- سالم: the chat ---------- */}
      <section
        aria-label="اكتب لسالم"
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
        <div className="relative mx-auto flex max-w-sm flex-col items-center gap-4 text-center">
          <span className="animate-reveal-up inline-flex items-center gap-2 rounded-full bg-white/90 px-3.5 py-1.5 text-sm font-semibold text-sea-900 shadow-sm [animation-delay:580ms]">
            {SALEM_AI_COPY.role}
          </span>
          <h2 className="animate-reveal-up font-display text-4xl font-bold text-white [animation-delay:680ms] sm:text-5xl">
            اكتب لـ
            <span className="relative isolate inline-block px-1.5 text-sea-300">
              <i aria-hidden="true" className="absolute -inset-y-2 inset-x-0 -z-10 rounded-lg bg-sea-950" />
              {SALEM_AI_COPY.name}
            </span>
          </h2>
          <p className="animate-reveal-up text-pretty text-base leading-relaxed text-sand-100 [animation-delay:780ms]">
            {SALEM_AI_COPY.greeting}
          </p>
          <Link
            href="/salem"
            className="animate-cta-breathe animate-reveal-up relative isolate mt-1 inline-flex min-h-6 items-center gap-2 overflow-hidden rounded-full bg-sea-600 px-6 font-display font-semibold text-white transition hover:bg-sea-700 [animation-delay:880ms]"
          >
            <span
              aria-hidden="true"
              className="animate-shimmer pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,.5)_50%,transparent_65%)] bg-[length:250%_100%]"
            />
            <span className="relative z-10">{SALEM_AI_COPY.cta}</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
