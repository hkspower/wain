import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'
import { phpBase } from '../lib/backend'

// سبورتا AI — the conversation itself.
//
// LAZY BY DESIGN, and the budget is the reason rather than tidiness. The home
// page measures 172 kB of images against a 175 kB budget on a phone, and the
// JavaScript is at its own limit; a chat panel loaded by every visitor whether
// or not they open it would spend that headroom on a feature most of them
// never touch. Only the launcher button ships in the main bundle. This file
// arrives on the first click and never before it.
//
// WHAT IT WILL NOT DO
// It renders what the server said and nothing else. There is no client-side
// cleverness about order states, no cached "last known status", no optimistic
// text — the answer to "where is my order" comes from one place, the database,
// and passing it through a second opinion in the browser is how two different
// answers to the same question start existing.
export default function AssistantPanel({ onClose }) {
  const { t, lang } = useLang()
  const T = t.assistant
  const ar = lang === 'ar'
  const cart = useCart()
  const navigate = useNavigate()
  const [log, setLog] = useState([{ from: 'ai', text: T.greeting }])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  // Hands-free: the reply is READ ALOUD when the question was ASKED ALOUD.
  // It is deliberately not a setting the visitor has to find and turn on —
  // speaking to a shop and being answered in silent text is the wrong shape,
  // and typing to it and being shouted at in an open-plan office is the other
  // wrong shape. The way the question arrived decides.
  const [handsFree, setHandsFree] = useState(false)
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [log, busy])

  // Escape closes it, and focus goes back where it came from — the panel is a
  // dialog, and a dialog you cannot leave by keyboard is a trap.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // `spoken` says the question arrived by microphone, which decides two things:
  // whether the answer is read back, and — the part browsers care about —
  // whether it is ALLOWED to be. Autoplay is gated on a user gesture, and the
  // mic tap is that gesture; a reply to a typed question has none, so it would
  // be silently blocked and look broken.
  async function send(text, spoken = false) {
    const msg = (text ?? draft).trim()
    if (!msg || busy) return
    if (spoken) setHandsFree(true)
    setDraft('')
    setLog((l) => [...l, { from: 'me', text: msg }])
    setBusy(true)
    try {
      const res = await fetch(`${phpBase()}/api.php?r=assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, lang }),
      })
      const d = await res.json()
      // A 429 is the throttle, and it deserves its own sentence rather than
      // the generic failure — the shop is fine, the visitor is just fast.
      if (res.status === 429) setLog((l) => [...l, { from: 'ai', text: T.tooFast }])
      else if (!d?.reply) setLog((l) => [...l, { from: 'ai', text: T.failed }])
      // `auto` is consumed once, by the Speaker that renders for this message.
      // It is stamped on the message rather than read from state at play time
      // so that turning hands-free off does not retroactively silence a reply
      // that is already mid-sentence.
      else setLog((l) => [...l, {
        from: 'ai', text: d.reply, data: d.data, speak: d.speak,
        auto: spoken || handsFree,
      }])
    } catch {
      // Offline, or /api not reachable. Say so, and point at a human — the one
      // thing worse than no answer is a spinner that never resolves.
      setLog((l) => [...l, { from: 'ai', text: T.failed }])
    }
    setBusy(false)
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={T.title}
      className="fixed bottom-24 z-50 flex max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl end-4 dark:border-slate-700 dark:bg-slate-900"
    >
      <header className="flex items-center gap-3 border-b border-slate-200 bg-ink px-4 py-3 dark:border-slate-700">
        <img src="/favicon-192.png" alt="" width="192" height="192" className="h-7 w-7" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-white">{T.title}</span>
          <span className="block text-[11px] text-white/60">{T.subtitle}</span>
        </span>
        <button onClick={onClose} aria-label={T.close}
          className="tap-target rounded-lg px-2 py-1 text-white/70 hover:text-white">✕</button>
      </header>

      {/* aria-live so a screen reader hears the answer arrive. `polite`, not
          `assertive`: it must not interrupt someone mid-sentence. */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {log.map((m, i) => (
          <div key={i} className={m.from === 'me' ? 'text-end' : ''}>
            <div className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
              m.from === 'me'
                ? 'bg-brand text-ink'
                : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'}`}>
              {m.text}
            </div>
            {m.from === 'ai' && m.speak && <Speaker text={m.text} sig={m.speak} lang={lang} T={T} auto={m.auto} />}
            {m.data?.kind === 'order' && <OrderCard d={m.data} T={T} ar={ar} />}
            {m.data?.kind === 'products' && <ProductRow items={m.data.items} T={T} cart={cart} ar={ar} />}
          </div>
        ))}
        {busy && <p className="text-sm text-slate-400">{T.thinking}</p>}
        <div ref={endRef} />
      </div>

      {/* The bag bar — the AI's route to a completed order. It fills the REAL
          cart (same store the whole shop uses) and hands off to the normal,
          fully-validated checkout, where the server prices every line and
          collects the address and payment. The assistant never prices and
          never places the order itself; it only gets the shopper to the door. */}
      {cart.count > 0 && (
        <button
          type="button"
          onClick={() => { onClose(); navigate('/checkout') }}
          className="btn btn-primary mx-3 mb-1 mt-1 flex items-center justify-center gap-2 py-2 text-sm"
        >
          {T.reviewBag.replace('{n}', cart.count)}
        </button>
      )}

      {/* The starters exist because an empty box invites nothing. They are the
          four questions the shop is actually asked. */}
      {log.length < 2 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {T.starters.map((s) => (
            <button key={s} onClick={() => send(s)}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-brand hover:text-brand dark:border-slate-600 dark:text-slate-300">
              {s}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); send() }}
        className="flex gap-2 border-t border-slate-200 p-3 dark:border-slate-700">
        <Mic lang={lang} T={T} disabled={busy}
             onHeard={(said) => send(said, true)}
             onDenied={() => setLog((l) => [...l, { from: 'ai', text: T.micDenied }])} />
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
          placeholder={T.placeholder}
          aria-label={T.placeholder}
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
        <button type="submit" disabled={busy || !draft.trim()}
          className="btn btn-primary shrink-0 px-4 py-2 text-sm disabled:opacity-40">{T.send}</button>
      </form>
    </div>
  )
}

