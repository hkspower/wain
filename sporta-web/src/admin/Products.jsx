import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { fetchAllProducts, fetchBrands, saveProduct, setProductActive, slugify } from './api'
import { Notice } from './Notice'
import { IconClose } from '../components/icons'
import { useLang } from '../i18n/LanguageContext'

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

// Every sentence on this screen is in both languages. The operator's language
// is LanguageContext's (a saved tap, then ?lang=, then Arabic).
const COPY = {
  switchFailed: { en: 'That change was not saved', ar: 'لم يُحفظ هذا التغيير' },
  switchShows: { en: 'The list now shows what is saved.', ar: 'تعرض القائمة الآن ما هو محفوظ.' },
  notSaved: { en: 'Not saved', ar: 'لم يُحفظ' },
  brandsUnavailable: {
    en: 'The brand list could not load, so the brand cannot be changed right now. This product keeps its current brand; reload the page to change it.',
    ar: 'تعذّر تحميل قائمة العلامات، فلا يمكن تغيير العلامة الآن. يحتفظ هذا المنتج بعلامته الحالية؛ أعد تحميل الصفحة لتغييرها.',
  },
  brandNotListed: { en: 'not in the Brands list', ar: 'غير موجودة في قائمة العلامات' },
  priceFormat: {
    en: 'Write the price in figures with a dot before the fils, like 12.500 (up to three decimals, no thousands separator).',
    ar: 'اكتب السعر بالأرقام مع نقطة قبل الفلس، مثل 12.500 (حتى ثلاث خانات عشرية، دون فاصل للآلاف).',
  },
  priceZero: { en: 'Enter a price greater than zero.', ar: 'أدخل سعراً أكبر من صفر.' },
  salePriceFormat: {
    en: 'The sale price must be figures with a dot before the fils, like 9.500 (up to three decimals), or left empty.',
    ar: 'يجب أن يكون سعر التخفيض أرقاماً مع نقطة قبل الفلس، مثل 9.500 (حتى ثلاث خانات عشرية)، أو يُترك فارغاً.',
  },
  salePriceZero: {
    en: 'The sale price must be above zero, or left empty.',
    ar: 'يجب أن يكون سعر التخفيض أكبر من صفر، أو يُترك فارغاً.',
  },
  slugChanging: {
    en: 'Changing the web name moves this product to a new address. Old links, shared links and search results stop opening, and a cart that still has the old name is refused at checkout.',
    ar: 'تغيير اسم الموقع ينقل المنتج إلى عنوان جديد. الروابط والمشاركات ونتائج البحث القديمة تتوقف عن العمل، ويُرفض في الدفع أي سلة ما زالت تحمل الاسم القديم.',
  },
}
const tx = (copy, lang) => copy?.[lang] ?? copy?.en ?? ''

// Arabic-Indic and Persian digits, and the Arabic decimal mark, are read as the
// figures they are. The server (store_product_money) then gets the same rule
// checked here: digits, a dot, at most three decimals, above zero.
const PRICE_FORMAT = /^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,3})?$/
const latinFigures = (text) => String(text ?? '').trim()
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
  .replace(/٫/g, '.')

// Says what is wrong with a typed price, or returns the number. A comma is
// refused rather than guessed at: "12,500" could mean twelve and a half or
// twelve thousand five hundred.
function readPrice(text) {
  const s = latinFigures(text)
  if (!PRICE_FORMAT.test(s)) return { problem: 'format' }
  if (!(Number(s) > 0)) return { problem: 'zero' }
  return { value: Number(s) }
}

