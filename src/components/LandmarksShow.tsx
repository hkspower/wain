"use client";

import Link from "next/link";
import { useState } from "react";
import { IconGo, IconPause, IconPinSolid, IconPlay } from "@/components/icons";

export interface LandmarkSlide {
  slug: string;
  name: string;
  area: string;
  avif: string;
  webp: string;
  src: string;
}

/**
 * «معالم الكويت» — one landmark at a time, under the home hero.
 *
 * The owner picked this shape (option B on the 2 October canvas) over a rail of
 * cards and a drifting filmstrip. Six slides are stacked in one box; each holds
 * the screen for 6s of a 36s loop and crossfades into the next, while its
 * picture drifts slowly (the same `kb-a`/`kb-b` /find uses, 9s and
 * alternating, so neighbours move in opposite directions).
 *
 * **The cycle is CSS, the pause is React.** All six run one keyframe,
 * `landmark-fade`, offset by 6s each, and `visibility` is keyframed with the
 * opacity — so the slides that are not showing cannot be tapped or tabbed to,
 * and the link under a finger is always the one on screen. The only state is
 * the pause, and that is why this is a client component at all: a show that
 * moves on its own for more than five seconds needs a way to stop it (WCAG
 * 2.2.2). Pausing freezes every animation where it stands, the slide included.
 *
 * It is handed six plain rows by the page, never the catalogue: importing
 * places.ts here would put all 52 records into the home page's JavaScript.
 *
 * Reduced motion: the global rule in globals.css shortens every animation to
 * nothing, and `.landmark-show` adds that the first slide is the one left
 * standing — otherwise the fade would end on «hidden» for all six.
 */
export default function LandmarksShow({ slides }: { slides: LandmarkSlide[] }) {
  const [paused, setPaused] = useState(false);

  return (
    <section aria-labelledby="landmarks-h" className={`landmark-show bg-sand-50 ${paused ? "is-paused" : ""}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-2.5 pt-4 pb-2 sm:px-4 sm:pt-6 sm:pb-3">
        <h2 id="landmarks-h" className="font-display text-lg font-bold text-ink-900 sm:text-2xl">
          معالم الكويت
        </h2>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          aria-label={paused ? "شغّل الحركة" : "وقّف الحركة"}
          className="grid size-11 place-items-center rounded-full border border-line bg-white text-ink-700 shadow-sm transition hover:bg-sand-100 active:scale-[0.96]"
        >
          {paused ? <IconPlay className="size-4" /> : <IconPause className="size-4" />}
        </button>
      </div>

      <div className="relative h-[330px] overflow-hidden bg-ink-900 sm:h-[460px] lg:h-[560px]">
        {slides.map((s, i) => (
          <Link
            key={s.slug}
            href={`/places/${s.slug}`}
            data-landmark={s.slug}
            className={`landmark-slide absolute inset-0 block text-white ${i === 0 ? "is-first" : ""}`}
            style={{ animationDelay: `${i * 6}s` }}
          >
            <picture>
              <source type="image/avif" srcSet={s.avif} sizes="100vw" />
              <source type="image/webp" srcSet={s.webp} sizes="100vw" />
              {/* alt="": the link already says which place this is, in the
                  caption under it, and a picture that repeated the name would
                  make a screen reader say it twice. */}
              <img
                src={s.src}
                alt=""
                width={960}
                height={640}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                className={`absolute inset-0 size-full object-cover ${i % 2 ? "landmark-kb-b" : "landmark-kb-a"}`}
              />
            </picture>
            <div className="absolute inset-x-0 bottom-0 bg-ink-900/75 lg:bottom-7 lg:bg-transparent">
              <div className="mx-auto flex max-w-6xl items-end justify-between gap-3 px-2.5 py-3.5 sm:px-4 lg:block lg:py-0">
                <div className="flex min-w-0 flex-col gap-0.5 lg:max-w-md lg:gap-2.5 lg:rounded-2xl lg:bg-ink-900/75 lg:px-6 lg:py-5">
                  <span className="font-display text-xl font-bold leading-snug lg:text-3xl">{s.name}</span>
                  <span className="flex items-center gap-1 text-sm text-sand-200 lg:text-base">
                    <IconPinSolid className="size-3.5 shrink-0" />
                    {s.area}
                  </span>
                  <span className="mt-1 hidden min-h-11 items-center gap-1.5 self-start rounded-full bg-white px-4 text-sm font-semibold text-ink-900 lg:inline-flex">
                    شوف المكان
                    <IconGo className="size-4" />
                  </span>
                </div>
                <span className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-ink-900 lg:hidden">
                  شوف المكان
                  <IconGo className="size-4" />
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div aria-hidden="true" className="flex h-9 items-center justify-center gap-1.5 sm:h-11 sm:gap-2">
        {slides.map((s, i) => (
          <span
            key={s.slug}
            className={`landmark-dot block h-2 w-2 rounded-full bg-line-strong ${i === 0 ? "is-first" : ""}`}
            style={{ animationDelay: `${i * 6}s` }}
          />
        ))}
      </div>
    </section>
  );
}
