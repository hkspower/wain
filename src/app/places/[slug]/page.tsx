import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import PlaceCard from "@/components/PlaceCard";
import { getPlace, getPlacesByCategory, places } from "@/lib/places";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return places.map((place) => ({ slug: place.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const place = getPlace(slug);
  if (!place) return { title: "Place not found" };
  return {
    title: place.name,
    description: place.tagline,
  };
}

export default async function PlacePage({ params }: Props) {
  const { slug } = await params;
  const place = getPlace(slug);
  if (!place) notFound();

  const related = getPlacesByCategory(place.category)
    .filter((p) => p.slug !== place.slug)
    .slice(0, 3);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-slate-400">
        <Link href="/explore" className="transition hover:text-brand-700">
          Explore
        </Link>
        <span className="mx-2">/</span>
        <span className="text-slate-600">{place.name}</span>
      </nav>

      {/* Hero banner */}
      <div
        className={`relative flex h-64 items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br ${place.gradient} shadow-lg`}
      >
        <span className="text-8xl drop-shadow-lg">{place.emoji}</span>
        <span className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-sm font-bold text-slate-800 backdrop-blur">
          ⭐ {place.rating.toFixed(1)}
        </span>
      </div>

      {/* Header */}
      <div className="mt-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            {place.name}
          </h1>
          <p className="mt-1 text-xl text-slate-400" dir="rtl">
            {place.nameAr}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-700">
            {place.category}
          </span>
          <span className="rounded-full bg-sand-50 px-3 py-1.5 text-sm font-semibold text-sand-700">
            KD {"•".repeat(place.priceLevel)}
          </span>
        </div>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-slate-500">📍 {place.area}, Kuwait</p>

      <p className="mt-6 text-lg leading-relaxed text-slate-600">{place.description}</p>

      {/* Info grid */}
      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-6">
          <h2 className="font-bold text-slate-900">✨ Highlights</h2>
          <ul className="mt-3 space-y-2">
            {place.highlights.map((h) => (
              <li key={h} className="flex items-start gap-2 text-sm text-slate-600">
                <span className="mt-0.5 text-brand-500">✓</span>
                {h}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-6">
          <h2 className="font-bold text-slate-900">🕐 Best time to visit</h2>
          <p className="mt-3 text-sm text-slate-600">{place.bestTime}</p>
          <h2 className="mt-6 font-bold text-slate-900">💰 Price level</h2>
          <p className="mt-3 text-sm text-slate-600">
            {["Budget-friendly", "Moderate", "Treat yourself"][place.priceLevel - 1]}
          </p>
        </div>
      </div>

      {/* Related */}
      {related.length > 0 && (
        <div className="mt-14">
          <h2 className="text-2xl font-bold text-slate-900">
            More {place.category.toLowerCase()}
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((p) => (
              <PlaceCard key={p.slug} place={p} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-12 text-center">
        <Link
          href="/explore"
          className="inline-block rounded-xl border border-slate-200 px-6 py-3 font-semibold text-slate-700 transition hover:border-brand-300 hover:text-brand-700"
        >
          ← Back to explore
        </Link>
      </div>
    </div>
  );
}
