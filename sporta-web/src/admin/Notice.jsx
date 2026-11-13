// The coloured message box every admin screen uses for "nothing to show, and
// here is why" (a missing migration, a failed query).
//
// It lives in its own file, not in Overview.jsx where it began, because the
// screens are separate lazy chunks: eight of them imported `Notice` from
// Overview, so opening ANY tab pulled the Overview chunk in as well and the
// split saved nothing. Here it is a few hundred bytes every screen shares.
export function Notice({ tone = 'warn', title, children }) {
  const tones = {
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
    error: 'border-rose-300 bg-rose-50 text-rose-900',
    info: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  }
  return (
    // An error is announced at once (role="alert" is assertive); warn and info
    // stay polite (role="status") so they do not interrupt the reader.
    <div className={`rounded-xl border p-4 ${tones[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      {title && <p className="font-bold">{title}</p>}
      <div className="mt-1 text-sm leading-relaxed">{children}</div>
    </div>
  )
}
