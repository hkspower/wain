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
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
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
          <div key={item.title} className="rounded-3xl border border-sand-200 bg-white p-5 shadow-sm">
            <span className={`grid size-10 place-items-center rounded-2xl ${item.tone}`} aria-hidden="true">
              {item.icon}
            </span>
            <h2 className="mt-2 font-display text-lg font-bold text-ink-900">{item.title}</h2>
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
          className="inline-flex items-center gap-2 rounded-2xl bg-ink-900 px-6 py-3 font-display text-lg font-bold text-white shadow-md transition hover:bg-ink-800 active:scale-[0.98]"
        >
          يالله نبدأ
          <IconGo className="size-5" />
        </Link>
      </div>
    </div>
  );
}
