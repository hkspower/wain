import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteBrand, fetchBrands, saveBrand, setBrandActive, slugify } from './api'
import { Notice } from './Notice'
import { IconClose, IconImage } from '../components/icons'
import { downscaleImage, ACCEPTED_ATTR } from './lib/downscaleImage'

// The brands the shop carries. Add one, rename it, give it a logo, and show or
// hide it on the storefront.
//
// TWO THINGS THIS SCREEN DOES NOT DO, both on purpose:
//
//   * it never uploads a FILE. The image is read in the browser, downscaled on
//     a canvas and sent as a data: URL that lands in a database row. Uploading
//     would mean a PHP endpoint that writes into the web root, and the live
//     server once carried exactly that — sporta-deploy.php, answering to
//     anyone on the internet.
//   * it deletes a brand only when nothing uses it. The Remove button asks first,
//     and the server refuses while any product still points at the brand (it
//     says so, and "Hidden" is the reversible answer for those). The switch
//     remains the everyday control; Remove is for a brand added by mistake.
//
// The downscale is not a nicety. A logo dragged off a phone is a 4 MB
// photograph; at 320px and WebP it is a few kilobytes, and the server caps
// what it will store anyway — this is what keeps the admin from hitting that
// cap on every save. The scaling itself lives in lib/downscaleImage.js, shared
// with the slides screen, because the file-type check in it is a security rule
// and one copy of a security rule is one place to get it right.

const MAX_EDGE = 320

// The server refuses a logo whose data URL is longer than this (store.php
// STORE_LOGO_MAX, counted in bytes). The data URL is ASCII, so its length in
// characters is the same number. Checked here before the request, so the admin
// gets a sentence about what to do instead of "Try a smaller image" for a file
// it has already shrunk.
const LOGO_MAX_CHARS = 160000
// Edges tried in turn while a logo is still over the cap. The case that needs
// them is a logo that came back as PNG (a browser with no WebP encoder).
const LOGO_EDGES = [MAX_EDGE, 256, 192]

// Messages follow the admin language, the same way api.js picks its sentences.
const say = (en, ar) => (
  typeof document !== 'undefined' && document.documentElement.lang?.startsWith('ar') ? ar : en
)

const BLANK = { id: 0, slug: '', name_en: '', name_ar: '', logo: null, sort: 0 }

