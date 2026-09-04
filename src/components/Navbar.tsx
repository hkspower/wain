"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import WainLogo from "@/components/WainLogo";
import SearchPalette from "@/components/SearchPalette";
import OrdersLink, { QueueLink } from "@/components/OrdersLink";

const links = [
  { href: "/explore", label: "استكشف" },
  { href: "/about", label: "عن وين" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="app-chrome sticky top-0 z-50 border-b border-line/70 bg-sand-50/85 pt-[env(safe-area-inset-top)] shadow-[0_1px_0_rgba(255,255,255,0.6)_inset] backdrop-blur-xl">
      <nav
        className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6"
        aria-label="التنقّل الرئيسي"
      >
        {/* Brand */}
        <Link
          href="/"
          // min-w-11 as well as min-h-11: below 360px the wordmark hides and
          // only the 40px mark is left, so the link home — the one every
          // visitor eventually reaches for — was the single target on the site
          // a thumb could miss. Four pixels of padding costs nothing here.
          className="group flex min-h-11 min-w-11 shrink-0 items-center gap-2"
          aria-label="وين — الصفحة الرئيسية"
        >
          <span
            aria-hidden="true"
            className="transition duration-300 group-hover:scale-105"
          >
            <WainLogo className="size-10" />
          </span>
          {/* Below 360px the brand, the search button and both nav links need
              338px of a 288px content box, so "عن وين" was clipped off the
              edge and unreachable. The mark alone carries the brand there —
              it is still the link home, with the same aria-label. */}
          <span className="font-display text-2xl font-bold leading-none text-ink-900 max-[359px]:hidden">
            وين<span className="text-coral-600">؟</span>
          </span>
        </Link>

        {/* Links */}
        <div className="flex shrink-0 items-center gap-2">
          <SearchPalette />
          {/* Both render nothing unless this device has a live order or a
              ticket, so the header is unchanged for almost everyone. */}
          <OrdersLink />
          <QueueLink />
          <div className="standalone-hidden flex items-center gap-1 rounded-full bg-white/70 p-1 ring-1 ring-line/80 backdrop-blur">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold transition ${
                  active
                    ? "bg-ink-900 text-white shadow-sm"
                    : "text-ink-600 hover:bg-sand-100 hover:text-ink-900"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          </div>
        </div>
      </nav>
    </header>
  );
}
