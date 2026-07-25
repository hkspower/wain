import { useMemo } from 'react'
import { useLang } from '../i18n/LanguageContext'
import { usePageMeta, faqJsonLd, breadcrumbJsonLd, graph } from '../lib/seo'

// Visible FAQ — the FAQPage schema below is built from these exact strings,
// per Google's requirement that structured data match rendered content.
const FAQ = [
  {
    q: { en: 'Do you deliver same-day in Kuwait?', ar: 'هل توصلون في نفس اليوم داخل الكويت؟' },
    a: {
      en: 'Yes — orders inside Kuwait are delivered the same day. Delivery updates are sent on WhatsApp.',
      ar: 'نعم — الطلبات داخل الكويت تُوصَّل في نفس اليوم، وتصلك تحديثات التوصيل عبر واتساب.',
    },
  },
  {
    q: { en: 'What payment methods do you accept?', ar: 'ما طرق الدفع المتوفرة؟' },
    a: {
      en: 'KNET (Kuwait debit), Visa and Mastercard. All prices are in Kuwaiti Dinar (KWD).',
      ar: 'كي نت وفيزا وماستركارد، وجميع الأسعار بالدينار الكويتي.',
    },
  },
  {
    q: { en: 'Can I exchange or return an item?', ar: 'هل يمكن الاستبدال أو الإرجاع؟' },
    a: {
      en: 'Yes — exchange and return are free. Contact us on WhatsApp +965 2209 1914 to arrange it.',
      ar: 'نعم — الاستبدال والإرجاع مجانيان. تواصل معنا عبر واتساب \u200E+965 2209 1914 لترتيب ذلك.',
    },
  },
  {
    q: { en: 'Do you ship outside Kuwait (GCC / Middle East)?', ar: 'هل تشحنون خارج الكويت (الخليج / الشرق الأوسط)؟' },
    a: {
      en: 'Online checkout covers Kuwait. For GCC and Middle East orders, message us on WhatsApp and we will arrange it.',
      ar: 'الدفع عبر الموقع متاح داخل الكويت. لطلبات دول الخليج والشرق الأوسط راسلنا على واتساب وسنرتب الشحن.',
    },
  },
  {
    q: { en: 'Which brands do you carry?', ar: 'ما الماركات المتوفرة لديكم؟' },
    a: {
      en: 'RHEO, Vanquish, ATE, Gymshark, Eyesportwear and our own SPORTA label — activewear, hoodies and gym accessories.',
      ar: 'ريو، فانكويش، ATE، جيمشارك، آي سبورت وماركتنا الخاصة سبورتا — ملابس رياضية وهوديز وإكسسوارات جيم.',
    },
  },
]

export default function About() {
  const { lang, t } = useLang()
  const faqItems = FAQ.map((f) => ({ q: f.q[lang], a: f.a[lang] }))
  const jsonLd = useMemo(
    () =>
      graph(
        {
          '@type': 'AboutPage',
          name: lang === 'ar' ? 'من نحن — سبورتا' : 'About Sporta',
          url: 'https://www.sporta.com.kw/about',
          about: { '@id': 'https://www.sporta.com.kw/#store' },
          inLanguage: lang,
        },
        faqJsonLd(faqItems),
        breadcrumbJsonLd([
          [t.nav.home, '/'],
          [t.nav.about, '/about'],
        ]),
      ),
    // faqItems derives from lang, so lang covers it
    [lang, t],
  )
  usePageMeta({
    title: t.about.title,
    description:
      lang === 'ar'
        ? 'سبورتا — متجر ملابس رياضية كويتي: توصيل في نفس اليوم، دفع كي نت، استبدال مجاني.'
        : 'Sporta is a Kuwaiti sportswear store — same-day delivery, KNET payment, free exchange & return.',
    path: '/about',
    jsonLd,
  })
  return (
    <section className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="mb-6 text-3xl font-extrabold text-brand-dark">{t.about.title}</h1>
      <p className="text-lg leading-relaxed text-slate-600">{t.about.body}</p>

      <h2 className="mb-4 mt-12 text-2xl font-extrabold text-brand-dark">
        {lang === 'ar' ? 'الأسئلة الشائعة' : 'Frequently asked questions'}
      </h2>
      <div className="divide-y divide-slate-200">
        {faqItems.map((f) => (
          <details key={f.q} className="group py-4">
            <summary className="cursor-pointer list-none font-semibold text-slate-800 transition-colors group-open:text-brand">
              {f.q}
            </summary>
            <p className="mt-2 leading-relaxed text-slate-600">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
