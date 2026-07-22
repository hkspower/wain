import { useEffect, useRef } from 'react'

// Mobile-first numeric keypad for 6-digit passcodes.
// - big tap targets, inputMode numeric, autofocus on the hidden input
// - auto-submit handled by the parent when length hits `max`
// - `shake` prop triggers the error animation + haptic feedback
export default function Keypad({ value, onChange, onSubmit, max = 6, shake = false, disabled = false }) {
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (shake && navigator.vibrate) navigator.vibrate([40, 60, 40])
  }, [shake])

  const push = (d) => {
    if (disabled) return
    if (value.length >= max) return
    onChange((value + d).slice(0, max))
  }
  const backspace = () => onChange(value.slice(0, -1))

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

  return (
    <div className={`flex flex-col items-center gap-8 ${shake ? 'animate-shake' : ''}`}>
      {/* Dots */}
      <div className="flex gap-3">
        {Array.from({ length: max }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border-2 transition ${
              i < value.length ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'
            }`}
          />
        ))}
      </div>

      {/* Hidden real input keeps mobile keyboards / autofill sane and autofocus */}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, max))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.length === max) onSubmit?.()
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={max}
        className="sr-only"
        aria-label="Passcode"
      />

      {/* On-screen keypad */}
      <div className="grid grid-cols-3 gap-4">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => push(k)}
            disabled={disabled}
            className="h-20 w-20 rounded-full bg-slate-100 text-2xl font-semibold text-slate-800 transition active:scale-95 active:bg-indigo-100 disabled:opacity-50"
          >
            {k}
          </button>
        ))}
        <span />
        <button
          type="button"
          onClick={() => push('0')}
          disabled={disabled}
          className="h-20 w-20 rounded-full bg-slate-100 text-2xl font-semibold text-slate-800 transition active:scale-95 active:bg-indigo-100 disabled:opacity-50"
        >
          0
        </button>
        <button
          type="button"
          onClick={backspace}
          disabled={disabled}
          className="h-20 w-20 rounded-full text-lg font-medium text-slate-500 transition active:scale-95 disabled:opacity-50"
          aria-label="Delete"
        >
          ⌫
        </button>
      </div>
    </div>
  )
}
