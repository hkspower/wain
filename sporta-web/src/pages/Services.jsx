import { useLang } from '../i18n/LanguageContext'

export default function Services() {
  const { t } = useLang()
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="mb-10 text-3xl font-extrabold text-brand-dark">{t.services.title}</h1>
      <div className="grid gap-6 md:grid-cols-3">
        {t.services.items.map((item, i) => (
          <div
            key={i}
            className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition hover:shadow-md"
          >
            <h2 className="mb-3 text-xl font-bold text-brand">{item.title}</h2>
            <p className="text-slate-600">{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
