import Link from "next/link";
import { IconPinSolid } from "@/components/icons";
import { categories } from "@/lib/places";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-sand-200 bg-sand-100">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="grid size-8 place-items-center rounded-xl bg-gradient-to-b from-coral-500 to-coral-700 text-white shadow-sm"
              >
                <IconPinSolid className="size-4" />
              </span>
              <span className="font-display text-xl font-extrabold text-ink-900">
                وين<span className="text-coral-600">؟</span>
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-500">
              دليلك لأماكن الكويت — وين الطلعة اليوم؟ إحنا نجاوب.
            </p>
          </div>

          {/* Categories */}
          <nav aria-label="التصنيفات">
            <h2 className="text-sm font-bold text-ink-800">التصنيفات</h2>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
              {categories.slice(0, 6).map((cat) => (
                <li key={cat.id}>
                  <Link
                    href={`/explore?category=${cat.id}`}
                    className="text-sm text-ink-500 transition hover:text-coral-700"
                  >
                    {cat.ar}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Links */}
          <nav aria-label="روابط">
            <h2 className="text-sm font-bold text-ink-800">روابط</h2>
            <ul className="mt-3 space-y-2">
              <li>
                <Link href="/explore" className="text-sm text-ink-500 transition hover:text-coral-700">
                  استكشف كل الأماكن
                </Link>
              </li>
              <li>
                <Link href="/about" className="text-sm text-ink-500 transition hover:text-coral-700">
                  عن وين
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
