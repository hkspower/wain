import Link from "next/link";
import { IconCompass, IconGo } from "@/components/icons";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center sm:py-28">
      <span
        className="grid size-24 place-items-center rounded-3xl bg-gradient-to-b from-sun-200 to-sun-400 text-ink-900 shadow-lg shadow-sun-400/40"
        aria-hidden="true"
      >
        <IconCompass className="size-12" />
      </span>
      <h1 className="mt-6 font-display text-3xl font-bold text-ink-900 sm:text-4xl">
        وين رايح؟
      </h1>
      <p className="mt-3 text-ink-500">
        الصفحة هذي ما هي موجودة — بس فيه وايد أماكن حلوة موجودة.
      </p>
      <Link
        href="/explore"
        className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-ink-900 px-6 py-3 font-display text-lg font-bold text-white shadow-md transition hover:bg-ink-800 active:scale-[0.98]"
      >
        دوّر على مكان
        <IconGo className="size-5" />
      </Link>
    </div>
  );
}
