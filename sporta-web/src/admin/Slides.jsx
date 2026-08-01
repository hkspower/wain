import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSlides, saveSlide, deleteSlide, reorderSlides, saveSettings } from './api'
import { Notice } from './Overview'
import { IconClose, IconImage } from '../components/icons'
import { downscaleImage, ACCEPTED_ATTR } from './lib/downscaleImage'

// The home hero: the slides themselves, and how they play.
//
// THE PHOTOGRAPH NEVER TRAVELS AS A FILE. It is read in the browser,
// downscaled on a canvas and sent as a data: URL that lands in a database row
// — the same rule the brand logos follow, because an upload endpoint has to
// write into the web root and the live server already carried one of those
// (sporta-deploy.php, answering to anyone on the internet).
//
// It comes back as a URL rather than base64, though, and that difference is
// the whole reason this is affordable. A hero photograph is two orders of
// magnitude bigger than a logo; api.php?r=slide_image serves the bytes with a
// content hash in the URL and a one-year immutable cache, so the home page
// pays one cacheable request per slide — exactly what a file would have cost —
// and nothing on the server needs write access to anything.
//
// The downscale is not a nicety either. A photo off a phone is 4–12 MB; at
// 1600px and WebP it is around 200 kB, and the server caps what it will store
// anyway. This is what stops the admin hitting that cap on every save.

const MAX_EDGE = 1600
const QUALITY = 0.82

const BLANK = {
  id: 0, title_en: '', title_ar: '', subtitle_en: '', subtitle_ar: '',
  cta_label_en: '', cta_label_ar: '', cta_href: '', active: true,
  focal_x: 50, focal_y: 50, image: null, width: null, height: null,
}

const SIZES = [
  { id: 'short', label: 'Short', note: 'Compact — the catalogue starts higher up the page' },
  { id: 'tall', label: 'Tall', note: 'What the site ships with' },
  { id: 'full', label: 'Full height', note: 'Fills the screen; strongest, and pushes everything below the fold' },
]

