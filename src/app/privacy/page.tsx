import Link from "next/link";
import type { Metadata } from "next";
import { IconCheck, IconGo, IconLocate } from "@/components/icons";
import { WAIN_AI_COPY } from "@/lib/wain-ai";

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
    <div className="measure mx-auto max-w-3xl px-4 py-8 standalone:px-3 standalone:py-4 sm:px-6 sm:py-14">
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
      <section className="mt-6 rounded-3xl border border-line bg-white p-6 shadow-sm">
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

      {/* The basemap. This section exists because it is the only third party
          that loads without the visitor asking for it — شوق waits for a press,
          the submission webhook waits for a submit, and the map does not wait
          for anything. Leaving it undisclosed was the page's one real
          omission: it made «ما يوصل شي لأي طرف ثاني» read as true site-wide
          when a place page had already sent an IP to openstreetmap.org. */}
      <section className="mt-6 rounded-3xl border border-line bg-white p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink-900">الخريطة</h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-600">
          <p>
            خرائط صفحات الأماكن من{" "}
            <strong className="text-ink-900">OpenStreetMap</strong> — مشروع خرائط
            مفتوح، مو شركة إعلانات. يعني أول ما تفتح صفحة مكان، متصفحك يطلب
            الخريطة من خوادمهم، ويشوفون عنوان الـ IP حقك مثل أي طلب على
            الإنترنت، وتنطبق سياسة الخصوصية الخاصة فيهم.
          </p>
          <p>
            واللي نضمنه لك: الخريطة داخل إطار معزول (sandbox) بدون صلاحية
            same-origin، يعني{" "}
            <strong className="text-ink-900">المتصفح نفسه يمنعها</strong> إنها
            تحط كوكيز أو تقرا أي شي من الموقع — مو وعد منهم، قاعدة يفرضها
            متصفحك عليهم. وما نرسل لهم عنوان الصفحة اللي أنت فيها ولا اسمك ولا
            بحثك ولا موقعك: بس إحداثيات المكان اللي فاتحه، وهي معلومة عامة أصلاً.
          </p>
        </div>
      </section>

      {/* وين AI */}
      <section className="mt-6 rounded-3xl border border-line bg-white p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink-900">
          وين AI — المساعدة الصوتية
        </h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-600">
          <p>
            {WAIN_AI_COPY.name} ما تشتغل إلا إذا اتصلت فيها أنت — بالضغط على زر
            «وين AI»، وتقدر تنهي المكالمة في أي وقت. قبل جذي ما يتحمّل شي منها
            ولا يصير أي اتصال خارجي، والمايك ما يشتغل إلا بعد ما تعطي الإذن.
          </p>
          <p>
            إذا ما كانت خدمة المحادثة مفعّلة، الزر يستخدم{" "}
            <strong className="text-ink-900">التعرف على الصوت في متصفحك</strong>:
            سؤالك الصوتي يتحوّل لنص، والبحث نفسه يصير داخل جهازك. في أغلب
            المتصفحات تحويل الصوت لنص يمرّ على خدمة الشركة المطوّرة للمتصفح
            (قوقل في كروم، آبل في سفاري) حسب سياساتهم — وما نرسل إحنا شي عنك
            لأي مكان.
          </p>
          <p>
            لمّا تفتحها في وضع المحادثة، تتحمّل من{" "}
            <strong className="text-ink-900">ElevenLabs</strong> عشان يشتغل الصوت،
            ووقتها ينطبق عليه سياسة الخصوصية الخاصة فيهم — وممكن يحفظ بيانات في
            متصفحك تخصّ المحادثة. المايك ما يشتغل إلا بعد ما تعطي الإذن.
          </p>
          <p>إذا ما فتحت وين AI، ما يتحمّل ولا يشتغل أي شي من ElevenLabs أبداً.</p>
        </div>
      </section>

      {/* صوت وين */}
      <section className="mt-6 rounded-3xl border border-line bg-white p-6 shadow-sm">
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
      <section className="mt-6 rounded-3xl border border-line bg-white p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink-900">الاستضافة</h2>
        {/* Was «ما فيه قاعدة بيانات» — no database — which stopped being true
            the day ordering shipped. The pages are still static files, but a
            placed order is a row in Supabase, and a privacy page that denies
            the database is worse than one that never mentioned it. */}
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-600">
          <p>
            صفحات وين ملفات ثابتة (static): ما فيه سيرفر يشغّل كود، ولا حسابات،
            ولا تسجيل دخول للزوار. تقدر تتصفّح الموقع كله وتدوّر وتقرا الأماكن
            بدون ما تعطينا ولا معلومة.
          </p>
          <p>
            الاستثناء الوحيد بيدك أنت: إذا طلبت طلب أو خذيت دور في الطابور، اللي
            تكتبه — اسمك ورقمك وطلبك — ينحفظ في قاعدة بيانات{" "}
            <strong className="text-ink-900">Supabase</strong> عشان المحل يشوف
            طلبك ويجهّزه. هذي المرة الوحيدة اللي تطلع فيها بيانات منك، وما تصير
            إلا بضغطة منك، ونسختك من الطلب تبقى محفوظة داخل متصفحك.
          </p>
          <p>
            ومزوّد الاستضافة — مثل أي استضافة — يسجّل طلبات الخوادم العادية
            لأسباب تشغيلية وأمنية، وهذا خارج عن تحكّمنا.
          </p>
        </div>
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
