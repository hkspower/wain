import { useState } from 'react'
import Keypad from './Keypad'
import { getDeviceId, markEnrolled, isEnrolledLocally } from '../lib/deviceId'
import { setDevicePasscode } from '../lib/supabase'

// Enrollment card for the admin Settings page. Visible only to a logged-in
// admin (the parent renders it inside an authenticated route). Prompts for a
// 6-digit code twice, then calls set_device_passcode.
export default function SetupQuickUnlock({ defaultLabel = '', onEnrolled }) {
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
      setError(e?.message || 'Could not save passcode.')
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

      {step === 'done' && (
        <div className="mt-4 flex items-center gap-3">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
            ✓ Enabled on this device
          </span>
          <button onClick={reset} className="text-sm font-semibold text-indigo-600 underline">
            Change code
          </button>
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
