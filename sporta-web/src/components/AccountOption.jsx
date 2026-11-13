import { useLang } from '../i18n/LanguageContext'

// EASY REGISTER on the order page: "Create my account with these details". Ticking it asks for an email,
// because checkout collects none, and says what happens next. The server makes the account only for a
// guest, and only once the order is placed (api.php create_order). Nothing is created by ticking the box.
export default function AccountOption({ on, onToggle, email, onEmail, error, className = '' }) {
  const { t } = useLang()
  return (
    <div className={className}>
      <label className="flex items-start gap-3 text-sm font-semibold text-slate-800">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-brand"
        />
        <span>
          {t.checkout.accountTick}
          <span className="mt-0.5 block text-xs font-normal text-slate-600">{t.checkout.accountNote}</span>
        </span>
      </label>
      {on && (
        <div className="mt-3">
          <label htmlFor="account-email" className="mb-1 block text-sm font-semibold text-slate-800">
            {t.checkout.accountEmail}
          </label>
          <input
            id="account-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-start"
          />
          {error && <p role="alert" className="mt-1 text-sm font-semibold text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