export default function Brands() {
  const [state, setState] = useState({ loading: true, brands: [] })
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const r = await fetchBrands()
    setState({
      loading: false,
      brands: r.brands ?? [],
      error: r.error,
      loadFailed: !!r.error,
      needsMigration: r.needsMigration,
      notSignedIn: r.notSignedIn,
    })
  }, [])
  useEffect(() => { load() }, [load])

  async function toggle(brand) {
    // Optimistic: the switch should feel like a switch. A failure puts it back.
    setState((s) => ({
      ...s,
      brands: s.brands.map((b) => (b.id === brand.id ? { ...b, active: !b.active } : b)),
    }))
    const r = await setBrandActive(brand.id, !brand.active)
    if (r.error) load()
  }

  async function remove(brand) {
    const ok = window.confirm(`Remove "${brand.name_en}" permanently? This cannot be undone.`)
    if (!ok) return
    setState((s) => ({ ...s, error: undefined }))
    const r = await deleteBrand(brand.id)
    if (r.error) return setState((s) => ({ ...s, error: r.error }))
    load()
  }

  if (state.loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (state.needsMigration) {
    return (
      <Notice tone="warn" title="The brands table is not installed yet">
        Import <code className="font-mono">api/brands.mysql.sql</code> once in
        phpMyAdmin — hPanel → Databases → phpMyAdmin → your database → Import.
      </Notice>
    )
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Brands</h2>
          <p className="text-sm text-slate-600">
            {state.brands.filter((b) => b.active).length} shown ·{' '}
            {state.brands.filter((b) => !b.active).length} hidden
          </p>
        </div>
        <button
          onClick={() => setEditing({ ...BLANK })}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700"
        >
          Add a brand
        </button>
      </header>

      {state.error && (
        <Notice tone="error" title={state.loadFailed ? 'Could not load brands' : 'Could not complete that'}>
          {state.error}
        </Notice>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {state.brands.map((b) => (
          <li
            key={b.id}
            className={`flex items-center gap-3 rounded-2xl border p-3 ${
              b.active ? 'border-slate-300 bg-white' : 'border-slate-300 bg-slate-50'
            }`}
          >
            <BrandMark brand={b} />
            <div className="min-w-0 flex-1">
              <p className={`truncate font-bold ${b.active ? 'text-slate-800' : 'text-slate-500'}`}>
                {b.name_en}
              </p>
              <p className="truncate text-sm text-slate-500" dir="rtl">{b.name_ar}</p>
              <p className="truncate font-mono text-[0.7rem] text-slate-500">{b.slug}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {/* A real checkbox: it is a switch, and a switch has to be
                  reachable by keyboard and announced as checked or not. */}
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={!!b.active}
                  onChange={() => toggle(b)}
                  className="h-4 w-4 accent-indigo-600"
                />
                {b.active ? 'Shown' : 'Hidden'}
              </label>
              <div className="flex items-center gap-3">
                {/* The name in each label: a screen reader lists these out of
                    context, and "Remove" alone does not say which brand. The
                    44px box is the touch target; the gap keeps the two apart. */}
                <button
                  onClick={() => setEditing({ ...b })}
                  aria-label={`Edit ${b.name_en}`}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-xs font-bold text-indigo-600 hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => remove(b)}
                  aria-label={`Remove ${b.name_en}`}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-xs font-bold text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <BrandEditor
          brand={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

function BrandMark({ brand, size = 'h-12 w-12' }) {
  if (brand.logo) {
    return (
      <img
        src={brand.logo}
        alt=""
        className={`${size} shrink-0 rounded-xl border border-slate-300 bg-white object-contain p-1`}
      />
    )
  }
  // No logo yet: initials, not a broken image.
  return (
    <span className={`${size} grid shrink-0 place-items-center rounded-xl bg-slate-100 text-sm font-extrabold text-slate-500`}>
      {(brand.name_en || '?').slice(0, 2).toUpperCase()}
    </span>
  )
}

function BrandEditor({ brand, onClose, onSaved }) {
  const [form, setForm] = useState(brand)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Whether the logo was touched in this session. Untouched means the field is
  // not sent at all, which both backends read as "leave it alone" — the
  // difference between not changing a logo and clearing it.
  const [logoTouched, setLogoTouched] = useState(false)
  const file = useRef(null)
  // Set when a logo had to be shrunk below MAX_EDGE to fit the cap.
  const [logoNote, setLogoNote] = useState('')
  const panel = useRef(null)
  const nameField = useRef(null)

  // Whether anything was typed or picked. Cancel, the X and Escape ask before
  // throwing that away, so one stray click does not lose a long edit.
  const dirty = logoTouched || ['name_en', 'name_ar', 'slug', 'sort'].some(
    (k) => String(form[k] ?? '') !== String(brand[k] ?? ''),
  )
  function requestClose() {
    if (dirty && !window.confirm(say(
      'Discard the changes you made to this brand?',
      'تجاهل التغييرات التي أدخلتها على هذه العلامة؟',
    ))) return
    onClose()
  }
  // The latest close handler. The Escape listener below is attached once, so it
  // reaches the current `dirty` through this ref rather than a stale copy.
  const closeRef = useRef(requestClose)
  closeRef.current = requestClose

  // A dialog, not a box on the page: focus moves in on open, Tab stays inside
  // until the editor closes, Escape closes it, and focus goes back to the
  // button that opened it.
  useEffect(() => {
    const opener = document.activeElement
    nameField.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = panel.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]):not([type="file"]), select:not([disabled]), textarea:not([disabled])',
      )
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const inside = panel.current.contains(document.activeElement)
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function pick(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setErr('')
    setLogoNote('')
    try {
      // Shrink again, one smaller edge at a time, until the stored form fits
      // the server's cap. A logo that came back as PNG can still be over it at
      // 320px, and a smaller edge is the only lever the admin has.
      let out = null
      let edge = MAX_EDGE
      for (const next of LOGO_EDGES) {
        edge = next
        out = await downscaleImage(f, { maxEdge: next, quality: 0.9 })
        if (out.url.length <= LOGO_MAX_CHARS) break
      }
      if (out.url.length > LOGO_MAX_CHARS) {
        throw new Error(say(
          `This logo is still too large at ${edge}px. Try a simpler image with fewer details.`,
          `هذا الشعار ما زال كبيراً عند ${edge} بكسل. جرّب شعاراً أبسط بتفاصيل أقل.`,
        ))
      }
      setForm((s) => ({ ...s, logo: out.url }))
      setLogoTouched(true)
      if (edge < MAX_EDGE) {
        setLogoNote(say(
          `Shrunk to ${edge}px so the shop will store it.`,
          `صُغّر إلى ${edge} بكسل ليقبله المتجر للتخزين.`,
        ))
      }
    } catch (ex) {
      setErr(ex.message)
    }
    e.target.value = ''   // let the same file be chosen again after a failure
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const payload = {
      id: form.id || 0,
      slug: slugify(form.slug || form.name_en),
      name_en: form.name_en.trim(),
      name_ar: form.name_ar.trim(),
      sort: Number(form.sort) || 0,
      ...(logoTouched ? { logo: form.logo ?? '' } : {}),
    }
    const r = await saveBrand(payload)
    setBusy(false)
    if (r.error) return setErr(r.error)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
      <form
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="brand-editor-title"
        onSubmit={submit}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl"
      >
        <header className="mb-4 flex items-center justify-between">
          <h3 id="brand-editor-title" className="text-lg font-bold text-slate-800">
            {form.id ? 'Edit brand' : 'Add a brand'}
          </h3>
          <button type="button" onClick={requestClose} aria-label="Close" className="text-slate-500 hover:text-slate-700">
            <IconClose size={20} />
          </button>
        </header>

        {err && <Notice tone="error" title="Not saved">{err}</Notice>}

        <div className="mt-3 flex items-center gap-4">
          <BrandMark brand={form} size="h-20 w-20" />
          <div className="flex-1">
            <input
              ref={file}
              type="file"
              accept={ACCEPTED_ATTR}
              onChange={pick}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => file.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-[#7d8799] px-3 py-2 text-sm font-bold text-slate-700 hover:border-indigo-400"
            >
              <IconImage size={16} /> {form.logo ? 'Replace logo' : 'Choose logo'}
            </button>
            {form.logo && (
              <button
                type="button"
                onClick={() => { setForm((s) => ({ ...s, logo: null })); setLogoTouched(true); setLogoNote('') }}
                className="ms-2 text-xs font-bold text-rose-600 hover:underline"
              >
                Remove logo
              </button>
            )}
            <p className="mt-2 text-xs text-slate-500">
              PNG, JPEG or WebP. Resized to {MAX_EDGE}px here in the browser, so a photo
              straight off a phone is fine.
            </p>
            {logoNote && <p className="mt-2 text-xs font-semibold text-slate-600">{logoNote}</p>}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Name (English)">
            <input
              ref={nameField} value={form.name_en} onChange={set('name_en')} required maxLength={80}
              className="w-full rounded-xl border border-[#7d8799] px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
            />
          </Field>
          <Field label="Name (Arabic)">
            <input
              value={form.name_ar} onChange={set('name_ar')} required maxLength={80} dir="rtl"
              className="w-full rounded-xl border border-[#7d8799] px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
            />
          </Field>
          <Field label="Web name" hint="Used in links and filters. Letters, numbers and dashes.">
            <input
              value={form.slug} onChange={set('slug')} maxLength={80}
              placeholder={slugify(form.name_en) || 'brand-name'}
              className="w-full rounded-xl border border-[#7d8799] px-3 py-2.5 font-mono text-sm outline-none focus:border-indigo-400"
            />
          </Field>
          <Field label="Order" hint="Lower shows first.">
            <input
              type="number" value={form.sort} onChange={set('sort')}
              className="w-full rounded-xl border border-[#7d8799] px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={requestClose} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit" disabled={busy}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save brand'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[0.7rem] text-slate-500">{hint}</span>}
    </label>
  )
}
