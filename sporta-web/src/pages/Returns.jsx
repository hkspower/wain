import { arabicCount } from '../i18n/translations'
import { useMemo, useState } from 'react'
import { useLang } from '../i18n/LanguageContext'
import { PRODUCTS, SIZES_FOR } from '../lib/products'
import { formatKWD } from '../lib/format'
import { usePageMeta, breadcrumbJsonLd, graph } from '../lib/seo'
import { IconReturn, IconClose, IconPlus, IconMinus } from '../components/icons'

const WHATSAPP = '96522091914'

// Page copy lives here (like the About FAQ) — bilingual, keyed by lang.
const C = {
  en: {
    title: 'Returns & Exchange',
    sub: 'Free within 14 days of delivery. Pick your items below, choose return or exchange, and send the request on WhatsApp — we arrange pickup in Kuwait.',
    orderInfo: 'Order details',
    orderNo: 'Order / track number',
    orderNoPh: 'e.g. SP1A2B3C4D (optional)',
    phone: 'Phone (for pickup)',
    phonePh: 'e.g. 9XXXXXXX (optional)',
    pickItems: 'Select your items',
    search: 'Search products…',
    add: 'Add',
    added: 'Added',
    yourRequest: 'Your request',
    emptyReq: 'No items selected yet — tap a product above to add it.',
    action: 'Action',
    aReturn: 'Return',
    aExchange: 'Exchange',
    newSize: 'New size',
    reason: 'Reason',
    reasons: {
      size: 'Wrong size',
      damaged: 'Damaged / defective',
      notAsDescribed: 'Not as described',
      changedMind: 'Changed my mind',
      other: 'Other',
    },
    qty: 'Qty',
    remove: 'Remove',
    itemsCount: (n) => `${n} item${n === 1 ? '' : 's'}`,
    send: 'Send request on WhatsApp',
    sendNote: 'Opens WhatsApp with your request pre-filled — nothing is sent until you press Send there.',
    policyT: 'Policy',
    policy: [
      'Exchange and return are free within 14 days of delivery.',
      'Items must be unworn, unwashed, with original tags attached.',
      'Refunds go back to the original payment method (KNET / card).',
      'Exchanges ship the same day the pickup is received.',
    ],
    waIntro: 'Return/Exchange request — Sporta',
    waOrder: 'Order',
    waPhone: 'Phone',
    waNone: 'not provided',
  },
  ar: {
    title: 'الاستبدال والإرجاع',
    sub: 'مجانًا خلال ١٤ يومًا من الاستلام. اختر منتجاتك بالأسفل، حدّد إرجاع أو استبدال، وأرسل الطلب عبر واتساب — وننسّق الاستلام داخل الكويت.',
    orderInfo: 'بيانات الطلب',
    orderNo: 'رقم الطلب / التتبع',
    orderNoPh: 'مثال: SP1A2B3C4D (اختياري)',
    phone: 'رقم الهاتف (للاستلام)',
    phonePh: 'مثال: 9XXXXXXX (اختياري)',
    pickItems: 'اختر منتجاتك',
    search: 'ابحث عن منتج…',
    add: 'أضف',
    added: 'أُضيف',
    yourRequest: 'طلبك',
    emptyReq: 'لم تختر أي منتج بعد — اضغط على منتج بالأعلى لإضافته.',
    action: 'الإجراء',
    aReturn: 'إرجاع',
    aExchange: 'استبدال',
    newSize: 'المقاس الجديد',
    reason: 'السبب',
    reasons: {
      size: 'المقاس غير مناسب',
      damaged: 'تالف / به عيب',
      notAsDescribed: 'مختلف عن الوصف',
      changedMind: 'غيّرت رأيي',
      other: 'سبب آخر',
    },
    qty: 'الكمية',
    remove: 'إزالة',
    // Same five-case rule as the checkout summary — see arabicCount().
    itemsCount: (n) => arabicCount(n, ['منتج واحد', 'منتجان', 'منتجات', 'منتجًا']),
    send: 'أرسل الطلب عبر واتساب',
    sendNote: 'يفتح واتساب مع تفاصيل طلبك جاهزة — لا يُرسل شيء حتى تضغط إرسال هناك.',
    policyT: 'السياسة',
    policy: [
      'الاستبدال والإرجاع مجاني خلال ١٤ يومًا من الاستلام.',
      'يجب أن تكون القطع غير ملبوسة وغير مغسولة مع البطاقات الأصلية.',
      'يُعاد المبلغ إلى وسيلة الدفع الأصلية (كي نت / بطاقة).',
      'شحنة الاستبدال تخرج في نفس يوم استلام القطعة.',
    ],
    waIntro: 'طلب إرجاع/استبدال — سبورتا',
    waOrder: 'رقم الطلب',
    waPhone: 'الهاتف',
    waNone: 'غير مذكور',
  },
}

const REASON_KEYS = ['size', 'damaged', 'notAsDescribed', 'changedMind', 'other']

