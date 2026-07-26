import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-base text-white"
            >
              📍
            </span>
            <span className="font-bold text-slate-900">
              Wain<span className="text-brand-600">?</span>
            </span>
            <span className="text-center text-sm text-slate-500">
              — wain nrooh? where shall we go?
            </span>
          </div>

          <div className="flex items-center gap-6 text-sm text-slate-500">
            <Link href="/explore" className="transition hover:text-brand-700">
              Explore
            </Link>
            <Link href="/about" className="transition hover:text-brand-700">
              About
            </Link>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-slate-400">
          © {new Date().getFullYear()} Wain. Made with ❤️ in Kuwait 🇰🇼
        </p>
      </div>
    </footer>
  );
}
