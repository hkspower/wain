import Link from "next/link";
import type { Metadata } from "next";
import { IconGo, IconLocate, IconPinSolid, IconSparkle } from "@/components/icons";
import { countAr, places, PLACES_COUNT } from "@/lib/places";

export const metadata: Metadata = {
  title: "عن وين",
  description: "ليش صار فيه وين، وكيف يجاوب على سؤال الطلعة اليومي في الكويت.",
};

export default function AboutPage() {
  return (
    <div className="measure mx-auto max-w-3xl px-4 py-8 standalone:px-3 standalone:py-4 sm:px-6 sm:py-14">
      <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">
        وين؟ شنو هذا
      </h1>

      <div className="mt-7 space-y-5 text-lg leading-relaxed text-ink-600">
        <p>
          <strong className="text-ink-900">وين</strong> كلمة نقولها كل يوم — في جروب
          العايلة، في جروب الربع، كل خميس من زمان:{" "}
          <strong className="text-coral-700">وين الطلعة اليوم؟</strong>
        </p>
        <p>
          وين يجاوب على هذا السؤال. دليل مختار لأحلى ما في الكويت — المعالم، الأسواق
          اللي ريحتها هيل وزعفران، البحر، المتاحف، المولات، والأماكن اللي ما يعرفها إلا
          أهل الديرة.
        </p>
        <p>
          كل مكان عندنا فيه أبرز ما يميّزه، وأحسن وقت تروح فيه، وكم بيكلّفك — عشان آخر
          شي يتناقشون فيه بالجروب يكون منو بيسوق.
        </p>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: <IconPinSolid className="size-5" />,
            tone: "bg-coral-50 text-coral-600",
            title: "من أهل الديرة",
            text: "مختارة من ناس عايشين هني فعلاً.",
          },
          {
            icon: <IconSparkle className="size-5" />,
            tone: "bg-sun-50 text-sun-700",
            title: "كيف مو كم",
            text: "كل مكان يستاهل مكانه بالقائمة.",
          },
          {
            icon: <IconLocate className="size-5" />,
            tone: "bg-sea-50 text-sea-700",
            title: "قريب منك",
            text: "نرتّب الأماكن حسب قربها من موقعك.",
          },
        ].map((item) => (
          <div key={item.title} className="rounded-3xl border border-line bg-white p-5 shadow-sm">
            <span className={`grid size-10 place-items-center rounded-2xl ${item.tone}`} aria-hidden="true">
              {item.icon}
            </span>
            <h2 className="mt-2 font-display text-lg font-semibold text-ink-900">{item.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-500">{item.text}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-3xl bg-sea-700 p-6 text-center text-white shadow-md">
        <p className="font-display text-2xl font-bold">
          {countAr(places.length, PLACES_COUNT)} جاهز لك
        </p>
        <p className="mt-1 text-sm text-sea-100">من أبراج الكويت لين مقاهي المباركية.</p>
      </div>

      <div className="mt-10 text-center">
        <Link
          href="/explore"
          className="inline-flex items-center gap-2 rounded-2xl bg-ink-900 px-6 py-3 font-display text-lg font-semibold text-white shadow-md transition hover:bg-ink-800 active:scale-[0.98]"
        >
          يالله نبدأ
          <IconGo className="size-5" />
        </Link>
      </div>

      {/**
        * The two links the footer used to be the only home for.
        *
        * Removing the footer orphaned four routes. «طلباتي» and «دوري» moved to
        * the header, where live state belongs; these two are neither live nor
        * frequent, and a privacy policy nobody can reach is not a privacy
        * policy. This page is one tap from every screen — «عن وين» is in the
        * header — so two taps reaches both, at a cost of nothing on the other
        * nine routes.
        */}
      <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-line pt-6 text-sm">
        <Link
          href="/add"
          className="flex min-h-11 items-center gap-1.5 font-semibold text-ink-700 transition hover:text-coral-700"
        >
          سجّل مكانك
          <span className="rounded-full bg-palm-500/12 px-1.5 py-0.5 text-xs font-semibold text-palm-700">
            مجاناً
          </span>
        </Link>
        <Link
          href="/privacy"
          className="flex min-h-11 items-center text-ink-500 transition hover:text-coral-700"
        >
          الخصوصية والكوكيز
        </Link>
      </div>
    </div>
  );
}