export default function Products() {
  const { lang } = useLang()
  const [state, setState] = useState({ loading: true, rows: [] })
  const [editing, setEditing] = useState(null)
  // The last on/off switch the server refused. It is shown above the list; the
  // list is reloaded after it, so the switch then shows what is saved.
  const [switchErr, setSwitchErr] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const r = await fetchAllProducts()
    setState({ loading: false, rows: r.rows ?? [], error: r.error, needsMigration: r.needsMigration })
  }, [])
  useEffect(() => { load() }, [load])

  async function toggle(row) {
    setSwitchErr(null)
    setState((s) => ({
      ...s,
      rows: s.rows.map((p) => (p.id === row.id ? { ...p, active: Number(!Number(row.active)) } : p)),
    }))
    const r = await setProductActive(row.id, !Number(row.active))
    if (r.error || r.needsMigration) {
      setSwitchErr({ name: row.name_en, text: r.error ?? '' })
      load()
    }
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
      {switchErr && (
        <div className="mb-3">
          <Notice tone="error" title={tx(COPY.switchFailed, lang)}>
            <span className="block font-semibold">{switchErr.name}</span>
            {switchErr.text && <span className="block">{switchErr.text}</span>}
            <span className="block">{tx(COPY.switchShows, lang)}</span>
          </Notice>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-300 bg-white">
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
                  <span className={Number(r.active) ? 'font-semibold text-slate-800' : 'text-slate-500'}>
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

// The server sends sale dates as 'YYYY-MM-DD HH:MM:SS'; a datetime-local input
// wants 'YYYY-MM-DDTHH:MM'.
const toLocalInput = (v) => (v ? String(v).slice(0, 16).replace(' ', 'T') : '')

// Everything the server stores for a product, in the shape the form edits.
// The sale and featured fields are part of this on purpose: a save that leaves
// them out is read by the server as "clear them", so editing a product's name
// used to end its sale and take it off the featured row.
function toForm(p) {
  return {
    ...p,
    sale_price: p.sale_price == null || p.sale_price === '' ? '' : String(p.sale_price),
    sale_starts_at: toLocalInput(p.sale_starts_at),
    sale_ends_at: toLocalInput(p.sale_ends_at),
    featured: !!Number(p.featured),
    featured_sort: String(p.featured_sort ?? 0),
  }
}

function Editor({ product, onClose, onSaved }) {
  const { lang } = useLang()
  const [form, setForm] = useState(() => toForm(product))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const titleId = useId()
  const panelRef = useRef(null)
  const errRef = useRef(null)
  // The button that opened the editor, so focus can go back to it on close.
  const [opener] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null))
  // Focus moves into the panel when it opens and back to the opener when it
  // closes. Escape closes it, as it does for the Orders drawer.
  useEffect(() => {
    panelRef.current?.focus()
    return () => { if (opener instanceof HTMLElement) opener.focus() }
  }, [opener])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // A save error is put next to the Save button and focused, so it is seen and
  // read out where the admin just acted, not at the top of a long form.
  useEffect(() => { if (err) errRef.current?.focus() }, [err])

  // The brand list, for the selector. brandsOk is null while it loads, then
  // true or false. A failed list is said so below, and the product's own brand
  // stays a visible option, so the selector never shows "— none —" for a
  // product that has one.
  const [brands, setBrands] = useState([])
  const [brandsOk, setBrandsOk] = useState(null)
  useEffect(() => {
    let live = true
    fetchBrands()
      .then((r) => { if (live) { setBrands(r.brands ?? []); setBrandsOk(!!r.brands) } })
      .catch(() => { if (live) setBrandsOk(false) })
    return () => { live = false }
  }, [])
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const brandSlug = form.brand_slug ?? ''
  const brandListed = brands.some((b) => b.slug === brandSlug)

  // The web name the save will use. A product that already exists keeps its
  // address, so a change to it is said before the admin saves.
  const savedSlug = product.id ? String(product.slug ?? '') : ''
  const nextSlug = slugify(form.slug || form.name_en)
  const slugChanging = savedSlug !== '' && nextSlug !== savedSlug

  async function submit(e) {
    e.preventDefault()
    // A price the server would refuse is said so here, in words that match the
    // problem, not as "greater than zero" for every kind of mistake.
    const price = readPrice(form.price)
    if (price.problem) return setErr(tx(price.problem === 'format' ? COPY.priceFormat : COPY.priceZero, lang))
    // A blank sale price means no sale; anything typed must be a real price.
    // Number() turns a bad one into null, which the server reads as "no sale".
    let salePrice = null
    if (latinFigures(form.sale_price) !== '') {
      const sale = readPrice(form.sale_price)
      if (sale.problem) return setErr(tx(sale.problem === 'format' ? COPY.salePriceFormat : COPY.salePriceZero, lang))
      salePrice = sale.value
    }
    setBusy(true); setErr('')
    const r = await saveProduct({
      id: form.id || 0,
      slug: nextSlug,
      name_en: form.name_en.trim(),
      name_ar: form.name_ar.trim(),
      desc_en: form.desc_en || null,
      desc_ar: form.desc_ar || null,
      price: price.value,
      category: form.category || null,
      // '' clears it; the server refuses a slug that is not a real brand.
      brand_slug: form.brand_slug || '',
      images: form.images || '',
      image: form.image || null,
      sale_price: salePrice,
      sale_starts_at: form.sale_starts_at || null,
      sale_ends_at: form.sale_ends_at || null,
      featured: !!form.featured,
      featured_sort: Number(form.featured_sort) || 0,
      active: form.active,
    })
    setBusy(false)
    if (r.error) return setErr(r.error)
    onSaved()
  }

  const field = 'w-full rounded-xl border border-[#7d8799] px-3 py-2.5 text-sm outline-none focus:border-indigo-400'

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
      <form
        ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        onSubmit={submit} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 focus:outline-none sm:rounded-3xl"
      >
        <header className="mb-4 flex items-center justify-between">
          <h3 id={titleId} className="text-lg font-bold text-slate-800">
            {form.id ? 'Edit product' : 'Add a product'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-700">
            <IconClose size={20} />
          </button>
        </header>

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
            <span className="mb-1.5 block text-xs font-bold text-slate-600">
              Sale price (KWD) <span className="font-normal text-slate-500">— optional, must be below the price</span>
            </span>
            <input
              value={form.sale_price} onChange={set('sale_price')} inputMode="decimal"
              placeholder="leave empty for no sale" className={`${field} tabular-nums`}
            />
          </label>
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">Sale starts</span>
              <input type="datetime-local" value={form.sale_starts_at} onChange={set('sale_starts_at')} className={field} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">Sale ends</span>
              <input type="datetime-local" value={form.sale_ends_at} onChange={set('sale_ends_at')} className={field} />
            </label>
          </div>
          <div className="block">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">Web name</span>
              <input
                value={form.slug} onChange={set('slug')} maxLength={80}
                placeholder={slugify(form.name_en) || 'product-name'}
                className={`${field} font-mono`}
              />
            </label>
            {slugChanging && (
              <span role="status" className="mt-1.5 block text-xs font-semibold text-amber-800">
                {tx(COPY.slugChanging, lang)}
              </span>
            )}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-slate-600">Category</span>
            <input value={form.category ?? ''} onChange={set('category')} maxLength={40} className={field} />
          </label>
          {/* A SELECT, NOT A TEXT BOX. The server checks the slug against the
              brands table and refuses an unknown one, but a typo should not be
              something the admin can make in the first place — "the logo did
              not appear" is far harder to diagnose than a list with the right
              names in it. */}
          <div className="block">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">Brand</span>
              <select value={brandSlug} onChange={set('brand_slug')} className={field}>
                <option value="">— none —</option>
                {/* The product's own brand is always an option, so the selector
                    shows the brand it will save, even before or without the list. */}
                {brandSlug !== '' && !brandListed && (
                  <option value={brandSlug}>
                    {brandSlug}{brandsOk === true ? `  (${tx(COPY.brandNotListed, lang)})` : ''}
                  </option>
                )}
                {brands.map((b) => (
                  <option key={b.slug} value={b.slug}>
                    {b.name_en}{b.has_logo ? '' : '  (no logo yet)'}
                  </option>
                ))}
              </select>
            </label>
            {brandsOk === false && (
              <span role="status" className="mt-1.5 block text-xs font-semibold text-amber-800">
                {tx(COPY.brandsUnavailable, lang)}
              </span>
            )}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-slate-600">Image URL</span>
            <input value={form.image ?? ''} onChange={set('image')} maxLength={500} className={field} />
          </label>
          {/* The gallery only appears when there is more than one photograph.
              One per product is the normal case and stays free of it. */}
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-bold text-slate-600">
              More photos <span className="font-normal text-slate-500">— comma separated, in order. The main image comes first.</span>
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
          Shown on the shop
        </label>
        {/* active = 0 hides the product from the storefront entirely. It is not
            the sale: the sale is the price above and its dates. */}

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox" checked={!!form.featured}
              onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))}
              className="h-4 w-4 accent-indigo-600"
            />
            In the featured row
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Featured order
            <input
              type="number" min="0" step="1" value={form.featured_sort} onChange={set('featured_sort')}
              className="w-20 rounded-lg border border-[#7d8799] px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
        </div>

        {err && (
          <div ref={errRef} tabIndex={-1} className="mt-4 focus:outline-none">
            <Notice tone="error" title={tx(COPY.notSaved, lang)}>{err}</Notice>
          </div>
        )}

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
