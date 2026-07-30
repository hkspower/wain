import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'

// Bag → Delivery → Payment.
//
// WHY IT EXISTS
// Checkout was one long unlabelled form. On a phone that is a screen of fields
// with no visible end: the shopper cannot tell whether they are near the finish
// or a third of the way through it, and the commonest response to that is to
// stop. Three steps is the real shape of this flow — the bag they have already
// filled, the address, and the bank — so saying it out loud costs one row and
// removes the question.
//
// It is a list of states, not navigation. Only a COMPLETED step is a link
// (back to the bag); the current step is text, and a step not reached yet is
// neither clickable nor implied to be — nothing here can jump the shopper
// forward past a form that is not filled in.
//
// aria-current="step" is what a screen reader announces, and the step numbers
// are real text rather than decorative circles, so "Step 2 of 3" is available
// without sight of the row.
export default function CheckoutSteps({ current, paying = false }) {
  const { lang, t } = useLang()
  const steps = [
    { id: 'bag', label: t.flow.bag, to: '/cart' },
    { id: 'details', label: t.flow.details, to: '/checkout' },
    { id: 'pay', label: t.flow.pay },
  ]
  const at = steps.findIndex((s) => s.id === current)
  // While the browser is being handed to the bank, the last step is genuinely
  // the live one — the indicator should not still be pointing at the form.
  const active = paying ? steps.length - 1 : at

  const num = (n) => (lang === 'ar' ? String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]) : String(n))

  return (
    <nav aria-label={t.flow.step.replace('{n}', num(active + 1)).replace('{m}', num(steps.length))}>
      <ol className="flex items-center gap-2 text-sm sm:gap-3">
        {steps.map((s, i) => {
          const done = i < active
          const isNow = i === active
          const body = (
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.7rem] font-bold ${
                  done
                    ? 'bg-brand text-ink'
                    : isNow
                      ? 'bg-brand-dark text-white'
                      : 'border border-black/15 text-slate-400'
                }`}
              >
                {done ? '✓' : num(i + 1)}
              </span>
              <span
                className={`whitespace-nowrap font-semibold ${
                  // The step names are the only thing on this indicator that
                  // says WHERE you are. Measured on the seeded checkout:
                  // text-brand-dark was 3.97:1 on beige and 3.2:1 on charcoal,
                  // and the upcoming steps at text-slate-400 were 1.91:1 —
                  // effectively invisible, on a progress indicator whose whole
                  // job is telling you how much is left. The numbered circle
                  // still carries "done / now / next"; the label no longer has
                  // to be faint to say it.
                  isNow ? 'text-accent' : done ? 'text-slate-600' : 'text-slate-600'
                }`}
              >
                {s.label}
              </span>
            </span>
          )
          return (
            <li key={s.id} className="flex min-w-0 items-center gap-2 sm:gap-3">
              {/* Only a step already behind us is a way back. */}
              {done && s.to ? (
                <Link to={s.to} className="tap-row rounded-lg hover:underline">
                  {body}
                </Link>
              ) : (
                <span aria-current={isNow ? 'step' : undefined}>{body}</span>
              )}
              {/* Screen-reader-only state, so the row is not just colour. */}
              <span className="sr-only">{done ? t.flow.done : isNow ? t.flow.current : ''}</span>
              {i < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`h-px w-4 shrink-0 sm:w-8 ${done ? 'bg-brand' : 'bg-black/10'}`}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
