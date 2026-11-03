import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../i18n/LanguageContext'
import { usePageMeta, faqJsonLd, breadcrumbJsonLd, graph } from '../lib/seo'
import { phpBrands } from '../lib/backend'

// The brand names are the admin's Brands list (the public r=brands: shown
// brands, in the order the API sends them), so the Brands screen controls this
// page. The wording below is the fallback: it stays when the list cannot be read
// or is empty. The live site (a compiled build) gets the same behaviour from
// public/sporta-features.js, which swaps only the brand-name run in the same
// sentences; keep the two joins in step.
const STATIC_BRANDS = {
  // the wording that stays when the list cannot be read: the card's is the live build's "و" between all;
  // a LIVE run uses Arabic commas in every sentence (a bare "و" is unreadable once a name has several words)
  comma: {
    en: 'RHEO, Vanquish, ATE, Gymshark, Eyesportwear and our own SPORTA label',
    ar: 'ريو، فانكويش، ATE، جيمشارك، آي سبورت وماركتنا الخاصة سبورتا',
  },
  and: {
    en: 'RHEO, Vanquish, ATE, Gymshark, Eyesportwear and our own SPORTA label',
    ar: 'ريو وفانكويش وATE وجيمشارك وآي سبورت وماركتنا الخاصة سبورتا',
  },
}
const OWN_LABEL = { en: 'our own SPORTA label', ar: 'ماركتنا الخاصة سبورتا' }

/** A name from the other script inside a sentence is isolated so punctuation cannot flip (not in JSON-LD). */
function isolate(name, lang, plain) {
  if (plain) return name
  return (lang === 'ar' ? /[A-Za-z]/ : /[\u0600-\u06ff]/).test(name) ? `\u2068${name}\u2069` : name
}

/** "A, B and C" / "أ، ب وج" from the API rows; the static wording when there is nothing to say. */
function brandRun(rows, lang, style, plain = false) {
  const list = (Array.isArray(rows) ? rows : [])
    .filter((b) => b && typeof b === 'object')
    .map((b) => ({
      n: String((lang === 'ar' ? b.name_ar || b.name_en : b.name_en || b.name_ar) || '').replace(/\s+/g, ' ').trim(),
      slug: String(b.slug || '').trim().toLowerCase(),
    }))
    .filter((b) => b.n)
  if (!list.length) return STATIC_BRANDS[style][lang]
  // SPORTA is the shop's own label wherever the API lists it (the live list sends it first): it leaves the run
  // and is named last as "our own SPORTA label", never as one of the leading brands.
  const hasOwn = list.some((b) => b.slug === 'sporta')
  const parts = list.filter((b) => b.slug !== 'sporta').map((b) => isolate(b.n, lang, plain))
  if (hasOwn) parts.push(OWN_LABEL[lang])
  if (parts.length === 1) return parts[0]
  const head = parts.slice(0, -1)
  const last = parts[parts.length - 1]
  if (lang === 'ar') return `${head.join('، ')} و${last}`
  return `${head.join(', ')} and ${last}`
}

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
      en: 'KNET (Kuwait debit card), CBK T-Pay, or cash to the driver on delivery. All prices are in Kuwaiti Dinar (KWD).',
      ar: 'كي نت وتي-باي من البنك التجاري، أو نقدًا للمندوب عند الاستلام. وجميع الأسعار بالدينار الكويتي.',
    },
  },
  {
    q: { en: 'Can I exchange or return an item?', ar: 'هل يمكن الاستبدال أو الإرجاع؟' },
    a: {
      en: 'Yes — exchange and return are free within 14 days of delivery. Contact us on WhatsApp +965 2209 1914 to arrange it.',
      ar: 'نعم — الاستبدال والإرجاع مجانيان خلال ١٤ يومًا من الاستلام. تواصل معنا عبر واتساب \u200E+965 2209 1914 لترتيب ذلك.',
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
    // {brands} is filled from the Brands list (see brandRun)
    a: {
      en: '{brands} — activewear, hoodies and gym accessories.',
      ar: '{brands} — ملابس رياضية وهوديز وإكسسوارات جيم.',
    },
  },
]

