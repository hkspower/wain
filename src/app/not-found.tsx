import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-28 text-center">
      <p className="text-6xl">🧭</p>
      <h1 className="mt-6 text-3xl font-extrabold text-slate-900">
        Wain are you going?
      </h1>
      <p className="mt-3 text-slate-500">
        This page doesn&apos;t exist — but plenty of great places do.
      </p>
      <Link
        href="/explore"
        className="mt-8 rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white shadow-md transition hover:bg-brand-700"
      >
        Find a real place →
      </Link>
    </div>
  );
}
