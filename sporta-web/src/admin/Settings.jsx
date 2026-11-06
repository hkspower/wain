import { useEffect, useState } from 'react'
import { phpAdmin, phpBase } from '../lib/backend'

// The Settings tab: the sign-in note, the device passcode, and the photo note. A screen of its own (and so its own
// chunk, like the rest) rather than markup inside AdminApp, which is now only
// the shell around them.
// Device passcode: a six-digit code that unlocks this browser's sign-in without the full password. Setting or clearing
// it needs the current password, so an open session at a shared machine cannot add a way back in on its own.
const PASSCODE_ERRORS = {
  wrong_password: 'That password is not right.',
  invalid_passcode: 'The passcode must be exactly six digits.',
}

function PasscodeSettings() {
  const [info, setInfo] = useState({ loading: true, set: false, error: '' })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ text: '', ok: false })

  useEffect(() => {
    let alive = true
    phpAdmin('passcode_info').then(({ status, data }) => {
      if (!alive) return
      setInfo(status === 200 ? { loading: false, set: !!data?.set, error: '' } : { loading: false, set: false, error: 'Could not read the passcode setting.' })
    })
    return () => { alive = false }
  }, [])

  async function run(route, body, okText) {
    setBusy(true)
    setMsg({ text: '', ok: false })
    const { status, data } = await phpAdmin(route, { method: 'POST', body }).catch(() => ({ status: 0, data: null }))
    setBusy(false)
    if (status === 200) {
      setInfo({ loading: false, set: !!data?.set, error: '' })
      setPassword('')
      setCode('')
      setMsg({ text: okText, ok: true })
    } else {
      setMsg({ text: PASSCODE_ERRORS[data?.error] ?? 'Could not save. Check the password and try again.', ok: false })
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
        {info.loading ? 'Checking…' : info.error || (info.set ? 'A passcode is set.' : 'No passcode is set.')}
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
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Settings</h1>

      <PasscodeSettings />

      <FinancialStatements />

      <div className="rounded-2xl border border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-600">
        <p className="font-semibold text-slate-800">Your sign-in</p>
        <p className="mt-2">
          Email and password, created on the server. To change the password, clear the{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">admin_users</code> table in
          phpMyAdmin and run{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">api/setup-admin.php</code>{' '}
          again — then delete that file. Five wrong passwords lock the account for fifteen
          minutes.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-600">
        <p className="font-semibold text-slate-800">Product photos</p>
        <p className="mt-2">
          Photos ship with the site. Upload new ones into{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">public_html/cats/</code> in
          hPanel File Manager and reference them from the catalogue. Brand logos are the
          exception — those live in the database and are uploaded on the Brands tab, because
          nothing on this server may write files.
        </p>
      </div>
    </div>
  )
}
