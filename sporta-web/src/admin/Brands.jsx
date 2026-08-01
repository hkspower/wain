import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchBrands, saveBrand, setBrandActive, slugify } from './api'
import { Notice } from './Overview'
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
//   * it never DELETES a brand. A brand with orders behind it is history, and
//     "disabled" is the reversible answer. The switch is the whole feature.
//
// The downscale is not a nicety. A logo dragged off a phone is a 4 MB
// photograph; at 320px and WebP it is a few kilobytes, and the server caps
// what it will store anyway — this is what keeps the admin from hitting that
// cap on every save. The scaling itself lives in lib/downscaleImage.js, shared
// with the slides screen, because the file-type check in it is a security rule
// and one copy of a security rule is one place to get it right.

const MAX_EDGE = 320

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

      {state.error && <Notice tone="error" title="Could not load">{state.error}</Notice>}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {state.brands.map((b) => (
          <li
            key={b.id}
            className={`flex items-center gap-3 rounded-2xl border p-3 ${
              b.active ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50'
            }`}
          >
            <BrandMark brand={b} />
            <div className="min-w-0 flex-1">
              <p className={`truncate font-bold ${b.active ? 'text-slate-800' : 'text-slate-500'}`}>
                {b.name_en}
              </p>
              <p className="truncate text-sm text-slate-500" dir="rtl">{b.name_ar}</p>
              <p className="truncate font-mono text-[0.7rem] text-slate-400">{b.slug}</p>
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
              <button
                onClick={() => setEditing({ ...b })}
                className="text-xs font-bold text-indigo-600 hover:underline"
              >
                Edit
              </button>
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
        className={`${size} shrink-0 rounded-xl border border-slate-200 bg-white object-contain p-1`}
      />
    )
  }
  // No logo yet: initials, not a broken image.
  return (
    <span className={`${size} grid shrink-0 place-items-center rounded-xl bg-slate-100 text-sm font-extrabold text-slate-400`}>
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

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function pick(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setErr('')
    try {
      const { url: logo } = await downscaleImage(f, { maxEdge: MAX_EDGE, quality: 0.9 })
      setForm((s) => ({ ...s, logo }))
      setLogoTouched(true)
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
        onSubmit={submit}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl"
      >
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">
            {form.id ? 'Edit brand' : 'Add a brand'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
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
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:border-indigo-400"
            >
              <IconImage size={16} /> {form.logo ? 'Replace logo' : 'Choose logo'}
            </button>
            {form.logo && (
              <button
                type="button"
                onClick={() => { setForm((s) => ({ ...s, logo: null })); setLogoTouched(true) }}
                className="ms-2 text-xs font-bold text-rose-600 hover:underline"
              >
                Remove
              </button>
            )}
            <p className="mt-2 text-xs text-slate-500">
              PNG, JPEG or WebP. Resized to {MAX_EDGE}px here in the browser, so a photo
              straight off a phone is fine.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Name (English)">
            <input
              value={form.name_en} onChange={set('name_en')} required maxLength={80}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
            />
          </Field>
          <Field label="Name (Arabic)">
            <input
              value={form.name_ar} onChange={set('name_ar')} required maxLength={80} dir="rtl"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
            />
          </Field>
          <Field label="Web name" hint="Used in links and filters. Letters, numbers and dashes.">
            <input
              value={form.slug} onChange={set('slug')} maxLength={80}
              placeholder={slugify(form.name_en) || 'brand-name'}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm outline-none focus:border-indigo-400"
            />
          </Field>
          <Field label="Order" hint="Lower shows first.">
            <input
              type="number" value={form.sort} onChange={set('sort')}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">
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
