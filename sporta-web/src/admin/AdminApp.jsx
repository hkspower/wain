import { useCallback, useEffect, useState } from 'react'
import { supabase, hasDevicePasscode } from '../lib/supabase'
import { getDeviceId, isEnrolledLocally, markEnrolled, clearEnrolled } from '../lib/deviceId'
import { useIdleLock } from './useIdleLock'
import AdminLogin from './AdminLogin'
import LockScreen from './LockScreen'
import SetupQuickUnlock from './SetupQuickUnlock'

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

// Placeholder dashboard — replace with the real Sporta admin screens.
// Settings hosts the "Set up quick unlock" enrollment card.
function Dashboard({ onSignOut, onEnrollChange }) {
  const [tab, setTab] = useState('overview')
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">S</span>
          <span className="font-bold text-slate-800">Sporta Admin</span>
        </div>
        <nav className="flex items-center gap-4 text-sm font-semibold">
          <button onClick={() => setTab('overview')} className={tab === 'overview' ? 'text-indigo-600' : 'text-slate-500'}>
            Overview
          </button>
          <button onClick={() => setTab('settings')} className={tab === 'settings' ? 'text-indigo-600' : 'text-slate-500'}>
            Settings
          </button>
          <button onClick={onSignOut} className="text-slate-400 hover:text-rose-600">
            Sign out
          </button>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        {tab === 'overview' ? (
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
            <p className="mt-2 text-slate-500">Your admin content goes here.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
            <SetupQuickUnlock onEnrolled={onEnrollChange} />
          </div>
        )}
      </main>
    </div>
  )
}
