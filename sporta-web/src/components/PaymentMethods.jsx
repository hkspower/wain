import { useLang } from '../i18n/LanguageContext'

// How the customer chooses to pay.
//
// One component, rendered by both the full checkout and the two-tap quick
// checkout. It was the same forty lines of markup copied into both, which
// meant every one of these decisions had two homes:
//
//   * a RADIO GROUP rather than a dropdown, because each option's consequence
//     has to be readable without a tap — "pay now on the bank's page" versus
//     "pay the driver" is the whole decision, and a <select> hides it;
//   * the whole <label> is the target, not just the 20px circle, and
//     `.tap-row` gives it the 44px minimum height that Apple's HIG and
//     WCAG 2.5.5 both ask for;
//   * a real <fieldset>/<legend>, so a screen reader announces the question
//     before the three answers instead of reading three unrelated radios.
//
// The METHOD IDS are the contract with the server: api.php validates them
// against STORE_PAY_METHODS and orders.payment_method has a CHECK constraint
// on the same three. Adding a fourth means changing all three places, and this
// is now the only one of them in the front end.
export const PAY_METHODS = ['knet', 'tpay', 'cod']

export default function PaymentMethods({ value, onChange, className = '', legendClassName = '' }) {
  const { t } = useLang()
  const options = [
    ['knet', t.checkout.methodKnet, t.checkout.methodKnetHint],
    ['tpay', t.checkout.methodTpay, t.checkout.methodTpayHint],
    ['cod', t.checkout.methodCod, t.checkout.methodCodHint],
  ]

  return (
    <fieldset className={className}>
      <legend className={legendClassName}>{t.checkout.payWith}</legend>
      <div className="mt-2 space-y-2">
        {options.map(([id, label, hint]) => (
          <label
            key={id}
            className={`tap-row flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
              value === id ? 'border-brand bg-brand/5' : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="paymethod"
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">{label}</span>
              <span className="block text-xs leading-snug text-slate-600">{hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
