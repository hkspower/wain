"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ShouqCallButton from "@/components/ShouqCallButton";
import { FIND_DEFAULT, findGreeting, findMomentNow, type FindMoment } from "@/lib/find-moment";
import { msToNextKuwaitHour } from "@/lib/kuwait-time";
import { WAIN_AI_COPY, SALEM_NAME, SALEM_ROLE } from "@/lib/wain-ai";

/**
 * The moment the page is read in, kept current: set after mount (the HTML is
 * built at no hour — see find-moment.ts) and again at each Kuwait hour, so a
 * tab left open across six o'clock stops offering breakfast.
 */
function useFindMoment(): FindMoment {
  const [m, setM] = useState<FindMoment>(FIND_DEFAULT);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setM(findMomentNow());
      t = setTimeout(tick, msToNextKuwaitHour() + 1000);
    };
    tick();
    return () => clearTimeout(t);
  }, []);
  return m;
}

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
 * the text instead of the flat colour this used to be.
 *
 * Lighter since 1 October, on request («reduce tint and overlay and
 * shadow»): the scrims went from 40→75→90% to 10→40→65%, so the two faces
 * read as photographs rather than as shapes under a dark glass; the solid
 * patches behind «اتصال» and «اكتب», the red glow and red shimmer round the
 * call button and the amber glow under «أو» are gone. What carries the text
 * now is `text-on-photo` — a shadow on the letters, not a layer over the
 * picture — and the contrast was measured over the photo itself, not assumed. `object-position` is
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
  const moment = useFindMoment();

  return (
    <div className="relative" data-moment={moment.part}>
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
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-900/10 via-ink-900/40 to-ink-900/65"
        />
        <div className="relative isolate mx-auto flex max-w-sm flex-col items-center gap-4 text-center">
          {/* The shade is under the words only — an ellipse that fades to
              nothing well inside the photo — so the face and the sky keep
              their light. Measured: without it the headline sat at 1.4:1
              over the bright part of the picture. */}
          <span aria-hidden="true" className="pointer-events-none absolute -inset-x-12 -inset-y-10 -z-10 bg-[radial-gradient(closest-side,rgb(20_18_15/0.62),rgb(20_18_15/0.35)_60%,transparent)]" />
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
          <h2 className="text-on-photo animate-reveal-up font-display text-4xl font-bold text-sun-300 [animation-delay:180ms] sm:text-5xl">
            اتصال
          </h2>
          {/* text-pretty so the last line never strands one short word on its
              own — «وأدلّك.» was doing exactly that before this. */}
          <p className="text-on-photo animate-reveal-up text-pretty text-base leading-relaxed text-white [animation-delay:280ms]">
            {findGreeting(WAIN_AI_COPY.name, moment)}
          </p>
          <div className="animate-reveal-up mt-1 flex flex-col items-center gap-2 [animation-delay:380ms]">
            <ShouqCallButton size="lg" onTapped={() => router.push("/search")} />
            {/* White with text-on-photo: sand-200 was chosen against the old
                dark scrim and the lighter one leaves it too little contrast. */}
            <span className="text-on-photo text-sm font-semibold text-white">{WAIN_AI_COPY.callHint}</span>
          </div>
        </div>
      </section>

      {/* The seam badge. Positioned at the WRAPPER's own vertical centre
          rather than at the cut's exact pixel offset above — both halves
          are the same `min-h-[50vh]`, so the two are the same value to a
          few pixels, and centring on the wrapper means this never has to
          be re-tuned if the cut's own depth changes. `animate-badge-pop` is
          what /find's old seam pill used before it was removed (see
          page.tsx's comment). aria-hidden for
          the same reason the pill was: the two halves already say what
          they are, this only echoes the seam between them. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 justify-center"
      >
        <span className="animate-badge-pop grid size-11 place-items-center rounded-full bg-white text-sm font-bold text-ink-900 ring-1 ring-ink-900/10">
          أو
        </span>
      </div>

      {/* ---------- سالم: the chat ---------- */}
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
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sea-950/10 via-sea-950/40 to-sea-950/65"
        />
        <div className="relative isolate mx-auto flex max-w-sm flex-col items-center gap-4 text-center">
          <span aria-hidden="true" className="pointer-events-none absolute -inset-x-12 -inset-y-10 -z-10 bg-[radial-gradient(closest-side,rgb(19_44_66/0.62),rgb(19_44_66/0.35)_60%,transparent)]" />
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
          <h2 className="text-on-photo animate-reveal-up font-display text-4xl font-bold text-sea-300 [animation-delay:580ms] sm:text-5xl">
            اكتب
          </h2>
          {/* The call half's own sentence with only his name changed — see
              SALEM_GREETING's comment in wain-ai.ts for why that is the only
              word that moves — and the same moment as hers above. */}
          <p className="text-on-photo animate-reveal-up text-pretty text-base leading-relaxed text-white [animation-delay:780ms]">
            {findGreeting(SALEM_NAME, moment)}
          </p>
          <Link
            href="/salem"
            className="animate-reveal-up mt-1 inline-flex min-h-6 items-center gap-2 rounded-full bg-sea-600 px-6 font-display font-semibold text-white transition hover:bg-sea-700 [animation-delay:880ms]"
          >
            ابدأ الكتابة
          </Link>
          {/* Matching the call half's own hint under its button — that one
              always had a line here and this one never did, which read as
              the two halves getting a different amount of care. */}
          <span className="text-on-photo animate-reveal-up text-sm font-semibold text-white [animation-delay:960ms]">
            {WAIN_AI_COPY.typeHint}
          </span>
        </div>
      </section>
    </div>
  );
}
