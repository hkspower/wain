import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import PlaceCard from "@/components/PlaceCard";
import { categoryGradient, getCategory, getPlace, places, toArabicDigits } from "@/lib/places";

export function generateStaticParams() {
  return places.map((place) => ({ slug: place.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const place = getPlace(slug);
  if (!place) return { title: "المكان غير موجود" };
  return {
    title: place.nameAr,
    description: place.taglineAr,
  };
}

const priceLabel = ["", "اقتصادي", "متوسط", "راقي"];

export default async function PlacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const place = getPlace(slug);
  if (!place) notFound();

  const category = getCategory(place.category);
  const related = places
    .filter((p) => p.category === place.category && p.slug !== place.slug)
    .slice(0, 3);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Breadcrumb */}
      <nav className="mb-5 text-sm text-ink-500" aria-label="مسار التنقّل">
        <Link href="/explore" className="transition hover:text-coral-700">
          استكشف
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span className="text-ink-700" aria-current="page">
          {place.nameAr}
        </span>
      </nav>

      {/* Hero */}
      <div
        className={`relative flex h-56 items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br shadow-lg sm:h-64 ${categoryGradient(place.category)}`}
      >
        <span aria-hidden="true" className="text-7xl drop-shadow-lg sm:text-8xl">
          {place.emoji}
        </span>
        <span
          className="absolute start-4 top-4 flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-sm font-bold text-ink-800 shadow-sm backdrop-blur"
          aria-label={`التقييم ${place.rating} من ٥`}
        >
          <svg viewBox="0 0 24 24" className="size-4 text-sun-500" fill="currentColor" aria-hidden="true">
            <path d="m12 2 2.9 6.1 6.6.9-4.8 4.7 1.2 6.7L12 17.2 6.1 20.4l1.2-6.7L2.5 9l6.6-.9L12 2Z" />
          </svg>
          {toArabicDigits(place.rating.toFixed(1))}
        </span>
      </div>

      {/* Header */}
      <div className="mt-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
            {place.nameAr}
          </h1>
          <p className="mt-1 text-lg text-ink-500">
            <span lang="en" dir="ltr">
              {place.name}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {category && (
            <span className="rounded-full bg-sea-50 px-3 py-1.5 text-sm font-bold text-sea-700">
              {category.ar}
            </span>
          )}
          <span
            className="flex items-center gap-1.5 rounded-full bg-sand-100 px-3 py-1.5 text-sm font-bold text-sand-800"
            aria-label={`مستوى السعر ${place.priceLevel} من ٣`}
          >
            <span className="flex gap-0.5" aria-hidden="true">
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`size-1.5 rounded-full ${
                    i <= place.priceLevel ? "bg-sand-700" : "bg-sand-300"
                  }`}
                />
              ))}
            </span>
            د.ك
          </span>
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-ink-500">
        <svg viewBox="0 0 24 24" className="size-4 text-coral-600" fill="currentColor" aria-hidden="true">
          <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
        </svg>
        {place.areaAr}، الكويت
      </p>

      <p className="mt-6 text-lg leading-relaxed text-ink-600">{place.descriptionAr}</p>

      {/* Details */}
      <div className="mt-9 grid gap-4 sm:grid-cols-2">
        <div className="rounded-3xl border border-sand-200 bg-white p-6 shadow-sm">
          <h2 className="font-display text-lg font-bold text-ink-900">أبرز ما فيه</h2>
          <ul className="mt-3 space-y-2.5">
            {place.highlightsAr.map((h) => (
              <li key={h} className="flex items-start gap-2 text-sm text-ink-600">
                <svg
                  viewBox="0 0 24 24"
                  className="mt-0.5 size-4 shrink-0 text-palm-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m5 13 4 4L19 7" />
                </svg>
                {h}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-3xl border border-sand-200 bg-white p-6 shadow-sm">
          <h2 className="font-display text-lg font-bold text-ink-900">أحسن وقت للزيارة</h2>
          <p className="mt-2.5 text-sm text-ink-600">{place.bestTimeAr}</p>

          <h2 className="mt-6 font-display text-lg font-bold text-ink-900">مستوى الأسعار</h2>
          <p className="mt-2.5 text-sm text-ink-600">{priceLabel[place.priceLevel]}</p>

          <a
            href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-sea-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-sea-700"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
              <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
            </svg>
            افتح في الخرائط
          </a>
        </div>
      </div>

      {/* Related */}
      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-5 font-display text-2xl font-bold text-ink-900">
            أماكن مشابهة
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((p) => (
              <PlaceCard key={p.slug} place={p} />
            ))}
          </div>
        </section>
      )}

      <div className="mt-12 text-center">
        <Link
          href="/explore"
          className="inline-block rounded-xl border border-sand-300 bg-white px-6 py-3 font-bold text-ink-700 shadow-sm transition hover:border-sea-300 hover:text-sea-700"
        >
          ← رجوع للاستكشاف
        </Link>
      </div>
    </div>
  );
}
