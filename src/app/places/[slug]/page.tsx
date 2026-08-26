import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BusinessBio, BusinessBrand, BusinessContact, BusinessGallery, BusinessProducts } from "@/components/BusinessProfile";
import CategoryArt from "@/components/CategoryArt";
import PlaceArt, { hasPlaceArt } from "@/components/PlaceArt";
import PlaceCard from "@/components/PlaceCard";
import OrderPanel from "@/components/OrderPanel";
import QueuePanel from "@/components/QueuePanel";
import ShareHangout from "@/components/ShareHangout";
import PlaceMap from "@/components/PlaceMap";
import {
  IconBack,
  IconCheck,
  IconClock,
  IconCoins,
  IconPinSolid,
  IconSparkle,
  IconStar,
  IconSun,
} from "@/components/icons";
import {
  distanceKm,
  getCategory,
  getPlace,
  placeGradient,
  places,
  placeVariant,
  toArabicDigits,
} from "@/lib/places";

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
    alternates: { canonical: `/places/${place.slug}/` },
    openGraph: {
      title: `${place.nameAr} | وين؟`,
      description: place.taglineAr,
      url: `/places/${place.slug}/`,
      type: "article",
      // Each place has its own card (scripts/gen-og.mjs). Sharing seventeen
      // different places used to put the same picture in every preview.
      images: [{ url: `/og/${place.slug}.jpg`, width: 1200, height: 630, alt: place.nameAr }],
    },
    // The layout sets twitter.images site-wide, and that wins here unless it
    // is restated — without this, X would keep showing the generic card while
    // WhatsApp showed the right one.
    twitter: {
      card: "summary_large_image",
      title: `${place.nameAr} | وين؟`,
      description: place.taglineAr,
      images: [`/og/${place.slug}.jpg`],
    },
  };
}

const priceLabel = ["", "اقتصادي", "متوسط", "راقي"];

const SETTING_LABEL = { indoor: "مكيّف", outdoor: "برا", mixed: "داخلي وبرا" } as const;
const SETTING_TONE = {
  indoor: "bg-sea-50 text-sea-700",
  outdoor: "bg-palm-500/12 text-palm-700",
  mixed: "bg-sand-100 text-sand-800",
} as const;

export default async function PlacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const place = getPlace(slug);
  if (!place) notFound();

  const category = getCategory(place.category);
  // Same-category places first; if that's thin (some categories have a
  // single place), fill with whatever is physically closest.
  const sameCategory = places.filter(
    (p) => p.category === place.category && p.slug !== place.slug
  );
  const nearest = places
    .filter((p) => p.slug !== place.slug && p.category !== place.category)
    .sort((a, b) => distanceKm(place, a) - distanceKm(place, b));
  const related = [...sameCategory, ...nearest].slice(0, 3);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 standalone:px-3 standalone:py-4 sm:px-6 sm:py-12">
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
        className={`relative flex h-56 items-center justify-center overflow-hidden rounded-3xl shadow-lg standalone:h-40 sm:h-64 ${placeGradient(place)}`}
      >
        {/* A famous place gets its own picture; anything else falls back to
            its category, which is the right answer when the category IS the
            identity — a restaurant is a restaurant. */}
        {hasPlaceArt(place.slug) ? (
          <PlaceArt place={place} className="absolute inset-0 h-full w-full" />
        ) : (
          <CategoryArt
            category={place.category}
            variant={placeVariant(place.slug)}
            className="absolute inset-0 h-full w-full"
          />
        )}
        <span
          className="absolute start-4 top-4 flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-sm font-semibold text-ink-800 shadow-sm backdrop-blur"
          aria-label={`التقييم ${toArabicDigits(place.rating.toFixed(1))} من ٥`}
        >
          <IconStar className="size-4 text-sun-500" />
          {toArabicDigits(place.rating.toFixed(1))}
        </span>
      </div>

      {/* Header */}
      <div className="mt-7 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <BusinessBrand place={place} />
          <div>
          <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">
            {place.nameAr}
          </h1>
          <p className="mt-1 text-lg text-ink-500">
            <span lang="en" dir="ltr">
              {place.name}
            </span>
          </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {category && (
            <span className="rounded-full bg-sea-50 px-3 py-1.5 text-sm font-semibold text-sea-700">
              {category.ar}
            </span>
          )}
          <span
            className="flex items-center gap-1.5 rounded-full bg-sand-100 px-3 py-1.5 text-sm font-semibold text-sand-800"
            aria-label={`مستوى السعر ${toArabicDigits(place.priceLevel)} من ٣`}
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
        <IconPinSolid className="size-4 text-coral-600" />
        {place.areaAr}، الكويت
      </p>

      <p className="mt-6 text-lg leading-relaxed text-ink-600">{place.descriptionAr}</p>

      <BusinessBio place={place} />
      <BusinessContact place={place} />
      <BusinessProducts place={place} />
      <OrderPanel place={place} />
      <QueuePanel place={place} />
      <ShareHangout place={place} />
      <BusinessGallery place={place} />

      {/* Details */}
      <div className="mt-9 grid gap-4 standalone:mt-5 standalone:gap-3 sm:grid-cols-2">
        <div className="rounded-3xl border border-line bg-white p-6 shadow-sm standalone:p-4">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
            <IconSparkle className="size-5 text-sun-600" />
            أبرز ما فيه
          </h2>
          <ul className="mt-3 space-y-2.5">
            {place.highlightsAr.map((h) => (
              <li key={h} className="flex items-start gap-2 text-sm text-ink-600">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-palm-500" />
                {h}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-3xl border border-line bg-white p-6 shadow-sm standalone:p-4">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
            <IconClock className="size-5 text-sea-600" />
            أحسن وقت للزيارة
          </h2>
          <p className="mt-2.5 text-sm text-ink-600">{place.bestTimeAr}</p>

          <h2 className="mt-6 flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
            <IconCoins className="size-5 text-sand-600" />
            مستوى الأسعار
          </h2>
          <p className="mt-2.5 text-sm text-ink-600">{priceLabel[place.priceLevel]}</p>

          {/* Kuwait's weather decides most outings for a third of the year, so
              it belongs on the page and not only in the search index. */}
          <h2 className="mt-6 flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
            <IconSun className="size-5 text-sun-600" />
            الجو والموسم
          </h2>
          <p className="mt-2.5 flex flex-wrap items-center gap-2 text-sm text-ink-600">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${SETTING_TONE[place.setting]}`}>
              {SETTING_LABEL[place.setting]}
            </span>
            {place.seasonAr}
          </p>
        </div>
      </div>

      <PlaceMap place={place} related={related} />

      {/* Related */}
      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-5 font-display text-2xl font-bold text-ink-900">
            أماكن مشابهة
          </h2>
          <div className="grid gap-5 standalone:gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((p) => (
              <PlaceCard key={p.slug} place={p} />
            ))}
          </div>
        </section>
      )}

      <div className="mt-12 text-center">
        <Link
          href="/explore"
          className="inline-flex items-center gap-2 rounded-xl border border-line-control bg-white px-6 py-3 font-semibold text-ink-700 shadow-sm transition hover:border-sea-300 hover:text-sea-700"
        >
          <IconBack className="size-4" />
          رجوع للاستكشاف
        </Link>
      </div>
    </div>
  );
}
