import { useMemo, useState } from 'react'
import { useLang } from '../i18n/LanguageContext'
import { PRODUCTS, SIZES_FOR } from '../lib/products'
import { formatKWD } from '../lib/format'
import { usePageMeta, breadcrumbJsonLd, graph } from '../lib/seo'
import { IconReturn, IconClose, IconPlus, IconMinus, IconCheck } from '../components/icons'

const WHATSAPP = '96522091914'

// Every string on this page lives in translations.js under `returns`, in both
// languages. The request builder and the WhatsApp message read the same keys.
const REASON_KEYS = ['size', 'damaged', 'notAsDescribed', 'changedMind', 'other']

// Touch targets. A control on this page is a finger target on a phone, so the
// segmented buttons, the quantity steppers and the remove button are all 44px.
const SEG_BASE = 'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition-colors'

export default function Returns() {
  const { lang, t } = useLang()
  const c = t.returns
  const [order, setOrder] = useState('')
  const [phone, setPhone] = useState('')
  const [q, setQ] = useState('')
  // items: { slug, qty, action: 'return'|'exchange', size, newSize, reason }
  const [items, setItems] = useState([])

  const jsonLd = useMemo(
    () =>
      graph(
        {
          '@type': 'WebPage',
          name: lang === 'ar' ? 'الاستبدال والإرجاع — سبورتا' : 'Returns & Exchange — Sporta',
          url: 'https://www.sporta.com.kw/returns',
          about: { '@id': 'https://www.sporta.com.kw/#store' },
          inLanguage: lang,
        },
        breadcrumbJsonLd([
          [t.nav.home, '/'],
          [c.title, '/returns'],
        ]),
      ),
    [lang, t, c.title],
  )
  usePageMeta({
    title: c.title,
    description:
      lang === 'ar'
        ? 'استبدال وإرجاع مجانيان خلال ١٤ يومًا في الكويت — اختر منتجاتك وأرسل الطلب عبر واتساب، والاستلام من عندك.'
        : 'Free 14-day returns and exchange in Kuwait — select your items, send the request on WhatsApp, and we pick up from you.',
    path: '/returns',
    jsonLd,
  })

  const results = PRODUCTS.filter((p) => {
    const s = q.trim().toLowerCase()
    return !s || p.name.en.toLowerCase().includes(s) || p.name.ar.includes(s)
  })

  const addItem = (p) => {
    if (items.some((i) => i.slug === p.slug)) return
    // Starts as 'return' for everything, which is also the only action a
    // non-exchangeable item can ever have — see the note by the buttons.
    const sizes = SIZES_FOR(p.category)
    setItems([
      ...items,
      { slug: p.slug, qty: 1, action: 'return', size: sizes?.[1] ?? null, newSize: sizes?.[2] ?? null, reason: 'size' },
    ])
  }
  const patch = (slug, delta) =>
    setItems(items.map((i) => (i.slug === slug ? { ...i, ...delta } : i)))
  const removeItem = (slug) => setItems(items.filter((i) => i.slug !== slug))
  const productOf = (slug) => PRODUCTS.find((p) => p.slug === slug)

  const waHref = useMemo(() => {
    const lines = [
      c.waIntro,
      `${c.waOrder}: ${order.trim() || c.waNone}`,
      `${c.waPhone}: ${phone.trim() || c.waNone}`,
      '',
      ...items.map((i) => {
        const p = productOf(i.slug)
        const action = i.action === 'exchange' ? c.aExchange : c.aReturn
        const size = i.size ? ` (${i.size})` : ''
        const swap = i.action === 'exchange' && i.newSize ? ` -> ${i.newSize}` : ''
        return `- ${action} x${i.qty}: ${p.name[lang]}${size}${swap} — ${c.reason}: ${c.reasons[i.reason]}`
      }),
    ]
    return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(lines.join('\n'))}`
  }, [items, order, phone, lang, c])

  const seg = (active) =>
    `${SEG_BASE} ${
      active ? 'bg-brand text-ink' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
    }`

  return (
    <section className="policy-page mx-auto max-w-4xl px-4 py-12 sm:py-16">
      <div className="mb-3 flex items-center gap-3 text-brand">
        <IconReturn size={28} className="shrink-0 rtl:-scale-x-100" />
        <h1 className="policy-title text-3xl font-extrabold">{c.title}</h1>
      </div>
      <p className="mb-10 max-w-[68ch] text-lg leading-[1.7] text-slate-700">{c.sub}</p>

      {/* Order details */}
      <h2 className="policy-h2 mb-4 text-xl font-extrabold">{c.orderInfo}</h2>
      <div className="mb-10 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">{c.orderNo}</span>
          <input
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            placeholder={c.orderNoPh}
            className="min-h-11 w-full rounded-xl border border-slate-500 bg-white px-4 py-2.5 text-slate-900 outline-none focus:border-brand"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">{c.phone}</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={c.phonePh}
            inputMode="tel"
            dir="ltr"
            className="min-h-11 w-full rounded-xl border border-slate-500 bg-white px-4 py-2.5 text-slate-900 outline-none focus:border-brand"
          />
        </label>
      </div>

      {/* Item picker */}
      <h2 className="policy-h2 mb-4 text-xl font-extrabold">{c.pickItems}</h2>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={c.search}
        type="search"
        aria-label={c.search}
        className="mb-4 min-h-11 w-full rounded-xl border border-slate-500 bg-white px-4 py-2.5 text-slate-900 outline-none focus:border-brand"
      />
      <div className="mb-10 grid max-h-80 grid-cols-1 gap-2 overflow-y-auto pe-1 sm:grid-cols-2">
        {results.map((p) => {
          const picked = items.some((i) => i.slug === p.slug)
          return (
            <button
              key={p.slug}
              onClick={() => addItem(p)}
              disabled={picked}
              className={`flex min-h-16 items-center gap-3 rounded-2xl border p-2 text-start transition-colors ${
                picked
                  ? 'border-brand/40 bg-brand/5'
                  : 'border-black/10 bg-white hover:border-brand'
              }`}
            >
              <img src={p.image} alt="" width="48" height="48" loading="lazy" decoding="async" className="h-12 w-12 rounded-lg object-cover" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-slate-900">{p.name[lang]}</span>
                <span className="block text-sm text-slate-600">{formatKWD(p.price, lang)}</span>
              </span>
              <span className={`shrink-0 text-sm font-bold ${picked ? 'text-accent' : 'text-slate-600'}`}>
                {picked ? c.added : `+ ${c.add}`}
              </span>
            </button>
          )
        })}
      </div>

      {/* Selected items */}
      <h2 className="policy-h2 mb-4 text-xl font-extrabold">
        {c.yourRequest} <span className="font-semibold text-slate-600">— {c.itemsCount(items.length)}</span>
      </h2>
      {items.length === 0 ? (
        <p className="mb-10 rounded-3xl border border-black/10 bg-white p-6 text-center text-slate-700">{c.emptyReq}</p>
      ) : (
        <ul className="mb-6 space-y-3">
          {items.map((i) => {
            const p = productOf(i.slug)
            const sizes = SIZES_FOR(p.category)
            return (
              <li key={i.slug} className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <img src={p.image} alt="" width="56" height="56" decoding="async" className="h-14 w-14 rounded-xl object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-900">{p.name[lang]}</p>
                    <p className="text-sm text-slate-600">{formatKWD(p.price, lang)}</p>
                  </div>
                  <button
                    onClick={() => removeItem(i.slug)}
                    aria-label={t.a11y.remove}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-black/5 hover:text-red-700"
                  >
                    <IconClose size={18} />
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                  {/* action */}
                  <div className="flex flex-wrap items-center gap-2" role="group" aria-label={c.action}>
                    <button className={seg(i.action === 'return')} onClick={() => patch(i.slug, { action: 'return' })}>
                      {c.aReturn}
                    </button>
                    {/* Women's clothing cannot be exchanged, so the button is
                        not offered rather than offered and then refused at the
                        pickup. RETURN stays available: the policy excludes the
                        exchange, not a damaged or poor-quality item coming
                        back. p.noExchange comes from the server. */}
                    {!p.noExchange && (
                      <button className={seg(i.action === 'exchange')} onClick={() => patch(i.slug, { action: 'exchange' })}>
                        {c.aExchange}
                      </button>
                    )}
                  </div>
                  {p.noExchange && (
                    <p className="w-full text-sm font-semibold text-accent">{c.noExchangeNote}</p>
                  )}
                  {/* qty */}
                  <div className="flex items-center rounded-full border border-slate-500">
                    <button
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-700"
                      aria-label={t.a11y.decrease}
                      onClick={() => patch(i.slug, { qty: Math.max(1, i.qty - 1) })}
                    >
                      <IconMinus size={14} />
                    </button>
                    <span className="min-w-6 text-center text-sm font-bold tabular-nums">{i.qty}</span>
                    <button
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-700"
                      aria-label={t.a11y.increase}
                      onClick={() => patch(i.slug, { qty: i.qty + 1 })}
                    >
                      <IconPlus size={14} />
                    </button>
                  </div>
                  {/* sizes */}
                  {sizes && (
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      {t.size?.label}
                      <select
                        value={i.size ?? ''}
                        onChange={(e) => patch(i.slug, { size: e.target.value })}
                        className="min-h-11 rounded-xl border border-slate-500 bg-white px-3 text-slate-900"
                      >
                        {sizes.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {sizes && i.action === 'exchange' && (
                    <label className="flex items-center gap-2 text-sm font-semibold text-accent">
                      {c.newSize}
                      <select
                        value={i.newSize ?? ''}
                        onChange={(e) => patch(i.slug, { newSize: e.target.value })}
                        className="min-h-11 rounded-xl border border-brand bg-white px-3 text-slate-900"
                      >
                        {sizes.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {/* reason */}
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    {c.reason}
                    <select
                      value={i.reason}
                      onChange={(e) => patch(i.slug, { reason: e.target.value })}
                      className="min-h-11 rounded-xl border border-slate-500 bg-white px-3 text-slate-900"
                    >
                      {REASON_KEYS.map((r) => (
                        <option key={r} value={r}>
                          {c.reasons[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {items.length > 0 && (
        <div className="mb-12">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-8 py-3.5 font-bold text-ink transition-colors hover:bg-brand-dark sm:w-auto"
          >
            {c.send}
          </a>
          <p className="mt-3 max-w-[68ch] text-sm leading-[1.7] text-slate-700">{c.sendNote}</p>
        </div>
      )}

      {/* Policy — the key facts, as a list in a callout. Same wording as before. */}
      <h2 className="policy-h2 mb-4 text-xl font-extrabold">{c.policyT}</h2>
      <ul className="policy-callout space-y-3">
        {c.policy.map((line) => (
          <li key={line} className="flex items-start gap-3 leading-[1.7] text-slate-800">
            <IconCheck size={18} className="mt-1 shrink-0 text-accent" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
