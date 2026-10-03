"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * «إلى وين؟ ابدأ», fixed at the foot of the screen while the hero's sun is
 * still below it.
 *
 * The hero is the owner's picture at full width (HomeHero.tsx), so on a
 * computer it is about two and a half screens tall: at 1280×800 the first
 * screen was the wordmark and nothing to press, with the sun 52px under the
 * fold (959px at 1440×900). This bar is the same offer as the sun, shown only
 * until the sun itself is on screen — so a phone, where the sun is in the
 * first screen, never sees it, and nothing about the picture had to change.
 *
 * Starts hidden and decides after mount: rendering it visible from the server
 * would flash it on every phone for the frame before the observer answered.
 * `inert` while hidden, so a link nobody can see is not a Tab stop either.
 */
export default function StartBar() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const sun = document.querySelector("[data-hero-sun]");
    if (!sun || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => setShow(!e.isIntersecting && e.boundingClientRect.top > 0),
      { threshold: 0.25 }
    );
    io.observe(sun);
    return () => io.disconnect();
  }, []);

  return (
    <div
      data-start-bar
      inert={!show}
      className={`pointer-events-none fixed inset-x-0 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 flex justify-center transition duration-300 standalone:hidden ${
        show ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
    >
      <Link
        href="/find"
        className="pointer-events-auto inline-flex min-h-tap items-center gap-3 rounded-full bg-ink-900 py-2 pe-2 ps-5 font-semibold text-white shadow-xl transition hover:bg-ink-800 active:scale-[0.98]"
      >
        <span className="font-display text-lg">إلى وين؟</span>
        <span className="rounded-full bg-sun-400 px-4 py-1.5 text-sm text-ink-900">ابدأ</span>
      </Link>
    </div>
  );
}
