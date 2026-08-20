import { IconCheck, IconGlobe, IconInstagram, IconPhone, IconSparkle } from "@/components/icons";
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
    <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-white shadow-sm sm:size-20">
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
    <section className="mt-8 rounded-3xl border border-line bg-sand-100/70 p-5 standalone:mt-5 standalone:rounded-2xl standalone:p-4 sm:p-6">
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

/**
 * The place's own channels — call it, find it on Instagram, open its site.
 *
 * Rendered only from fields the owner gave for display and an admin approved;
 * the submitter's personal contact details never reach the Place record at
 * all, so there is nothing here to accidentally leak. The website href is
 * safe as-is because the database rejects any stored value that is not
 * http(s) — see the CHECK on places.website.
 */
export function BusinessContact({ place }: { place: Place }) {
  const phone = place.phone?.trim();
  const instagram = place.instagram?.trim();
  const website = place.website?.trim();
  if (!phone && !instagram && !website) return null;

  const item =
    "flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm " +
    "font-semibold text-ink-700 shadow-sm transition hover:border-sea-300 hover:text-sea-700";

  return (
    <section className="mt-8 standalone:mt-5" aria-label="تواصل مع المكان">
      <h2 className="mb-3 text-sm font-semibold text-ink-700">تواصل معهم</h2>
      <ul className="flex flex-wrap gap-2">
        {phone && (
          <li>
            <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className={item}>
              <IconPhone className="size-4 text-palm-600" />
              <span dir="ltr">{phone}</span>
            </a>
          </li>
        )}
        {instagram && (
          <li>
            <a
              href={`https://www.instagram.com/${encodeURIComponent(instagram)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={item}
            >
              <IconInstagram className="size-4 text-coral-600" />
              <span dir="ltr">@{instagram}</span>
            </a>
          </li>
        )}
        {website && (
          <li>
            <a href={website} target="_blank" rel="noopener noreferrer" className={item}>
              <IconGlobe className="size-4 text-sea-600" />
              الموقع الإلكتروني
            </a>
          </li>
        )}
      </ul>
    </section>
  );
}

/** What the business sells or offers, as compact scannable chips. */
export function BusinessProducts({ place }: { place: Place }) {
  const products = place.productsAr ?? [];
  if (products.length === 0) return null;
  return (
    <section className="mt-8 standalone:mt-5" aria-label="المنتجات والخدمات">
      <h2 className="mb-3 font-display text-2xl font-bold text-ink-900">المنتجات والخدمات</h2>
      <ul className="flex flex-wrap gap-2">
        {products.map((item) => (
          <li
            key={item}
            className="flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-sand-100/70 px-3.5 text-sm font-semibold text-ink-700"
          >
            <IconCheck className="size-3.5 shrink-0 text-palm-600" />
            {item}
          </li>
        ))}
      </ul>
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
      <ul className="grid grid-cols-2 gap-3 standalone:gap-2 sm:grid-cols-3">
        {images.map((url, i) => (
          <li
            key={url}
            className={`overflow-hidden rounded-2xl border border-line bg-sand-100 ${
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
