import { useMemo } from 'react'
import { useLang } from '../i18n/LanguageContext'
import { usePageMeta, breadcrumbJsonLd, graph } from '../lib/seo'

export default function Contact() {
  const { lang, t } = useLang()
  const jsonLd = useMemo(
    () =>
      graph(
        {
          '@type': 'ContactPage',
          name: lang === 'ar' ? 'اتصل بنا — سبورتا' : 'Contact Sporta',
          url: 'https://www.sporta.com.kw/contact',
          about: { '@id': 'https://www.sporta.com.kw/#store' },
          inLanguage: lang,
        },
        breadcrumbJsonLd([
          [t.nav.home, '/'],
          [t.nav.contact, '/contact'],
        ]),
      ),
    [lang, t],
  )
  usePageMeta({
    title: t.contact.title,
    description:
      lang === 'ar'
        ? 'تواصل مع سبورتا عبر واتساب ٢٢٠٩١٩١٤ ٩٦٥+ أو البريد cs@sporta.com.kw — نرد بالعربي والإنجليزي.'
        : 'Contact Sporta on WhatsApp +965 2209 1914 or cs@sporta.com.kw — we answer in Arabic and English.',
    path: '/contact',
    jsonLd,
  })
  return (
    <section className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="mb-6 text-3xl font-extrabold text-brand-dark">{t.contact.title}</h1>
      <p className="mb-8 text-lg text-slate-600">{t.contact.body}</p>
      <div className="space-y-3 text-slate-700">
        <p>
          <span className="font-semibold text-brand">{t.contact.email}: </span>
          <a href="mailto:cs@sporta.com.kw" className="underline">cs@sporta.com.kw</a>
        </p>
        <p>
          <span className="font-semibold text-brand">{t.contact.phone}: </span>
          <a href="https://wa.me/96522091914" target="_blank" rel="noopener noreferrer" className="underline" dir="ltr">
            +965 2209 1914 (WhatsApp)
          </a>
        </p>
      </div>
    </section>
  )
}
