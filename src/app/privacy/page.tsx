import Link from "next/link";
import type { Metadata } from "next";
import { IconCheck, IconGo, IconLocate } from "@/components/icons";
import { FAHAD_COPY } from "@/lib/fahad";

export const metadata: Metadata = {
  title: "الخصوصية والكوكيز",
  description:
    "وين ما يستخدم كوكيز تتبّع ولا أدوات تحليلات. هذي التفاصيل الكاملة عن البيانات في الموقع.",
  alternates: { canonical: "/privacy/" },
};

const noCookies = [
  "ما نحط أي كوكيز على جهازك.",
  "ما نستخدم Google Analytics ولا أي أداة تتبّع.",
  "ما فيه بكسل إعلاني ولا أدوات تتبّع من شبكات التواصل.",
  "الخطوط محمّلة من نفس الموقع، فما تروح أي طلبات لخوادم خارجية.",
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">
        الخصوصية والكوكيز
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-ink-600">
        باختصار: <strong className="text-ink-900">وين ما يستخدم كوكيز</strong>، وما
        يجمع عنك أي بيانات. الصفحة هذي تشرح الوضع بالتفصيل.
      </p>

      {/* No cookies */}
      <section className="mt-10 rounded-3xl border border-palm-500/25 bg-palm-500/5 p-6">
        <h2 className="font-display text-xl font-semibold text-ink-900">
          ما نستخدم كوكيز — أبداً
        </h2>
        <ul className="mt-4 space-y-2.5">
          {noCookies.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-600">
              <IconCheck className="mt-0.5 size-4 shrink-0 text-palm-600" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-ink-500">
          عشان جذي ما بتشوف نافذة «وافق على الكوكيز» في وين — ما فيه شي توافق
          عليه من الأساس.
        </p>
      </section>

      {/* Location */}
      <section className="mt-6 rounded-3xl border border-sand-200 bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink-900">
          <IconLocate className="size-5 text-sea-600" />
          موقعك
        </h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-600">
          <p>
            زر «إلى وين؟» يشتغل بدون ما يطلب موقعك — يعرض لك أماكن وسط الكويت
            مباشرة. إذا ضغطت «استخدم موقعي» بنفسك، وقتها بس يطلب المتصفح إذنك.
          </p>
          <p>
            وحتى لو وافقت، إحداثياتك <strong className="text-ink-900">ما تطلع من جهازك</strong>.
            الحساب كله يصير داخل المتصفح عشان نرتّب الأماكن حسب قربها منك، وما
            نخزّنها ولا نرسلها لأي خادم.
          </p>
        </div>
      </section>

      {/* فهد */}
      <section className="mt-6 rounded-3xl border border-sand-200 bg-white p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink-900">
          {FAHAD_COPY.name} — المساعد الصوتي
        </h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-600">
          <p>
            فهد ما يشتغل إلا إذا فتحته أنت. قبل جذي ما يتحمّل شي منه ولا يصير أي
            اتصال خارجي.
          </p>
          <p>
            لمّا تفتحه، يتحمّل من{" "}
            <strong className="text-ink-900">ElevenLabs</strong> عشان يشتغل الصوت،
            ووقتها ينطبق عليه سياسة الخصوصية الخاصة فيهم — وممكن يحفظ بيانات في
            متصفحك تخصّ المحادثة. المايك ما يشتغل إلا بعد ما تعطي الإذن.
          </p>
          <p>إذا ما فتحت فهد، ما راح يوصل أي شي عنك لأي طرف ثاني.</p>
        </div>
      </section>

      {/* صوت وين */}
      <section className="mt-6 rounded-3xl border border-sand-200 bg-white p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink-900">
          صوت وين — الاقتراح الصوتي
        </h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-600">
          <p>
            إذا شغّلت الاقتراح الصوتي واخترت صوت شوق أو سالم، اختيارك ينحفظ{" "}
            <strong className="text-ink-900">داخل متصفحك بس</strong> (Local
            Storage) عشان يبقى محفوظ لك بالزيارة الجاية — ما ينرسل لأي خادم ولا
            يُستخدم للتتبّع.
          </p>
          <p>
            المقاطع الصوتية ملفات جاهزة من ضمن الموقع نفسه، وإذا ما كانت موجودة
            يستخدم المتصفح صوته العربي الداخلي — بالحالتين ما يطلع أي شي من
            جهازك.
          </p>
        </div>
      </section>

      {/* Hosting */}
      <section className="mt-6 rounded-3xl border border-sand-200 bg-white p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink-900">الاستضافة</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-600">
          وين موقع ثابت (static)، يعني ما فيه قاعدة بيانات ولا حسابات ولا تسجيل
          دخول. مزوّد الاستضافة — مثل أي استضافة — يسجّل طلبات الخوادم العادية
          لأسباب تشغيلية وأمنية، وهذا خارج عن تحكّمنا.
        </p>
      </section>

      <div className="mt-10 text-center">
        <Link
          href="/explore"
          className="inline-flex items-center gap-2 rounded-2xl bg-ink-900 px-6 py-3 font-display text-lg font-semibold text-white shadow-md transition hover:bg-ink-800 active:scale-[0.98]"
        >
          رجوع للأماكن
          <IconGo className="size-5" />
        </Link>
      </div>
    </div>
  );
}
