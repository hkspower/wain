import { useCallback, useEffect, useState } from 'react'
import { listDevices, revokeDevice, isNotAdminError } from '../lib/supabase'
import { getDeviceId, clearEnrolled } from '../lib/deviceId'
import { Notice } from './Overview'

// Enrolled quick-unlock devices, with a way to remove one.
//
// WHY THIS SCREEN EXISTS
// Until now there was no list and no delete, so a lost or sold phone stayed
// enrolled until somebody opened the Supabase SQL editor — which in practice
// means it stayed enrolled. The passcode is only worth anything if it can be
// taken away, so revoking is a button here, not a query.
//
// No hashes ever reach the browser: admin_list_devices() returns the label, the
// owner's email and the timestamps, and nothing else.
export default function Devices() {
  const [state, setState] = useState({ loading: true, rows: [] })
  const [busyId, setBusyId] = useState(null)
  const mine = typeof localStorage === 'undefined' ? '' : getDeviceId()

  const load = useCallback(async () => {
    try {
      const rows = await listDevices()
      setState({ loading: false, rows })
    } catch (e) {
      setState({
        loading: false,
        rows: [],
        // A missing function means the hardening migration has not been run.
        needsMigration: /function|schema cache|does not exist/i.test(e?.message || ''),
        notAdmin: isNotAdminError(e),
        error: e?.message,
      })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function revoke(row) {
    const isThisOne = row.device_id === mine
    const what = row.label || 'this device'
    if (
      !window.confirm(
        isThisOne
          ? `Remove quick unlock from THIS device (${what})?\n\nYou will stay signed in, but you will need your password next time.`
          : `Remove quick unlock from ${what}?\n\nThat device will need the password again.`,
      )
    )
      return
    setBusyId(row.device_id)
    try {
      await revokeDevice(row.device_id)
      // The local hint would otherwise keep claiming this browser is enrolled
      // and show a lock screen with no passcode behind it.
      if (isThisOne) clearEnrolled()
      await load()
    } catch (e) {
      setState((s) => ({ ...s, error: e?.message || 'Could not remove the device.' }))
    } finally {
      setBusyId(null)
    }
  }

  if (state.loading) {
    return <div className="h-24 max-w-2xl rounded-2xl bg-slate-100" aria-busy="true" />
  }

  if (state.notAdmin) return null // the parent already says why

  if (state.needsMigration) {
    return (
      <Notice tone="warn" title="Device list needs a database update">
        Run <code className="rounded bg-amber-100 px-1 font-mono text-[.85em]">supabase/SETUP-ALL.sql</code>{' '}
        in the Supabase SQL editor. Until then, enrolled devices cannot be listed or removed here.
      </Notice>
    )
  }

  return (
    <section className="max-w-2xl rounded-2xl border border-slate-200 p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-lg font-bold text-slate-800">Devices with quick unlock</h3>
        <button onClick={load} className="text-sm font-semibold text-indigo-600 underline">
          Refresh
        </button>
      </div>

      {state.error && <p className="mt-2 text-sm text-rose-600">{state.error}</p>}

      {state.rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No device has a quick-unlock passcode yet. Every sign-in uses the password.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {state.rows.map((row) => {
            const isThisOne = row.device_id === mine
            const lockedNow = row.locked_until && new Date(row.locked_until) > new Date()
            return (
              <li key={row.device_id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                    {row.label || 'Unnamed device'}
                    {isThisOne && (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600">
                        This device
                      </span>
                    )}
                    {lockedNow && (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600">
                        Locked out
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {row.owner_email || (row.mine ? 'you' : 'owner unknown — enrolled before ownership was recorded')}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {row.last_used_at
                      ? `Last unlocked ${when(row.last_used_at)}`
                      : 'Never used since it was set'}
                    {row.created_at && ` · added ${when(row.created_at)}`}
                  </p>
                </div>
                <button
                  onClick={() => revoke(row)}
                  disabled={busyId === row.device_id}
                  className="shrink-0 rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  {busyId === row.device_id ? 'Removing…' : 'Remove'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// Dates only — the exact minute of an unlock is noise, and "3 days ago" is what
// the reader is actually deciding on.
function when(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return 'unknown'
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
