import { useEffect, useState } from 'react'
import { phpAdmin, phpBase } from '../lib/backend'
import { useLang } from '../i18n/LanguageContext'

// The Settings tab: the sign-in note, the device passcode, and the photo note. A screen of its own (and so its own
// chunk, like the rest) rather than markup inside AdminApp, which is now only
// the shell around them.
// Device passcode: a six-digit code that unlocks this browser's sign-in without the full password. Setting or clearing
// it needs the current password, so an open session at a shared machine cannot add a way back in on its own.
// Server tokens for a refused save, each in both languages (the operator's language is chosen at the moment it is shown).
const PASSCODE_ERRORS = {
  wrong_password: { en: 'That password is not right.', ar: 'كلمة المرور غير صحيحة.' },
  invalid_passcode: { en: 'The passcode must be exactly six digits.', ar: 'يجب أن يتكون رمز المرور من ستة أرقام بالضبط.' },
}

function PasscodeSettings() {
  const [info, setInfo] = useState({ loading: true, set: false, error: false })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ text: '', ok: false })
  const { lang } = useLang()
  const tx = (en, ar) => (lang === 'ar' ? ar : en)

  useEffect(() => {
    let alive = true
    // A thrown fetch (server down, no network) must end the loading state as well, or the status
    // line stays on "Checking…" for good. Both outcomes land in the same error state.
    phpAdmin('passcode_info').then(({ status, data }) => {
      if (!alive) return
      setInfo(status === 200 ? { loading: false, set: !!data?.set, error: false } : { loading: false, set: false, error: true })
    }).catch(() => {
      if (alive) setInfo({ loading: false, set: false, error: true })
    })
    return () => { alive = false }
  }, [])

  // Says what a refused save means. Status 0 is no answer at all, 401 is a session that ended (not a
  // wrong password), 429 is the attempt lock; then the server's known tokens; the generic line is last.
  function saveFailure(status, token) {
    if (status === 0) return tx('Cannot reach the server. Check that the site is up, then retry.', 'تعذّر الوصول إلى الخادم. تحقّق من أن الموقع يعمل، ثم أعد المحاولة.')
    if (status === 401) return tx('Your admin session has ended. Reload this page and sign in again.', 'انتهت جلسة الإدارة. أعد تحميل الصفحة وسجّل الدخول من جديد.')
    if (status === 429) return tx('Too many attempts. Wait a few minutes, then try again.', 'محاولات كثيرة. انتظر بضع دقائق ثم حاول مرة أخرى.')
    const known = PASSCODE_ERRORS[token]
    if (known) return tx(known.en, known.ar)
    return tx('Could not save. Check the password and try again.', 'تعذّر الحفظ. تحقّق من كلمة المرور وحاول مرة أخرى.')
  }

  async function run(route, body, okText) {
    setBusy(true)
    setMsg({ text: '', ok: false })
    const { status, data } = await phpAdmin(route, { method: 'POST', body }).catch(() => ({ status: 0, data: null }))
    setBusy(false)
    if (status === 200) {
      setInfo({ loading: false, set: !!data?.set, error: false })
      setPassword('')
      setCode('')
      setMsg({ text: okText, ok: true })
    } else {
      setMsg({ text: saveFailure(status, data?.error), ok: false })
    }
  }

  const field = 'mt-1.5 w-full max-w-xs rounded-xl border border-slate-400 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
  return (
    <section aria-labelledby="passcode-heading" className="rounded-2xl border border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-600">
      <h2 id="passcode-heading" className="font-semibold text-slate-800">Passcode for this browser</h2>
      <p className="mt-2">
        A six-digit passcode unlocks the sign-in on a browser you have already used. It does not work on a new browser, and
        five wrong passcodes lock it for fifteen minutes. Changing your password removes it.
      </p>
      <p className="mt-2 font-semibold text-slate-800" role="status">
        {info.loading ? tx('Checking…', 'جارٍ التحقق…')
          : info.error ? tx('Could not read the passcode setting.', 'تعذّر قراءة إعداد رمز المرور.')
          : info.set ? tx('A passcode is set.', 'رمز المرور مُعيَّن.')
          : tx('No passcode is set.', 'لم يُعيَّن رمز مرور.')}
      </p>

      <form onSubmit={(e) => { e.preventDefault(); run('passcode_set', { password, passcode: code }, 'Passcode saved.') }} className="mt-4 space-y-4">
        <div>
          <label htmlFor="passcode-password" className="block font-bold text-slate-800">Your password</label>
          <input id="passcode-password" type="password" required autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="passcode-new" className="block font-bold text-slate-800">{info.set ? 'New passcode' : 'Passcode'}</label>
          <input id="passcode-new" type="password" required inputMode="numeric" autoComplete="new-password" pattern="\d{6}" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className={field} />
          <p className="mt-1 text-sm text-slate-600">Exactly six digits.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy || code.length !== 6 || !password}
            className="min-h-11 rounded-xl bg-indigo-600 px-5 py-2.5 font-bold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-60">
            {info.set ? 'Change passcode' : 'Set passcode'}
          </button>
          {info.set && (
            <button type="button" disabled={busy || !password}
              onClick={() => run('passcode_clear', { password }, 'Passcode removed.')}
              className="min-h-11 rounded-xl border border-slate-400 px-5 py-2.5 font-bold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-60">
              Remove passcode
            </button>
          )}
        </div>
      </form>
      {msg.text && (
        <p role="alert" className={`mt-3 font-semibold ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</p>
      )}
    </section>
  )
}

// Financial statements (XBRL). A period of up to a year: the figures are shown first, then the XBRL file can be saved.
// The definitions are in dropin/php-store/xbrl.php; the entity identifier is a placeholder until the legal one is set.
const K = (n) => (Number(n ?? 0)).toFixed(3)
function FinancialStatements() {
  const today = new Date()
  const ymd = (d) => d.toISOString().slice(0, 10)
  const [from, setFrom] = useState(`${today.getUTCFullYear()}-01-01`)
  const [to, setTo] = useState(ymd(today))
  const [figures, setFigures] = useState(null)
  const [msg, setMsg] = useState({ text: '', ok: false })
  const [busy, setBusy] = useState(false)

  async function show() {
    setBusy(true); setMsg({ text: '', ok: false }); setFigures(null)
    const { status, data } = await phpAdmin(`xbrl_export&from=${from}&to=${to}&format=json`).catch(() => ({ status: 0, data: null }))
    setBusy(false)
    if (status === 200) setFigures(data)
    else setMsg({ text: status === 400 ? 'Choose a period that starts before it ends and is at most a year long.' : 'Could not load the figures.', ok: false })
  }

  async function download() {
    setBusy(true)
    try {
      const res = await fetch(`${phpBase()}/admin.php?r=xbrl_export&from=${from}&to=${to}`, { credentials: 'include', headers: { 'X-Sporta-Admin': '1' } })
      if (!res.ok) throw new Error(String(res.status))
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a'); a.href = url; a.download = `sporta-financials-${from}-${to}.xbrl`
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMsg({ text: 'XBRL file saved.', ok: true })
    } catch {
      setMsg({ text: 'Could not create the XBRL file. Check the period and sign in again.', ok: false })
    }
    setBusy(false)
  }

  const field = 'mt-1.5 w-full max-w-xs rounded-xl border border-slate-400 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
  const row = (label, value) => (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2"><span>{label}</span><span className="font-semibold tabular-nums text-slate-900">{value}</span></div>
  )
  return (
    <section aria-labelledby="fs-heading" className="rounded-2xl border border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-600">
      <h2 id="fs-heading" className="font-semibold text-slate-800">Financial statements (XBRL)</h2>
      <p className="mt-2">
        Revenue, cost of sales, gross profit, stock on hand and profit for a period, as an XBRL file (IFRS taxonomy, KWD).
        Cost of sales counts only items that have a cost; the figures show how many lines had none.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="fs-from" className="block font-bold text-slate-800">From</label>
          <input id="fs-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="fs-to" className="block font-bold text-slate-800">To</label>
          <input id="fs-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={show} disabled={busy || !from || !to}
          className="min-h-11 rounded-xl border border-slate-400 px-5 py-2.5 font-bold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-60">
          Show figures
        </button>
        <button type="button" onClick={download} disabled={busy || !from || !to}
          className="min-h-11 rounded-xl bg-indigo-600 px-5 py-2.5 font-bold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-60">
          Download XBRL file
        </button>
      </div>
      {figures && (
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          {row('Paid orders', figures.PaidOrders)}
          {row('Revenue (KWD)', K(figures.Revenue))}
          {row('Cost of sales (KWD)', K(figures.CostOfSales))}
          {row('Gross profit (KWD)', K(figures.GrossProfit))}
          {row('Delivery fees (KWD)', K(figures.OtherIncome))}
          {row('Expenses from settings (KWD)', K(figures.Expenses))}
          {row('Profit (KWD)', K(figures.ProfitLoss))}
          {row('Stock on hand, end of period (KWD)', K(figures.Inventories))}
          {row('Lines without a cost (not in cost of sales)', figures.CostMissingLines)}
        </div>
      )}
      {msg.text && <p role="alert" className={`mt-3 font-semibold ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</p>}
    </section>
  )
}