// The speaker button.
//
// It appears only when the server sent a `speak` signature, i.e. only when a
// voice is actually configured on this installation. No signature, no button —
// rather than a button that plays silence and looks broken.
//
// The audio is fetched by URL, not by XHR, so the browser's HTTP cache holds
// it: the shop's fixed answers (delivery, returns, payment) are the same mp3
// every time and are paid for once, upstream and downstream both.
// `auto` plays it the moment it arrives — the hands-free half of a call. It is
// only ever set on a reply to a SPOKEN question, because that is the only case
// where a user gesture exists for the browser's autoplay policy to be satisfied
// by. Set it on a typed reply and the play() promise rejects: no sound, no
// error the visitor can see, and a feature that looks broken on some browsers
// and not others.
function Speaker({ text, sig, lang, T, auto = false }) {
  const ref = useRef(null)
  const [playing, setPlaying] = useState(false)

  // Stop when the panel closes or the message scrolls out of existence. An
  // Arabic sentence still talking after the window is shut is a bug people
  // remember.
  useEffect(() => () => ref.current?.pause(), [])

  function toggle() {
    if (playing) { ref.current?.pause(); setPlaying(false); return }
    const url = `${phpBase()}/api.php?r=say&lang=${lang}`
      + `&v=${sig}&t=${encodeURIComponent(text)}`
    const a = ref.current ?? new Audio(url)
    ref.current = a
    a.onended = () => setPlaying(false)
    // A 403/502 from the voice endpoint must not become a broken-looking chat.
    // The words are already on screen; losing the audio loses nothing.
    a.onerror = () => setPlaying(false)
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  // Once, on arrival. The empty-ish dependency list is deliberate: re-running
  // this on every render would restart the sentence each time the panel
  // re-renders, which it does on every keystroke in the box below.
  useEffect(() => { if (auto) toggle() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <button
      onClick={toggle}
      aria-label={playing ? T.stopAudio : T.listen}
      className="tap-target mt-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-brand"
    >
      {playing ? '■' : '🔊'}
    </button>
  )
}

// The microphone — the caller's half of the call.
//
// ON-DEVICE, AND THAT IS THE WHOLE ARGUMENT. The browser's own SpeechRecognition
// does the transcription; no audio is uploaded, the shop pays nothing per
// utterance, and there is no third party in the path holding a recording of a
// customer reading out an order number. A server-side speech-to-text endpoint
// would be all three of those problems at once, and — exactly like the text-to-
// speech seam next door — an open audio-upload endpoint billed to this shop.
//
// IT RENDERS NOTHING WHERE IT DOES NOT WORK. Firefox has no SpeechRecognition
// at all. A mic button that is present and dead is worse than no mic button:
// the visitor taps it, nothing happens, and they conclude the shop is broken
// rather than that their browser lacks a feature they never knew about.
//
// ar-KW, not ar: dialect matters to recognition as much as it does to the
// voice. "وين طلبي" is not Modern Standard Arabic and is the actual sentence
// people say.
function Mic({ lang, T, disabled, onHeard, onDenied }) {
  const [listening, setListening] = useState(false)
  const ref = useRef(null)

  const Rec = typeof window !== 'undefined'
    && (window.SpeechRecognition || window.webkitSpeechRecognition)

  // Stop the moment the panel goes away. A recogniser left running holds the
  // microphone open, and the browser shows a recording indicator for a page
  // that is no longer listening to anything.
  useEffect(() => () => { try { ref.current?.abort() } catch { /* already gone */ } }, [])

  if (!Rec) return null

  function toggle() {
    if (listening) { try { ref.current?.stop() } catch { /* mid-teardown */ } return }

    const r = new Rec()
    ref.current = r
    r.lang = lang === 'ar' ? 'ar-KW' : 'en-US'
    // One question at a time. `continuous` would keep the mic open through the
    // reply and hear the shop's OWN VOICE as the next question — a loop that
    // costs money on every turn and never ends on its own.
    r.continuous = false
    r.interimResults = false
    r.maxAlternatives = 1

    r.onresult = (e) => {
      const said = e.results?.[0]?.[0]?.transcript?.trim() ?? ''
      if (said) onHeard(said)
    }
    r.onerror = (e) => {
      setListening(false)
      // A refused permission is a decision, and it deserves a sentence. The
      // rest — 'no-speech', 'aborted', a network blip — is noise: the visitor
      // simply says nothing, and the box below still takes typing.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') onDenied()
    }
    r.onend = () => setListening(false)

    try { r.start(); setListening(true) } catch { setListening(false) }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-label={listening ? T.listening : T.speak}
      aria-pressed={listening}
      className={`tap-target shrink-0 rounded-xl border px-3 py-2 text-sm disabled:opacity-40 ${
        listening
          ? 'animate-pulse border-brand bg-brand text-ink'
          : 'border-slate-300 text-slate-500 hover:border-brand hover:text-brand dark:border-slate-600 dark:text-slate-300'}`}
    >
      {listening ? '●' : '🎙'}
    </button>
  )
}

// The order, as a card rather than a sentence. A tracking number and a state
// are things people scan for, and a paragraph makes them read.
function OrderCard({ d, T, ar }) {
  const stage = T.stages[d.stage] ?? d.stage
  return (
    <div className="mt-2 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700">
      <div className="font-mono font-bold">{d.track}</div>
      <dl className="mt-2 grid grid-cols-2 gap-1 text-slate-600 dark:text-slate-300">
        <dt>{T.amount}</dt><dd className="text-end font-semibold">{d.amount} {ar ? 'د.ك' : 'KWD'}</dd>
        <dt>{T.payment}</dt><dd className="text-end font-semibold">{d.paid ? T.paid : T.unpaid}</dd>
        <dt>{T.stageLabel}</dt><dd className="text-end font-semibold">{stage}</dd>
      </dl>
      <Link to={`/track?id=${d.track}`} className="mt-2 inline-block font-semibold text-brand">{T.viewOrder}</Link>
    </div>
  )
}

function ProductRow({ items, T, cart, ar }) {
  return (
    <div className="mt-2 space-y-1">
      {items.map((p) => (
        <div key={p.slug}
          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
          <Link to={`/product/${p.slug}`} className="min-w-0 flex-1 truncate hover:text-brand">
            {p.name}
          </Link>
          <span className="shrink-0 font-bold">{p.price} {ar ? 'د.ك' : 'KWD'}</span>
          <BuyButton p={p} T={T} cart={cart} />
        </div>
      ))}
    </div>
  )
}

// One product's call to action. A garment with sizes cannot be added blind —
// create_order refuses a size-less line — so it links to the product page to
// pick one. A size-less item (an accessory) is added straight to the bag, and
// the button confirms it rather than silently doing nothing.
function BuyButton({ p, T, cart }) {
  const [added, setAdded] = useState(false)

  if (p.has_sizes) {
    return (
      <Link to={`/product/${p.slug}`}
        className="shrink-0 rounded-lg border border-brand px-2 py-1 font-semibold text-brand hover:bg-brand hover:text-ink">
        {T.chooseSize}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={() => {
        // price is for display only; create_order re-prices from the database.
        cart.add({ slug: p.slug, name: p.name, price: p.price_kwd, image: p.image }, 1)
        setAdded(true)
      }}
      disabled={added}
      className="shrink-0 rounded-lg bg-brand px-2 py-1 font-semibold text-ink disabled:opacity-60"
    >
      {added ? T.added : T.addToBag}
    </button>
  )
}
