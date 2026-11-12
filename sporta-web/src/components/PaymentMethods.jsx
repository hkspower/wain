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
// The METHOD IDS below are the contract with the server: api.php validates new
// orders against STORE_CUSTOMER_PAY_METHODS (knet, cod: T-Pay was retired as a
// customer method, 2026-11-03), and orders.payment_method keeps tpay for history.
// The `options` list here is the only one of them in the front end.
export default function PaymentMethods({ value, onChange, methods = null, className = '', legendClassName = '' }) {
  const { t } = useLang()
  // `methods` is the server's list (checkout_config). Until it answers, only cash on delivery is offered: it is the one
  // method that never depends on a bank, so the page never shows KNET as a choice the server would then refuse.
  const offered = methods ?? ['cod']
  const all = [
    ['knet', t.checkout.methodKnet, t.checkout.methodKnetHint],
    ['cod', t.checkout.methodCod, t.checkout.methodCodHint],
  ]
  const options = all.filter(([id]) => offered.includes(id))

  return (
    <fieldset className={className}>
      <legend className={legendClassName}>{t.checkout.payWith}</legend>
      <div className="mt-2 space-y-2">
        {options.length === 0 && (
          <p role="status" className="rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
            {t.checkout.noMethods}
          </p>
        )}
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
              <span className="block text-sm leading-snug text-slate-600">{hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
