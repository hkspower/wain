import { useEffect, useState } from 'react'
import { useAdminMeta } from './useAdminMeta'
import ScreenHost from './ScreenHost'
import { loadScreen, warmProps } from './screens'
import { IconUsers } from './icons'
import { IconBag, IconTruck, IconStar, IconLock, IconBox, IconImage, IconHeart, IconPlus } from '../components/icons'
import { phpAdmin } from '../lib/backend'
// Admin-only styles. Imported here so they ship with the /backends chunk and
// never reach a storefront visitor (they were global before).
import '../styles/admin.css'
import '../styles/admin-mobile.css'

// The three ways the backends screen can be unreachable that are NOT a wrong
// password. Each names the one file or action that fixes it, because "check
// your configuration" is what you say when you do not know which part is
// wrong — and here the server has already told us.
function setupReason(status, data) {
  const token = data?.error ?? ''
  // 404 = the api/ folder never arrived. 0 = the request did not complete at
  // all. Both mean "not installed", and both used to read as a bad password.
  if (status === 404 || status === 0) {
    return {
      title: 'The backend is not on the server',
      lead: 'Nothing is answering at /api. The site was uploaded without its api/ folder.',
      steps: [
        'Upload public_html/api/ from SPORTA-GO-LIVE.zip (or run npm run publish, which sends it).',
        'Then create api/config.php from api/config.example.php and set its permissions to 600.',
      ],
      note: 'While /api is missing the shop shows no catalogue and refuses every checkout, not just the admin.',
    }
  }
  if (token === 'not_configured') {
    return {
      title: 'The backend is not configured yet',
      lead: 'The site is on the server, but nothing has told it which database to use.',
      steps: [
        'hPanel → Databases → MySQL Databases: create a database and a user, and give that user all privileges on it.',
        'hPanel → File Manager: copy public_html/api/config.example.php to public_html/api/config.php.',
        'Fill in db_host (localhost), db_name, db_user and db_pass, then set the file’s permissions to 600.',
      ],
      note: 'knet/config.php and pay/config.php need the SAME four values, spelled mysql_host / mysql_name / mysql_user / mysql_pass. Until they have them, every card payment is refused.',
    }
  }
  if (token === 'no_table') {
    return {
      title: 'The database is empty',
      lead: 'api/config.php is working and the server connected — the tables just are not there yet.',
      steps: [
        'hPanel → Databases → phpMyAdmin → Import.',
        'Run api/schema.mysql.sql, then api/seed.mysql.sql, then api/brands.mysql.sql — in that order.',
      ],
      note: 'The order matters and getting it wrong fails quietly. All three are safe to re-run: prices and names update in place, nothing duplicates, and your stock counts are never overwritten.',
    }
  }
  if (token === 'db_unreachable') {
    return {
      title: 'The database is refusing the connection',
      lead: `api/config.php is on the server, but MySQL will not accept what is in it — ${data?.cause ?? 'one of the four values'} is wrong.`,
      steps: [
        'hPanel → Databases → MySQL Databases. Check the database name and the user name EXACTLY: Hostinger prefixes both with your account, so they look like u123456789_sporta, not sporta.',
        'Set a fresh password on that user there, and paste the same one into api/config.php as db_pass.',
        'Make sure the user is listed under that database with ALL PRIVILEGES.',
        'db_host is localhost.',
      ],
      note: 'knet/config.php and pay/config.php carry the same four values under different names (mysql_host / mysql_name / mysql_user / mysql_pass). If this one is wrong they usually are too, and until they are fixed every card payment is refused.',
    }
  }
  if (token === 'no_admin_account') {
    return {
      title: 'No sign-in has been created yet',
      lead: 'The database is set up. There is simply nobody to sign in as — so no password can be correct.',
      steps: [
        'Open https://www.sporta.com.kw/api/setup-admin.php',
        'It asks for the cron_key from api/config.php, then your email and a password of at least 12 characters.',
        'Delete api/setup-admin.php from the server afterwards.',
      ],
      note: 'It only works while no account exists, so it can create the first one and never a second.',
    }
  }
  return null
}

// Deliberately plain: this screen is read on a phone, in hPanel, by someone who
// is mid-task and stuck.
function SetupNeeded({ title, lead, steps, note }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-xl rounded-2xl border border-slate-300 bg-white p-8">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white">S</div>
          <span className="font-bold text-slate-800">Sporta Backends</span>
        </div>
        <h1 className="text-lg font-bold text-slate-900">{title}</h1>
        <p className="mt-1.5 text-sm text-slate-600">{lead}</p>
        <ol className="mt-5 space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-slate-700">
              <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        {note && (
          <p className="mt-5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">{note}</p>
        )}
        <button
          onClick={() => window.location.reload()}
          className="mt-6 w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
        >
          Check again
        </button>
        <p className="mt-3 text-center text-xs text-slate-500">
          GO-LIVE.md walks through all of this in order.
        </p>
      </div>
    </div>
  )
}

