import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PRODUCTS } from '../lib/products'
import { Notice, NotAdminNotice } from './Overview'
import {
  ACCEPT,
  MAX_BYTES,
  listImages,
  removeImages,
  setProductImage,
} from './lib/imageUpload'
import { disposeItem, makeItem, runQueue } from './lib/uploadQueue'

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} kB`)

// Why an upload failed, in words the owner can act on.
const REASONS = {
  svg_not_allowed:
    'SVG is not accepted. An SVG can contain script, and served from our own domain that script could read the admin session — so it is the one image format this refuses. Export it as PNG.',
  not_an_image: 'Not an image file.',
  too_large: `Larger than ${kb(MAX_BYTES)}.`,
  too_large_for_bucket:
    'The Storage bucket is still capped below this file. Re-run supabase/SETUP-ALL.sql — it raises the limit to 30 MB.',
  mime_not_allowed:
    'Storage rejected the format. Re-run supabase/SETUP-ALL.sql, which adds HEIC, TIFF, GIF and BMP to the bucket.',
  not_allowed: 'Not permitted. This account must be in admin_users to upload.',
  no_bucket: 'The product-images bucket does not exist yet. Run supabase/SETUP-ALL.sql.',
  already_exists: 'A file with that name is already there.',
  network: 'The connection dropped.',
  not_signed_in: 'Session expired — sign in again.',
}
const reasonText = (r) => REASONS[r] ?? r

export default function Images() {
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [makeWeb, setMakeWeb] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [library, setLibrary] = useState({ loading: true, files: [] })
  const [msg, setMsg] = useState('')
  const abort = useRef(null)
  const input = useRef(null)
  const folder = useRef(null)

  const refresh = useCallback(async () => {
    const r = await listImages()
    setLibrary({ loading: false, ...r })
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  // Object URLs are only freed on unmount here, not per render: a folder of 400
  // photographs is 400 live blob URLs, and leaking them costs the tab's memory.
  useEffect(() => () => items.forEach(disposeItem), []) // eslint-disable-line react-hooks/exhaustive-deps

  const add = useCallback((files) => {
    const list = [...files].filter((f) => f.size > 0) // directories arrive as 0-byte entries
    if (!list.length) return
    setItems((prev) => [...prev, ...list.map(makeItem)])
  }, [])

  const update = useCallback((id, patch) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }, [])

  // getItems reads through a ref so the queue always sees the current list —
  // files dropped while it is running join the same run instead of needing a
  // second Start.
  const itemsRef = useRef(items)
  itemsRef.current = items

  async function start() {
    setMsg('')
    setBusy(true)
    abort.current = new AbortController()
    const r = await runQueue({
      getItems: () => itemsRef.current,
      update,
      makeWeb,
      signal: abort.current.signal,
    })
    setBusy(false)
    if (r?.error) setMsg(reasonText(r.error))
    await refresh()
  }

  const stats = useMemo(() => {
    const by = (s) => items.filter((i) => i.state === s).length
    return {
      total: items.length,
      queued: by('queued'),
      done: by('done'),
      failed: by('failed'),
      rejected: by('rejected'),
      bytes: items.reduce((n, i) => n + i.size, 0),
    }
  }, [items])

  // Paste from the clipboard — how a screenshot or a copied photo arrives.
  useEffect(() => {
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.length) add(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [add])

  if (library.error === 'not_allowed') return <NotAdminNotice />

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">Product images</h1>
        <p className="mt-1 text-sm text-slate-500">
          Any number of files, uploaded exactly as they are — no resizing, no re-compression.
          JPEG, PNG, WebP, AVIF, HEIC, TIFF, GIF and BMP, up to {kb(MAX_BYTES)} each.
        </p>
      </header>

      {library.error === 'no_bucket' && (
        <Notice tone="warn" title="Storage is not set up yet">
          Run <code className="rounded bg-amber-100 px-1 font-mono text-[.85em]">supabase/SETUP-ALL.sql</code>{' '}
          in the Supabase SQL editor. It creates the <code>product-images</code> bucket with public
          read and admin-only writes. If Storage itself is switched off in the project, enable it
          first (Dashboard → Storage), then run the file again.
        </Notice>
      )}
      {msg && <Notice tone="error" title="Upload problem">{msg}</Notice>}

      {/* ---------------------------------------------------------------- drop */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          // items[] carries directories too, which files[] flattens away.
          add(e.dataTransfer.files)
        }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition ${
          dragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 bg-slate-50'
        }`}
      >
        <p className="font-semibold text-slate-700">Drop images here</p>
        <p className="mt-1 text-sm text-slate-500">or paste from the clipboard</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button onClick={() => input.current?.click()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            Choose files
          </button>
          {/* webkitdirectory is how a whole shoot gets in with one action. It is
              non-standard but supported everywhere that matters, and the file
              picker above still works if it is not. */}
          <button onClick={() => folder.current?.click()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white">
            Choose a folder
          </button>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT.join(',')}
          onChange={(e) => {
            add(e.target.files)
            e.target.value = '' // so choosing the same file twice re-fires
          }}
          className="hidden"
        />
        <input
          ref={folder}
          type="file"
          multiple
          webkitdirectory=""
          directory=""
          onChange={(e) => {
            add(e.target.files)
            e.target.value = ''
          }}
          className="hidden"
        />
      </div>

      {/* --------------------------------------------------------------- queue */}
      {items.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm font-semibold text-slate-700">
              {stats.total} file{stats.total === 1 ? '' : 's'} · {kb(stats.bytes)}
              {stats.done > 0 && <span className="ms-2 text-emerald-700">{stats.done} uploaded</span>}
              {stats.failed > 0 && <span className="ms-2 text-rose-600">{stats.failed} failed</span>}
              {stats.rejected > 0 && <span className="ms-2 text-amber-700">{stats.rejected} not accepted</span>}
            </p>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={makeWeb}
                onChange={(e) => setMakeWeb(e.target.checked)}
                disabled={busy}
                className="h-4 w-4 accent-indigo-600"
              />
              {/* Explained, because "also make a web copy" sounds optional and is
                  the difference between a fast shop and a 12 MB image on a phone. */}
              <span>
                Also make a 1600px web copy
                <span className="ms-1 text-slate-400">(the original is never changed)</span>
              </span>
            </label>
            <div className="ms-auto flex gap-2">
              {busy ? (
                <button onClick={() => abort.current?.abort()} className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-semibold text-rose-600">
                  Stop
                </button>
              ) : (
                <button
                  onClick={start}
                  disabled={stats.queued === 0}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  Upload {stats.queued > 0 ? stats.queued : ''}
                </button>
              )}
              <button
                onClick={() => {
                  items.forEach(disposeItem)
                  setItems([])
                }}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {items.map((i) => (
              <Tile
                key={i.id}
                item={i}
                onRemove={() => {
                  disposeItem(i)
                  setItems((prev) => prev.filter((x) => x.id !== i.id))
                }}
                onRetry={() => update(i.id, { state: 'queued', reason: null, tries: 0 })}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------- library */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-slate-800">
            In Storage{library.files.length ? ` · ${library.files.length}` : ''}
          </h2>
          <button onClick={refresh} className="text-sm font-semibold text-indigo-600 underline">
            Refresh
          </button>
        </div>

        {library.loading ? (
          <div className="h-24 rounded-xl bg-slate-100" aria-busy="true" />
        ) : library.files.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing uploaded yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {library.files.map((f) => (
              <StoredTile key={f.path} file={f} onChanged={refresh} onError={setMsg} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Tile({ item, onRemove, onRetry }) {
  const bad = item.state === 'rejected' || item.state === 'failed'
  return (
    <li className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="relative aspect-square bg-slate-100">
        {item.preview ? (
          <img
            src={item.preview}
            alt=""
            className="h-full w-full object-cover"
            // HEIC decodes in Safari and not in Chrome. Rather than a broken
            // image icon, the tile says which — the file uploads either way.
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : null}
        {item.heic && (
          <span className="absolute inset-x-0 bottom-0 bg-ink/70 px-1.5 py-1 text-center text-[10px] font-semibold text-white">
            HEIC — preview needs Safari
          </span>
        )}
        {item.state === 'uploading' && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/20">
            <div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </div>
        )}
        <span
          className={`absolute start-1.5 top-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${
            item.state === 'done'
              ? 'bg-emerald-600 text-white'
              : bad
                ? 'bg-rose-600 text-white'
                : item.state === 'uploading' || item.state === 'deriving'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/90 text-slate-700'
          }`}
        >
          {item.state === 'uploading'
            ? `${Math.round(item.progress * 100)}%`
            : item.state === 'deriving'
              ? 'web copy'
              : item.state}
        </span>
        <button
          onClick={onRemove}
          aria-label={`Remove ${item.name}`}
          className="absolute end-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-sm font-bold text-slate-500 hover:text-rose-600"
        >
          ×
        </button>
      </div>
      <div className="p-2">
        <p className="truncate text-xs font-semibold text-slate-700" title={item.name}>
          {item.name}
        </p>
        <p className="text-[11px] text-slate-400">
          {kb(item.size)}
          {item.webBytes ? ` → web ${kb(item.webBytes)}` : ''}
        </p>
        {bad && <p className="mt-1 text-[11px] leading-snug text-rose-600">{reasonText(item.reason)}</p>}
        {item.state === 'failed' && (
          <button onClick={onRetry} className="mt-1 text-[11px] font-semibold text-indigo-600 underline">
            Retry
          </button>
        )}
      </div>
    </li>
  )
}

// An image already in Storage: shown, assignable to a product, deletable.
// Without the assign step this whole screen would be a file dump — the point of
// a product photograph is that a product uses it.
function StoredTile({ file, onChanged, onError }) {
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function assign(next) {
    setSlug(next)
    if (!next) return
    setSaving(true)
    setSaved(false)
    const r = await setProductImage(next, file.url)
    setSaving(false)
    if (r.error) onError(r.error)
    else setSaved(true)
  }

  return (
    <li className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <a href={file.url} target="_blank" rel="noreferrer" className="block aspect-square bg-slate-100">
        <img src={file.url} alt={file.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      </a>
      <div className="space-y-1.5 p-2">
        <p className="truncate text-xs font-semibold text-slate-700" title={file.name}>
          {file.name}
        </p>
        <p className="text-[11px] text-slate-400">{kb(file.size)}</p>
        <select
          value={slug}
          onChange={(e) => assign(e.target.value)}
          disabled={saving}
          aria-label={`Use ${file.name} for a product`}
          className="w-full rounded-lg border border-slate-300 px-1.5 py-1 text-[11px] outline-none focus:border-indigo-500"
        >
          <option value="">Use for a product…</option>
          {PRODUCTS.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name.en}
            </option>
          ))}
        </select>
        {saved && <p className="text-[11px] font-semibold text-emerald-700">Set ✓</p>}
        <button
          onClick={async () => {
            if (!window.confirm(`Delete ${file.name} from Storage?`)) return
            const r = await removeImages([file.path])
            if (r.error) onError(r.error)
            else onChanged()
          }}
          className="text-[11px] font-semibold text-rose-600 underline"
        >
          Delete
        </button>
      </div>
    </li>
  )
}
