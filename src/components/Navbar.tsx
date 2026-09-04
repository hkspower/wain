import Link from "next/link";

const links = [
  { href: "/explore", label: "Explore" },
  // The game has two doors now: this one opens the page that explains
  // it, in either language, and the next one starts the engine.
  { href: "/game", label: "The Game" },
  { href: "/race", label: "Race 🏁" },
  { href: "/hub", label: "Online Hub" },
  { href: "/about", label: "About" },
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-lg text-white shadow-sm">
            📍
          </span>
          <span className="text-xl font-extrabold tracking-tight text-slate-900">
            Wain<span className="text-brand-600">?</span>
          </span>
          <span className="hidden text-sm font-medium text-slate-600 sm:inline" dir="rtl" lang="ar">
            وين؟
          </span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/explore"
            className="ml-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            Find a place
          </Link>
        </div>
      </nav>
    </header>
  );
}
