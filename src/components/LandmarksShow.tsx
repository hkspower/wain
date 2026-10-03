"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import GeneratedPicture, { StandInFlag } from "@/components/GeneratedPicture";
import IllustrativeTag from "@/components/IllustrativeTag";
import { IconGo, IconPause, IconPinSolid, IconPlay } from "@/components/icons";
import { toArabicDigits } from "@/lib/place-kit";

export interface LandmarkSlide {
  slug: string;
  name: string;
  area: string;
  avif: string;
  webp: string;
  src: string;
  width: number;
  height: number;
  focus: readonly [number, number];
  source: "ai" | "stand-in";
}

/**
 * «معالم الكويت» — one landmark at a time, under the home hero.
 *
 * Direction A, «القصة», the owner's pick on the 3 October canvas: the picture
 * edge to edge, a row of progress bars across its top that are also the way to
 * jump, and the name over a dark fade at its foot. It replaced a CSS loop whose
 * dots could not be tapped, whose pause button said nothing, and whose fixed
 * 330px box cut every picture differently at every width.
 *
 * **The clock is the progress bar.** The bar of the slide on screen fills over
 * six seconds as a CSS animation, and its `animationend` moves the show on — so
 * holding the show is pausing that one animation, and the bar shows exactly
 * how long is left. Held while the visitor has pressed «وقّف», while a mouse
 * rests on it, and while the tab is in the background; stopped for good when
 * keyboard focus comes inside (WAI's carousel pattern), except on the
 * rotation button itself, or pressing «كمّل» would stop what it had started.
 * Under reduced motion there is no animation, so nothing ever moves on — the
 * first landmark simply stays, and the bars and a swipe still work.
 *
 * Only the slide on screen can be tapped or tabbed to: the others are `inert`.
 * The words sit on a fade dark enough under them for any picture (the
 * arithmetic is at the fade), and audit:home-hero checks each real picture.
 *
 * It is handed six plain rows by the page, never the catalogue: importing
 * places.ts here would put all 52 records into the home page's JavaScript.
 */
