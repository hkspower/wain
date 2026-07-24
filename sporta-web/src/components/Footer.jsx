import { useLang } from '../i18n/LanguageContext'

export default function Footer() {
  const { t } = useLang()
  return (
    <footer className="mt-20 bg-ink text-slate-300">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-10 text-center">
        <span className="text-2xl font-extrabold text-brand">{t.hero.title}</span>
        <div className="flex items-center gap-5 text-sm font-semibold">
          <a href="https://www.instagram.com/sporta.kw" target="_blank" rel="noopener noreferrer" className="hover:text-brand">
            Instagram
          </a>
          <a href="https://wa.me/96522091914" target="_blank" rel="noopener noreferrer" className="hover:text-brand">
            WhatsApp 22091914
          </a>
          <a href="mailto:cs@sporta.com.kw" className="hover:text-brand">Email</a>
        </div>
        <p className="text-xs text-slate-500">
          © {new Date().getFullYear()} {t.hero.title} — {t.footer.rights}
        </p>
      </div>
    </footer>
  )
}
