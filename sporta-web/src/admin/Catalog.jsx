import { useCallback, useEffect, useState } from 'react'
import { fetchCatalogState, syncCatalog } from './api'
import { Notice } from './Notice'
import { formatKWD } from '../lib/format'
import { useLang } from '../i18n/LanguageContext'
import { arabicCount } from '../i18n/translations'
import Products from './Products'

const kwd = (n) => formatKWD(Number(n ?? 0), 'en')

// Every visible string on this screen has an English and an Arabic version. The
// admin follows the storefront's language choice (LanguageContext), so `lang`
// picks the copy. Arabic is the default there.
const tx = (copy, lang) => copy?.[lang] ?? copy?.en ?? ''

// Arabic counts. arabicCount gives one form for 1, another for 2, a plural for 3
// to 10, and a singular again from 11. Each noun phrase below is written in all
// four forms so that the adjective and verb agree with the count.
const FORMS_PRODUCT = ['منتج واحد', 'منتجان', 'منتجات', 'منتجًا']
const FORMS_MISSING = [
  'منتج واحد غير موجود في قاعدة البيانات',
  'منتجان غير موجودين في قاعدة البيانات',
  'منتجات غير موجودة في قاعدة البيانات',
  'منتجًا غير موجود في قاعدة البيانات',
]
const FORMS_DIFFER = ['سعر واحد مختلف', 'سعران مختلفان', 'أسعار مختلفة', 'سعرًا مختلفًا']
const FORMS_EXTRA = [
  'منتج واحد موجود في قاعدة البيانات دون الموقع',
  'منتجان موجودان في قاعدة البيانات دون الموقع',
  'منتجات موجودة في قاعدة البيانات دون الموقع',
  'منتجًا موجودًا في قاعدة البيانات دون الموقع',
]
const FORMS_PUSH = ['منتجًا ناقصًا', 'منتجين ناقصين', 'منتجات ناقصة', 'منتجًا ناقصًا']

const T = {
  title: { en: 'Catalogue', ar: 'الكتالوج' },
  lead: {
    en: 'What the site ships with, compared against what the database will charge.',
    ar: 'ما يُشحن مع الموقع، مقارنةً بما ستحتسبه قاعدة البيانات.',
  },
  loading: { en: 'Loading catalogue…', ar: 'جارٍ تحميل الكتالوج…' },
  readError: { en: 'Cannot read products', ar: 'تعذّرت قراءة المنتجات' },
  migrateTitle: { en: 'Run the migration first', ar: 'شغّل الترحيل أولًا' },
  migrateCode: { en: 'creates the products table.', ar: 'ينشئ جدول المنتجات.' },
  missingBody: {
    en: 'Checkout prices every order from this table. While a product is missing, any cart containing it produces a zero total and the payment is refused with “Order has no payable amount”. Pushing the catalogue below fixes it.',
    ar: 'يحسب الدفع كل طلب من هذا الجدول. ما دام منتج غائبًا، يصبح مجموع أي سلة تحويه صفرًا، ويُرفض الدفع بعبارة «لا يوجد مبلغ مستحق للطلب». إرسال الكتالوج أدناه يصلح ذلك.',
  },
  differBody: {
    en: 'Customers are charged the database price, not the price shown in the table below.',
    ar: 'يُحتسب على العملاء سعر قاعدة البيانات، لا السعر المعروض في الجدول أدناه.',
  },
  inSyncTitle: { en: 'Catalogue is in sync', ar: 'الكتالوج متطابق' },
  pushTitle: { en: 'Push the site catalogue to the database', ar: 'أرسل كتالوج الموقع إلى قاعدة البيانات' },
  pushBody: {
    en: 'Inserts the products the database does not hold yet, matching on slug. Products already in the database are not changed here: edit them in the list below. Re-running it is safe: it never creates duplicates and never deletes anything.',
    ar: 'يُضيف المنتجات التي لا تحتفظ بها قاعدة البيانات بعد، مع المطابقة على المعرّف (slug). المنتجات الموجودة فيها لا تتغير من هنا، وتُعدَّل من القائمة أدناه. إعادة التشغيل آمنة: لا تنشئ تكرارًا ولا تحذف شيئًا.',
  },
  pushing: { en: 'Pushing…', ar: 'جارٍ الإرسال…' },
  nothingToPush: { en: 'Nothing to push', ar: 'لا شيء للإرسال' },
  nothingAdded: { en: 'Nothing was missing, so nothing changed.', ar: 'لم يكن هناك ما يُضاف، فلم يتغير شيء.' },
  unconfirmed: {
    en: 'The server did not confirm the push. Reload and check the list before pushing again.',
    ar: 'لم يؤكد الخادم الإرسال. أعد التحميل وراجع القائمة قبل الإرسال مرة أخرى.',
  },
  imagesNote: {
    en: 'Product images are not pushed: the built-in artwork is a placeholder embedded in the page, not a URL. Add real photo URLs per product below once you have them.',
    ar: 'الصور لا تُرسل: الصورة المدمجة في الصفحة عنصر نائب وليست رابطًا. أضِف روابط الصور الحقيقية لكل منتج أدناه عند توفرها.',
  },
  comparison: { en: 'Comparison', ar: 'المقارنة' },
  sumOk: { en: 'in sync', ar: 'متطابق' },
  sumDiffer: { en: 'differ', ar: 'مختلف' },
  sumMissing: { en: 'missing', ar: 'ناقص' },
  colProduct: { en: 'Product', ar: 'المنتج' },
  colSlug: { en: 'Slug', ar: 'المعرّف' },
  colSite: { en: 'Site price', ar: 'سعر الموقع' },
  colDb: { en: 'Database', ar: 'قاعدة البيانات' },
  colState: { en: 'State', ar: 'الحالة' },
  site: { en: 'site', ar: 'الموقع' },
  db: { en: 'db', ar: 'القاعدة' },
  extraTail: { en: 'They are left untouched.', ar: 'وتُركت دون تغيير.' },
}

