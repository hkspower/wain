import { createContext, useContext, useEffect, useState } from 'react'
import { translations } from './translations'

const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'en')

  useEffect(() => {
    const dir = translations[lang].dir
    document.documentElement.lang = lang
    document.documentElement.dir = dir
    localStorage.setItem('lang', lang)
  }, [lang])

  const toggle = () => setLang((l) => (l === 'en' ? 'ar' : 'en'))

  // `dir` is exposed because components need it, not just <html>. A table that
  // must mirror, or an element that has to opt OUT of the page direction,
  // cannot read it off the document without a DOM query.
  return (
    <LanguageContext.Provider
      value={{ lang, setLang, toggle, t: translations[lang], dir: translations[lang].dir }}
    >
      {children}
    </LanguageContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLang() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLang must be used within LanguageProvider')
  return ctx
}