// The backends screen.
//
// The session cookie is the whole story: HttpOnly, SameSite=Strict, throttled
// at the login, five failures and the account waits fifteen minutes. What used
// to sit here instead was a hosted-auth orchestration — a session, a
// per-device passcode, an idle lock, an allowlist table — three screens and
// two RPCs to decide whether to show a dashboard. One server, one session,
// one answer.
export default function AdminApp() {
  useAdminMeta()
  const [session, setSession] = useState(undefined) // undefined = checking
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(null) // a SETUP step, not a bad password
  // The email of a browser that has a passcode set (device passcode, quick unlock). Null = password sign-in.
  const [passcodeFor, setPasscodeFor] = useState(null)

  // Ask, once the browser is known to be signed out, whether the last email here can unlock with a passcode.
  // The server answers "enabled" only for a browser that has signed in before (its device cookie).
  useEffect(() => {
    if (session !== null || blocked) return undefined
    const last = rememberedEmail()
    if (!last) return undefined
    let alive = true
    phpAdmin(`passcode_status&email=${encodeURIComponent(last)}`)
      .then(({ status, data }) => { if (alive && status === 200 && data?.enabled) setPasscodeFor(last) })
      .catch(() => {})
    return () => { alive = false }
  }, [session, blocked])

  // Ask the server how it is BEFORE offering a password box.
  //
  // Every setup failure used to arrive as "Wrong email or password", because
  // that was the only branch the login had. So a server with no api/config.php,
  // a database with no tables, and a genuine typo all looked identical — and
  // the one thing they have in common is that the password is fine. The owner
  // retypes it, gets the same lie back, and eventually locks the account.
  useEffect(() => {
    // Start the first tab's chunk NOW, beside the session check, instead of
    // after it. Without this the page waits for AdminApp, then for `me`, then
    // starts fetching Overview: three round trips in a row on a phone. Whether
    // or not this browser is still signed in, the next thing it shows is that
    // screen, and it is the one chunk the split must not make slower.
    loadScreen(FIRST_TAB).catch(() => {})
    phpAdmin('me')
      .then(({ status, data }) => {
        const reason = setupReason(status, data)
        if (reason) setBlocked(reason)
        // ONLY a 200 is a session. This was `data ?? null`, and every error
        // response has a body — so {"error":"db_unreachable"} was truthy, the
        // app decided somebody was signed in, and rendered the whole dashboard
        // shell around the words "Cannot load the dashboard". A failure that
        // dresses itself as a working screen is worse than a blank one: there
        // is nothing on it to act on and no way back to the sign-in form.
        setSession(status === 200 ? data : null)
      })
      // A rejected fetch means the request never completed. Without this the
      // promise rejects unhandled and the screen sits on "Loading…" forever.
      .catch(() => {
        setBlocked(setupReason(0, null))
        setSession(null)
      })
  }, [])

  async function login(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { status, data } = await phpAdmin('login', { method: 'POST', body: form })
      .catch(() => ({ status: 0, data: null }))
    const reason = setupReason(status, data)
    if (status === 200) { rememberEmail(form.email); setSession(data) }
    else if (reason) setBlocked(reason)
    else if (status === 429 || data?.error === 'locked') {
      setError('Too many attempts — this account is locked for 15 minutes.')
    } else if (status >= 500 || status === 0) {
      // A server error is not a bad password, and saying it is costs the owner
      // five attempts and a fifteen-minute lock. Anything 5xx that setupReason
      // could not name is still the server's fault, and is reported as such.
      setError('The server failed to answer. This is not your password — check that api/config.php is correct and that the database is running.')
    } else setError('Wrong email or password.')
    setBusy(false)
  }

  if (session === undefined) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading…</div>
  }

  if (blocked) return <SetupNeeded {...blocked} />

  if (!session) {
    return (
      <SignIn
        form={form} setForm={setForm} error={error} busy={busy} onSubmit={login}
        passcodeFor={passcodeFor}
        onUsePassword={() => { setPasscodeFor(null); setError('') }}
        onPasscode={async (passcode) => {
          setBusy(true)
          setError('')
          const { status, data } = await phpAdmin('passcode_login', { method: 'POST', body: { email: passcodeFor, passcode } })
            .catch(() => ({ status: 0, data: null }))
          if (status === 200) setSession(data)
          else if (status === 423 && data?.error === 'passcode_locked') {
            setPasscodeFor(null)
            setError('Too many wrong passcodes. Sign in with your password.')
          } else if (status === 423 || data?.error === 'locked') {
            setError('Too many attempts — this account is locked for 15 minutes.')
          } else if (status === 403) {
            setPasscodeFor(null)
            setError('Sign in with your password on this browser.')
          } else if (status === 401 || data?.error === 'wrong_passcode') {
            setError('That passcode is not right.')
          } else setError('The server failed to answer. Try again, or sign in with your password.')
          setBusy(false)
        }}
      />
    )
  }

  return (
    <Dashboard
      email={session.email}
      onSignOut={async () => {
        await phpAdmin('logout', { method: 'POST' })
        setSession(null)
      }}

      canLock={false}
    />
  )
}


