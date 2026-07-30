import { supabase } from '../../lib/supabase'
import { configValue } from '../../lib/runtimeConfig'

// Uploading product photographs to Supabase Storage.
//
// ===================== LOSSLESS MEANS THE BYTES ARE NOT TOUCHED ==============
// The original File is sent exactly as it came off the camera or the phone. No
// canvas, no re-encode, no resize, no metadata stripping. That is the only
// meaning of lossless that is worth anything: a JPEG re-encoded at quality 100
// is still a second generation, and a PNG pushed through a canvas loses its
// colour profile and its 16-bit depth.
//
// A web-sized WebP is generated ALONGSIDE it, into a separate folder, because
// the alternative is a shopper on a Kuwaiti mobile connection downloading a
// 12 MB master to look at a 400px card — which would undo the image work done
// everywhere else on this site. The master is never modified or replaced; the
// derivative is a copy, and if the browser cannot decode the format it is simply
// not made and the master is used directly.
//
//   product-images/originals/<name>   the untouched upload. Kept forever.
//   product-images/web/<name>.webp    1600px, quality 82. Regenerable, disposable.
//
// ============================== FORMATS ====================================
// Everything a camera, a phone or a designer actually produces: JPEG, PNG, WebP,
// AVIF, HEIC/HEIF, TIFF, GIF, BMP.
//
// SVG IS DELIBERATELY NOT IN THAT LIST, and it is the one exclusion worth
// arguing about. An SVG is not a picture, it is a document — it can carry
// <script>, and served from our own origin that script runs with the site's
// privileges: it could read the admin's Supabase session out of localStorage.
// "All image formats" cannot include a format that is also a program. If a logo
// really has to be an SVG, it belongs in the repo where a human reads it before
// it ships, not in a bucket an upload form writes to.
//
// HEIC is the format to know about: an iPhone shoots it by default. It uploads
// fine, but Chrome cannot decode it, so it gets no preview and no derivative —
// Safari can. The UI says which, rather than showing a broken tile.

export const BUCKET = 'product-images'
export const ORIGINALS = 'originals'
export const WEB = 'web'

// 30 MB. A phone photo is 3-6 MB and a DSLR JPEG 8-15 MB, so the old 5 MB cap
// would have rejected most real camera files — and rejecting them is not
// "lossless", it is "no image at all". Kept in step with the bucket's own limit
// in supabase/storage-migration.sql, which is the one that actually enforces it.
export const MAX_BYTES = 30 * 1024 * 1024

export const ACCEPT = [
  'image/jpeg', 'image/png', 'image/webp', 'image/avif',
  'image/heic', 'image/heif', 'image/tiff', 'image/gif', 'image/bmp',
]

// Some browsers report an empty type for HEIC and TIFF, so the extension is the
// fallback. Anything unrecognised is refused by name rather than uploaded and
// rejected by the server after the bytes have been sent.
const EXT_OK = /\.(jpe?g|png|webp|avif|heic|heif|tiff?|gif|bmp)$/i

export function describeFile(file) {
  const type = file.type || ''
  const okType = ACCEPT.includes(type.toLowerCase())
  const okExt = EXT_OK.test(file.name)
  if (/^image\/svg/i.test(type) || /\.svgz?$/i.test(file.name)) {
    return { ok: false, reason: 'svg_not_allowed' }
  }
  if (!okType && !okExt) return { ok: false, reason: 'not_an_image' }
  if (file.size > MAX_BYTES) return { ok: false, reason: 'too_large' }
  return { ok: true, heic: /hei[cf]/i.test(type) || /\.hei[cf]$/i.test(file.name) }
}

