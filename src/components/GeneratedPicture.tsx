/**
 * A generated picture of a landmark, from scripts/gen-landmarks.mjs.
 *
 * A plain `<picture>`, for the reason PlacePhoto gives: this is a static
 * export, so `next/image` would ship a client wrapper to emit the same tag.
 * AVIF first, WebP for the browsers without it, and `width`/`height` so the
 * box is reserved before the bytes arrive.
 *
 * `focus` is where the landmark sits in the picture; it becomes the
 * object-position, so a box of another shape crops around the tower rather
 * than around the middle of the sky. `priority` is for the one picture that is
 * the first thing a page paints (a place page's top); every other one is lazy.
 *
 * A stand-in is only ever rendered in a preview build (landmark-gate.ts), and
 * there it says what it is: an orange «رسم مؤقت», away from where the
 * «صورة توضيحية» tag sits, so it cannot be mistaken for the tag being judged.
 */
export default function GeneratedPicture({
  avif,
  webp,
  src,
  width,
  height,
  sizes,
  focus,
  alt = "",
  priority = false,
  source,
  className = "",
  flag = true,
  flagClassName = "end-0 top-0 rounded-es-lg",
}: {
  avif: string;
  webp: string;
  src: string;
  width: number;
  height: number;
  sizes: string;
  focus?: readonly [number, number];
  alt?: string;
  priority?: boolean;
  source: "ai" | "stand-in";
  className?: string;
  /**
   * False when the caller places the flag itself: the slideshow's picture
   * drifts, and a flag inside it drifted half out of the box.
   */
  flag?: boolean;
  /** Where a preview build's «رسم مؤقت» goes, when the corner is taken. */
  flagClassName?: string;
}) {
  return (
    <>
      <picture>
        <source type="image/avif" srcSet={avif} sizes={sizes} />
        <source type="image/webp" srcSet={webp} sizes={sizes} />
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          data-generated={source}
          style={focus ? { objectPosition: `${focus[0] * 100}% ${focus[1] * 100}%` } : undefined}
          className={`object-cover ${className}`}
        />
      </picture>
      {flag && source === "stand-in" && <StandInFlag className={flagClassName} />}
    </>
  );
}

/** A preview build's «رسم مؤقت», placed by `className`. */
export function StandInFlag({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      data-stand-in
      className={`pointer-events-none absolute z-[1] bg-sun-700 px-1.5 py-px text-2xs font-bold whitespace-nowrap text-white ${className}`}
    >
      رسم مؤقت
    </span>
  );
}
