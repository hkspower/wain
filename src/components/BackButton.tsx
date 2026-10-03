"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { IconBack } from "@/components/icons";

/**
 * The back button every page but the home page carries (asked for on
 * 3 October: «add back button sticky», a floating round button).
 *
 * The site has had no top bar since the navbar was removed, so until this the
 * browser's own back was the only way out of a page — and inside WhatsApp's
 * or Instagram's browser, or in the installed app, there often is none.
 *
 * **It goes back, not to a fixed place**, so a visitor who came from /search
 * returns to their results and `ScrollMemory` puts them where they were (a
 * `router.back()` is a popstate, which is what it restores on). That is only
 * safe when the previous entry is ours: a place page opened from a WhatsApp
 * link has nothing of ours behind it, and `back()` there would leave the
 * site. So `NavDepth` (mounted once, in the layout) counts in-app steps, and
 * with none to undo the button goes to `fallback` instead.
 *
 * **Each page renders it, not the layout.** The layout cannot know the path
 * at build time, and a button added after hydration would push the page down
 * a frame late. The spacer is what keeps the circle off the page's own
 * heading at rest; the circle itself is `fixed`, so it stays put while the
 * page scrolls under it — and `audit:mobile` excuses only a target that is
 * itself fixed from the crowding check, which is why `fixed` is on the link
 * and not on a wrapper.
 *
 * `z-50`: over the page and level with the installed app's tab bar, under the
 * call sheet (`z-[60]`), which covers it while a call is open.
 */

let depth = 0;
let popped = false;

/** Counts navigations inside the site; mounted once, in the root layout. */
export function NavDepth() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    const onPop = () => {
      popped = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    depth = popped ? Math.max(0, depth - 1) : depth + 1;
    popped = false;
  }, [pathname]);

  return null;
}

export default function BackButton({
  fallback = "/",
  spacer = true,
  floating = true,
}: {
  /** Where to go when there is no earlier page of ours to return to. */
  fallback?: string;
  /** A row of space above the page, so the circle covers nothing at rest. */
  spacer?: boolean;
  /** Fixed to the screen; false puts it in the flow, for a page's own header. */
  floating?: boolean;
}) {
  const router = useRouter();
  const go = () => {
    if (depth > 0) router.back();
    else router.push(fallback);
  };

  const button = (
    <button
      type="button"
      onClick={go}
      aria-label="رجوع"
      data-back-button
      className={`${
        floating
          ? "fixed top-[calc(0.5rem+env(safe-area-inset-top))] start-[max(0.625rem,calc((100vw-72rem)/2+1rem))] z-50"
          : "shrink-0"
      } app-chrome grid size-11 place-items-center rounded-full bg-white text-ink-800 shadow-md ring-1 ring-ink-900/10 transition hover:bg-sand-100 active:scale-[0.96]`}
    >
      <IconBack className="size-5" />
    </button>
  );

  if (!floating) return button;
  return (
    <>
      {spacer && <div aria-hidden="true" data-back-spacer className="h-13" />}
      {button}
    </>
  );
}
