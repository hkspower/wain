import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { PRODUCTS } from '../lib/products'
import { formatKWD } from '../lib/format'
import { IconSearch, IconClose } from './icons'

// Instant product search overlay. Bilingual (matches en + ar names),
// keyboard accessible: autofocus, Esc to close.
export default function SearchOverlay({ open, onClose }) {
  const { lang, t } = useLang()
  const [q, setQ] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setTimeout(() => inputRef.current?.focus(), 50)
      const onKey = (e) => e.key === 'Escape' && onClose()
      window.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
      return () => {
        window.removeEventListener('keydown', onKey)
        document.body.style.overflow = ''
      }
    }
  }, [open, onClose])

  if (!open) return null

  const needle = q.trim().toLowerCase()
  const results = needle
    ? PRODUCTS.filter(
        (p) =>
          p.name.en.toLowerCase().includes(needle) ||
          p.name.ar.includes(needle) ||
          p.category.includes(needle),
      )
    : PRODUCTS.slice(0, 4)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.search.title}
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/70 p-4 pt-24 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="card w-full max-w-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <IconSearch size={20} className="text-slate-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.search.placeholder}
            className="w-full bg-transparent text-lg outline-none placeholder:text-slate-400"
            aria-label={t.search.placeholder}
          />
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <IconClose size={20} />
          </button>
        </div>

        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <li className="p-6 text-center text-slate-400">{t.search.empty}</li>
          )}
          {results.map((p) => (
            <li key={p.slug}>
              <Link
                to={`/product/${p.slug}`}
                onClick={onClose}
                className="flex items-center gap-4 rounded-xl px-3 py-2.5 transition hover:bg-sand-light"
              >
                <img src={p.image} alt="" width="48" height="48" className="h-12 w-12 rounded-lg object-cover" />
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">{p.name[lang]}</p>
                  <p className="text-xs text-slate-500">{p.desc[lang]}</p>
                </div>
                <span className="text-sm font-bold text-brand-dark">{formatKWD(p.price, lang)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