const BADGE = {
  ok: { en: 'in sync', ar: 'متطابق' },
  differs: { en: 'differs', ar: 'مختلف' },
  missing: { en: 'missing', ar: 'ناقص' },
}

const pushLabel = (n, lang) => (lang === 'ar'
  ? `أرسل ${arabicCount(n, FORMS_PUSH)}`
  : `Push ${n} missing product(s)`)

const pushConfirm = (n, lang) => (lang === 'ar'
  ? `إضافة ${arabicCount(n, FORMS_PUSH)} إلى قاعدة البيانات؟ المنتجات الموجودة فيها لن تتغير.`
  : `Insert ${n} missing product(s) into the database? Products already in the database are not changed.`)

const pushedText = (n, lang) => (lang === 'ar'
  ? `تمت مزامنة ${arabicCount(n, FORMS_PRODUCT)}. صار بإمكان الدفع تسعير الطلبات الآن.`
  : `Synced ${n} products. Checkout can price orders now.`)

export default function Catalog() {
  const { lang } = useLang()
  const [state, setState] = useState({ loading: true })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const load = useCallback(async () => {
    setState({ loading: true })
    const r = await fetchCatalogState()
    setState({ loading: false, rows: r.rows ?? [], extra: r.extra ?? [], error: r.error, needsMigration: r.needsMigration })
  }, [])

  useEffect(() => { load() }, [load])

  // Insert-only, as syncCatalog is: it sends only the slugs the database does not
  // hold. `expected` is the number on the button, and the confirm repeats it, so
  // the admin sees the count before anything is written.
  async function push(expected) {
    if (!window.confirm(pushConfirm(expected, lang))) return
    setBusy(true); setResult(null)
    const r = await syncCatalog()
    setBusy(false)
    // A signed-out session or an unreadable table comes back with an error and is
    // shown as one. A missing table comes back with no error at all, so it is
    // named here. A reply without a count is never shown as a push that worked.
    if (r.signedOut || r.error) {
      setResult({ error: r.error })
      return
    }
    if (r.needsMigration) {
      setResult({ error: tx(T.migrateTitle, lang) })
      return
    }
    if (typeof r.count !== 'number') {
      setResult({ error: tx(T.unconfirmed, lang) })
      return
    }
    setResult({ ok: r.count })
    load()
  }

  if (state.loading) return <p className="text-slate-500">{tx(T.loading, lang)}</p>

  const rows = state.rows ?? []
  const missing = rows.filter((r) => r.state === 'missing')
  const differs = rows.filter((r) => r.state === 'differs')
  const synced = rows.length - missing.length - differs.length
  // While the table cannot be read there is no verdict to give. "In sync" would
  // be a claim about rows this page never received, and the push is off too,
  // because it would fail the same way.
  const unreadable = !!state.error || !!state.needsMigration
  const canPush = !unreadable && missing.length > 0

  const verdict = (unreadable || rows.length === 0) ? null
    : missing.length > 0 ? (
      <Notice
        tone="error"
        title={lang === 'ar'
          ? arabicCount(missing.length, FORMS_MISSING)
          : `${missing.length} product(s) missing from the database`}
      >
        {tx(T.missingBody, lang)}
      </Notice>
    ) : differs.length > 0 ? (
      <Notice
        tone="warn"
        title={lang === 'ar'
          ? arabicCount(differs.length, FORMS_DIFFER)
          : `${differs.length} price(s) differ`}
      >
        {tx(T.differBody, lang)}
      </Notice>
    ) : (
      <Notice tone="info" title={tx(T.inSyncTitle, lang)}>
        {lang === 'ar'
          ? `جميع المنتجات، وعددها ${rows.length}، موجودة في قاعدة البيانات بالسعر المتوقع.`
          : `All ${rows.length} products exist in the database at the expected price.`}
      </Notice>
    )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">{tx(T.title, lang)}</h1>
        <p className="mt-1 text-sm text-slate-500">{tx(T.lead, lang)}</p>
      </header>

      {state.error && <Notice tone="error" title={tx(T.readError, lang)}>{state.error}</Notice>}
      {state.needsMigration && (
        <Notice tone="warn" title={tx(T.migrateTitle, lang)}>
          <code className="rounded bg-amber-100 px-1 font-mono text-[.85em]">api/schema.mysql.sql</code>{' '}
          {tx(T.migrateCode, lang)}
        </Notice>
      )}

      {verdict}

      <section className="rounded-xl border border-slate-300 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-bold text-slate-800">{tx(T.pushTitle, lang)}</p>
            <p className="mt-0.5 text-sm text-slate-500">{tx(T.pushBody, lang)}</p>
          </div>
          <button
            onClick={() => push(missing.length)}
            disabled={busy || !canPush}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy
              ? tx(T.pushing, lang)
              : canPush ? pushLabel(missing.length, lang) : tx(T.nothingToPush, lang)}
          </button>
        </div>
        {result?.ok > 0 && (
          <p className="mt-3 text-sm font-semibold text-emerald-700">{pushedText(result.ok, lang)}</p>
        )}
        {result?.ok === 0 && (
          <p className="mt-3 text-sm font-semibold text-slate-600">{tx(T.nothingAdded, lang)}</p>
        )}
        {result?.error && <p className="mt-3 text-sm font-semibold text-rose-600">{result.error}</p>}
        <p className="mt-3 text-xs text-slate-500">{tx(T.imagesNote, lang)}</p>
      </section>

      <section>
        <div className="mb-2 flex items-baseline gap-3">
          <h2 className="text-sm font-bold text-slate-700">{tx(T.comparison, lang)}</h2>
          <span className="text-xs text-slate-500">
            {synced} {tx(T.sumOk, lang)} · {differs.length} {tx(T.sumDiffer, lang)} · {missing.length} {tx(T.sumMissing, lang)}
          </span>
        </div>
        <table className="admin-table w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-slate-500">
              <th className="py-2 text-start font-semibold">{tx(T.colProduct, lang)}</th>
              <th className="py-2 text-start font-semibold">{tx(T.colSlug, lang)}</th>
              <th className="py-2 text-end font-semibold">{tx(T.colSite, lang)}</th>
              <th className="py-2 text-end font-semibold">{tx(T.colDb, lang)}</th>
              <th className="py-2 text-start font-semibold">{tx(T.colState, lang)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className="border-b border-slate-100">
                <td className="py-2.5">{r.name_en}</td>
                <td className="py-2.5 font-mono text-xs text-slate-500">{r.slug}</td>
                <td className="py-2.5 text-end tabular-nums">{kwd(r.price)}</td>
                <td className="py-2.5 text-end tabular-nums">
                  {r.remotePrice == null ? <span className="text-slate-500">—</span> : kwd(r.remotePrice)}
                </td>
                <td className="py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      r.state === 'ok' ? 'bg-emerald-100 text-emerald-800'
                        : r.state === 'differs' ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {tx(BADGE[r.state], lang)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="m-list">
          {rows.map((r) => (
            <div key={r.slug} className="m-row">
              <div className="m-row__top">
                <span className="m-row__title">{r.name_en}</span>
                <span
                  className={`m-row__badge ${
                    r.state === 'ok' ? 'm-row__badge--paid' : r.state === 'differs' ? 'm-row__badge--pending' : 'm-row__badge--failed'
                  }`}
                >
                  {tx(BADGE[r.state], lang)}
                </span>
              </div>
              <div className="m-row__meta">
                <span className="font-mono">{r.slug}</span> · {tx(T.site, lang)} {kwd(r.price)}
                {r.remotePrice != null && ` · ${tx(T.db, lang)} ${kwd(r.remotePrice)}`}
              </div>
            </div>
          ))}
        </div>

        {state.extra?.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            {lang === 'ar'
              ? arabicCount(state.extra.length, FORMS_EXTRA)
              : `${state.extra.length} product(s) exist only in the database and not on the site`}
            : <span className="font-mono" dir="ltr">{state.extra.join(', ')}</span>. {tx(T.extraTail, lang)}
          </p>
        )}
      </section>

      <section className="border-t border-slate-300 pt-6">
        <Products />
      </section>
    </div>
  )
}
