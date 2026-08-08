"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCompass, IconHome, IconSearch } from "@/components/icons";

const TABS = [
  { href: "/", label: "الرئيسية", icon: IconHome, exact: true },
  { href: "/explore", label: "استكشف", icon: IconCompass, exact: false },
  { href: "/search", label: "بحث", icon: IconSearch, exact: false },
];

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

  return (
    <nav
      aria-label="تنقّل التطبيق"
      className="app-chrome fixed inset-x-0 bottom-0 z-50 hidden border-t border-sand-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur standalone:block"
    >
      <div className="mx-auto grid max-w-md grid-cols-3">
        {TABS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition ${
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
