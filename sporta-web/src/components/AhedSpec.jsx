import { useLang } from '../i18n/LanguageContext'

// The AHED brand block on a product page: collection, colour, features, fabric
// and the SKU of the size in hand.
//
// This is the detail AHED Trading supplied with the first shipment. Before it,
// every one of these 27 products said "Cloudsoft Jacket in army green." twice —
// a description that repeats the title and tells a shopper nothing about why
// they would want it. Fabric composition and the small, specific things
// (thumbhole cuffs, removable pads, a semi-standing collar) are what people
// actually compare activewear on.
export default function AhedSpec({ detail, size }) {
  const { lang, t } = useLang()
  if (!detail) return null

  const sku = size ? detail.skus?.[size] : null

  return (
    <section className="mt-10 rounded-2xl border border-black/10 bg-white p-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* Arabic is never letter-spaced — it joins, and tracking breaks the
            joins. .eyebrow handles that per direction. */}
        <span className="eyebrow text-accent">{detail.brand[lang]}</span>
        <span className="text-black/20" aria-hidden>
          ·
        </span>
        {/* Ink, not orange: this is a heading, and the eyebrow beside it is
            already carrying the brand colour. Two oranges touching read as one
            smear, and #B8430F on the dark card measured 3:1 at 18px. */}
        <h2 className="text-lg font-extrabold text-slate-900">
          {detail.collection[lang]}
        </h2>
        {detail.colour && (
          <span className="ms-auto inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
            <span
              className="h-4 w-4 rounded-full ring-1 ring-inset ring-black/15"
              style={{ background: detail.colour.hex }}
              aria-hidden
            />
            {detail.colour[lang]}
          </span>
        )}
      </header>

      <ul className="mt-5 grid gap-2 sm:grid-cols-2">
        {detail.features.map((f) => (
          <li key={f.en} className="flex items-start gap-2.5 text-sm text-slate-700">
            <Tick />
            <span>{f[lang]}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-6 grid gap-x-8 gap-y-3 border-t border-black/10 pt-5 text-sm sm:grid-cols-2">
        <Row label={t.spec.fabric} value={detail.fabric[lang]} />
        {sku && <Row label={t.spec.sku} value={sku} mono />}
        {detail.grams && (
          <Row label={t.spec.weight} value={t.spec.grams.replace('{n}', num(detail.grams, lang))} />
        )}
        <Row label={t.spec.care} value={t.spec.careValue} />
      </dl>
    </section>
  )
}

function Row({ label, value, mono }) {
  return (
    <div className="flex items-baseline justify-between gap-4 sm:justify-start sm:gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className={`font-semibold text-slate-800 ${mono ? 'font-mono text-[.85em]' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

// Arabic-Indic digits in Arabic, the way prices and percentages already render
// across the site.
const num = (n, lang) =>
  lang === 'ar' ? String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]) : String(n)

function Tick() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      className="mt-0.5 shrink-0 text-brand"
      aria-hidden
    >
      <path
        d="M4 10.5l4 4 8-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
