import { useCallback, useEffect, useState } from 'react'
import { supabase, hasDevicePasscode } from '../lib/supabase'
import { getDeviceId, isEnrolledLocally, markEnrolled, clearEnrolled } from '../lib/deviceId'
import { useIdleLock } from './useIdleLock'
import AdminLogin from './AdminLogin'
import LockScreen from './LockScreen'
import SetupQuickUnlock from './SetupQuickUnlock'
import Products from './Products'

// Orchestrates the admin session:
//   no session            -> AdminLogin
//   session + enrolled     -> LockScreen until unlocked (also re-locks on idle)
//   session + unlocked     -> Dashboard
export default function AdminApp() {
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

  if (!supabase) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center text-slate-500">
        Admin is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.
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

  return <Dashboard onSignOut={() => supabase.auth.signOut()} onEnrollChange={() => refreshEnrollment(!!session)} />
}

// Responsive admin: desktop sidebar (hidden < 768px) + mobile sticky header and
// bottom tab bar (.m-header / .m-tabbar from admin-mobile.css). Data tables show
// as .admin-table on desktop and .m-list/.m-row card rows on mobile.
const ADMIN_TABS = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'products', label: 'Products', icon: '📦' },
  { id: 'orders', label: 'Orders', icon: '🧾' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

// Sample rows so the table→card behaviour is visible. Replace with real data.
const SAMPLE_ORDERS = [
  { track: 'SP1A2B', customer: 'Ahmad', amount: '18.500', status: 'paid' },
  { track: 'SP3C4D', customer: 'Sara', amount: '9.750', status: 'pending' },
  { track: 'SP5E6F', customer: 'Yousef', amount: '42.000', status: 'failed' },
]

function Dashboard({ onSignOut, onEnrollChange }) {
  const [tab, setTab] = useState('overview')

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
              <span className="me-2">{tb.icon}</span>
              {tb.label}
            </button>
          ))}
          <button onClick={onSignOut} className="mt-2 rounded-lg px-3 py-2 text-start text-sm font-semibold text-slate-400 hover:text-rose-600">
            Sign out
          </button>
        </nav>
      </aside>

      {/* Mobile sticky header */}
      <header className="m-header">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">S</span>
        <span className="m-header__title">{ADMIN_TABS.find((t) => t.id === tab)?.label}</span>
        <button onClick={onSignOut} className="text-sm font-semibold text-slate-400">Sign out</button>
      </header>

      <main className="admin-content flex-1 px-4 py-6 md:px-8 md:py-10">
        {tab === 'overview' && (
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
            <p className="mt-2 text-slate-500">Your admin content goes here.</p>
          </div>
        )}

        {tab === 'products' && <Products />}

        {tab === 'orders' && <OrdersView orders={SAMPLE_ORDERS} />}

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
            <span className="m-tabbar__icon">{tb.icon}</span>
            {tb.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

// Orders: real <table> on desktop (.admin-table), card rows on mobile (.m-list).
function OrdersView({ orders }) {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800">Orders</h1>

      <table className="admin-table w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-start text-slate-500">
            <th className="py-2 text-start font-semibold">Track ID</th>
            <th className="py-2 text-start font-semibold">Customer</th>
            <th className="py-2 text-start font-semibold">Amount</th>
            <th className="py-2 text-start font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.track} className="border-b border-slate-100">
              <td className="py-3 font-mono">{o.track}</td>
              <td className="py-3">{o.customer}</td>
              <td className="py-3">{o.amount} KWD</td>
              <td className="py-3">
                <span className={`m-row__badge m-row__badge--${o.status}`}>{o.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="m-list">
        {orders.map((o) => (
          <div key={o.track} className="m-row">
            <div className="m-row__top">
              <span className="m-row__title">{o.customer}</span>
              <span className={`m-row__badge m-row__badge--${o.status}`}>{o.status}</span>
            </div>
            <div className="m-row__meta">
              <span className="font-mono">{o.track}</span> · {o.amount} KWD
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
