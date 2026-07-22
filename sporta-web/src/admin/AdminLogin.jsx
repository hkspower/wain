import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Standard email + password login (Supabase Auth). Shown when there is no
// session, or after the user taps "Use password instead" on the lock screen.
export default function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-8">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white">
            S
          </div>
          <h1 className="text-xl font-bold text-slate-800">Sporta Admin</h1>
        </div>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="username"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500"
          required
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500"
          required
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-indigo-600 py-2 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
