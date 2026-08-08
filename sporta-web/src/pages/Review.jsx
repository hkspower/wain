import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { phpBase } from '../lib/backend'

// "How did we do?" — reached only from a signed link the shop sent.
//
// THE OFFER IS FOR REVIEWING **SPORTA**. Google's policy forbids paying for a
// Google review, and it enforces that by deleting the reviews and, at its
// discretion, suspending the Business Profile — so a shop that buys fifty and
// loses all fifty plus its listing is worse off than one that never asked. The
// discount is earned here, in full, before Google is ever mentioned. The link
// to Google appears only on the thank-you screen, with nothing attached to it.
//
// AND EVERY RATING PAYS THE SAME. One star earns exactly what five does. That
// is not generosity, it is the difference between a rating the shop can act on
// and a number that has had its unhappy customers filtered out of it.
export default function Review() {
  const { t, lang } = useLang()
  const T = t.rate
  const [params] = useSearchParams()
  const track = params.get('o') ?? ''
  const token = params.get('t') ?? ''

  const [state, setState] = useState('loading')  // loading | form | done | invalid
  const [invite, setInvite] = useState(null)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [code, setCode] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!track || !token) { setState('invalid'); return }
      try {
        const res = await fetch(
          `${phpBase()}/api.php?r=review_invite&o=${encodeURIComponent(track)}&t=${encodeURIComponent(token)}`,
        )
        const d = await res.json()
        if (!alive) return
        if (!res.ok || d?.error) { setState('invalid'); return }
        setInvite(d)
        // Already reviewed — show them the code again rather than a form they
        // cannot submit. A person who lost the message and clicked the link a
        // second time is the likeliest visitor here.
        if (d.reviewed) { setCode(d.code); setState('done') }
        else setState('form')
      } catch {
        if (alive) setState('invalid')
      }
    })()
    return () => { alive = false }
  }, [track, token])

  async function submit(e) {
    e.preventDefault()
    if (!rating || busy) return
    setBusy(true)
    try {
      const res = await fetch(`${phpBase()}/api.php?r=review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: track, token, rating, comment, lang }),
      })
      const d = await res.json()
      if (res.ok && d?.ok) { setCode(d.code); setState('done') }
      else setState('invalid')
    } catch {
      setState('invalid')
    }
    setBusy(false)
  }

  if (state === 'loading') {
    return <Shell><p className="text-slate-500">{T.loading}</p></Shell>
  }

  if (state === 'invalid') {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-ink dark:text-white">{T.invalidTitle}</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">{T.invalidBody}</p>
      </Shell>
    )
  }

  if (state === 'done') {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-ink dark:text-white">{T.thanksTitle}</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">{T.thanksBody}</p>

        {code ? (
          <div className="mt-6 rounded-2xl border-2 border-dashed border-brand bg-brand/5 p-5 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {T.codeLabel.replace('{pct}', invite?.reward_pct ?? 20)}
            </p>
            {/* Read off a phone and typed into a box: big, monospaced, and
                selectable in one tap. */}
            <p className="mt-2 select-all font-mono text-2xl font-bold tracking-widest text-ink dark:text-white">
              {code}
            </p>
            <p className="mt-2 text-xs text-slate-500">{T.codeNote}</p>
          </div>
        ) : (
          // The review saved but no code could be issued. Say so plainly rather
          // than showing an empty box — and never imply a discount that does
          // not exist.
          <p className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{T.codeFailed}</p>
        )}

        {/* GOOGLE, AFTER THE FACT AND UNPAID. The code above is already theirs
            and says nothing about this link; that is exactly what keeps the
            invitation inside Google's rules. No reward is mentioned, and
            nothing here checks whether they went. */}
        {T.googleUrl && (
          <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-700">
            <p className="text-sm text-slate-600 dark:text-slate-300">{T.googleAsk}</p>
            <a
              href={T.googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline mt-3 inline-block px-4 py-2 text-sm"
            >
              {T.googleCta}
            </a>
          </div>
        )}
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-xl font-bold text-ink dark:text-white">
        {invite?.name ? T.titleNamed.replace('{name}', invite.name) : T.title}
      </h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        {T.subtitle.replace('{pct}', invite?.reward_pct ?? 20)}
      </p>
      <p className="mt-1 font-mono text-xs text-slate-400">{invite?.track_id}</p>

      <form onSubmit={submit} className="mt-6">
        <Stars value={rating} onChange={setRating} T={T} />

        <label className="mt-6 block">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{T.commentLabel}</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            rows={4}
            placeholder={T.commentPlaceholder}
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </label>

        <button
          type="submit"
          disabled={!rating || busy}
          className="btn btn-primary mt-5 w-full py-3 disabled:opacity-40"
        >
          {busy ? T.sending : T.submit}
        </button>
        {/* Said before they choose, so a one-star review is given as freely as
            a five-star one. If this promise is not visible the customer assumes
            the usual arrangement and rates up to earn the code. */}
        <p className="mt-3 text-center text-xs text-slate-500">{T.anyRating}</p>
      </form>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        {children}
      </div>
    </main>
  )
}

// Five buttons, not a slider and not a radio group with tiny targets.
//
// Each star is a real <button> with its own label, so it is reachable by
// keyboard and announced properly — "4 out of 5" rather than "star, star,
// star, star". aria-pressed carries the current choice.
function Stars({ value, onChange, T }) {
  return (
    <div className="flex justify-center gap-2" role="group" aria-label={T.ratingLabel}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={T.starLabel.replace('{n}', n)}
          aria-pressed={value === n}
          className={`tap-target rounded-xl px-1 text-4xl transition ${
            n <= value ? 'text-brand' : 'text-slate-300 hover:text-brand/50 dark:text-slate-600'
          }`}
        >
          ★
        </button>
      ))}
    </div>
  )
}
