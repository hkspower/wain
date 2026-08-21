"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconBag, IconClock, IconCompass, IconHome, IconSearch } from "@/components/icons";
import { useOrderCount, useTicketCount } from "@/components/OrdersLink";
import { haptic } from "@/lib/haptics";

const TABS = [
  { href: "/", label: "الرئيسية", icon: IconHome, exact: true },
  { href: "/explore", label: "استكشف", icon: IconCompass, exact: false },
  { href: "/search", label: "بحث", icon: IconSearch, exact: false },
];

const ORDERS_TAB = { href: "/orders", label: "طلباتي", icon: IconBag, exact: false };
const QUEUE_TAB = { href: "/queue", label: "دوري", icon: IconClock, exact: false };

// Written out rather than interpolated: Tailwind reads these class names out of
// the source at build time, so `grid-cols-${n}` would produce no CSS at all.
const COLUMNS: Record<number, string> = {
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

/**
 * The app version's bottom navigation.
 *
 * The same build serves two experiences: in a normal browser this bar does
 * not exist, while installed to the home screen (display-mode: standalone —
 * the PWA defined by manifest.ts) it becomes the primary navigation, native
 * style: fixed to the bottom edge, safe-area aware. The separation is pure
 * CSS, so both versions ship in one static export.
 */
export default function AppTabBar() {
  const pathname = usePathname();
  // These two exist only while this device has something live to look at, so
  // the bar is three tabs for most people and grows for someone mid-errand.
  const orderCount = useOrderCount();
  const ticketCount = useTicketCount();
  const tabs = [
    ...TABS,
    ...(orderCount > 0 ? [ORDERS_TAB] : []),
    ...(ticketCount > 0 ? [QUEUE_TAB] : []),
  ];

  return (
    <nav
      aria-label="تنقّل التطبيق"
      className="app-chrome fixed inset-x-0 bottom-0 z-50 hidden border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur standalone:block"
    >
      <div className={`mx-auto grid max-w-md ${COLUMNS[tabs.length] ?? "grid-cols-3"}`}>
        {tabs.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              onClick={() => haptic("tap")}
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-1 py-2.5 text-2xs font-semibold transition ${
                active ? "text-coral-700" : "text-ink-500 hover:text-ink-700"
              }`}
            >
              <Icon className="size-6" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
