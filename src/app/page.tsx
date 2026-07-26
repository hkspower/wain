import Link from "next/link";
import PlaceCard from "@/components/PlaceCard";
import { categories, getFeaturedPlaces, places } from "@/lib/places";

export default function HomePage() {
  const featured = getFeaturedPlaces();

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 via-white to-white">
        <div className="pointer-events-none absolute -top-24 left-1/2 size-[600px] -translate-x-1/2 rounded-full bg-brand-100/60 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-4 py-1.5 text-sm font-medium text-brand-700 shadow-sm">
            🇰🇼 Your guide to Kuwait
          </p>
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl">
            Wain nrooh?{" "}
            <span className="bg-gradient-to-r from-brand-600 to-sand-500 bg-clip-text text-transparent">
              We know where.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-slate-500">
            <span dir="rtl" className="font-semibold text-slate-700">
              وين نروح؟
            </span>{" "}
            — the question every group chat asks. Wain answers it with the best
            landmarks, food, beaches, and hidden gems across Kuwait.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/explore"
              className="rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white shadow-md shadow-brand-600/20 transition hover:bg-brand-700"
            >
              Start exploring →
            </Link>
            <Link
              href="/about"
              className="rounded-xl border border-slate-200 bg-white px-6 py-3 font-semibold text-slate-700 shadow-sm transition hover:border-brand-300 hover:text-brand-700"
            >
              What is Wain?
            </Link>
          </div>

          <div className="mt-14 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm text-slate-500">
            <span>
              <strong className="text-slate-700">{places.length}</strong> curated places
            </span>
            <span>
              <strong className="text-slate-700">{categories.length}</strong> categories
            </span>
            <span>
              <strong className="text-slate-700">100%</strong> local picks
            </span>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
              Browse by mood
            </h2>
            <p className="mt-1 text-slate-500">Whatever the plan, there&apos;s a place.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {categories.map((cat) => (
            <Link
              key={cat.name}
              href={`/explore?category=${encodeURIComponent(cat.name)}`}
              className="group rounded-2xl border border-slate-100 bg-white p-5 text-center shadow-sm transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-md"
            >
              <span aria-hidden="true" className="text-3xl transition group-hover:scale-110">
                {cat.emoji}
              </span>
              <h3 className="mt-3 text-sm font-bold text-slate-900">{cat.name}</h3>
              <p className="mt-1 text-xs text-slate-500">{cat.blurb}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured */}
      <section className="bg-slate-50/70">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-8 flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
                Featured this week
              </h2>
              <p className="mt-1 text-slate-500">The places everyone&apos;s talking about.</p>
            </div>
            <Link
              href="/explore"
              className="hidden text-sm font-semibold text-brand-700 hover:text-brand-800 sm:block"
            >
              View all →
            </Link>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((place) => (
              <PlaceCard key={place.slug} place={place} />
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">
          How Wain works
        </h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {[
            {
              step: "1",
              emoji: "🔎",
              title: "Search or browse",
              text: "Filter by category, area, or vibe — beaches, souqs, museums, malls.",
            },
            {
              step: "2",
              emoji: "📖",
              title: "Get the local story",
              text: "Every place comes with highlights, the best time to go, and honest tips.",
            },
            {
              step: "3",
              emoji: "🚗",
              title: "Go!",
              text: "Settle the group chat debate once and for all. Yalla, let's go.",
            },
          ].map((item) => (
            <div key={item.step} className="relative rounded-2xl border border-slate-100 p-6">
              <span className="absolute -top-4 left-6 grid size-8 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">
                {item.step}
              </span>
              <span aria-hidden="true" className="text-3xl">
                {item.emoji}
              </span>
              <h3 className="mt-3 font-bold text-slate-900">{item.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-brand-700 to-brand-500 px-6 py-14 text-center shadow-xl">
          <div className="pointer-events-none absolute -right-10 -top-10 size-48 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-12 -left-10 size-56 rounded-full bg-sand-400/20 blur-2xl" />
          <h2 className="text-balance text-3xl font-extrabold text-white sm:text-4xl">
            Still asking &ldquo;wain nrooh?&rdquo;
          </h2>
          <p className="mx-auto mt-3 max-w-md text-pretty text-brand-100">
            Stop scrolling the group chat. Find tonight&apos;s plan in under a minute.
          </p>
          <Link
            href="/explore"
            className="mt-8 inline-block rounded-xl bg-white px-7 py-3 font-bold text-brand-700 shadow-md transition hover:bg-brand-50"
          >
            Explore places →
          </Link>
        </div>
      </section>
    </>
  );
}
