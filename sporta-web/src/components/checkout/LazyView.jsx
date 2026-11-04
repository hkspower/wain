import { useEffect, useRef, useState } from 'react'
import { useLang } from '../../i18n/LanguageContext'
import { loadChunk, peekChunk, retryChunk } from '../../lib/retryImport'

// A part of the checkout that is loaded on demand, with the three states a
// shopper can actually be in: it is here, it is on its way, or it could not come.
//
//   <LazyView
//     load={loadQuickCheckout}                  the SAME function everywhere (chunks.js)
//     fallback={<Skeleton />}                   shown while it loads; reserve the final height
//     alternative={{ label, onClick }}          optional: another way forward when it cannot load
//     render={(Part) => <Part ...props />}
//   />
//
// 1. READY WITHOUT A FLASH. If a prefetch already brought the chunk, the first
//    render uses it: no fallback, no layout change, nothing to see.
// 2. LOADING reserves the space the real thing will take (the caller's fallback),
//    so the page below does not jump when it arrives, and says "loading" to a
//    screen reader.
// 3. FAILED is a message, a Retry button and, when the caller has one, a way to
//    carry on without this part. It is never an empty page. A second failure in
//    a row adds "Reload page", because some browsers keep a failed module for
//    the life of the page (lib/retryImport.js explains the measurement).
//
// The copy is a language pair here rather than keys in i18n/translations.js: it
// is a transport error, not shop copy, and the same shape as SiteErrorBoundary.

const COPY = {
  en: {
    failed: 'This part of the page could not load. Check your connection and try again.',
    retry: 'Try again',
    retrying: 'Trying…',
    reload: 'Reload page',
  },
  ar: {
    failed: 'تعذّر تحميل هذا الجزء من الصفحة. تحقق من اتصالك ثم حاول مرة أخرى.',
    retry: 'إعادة المحاولة',
    retrying: 'جارٍ المحاولة…',
    reload: 'إعادة تحميل الصفحة',
  },
}

export default function LazyView({ load, render, fallback, alternative }) {
  const { lang, t } = useLang()
  const c = COPY[lang] ?? COPY.en
  // Lazy initial state: the module itself when it is already loaded.
  const [mod, setMod] = useState(() => peekChunk(load))
  const [failures, setFailures] = useState(0)
  const [trying, setTrying] = useState(false)
  const [attempt, setAttempt] = useState(0) // bumped by Retry to run the effect again
  const wrap = useRef(null)
  const recovered = useRef(false)

  useEffect(() => {
    if (mod) return undefined
    let live = true
    const run = attempt === 0 ? loadChunk(load) : retryChunk(load)
    run.then(
      (m) => {
        if (!live) return
        setMod(m)
        setTrying(false)
        // The Retry button the shopper just pressed is about to leave the page;
        // put focus on the content that replaces it instead of dropping it on <body>.
        if (attempt > 0) recovered.current = true
      },
      () => {
        if (!live) return
        setFailures((n) => n + 1)
        setTrying(false)
      },
    )
    return () => { live = false }
  }, [load, mod, attempt])

  useEffect(() => {
    if (mod && recovered.current) {
      recovered.current = false
      wrap.current?.focus({ preventScroll: true })
    }
  }, [mod])

  if (mod) {
    // tabIndex -1: focusable by script only, so it is not a new tab stop.
    return <div ref={wrap} tabIndex={-1} className="outline-none">{render(mod.default)}</div>
  }

  // Stays on screen while a retry runs (the button only changes its label), so
  // the keyboard focus the shopper is on does not vanish with every failed try.
  if (failures > 0) {
    return (
      <div ref={wrap} role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm">
        <p className="font-semibold text-rose-700">{c.failed}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            aria-disabled={trying || undefined}
            onClick={() => {
              if (trying) return
              setTrying(true)
              setAttempt((n) => n + 1)
            }}
          >
            {trying ? c.retrying : c.retry}
          </button>
          {failures > 1 && (
            <button type="button" className="btn btn-ghost text-slate-800" onClick={() => window.location.reload()}>
              {c.reload}
            </button>
          )}
          {alternative && (
            <button type="button" className="btn btn-ghost text-slate-800" onClick={alternative.onClick}>
              {alternative.label}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-label={t.a11y.loading}>
      {fallback}
    </div>
  )
}
