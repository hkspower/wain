import { useCallback, useEffect, useState } from 'react'
import { supabase, hasDevicePasscode } from '../lib/supabase'
import { getDeviceId, isEnrolledLocally, markEnrolled, clearEnrolled } from '../lib/deviceId'
import { useIdleLock } from './useIdleLock'
import { useAdminMeta } from './useAdminMeta'
import AdminLogin from './AdminLogin'
import LockScreen from './LockScreen'
import SetupQuickUnlock from './SetupQuickUnlock'
import Overview from './Overview'
import Orders from './Orders'
import Catalog from './Catalog'
import { IconBag, IconTruck, IconStar, IconLock } from '../components/icons'

// Orchestrates the admin session:
//   no session            -> AdminLogin
//   session + enrolled     -> LockScreen until unlocked (also re-locks on idle)
//   session + unlocked     -> Dashboard
export default function AdminApp() {
  useAdminMeta()
  const [session, setSession] = useState(undefined) // undefined = loading
  const [enrolled, setEnrolled] = useState(isEnrolledLocally()) // server-reconciled below
  const [locked, setLocked] = useState(isEnrolledLocally())

  // Ask the server whether this device is enrolled; reconcile the local hint.
  // Falls back to the local flag if the RPC is unavailable.
  const refreshEnrollment = useCallback(async (hasSession) => {
    if (!hasSession) {
      setEnrolled(false)
      return false
    }
    try {
      const yes = await hasDevicePasscode(getDeviceId())
      setEnrolled(yes)
      if (yes) markEnrolled()
      else clearEnrolled()
      return yes
    } catch {
      const fallback = isEnrolledLocally()
      setEnrolled(fallback)
      return fallback
    }
  }, [])

  useEffect(() => {
    if (!supabase) {
      setSession(null)
      return
    }
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      const yes = await refreshEnrollment(!!data.session)
      // Lock immediately on load if a passcode is enrolled on this device.
      setLocked(!!data.session && yes)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s)
      const yes = await refreshEnrollment(!!s)
      setLocked(!!s && yes)
    })
    return () => sub.subscription.unsubscribe()
  }, [refreshEnrollment])

  // Re-lock after 15 minutes of inactivity (only when enrolled + signed in).
  const relock = useCallback(() => {
    if (session && enrolled) setLocked(true)
  }, [session, enrolled])
  useIdleLock(relock)

  async function usePasswordInstead() {
    await supabase?.auth.signOut()
    setLocked(false)
  }

  // This told the owner to set VITE_ variables in .env and rebuild — which is
  // not how this site is configured and, on a host with no shell, not something
  // they can do. The supported path is editing public_html/config.js in File
  // Manager, so that is what the message has to say.
  if (!supabase) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <h1 className="text-lg font-bold text-slate-800">Admin is not configured yet</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Open <code className="rounded bg-slate-100 px-1.5 py-0.5">public_html/config.js</code> in
            Hostinger File Manager and paste your Supabase <b>Project URL</b> and{' '}
            <b>anon</b> key. Save, then reload this page — nothing needs rebuilding.
          </p>
          <p className="mt-3 text-xs text-slate-400">
            Supabase → Project Settings → API. Use the <b>anon</b> key, never the service key.
          </p>
        </div>
      </div>
    )
  }

  if (session === undefined) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>
  }

  if (!session) return <AdminLogin />

  if (locked && enrolled) {
    return <LockScreen onUnlock={() => setLocked(false)} onUsePassword={usePasswordInstead} />
  }

  return (
    <Dashboard
      email={session.user?.email}
      onSignOut={() => supabase.auth.signOut()}
      onEnrollChange={() => refreshEnrollment(!!session)}
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
  { id: 'settings', label: 'Settings', Icon: IconLock },
]

function Dashboard({ email, onSignOut, onEnrollChange }) {
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
          <span className="font-bold text-slate-800">Sporta Admin</span>
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

        {tab === 'settings' && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
            <SetupQuickUnlock onEnrolled={onEnrollChange} />
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
