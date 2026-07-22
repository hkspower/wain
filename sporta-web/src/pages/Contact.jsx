import { useLang } from '../i18n/LanguageContext'

export default function Contact() {
  const { t } = useLang()
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
          <span dir="ltr">+965 0000 0000</span>
        </p>
      </div>
    </section>
  )
}
