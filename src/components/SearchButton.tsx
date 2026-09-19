"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconSearch } from "@/components/icons";
import { haptic } from "@/lib/haptics";

/**
 * The search button, restored.
 *
 * Removing the top bar took it with it, and the replacement — one link under
 * the home page's dial — only covered the page it was put on. Measured on the
 * shipped build, `a[href="/search/"]:visible`: `/` had 1, and /explore, a
 * place page and /about each had **0 of 1**. The 1 in the DOM everywhere is
 * AppTabBar's tab, which is `standalone:block` and so is painted by nothing
 * outside the installed app — the same count-is-not-reachability trap that hid
 * this on the home page, one level further out.
 *
 * So for 52 place pages and every static route, a browser had no way to
 * search and no way to reach شوق, whose only launcher lives inside the
 * /search query box. /explore looked covered and was not: its box filters the
 * list in place, it does not go to /search and it carries no call button.
 *
 * Not shown on `/` (the link under the dial is the same offer, and drawing it
 * twice is the mistake ShouqCallButton's own placement was chosen to avoid)
 * and not on /search, which is where it goes.
 *
 * Icon-only on purpose. It is permanent, so it has to be small enough to cover
 * almost nothing, and it shares a row with LiveTray — see the rail in
 * layout.tsx, which is what keeps the two from ever landing on top of each
 * other. 40px clears the 24px target floor `audit:mobile` enforces with room,
 * and the icon keeps its ~50% share of the button the way the call launcher's
 * does.
 */
export default function SearchButton() {
  const pathname = usePathname();
  if (pathname === "/" || pathname.startsWith("/search")) return null;

  return (
    <Link
      href="/search"
      onClick={() => haptic("tap")}
      aria-label="دوّر في وين"
      className="app-chrome pointer-events-auto flex size-10 items-center justify-center rounded-full bg-white/95 text-sea-800 shadow-lg ring-1 ring-line backdrop-blur transition hover:bg-white"
    >
      <IconSearch className="size-5" />
    </Link>
  );
}
