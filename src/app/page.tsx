import Link from "next/link";
import KuwaitSkyline from "@/components/KuwaitSkyline";
import CategoryIcon from "@/components/CategoryIcon";
import NearbyDial from "@/components/NearbyDial";
import PlaceCard from "@/components/PlaceCard";
import { IconCar, IconGo, IconLocate, IconPinSolid, IconSparkle } from "@/components/icons";
import {
  categories,
  countAr,
  countByCategory,
  getFeaturedPlaces,
  places,
  PLACES_COUNT,
} from "@/lib/places";

export default function HomePage() {
  const featured = getFeaturedPlaces();

  return (
    <>
      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden bg-sand-50">
        <KuwaitSkyline className="pointer-events-none absolute inset-x-0 bottom-0 h-auto min-h-[210px] w-full" />

        <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-8 standalone:px-3 standalone:pb-7 standalone:pt-4 sm:px-6 sm:pb-24 sm:pt-14">
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
          <div className="mt-10 sm:mt-12">
            <NearbyDial />
          </div>
        </div>
      </section>

      {/* ---------- Categories ---------- */}
      <section className="relative bg-sea-700">
        <div className="mx-auto max-w-6xl px-4 py-8 standalone:px-3 standalone:py-5 sm:px-6 sm:py-14">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-white sm:text-3xl">
              <IconPinSolid className="size-6 text-sun-300" />
              وش تدوّر؟
            </h2>
            <Link
              href="/explore"
              className="flex min-h-11 items-center gap-1.5 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-sea-800 shadow-sm transition hover:bg-white"
            >
              شوف الكل
              <IconGo className="size-4" />
            </Link>
          </div>

          {/* Scroll rail on small screens, even grid from lg up.

              Three things here are about how the swipe FEELS, and all three
              were measured on a 390px phone rather than guessed:

              snap-proximity, not snap-mandatory. Mandatory cannot let the rail
              rest between items, so it corrected a 4px nudge into a 120px jump
              — a whole card — and every small movement fought back. Nine cards
              at 112px sit 3.15 to a screen, so this is a browse rail, not a
              pager; proximity assists a flick that is already near an edge and
              otherwise leaves the finger alone.

              overscroll-x-contain. Without it a swipe past the last card
              chains to the page, and on iOS and Android that gesture is
              back-navigation. Flicking to the end of the rail could leave the
              site.

              scroll-px-4 to match px-4. Snapping aligns to the scrollport, which
              ignores padding unless scroll-padding says otherwise, so the rail
              settled 16px away from its own start on load — measurably, before
              any touch. The two now agree, and it rests where it belongs. */}
          <ul className="-mx-4 flex snap-x snap-proximity gap-3 overflow-x-auto overscroll-x-contain scroll-px-4 px-4 pb-2 [mask-image:linear-gradient(to_left,transparent,#000_1.25rem,#000_calc(100%-1.25rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:scroll-px-0 sm:px-0 lg:grid lg:grid-cols-9 lg:overflow-visible lg:pb-0 lg:[mask-image:none]">
            <li className="w-28 shrink-0 snap-start sm:w-32 lg:w-auto">
              <Link
                href="/explore"
                className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl bg-sun-300 p-4 text-center text-ink-900 shadow-sm transition hover:-translate-y-0.5 hover:bg-sun-200"
              >
                <CategoryIcon name="all" />
                <span className="text-sm font-semibold">الكل</span>
                <span className="text-2xs font-semibold text-sun-900">
                  {countAr(places.length, PLACES_COUNT)}
                </span>
              </Link>
            </li>
            {categories.map((cat) => (
              <li key={cat.id} className="w-28 shrink-0 snap-start sm:w-32 lg:w-auto">
                <Link
                  href={`/explore/?category=${cat.id}`}
                  className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl bg-white/12 p-4 text-center text-white ring-1 ring-white/20 backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white/20"
                >
                  <CategoryIcon name={cat.icon} />
                  <span className="text-sm font-semibold leading-tight">{cat.ar}</span>
                  <span className="text-2xs font-semibold text-white">
                    {countAr(countByCategory(cat.id), PLACES_COUNT)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- Featured ---------- */}
      <section className="bg-sand-50">
        <div className="mx-auto max-w-6xl px-4 py-10 standalone:px-3 standalone:py-6 sm:px-6 sm:py-16">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-bold text-ink-900 sm:text-3xl">
                وين؟ شنو فيه 🇰🇼
              </h2>
              <p className="mt-1 text-ink-500">أماكن ما تنقال عنها لا.</p>
            </div>
            <Link
              href="/explore"
              className="group flex min-h-11 items-center gap-1.5 text-sm font-semibold text-coral-700 transition hover:text-coral-800"
            >
              شوف الكل
              <IconGo className="size-4 transition group-hover:-translate-x-0.5" />
            </Link>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((place) => (
              <PlaceCard key={place.slug} place={place} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="bg-sand-100">
        <div className="mx-auto max-w-6xl px-4 py-10 standalone:px-3 standalone:py-6 sm:px-6 sm:py-16">
          <h2 className="text-center font-display text-2xl font-bold text-ink-900 sm:text-3xl">
            كيف يشتغل وين؟
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {[
              {
                n: "١",
                icon: <IconLocate className="size-6" />,
                title: "حدّد موقعك",
                text: "اضغط على «إلى وين؟» وتطلع لك أقرب الأماكن — وإذا تبي دقّة أكثر شارك موقعك.",
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
                className="group relative rounded-3xl border border-line bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                <span className="absolute -top-5 start-6 grid size-11 place-items-center rounded-2xl bg-gradient-to-b from-coral-500 to-coral-700 text-white shadow-md shadow-coral-600/30 transition duration-300 group-hover:scale-105">
                  {step.icon}
                </span>
                <span className="font-display text-sm font-semibold text-sand-700">{step.n}</span>
                <h3 className="mt-1 font-display text-lg font-semibold text-ink-900">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="bg-sand-50">
        <div className="mx-auto max-w-6xl px-4 pb-12 standalone:px-3 standalone:pb-6 sm:px-6 sm:pb-20">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-sea-800 to-sea-600 px-6 py-14 text-center shadow-xl">
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
              className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-sun-300 px-7 py-3 font-display text-lg font-semibold text-ink-900 shadow-lg transition hover:bg-sun-200 active:scale-[0.98]"
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
