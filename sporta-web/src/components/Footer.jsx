import { useLang } from '../i18n/LanguageContext'

export default function Footer() {
  const { t } = useLang()
  return (
    <footer className="mt-20 border-t border-slate-100 bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8 text-center text-sm text-slate-500">
        © {new Date().getFullYear()} {t.hero.title}. {t.footer.rights}
      </div>
    </footer>
  )
}