export default function Settings() {
  const { lang } = useLang()
  const tx = (en, ar) => (lang === 'ar' ? ar : en)
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Settings</h1>

      <PasscodeSettings />

      <FinancialStatements />

      <div className="rounded-2xl border border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-600">
        <p className="font-semibold text-slate-800">{tx('Your sign-in', 'تسجيل دخولك')}</p>
        {/* Clearing admin_users deletes every admin account with its passcode, two-step and Google data, and
            setup-admin.php needs the cron_key and an empty table. The warning comes before the steps, and the
            backup is named first, so nobody starts over by accident (PCS-17). */}
        <p className="mt-2">
          {lang === 'ar' ? (
            <>
              البريد الإلكتروني وكلمة المرور، ينشئهما الخادم. خمس محاولات بكلمة مرور خاطئة تقفل الحساب لمدة خمس عشرة دقيقة.
              إعادة البدء الكامل هي الملاذ الأخير: خذ نسخة احتياطية من قاعدة البيانات أولاً، لأن تفريغ جدول{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5">admin_users</code> يحذف كل حسابات الإدارة مع رمز المرور
              وخطوة التحقق الثانية وربط حساب Google. ثم أفرغ هذا الجدول من phpMyAdmin وشغّل{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5">api/setup-admin.php</code> من جديد. الصفحة تطلب{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5">cron_key</code> من ملف config.php، وترفض العمل ما دام
              يوجد أي حساب إدارة. بعد ذلك احذف هذا الملف.
            </>
          ) : (
            <>
              Email and password, created on the server. Five wrong passwords lock the account for fifteen minutes.
              Starting over is a last resort: back up the database first, because clearing{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5">admin_users</code> deletes every admin account, with its
              passcode, two-step sign-in and Google link. Then clear that table in phpMyAdmin and run{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5">api/setup-admin.php</code> again. It asks for the{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5">cron_key</code> from config.php, and it refuses to run
              while any admin account exists. Then delete that file.
            </>
          )}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-600">
        <p className="font-semibold text-slate-800">{tx('Product photos', 'صور المنتجات')}</p>
        {/* The product route (admin.php product_image_upload) writes the file unchanged, PNG/JPEG/WebP up to 10 MiB,
            into the media folder, so the old "upload into public_html" instruction was wrong (PCS-18). */}
        <p className="mt-2">
          {tx(
            'Product photos are uploaded one file at a time with the photo uploader in the admin: PNG, JPEG or WebP, up to 10 MB. The file is saved exactly as sent, with no resizing or re-encoding, and the product is pointed at the new path, for example /images/products/name.jpg. Brand logos and hero slides are stored in the database and are uploaded on the Brands and Slides tabs.',
            'ترفع صور المنتجات ملفاً تلو الآخر من أداة رفع الصور في لوحة الإدارة: PNG أو JPEG أو WebP، بحد أقصى 10 ميغابايت. يُحفظ الملف كما أُرسل تماماً، دون تصغير أو إعادة ترميز، ويُربط المنتج بالمسار الجديد، مثل /images/products/name.jpg. شعارات العلامات التجارية وشرائح الصفحة الرئيسية تُخزَّن في قاعدة البيانات، وتُرفع من تبويبي العلامات التجارية والشرائح.',
          )}
        </p>
      </div>
    </div>
  )
}
