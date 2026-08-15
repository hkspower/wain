import { useCallback, useEffect, useState } from 'react'
import { fetchAllProducts, fetchBrands, saveProduct, setProductActive, slugify } from './api'
import { Notice } from './Overview'
import { IconClose } from '../components/icons'

// The single-product editor: add a piece, change a price, take one off sale.
//
// It sits under the Catalogue tab, next to the whole-catalogue sync. The sync
// pushes the shipped list in bulk; this is for the one product that needs a
// different price today.
//
// THERE IS NO DELETE, and that is the same decision the Brands screen makes:
// order_items point at products, so deleting a product that has ever sold
// takes that line off every invoice containing it. Off sale is reversible;
// deleted is not.
//
// The price field is money. It is stored to three decimals because KWD has
// three, and it is the figure checkout charges — nothing the browser sends at
// order time goes anywhere near it.

const BLANK = {
  id: 0, slug: '', name_en: '', name_ar: '', desc_en: '', desc_ar: '',
  price: '', category: '', brand_slug: '', image: '', images: '', active: true,
}

export default function Products() {
  const [state, setState] = useState({ loading: true, rows: [] })
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const r = await fetchAllProducts()
    setState({ loading: false, rows: r.rows ?? [], error: r.error, needsMigration: r.needsMigration })
  }, [])
  useEffect(() => { load() }, [load])

  async function toggle(row) {
    setState((s) => ({
      ...s,
      rows: s.rows.map((p) => (p.id === row.id ? { ...p, active: Number(!Number(row.active)) } : p)),
    }))
    const r = await setProductActive(row.id, !Number(row.active))
    if (r.error) load()
  }

  if (state.loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (state.needsMigration) {
    return (
      <Notice tone="warn" title="The products table is not installed yet">
        Import <code className="font-mono">api/schema.mysql.sql</code> in phpMyAdmin.
      </Notice>
    )
  }

  return (
    <section className="mt-8">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800">Every product in the database</h3>
          <p className="text-sm text-slate-600">
            {state.rows.filter((r) => Number(r.active)).length} on sale ·{' '}
            {state.rows.filter((r) => !Number(r.active)).length} off sale
          </p>
        </div>
        <button
          onClick={() => setEditing({ ...BLANK })}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700"
        >
          Add a product
        </button>
      </header>

      {state.error && <Notice tone="error" title="Could not load">{state.error}</Notice>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="admin-table w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-start text-xs font-bold uppercase text-slate-500">
              <th className="p-3 text-start">Product</th>
              <th className="p-3 text-start">Web name</th>
              <th className="p-3 text-end">Price</th>
              <th className="p-3 text-start">On sale</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {state.rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 last:border-0">
                <td className="p-3">
                  <span className={Number(r.active) ? 'font-semibold text-slate-800' : 'text-slate-400'}>
                    {r.name_en}
                  </span>
                  <span className="block text-xs text-slate-500" dir="rtl">{r.name_ar}</span>
                </td>
                <td className="p-3 font-mono text-xs text-slate-500">{r.slug}</td>
                <td className="p-3 text-end tabular-nums">{Number(r.price).toFixed(3)}</td>
                <td className="p-3">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={!!Number(r.active)}
                      onChange={() => toggle(r)}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    {Number(r.active) ? 'On sale' : 'Off sale'}
                  </label>
                </td>
                <td className="p-3 text-end">
                  <button
                    onClick={() => setEditing({ ...r, price: String(r.price) })}
                    className="text-xs font-bold text-indigo-600 hover:underline"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Editor
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </section>
  )
}

function Editor({ product, onClose, onSaved }) {
  const [form, setForm] = useState(product)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // The brand list, for the selector. A failure leaves it empty, which shows
  // "— none —" alone: the editor still saves everything else rather than
  // refusing to open because one dropdown could not be filled.
  const [brands, setBrands] = useState([])
  useEffect(() => {
    let live = true
    fetchBrands()
      .then((r) => { if (live) setBrands(r.brands ?? []) })
      .catch(() => { if (live) setBrands([]) })
    return () => { live = false }
  }, [])
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const r = await saveProduct({
      id: form.id || 0,
      slug: slugify(form.slug || form.name_en),
      name_en: form.name_en.trim(),
      name_ar: form.name_ar.trim(),
      desc_en: form.desc_en || null,
      desc_ar: form.desc_ar || null,
      price: Number(form.price),
      category: form.category || null,
      // '' clears it; the server refuses a slug that is not a real brand.
      brand_slug: form.brand_slug || '',
      images: form.images || '',
      image: form.image || null,
      active: form.active,
    })
    setBusy(false)
    if (r.error) return setErr(r.error)
    onSaved()
  }

  const field = 'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400'

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">
            {form.id ? 'Edit product' : 'Add a product'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <IconClose size={20} />
          </button>
        </header>

        {err && <Notice tone="error" title="Not saved">{err}</Notice>}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-slate-600">Name (English)</span>
            <input value={form.name_en} onChange={set('name_en')} required maxLength={160} className={field} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-slate-600">Name (Arabic)</span>
            <input value={form.name_ar} onChange={set('name_ar')} required maxLength={160} dir="rtl" className={field} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-slate-600">Price (KWD)</span>
            <input
              value={form.price} onChange={set('price')} required inputMode="decimal"
              placeholder="10.000" className={`${field} tabular-nums`}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-slate-600">Web name</span>
            <input
              value={form.slug} onChange={set('slug')} maxLength={80}
              placeholder={slugify(form.name_en) || 'product-name'}
              className={`${field} font-mono`}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-slate-600">Category</span>
            <input value={form.category ?? ''} onChange={set('category')} maxLength={40} className={field} />
          </label>
          {/* A SELECT, NOT A TEXT BOX. The server checks the slug against the
              brands table and refuses an unknown one, but a typo should not be
              something the admin can make in the first place — "the logo did
              not appear" is far harder to diagnose than a list with the right
              names in it. */}
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-slate-600">Brand</span>
            <select value={form.brand_slug ?? ''} onChange={set('brand_slug')} className={field}>
              <option value="">— none —</option>
              {brands.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.name_en}{b.has_logo ? '' : '  (no logo yet)'}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-slate-600">Image URL</span>
            <input value={form.image ?? ''} onChange={set('image')} maxLength={500} className={field} />
          </label>
          {/* The gallery only appears when there is more than one photograph.
              One per product is the normal case and stays free of it. */}
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-bold text-slate-600">
              More photos <span className="font-normal text-slate-400">— comma separated, in order. The main image comes first.</span>
            </span>
            <input
              value={form.images ?? ''}
              onChange={set('images')}
              maxLength={2000}
              placeholder="/photos/jacket-back.jpg, /photos/jacket-detail.jpg"
              className={`${field} font-mono`}
            />
          </label>
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox" checked={!!Number(form.active)}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            className="h-4 w-4 accent-indigo-600"
          />
          On sale
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? 'Saving…' : 'Save product'}
          </button>
        </div>
      </form>
    </div>
  )
}
