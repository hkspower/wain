"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import ShouqCallButton from "@/components/ShouqCallButton";
import { WAIN_AI_COPY, SALEM_ROLE, SALEM_GREETING } from "@/lib/wain-ai";

/**
 * The two ways to reach the two of them — a call to شوق, a chat with سالم —
 * drawn full-bleed, one half over the other, rather than two cards in a page.
 *
 * This used to be the dial's own in-place panel: tap «إلى وين؟», get the
 * five nearest places, ranked live against a GPS fix taken in the same
 * gesture. That panel is gone — this page replaces it, on request, so a tap
 * on the dial now asks HOW you want to look before showing you anything,
 * rather than assuming "nearest" is always the question. /search still
 * answers the "nearest" case (شوق can ask where you are; nothing here
 * requests location any more).
 *
 * The lower half's identity has moved three times, and it is worth reading
 * all three before touching it a fourth. It shipped as a full سالم persona —
 * his name, his photo, his greeting, his voice — over an agent whose prompt
 * never changed to back it, which `SALEM_VOICE_ID`'s own comment in
 * `lib/wain-ai.ts` calls out as the actual defect. Corrected to name شوق
 * instead, plainly, same character as the call half above it. Reversed again
 * on request, 30 September, that history read first: this half is his once
 * more — `SALEM_NAME`, his own regenerated portrait (the originals were
 * deleted along with the second correction), his own voice reinstated in
 * `lib/salem-chat.ts`. What is different this time is that it is not the
 * SAME mistake repeated — the agent behind `/salem` is still شوق's, and
 * nothing here claims otherwise; it is a deliberate choice to show his
 * identity on the INVITATION while the live conversation behind it still
 * answers as her, first message included. See `SALEM_VOICE_ID`'s comment for
 * the full account of that tension and why it was accepted rather than
 * solved. The plain "type a place name" box either version replaced is not
 * lost to the site — the search button in the bottom rail and /search's own
 * box are one tap away from every page, including this one.
 *
 * Both halves are full-bleed AI-illustrated portraits (public/find/) of the
 * character each half actually leads to — a bottom-weighted scrim carries
 * the text instead of the flat colour this used to be. `object-position` is
 * tuned per breakpoint because the mobile crop (tall, narrow) and the
 * desktop crop (short, wide) need different framing of the same photo to
 * keep the subject in frame — see the object-[…] classes below.
 *
 * The boundary between them is a diagonal cut, not a flat line — a
 * `clip-path` on each section's own bottom/top edge, the bottom half pulled
 * up under the top half's cut by the same distance the cut is deep, so the
 * two edges interlock rather than leaving a gap. A pixel value rather than a
 * percentage: a percentage cut gets shallower or steeper as `min-h-[50vh]`
 * changes with the viewport, and a fixed depth reads the same everywhere.
 * The «أو» badge floats on that seam — see its own comment below for why it
 * is positioned by the wrapper's own half rather than by the cut's exact
 * pixel offset.
 */
