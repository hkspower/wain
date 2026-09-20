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
    <div className="measure mx-auto max-w-3xl px-2.5 py-2 sm:px-4 sm:py-3">
      <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">
        الخصوصية والكوكيز
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-ink-600">
        {/* «وما يجمع عنك أي بيانات» was here, full stop, and it stopped being
            exactly true the day the endpoints under /api/ started keeping a
            technical log — a line per request, with the address reduced to a
            hash and the sentence left out entirely, described in «الاستضافة»
            below. Nobody would call that profiling, and that is not the point:
            a privacy page that overstates is the same defect as one that
            denies the database, which this file already had to fix once. */}
        باختصار: <strong className="text-ink-900">وين ما يستخدم كوكيز</strong>، وما
        يتتبّعك، وما عنده حساب لك. الصفحة هذي تشرح الوضع بالتفصيل — بما فيه
        الشي الوحيد اللي نسجّله.
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
          a business submission waits for a submit, and the map does not wait
          for anything. ("the submission webhook" is what this said, and it was
          wrong twice over: submissions go to Supabase, and the n8n host it
          pointed at is in the CSP only as the NEXT_PUBLIC_WAIN_TTS_URL escape
          hatch. Nothing in the browser posts a submission to a webhook.)
          Leaving the map undisclosed was the page's one real
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
            أغلب المقاطع الصوتية ملفات جاهزة من ضمن الموقع نفسه، وهذي ما يطلع
            معها ولا شي من جهازك.
          </p>
          {/* This paragraph replaces «بالحالتين ما يطلع أي شي من جهازك», which
              described the site as it was before /api/tts.php existed and was
              never updated when the bridge landed. It happens to be true today
              only because the key file is empty — the bridge answers 503 and
              nothing is sent — and «true because the feature is switched off»
              is not something a privacy page should be relying on without
              saying so. */}
          <p>
            الجُمل اللي تتكوّن وقت الاستخدام ما لها مقطع جاهز، فإذا كان النطق
            مشغّل على الخادم تنرسل{" "}
            <strong className="text-ink-900">الجملة نفسها بس</strong> — بدون
            اسمك ولا أي شي يعرّفك — لخادم وين وبعدها لخدمة النطق عشان ترجع
            صوتاً. الصوت ينحفظ عندنا عشان نفس الجملة ما تنرسل مرة ثانية. وإذا
            كان مو مشغّل، يستخدم المتصفح صوته العربي الداخلي وما يطلع شي.
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
          {/* Was «ما فيه سيرفر يشغّل كود» — no server running code — which was
              true of the pages and never of the account: /api/ holds wain's own
              PHP, and has since the voice bridge was installed. The pages
              themselves really are static files, which is the part worth
              keeping; the sentence just claimed more than that. */}
          <p>
            صفحات وين ملفات ثابتة (static): ما فيه حسابات ولا تسجيل دخول
            للزوار، وتقدر تتصفّح الموقع كله وتدوّر وتقرا الأماكن بدون ما
            تعطينا ولا معلومة. الاستثناءات الوحيدة طرفان على خادم وين تحت{" "}
            <code dir="ltr">/api/</code>: واحد للنطق (فوق)، وواحد للنشر ما
            يمسّه زائر أبداً.
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
          {/* The new paragraph, and the reason the whole page needed re-reading
              before the logging shipped: the sentence above framed logs as
              somebody else's, which was accurate right up until we kept one.
              What it lists is what the two endpoints actually write — asserted
              line by line in test:tts and test:media, not merely promised. */}
          <p>
            واللي بيدنا إحنا: الطرفان فوق يكتبون سطر تقني لكل طلب — الوقت، وش
            صار (نجح، انرفض، طلع من الذاكرة)، حجم الرد، وكم أخذ. ما ينكتب فيه{" "}
            <strong className="text-ink-900">
              لا نص الجملة، ولا اسم أي ملف ترفعه، ولا عنوان الـ IP حقك
            </strong>{" "}
            — العنوان ينختصر لبصمة ما ترجع لأصلها، بس عشان نعرف إن الطلبات من
            زائر واحد. الهدف واحد: إن خلل بالخدمة ما يبقى صامت شهر. والملف له
            سقف ثابت ويدوّر على نفسه، فما يكبر بلا نهاية، وما ينوصل له من أي
            رابط.
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