// "Why Sporta?" in the footer used to point at /about with nothing to land on.
// These four are the promises the site already makes elsewhere — same-day
// delivery and the brand list here in the FAQ, free 14-day exchange on
// /returns, KNET on the checkout — gathered into one place rather than newly
// claimed.
const WHY = [
  {
    t: { en: 'Delivery within 24 hours · 1 KWD', ar: 'التوصيل خلال ٢٤ ساعة · ١ د.ك' },
    d: { en: 'Order today, wear it today. Delivery updates come to you on WhatsApp.',
         ar: 'اطلب اليوم والبسه اليوم، وتصلك تحديثات التوصيل على واتساب.' },
  },
  {
    t: { en: 'Free exchange and return', ar: 'استبدال وإرجاع مجانًا' },
    d: { en: 'Fourteen days to change your mind, at no cost. Sizes are easy to get wrong online.',
         ar: 'أربعة عشر يومًا لتغيير رأيك دون أي تكلفة، فالمقاسات صعبة التقدير عبر الإنترنت.' },
  },
  {
    t: { en: 'Pay the way Kuwait pays', ar: 'ادفع بالطريقة المعتادة في الكويت' },
    d: { en: 'KNET, in Kuwaiti Dinar. Card details go to the bank, never to us.',
         ar: 'كي نت بالدينار الكويتي، وبيانات البطاقة تذهب للبنك لا إلينا.' },
  },
  {
    t: { en: 'Brands worth training in', ar: 'ماركات تستحق التمرين بها' },
    d: { en: '{brands}.', ar: '{brands}.' },
  },
]

export default function About() {
  const { lang, t } = useLang()
  // null until the list arrives (or if it cannot be read): the static names show
  const [brands, setBrands] = useState(null)
  useEffect(() => {
    let live = true
    phpBrands()
      .then((rows) => { if (live && Array.isArray(rows)) setBrands(rows) })
      .catch(() => {})
    return () => { live = false }
  }, [])
  const fill = (text, style, plain) => text.replace('{brands}', brandRun(brands, lang, style, plain))
  const faqItems = FAQ.map((f) => ({ q: f.q[lang], a: fill(f.a[lang], 'comma', false) }))
  const faqLd = FAQ.map((f) => ({ q: f.q[lang], a: fill(f.a[lang], 'comma', true) }))
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
        faqJsonLd(faqLd),
        breadcrumbJsonLd([
          [t.nav.home, '/'],
          [t.nav.about, '/about'],
        ]),
      ),
    // faqLd derives from lang and the brand list
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, t, brands],
  )
  usePageMeta({
    title: t.about.title,
    description:
      lang === 'ar'
        ? 'سبورتا — متجر ملابس رياضية كويتي: توصيل في نفس اليوم، دفع كي نت، استبدال مجاني.'
        : 'Sporta is a Kuwaiti sportswear store — delivery within 24 hours for 1 KWD, KNET payment, free exchange.',
    path: '/about',
    jsonLd,
  })
  return (
    <section className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="mb-6 text-3xl font-extrabold text-brand-dark">{t.about.title}</h1>
      <p className="text-lg leading-relaxed text-slate-600">{t.about.body}</p>

      <h2 id="why" className="mb-6 mt-12 scroll-mt-28 text-2xl font-extrabold text-brand-dark">
        {lang === 'ar' ? 'لماذا سبورتا؟' : 'Why Sporta?'}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {WHY.map((w) => (
          <div key={w.t.en} className="rounded-2xl border border-slate-100 bg-white p-5">
            <h3 className="font-bold text-slate-900">{w.t[lang]}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{fill(w.d[lang], 'and', false)}</p>
          </div>
        ))}
      </div>

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
