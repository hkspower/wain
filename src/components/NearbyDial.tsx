import Link from "next/link";

/**
 * The home page's dial. It used to open an in-place panel here — the five
 * nearest places, ranked live against a GPS fix taken in the same tap — and
 * that made it a genuinely client-only component: ranking against a live
 * position cannot be done at build time, so it carried the whole 52-place
 * catalogue into the home page's JavaScript.
 *
 * Now it is one navigation, to `/find`, which asks how you want to search
 * before showing you anything — see `FindChoice` for why that replaced the
 * panel. Nothing here reads a GPS fix or the catalogue any more, so this
 * needs no "use client" and no import from `@/lib/places`: it is a link,
 * server-rendered, and the home page's client bundle is lighter for it.
 *
 * Its size is `--dial`, set by the hero section (18rem when nothing sets it).
 * It used to be a fixed `size-72` at every width, which is the root of the
 * hero's worst defect: the drawing behind it scales with the viewport and the
 * dial does not, so from 640 to 1280px it lay over the mosque dome and the
 * Kuwait Towers' spheres (and the flag up to 1100px). The section now grows
 * the dial with the screen and derives its own height from it — see the
 * comment over the hero in `app/page.tsx` and `scripts/audit-home-hero.mjs`,
 * which measures it.
 */
export default function NearbyDial() {
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-sun-300/60 animate-pulse-ring"
        />
        <span aria-hidden="true" className="absolute -inset-px rounded-full ring-1 ring-sun-400/70" />
        {/* compass tick ring */}
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          className="pointer-events-none absolute -inset-4 size-[calc(100%+2rem)]"
        >
          {/* Two tones: the four compass points are the sun's strongest rays, the
              rest are half as loud. One colour at one opacity made all 36 the
              same weight, so the ring read as a dashed border, not a sun. */}
          {Array.from({ length: 36 }).map((_, i) => {
            const a = (i * 10 * Math.PI) / 180;
            const major = i % 9 === 0;
            const r1 = major ? 44.5 : 46.5;
            return (
              <line
                key={i}
                x1={50 + r1 * Math.cos(a)}
                y1={50 + r1 * Math.sin(a)}
                x2={50 + 48 * Math.cos(a)}
                y2={50 + 48 * Math.sin(a)}
                strokeWidth={major ? 1.6 : 0.9}
                strokeLinecap="round"
                className={major ? "stroke-sun-700/70" : "stroke-sun-500/55"}
              />
            );
          })}
        </svg>
        <Link
          href="/find"
          aria-label="إلى وين؟ — اكتب أو كلّم شوق"
          // The ambient glow underneath is amber, not the @theme shadow
          // scale's ink tint — an ink-tinted shadow under a sun-200→400
          // gradient button would read as dirt, not lift. Same deliberate
          // exception as Navbar's inset highlight: audit:css flags both as
          // raw colour, neither is an oversight.
          className="relative grid size-[var(--dial,18rem)] place-items-center overflow-hidden rounded-full border-[6px] border-white bg-gradient-to-b from-sun-200 to-sun-400 px-6 text-center shadow-[0_18px_40px_-12px_rgba(180,120,10,0.55)] transition hover:from-sun-100 hover:to-sun-300 focus-visible:ring-offset-4"
        >
          {/* The light: a diagonal sheen from the upper left, so the disc has a
              lit side and a shaded one instead of one vertical ramp. Tokens only,
              and it fades out well before the text. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-white/45 via-white/0 to-transparent"
          />
          {/* The border is three lines, not one: a hairline of sun outside the
              white ring and a hairline of deeper sun inside it, so the white
              reads as a rim with thickness rather than a flat stroke. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-sun-500/35" />
          {/* Two things, on request («make sun main hero with less text»):
              the question and the one thing to do. It carried four — the
              question, «اضغط ودوّر حواليك», a «ابحث» pill and «اكتب أو كلّم
              شوق» — and the second had been untrue since the dial stopped
              ranking places around you (see the comment on /find). What the
              tap leads to is said once, in the link's name, for the visitor
              who hears it rather than sees the page that follows. */}
          <span className="relative flex flex-col items-center gap-3">
            <span className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">
              إلى وين؟
            </span>
            <span className="rounded-full bg-ink-900 px-6 py-2 text-sm font-semibold text-sun-100 shadow-sm">
              ابدأ
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
}
