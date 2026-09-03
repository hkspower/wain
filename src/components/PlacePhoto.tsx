import { photoOf, photoSrc, PHOTO_WIDTH, PHOTO_HEIGHT } from "@/lib/photos";

/**
 * The photograph of a place, where there is one.
 *
 * A plain `<img>`, and deliberately not `next/image`: this site is a static
 * export, so the optimiser is off and `next/image` would ship a client
 * component and a wrapper to serve the same file this serves directly. The
 * resizing it would have done is done at build time by `npm run photos`.
 *
 * `width` and `height` are the real dimensions of every file the pipeline
 * writes, so the box is reserved before the bytes arrive and the page does not
 * jump — the hero is the first thing painted, which makes it the most
 * expensive place on the site to shift.
 *
 * Not lazy. A lazy hero is a hero that arrives after the reader has already
 * looked at it; `fetchPriority="high"` says the opposite, which is the truth
 * for the one image above the fold.
 */
export default function PlacePhoto({
  slug,
  className = "",
}: {
  slug: string;
  className?: string;
}) {
  const photo = photoOf(slug);
  if (!photo) return null;

  return (
    /**
     * The rule this silences assumes an optimising loader is available. This
     * project sets `images: { unoptimized: true }` because `output: "export"`
     * has no server to optimise on, so `next/image` here would ship a client
     * component and a wrapper to emit this exact tag against this exact file.
     * The resizing it is warning about the absence of already happened, at
     * build time, in `npm run photos`.
     */
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photoSrc(slug)}
      alt={photo.altAr}
      width={PHOTO_WIDTH}
      height={PHOTO_HEIGHT}
      decoding="async"
      fetchPriority="high"
      className={`object-cover ${className}`}
    />
  );
}

/**
 * The credit line, for the licences that require it on the page.
 *
 * Small and low-contrast on purpose — it is a legal obligation and an act of
 * courtesy, not part of what the reader came for. It still clears 4.5:1
 * against the ground it sits on, because «too small to matter» is how credits
 * end up unreadable and the obligation unmet.
 */
export function PhotoCredit({ slug }: { slug: string }) {
  const photo = photoOf(slug);
  if (!photo?.creditOnPage) return null;

  return (
    <p className="mt-2 text-2xs text-ink-500">
      الصورة: {photo.credit} — {photo.licence}
    </p>
  );
}
