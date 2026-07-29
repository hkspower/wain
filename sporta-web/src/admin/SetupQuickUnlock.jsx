import { useState } from 'react'
import Keypad from './Keypad'
import { getDeviceId, markEnrolled, isEnrolledLocally } from '../lib/deviceId'
import { setDevicePasscode } from '../lib/supabase'

// Enrollment card for the admin Settings page. Visible only to a logged-in
// admin (the parent renders it inside an authenticated route). Prompts for a
// 6-digit code twice, then calls set_device_passcode.
// Turns the database's error codes into something a shop owner can act on.
// set_device_passcode refuses obvious codes on purpose — six identical digits
// and straight runs are the whole top of every leaked-PIN list — and the raw
// SQLSTATE message ("passcode_too_obvious") explains nothing on its own.
const MESSAGES = {
  not_admin:
    'This account is not on the admin allowlist, so it cannot set a passcode.',
  passcode_must_be_6_digits: 'The passcode must be exactly 6 digits.',
  passcode_too_obvious:
    'That code is too easy to guess — 111111, 123456 and the like are the first codes anyone tries. Pick something else.',
  device_id_required: 'This browser could not identify itself. Check that it allows local storage.',
}

function explain(e) {
  const raw = `${e?.message || ''}`
  for (const key of Object.keys(MESSAGES)) if (raw.includes(key)) return MESSAGES[key]
  return raw || 'Could not save passcode.'
}

export default function SetupQuickUnlock({ defaultLabel = '', onEnrolled, onLockNow, canLock }) {
  const [step, setStep] = useState(isEnrolledLocally() ? 'done' : 'idle') // idle | first | confirm | done
  const [first, setFirst] = useState('')
  const [code, setCode] = useState('')
  const [label, setLabel] = useState(defaultLabel)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reset = () => {
    setFirst('')
    setCode('')
    setError('')
    setStep('idle')
  }

  async function finish(confirmCode) {
    setBusy(true)
    setError('')
    try {
      await setDevicePasscode(getDeviceId(), confirmCode, label || 'This device')
      markEnrolled()
      onEnrolled?.()
      setStep('done')
    } catch (e) {
      setError(explain(e))
      setStep('first')
      setFirst('')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  // advance from first -> confirm
  const onFirstComplete = (v) => {
    setFirst(v)
    setCode('')
    setStep('confirm')
  }
  // confirm matches?
  const onConfirmComplete = (v) => {
    if (v !== first) {
      setError('Codes did not match. Try again.')
      setFirst('')
      setCode('')
      setStep('first')
      return
    }
    finish(v)
  }

  return (
    <div className="max-w-md rounded-2xl border border-slate-200 p-6">
      <h3 className="text-lg font-bold text-slate-800">Quick unlock</h3>
      <p className="mt-1 text-sm text-slate-500">
        Set a 6-digit passcode to unlock the admin on this device without typing your password each time.
      </p>

      {/* Said plainly, because the word "passcode" invites the belief that this
          is a second lock on the door. It is not. It re-locks a session that is
          already signed in — it stops someone picking up an unlocked laptop,
          and it does nothing against someone who has the password. */}
      <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
        <b className="text-slate-600">What this is:</b> a quick re-lock over a session you are
        already signed into — like your phone's screen lock. It protects the admin from anyone who
        picks up this device. It is <b>not</b> a second password and not two-factor
        authentication, so keep your Supabase password strong.
      </p>

      {step === 'done' && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
            ✓ Enabled on this device
          </span>
          <button onClick={reset} className="text-sm font-semibold text-indigo-600 underline">
            Change code
          </button>
          {canLock && (
            <button onClick={onLockNow} className="text-sm font-semibold text-slate-500 underline">
              Lock now
            </button>
          )}
        </div>
      )}

      {step === 'idle' && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-slate-600">
            Device label
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Sara's iPhone"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </label>
          <button
            onClick={() => setStep('first')}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Set up quick unlock
          </button>
        </div>
      )}

      {(step === 'first' || step === 'confirm') && (
        <div className="mt-6 flex flex-col items-center gap-6">
          <p className="text-sm font-medium text-slate-600">
            {step === 'first' ? 'Enter a new 6-digit code' : 'Re-enter to confirm'}
          </p>
          {step === 'first' && (
            <p className="-mt-4 text-xs text-slate-400">
              Not 111111, not 123456 — the server refuses those.
            </p>
          )}
          <Keypad
            key={step}
            value={code}
            onChange={(v) => {
              setCode(v)
              if (v.length === 6) (step === 'first' ? onFirstComplete : onConfirmComplete)(v)
            }}
            disabled={busy}
          />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button onClick={reset} className="text-sm text-slate-500 underline">
            Cancel
          </button>
        </div>
      )}

      {error && step === 'idle' && <p className="mt-3 text-sm text-rose-600">{error}</p>}
    </div>
  )
}