export default function FindChoice() {
  const router = useRouter();

  return (
    <div className="relative">
      {/* ---------- شوق: the call ---------- */}
      <section
        aria-label="اتصال"
        className="relative flex min-h-[50vh] items-center justify-center overflow-hidden bg-ink-900 px-4 pb-20 pt-10 [clip-path:polygon(0_0,100%_0,100%_calc(100%_-_40px),0_100%)] sm:pb-24 sm:pt-14"
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
          <span className="animate-reveal-up inline-flex items-center gap-2 rounded-full bg-white/90 px-3.5 py-1.5 text-sm font-semibold text-sun-900 [animation-delay:80ms]">
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

      {/* The seam badge. Positioned at the WRAPPER's own vertical centre
          rather than at the cut's exact pixel offset above — both halves
          are the same `min-h-[50vh]`, so the two are the same value to a
          few pixels, and centring on the wrapper means this never has to
          be re-tuned if the cut's own depth changes. `animate-badge-pop`
          and the glow beneath it are not new: they are what /find's old
          seam pill used before it was removed (see page.tsx's comment) —
          dead CSS with exactly the right shape for a second decorative
          element on this same seam, not reinvented here. aria-hidden for
          the same reason the pill was: the two halves already say what
          they are, this only echoes the seam between them. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 justify-center"
      >
        <span className="animate-badge-pop relative isolate grid size-11 place-items-center rounded-full bg-white text-sm font-bold text-ink-900 shadow-xs">
          <span
            aria-hidden="true"
            className="animate-seam-glow pointer-events-none absolute -inset-3 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(251,183,36,.5),transparent_75%)] blur-lg"
          />
          أو
        </span>
      </div>

      {/* ---------- شوق: the chat ---------- */}
      <section
        aria-label="اكتب"
        className="relative -mt-10 flex min-h-[50vh] items-center justify-center overflow-hidden bg-sea-950 px-4 pb-14 pt-20 text-white [clip-path:polygon(0_40px,100%_0,100%_100%,0_100%)] sm:pb-16 sm:pt-24"
      >
        {/* His own photo, his own generation — not a reused crop of hers.
            See the header comment above for why this half is his again. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimiser */}
        <img
          src="/find/salem.jpg"
          alt=""
          aria-hidden="true"
          width={1280}
          height={720}
          loading="lazy"
          decoding="async"
          className="animate-kb-b absolute inset-0 size-full object-cover object-[28%_22%] sm:object-[18%_38%]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sea-950/40 via-sea-950/78 to-sea-950/92"
        />
        <div className="relative mx-auto flex max-w-sm flex-col items-center gap-4 text-center">
          {/* A pill again, matching the call half's exactly — kicker text,
              equalizer, same markup, only `SALEM_ROLE` in place of
              `WAIN_AI_COPY.role`. It went missing when this half stopped
              being a distinct character (a pill naming a voice-swap badge
              with nothing else to say), but now that the two halves lead to
              two different names, this is what actually establishes his —
              the heading below never states a name, on either half; it
              always relied on the pill and the greeting to do that. Without
              this, «اكتب» + a photo said nothing a reader could call سالم. */}
          <span className="animate-reveal-up inline-flex items-center gap-2 rounded-full bg-white/90 px-3.5 py-1.5 text-sm font-semibold text-sea-900 [animation-delay:480ms]">
            {SALEM_ROLE}
            <span aria-hidden="true" className="inline-flex h-3.5 items-end gap-[3px] text-sea-600">
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "0.9s" }} />
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "1.25s", animationDelay: "-0.4s" }} />
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "0.7s", animationDelay: "-0.1s" }} />
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "1.1s", animationDelay: "-0.7s" }} />
              <i className="eq-bar w-[3px] rounded-full bg-current" style={{ height: "100%", animationDuration: "0.8s", animationDelay: "-0.3s" }} />
            </span>
          </span>
          <h2 className="animate-reveal-up font-display text-4xl font-bold text-white [animation-delay:580ms] sm:text-5xl">
            <span className="relative isolate inline-block px-1.5 text-sea-300">
              <i aria-hidden="true" className="absolute -inset-y-2 inset-x-0 -z-10 rounded-lg bg-sea-950" />
              اكتب
            </span>
          </h2>
          {/* SALEM_GREETING — the call half's own sentence with only his
              name at the front changed; see its comment in wain-ai.ts for
              why that word is the only one that needed to move. */}
          <p className="animate-reveal-up text-pretty text-base leading-relaxed text-sand-100 [animation-delay:780ms]">
            {SALEM_GREETING}
          </p>
          <Link
            href="/salem"
            className="animate-cta-breathe animate-reveal-up relative isolate mt-1 inline-flex min-h-6 items-center gap-2 overflow-hidden rounded-full bg-sea-600 px-6 font-display font-semibold text-white transition hover:bg-sea-700 [animation-delay:880ms]"
          >
            <span
              aria-hidden="true"
              className="animate-shimmer pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,.5)_50%,transparent_65%)] bg-[length:250%_100%]"
            />
            <span className="relative z-10">ابدأ الكتابة</span>
          </Link>
          {/* Matching the call half's own hint under its button — that one
              always had a line here and this one never did, which read as
              the two halves getting a different amount of care. */}
          <span className="animate-reveal-up text-sm font-semibold text-sand-200 [animation-delay:960ms]">
            {WAIN_AI_COPY.typeHint}
          </span>
        </div>
      </section>
    </div>
  );
}
