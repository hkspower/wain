import { useMemo } from 'react'
import { useLang } from '../i18n/LanguageContext'
import { usePageMeta, breadcrumbJsonLd, graph } from '../lib/seo'
import { IconArrowRight, IconWhatsApp } from '../components/icons'

// The two ways to reach the shop this page has always shown. The same values
// appear in the footer, the terms and the meta description; change them in all
// of those together, never here alone.
const WHATSAPP_NUMBER = '+965 2209 1914'
const WHATSAPP_HREF = 'https://wa.me/96522091914'
const EMAIL = 'cs@sporta.com.kw'

// An envelope in the same 24x24 stroke family as components/icons.jsx. Kept here
// because that module has no mail icon and this page does not own it.
function IconMail({ size = 22 }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 6.5 8.5 6 8.5-6" />
    </svg>
  )
}

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
        ? 'تواصل مع سبورتا عبر واتساب ‎+965 2209 1914 أو البريد cs@sporta.com.kw — نرد بالعربي والإنجليزي.'
        : 'Contact Sporta on WhatsApp +965 2209 1914 or cs@sporta.com.kw — we answer in Arabic and English.',
    path: '/contact',
    jsonLd,
  })

  // One card per channel that has a value. Both are set above, so both show;
  // the filter is the rule, so an empty channel can never become an empty card.
  const channels = [
    {
      key: 'whatsapp',
      label: t.contact.phone,
      value: WHATSAPP_NUMBER,
      href: WHATSAPP_HREF,
      cta: t.contact.whatsappCta,
      Icon: IconWhatsApp,
      external: true,
    },
    {
      key: 'email',
      label: t.contact.email,
      value: EMAIL,
      href: `mailto:${EMAIL}`,
      cta: t.contact.emailCta,
      Icon: IconMail,
      external: false,
    },
  ].filter((c) => c.value && c.href)

  return (
    <section className="contact-page mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <h1 className="contact-title text-3xl font-extrabold">{t.contact.title}</h1>
      <p className="mt-4 max-w-[68ch] text-lg leading-[1.7] text-slate-700">{t.contact.body}</p>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2">
        {channels.map((c) => (
          <li key={c.key}>
            <a
              href={c.href}
              {...(c.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="contact-card"
            >
              <span className="contact-card__icon">
                <c.Icon size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-600">{c.label}</span>
                {/* The number and address stay left-to-right in both languages.
                    inline-block keeps the line at the reading start, so an
                    Arabic card still lines up with its Arabic label. */}
                <span className="mt-0.5 block">
                  <span dir="ltr" className="inline-block break-words text-lg font-extrabold text-slate-900">
                    {c.value}
                  </span>
                </span>
                <span className="contact-card__cta mt-1.5">
                  {c.cta}
                  <IconArrowRight size={16} className="rtl:rotate-180" />
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