// The last email signed in on THIS browser, for the passcode step. Only the address is kept (never the password), and a
// browser that blocks storage simply shows the password form.
function rememberedEmail() {
  try { return localStorage.getItem('sporta.admin.email') || null } catch { return null }
}
function rememberEmail(email) {
  try { localStorage.setItem('sporta.admin.email', String(email).trim().toLowerCase()) } catch { /* storage blocked */ }
}

// The sign-in form. Behaviour is unchanged: the same request, the same error
// text from login(), and the same setup gate above it. What changed is how it
// is read: visible labels (placeholders vanish once typing starts), an error
// that is announced to a screen reader and points at the field, a password
// show/hide control, 44px targets, and the email field focused on arrival.
function SignIn({ form, setForm, error, busy, onSubmit, passcodeFor, onUsePassword, onPasscode }) {
  const [showPassword, setShowPassword] = useState(false)
  const [passcode, setPasscode] = useState('')
  if (passcodeFor) {
    // The quick unlock: the browser already knows this account, so it asks for the six-digit passcode only.
    return (
      <div dir="ltr" className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
        <form onSubmit={(e) => { e.preventDefault(); if (/^\d{6}$/.test(passcode)) onPasscode(passcode) }} aria-labelledby="passcode-title" aria-busy={busy}
          className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-300 bg-white p-7 shadow-sm sm:p-8">
          <div className="text-center">
            <div aria-hidden="true" className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">S</div>
            <h1 id="passcode-title" className="text-xl font-bold text-slate-900">Enter your passcode</h1>
            <p className="mt-1 text-sm text-slate-600">{passcodeFor}</p>
          </div>
          <div role="alert" aria-live="assertive" className="empty:hidden">
            {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-800">{error}</p>}
          </div>
          <div>
            <label htmlFor="admin-passcode" className="block text-sm font-bold text-slate-800">Six-digit passcode</label>
            <input
              id="admin-passcode" type="password" required autoFocus inputMode="numeric" autoComplete="one-time-code"
              pattern="\d{6}" maxLength={6} aria-invalid={/not right/.test(error) || undefined}
              value={passcode} onChange={(e) => setPasscode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="mt-1.5 w-full rounded-xl border border-slate-400 bg-white px-3 py-2.5 text-center text-lg tracking-[0.4em] text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <button type="submit" disabled={busy || passcode.length !== 6}
            className="min-h-11 w-full rounded-xl bg-indigo-600 py-2.5 text-base font-bold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60">
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
          <button type="button" onClick={onUsePassword}
            className="min-h-11 w-full rounded-lg text-sm font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900 focus-visible:outline-2 focus-visible:outline-indigo-600">
            Use my password instead
          </button>
        </form>
      </div>
    )
  }
  const credentialError = /Wrong email or password|locked/i.test(error)
  const field = 'mt-1.5 w-full rounded-xl border border-slate-400 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 aria-[invalid=true]:border-rose-600'
  return (
    // dir="ltr": the copy is English, and the admin page can open in Arabic mode (the root is RTL), which mirrored the labels.
    <div dir="ltr" className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
      <form onSubmit={onSubmit} aria-labelledby="sign-in-title" aria-busy={busy}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-300 bg-white p-7 shadow-sm sm:p-8">
        <div className="text-center">
          <div aria-hidden="true" className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">S</div>
          <h1 id="sign-in-title" className="text-xl font-bold text-slate-900">Sporta Backends</h1>
          <p className="mt-1 text-sm text-slate-600">Sign in with the admin email and password for this shop.</p>
        </div>

        <div role="alert" aria-live="assertive" className="empty:hidden">
          {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-800">{error}</p>}
        </div>

        <div>
          <label htmlFor="admin-email" className="block text-sm font-bold text-slate-800">Email</label>
          <input
            id="admin-email" type="email" required autoFocus autoComplete="username" inputMode="email"
            spellCheck={false} autoCapitalize="none"
            aria-invalid={credentialError || undefined}
            value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className={field}
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="admin-password" className="block text-sm font-bold text-slate-800">Password</label>
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword}
              className="min-h-11 rounded-lg px-2 text-sm font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900 focus-visible:outline-2 focus-visible:outline-indigo-600">
              {showPassword ? 'Hide password' : 'Show password'}
            </button>
          </div>
          <input
            id="admin-password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password"
            spellCheck={false} autoCapitalize="none"
            aria-invalid={credentialError || undefined}
            value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className={field}
          />
        </div>

        <button type="submit" disabled={busy}
          className="min-h-11 w-full rounded-xl bg-indigo-600 py-2.5 text-base font-bold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-center text-sm text-slate-600">Five wrong passwords lock the account for fifteen minutes.</p>
      </form>
    </div>
  )
}

// Responsive admin: desktop sidebar (hidden < 768px) + mobile sticky header and
// bottom tab bar (.m-header / .m-tabbar from admin-mobile.css). Data tables show
// as .admin-table on desktop and .m-list/.m-row card rows on mobile.
// Emoji were replaced with the site's own SVG set: they render differently on
// every OS and cannot take the accent colour.
const ADMIN_TABS = [
  { id: 'overview', label: 'Overview', Icon: IconStar },
  { id: 'orders',   label: 'Orders',   Icon: IconBag },
  { id: 'profiles', label: 'Profiles', Icon: IconUsers },
  { id: 'catalog',  label: 'Catalogue', Icon: IconTruck },
  { id: 'brands',   label: 'Brands',   Icon: IconStar },
  { id: 'slides',   label: 'Slides',   Icon: IconImage },
  { id: 'promos',   label: 'Promotions', Icon: IconHeart },
  { id: 'discounts', label: 'Discounts', Icon: IconPlus },
  { id: 'stock',    label: 'Inventory', Icon: IconBox },
  { id: 'settings', label: 'Settings', Icon: IconLock },
]

const FIRST_TAB = 'overview'

function Dashboard({ email, onSignOut }) {
  const [tab, setTab] = useState(FIRST_TAB)
  // Lets the Overview alerts deep-link into a filtered Orders view.
  const [orderFilter, setOrderFilter] = useState('all')
  const goto = (id, filter) => {
    if (filter) setOrderFilter(filter)
    setTab(id)
  }

  return (
    <div className="admin-shell min-h-screen bg-slate-50 md:flex">
      {/* Desktop sidebar — hidden on mobile via .admin-sidebar */}
      <aside className="admin-sidebar w-60 shrink-0 border-e border-slate-300 bg-white p-4 md:min-h-screen">
        <div className="mb-6 flex items-center gap-3 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">S</span>
          <span className="font-bold text-slate-800">Sporta Backends</span>
        </div>
        <nav className="flex flex-col gap-1">
          {ADMIN_TABS.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              {...warmProps(tb.id)}
              className={`flex min-h-11 items-center rounded-lg px-3 py-2 text-start text-sm font-semibold ${
                tab === tb.id ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <tb.Icon size={17} />
                {tb.label}
              </span>
            </button>
          ))}
        </nav>
        <div className="mt-6 border-t border-slate-100 pt-4">
          {email && <p className="truncate px-3 text-xs text-slate-500" title={email}>{email}</p>}
          <button onClick={onSignOut} className="mt-1 flex min-h-11 items-center rounded-lg px-3 py-2 text-start text-sm font-semibold text-slate-500 hover:text-rose-600">
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile sticky header */}
      <header className="m-header">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">S</span>
        <span className="m-header__title">{ADMIN_TABS.find((t) => t.id === tab)?.label}</span>
        <button onClick={onSignOut} className="min-h-11 px-2 text-sm font-semibold text-slate-500">Sign out</button>
      </header>

      <main className="admin-content flex-1 px-4 py-6 md:px-8 md:py-10">

        {/* One screen at a time, each its own chunk (see screens.js). Orders is
            keyed by its filter so a deep link from the Overview alerts opens it
            on that filter, as it did when it was a static import. */}
        <ScreenHost
          key={tab === 'orders' ? `orders:${orderFilter}` : tab}
          id={tab}
          label={ADMIN_TABS.find((t) => t.id === tab)?.label ?? 'This screen'}
          screenProps={tab === 'overview' ? { onGoto: goto } : tab === 'orders' ? { initialPayment: orderFilter } : undefined}
        />

      </main>

      {/* Mobile bottom tab bar */}
      <nav className="m-tabbar">
        {ADMIN_TABS.map((tb) => (
          <button
            key={tb.id}
            className="m-tabbar__item"
            aria-current={tab === tb.id}
            onClick={() => setTab(tb.id)}
            {...warmProps(tb.id)}
          >
            <span className="m-tabbar__icon"><tb.Icon size={20} /></span>
            {tb.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

