"use client";

import { useEffect, useRef } from "react";

/**
 * The home picture, AVIF first — and the WebP when the AVIF cannot be drawn.
 *
 * A <picture> picks its source by type, once, and never falls back after a
 * decode error: a source the browser claims to support and then cannot decode
 * leaves an empty box. Safari in Lockdown Mode is that browser. It answers
 * `image/avif` as supported when choosing among sources and then refuses to
 * decode one (Lockdown decodes only WebP, JPEG, PNG and GIF), so the hero —
 * the wordmark and «وين الطلعة اليوم؟» are IN the picture — was a white box
 * with the sun's button floating on it (8 October, read out of WebKit).
 *
 * So when the image errors on an .avif, its <source> goes, which makes the
 * picture choose again and land on the WebP. Checked on mount as well as on
 * `error`: an AVIF refused before hydration has already fired its error.
 */
export default function HeroPicture({
  avif,
  webp,
  src,
  width,
  height,
  sizes,
}: {
  avif: string;
  webp: string;
  src: string;
  width: number;
  height: number;
  sizes: string;
}) {
  const img = useRef<HTMLImageElement>(null);
  const avifSource = useRef<HTMLSourceElement>(null);

  useEffect(() => {
    const el = img.current;
    if (!el) return;
    const fallBack = () => {
      if (!/\.avif(?:[?#]|$)/.test(el.currentSrc)) return;
      avifSource.current?.remove();
    };
    if (el.complete && el.naturalWidth === 0) fallBack();
    el.addEventListener("error", fallBack);
    return () => el.removeEventListener("error", fallBack);
  }, []);

  return (
    <picture>
      <source ref={avifSource} type="image/avif" srcSet={avif} sizes={sizes} />
      <source type="image/webp" srcSet={webp} sizes={sizes} />
      {/* A plain <img>, for PlacePhoto's reason: a static export has no
          optimiser, and the sizes were made at build time by
          `npm run home-hero`. Not lazy — it is the first thing painted.
          (no-img-element does not fire inside <picture>.) */}
      <img
        ref={img}
        src={src}
        width={width}
        height={height}
        alt=""
        fetchPriority="high"
        className="absolute inset-0 size-full select-none"
        draggable={false}
      />
    </picture>
  );
}