// A key Storage will accept, that a human can still recognise.
//
// Storage keys are URL path segments: spaces, #, ? and non-ASCII break them or
// silently change the object's address. Arabic filenames strip to nothing, hence
// the fallback. A six-character suffix keeps two photos called IMG_1234.jpg from
// overwriting each other — a real risk, because that is what every phone calls
// every picture.
export function safeKey(name) {
  const dot = name.lastIndexOf('.')
  const ext = (dot > 0 ? name.slice(dot + 1) : 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const stem =
    (dot > 0 ? name.slice(0, dot) : name)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'image'
  const rand = Math.random().toString(36).slice(2, 8)
  return `${stem}-${rand}.${ext}`
}

const url = () => configValue('supabaseUrl', import.meta.env.VITE_SUPABASE_URL)
const anon = () => configValue('supabaseAnonKey', import.meta.env.VITE_SUPABASE_ANON_KEY)

export const publicUrl = (path) => `${url()}/storage/v1/object/public/${BUCKET}/${path}`

// XHR, not fetch, and not supabase-js — for one reason: progress.
//
// supabase-js's upload() resolves or rejects and tells you nothing in between,
// and fetch has no upload progress event either. On a Kuwaiti mobile connection
// a 12 MB lossless master takes long enough that a spinner with no number is
// indistinguishable from a hang, and the owner's response to that is to press
// the button again.
export function uploadFile({ file, path, token, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${url()}/storage/v1/object/${BUCKET}/${path}`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', anon())
    // Content-Type must be the file's own, or Storage records it as
    // application/octet-stream and the browser later downloads the image
    // instead of displaying it.
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    // No upsert: safeKey() already makes collisions vanishingly unlikely, and a
    // silent overwrite of a photograph is not a thing to make easy.
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve({ path })
        : reject(new Error(serverMessage(xhr)))
    xhr.onerror = () => reject(new Error('network'))
    xhr.onabort = () => reject(new Error('cancelled'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(file)
  })
}

// Storage's errors are JSON and its statuses are meaningful; both are more use
// to the owner than "upload failed".
function serverMessage(xhr) {
  let body = {}
  try {
    body = JSON.parse(xhr.responseText)
  } catch {
    /* not JSON */
  }
  const m = body.message || body.error || ''
  if (xhr.status === 400 && /exceeded the maximum allowed size/i.test(m)) return 'too_large_for_bucket'
  if (xhr.status === 400 && /mime type .* is not supported/i.test(m)) return 'mime_not_allowed'
  if (xhr.status === 401 || xhr.status === 403) return 'not_allowed'
  if (xhr.status === 404) return 'no_bucket'
  if (xhr.status === 409) return 'already_exists'
  return m || `http_${xhr.status}`
}

// A web-sized WebP copy. Returns null when the browser cannot decode the source
// — HEIC in anything but Safari — which is not an error: the master is already
// safely uploaded and can be used as it is.
export async function makeWebVersion(file, maxEdge = 1600, quality = 0.82) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null
  let bmp
  try {
    bmp = await createImageBitmap(file)
  } catch {
    return null // undecodable in this browser
  }
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  // Downscaling in one step on a 24MP source is visibly soft; the browser's own
  // high-quality path is what resizeQuality asks for.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality })
  // If WebP is unavailable the browser silently hands back a PNG, which for a
  // photograph is larger than the original and worse than not bothering.
  if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return null
  return { blob, width: w, height: h }
}

// What is already in the bucket, newest first, so the grid is a library rather
// than a record of this one session.
export async function listImages(prefix = ORIGINALS, limit = 200) {
  if (!supabase) return { error: 'not_configured', files: [] }
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(prefix, { limit, sortBy: { column: 'created_at', order: 'desc' } })
  if (error) {
    return { error: /not found/i.test(error.message) ? 'no_bucket' : error.message, files: [] }
  }
  return {
    files: (data ?? [])
      .filter((f) => f.id) // list() also returns folder placeholders, which have no id
      .map((f) => ({
        name: f.name,
        path: `${prefix}/${f.name}`,
        size: f.metadata?.size ?? 0,
        type: f.metadata?.mimetype ?? '',
        at: f.created_at,
        url: publicUrl(`${prefix}/${f.name}`),
      })),
  }
}

export async function removeImages(paths) {
  if (!supabase) return { error: 'not_configured' }
  const { error } = await supabase.storage.from(BUCKET).remove(paths)
  return error ? { error: error.message } : {}
}

// Point a product at an image. The storefront reads products.image, and
// catalogRows() in admin/api.js only sends an http(s) URL, so a Storage public
// URL is exactly the shape that column already expects.
export async function setProductImage(slug, imageUrl) {
  if (!supabase) return { error: 'not_configured' }
  const { error } = await supabase.from('products').update({ image: imageUrl }).eq('slug', slug)
  return error ? { error: error.message } : {}
}
