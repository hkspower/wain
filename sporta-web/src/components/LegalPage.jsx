import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { usePageMeta, breadcrumbJsonLd, graph, SITE } from '../lib/seo'

// Shared layout for /terms and /privacy. Both are the same shape — a title, a
// last-updated date and a list of headed sections — so the shape lives here and
// each page supplies only its text.
//
// The date is a hard-coded string rather than a build timestamp: "last updated"
// on a legal page has to mean the day the WORDING changed, not the day the site
// was last deployed. A build-time date would silently claim the policy had been
// revised every time an unrelated component was edited.
//
// A paragraph with `callout: true` in a section's `p` list is drawn as a boxed
// key fact (the return window, the card rule). Its wording is unchanged; the box
// only sets it apart so a phone reader finds it without scanning every line.

// Phrases the policy text already contains that point somewhere a reader can act
// on. Only the spans are changed: the sentence stays word for word, the phrase
// becomes a link. The contact details are the ones /contact and the footer show.
function linkify(text, lang) {
  const rules = [
    { text: '+965 2209 1914', href: 'https://wa.me/96522091914', external: true, ltr: true },
    { text: 'cs@sporta.com.kw', href: 'mailto:cs@sporta.com.kw' },
    { text: lang === 'ar' ? 'صفحة الإرجاع' : 'Returns page', to: '/returns' },
  ]
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(${rules.map((r) => escape(r.text)).join('|')})`)

  return text.split(pattern).map((part, i) => {
    const rule = rules.find((r) => r.text === part)
    if (!rule) return part
    if (rule.to) {
      return <Link key={i} to={rule.to} className="legal-link">{part}</Link>
    }
    return (
      <a
        key={i}
        href={rule.href}
        {...(rule.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        dir={rule.ltr ? 'ltr' : undefined}
        className="legal-link"
      >
        {part}
      </a>
    )
  })
}

export default function LegalPage({ path, titleKey, updated, sections, intro }) {
  const { lang, t } = useLang()
  const title = titleKey[lang]

  const jsonLd = useMemo(
    () =>
      graph(
        {
          '@type': 'WebPage',
          name: title,
          url: `${SITE}${path}`,
          inLanguage: lang,
          isPartOf: { '@id': `${SITE}/#website` },
          dateModified: updated,
          publisher: { '@id': `${SITE}/#store` },
        },
        breadcrumbJsonLd([
          [t.nav.home, '/'],
          [title, path],
        ]),
      ),
    [lang, t, title, path, updated],
  )

  usePageMeta({ title, description: intro[lang], path, jsonLd })

  // ar-KW renders Gregorian dates in Arabic numerals, which is what the rest of
  // the site uses; ar-SA would switch to the Hijri calendar.
  const shown = new Date(updated).toLocaleDateString(lang === 'ar' ? 'ar-KW' : 'en-GB',
    { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <section className="legal-page mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <h1 className="legal-title text-3xl font-extrabold">{title}</h1>
      <p className="mt-3 text-sm text-slate-600">
        {t.legal.updated}: <time dateTime={updated}>{shown}</time>
      </p>
      <p className="mt-6 max-w-[68ch] text-lg leading-[1.7] text-slate-700">{intro[lang]}</p>

      <div className="mt-10">
        {sections.map((s) => (
          <section
            key={s.h.en}
            id={s.id}
            className="scroll-mt-28 border-t border-black/10 py-8 first:border-t-0 first:pt-0"
          >
            <h2 className="legal-h2 text-xl font-extrabold">{s.h[lang]}</h2>
            <div className="mt-4 space-y-4">
              {s.p.map((para) =>
                para.callout ? (
                  <div key={para.en} className="policy-callout max-w-[68ch]">
                    <p className="leading-[1.7] text-slate-800">{linkify(para[lang], lang)}</p>
                  </div>
                ) : (
                  <p key={para.en} className="max-w-[68ch] leading-[1.7] text-slate-700">
                    {linkify(para[lang], lang)}
                  </p>
                ),
              )}
              {s.list && (
                <ul className="max-w-[68ch] list-disc space-y-2 ps-5 leading-[1.7] text-slate-700">
                  {s.list.map((li) => <li key={li.en}>{linkify(li[lang], lang)}</li>)}
                </ul>
              )}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}
