import Link from "next/link";
import KuwaitSkyline from "@/components/KuwaitSkyline";
import NearbyDial from "@/components/NearbyDial";
import PlaceCard from "@/components/PlaceCard";
import { IconCar, IconCompass, IconGo, IconPinSolid, IconSearch, IconSparkle } from "@/components/icons";
import { getFeaturedPlaces } from "@/lib/places";

export default function HomePage() {
  const featured = getFeaturedPlaces();

  return (
    <>
      {/* ---------- Hero ---------- */}
      {/* The skyline is drawn at its own 1200:530 and never cropped.

          It was 1200:420 until the two tall landmarks were made ~32% taller:
          the drawing is 44.2vw tall now instead of 35vw, and every vw figure
          below that used to clear the old height moved up by the same 9vw —
          `65vw`→`74vw` on a phone, `44vw`→`53vw` from `sm` up — so the sky
          above the drawing is the same amount of sky as before. The numbers
          quoted in the paragraphs below are the OLD ones, kept because the
          reasoning is unchanged.

          It used to be `h-auto min-h-[210px]` with a `slice` fit, and both
          halves cut it. On a phone the 210px floor is taller than the
          drawing's natural 136px at 390, so `slice` threw away the sides:
          320px showed units 280–920 of 1200, 390px showed 210–990, and the
          Liberation Tower (172–202) and the clock tower (1006–1092) were
          simply not on the page. On a wide screen the drawing outgrew the
          section instead — 672px against 507 at 1920 — and overflow-hidden
          took the top 103 units, the tips of both towers with them.

          So the box has the drawing's own ratio as a floor — `min-h-[35vw]`
          is exactly the drawing's own rendered height at full width, so a
          value AT that floor means section height = drawing height, nothing
          spare. The hero reserves more than the drawing needs so the seam
          reads as open sky rather than a blank band — `#ffffff`, the sky
          gradient's own first stop. It was trimmed to `38vw` for a mobile fit
          (see the history above this line, still true of the reasoning: a
          38vw reserve is not cropping the drawing, it is choosing how much
          sky sits above it), then asked back up ~40% taller — `65vw` — with
          a bigger dial to match, on request, not because the trim was wrong.
          `sm:min-h-[44vw]` is untouched: this is a mobile-only size, not a
          redesign of the wide reading. Content's own `pb-[65vw]`/`sm:pb-3`
          mirrors the section's own value, for the reason it always has: it
          reserves the skyline's own height below «دوّر باسم المكان» so the
          two never overlap — 65vw only has to clear the drawing's 35vw
          floor, and it clears it with room to spare.

          **The phone reserve is `58vw` now, not `74vw`.** The drawing is 44vw
          tall and its own top 110 units are empty sky, so 74vw left a visible
          band of nothing between the search pill and the first tower on a
          phone (about 115px at 390). 58vw still clears the tallest tip. And
          the content's `pt-6`/`sm:pt-8` is for the wordmark's pin, which hangs
          12–16px above the heading and was being cut by `overflow-hidden`. */}
      {/* **The dial and the drawing are laid out two ways, and which one depends
          on the width — this was found by measuring, not by looking.**

          Below 1024px the two are STACKED: the dial and the pill, then the
          skyline underneath, so nothing can cover anything. Above it the dial
          floats over the sky in the drawing (the dial is the sun), and that
          only works if it clears the artwork — the dome, the flag, the Kuwait
          Towers' spheres. It used to be one layout from 640px up, with a
          fixed 288px dial over a drawing that scales with the viewport, and
          scripts/audit-home-hero.mjs, run against that layout, failed at 9 of
          its 14 widths, 640 to 1440px: at 768px the dial lay over the dome,
          its crescent, the minaret's cap, the big sphere and the flag; at
          1024px over the dome, the sphere and the flag; at 1280px it still
          touched the dome and the sphere, and the pill was against the
          dome's box (that is a bounding box, so the contact is the corner of
          a round shape) up to 1440px. It first cleared at 1536px.

          Three things make the overlay hold:
            - the dial grows with the screen — 14rem at 1024px to 20rem at
              1920px, a straight line between them (`clamp`) — through `--dial`,
              which `NearbyDial` reads. The named `lg` breakpoint, not
              `min-[1024px]`: Tailwind sorts arbitrary min-width variants
              BEFORE `sm`, so `sm:pb-[52vw]` outranked the overlay's `pb-3` and
              the hero came out 300px too tall — found by the same measurement;
            - the section's own height is derived from it:
              `--dial + 15.03rem + 20.17vw`, where 20.17vw is how far the dome's
              crescent stands above the section's foot (the drawing is
              bottom-anchored and scales with the width) and the rest is the
              wordmark, the gaps, the dial and the pill. The constant was fitted
              against the audit, which reads 23px of air between the pill and
              the crescent at 1024px, the tightest width, and 42px at 1280px —
              about 15px of slack before its 8px floor. `max()` with 53vw keeps
              the old height where that is already taller;
            - the Kuwait Towers sit 20 units further right in the drawing
              (KuwaitSkyline.tsx), so the dial's edge clears the big sphere.

          Phones are unchanged. From `sm` up the stacked reserve is 52vw rather
          than the phone's 58vw: the drawing is 44.2vw and its own empty sky is
          most of the rest, and the larger value left over a hundred pixels of
          nothing under the pill at tablet width. (The `sm:pb-3` and
          `sm:min-h-[53vw]` in the paragraphs above describe the layout this
          replaces.) */}
      <section className="relative min-h-[58vw] overflow-hidden bg-sand-50 [--dial:18rem] sm:min-h-[52vw] lg:min-h-[max(53vw,calc(var(--dial)+15.03rem+20.17vw))] lg:[--dial:clamp(14rem,calc(10.7vw+114.4px),20rem)]">
        <KuwaitSkyline className="pointer-events-none absolute inset-x-0 bottom-0 aspect-[1200/530] h-auto w-full" />

        <div className="relative mx-auto max-w-6xl px-2.5 pb-[58vw] pt-6 sm:px-4 sm:pb-[52vw] sm:pt-8 lg:pb-3">
          {/* Wordmark */}
          <div className="text-center">
            <span className="relative inline-block">
              {/* 72/96px was shouting. leading-none is dropped with it: the
                  theme's Arabic line-heights exist precisely so ن and ي have
                  somewhere to go, and overriding them to 1 clipped that. */}
              <h1 className="font-display text-5xl font-bold text-ink-900 sm:text-6xl">
                وين
              </h1>
              <span
                aria-hidden="true"
                className="absolute -start-6 -top-3 text-coral-600 sm:-start-8 sm:-top-4"
              >
                <IconPinSolid className="size-9 sm:size-12" />
              </span>
            </span>
            <p className="mt-3 font-display text-2xl font-bold text-coral-600 sm:text-3xl">
              وين الطلعة اليوم؟
            </p>
          </div>

          {/* Search dial */}
          <div className="mt-8 sm:mt-12">
            <NearbyDial />
          </div>

          {/* The site's only route to /search, and it had none at all.
              Removing the top bar took the search button with it and nothing
              replaced it: after that, every route's single `href="/search/"`
              was AppTabBar's tab, which is `standalone:block` and so is
              painted by nothing in a browser. Search was unreachable, and
              with it شوق — her launcher lives inside the /search query box.
              A link under the dial rather than a second bar, because the two
              are halves of one question: the dial answers «وين» by where you
              are, this one by what the place is called.

              It used to read «دوّر باسم المكان أو كلّم شوق», and the «أو» is
              what came out. This is one tap on a page where nobody has
              searched anything yet, so the two halves are not a choice the
              visitor is in a position to make — «باسم» and «شوق» only mean
              something once you are looking at a box and some results. Asked
              here, it is a decision before there is anything to decide about,
              and it makes the shortest route to search read as a fork.

              The offer is not lost: /search names all three ways — typing,
              شوق, the map — once you are there, which is the stage that can
              afford to. Same «one offer, drawn once» rule as ShouqCallButton's
              own placement, applied to the step before it rather than to the
              page. Do not put the second half back here without moving the
              /search line out of the way first. */}
          {/* standalone:hidden — the installed app's tab bar has a search
              tab, so in the app this is the same offer drawn twice; the
              rule LiveTray already follows. In a browser it is the page's
              one visible way to /search and stays exactly as it was. */}
          <div className="mt-5 text-center standalone:hidden sm:mt-4">
            <Link
              href="/search"
              className="inline-flex min-h-6 items-center gap-2 rounded-full bg-white/95 px-5 py-2.5 text-sm font-semibold text-sea-800 shadow-sm ring-1 ring-line transition hover:bg-white"
            >
              <IconSearch className="size-4" />
              دوّر باسم المكان
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- Featured ---------- */}
      <section className="bg-sand-50">
        <div className="mx-auto max-w-6xl px-2.5 py-2 sm:px-4 sm:py-3">
          {/* Both the display title and the standfirst under it were removed,
              so nothing labels this section on screen. The heading stays in
              the markup, visually hidden: `sr-only` is out of flow, so it
              costs no layout, and without it the section would be unreachable
              in the outline a screen reader navigates by. `justify-end` and
              not `justify-between` because the link is the only child left —
              `between` would push it to the start edge. */}
          <div className="mb-3 flex flex-wrap items-end justify-end gap-3 sm:mb-5">
            <h2 className="sr-only">أماكن ما تنقال عنها لا.</h2>
            <Link
              href="/explore"
              className="group flex min-h-6 items-center gap-1.5 text-sm font-semibold text-coral-700 transition hover:text-coral-800"
            >
              شوف الكل
              <IconGo className="size-4 transition group-hover:-translate-x-0.5" />
            </Link>
          </div>

          {/* A rail on a phone, a grid from `sm` up.

              Six cards stacked one per row were 1901px — 46% of the whole home
              page, and more than two full phone screens of scrolling to pass
              six suggestions. The rail shows one and a half, which is the
              shape that says "there are more of these sideways", and costs one
              card's height instead of six.

              Same swipe rules as the category rail above it, for the same
              measured reasons: proximity snapping so a small nudge is not
              corrected into a whole-card jump, overscroll-x-contain so a flick
              past the end cannot trigger the browser's back gesture, and
              scroll-px-2.5 matching px-2.5 so the rail rests at its own start. */}
          <ul className="-mx-2.5 flex snap-x snap-proximity gap-4 overflow-x-auto overscroll-x-contain scroll-px-2.5 px-2.5 pb-2 [mask-image:linear-gradient(to_left,transparent,#000_1.25rem,#000_calc(100%-1.25rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 sm:pb-0 sm:[mask-image:none] lg:grid-cols-3">
            {featured.map((place) => (
              <li key={place.slug} className="w-64 shrink-0 snap-start sm:w-auto">
                <PlaceCard place={place} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="bg-sand-100">
        <div className="mx-auto max-w-6xl px-2.5 py-2 sm:px-4 sm:py-3">
          <h2 className="text-center font-display text-2xl font-bold text-ink-900 sm:text-3xl">
            كيف يشتغل وين؟
          </h2>
          {/* mt-10 and gap-6 existed to clear the badge each card hangs above
              itself (`-top-5`), and on a phone that is three lots of vertical
              slack for three short sentences. Below `sm` the badge comes inside
              and sits beside the words, so a step is one row instead of a card
              with a hat; from `sm` the three-across layout has the room and
              keeps the original shape. */}
          {/* One card with three rows on a phone, three cards from `sm`.
              Measured: as three separate cards this section was 567px, the
              biggest block on the page — bigger than the featured places, which
              are the actual product. Most of it was chrome repeated three
              times (two extra sets of padding, two borders, the gaps between)
              and a step number sitting on a line of its own. The words are all
              still here; the box around each of them is not. */}
          <div className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white shadow-sm sm:mt-7 sm:grid sm:grid-cols-3 sm:gap-5 sm:divide-y-0 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:shadow-none">
            {[
              {
                n: "١",
                icon: <IconCompass className="size-6" />,
                title: "قول وين تبي",
                // The dial used to rank the nearest five live against a GPS
                // fix taken in the same tap; it opens /find now, which asks
                // to type or call شوق instead of assuming "nearest" is
                // always the question — see NearbyDial and FindChoice.
                // "أقرب الأماكن" stopped being true when that panel left.
                text: "اضغط على «إلى وين؟» واختر: تكتب اسم المكان أو تكلّم شوق.",
              },
              {
                n: "٢",
                icon: <IconSparkle className="size-6" />,
                title: "اختر الجو",
                text: "معالم، مطاعم، قهوة، بحر أو أسواق — كل وحدة ولها وقتها.",
              },
              {
                n: "٣",
                icon: <IconCar className="size-6" />,
                title: "يالله نروح",
                // This step promised «تخلص من نقاش الجروب» while the site had
                // no way to tell anybody anything — no share button existed.
                // Now it names the thing that actually ends the argument.
                text: "رسّلها للربع بالوقت والموقع — ما بقى شي يتناقش فيه.",
              },
            ].map((step) => (
              <div
                key={step.n}
                className="group relative flex items-start gap-3 p-3.5 transition duration-300 sm:block sm:rounded-3xl sm:border sm:border-line sm:bg-white sm:p-5 sm:shadow-sm sm:hover:-translate-y-1 sm:hover:shadow-lg"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-coral-500 to-coral-700 text-white shadow-md shadow-coral-600/30 transition duration-300 sm:absolute sm:-top-5 sm:start-6 sm:group-hover:scale-105">
                  {step.icon}
                </span>
                <div className="min-w-0">
                  {/* The number rides with the title on a phone and keeps its
                      own line from `sm`, where the card has the room. On its
                      own line it cost a row per step to say what the order of
                      the steps already says. */}
                  <h3 className="font-display text-lg font-semibold text-ink-900 sm:mt-1">
                    <span className="text-sm font-semibold text-sand-700 sm:block">{step.n}</span>
                    <span className="sm:hidden"> · </span>
                    {step.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-500 sm:mt-1.5">{step.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="bg-sand-50">
        <div className="mx-auto max-w-6xl px-2.5 pb-2 sm:px-4 sm:pb-3">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-sea-800 to-sea-600 px-6 py-7 text-center shadow-xl sm:py-6">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -end-10 -top-10 size-48 rounded-full bg-white/10 blur-2xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-12 -start-10 size-56 rounded-full bg-sun-300/20 blur-2xl"
            />
            <h2 className="font-display text-3xl font-bold text-white sm:text-4xl">
              بعدك تسأل «وين نروح»؟
            </h2>
            <p className="mx-auto mt-3 max-w-md text-white">
              خلّ الجروب يرتاح — لقِ طلعة الليلة في أقل من دقيقة.
            </p>
            <Link
              href="/explore"
              className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-sun-300 px-7 py-3 font-display text-lg font-semibold text-ink-900 shadow-lg transition hover:bg-sun-200 active:scale-[0.98]"
            >
              استكشف الأماكن
              <IconGo className="size-5" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
