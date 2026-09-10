"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Puts you back where you were when you come back to a list.
 *
 * ## What was wrong
 *
 * Leaving /explore at 1800px and pressing back landed at 643px, every time, on
 * a 52-card list. Measured with a requestAnimationFrame recorder that survives
 * client-side navigation: the browser applies its restore in the SAME frame
 * the list comes back, while the document is still part-built, and clamps 1800
 * against a height that is not there yet. 643 is exactly `1487 - 844`, a
 * viewport short of a document that had not finished growing.
 *
 * Three suspects were cleared by measurement first, each of which looked
 * obviously guilty: the View Transition wrapper (identical with it disabled),
 * `content-visibility` on the cards (identical with it forced visible), and
 * the stale `contain-intrinsic-size` (fixed separately, number did not move).
 *
 * ## The part that is easy to get wrong twice
 *
 * That same clamp fires on the way OUT. Leaving a tall list for a shorter page
 * momentarily shrinks the document, the browser drags the scroll position down
 * with it, and a naive recorder writes the clamped value over the real one —
 * so the memory is corrupted before the restore ever runs. Two versions of
 * this file died there: the first wrote `window.scrollY` in an effect cleanup,
 * which runs after the router has already scrolled the new screen to the top
 * and so recorded 0; the second recorded from a scroll listener and faithfully
 * captured the clamp, recording 643.
 *
 * So recording FREEZES the instant a navigation begins — on the click that
 * starts it, or on `popstate` — and thaws when the next screen arrives. The
 * value written at that moment is the last one the reader actually chose.
 *
 * ## What it will not do
 *
 * - **Restore on forward navigation.** Opening a place you have opened before
 *   starts at the top like anything else. The restore is gated on a `popstate`
 *   having fired; the router's own scroll-to-top on push stays untouched.
 * - **Fight the reader.** A wheel, touch, key or pointer cancels a pending
 *   restore, because a page that yanks itself out from under a thumb is worse
 *   than one that forgot.
 * - **Hang.** If the document never grows tall enough it gives up after a
 *   second and leaves the scroll where the router put it, which is the old
 *   behaviour rather than a freeze.
 * - **Call `useSearchParams`.** This sits in the root layout, and that hook
 *   suspends its caller during static rendering — it would wrap the whole app
 *   shell in the very collapse-for-a-frame that causes the bug above. The
 *   query string is read from `location` inside effects, which only ever run
 *   on the client, so there is nothing to suspend for.
 *
 * One gap, stated rather than hidden: a route change made by calling the
 * router directly rather than by clicking a link — شوق's `open_place` is the
 * only one — does not freeze the recorder, so it can still record a clamp on
 * the way out. It costs a scroll position on a screen she navigated away from,
 * and correcting it would mean coupling this to her call.
 */
const KEY = "wain:scroll";

function readAll(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function writeOne(key: string, y: number) {
  try {
    const all = readAll();
    all[key] = y;
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode, or storage disabled — forgetting is an acceptable failure */
  }
}

const hereNow = () => location.pathname + location.search;

export default function ScrollMemory() {
  const pathname = usePathname();
  const popped = useRef(false);
  const frozen = useRef(false);
  /** Last position the reader actually scrolled to, before any clamp. */
  const lastY = useRef(0);

  // Run once: take the restore off the browser, and freeze the recorder
  // whenever a navigation starts.
  useEffect(() => {
    const previous = "scrollRestoration" in history ? history.scrollRestoration : null;
    if (previous !== null) history.scrollRestoration = "manual";

    const onPop = () => {
      popped.current = true;
      frozen.current = true;
    };
    // Capture phase, so the position is banked before the router does anything
    // with the click. This runs for keyboard activation too — pressing Enter
    // on a focused link dispatches a click like any other.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor?.getAttribute("href")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, location.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      writeOne(hereNow(), lastY.current);
      frozen.current = true;
    };
    // A real unload — an external link, a refresh — is the other way out.
    const onHide = () => writeOne(hereNow(), lastY.current);

    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick, true);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", onHide);
      if (previous !== null) history.scrollRestoration = previous;
    };
  }, []);

  useEffect(() => {
    const here = pathname + location.search;
    frozen.current = false;
    lastY.current = Math.round(window.scrollY);

    // rAF-coalesced, so a flick down a long list writes once a frame at worst.
    let queued = false;
    const onScroll = () => {
      if (frozen.current || queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (frozen.current) return;
        lastY.current = Math.round(window.scrollY);
        writeOne(here, lastY.current);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };
    const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

    if (popped.current) {
      popped.current = false;
      const target = readAll()[here];
      if (typeof target === "number" && target > 0 && Math.abs(window.scrollY - target) > 2) {
        for (const type of inputs) window.addEventListener(type, cancel, { passive: true });
        const deadline = performance.now() + 1000;
        const attempt = () => {
          if (cancelled) return;
          if (document.documentElement.scrollHeight - window.innerHeight >= target) {
            window.scrollTo(0, target);
            lastY.current = target;
            return;
          }
          if (performance.now() < deadline) requestAnimationFrame(attempt);
        };
        requestAnimationFrame(attempt);
      }
    }

    return () => {
      cancelled = true;
      window.removeEventListener("scroll", onScroll);
      for (const type of inputs) window.removeEventListener(type, cancel);
    };
  }, [pathname]);

  return null;
}
