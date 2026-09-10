"use client";

import { startTransition, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Makes a route change look like a screen change instead of a page swap.
 *
 * The site was already a single-page app before this existed, which is worth
 * saying plainly because it is easy to assume otherwise from `output: 'export'`.
 * The export ships an HTML file per route AND an RSC payload per route — those
 * are the 62 `.txt` files, and the reason `audit:htaccess` refuses to deny
 * `index.txt` — so the router swaps views client-side and the document never
 * reloads. Measured: a marker set on `window` survives explore → a place,
 * home → explore and explore → about, with zero document loads.
 *
 * What was missing was only that the swap was instantaneous and unannounced,
 * which reads as a page load even when it is not one. This wraps forward
 * navigations in a View Transition so the old screen crossfades into the new.
 *
 * ## Why it intercepts clicks rather than wrapping `<Link>`
 *
 * `document.startViewTransition` has to be the thing that CAUSES the DOM
 * change, so the navigation must happen inside its callback. There is no
 * router event to hang that on, so the click is caught in the capture phase
 * before the router sees it and re-issued through `router.push`. Prefetching
 * is untouched — that happens on hover and in the viewport, not on click.
 *
 * ## What it deliberately does NOT touch
 *
 * - **Back and forward.** They arrive as `popstate`, and wrapping those would
 *   put a transition between the browser restoring the scroll position and the
 *   content it is restoring against. Returning to your place in a 52-card list
 *   matters more than an animation on the way back, so back is instant.
 * - **Anything that is not a plain primary-button click on a same-origin
 *   link**: modifier keys, middle-click, `target`, `download`, `mailto:`/
 *   `tel:`, hash links within the page, and anything already prevented. All
 *   fall through to the browser or the router exactly as before.
 * - **Any link carrying `data-no-view-transition`.** Capture phase means this
 *   listener answers a click BEFORE React does, so a component that decides
 *   for itself whether a click should navigate never gets its say. A map pin
 *   does exactly that — the first tap on a phone selects it and only the
 *   second opens the place — and without the opt-out this opened it on the
 *   first tap. The map-pin suite is what caught it. Any link that vetoes its
 *   own clicks needs the attribute.
 * - **`open_place`.** شوق changes the route by calling the router directly, not
 *   by clicking a link, so nothing here sees it and her call survives the
 *   navigation the way it always did.
 *
 * The whole thing degrades to a no-op: if `startViewTransition` is missing, or
 * the visitor asked for reduced motion, the listener is never even attached
 * and every link behaves the way it did before this file existed.
 */
export default function RouteTransitions() {
  const router = useRouter();
  const pathname = usePathname();
  /** Resolves the transition's callback once React has rendered the new route. */
  const pending = useRef<(() => void) | null>(null);

  // The callback passed to startViewTransition must not settle until the new
  // screen is on the page, or the browser snapshots the OLD one twice and the
  // crossfade has nothing to fade to.
  useEffect(() => {
    pending.current?.();
    pending.current = null;
  }, [pathname]);

  useEffect(() => {
    const doc = document as Document & {
      startViewTransition?: (cb: () => Promise<void> | void) => { finished: Promise<void> };
    };
    if (typeof doc.startViewTransition !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.closest("[data-no-view-transition]")) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      let url: URL;
      try {
        url = new URL(anchor.href, location.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin) return;
      // A link to the page you are on, or to an anchor within it, is not a
      // route change — letting it through keeps in-page jumps smooth.
      if (url.pathname === location.pathname && url.search === location.search) return;

      event.preventDefault();
      doc.startViewTransition!(
        () =>
          new Promise<void>((resolve) => {
            // Belt and braces: if the route never settles — a failed chunk, a
            // navigation the router declines — the transition must still end,
            // or the page is left frozen under a stale snapshot.
            const bail = window.setTimeout(resolve, 600);
            pending.current = () => {
              window.clearTimeout(bail);
              resolve();
            };
            startTransition(() => router.push(url.pathname + url.search));
          })
      );
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