export default function Returns() {
  const { lang, t } = useLang()
  const c = C[lang]
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
        ? 'استبدال وإرجاع مجاني خلال ١٤ يومًا في الكويت — اختر منتجاتك وأرسل الطلب عبر واتساب، والاستلام من عندك.'
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
    `rounded-full px-3 py-1 text-sm font-semibold transition-colors ${
      active ? 'bg-brand text-ink' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`

  return (
    <section className="mx-auto max-w-4xl px-4 py-12">
      <div className="mb-2 flex items-center gap-3 text-brand">
        <IconReturn size={28} />
        <h1 className="text-3xl font-extrabold text-brand-dark">{c.title}</h1>
      </div>
      <p className="mb-8 max-w-2xl text-slate-600">{c.sub}</p>

      {/* Order details */}
      <h2 className="mb-3 text-lg font-extrabold text-slate-900">{c.orderInfo}</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-slate-600">{c.orderNo}</span>
          <input
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            placeholder={c.orderNoPh}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 outline-none focus:border-brand"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-slate-600">{c.phone}</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={c.phonePh}
            inputMode="tel"
            dir="ltr"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 outline-none focus:border-brand"
          />
        </label>
      </div>

      {/* Item picker */}
      <h2 className="mb-3 text-lg font-extrabold text-slate-900">{c.pickItems}</h2>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={c.search}
        type="search"
        aria-label={c.search}
        className="mb-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 outline-none focus:border-brand"
      />
      <div className="mb-10 grid max-h-80 grid-cols-1 gap-2 overflow-y-auto pe-1 sm:grid-cols-2">
        {results.map((p) => {
          const picked = items.some((i) => i.slug === p.slug)
          return (
            <button
              key={p.slug}
              onClick={() => addItem(p)}
              disabled={picked}
              className={`flex items-center gap-3 rounded-xl border p-2 text-start transition-colors ${
                picked
                  ? 'border-brand/40 bg-brand/5'
                  : 'border-slate-200 bg-white hover:border-brand'
              }`}
            >
              <img src={p.image} alt={p.name[lang]} width="48" height="48" className="h-12 w-12 rounded-lg object-cover" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-slate-900">{p.name[lang]}</span>
                <span className="block text-sm text-slate-500">{formatKWD(p.price, lang)}</span>
              </span>
              <span className={`shrink-0 text-sm font-bold ${picked ? 'text-brand' : 'text-slate-400'}`}>
                {picked ? c.added : `+ ${c.add}`}
              </span>
            </button>
          )
        })}
      </div>

      {/* Selected items */}
      <h2 className="mb-3 text-lg font-extrabold text-slate-900">
        {c.yourRequest} <span className="font-semibold text-slate-400">— {c.itemsCount(items.length)}</span>
      </h2>
      {items.length === 0 ? (
        <p className="mb-10 rounded-xl bg-slate-50 p-6 text-center text-slate-500">{c.emptyReq}</p>
      ) : (
        <ul className="mb-6 space-y-3">
          {items.map((i) => {
            const p = productOf(i.slug)
            const sizes = SIZES_FOR(p.category)
            return (
              <li key={i.slug} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-3">
                  <img src={p.image} alt={p.name[lang]} width="56" height="56" className="h-14 w-14 rounded-xl object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-900">{p.name[lang]}</p>
                    <p className="text-sm text-slate-500">{formatKWD(p.price, lang)}</p>
                  </div>
                  <button
                    onClick={() => removeItem(i.slug)}
                    aria-label={t.a11y.remove}
                    className="text-slate-400 hover:text-red-600"
                  >
                    <IconClose size={18} />
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                  {/* action */}
                  <div className="flex items-center gap-2" role="group" aria-label={c.action}>
                    <button className={seg(i.action === 'return')} onClick={() => patch(i.slug, { action: 'return' })}>
                      {c.aReturn}
                    </button>
                    <button className={seg(i.action === 'exchange')} onClick={() => patch(i.slug, { action: 'exchange' })}>
                      {c.aExchange}
                    </button>
                  </div>
                  {/* qty */}
                  <div className="flex items-center gap-1 rounded-full border border-slate-300">
                    <button
                      className="px-2.5 py-1 text-slate-600"
                      aria-label={t.a11y.decrease}
                      onClick={() => patch(i.slug, { qty: Math.max(1, i.qty - 1) })}
                    >
                      <IconMinus size={14} />
                    </button>
                    <span className="min-w-6 text-center text-sm font-bold tabular-nums">{i.qty}</span>
                    <button
                      className="px-2.5 py-1 text-slate-600"
                      aria-label={t.a11y.increase}
                      onClick={() => patch(i.slug, { qty: i.qty + 1 })}
                    >
                      <IconPlus size={14} />
                    </button>
                  </div>
                  {/* sizes */}
                  {sizes && (
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                      {t.size?.label ?? 'Size'}
                      <select
                        value={i.size ?? ''}
                        onChange={(e) => patch(i.slug, { size: e.target.value })}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900"
                      >
                        {sizes.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {sizes && i.action === 'exchange' && (
                    <label className="flex items-center gap-2 text-sm font-semibold text-brand">
                      {c.newSize}
                      <select
                        value={i.newSize ?? ''}
                        onChange={(e) => patch(i.slug, { newSize: e.target.value })}
                        className="rounded-lg border border-brand/50 bg-white px-2 py-1 text-slate-900"
                      >
                        {sizes.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {/* reason */}
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                    {c.reason}
                    <select
                      value={i.reason}
                      onChange={(e) => patch(i.slug, { reason: e.target.value })}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900"
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
        <div className="mb-10">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center rounded-full bg-brand px-8 py-3.5 font-bold text-ink transition-colors hover:bg-brand-dark sm:w-auto"
          >
            {c.send}
          </a>
          <p className="mt-2 text-sm text-slate-500">{c.sendNote}</p>
        </div>
      )}

      {/* Policy */}
      <h2 className="mb-3 text-lg font-extrabold text-slate-900">{c.policyT}</h2>
      <ul className="list-disc space-y-1 ps-5 text-slate-600">
        {c.policy.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )
}
