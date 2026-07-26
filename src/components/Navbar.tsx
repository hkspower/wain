import Link from "next/link";

const links = [
  { href: "/explore", label: "استكشف" },
  { href: "/about", label: "عن وين" },
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-sand-200/80 bg-sand-50/85 backdrop-blur-md">
      <nav
        className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6"
        aria-label="التنقّل الرئيسي"
      >
        {/* Brand */}
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="وين — الصفحة الرئيسية">
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-2xl bg-coral-600 text-white shadow-sm"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
              <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
            </svg>
          </span>
          <span className="font-display text-2xl font-extrabold leading-none text-ink-900">
            وين<span className="text-coral-600">؟</span>
          </span>
        </Link>

        {/* Links */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="whitespace-nowrap rounded-xl px-2.5 py-2 text-sm font-semibold text-ink-600 transition hover:bg-sand-100 hover:text-ink-900 sm:px-3"
            >
              {link.label}
            </Link>
          ))}
          <span
            className="ms-1 hidden items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-sm font-bold text-ink-700 shadow-sm ring-1 ring-sand-200 sm:inline-flex"
            aria-hidden="true"
          >
            حياكم 🤝
          </span>
        </div>
      </nav>
    </header>
  );
}
