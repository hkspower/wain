"use client";

import Link from "next/link";
import { IconCompass, IconGo } from "@/components/icons";

/**
 * What a page shows when it throws — inside the layout, not instead of it.
 *
 * There was none, so one exception anywhere under the root replaced the WHOLE
 * tree with Next's bare «Application error»: the tabs, the search box, and
 * any open شوق call with them, since her sheet lives in the root layout too.
 * The live map did exactly that on /search, from 20 September to 1 October,
 * whenever a query found more places while it was open.
 *
 * Errors in the root layout itself are not caught here — that would need a
 * global-error file with its own <html> — but no page's bug can take the
 * call, the tab bar or the way out down with it any more.
 */
export default function RouteError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-2.5 py-8 text-center sm:px-4 sm:py-8">
      <span
        className="grid size-24 place-items-center rounded-3xl bg-gradient-to-b from-sun-200 to-sun-400 text-ink-900 shadow-lg shadow-sun-400/40"
        aria-hidden="true"
      >
        <IconCompass className="size-12" />
      </span>
      <h1 className="mt-6 font-display text-3xl font-bold text-ink-900 sm:text-4xl">صار خلل بهالصفحة</h1>
      <p className="mt-3 text-ink-500">جرّب مرة ثانية — وإذا ما زبطت، الأماكن كلها موجودة.</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-tap items-center gap-2 rounded-2xl bg-ink-900 px-6 py-3 font-display text-lg font-semibold text-white shadow-md transition hover:bg-ink-800 active:scale-[0.98]"
        >
          جرّب مرة ثانية
        </button>
        <Link
          href="/explore"
          className="inline-flex min-h-tap items-center gap-2 rounded-2xl border border-line-control bg-white px-6 py-3 font-display text-lg font-semibold text-ink-800 transition hover:border-sea-300"
        >
          دوّر على مكان
          <IconGo className="size-5" />
        </Link>
      </div>
    </div>
  );
}
