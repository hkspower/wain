import { useMemo } from 'react'
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

  const updatedLabel = lang === 'ar' ? 'آخر تحديث' : 'Last updated'
  // ar-KW renders Gregorian dates in Arabic numerals, which is what the rest of
  // the site uses; ar-SA would switch to the Hijri calendar.
  const shown = new Date(updated).toLocaleDateString(lang === 'ar' ? 'ar-KW' : 'en-GB',
    { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <section className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-extrabold text-brand-dark">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">
        {updatedLabel}: <time dateTime={updated}>{shown}</time>
      </p>
      <p className="mt-6 text-lg leading-relaxed text-slate-600">{intro[lang]}</p>

      <div className="mt-10 space-y-9">
        {sections.map((s) => (
          <section key={s.h.en} id={s.id}>
            <h2 className="mb-3 scroll-mt-28 text-xl font-extrabold text-brand-dark">{s.h[lang]}</h2>
            {s.p.map((para) => (
              <p key={para.en} className="mb-3 leading-relaxed text-slate-600">{para[lang]}</p>
            ))}
            {s.list && (
              <ul className="mt-2 list-disc space-y-1.5 ps-5 leading-relaxed text-slate-600">
                {s.list.map((li) => <li key={li.en}>{li[lang]}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>
    </section>
  )
}
