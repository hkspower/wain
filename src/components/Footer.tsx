import Link from "next/link";
import OrdersLink, { QueueLink } from "@/components/OrdersLink";
import WainLogo from "@/components/WainLogo";
import { categories } from "@/lib/place-kit";

/**
 * The footer, laid out sideways.
 *
 * It was 663px tall on a phone — 78% of the viewport — to hold ten links and
 * one sentence. Nothing in it was wasteful on its own: every link is a 44px tap
 * target because a footer link is the hardest kind to hit, and that is not
 * negotiable. But ten of them were STACKED, in vertical lists, in three columns
 * that become one column on a phone. Ten times forty-four is the whole screen,
 * and it was followed by a separate copyright block with its own 40px of margin
 * above a 24px pad.
 *
 * So the targets keep their height and lose their column. A wrapping row fits
 * three or four per line at the same 44px, which is the same footer in a third
 * of the space — the compaction is in the direction things flow, not in the
 * size of anything you have to hit.
 *
 * The two visible headings are gone with them. «التصنيفات» and «روابط» each
 * cost a row to repeat what the `aria-label` on their own <nav> already says to
 * a screen reader, and the chips now look different enough from the plain links
 * to separate the groups by eye.
 */
export default function Footer() {
  // min-w-11 as well as min-h-11. The old vertical list gave every link
  // `w-full`, so its width was the column's and the rule was met by accident;
  // laid out in a row, a link is only as wide as its text, and «عن وين» is 40px
  // of it. A tap target has two dimensions and the short label is exactly the
  // one that fails — on 22 routes, which is how audit:mobile found it.
  const link =
    "inline-flex min-h-11 min-w-11 items-center justify-center text-sm text-ink-500 transition hover:text-coral-700";

  return (
    <footer className="mt-auto border-t border-line bg-sand-100">
      <div className="mx-auto max-w-6xl px-4 py-7 standalone:px-3 standalone:py-4 sm:px-6 sm:py-8">
        {/* Brand and the sentence beside it, not under it — on anything wider
            than a small phone they share a line. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span aria-hidden="true">
            <WainLogo className="size-9" />
          </span>
          {/* The wordmark, not a heading — it stays bold to match the one
              in the navbar. The weight sweep caught it by size. */}
          <span className="font-display text-xl font-bold text-ink-900">
            وين<span className="text-coral-600">؟</span>
          </span>
          <p className="text-sm leading-relaxed text-ink-500">
            دليلك لأماكن الكويت — وين الطلعة اليوم؟ إحنا نجاوب.
          </p>
        </div>

        {/* Categories, as chips. A chip is 44px tall like every other target
            here, but they wrap into two rows instead of stacking eight deep —
            and the shape reads as "pick one" rather than as a list.

            All eight, where the vertical list showed six: `.slice(0, 6)` was
            there to fill two tidy columns of three, and the price of the tidy
            columns was that ثقافة and عائلة could not be reached from the
            footer at all. Wrapping has no such quota. */}
        <nav aria-label="التصنيفات" className="mt-4 standalone:hidden">
          <ul className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <li key={cat.id}>
                <Link
                  href={`/explore/?category=${cat.id}`}
                  className="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm text-ink-600 ring-1 ring-line transition hover:text-coral-700 hover:ring-coral-200"
                >
                  {cat.ar}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* The bottom bar: the remaining links and the copyright share a line
            from `sm` up, because they are both small print and stacking them
            cost a row and 40px of margin to say so. On a phone they stack, and
            the copyright centres under them.

            «سجّل مكانك» keeps its weight and its badge: it is the only link
            here that asks the visitor for something, and the rest are places
            to go. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 border-t border-line pt-1 standalone:mt-2 standalone:pt-2">
          <nav aria-label="روابط" className="standalone:hidden">
            <ul className="flex flex-wrap items-center gap-x-5">
              <li>
                <Link href="/explore" className={link}>
                  استكشف كل الأماكن
                </Link>
              </li>
              <li>
                <Link
                  href="/add"
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-700 transition hover:text-coral-700"
                >
                  سجّل مكانك
                  <span className="rounded-full bg-palm-500/12 px-1.5 py-0.5 text-xs font-semibold text-palm-700">
                    مجاناً
                  </span>
                </Link>
              </li>
              {/* Each shows up only on a device that has one in flight. */}
              <OrdersLink />
              <QueueLink />
              <li>
                <Link href="/about" className={link}>
                  عن وين
                </Link>
              </li>
              <li>
                <Link href="/privacy" className={link}>
                  الخصوصية والكوكيز
                </Link>
              </li>
            </ul>
          </nav>

          <p className="w-full pb-1 text-center text-xs text-ink-500 sm:w-auto sm:pb-0 sm:text-start">
            © {new Date().getFullYear()} وين. صُنع بحب في الكويت 🇰🇼
          </p>
        </div>
      </div>
    </footer>
  );
}
