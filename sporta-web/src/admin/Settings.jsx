import { useEffect, useState } from 'react'
import { phpAdmin } from '../lib/backend'

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
          <p className="mt-1 text-xs text-slate-500">Exactly six digits.</p>
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

export default function Settings() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Settings</h1>

      <PasscodeSettings />

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
