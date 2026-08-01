import { createContext, useContext, useEffect, useState } from 'react'
import { translations } from './translations'
import { detectLangFromBrowser } from './detectLang'

const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  // The boot script in index.html has ALREADY decided, before the first paint,
  // and written the answer to window.__SPORTA_LANG and <html lang>. Reading it
  // back is what keeps React from disagreeing with the document for one frame
  // — which would be a full LTR→RTL relayout in front of the visitor.
  // detectLangFromBrowser() is the fallback for anything that renders without
  // that script (a test harness, the html5 build).
  const [lang, setLang] = useState(
    () => window.__SPORTA_LANG ?? document.documentElement.lang ?? detectLangFromBrowser(),
  )

  useEffect(() => {
    const dir = translations[lang].dir
    document.documentElement.lang = lang
    document.documentElement.dir = dir
  }, [lang])

  // Only a TAP is a choice.
  //
  // This used to persist on every render, so the detected language became a
  // stored preference the moment the page loaded — and a visitor who was
  // guessed wrong, or who travelled, was locked in with no way back except
  // finding the toggle. Now the key means exactly one thing: "the visitor
  // asked for this", and detection re-runs on every visit until they do.
  const choose = (next) => {
    try { localStorage.setItem('lang', next) } catch { /* storage disabled */ }
    setLang(next)
  }
  const toggle = () => choose(lang === 'en' ? 'ar' : 'en')

  // `dir` is exposed because components need it, not just <html>. A table that
  // must mirror, or an element that has to opt OUT of the page direction,
  // cannot read it off the document without a DOM query.
  return (
    <LanguageContext.Provider
      value={{ lang, setLang: choose, toggle, t: translations[lang], dir: translations[lang].dir }}
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
