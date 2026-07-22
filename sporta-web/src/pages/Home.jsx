import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'

export default function Home() {
  const { t } = useLang()
  return (
    <section className="bg-brand-light">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-24 text-center">
        <h1 className="text-5xl font-extrabold text-brand-dark md:text-6xl">{t.hero.title}</h1>
        <p className="max-w-xl text-lg text-slate-600">{t.hero.subtitle}</p>
        <Link
          to="/contact"
          className="rounded-full bg-brand px-8 py-3 font-semibold text-white shadow-lg transition hover:bg-brand-dark"
        >
          {t.hero.cta}
        </Link>
      </div>
    </section>
  )
}
