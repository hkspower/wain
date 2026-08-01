import { useEffect, useState } from 'react'
import { useAdminMeta } from './useAdminMeta'
import Overview from './Overview'
import Inventory from './Inventory'
import Orders from './Orders'
import Catalog from './Catalog'
import Brands from './Brands'
import { IconBag, IconTruck, IconStar, IconLock, IconBox } from '../components/icons'
import { phpAdmin } from '../lib/backend'

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
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8">
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
        <p className="mt-3 text-center text-xs text-slate-400">
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

  // Ask the server how it is BEFORE offering a password box.
  //
  // Every setup failure used to arrive as "Wrong email or password", because
  // that was the only branch the login had. So a server with no api/config.php,
  // a database with no tables, and a genuine typo all looked identical — and
  // the one thing they have in common is that the password is fine. The owner
  // retypes it, gets the same lie back, and eventually locks the account.
  useEffect(() => {
    phpAdmin('me')
      .then(({ status, data }) => {
        const reason = setupReason(status, data)
        if (reason) setBlocked(reason)
        setSession(data ?? null)
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
    if (status === 200) setSession(data)
    else if (reason) setBlocked(reason)
    else if (status === 429 || data?.error === 'locked') {
      setError('Too many attempts — this account is locked for 15 minutes.')
    } else setError('Wrong email or password.')
    setBusy(false)
  }

  if (session === undefined) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>
  }

  if (blocked) return <SetupNeeded {...blocked} />

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <form onSubmit={login} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-8">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white">S</div>
            <h1 className="text-xl font-bold text-slate-800">Sporta Backends</h1>
            <p className="mt-1 text-xs text-slate-500">Signed in on this server</p>
          </div>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
          <input
            type="email" required autoComplete="username" placeholder="Email"
            value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
          />
          <input
            type="password" required autoComplete="current-password" placeholder="Password"
            value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
          />
          <button disabled={busy} className="w-full rounded-xl bg-indigo-600 py-2.5 font-bold text-white disabled:opacity-50">
            {busy ? '…' : 'Sign in'}
          </button>
        </form>
      </div>
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


// Responsive admin: desktop sidebar (hidden < 768px) + mobile sticky header and
// bottom tab bar (.m-header / .m-tabbar from admin-mobile.css). Data tables show
// as .admin-table on desktop and .m-list/.m-row card rows on mobile.
// Emoji were replaced with the site's own SVG set: they render differently on
// every OS and cannot take the accent colour.
const ADMIN_TABS = [
  { id: 'overview', label: 'Overview', Icon: IconStar },
  { id: 'orders',   label: 'Orders',   Icon: IconBag },
  { id: 'catalog',  label: 'Catalogue', Icon: IconTruck },
  { id: 'brands',   label: 'Brands',   Icon: IconStar },
  { id: 'stock',    label: 'Inventory', Icon: IconBox },
  { id: 'settings', label: 'Settings', Icon: IconLock },
]

function Dashboard({ email, onSignOut }) {
  const [tab, setTab] = useState('overview')
  // Lets the Overview alerts deep-link into a filtered Orders view.
  const [orderFilter, setOrderFilter] = useState('all')
  const goto = (id, filter) => {
    if (filter) setOrderFilter(filter)
    setTab(id)
  }

  return (
    <div className="admin-shell min-h-screen bg-slate-50 md:flex">
      {/* Desktop sidebar — hidden on mobile via .admin-sidebar */}
      <aside className="admin-sidebar w-60 shrink-0 border-e border-slate-200 bg-white p-4 md:min-h-screen">
        <div className="mb-6 flex items-center gap-3 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">S</span>
          <span className="font-bold text-slate-800">Sporta Backends</span>
        </div>
        <nav className="flex flex-col gap-1">
          {ADMIN_TABS.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`rounded-lg px-3 py-2 text-start text-sm font-semibold ${
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
          {email && <p className="truncate px-3 text-xs text-slate-400" title={email}>{email}</p>}
          <button onClick={onSignOut} className="mt-1 rounded-lg px-3 py-2 text-start text-sm font-semibold text-slate-400 hover:text-rose-600">
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile sticky header */}
      <header className="m-header">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">S</span>
        <span className="m-header__title">{ADMIN_TABS.find((t) => t.id === tab)?.label}</span>
        <button onClick={onSignOut} className="text-sm font-semibold text-slate-400">Sign out</button>
      </header>

      <main className="admin-content flex-1 px-4 py-6 md:px-8 md:py-10">

        {tab === 'overview' && <Overview onGoto={goto} />}

        {tab === 'orders' && <Orders key={orderFilter} initialPayment={orderFilter} />}

        {tab === 'catalog' && <Catalog />}

        {tab === 'brands' && <Brands />}

        {tab === 'stock' && <Inventory />}

        {tab === 'settings' && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Settings</h1>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-600">
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

            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-600">
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
        )}

      </main>

      {/* Mobile bottom tab bar */}
      <nav className="m-tabbar">
        {ADMIN_TABS.map((tb) => (
          <button
            key={tb.id}
            className="m-tabbar__item"
            aria-current={tab === tb.id}
            onClick={() => setTab(tb.id)}
          >
            <span className="m-tabbar__icon"><tb.Icon size={20} /></span>
            {tb.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

