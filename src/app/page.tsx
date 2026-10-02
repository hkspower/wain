import Link from "next/link";
import HomeHero from "@/components/HomeHero";
import LandmarksShow from "@/components/LandmarksShow";
import PlaceCard from "@/components/PlaceCard";
import { IconCar, IconCompass, IconGo, IconSearch, IconSparkle } from "@/components/icons";
import { LANDMARKS } from "@/lib/landmarks.g";
import { getFeaturedPlaces, getPlace } from "@/lib/places";

export default function HomePage() {
  const featured = getFeaturedPlaces();
  // Names and areas are read from the catalogue here, on the server, and the
  // slideshow gets six plain rows — it is a client component, and importing
  // places.ts there would ship all 52 records with the home page.
  const landmarks = LANDMARKS.map((l) => {
    const place = getPlace(l.slug);
    if (!place) throw new Error(`landmarks.g.ts names ${l.slug}, which is not in places.ts`);
    return { slug: l.slug, name: place.nameAr, area: place.areaAr, avif: l.avif, webp: l.webp, src: l.src };
  });

  return (
    <>
      {/* ---------- Hero ---------- */}
      {/* The owner's picture, its sun the button to /find (HomeHero.tsx). It
          replaced the drawn skyline and the sun dial laid over it on
          2 October; the measurements that layout needed — the dial against
          the dome, the spheres and the flag at 14 widths — went with it, and
          audit:home-hero now asks the same question of the picture.

          «دوّر باسم المكان» is the row under it. It sat on the picture's sea
          for a day and came off on request, so the picture is only the
          picture. It is still the web's one visible way to /search: removing
          the top bar took the search button with it, and every other
          `href="/search/"` is AppTabBar's tab, painted by nothing in a
          browser — so it moved rather than went. It is one tap and not a fork
          («أو كلّم شوق» came out): on a page where nobody has searched yet,
          «باسم» and «شوق» are not a choice the visitor can make. /search
          names all three ways once you are there. standalone:hidden: the
          installed app's tab bar has a search tab. */}
      <HomeHero />
      <div className="bg-sand-50 standalone:hidden">
        <div className="mx-auto max-w-6xl px-2.5 pt-3 text-center sm:px-4 sm:pt-4">
          <Link
            href="/search"
            className="inline-flex min-h-6 items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-sea-800 shadow-sm ring-1 ring-line transition hover:bg-sand-100 active:scale-[0.98]"
          >
            <IconSearch className="size-4" />
            دوّر باسم المكان
          </Link>
        </div>
      </div>

      {/* ---------- Landmarks ---------- */}
      {/* Six of the famous places, one at a time (LandmarksShow.tsx). Under
          the search row, not on the picture: the hero is only the picture. */}
      <LandmarksShow slides={landmarks} />

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
