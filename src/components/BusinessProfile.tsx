import { IconCheck, IconSparkle } from "@/components/icons";
import type { Place } from "@/lib/places";

/**
 * The parts of a place page that exist only when a business registered itself
 * and an admin approved what it sent: the brand mark, the business in its own
 * words, and photos.
 *
 * Every one of these is optional and absent on the seeded places, so those
 * pages render exactly as they did.
 *
 * Plain <img>: the site is a static export with no image optimiser, and these
 * are remote URLs from Supabase storage. Dimensions are declared so the layout
 * does not jump when they load, and everything below the fold is lazy.
 */

export function BusinessBrand({ place }: { place: Place }) {
  if (!place.logoUrl) return null;
  return (
    <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-sm sm:size-20">
      {/* eslint-disable-next-line @next/next/no-img-element -- remote URL, static export */}
      <img
        src={place.logoUrl}
        alt={`شعار ${place.nameAr}`}
        width={80}
        height={80}
        className="size-full object-contain"
      />
    </span>
  );
}

export function BusinessBio({ place }: { place: Place }) {
  if (!place.bioAr?.trim()) return null;
  return (
    <section className="mt-8 rounded-3xl border border-sand-200 bg-sand-100/70 p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-700">
        <IconSparkle className="size-4 text-sun-600" />
        بكلامهم
      </h2>
      {/* Marked as a quotation because it is theirs, not ours — the editorial
          description above is the site speaking. */}
      <blockquote className="mt-2 text-lg leading-relaxed text-ink-700">
        {place.bioAr}
      </blockquote>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500">
        <IconCheck className="size-3.5 text-palm-600" />
        من صاحب المكان، وراجعناها قبل النشر.
      </p>
    </section>
  );
}

export function BusinessGallery({ place }: { place: Place }) {
  const images = place.imageUrls ?? [];
  if (images.length === 0) return null;

  return (
    <section className="mt-9 standalone:mt-5">
      <h2 className="mb-4 font-display text-2xl font-bold text-ink-900">صور المكان</h2>
      {/* First image leads at double width where there is room, so a gallery of
          three does not read as a row of thumbnails. */}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((url, i) => (
          <li
            key={url}
            className={`overflow-hidden rounded-2xl border border-sand-200 bg-sand-100 ${
              i === 0 && images.length > 1 ? "col-span-2 row-span-2" : ""
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- remote URL, static export */}
            <img
              src={url}
              alt={`${place.nameAr} — صورة ${i + 1}`}
              width={i === 0 ? 800 : 400}
              height={i === 0 ? 800 : 400}
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              className="aspect-square size-full object-cover transition duration-500 hover:scale-[1.03]"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
