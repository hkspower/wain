import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Admin product management: list, add, edit, delete products in Supabase.
// Requires the products table + admin RLS from supabase/schema.sql.
const EMPTY = { slug: '', name_en: '', name_ar: '', price: '', category: '', image: '', active: true }

export default function Products() {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    if (!supabase) {
      setError('Supabase not configured (.env).')
      setLoading(false)
      return
    }
    const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const resetForm = () => {
    setForm(EMPTY)
    setEditingId(null)
  }

  async function save(e) {
    e.preventDefault()
    setError('')
    const payload = {
      slug: form.slug.trim(),
      name_en: form.name_en.trim(),
      name_ar: form.name_ar.trim(),
      price: Number(form.price),
      category: form.category.trim() || null,
      image: form.image.trim() || null,
      active: !!form.active,
    }
    if (!payload.slug || !payload.name_en || !(payload.price >= 0)) {
      setError('Slug, English name, and a valid price are required.')
      return
    }
    const q = editingId
      ? supabase.from('products').update(payload).eq('id', editingId)
      : supabase.from('products').insert(payload)
    const { error } = await q
    if (error) return setError(error.message)
    resetForm()
    load()
  }

  function edit(row) {
    setForm({
      slug: row.slug ?? '',
      name_en: row.name_en ?? '',
      name_ar: row.name_ar ?? '',
      price: String(row.price ?? ''),
      category: row.category ?? '',
      image: row.image ?? '',
      active: !!row.active,
    })
    setEditingId(row.id)
  }

  async function remove(id) {
    if (!confirm('Delete this product?')) return
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) setError(error.message)
    else load()
  }

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500'

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800">Products</h1>

      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {/* Add / edit form */}
      <form onSubmit={save} className="mb-8 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2">
        <input className={input} placeholder="Slug (unique)" value={form.slug} onChange={(e) => set('slug', e.target.value)} />
        <input className={input} placeholder="Category" value={form.category} onChange={(e) => set('category', e.target.value)} />
        <input className={input} placeholder="Name (EN)" value={form.name_en} onChange={(e) => set('name_en', e.target.value)} />
        <input className={input} dir="rtl" placeholder="الاسم (عربي)" value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} />
        <input className={input} type="number" step="0.001" min="0" placeholder="Price (KWD)" value={form.price} onChange={(e) => set('price', e.target.value)} />
        <input className={input} placeholder="Image URL" value={form.image} onChange={(e) => set('image', e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active
        </label>
        <div className="flex gap-2 md:col-span-2">
          <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            {editingId ? 'Update product' : 'Add product'}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600">
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* List */}
      {loading ? (
        <p className="text-slate-400">Loading…</p>
      ) : (
        <>
          <table className="admin-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 text-start font-semibold">Product</th>
                <th className="py-2 text-start font-semibold">Category</th>
                <th className="py-2 text-start font-semibold">Price</th>
                <th className="py-2 text-start font-semibold">Active</th>
                <th className="py-2 text-end font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-3">{r.name_en} <span className="text-slate-400">/ {r.name_ar}</span></td>
                  <td className="py-3">{r.category}</td>
                  <td className="py-3">{Number(r.price).toFixed(3)} KWD</td>
                  <td className="py-3">{r.active ? '✓' : '—'}</td>
                  <td className="py-3 text-end">
                    <button onClick={() => edit(r)} className="me-3 font-semibold text-indigo-600">Edit</button>
                    <button onClick={() => remove(r.id)} className="font-semibold text-rose-600">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="m-list">
            {rows.map((r) => (
              <div key={r.id} className="m-row">
                <div className="m-row__top">
                  <span className="m-row__title">{r.name_en}</span>
                  <span className="m-row__badge m-row__badge--paid">{Number(r.price).toFixed(3)} KWD</span>
                </div>
                <div className="m-row__meta">{r.category} · {r.active ? 'active' : 'hidden'}</div>
                <div className="mt-1">
                  <button onClick={() => edit(r)} className="me-3 text-sm font-semibold text-indigo-600">Edit</button>
                  <button onClick={() => remove(r.id)} className="text-sm font-semibold text-rose-600">Delete</button>
                </div>
              </div>
            ))}
          </div>

          {!rows.length && <p className="text-slate-400">No products yet. Add one above.</p>}
        </>
      )}
    </div>
  )
}
