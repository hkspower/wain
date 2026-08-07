import Link from "next/link";
import WainLogo from "@/components/WainLogo";
import { categories } from "@/lib/places";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-sand-200 bg-sand-100">
      <div className="mx-auto max-w-6xl px-4 py-10 standalone:px-3 standalone:py-5 sm:px-6 sm:py-12">
        <div className="grid gap-8 standalone:gap-4 sm:grid-cols-3">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2">
              <span aria-hidden="true">
                <WainLogo className="size-9" />
              </span>
              <span className="font-display text-xl font-bold text-ink-900">
                وين<span className="text-coral-600">؟</span>
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-500">
              دليلك لأماكن الكويت — وين الطلعة اليوم؟ إحنا نجاوب.
            </p>
          </div>

          {/* Categories */}
          <nav aria-label="التصنيفات" className="standalone:hidden">
            <h2 className="text-sm font-bold text-ink-800">التصنيفات</h2>
            <ul className="mt-1 grid grid-cols-2 gap-x-4">
              {categories.slice(0, 6).map((cat) => (
                <li key={cat.id}>
                  <Link
                    href={`/explore/?category=${cat.id}`}
                    className="inline-flex min-h-11 items-center text-sm text-ink-500 transition hover:text-coral-700"
                  >
                    {cat.ar}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Links */}
          <nav aria-label="روابط" className="standalone:hidden">
            <h2 className="text-sm font-bold text-ink-800">روابط</h2>
            <ul className="mt-1">
              <li>
                <Link href="/explore" className="inline-flex min-h-11 items-center text-sm text-ink-500 transition hover:text-coral-700">
                  استكشف كل الأماكن
                </Link>
              </li>
              <li>
                <Link href="/about" className="inline-flex min-h-11 items-center text-sm text-ink-500 transition hover:text-coral-700">
                  عن وين
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="inline-flex min-h-11 items-center text-sm text-ink-500 transition hover:text-coral-700">
                  الخصوصية والكوكيز
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <p className="mt-10 border-t border-sand-200 pt-6 text-center text-xs text-ink-500">
          © {new Date().getFullYear()} وين. صُنع بحب في الكويت 🇰🇼
        </p>
      </div>
    </footer>
  );
}
