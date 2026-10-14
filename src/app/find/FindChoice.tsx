"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ShouqCallButton from "@/components/ShouqCallButton";
import { IconSend } from "@/components/icons";
import { FIND_DEFAULT, findGreeting, findMomentNow, type FindMoment } from "@/lib/find-moment";
import { msToNextKuwaitHour } from "@/lib/kuwait-time";
import { WAIN_AI_COPY, SALEM_NAME } from "@/lib/wain-ai";

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
 * The lower half is سالم's own card: his name and his portrait, and the typed
 * chat behind it is his agent too (`SALEM_AGENT_ID`). The upper half calls شوق
 * on her own agent. The two halves never share an agent, a voice or a name.
 * Until 14 October the lower half named him over her agent, which is the mix
 * the owner asked to end.
 */
export default function FindChoice() {
  const router = useRouter();
  const moment = useFindMoment();

  return (
    // data-dark-end: the page ends on سالم's dark half, and globals.css paints
    // what lies below it — the home-indicator strip, the rubber band — dark too.
    <div className="relative" data-moment={moment.part} data-dark-end="">
      {/* ---------- شوق: the call ---------- */}
      {/* A phone, and one button on it — on request, 2 October («one call
          icon, big, at the centre, a big mobile with "call"»; the design is
          the canvas «وين — مكالمة شوق الكبيرة»). It replaced her full-bleed
          photo with a scrim and a small round portrait button: a page whose
          one job is to place a call should look like the screen you place a
          call from. Her photo moved onto the phone's screen, so the button
          can be what every phone's call button is — green, round, a handset
          — and «اتصال» sits under it as the label it is.

          The phone is markup, not a picture: no new asset to ship or cache,
          and the button inside it is the real ShouqCallButton (the gesture
          has to reach primeAudio — see that component). Light ground, so the
          seam into سالم's dark half below is the one strong edge. */}
      <section
        aria-label="اتصال"
        className="relative flex flex-col items-center gap-4 overflow-hidden bg-sun-50 px-4 pb-24 pt-8 text-center [clip-path:polygon(0_0,100%_0,100%_calc(100%_-_40px),0_100%)] sm:gap-5 sm:pb-28 sm:pt-12"
      >
        <span className="animate-reveal-up inline-flex items-center gap-2 rounded-full bg-sun-100 px-3.5 py-1.5 text-sm font-semibold text-sun-900 [animation-delay:80ms]">
          {WAIN_AI_COPY.role}
        </span>
        <h2 className="animate-reveal-up font-display text-3xl font-bold text-ink-900 [animation-delay:160ms] sm:text-4xl">
          كلّم {WAIN_AI_COPY.name}
        </h2>

        {/* The handset. Fixed proportions (a phone is ~1:2) and a size that
            leaves the greeting and the seam on a 568px screen. */}
        <div
          data-phone=""
          className="animate-reveal-up w-56 rounded-[2.75rem] bg-ink-900 p-3 shadow-xl shadow-ink-900/25 [animation-delay:240ms] sm:w-64"
        >
          <div className="flex aspect-[9/17] flex-col items-center gap-2 rounded-[2.1rem] bg-white px-4 pb-6 pt-3.5">
            <span aria-hidden="true" className="h-5 w-[4.5rem] rounded-full bg-ink-900" />
            {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimiser */}
            <img
              src="/find/shouq-face.jpg"
              alt=""
              aria-hidden="true"
              width={320}
              height={320}
              loading="eager"
              decoding="async"
              className="mt-4 size-24 rounded-full object-cover sm:size-28"
            />
            <span className="font-display text-2xl font-bold text-ink-900">{WAIN_AI_COPY.name}</span>
            <span className="text-sm text-ink-600">{WAIN_AI_COPY.phoneLine}</span>
            <span className="flex-1" />
            <ShouqCallButton size="call" onTapped={() => router.push("/search")} />
            <span aria-hidden="true" className="font-display text-xl font-bold text-palm-700">
              اتصال
            </span>
          </div>
        </div>

        {/* The first paragraph of this half is the greeting — find.test reads
            it as such — and it says what the call is for, at this hour. */}
        <p className="animate-reveal-up max-w-xs text-pretty text-base leading-relaxed text-ink-700 [animation-delay:320ms]">
          {findGreeting(WAIN_AI_COPY.name, moment)}
        </p>
      </section>

      {/* The seam badge, on the seam itself: the call half is no longer a
          fixed 50vh, so «the wrapper's middle» stopped being the seam. It
          sits where سالم's half starts, pulled up by half its own height
          plus the 20px midpoint of the diagonal overlap. */}
      <div aria-hidden="true" className="pointer-events-none relative z-20 flex h-0 justify-center">
        <span className="animate-badge-pop grid size-11 shrink-0 -translate-y-[calc(50%+20px)] place-items-center rounded-full bg-white text-sm font-bold text-ink-900 ring-1 ring-ink-900/10">
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
          <span aria-hidden="true" className="pointer-events-none absolute -inset-x-12 -inset-y-10 -z-10 bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--color-sea-950)_62%,transparent),color-mix(in_srgb,var(--color-sea-950)_35%,transparent)_60%,transparent)]" />
          {/* No role pill on this half any more (7 October, on request): the
              heading names him now, which is what the pill was there to do,
              and two «دليلك/دليلتك في الكويت» pills a screen apart read as a
              repeat rather than as two people. */}
          <h2 className="text-on-photo animate-reveal-up font-display text-4xl font-bold text-sea-300 [animation-delay:580ms] sm:text-5xl">
            {/* One string, not «ل» then {SALEM_NAME}: that made two text
                nodes, and Safari shapes each text node on its own, so the ل
                stood unjoined in front of سالم — «اكتب ل سالم» at 48px
                (8 October; 26px wider in WebKit than the joined word). */}
            {`اكتب ل${SALEM_NAME}`}
          </h2>
          {/* The call half's own sentence with only his name changed — see
              SALEM_GREETING's comment in wain-ai.ts for why that is the only
              word that moves — and the same moment as hers above. */}
          <p className="text-on-photo animate-reveal-up text-pretty text-base leading-relaxed text-white [animation-delay:780ms]">
            {findGreeting(SALEM_NAME, moment)}
          </p>
          {/* A real button, the weight of the green call above: it was a
              26px pill that read as a label (7 October). */}
          <Link
            href="/salem"
            className="animate-reveal-up mt-1 inline-flex min-h-12 items-center gap-2 rounded-full bg-sea-600 px-8 font-display text-lg font-semibold text-white shadow-md transition hover:bg-sea-700 active:scale-95 [animation-delay:880ms]"
          >
            <IconSend className="size-5" aria-hidden="true" />
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
