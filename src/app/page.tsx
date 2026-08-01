import Link from "next/link";
import KuwaitSkyline from "@/components/KuwaitSkyline";
import CategoryIcon from "@/components/CategoryIcon";
import NearbyDial from "@/components/NearbyDial";
import PlaceCard from "@/components/PlaceCard";
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

        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24 sm:pt-14">
          {/* Wordmark */}
          <div className="text-center">
            <span className="relative inline-block">
              <h1 className="font-display text-7xl font-extrabold leading-none tracking-tight text-ink-900 sm:text-8xl">
                وين
              </h1>
              <span
                aria-hidden="true"
                className="absolute -right-6 -top-3 text-coral-600 sm:-right-8 sm:-top-4"
              >
                <svg viewBox="0 0 24 24" className="size-9 sm:size-12" fill="currentColor">
                  <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
                </svg>
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
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-white sm:text-3xl">
              <svg viewBox="0 0 24 24" className="size-6 text-sun-300" fill="currentColor" aria-hidden="true">
                <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
              </svg>
              وش تدوّر؟
            </h2>
            <Link
              href="/explore"
              className="rounded-full bg-white/95 px-4 py-2 text-sm font-bold text-sea-800 shadow-sm transition hover:bg-white"
            >
              شوف الكل ↗
            </Link>
          </div>

          {/* Scroll rail on small screens, even grid from lg up */}
          <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0 lg:grid lg:grid-cols-9 lg:overflow-visible lg:pb-0">
            <li className="w-28 shrink-0 snap-start sm:w-32 lg:w-auto">
              <Link
                href="/explore"
                className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl bg-sun-300 p-4 text-center text-ink-900 shadow-sm transition hover:-translate-y-0.5 hover:bg-sun-200"
              >
                <CategoryIcon name="all" />
                <span className="text-sm font-bold">الكل</span>
                <span className="text-[11px] font-semibold text-sun-900">
                  {countAr(places.length, PLACES_COUNT)}
                </span>
              </Link>
            </li>
            {categories.map((cat) => (
              <li key={cat.id} className="w-28 shrink-0 snap-start sm:w-32 lg:w-auto">
                <Link
                  href={`/explore?category=${cat.id}`}
                  className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl bg-white/12 p-4 text-center text-white ring-1 ring-white/20 backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white/20"
                >
                  <CategoryIcon name={cat.icon} />
                  <span className="text-sm font-bold leading-tight">{cat.ar}</span>
                  <span className="text-[11px] font-medium text-white/75">
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
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-bold text-ink-900 sm:text-3xl">
                وين شنو فيه؟ 🇰🇼
              </h2>
              <p className="mt-1 text-ink-500">أماكن ما تنقال عنها لا.</p>
            </div>
            <Link
              href="/explore"
              className="text-sm font-bold text-coral-700 transition hover:text-coral-800"
            >
              شوف الكل ↗
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
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <h2 className="text-center font-display text-2xl font-bold text-ink-900 sm:text-3xl">
            كيف يشتغل وين؟
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {[
              {
                n: "١",
                title: "حدّد موقعك",
                text: "اضغط على «إلى وين؟» وتطلع لك أقرب الأماكن — وإذا تبي دقّة أكثر شارك موقعك.",
              },
              {
                n: "٢",
                title: "اختر الجو",
                text: "معالم، مطاعم، قهوة، بحر أو أسواق — كل وحدة ولها وقتها.",
              },
              {
                n: "٣",
                title: "يالله نروح",
                text: "تعرف وين تروح ومتى تروح، وتخلص من نقاش الجروب.",
              },
            ].map((step) => (
              <div
                key={step.n}
                className="relative rounded-3xl border border-sand-200 bg-white p-6 shadow-sm"
              >
                <span className="absolute -top-4 start-6 grid size-9 place-items-center rounded-full bg-coral-600 font-display text-base font-bold text-white shadow-sm">
                  {step.n}
                </span>
                <h3 className="mt-2 font-display text-lg font-bold text-ink-900">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="bg-sand-50">
        <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-sea-800 to-sea-600 px-6 py-14 text-center shadow-xl">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -end-10 -top-10 size-48 rounded-full bg-white/10 blur-2xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-12 -start-10 size-56 rounded-full bg-sun-300/20 blur-2xl"
            />
            <h2 className="font-display text-3xl font-extrabold text-white sm:text-4xl">
              بعدك تسأل «وين نروح»؟
            </h2>
            <p className="mx-auto mt-3 max-w-md text-white">
              خلّ الجروب يرتاح — لقِ طلعة الليلة في أقل من دقيقة.
            </p>
            <Link
              href="/explore"
              className="mt-8 inline-block rounded-2xl bg-sun-300 px-7 py-3 font-display text-lg font-bold text-ink-900 shadow-lg transition hover:bg-sun-200"
            >
              استكشف الأماكن ↗
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
