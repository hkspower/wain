import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "Why Wain exists, and how it answers Kuwait's favourite question.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
        What is Wain?
      </h1>

      <div className="mt-8 space-y-6 text-lg leading-relaxed text-slate-600">
        <p>
          <strong className="text-slate-900">Wain</strong>{" "}
          (<span dir="rtl" lang="ar">وين</span>) means <em>&ldquo;where?&rdquo;</em> in Kuwaiti
          Arabic — as in the question asked in every family WhatsApp group, every
          Thursday night, since the dawn of time:{" "}
          <strong className="text-brand-700">wain nrooh? — where shall we go?</strong>
        </p>
        <p>
          Wain answers that question. It&apos;s a curated guide to the best of
          Kuwait — the iconic landmarks, the souqs that smell like cardamom and
          saffron, the beaches, the museums, the malls, and the spots only locals
          know about.
        </p>
        <p>
          Every place on Wain comes with honest highlights, the best time to
          visit, and what it&apos;ll cost — so the only thing left to argue about
          in the group chat is who&apos;s driving.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          { emoji: "🇰🇼", title: "Local first", text: "Curated by people who actually live here." },
          { emoji: "✨", title: "Quality over quantity", text: "Every place earns its spot." },
          { emoji: "🗣️", title: "Bilingual", text: "English and Arabic, side by side." },
        ].map((item) => (
          <div key={item.title} className="rounded-2xl border border-slate-100 bg-slate-50/50 p-5">
            <span className="text-2xl">{item.emoji}</span>
            <h2 className="mt-2 font-bold text-slate-900">{item.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{item.text}</p>
          </div>
        ))}
      </div>

      <div className="mt-12">
        <Link
          href="/explore"
          className="inline-block rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white shadow-md shadow-brand-600/20 transition hover:bg-brand-700"
        >
          Start exploring →
        </Link>
      </div>
    </div>
  );
}