export default function Slides() {
  const [state, setState] = useState({ loading: true, slides: [], hero: null })
  const [editing, setEditing] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const r = await fetchSlides()
    setState({
      loading: false,
      slides: r.slides,
      hero: r.hero,
      error: r.error,
      needsMigration: r.needsMigration,
    })
  }, [])
  useEffect(() => { load() }, [load])

  async function patchHero(patch) {
    const next = { ...state.hero, ...patch }
    setState((s) => ({ ...s, hero: next })) // the control should feel immediate
    const r = await saveSettings('hero', next)
    if (r.error) { setMsg({ tone: 'error', text: r.error }); load() }
  }

  async function move(index, delta) {
    const next = [...state.slides]
    const to = index + delta
    if (to < 0 || to >= next.length) return
    ;[next[index], next[to]] = [next[to], next[index]]
    setState((s) => ({ ...s, slides: next }))
    // The whole order in one call: a half-renumbered list is worse than a slow
    // one, and two requests can leave exactly that.
    await reorderSlides(next.map((s) => s.id))
  }

  async function remove(slide) {
    if (!window.confirm('Delete this slide? Nothing else refers to it, so only the picture is lost.')) return
    const r = await deleteSlide(slide.id)
    if (r.error) setMsg({ tone: 'error', text: r.error })
    load()
  }

  if (state.loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (state.needsMigration) {
    return (
      <Notice tone="warn" title="The slides table is not installed yet">
        Import <code className="rounded bg-amber-100 px-1 font-mono text-[.85em]">api/promo.mysql.sql</code>{' '}
        once in phpMyAdmin — hPanel → Databases → phpMyAdmin → your database → Import. It adds the
        slides, the settings and the discounts in one go, and is safe to re-run.
      </Notice>
    )
  }
  if (state.error) return <Notice tone="error" title="Cannot load the slides">{state.error}</Notice>

  const hero = state.hero ?? {}

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Home slides</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            The pictures at the top of the home page, and how they play.
          </p>
        </div>
        <button
          onClick={() => setEditing({ ...BLANK, sort: state.slides.length })}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
        >
          Add a slide
        </button>
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {/* ---------------------------------------------------------- playback */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold text-slate-800">How it plays</h2>

        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div>
            <label className="flex items-center justify-between text-sm font-semibold text-slate-700">
              Speed
              <span className="font-mono text-xs text-slate-500">
                {((hero.speed_ms ?? 6500) / 1000).toFixed(1)}s per slide
              </span>
            </label>
            <input
              type="range" min="2000" max="30000" step="500"
              value={hero.speed_ms ?? 6500}
              onChange={(e) => patchHero({ speed_ms: Number(e.target.value) })}
              className="mt-2 w-full accent-indigo-600"
            />
            <p className="mt-1 text-xs text-slate-500">
              Two seconds is the floor — faster than that and nobody can read a slide.
            </p>
          </div>

          <div className="space-y-3">
            <Toggle
              checked={hero.autoplay !== false}
              onChange={(v) => patchHero({ autoplay: v })}
              label="Advance on its own"
              note="Off means the slides only move when the visitor asks."
            />
            <Toggle
              checked={!!hero.shuffle}
              onChange={(v) => patchHero({ shuffle: v })}
              label="Shuffle the order"
              note="A different slide leads on each visit, so the last one is not the one nobody sees."
            />
          </div>
        </div>

        <div className="mt-6">
          <p className="text-sm font-semibold text-slate-700">Size</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {SIZES.map((s) => (
              <button
                key={s.id}
                onClick={() => patchHero({ size: s.id })}
                aria-pressed={(hero.size ?? 'tall') === s.id}
                className={`rounded-xl border p-3 text-start text-sm ${
                  (hero.size ?? 'tall') === s.id
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                    : 'border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                <span className="font-bold">{s.label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{s.note}</span>
              </button>
            ))}
          </div>
        </div>

        <p className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Auto-advance always pauses on hover, on keyboard focus and for visitors who have asked
          their device to reduce motion. That is a requirement, not a setting, so it is not here.
        </p>
      </section>

      {/* ------------------------------------------------------------ slides */}
      {!state.slides.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="font-semibold text-slate-700">No slides yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Until you add one the home page shows the drawn artwork it ships with. That is a
            deliberate fallback, not a placeholder to be embarrassed by — but your own photography
            always wins.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {state.slides.map((slide, i) => (
            <li key={slide.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => move(i, -1)} disabled={i === 0}
                  aria-label="Move up"
                  className="rounded-md border border-slate-200 px-2 text-slate-600 disabled:opacity-30"
                >↑</button>
                <button
                  onClick={() => move(i, 1)} disabled={i === state.slides.length - 1}
                  aria-label="Move down"
                  className="rounded-md border border-slate-200 px-2 text-slate-600 disabled:opacity-30"
                >↓</button>
              </div>

              <img
                src={slide.image}
                alt=""
                width="128" height="72"
                style={{ objectPosition: `${slide.focal_x}% ${slide.focal_y}%` }}
                className="h-[72px] w-32 flex-none rounded-lg bg-slate-100 object-cover"
              />

              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-slate-800">
                  {slide.title_en || <span className="text-slate-400">Untitled</span>}
                </p>
                <p className="truncate text-sm text-slate-500" dir="auto">{slide.title_ar || '—'}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {slide.width ? `${slide.width}×${slide.height}` : 'size unknown'}
                  {slide.cta_href ? ` · button → ${slide.cta_href}` : ''}
                </p>
              </div>

              {!slide.active && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">
                  Hidden
                </span>
              )}
              <button
                onClick={() => setEditing(slide)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300"
              >Edit</button>
              <button
                onClick={() => remove(slide)}
                className="rounded-lg px-2 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
              >Delete</button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <SlideEditor
          slide={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setMsg(null); load() }}
        />
      )}
    </div>
  )
}

function Toggle({ checked, onChange, label, note }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-none accent-indigo-600"
      />
      <span>
        <span className="block text-sm font-semibold text-slate-700">{label}</span>
        <span className="block text-xs text-slate-500">{note}</span>
      </span>
    </label>
  )
}

function SlideEditor({ slide, onClose, onSaved }) {
  const [form, setForm] = useState({ ...BLANK, ...slide })
  const [preview, setPreview] = useState(slide.image ?? null)
  const [picked, setPicked] = useState(null) // the new data: URL, if one was chosen
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function choose(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    try {
      const { url, width, height } = await downscaleImage(file, {
        maxEdge: MAX_EDGE, quality: QUALITY, kind: 'photo',
      })
      setPicked(url)
      setPreview(url)
      setForm((f) => ({ ...f, width, height }))
    } catch (err) {
      setError(err.message)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    // image is sent only when a NEW one was chosen: omitting it keeps the one
    // already stored, so editing a caption cannot wipe the photograph.
    const r = await saveSlide({ ...form, image: picked ?? '' })
    setBusy(false)
    if (r.error) setError(r.error)
    else onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 py-10">
      <form onSubmit={submit} className="w-full max-w-2xl space-y-5 rounded-2xl bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{form.id ? 'Edit slide' : 'New slide'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <IconClose className="h-5 w-5" />
          </button>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        {/* ------------------------------------------------------ the picture */}
        <div>
          <p className="text-sm font-semibold text-slate-700">Photograph</p>
          <div className="mt-2 flex flex-wrap items-start gap-4">
            <div
              className="relative h-[135px] w-60 flex-none overflow-hidden rounded-xl bg-slate-100"
              style={{ backgroundImage: preview ? `url(${preview})` : undefined,
                       backgroundSize: 'cover',
                       backgroundPosition: `${form.focal_x}% ${form.focal_y}%` }}
            >
              {!preview && (
                <span className="flex h-full items-center justify-center text-slate-400">
                  <IconImage className="h-7 w-7" />
                </span>
              )}
              {/* Where the crop keeps the subject. The hero fills its box, so a
                  face near an edge is a face that gets cut. */}
              {preview && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/30"
                  style={{ left: `${form.focal_x}%`, top: `${form.focal_y}%` }}
                />
              )}
            </div>
            <div className="min-w-[13rem] flex-1 space-y-3">
              <input ref={fileRef} type="file" accept={ACCEPTED_ATTR} onChange={choose} className="hidden" />
              <button
                type="button" onClick={() => fileRef.current?.click()}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300"
              >
                {preview ? 'Choose a different photo' : 'Choose a photo'}
              </button>
              <p className="text-xs text-slate-500">
                Landscape, about 2400×1350 or larger. It is downscaled to {MAX_EDGE}px and
                re-encoded here in your browser before it is sent, so a photo straight off a phone
                is fine. PNG, JPEG or WebP — never SVG.
              </p>
              {form.width && (
                <p className="text-xs text-slate-400">Stored at {form.width}×{form.height}</p>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Slider label="Keep in frame — across" value={form.focal_x}
                    onChange={(v) => setForm((f) => ({ ...f, focal_x: v }))} />
            <Slider label="Keep in frame — up and down" value={form.focal_y}
                    onChange={(v) => setForm((f) => ({ ...f, focal_y: v }))} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            The slide crops to fill the screen, and it crops differently on a phone than on a
            desktop. This marks the part that must survive — usually the athlete’s face.
          </p>
        </div>

        {/* --------------------------------------------------------- the words */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Headline (English)" value={form.title_en} onChange={set('title_en')} />
          <Field label="Headline (Arabic)" value={form.title_ar} onChange={set('title_ar')} dir="rtl" />
          <Field label="Line under it (English)" value={form.subtitle_en} onChange={set('subtitle_en')} />
          <Field label="Line under it (Arabic)" value={form.subtitle_ar} onChange={set('subtitle_ar')} dir="rtl" />
          <Field label="Button (English)" value={form.cta_label_en} onChange={set('cta_label_en')} placeholder="Shop now" />
          <Field label="Button (Arabic)" value={form.cta_label_ar} onChange={set('cta_label_ar')} dir="rtl" placeholder="تسوّق الآن" />
        </div>

        <Field
          label="Button goes to" value={form.cta_href} onChange={set('cta_href')} placeholder="/shop"
          hint="A path on this site, like /shop or /product/cloudsoft-jacket-army-green. Links to other sites are refused — this is the most prominent button on the page."
        />

        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox" checked={!!form.active}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            className="h-4 w-4 accent-indigo-600"
          />
          Show this slide on the site
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600">
            Cancel
          </button>
          <button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? 'Saving…' : 'Save slide'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Slider({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-semibold text-slate-600">
        {label} <span className="font-mono text-slate-400">{value}%</span>
      </span>
      <input
        type="range" min="0" max="100" value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-indigo-600"
      />
    </label>
  )
}

function Field({ label, hint, dir, ...props }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <input
        {...props} dir={dir}
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}
