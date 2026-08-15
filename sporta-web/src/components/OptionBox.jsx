import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'

// A labelled box of choices — size, fit, colour.
//
// One component for all three so they cannot drift apart: same box, same label
// row, same chip metrics, same selected treatment. Three hand-built rows is how
// a page ends up with three different ideas of what "chosen" looks like.
//
// The selected chip is near-black on brand orange PLUS a ring. Colour alone is
// not a state: about one man in twelve cannot separate this orange from the
// grey of the unselected chips, and the ring is what tells them.
export function OptionBox({ label, aside, children, hint }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-slate-900">{label}</span>
        {aside}
      </div>
      {children}
      {hint && <p className="mt-2.5 text-xs text-slate-600">{hint}</p>}
    </div>
  )
}

const CHIP =
  'relative flex h-11 min-w-11 items-center justify-center rounded-xl border px-3.5 text-sm font-bold transition'

export function Chip({ children, selected, disabled, title, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      className={`${CHIP} ${
        disabled
          ? // A disabled control is normally exempt from the contrast floor, and
            // this one is not: the struck-through label is the message. "We do
            // not carry 5XL" has to be READABLE, or the box says nothing to the
            // customer it is speaking to. slate-400 on slate-100 measured
            // 2.4:1; slate-600 is 6.9:1 and still plainly inactive, because the
            // grey fill and the strike are what say so.
            'cursor-not-allowed border-black/10 bg-slate-100 text-slate-600'
          : selected
            ? 'border-brand bg-brand text-ink ring-2 ring-brand/30'
            : 'border-black/15 bg-white text-slate-700 hover:border-brand hover:text-brand-dark'
      }`}
    >
      {/* A struck-through label says "this size exists and you cannot have it",
          which is the truth. Hiding it instead makes the shop look like it
          never stocked the size at all. */}
      <span className={disabled ? 'line-through decoration-slate-500/70' : undefined}>{children}</span>
    </button>
  )
}

export function ChipRow({ label, children }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {children}
    </div>
  )
}

// Colour is not a per-line option the way size and fit are: each colourway is a
// separate product with its own slug, price, stock and photographs. So these
// are LINKS, and choosing one navigates — which is what keeps the stock line on
// the page honest, because it is then that product's own stock.
export function ColourSwatches({ colours, label }) {
  const { lang } = useLang()
  return (
    <ul className="flex flex-wrap gap-2.5" aria-label={label}>
      {colours.map((c) => (
        <li key={c.slug}>
          <Link
            to={`/product/${c.slug}`}
            aria-current={c.current ? 'page' : undefined}
            title={c.name[lang]}
            className={`tap flex items-center gap-2 rounded-full border py-1.5 pe-3.5 ps-1.5 text-xs font-semibold transition ${
              c.current
                ? 'border-brand text-slate-900 ring-2 ring-brand/30'
                : 'border-black/15 text-slate-700 hover:border-brand'
            }`}
          >
            {/* ring-inset so a near-white colourway still has an edge, and a
                dark one is not outlined in a colour it does not have. */}
            <span
              className="h-7 w-7 rounded-full ring-1 ring-inset ring-black/20"
              style={{ background: c.hex }}
              aria-hidden
            />
            {c.name[lang]}
          </Link>
        </li>
      ))}
    </ul>
  )
}
