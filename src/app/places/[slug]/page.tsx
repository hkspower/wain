import { notFound } from "next/navigation";
import type { Metadata } from "next";
import CategoryArt from "@/components/CategoryArt";
import PlaceArt, { hasPlaceArt } from "@/components/PlaceArt";
import PlacePhoto, { PhotoCredit } from "@/components/PlacePhoto";
import PlaceCard from "@/components/PlaceCard";
import PlaceLive from "@/components/PlaceLive";
import {
  distanceKm,
  getPlace,
  placeGradient,
  placeVariant,
  places,
} from "@/lib/places";
import { photoOf } from "@/lib/photos";

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
  if (!place) return { title: "المكان مو موجود" };
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

export default async function PlacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const place = getPlace(slug);
  if (!place) notFound();

  // Same-category places first; if that's thin (some categories have a
  // single place), fill with whatever is physically closest.
  // Nearest first inside the category, not catalogue order. The cards say how
  // far each one is now, and «١٫٦ · ٣٫٣ · ٢٫٠» in that order reads as a list
  // somebody forgot to sort — which it was; the number was simply never shown.
  const sameCategory = places
    .filter((p) => p.category === place.category && p.slug !== place.slug)
    .sort((a, b) => distanceKm(place, a) - distanceKm(place, b));
  const nearest = places
    .filter((p) => p.slug !== place.slug && p.category !== place.category)
    .sort((a, b) => distanceKm(place, a) - distanceKm(place, b));
  const related = [...sameCategory, ...nearest].slice(0, 3);

  /**
   * Everything below is rendered HERE, on the server, and handed to the client
   * component as finished markup.
   *
   * `PlaceArt` and `CategoryArt` are 19KB of drawings between them and
   * `PlaceCard` pulls the icon set; none of it is typed by an admin, and all of
   * it would otherwise be shipped as JavaScript to every place page for the
   * sake of live text. Passed as props it costs nothing — React sends the
   * output, not the code.
   */
  const art = photoOf(place.slug) ? (
    <PlacePhoto slug={place.slug} className="absolute inset-0 h-full w-full" />
  ) : hasPlaceArt(place.slug) ? (
    <PlaceArt place={place} className="absolute inset-0 h-full w-full" />
  ) : (
    <CategoryArt
      category={place.category}
      variant={placeVariant(place.slug)}
      className="absolute inset-0 h-full w-full"
    />
  );

  const relatedNode = related.length > 0 && (
    <section className="mt-12">
      <h2 className="mb-2 font-display text-xl font-bold text-ink-900">
        أماكن مشابهة
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {related.map((p) => (
          <PlaceCard key={p.slug} place={p} awayKm={distanceKm(place, p)} />
        ))}
      </div>
    </section>
  );

  return (
    <PlaceLive
      slug={slug}
      initial={place}
      heroClass={placeGradient(place)}
      art={art}
      /* Renders nothing unless the photograph's licence needs it named. */
      credit={<PhotoCredit slug={place.slug} />}
      related={relatedNode}
      relatedPlaces={related}
    />
  );
}
