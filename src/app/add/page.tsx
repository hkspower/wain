import type { Metadata } from "next";
import AddBusinessClient from "@/app/add/AddBusinessClient";
import { IconCheck } from "@/components/icons";

export const metadata: Metadata = {
  title: "سجّل مكانك مجاناً",
  description:
    "عندك محل أو مطعم أو كافيه في الكويت؟ سجّله في وين مجاناً وخلّه يوصل للناس اللي تدوّر عليه.",
  alternates: { canonical: "/add" },
  openGraph: {
    title: "سجّل مكانك في وين — مجاناً",
    description: "أي محل في الكويت يقدر يسجّل مكانه على خريطة وين، بدون رسوم.",
    url: "/add",
  },
};

const PROMISES = [
  "مجاناً بالكامل — ما نطلب رسوم ولا اشتراك.",
  "بدون حساب — عبّي النموذج وخلاص.",
  "مكانك يطلع في البحث وعلى الخريطة مثل باقي الأماكن.",
];

export default function AddBusinessPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 standalone:px-3 standalone:py-4 sm:px-6 sm:py-14">
      <header className="mb-7">
        <p className="mb-2 inline-flex items-center rounded-full bg-palm-500/12 px-3 py-1 text-xs font-semibold text-palm-700">
          مجاناً
        </p>
        <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">
          سجّل مكانك في وين
        </h1>
        <p className="mt-2 max-w-[46ch] text-ink-500">
          عندك مطعم أو كافيه أو محل في الكويت؟ ضيفه على خريطة وين ووصّله للناس
          اللي يسألون «وين نروح اليوم؟».
        </p>
        <ul className="mt-4 space-y-1.5">
          {PROMISES.map((p) => (
            <li key={p} className="flex items-start gap-2 text-sm text-ink-600">
              <IconCheck className="mt-0.5 size-4 shrink-0 text-palm-600" />
              {p}
            </li>
          ))}
        </ul>
      </header>

      <AddBusinessClient />
    </div>
  );
}
