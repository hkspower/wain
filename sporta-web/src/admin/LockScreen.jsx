import { useEffect, useState } from 'react'
import Keypad from './Keypad'
import { getDeviceId } from '../lib/deviceId'
import { verifyDevicePasscode } from '../lib/supabase'

// Full-screen numeric lock. Shown when a Supabase session exists and a
// passcode is enrolled on this device. Calls verify_device_passcode.
export default function LockScreen({ onUnlock, onUsePassword }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)
  const [msg, setMsg] = useState('')
  const [lockedUntil, setLockedUntil] = useState(null)
  const [remaining, setRemaining] = useState(0)

  // Countdown when the device is temporarily locked out.
  useEffect(() => {
    if (!lockedUntil) return
    const tick = () => {
      const secs = Math.max(0, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 1000))
      setRemaining(secs)
      if (secs === 0) {
        setLockedUntil(null)
        setMsg('')
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lockedUntil])

  // Auto-submit on the 6th digit.
  useEffect(() => {
    if (code.length === 6 && !busy && !lockedUntil) submit(code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  async function submit(passcode) {
    setBusy(true)
    setMsg('')
    try {
      const res = await verifyDevicePasscode(getDeviceId(), passcode)
      if (res?.ok) {
        onUnlock()
        return
      }
      // Failure path
      setShake(true)
      setTimeout(() => setShake(false), 500)
      setCode('')
      if (res?.reason === 'locked') {
        setLockedUntil(res.locked_until)
        setMsg('Too many attempts. Locked temporarily.')
      } else if (typeof res?.attempts_left === 'number') {
        setMsg(`Incorrect passcode — ${res.attempts_left} attempt${res.attempts_left === 1 ? '' : 's'} left.`)
      } else {
        setMsg('Incorrect passcode.')
      }
    } catch (e) {
      setShake(true)
      setTimeout(() => setShake(false), 500)
      setCode('')
      setMsg('Could not verify. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 bg-white px-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl text-white">
          🔒
        </div>
        <h1 className="text-xl font-bold text-slate-800">Enter passcode</h1>
        <p className="mt-1 text-sm text-slate-500">Sporta Admin</p>
      </div>

      <Keypad
        value={code}
        onChange={setCode}
        onSubmit={() => code.length === 6 && submit(code)}
        shake={shake}
        disabled={busy || !!lockedUntil}
      />

      <div className="h-6 text-center text-sm">
        {lockedUntil ? (
          <span className="font-semibold text-rose-600">
            Try again in {mm}:{ss}
          </span>
        ) : (
          <span className="text-rose-600">{msg}</span>
        )}
      </div>

      <button
        onClick={onUsePassword}
        className="text-sm font-semibold text-indigo-600 underline underline-offset-4"
      >
        Use password instead
      </button>
    </div>
  )
}
