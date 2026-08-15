import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { GOVERNORATES } from '../lib/kuwait'
import { useLang } from '../i18n/LanguageContext'

// The delivery AREA — a scrolling dropdown you can also type into.
//
// It replaces an <input list="…"> + <datalist>. A datalist looks like a plain
// text box: there is no affordance saying a list exists, it only opens after
// you type, and on iOS Safari it frequently does not open at all — so on the
// phones this shop is mostly used from, the 97 areas the shop delivers to were
// effectively invisible and every shopper hand-typed their area.
//
// It is a COMBOBOX, not a <select>, and deliberately so: the list covers the
// areas Sporta delivers to, but a new suburb must never be the reason someone
// cannot place an order. Whatever is typed is kept even if it matches nothing.
//
// Follows the ARIA combobox pattern: aria-expanded/-controls/-activedescendant
// on the input, a real listbox, and arrow keys / Enter / Escape / Home / End.
// The list scrolls (max-height) rather than growing to 97 rows, and the active
// option is scrolled into view as it moves — an option you cannot see is not
// really selected.

export default function AreaSelect({
  value, onPick, governorateId, invalid, describedBy, placeholder, id = 'f-area',
}) {
  const { lang, t } = useLang()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [typed, setTyped] = useState(false) // filter only after they type
  const [up, setUp] = useState(false)       // open upward when the room is below
  const box = useRef(null)
  const listRef = useRef(null)

  // Which areas to offer. With a governorate chosen, only its own — that is
  // the whole point of picking one first. Without, every area, each labelled
  // with its governorate, because choosing the area then FILLS the governorate
  // in (Checkout does that via governorateOfArea) and the shopper should not
  // have to know which one their area belongs to.
  const pool = useMemo(() => {
    const gov = GOVERNORATES.find((g) => g.id === governorateId)
    const list = gov
      ? gov.areas.map((a) => ({ ...a, gov: null }))
      : GOVERNORATES.flatMap((g) => g.areas.map((a) => ({ ...a, gov: g.name[lang] })))
    return list
  }, [governorateId, lang])

  const q = String(value ?? '').trim().toLowerCase()
  const options = useMemo(() => {
    // Before they type, the full list — that is what makes it feel like a
    // dropdown rather than a search box. After, a contains-match on BOTH
    // scripts, so "sal" and "سال" each find Salmiya.
    if (!typed || q === '') return pool
    return pool.filter(
      (a) => a.en.toLowerCase().includes(q) || a.ar.includes(String(value).trim()),
    )
  }, [pool, q, typed, value])

  // Which way to open. A list that opens downward off the bottom of a phone —
  // under the sticky pay bar — is a list the shopper never sees. Measured at
  // the moment of opening, because that is when the field's position is known.
  useEffect(() => {
    if (!open) return
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    const LIST = 240 // matches max-h-60
    setUp(r.bottom + LIST > window.innerHeight && r.top > LIST)
  }, [open])

  // Close on outside click / focus leaving the widget entirely.
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  // Keep the highlighted row visible while arrowing through a scrolled list.
  useEffect(() => {
    if (!open || active < 0) return
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (a) => {
    onPick(a[lang])
    setOpen(false)
    setTyped(false)
    setActive(-1)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); setActive(0); return }
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => {
        const n = options.length
        if (!n) return -1
        return ((i < 0 ? (step > 0 ? 0 : n - 1) : i + step) + n) % n
      })
      return
    }
    if (e.key === 'Home' && open) { e.preventDefault(); setActive(0); return }
    if (e.key === 'End' && open) { e.preventDefault(); setActive(options.length - 1); return }
    if (e.key === 'Enter' && open && active >= 0 && options[active]) {
      e.preventDefault()   // do not submit the form on the keystroke that picks
      choose(options[active])
      return
    }
    if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); setActive(-1) }
  }

  return (
    <div ref={box} className="relative">
      <input
        id={id}
        name="address-level2"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="address-level2"
        value={value}
        placeholder={placeholder}
        maxLength={60}
        enterKeyHint="next"
        onChange={(e) => { setTyped(true); setActive(-1); setOpen(true); onPick(e.target.value) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={`w-full rounded-xl border bg-white px-3 pe-10 py-2.5 text-sm outline-none transition
          ${invalid ? 'border-rose-400 focus:border-rose-500' : 'border-slate-200 focus:border-brand'}`}
      />
      {/* The affordance the datalist never had: something to press that says
          "there is a list here". Not a tab stop — the input already opens it,
          and a second stop between every address field is noise for a keyboard
          or screen-reader user. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onPointerDown={(e) => { e.preventDefault(); setTyped(false); setOpen((o) => !o) }}
        className="absolute end-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
          <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={t.checkout.area}
          className={`absolute z-30 max-h-60 w-full overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white py-1 shadow-xl ${
            up ? 'bottom-full mb-1' : 'mt-1'
          }`}
        >
          {options.length === 0 && (
            // Not an error: an unlisted area is still deliverable, and the
            // shopper has already typed it into the field.
            <li className="px-3 py-2 text-xs text-slate-600">{t.checkout.areaFree}</li>
          )}
          {options.map((a, i) => (
            <li
              key={`${a.en}-${i}`}
              id={`${listId}-${i}`}
              data-i={i}
              role="option"
              aria-selected={a[lang] === value}
              onPointerDown={(e) => { e.preventDefault(); choose(a) }}
              onPointerEnter={() => setActive(i)}
              className={`flex cursor-pointer items-baseline justify-between gap-2 px-3 py-2 text-sm
                ${i === active ? 'bg-brand/10 text-brand-dark' : 'text-slate-700'}`}
            >
              <span>{a[lang]}</span>
              {a.gov && <span className="text-xs text-slate-500">{a.gov}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
