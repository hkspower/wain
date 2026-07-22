import { useLang } from '../i18n/LanguageContext'

export default function About() {
  const { t } = useLang()
  return (
    <section className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="mb-6 text-3xl font-extrabold text-brand-dark">{t.about.title}</h1>
      <p className="text-lg leading-relaxed text-slate-600">{t.about.body}</p>
    </section>
  )
}
