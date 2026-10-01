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
        {/* compass tick ring */}
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          className="pointer-events-none absolute -inset-4 size-[calc(100%+2rem)] text-sun-600/50"
        >
          <g stroke="currentColor" strokeLinecap="round">
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
                />
              );
            })}
          </g>
        </svg>
        <Link
          href="/find"
          // The ambient glow underneath is amber, not the @theme shadow
          // scale's ink tint — an ink-tinted shadow under a sun-200→400
          // gradient button would read as dirt, not lift. Same deliberate
          // exception as Navbar's inset highlight: audit:css flags both as
          // raw colour, neither is an oversight.
          className="relative grid size-[var(--dial,18rem)] place-items-center rounded-full border-[6px] border-white bg-gradient-to-b from-sun-200 to-sun-400 px-6 text-center shadow-[0_18px_40px_-12px_rgba(180,120,10,0.55)] transition hover:from-sun-100 hover:to-sun-300 focus-visible:ring-offset-4"
        >
          <span className="flex flex-col items-center gap-1">
            <span className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">
              إلى وين؟
            </span>
            <span className="text-sm font-semibold text-sun-900">
              اضغط ودوّر حواليك
            </span>
            <span className="mt-2 rounded-full bg-ink-900 px-5 py-2 text-sm font-semibold text-sun-100 shadow-sm">
              ابحث
            </span>
            {/* Used to claim «أقرب الأماكن — ١٠ كم حواليك», which was true of
                the panel this replaced — a live-ranked nearest-five list —
                and would be false of a link that opens a choice page instead. */}
            <span className="mt-1 text-xs font-semibold text-sun-900">
              اكتب أو كلّم شوق
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
}