export default function LandmarksShow({ slides }: { slides: LandmarkSlide[] }) {
  const n = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [hidden, setHidden] = useState(false);
  // The pictures that may load: the one on screen and the next, then every one
  // visited. Six stacked pictures would otherwise all load at once.
  const [seen, setSeen] = useState(() => new Set([0, 1 % n]));
  const press = useRef<{ x: number; y: number } | null>(null);

  const go = (k: number) => {
    const i = ((k % n) + n) % n;
    setIndex(i);
    setSeen((s) => (s.has(i) && s.has((i + 1) % n) ? s : new Set([...s, i, (i + 1) % n])));
  };

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const held = paused || hover || hidden;

  function onFocus(e: FocusEvent<HTMLElement>) {
    const t = e.target as HTMLElement;
    if (t.matches(":focus-visible") && !t.hasAttribute("data-rotation")) setPaused(true);
  }

  function onPointerDown(e: PointerEvent) {
    press.current = { x: e.clientX, y: e.clientY };
  }

  // A sideways swipe moves the show — on to the next landmark when the finger
  // travels right, the way an Arabic row reads — and the click after a drag is
  // eaten, so a swipe never opens the place it started on. Eaten on the
  // window, in the capture phase: RouteTransitions takes link clicks on the
  // document's capture phase to start its transition, which is before any
  // handler on the link itself could say no.
  function onPointerUp(e: PointerEvent) {
    const p = press.current;
    press.current = null;
    if (!p) return;
    const dx = e.clientX - p.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - p.y)) {
      const eat = (c: MouseEvent) => {
        c.preventDefault();
        c.stopPropagation();
      };
      window.addEventListener("click", eat, { capture: true, once: true });
      // A touch swipe is not followed by a click; do not eat the next tap.
      setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 0);
      go(dx > 0 ? index + 1 : index - 1);
    }
  }

  return (
    <section
      aria-labelledby="landmarks-h"
      aria-roledescription="عرض"
      onFocus={onFocus}
      className={`landmark-show bg-sand-50 pb-2 sm:pb-3 ${held ? "is-held" : ""}`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-2.5 pt-4 pb-2 sm:px-4 sm:pt-6 sm:pb-3">
        <h2 id="landmarks-h" className="font-display text-lg font-bold text-ink-900 sm:text-2xl">
          معالم الكويت
        </h2>
        <button
          type="button"
          data-rotation
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "كمّل العرض" : "وقّف العرض"}
          className="inline-flex min-h-tap items-center gap-1.5 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-700 shadow-sm transition hover:bg-sand-100 active:scale-[0.96]"
        >
          {paused ? <IconPlay className="size-4" /> : <IconPause className="size-4" />}
          {paused ? "كمّل" : "وقّف"}
        </button>
      </div>

      {/* Edge to edge below lg, like the hero above it, and inside the page's
          width from lg. The cap is lg-only on purpose: a capped box with no
          padding is what audit:padding reads as a page with no gutter, and on
          a phone this is a picture, not a page. */}
      <div className="lg:mx-auto lg:max-w-6xl lg:px-4">
        <div
          data-landmark-box
          aria-live={paused ? "polite" : "off"}
          onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
          onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          // A picture is natively draggable, and a mouse drag that starts one
          // never sends the pointerup a swipe needs — the test that drags with
          // a mouse found it. Nothing in the box is meant to be dragged out.
          onDragStart={(e) => e.preventDefault()}
          onAnimationEnd={(e) => {
            if (e.animationName !== "landmark-fill") return;
            // The bar has no animation under reduced motion, but a browser
            // that ends one instantly must not spin the show through all six.
            if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
            go(index + 1);
          }}
          className="relative aspect-[6/5] touch-pan-y overflow-hidden bg-ink-900 sm:aspect-[2/1] lg:rounded-3xl"
        >
          {slides.map((s, i) => {
            const on = i === index;
            return (
              <Link
                key={s.slug}
                href={`/places/${s.slug}`}
                data-landmark={s.slug}
                draggable={false}
                inert={!on}
                aria-hidden={on ? undefined : true}
                className={`landmark-slide absolute inset-0 block text-white ${on ? "is-on" : ""}`}
              >
                <span className={`landmark-drift absolute inset-0 block ${i % 2 ? "is-b" : "is-a"}`}>
                  {seen.has(i) && (
                    <GeneratedPicture
                      {...s}
                      sizes="(min-width: 1152px) 1120px, 100vw"
                      className="absolute inset-0 size-full"
                      flag={false}
                    />
                  )}
                </span>
                {/* Outside the drift, which would carry it half out of the box. */}
                {s.source === "stand-in" && <StandInFlag className="end-0 top-1/3 rounded-s-lg" />}
                <IllustrativeTag className="start-2.5 top-12 sm:start-4 lg:start-6" />
                {/* The fade under the words, built for the worst picture: white
                    text needs the dark at 82% or more under 14px and 70% under
                    the 20px name, so 90% at the foot easing to 80% halfway up
                    covers both lines on a white sky. Above them it lets the
                    picture through. */}
                <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-ink-900/90 via-ink-900/80 via-45% to-ink-900/0 px-2.5 pt-16 pb-3.5 sm:px-4 lg:px-7 lg:pt-28 lg:pb-6">
                  <span className="flex min-w-0 flex-col gap-0.5 lg:gap-1">
                    <span className="font-display text-xl font-bold leading-snug lg:text-3xl">{s.name}</span>
                    <span className="flex items-center gap-1 text-sm lg:text-base">
                      <IconPinSolid className="size-3.5 shrink-0" />
                      {s.area}
                    </span>
                  </span>
                  <span className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-ink-900">
                    شوف المكان
                    <IconGo className="size-4" />
                  </span>
                </span>
              </Link>
            );
          })}

          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-ink-900/55 to-ink-900/0" />
          <div role="group" aria-label="اختر معلم" className="absolute inset-x-0 top-0 flex gap-1 px-2.5 sm:px-4 lg:gap-1.5 lg:px-6">
            {slides.map((s, i) => (
              <button
                key={s.slug}
                type="button"
                onClick={() => go(i)}
                aria-label={`${toArabicDigits(i + 1)} من ${toArabicDigits(n)}، ${s.name}`}
                aria-current={i === index ? "true" : undefined}
                className="flex h-11 flex-1 items-center"
              >
                <span
                  className={`landmark-seg block h-0.75 w-full overflow-hidden rounded-full bg-white/40 ${
                    i < index ? "is-done" : i === index ? "is-run" : ""
                  }`}
                >
                  <span className="block h-full bg-white" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
