import { useEffect } from 'react'
import { useLang } from '../i18n/LanguageContext'
import { IconClose } from './icons'

// Size guide — sizing doubt is a top cause of hesitation and returns in
// apparel. Measurements in cm (standard for the Kuwait market).
const ROWS = [
  { size: 'S', chest: '88–94', waist: '73–79', length: '68' },
  { size: 'M', chest: '96–102', waist: '81–87', length: '70' },
  { size: 'L', chest: '104–110', waist: '89–95', length: '72' },
  { size: 'XL', chest: '112–118', waist: '97–103', length: '74' },
]

export default function SizeGuide({ open, onClose }) {
  const { t } = useLang()

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.size.guide}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
    >
      <div className="card w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-slate-900">{t.size.guide}</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <IconClose size={22} />
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-500">{t.size.note}</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-slate-500">
                <th className="py-2 text-start font-semibold">{t.size.label}</th>
                <th className="py-2 text-start font-semibold">{t.size.chest}</th>
                <th className="py-2 text-start font-semibold">{t.size.waist}</th>
                <th className="py-2 text-start font-semibold">{t.size.length}</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.size} className="border-b border-black/5">
                  <td className="py-2.5 font-bold text-brand-dark">{r.size}</td>
                  <td className="py-2.5 tabular-nums text-slate-600">{r.chest}</td>
                  <td className="py-2.5 tabular-nums text-slate-600">{r.waist}</td>
                  <td className="py-2.5 tabular-nums text-slate-600">{r.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
