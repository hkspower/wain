"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import WainLogo from "@/components/WainLogo";
import SearchPalette from "@/components/SearchPalette";

const links = [
  { href: "/explore", label: "استكشف" },
  { href: "/about", label: "عن وين" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-sand-200/70 bg-sand-50/75 shadow-[0_1px_0_rgba(255,255,255,0.6)_inset] backdrop-blur-xl">
      <nav
        className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6"
        aria-label="التنقّل الرئيسي"
      >
        {/* Brand */}
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2"
          aria-label="وين — الصفحة الرئيسية"
        >
          <span
            aria-hidden="true"
            className="transition duration-300 group-hover:scale-105"
          >
            <WainLogo className="size-10" />
          </span>
          <span className="font-display text-2xl font-extrabold leading-none text-ink-900">
            وين<span className="text-coral-600">؟</span>
          </span>
        </Link>

        {/* Links */}
        <div className="flex shrink-0 items-center gap-2">
          <SearchPalette />
          <div className="flex items-center gap-1 rounded-full bg-white/70 p-1 ring-1 ring-sand-200/80 backdrop-blur">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-bold transition ${
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
