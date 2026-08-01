// Read an image the admin picked, shrink it, and hand back a data: URL.
//
// ONE implementation, used by both screens that accept a picture — the brand
// logos and the home slides. It was two, differing only in a size and a
// quality number, and the copies had already begun to drift: only one of them
// had learned that Safari before 16 silently returns a PNG when asked for
// WebP, which for a photograph is far LARGER than the JPEG it came from and
// would then fail the server's size cap.
//
// It matters more than an ordinary de-duplication because the FIRST LINE is a
// security check. Every path that turns a file the admin chose into something
// the server will store has to refuse SVG — an SVG is a document that can
// carry script, and it would be served from our own origin. One copy of that
// rule is one place to get it right, and one place to change if the accepted
// formats ever move.
//
// Nothing here uploads a file. The result is a string that lands in a database
// row, because an endpoint that writes into the web root is a way in and this
// server already hosted one of those.

const ACCEPTED = /^image\/(png|jpeg|webp)$/

// The file input's `accept` attribute, kept beside the check it mirrors so the
// picker and the validator cannot disagree about what may be chosen.
export const ACCEPTED_ATTR = 'image/png,image/jpeg,image/webp'

export class ImageRejected extends Error {
  constructor(message) {
    super(message)
    this.name = 'ImageRejected'
  }
}

/**
 * @param {File}   file
 * @param {object} opts
 * @param {number} opts.maxEdge   longest side, in pixels, after scaling
 * @param {number} [opts.quality] 0–1, for the lossy encoders
 * @param {'photo'|'graphic'} [opts.kind]
 *   'photo'   — a large photograph: WebP, falling back to JPEG. Transparency
 *               is not expected and would cost far more than it is worth.
 *   'graphic' — a logo: WebP, falling back to PNG, because a logo without its
 *               transparent background is a white box on a coloured header.
 * @returns {Promise<{url: string, width: number, height: number}>}
 */
export async function downscaleImage(file, { maxEdge, quality = 0.9, kind = 'graphic' }) {
  if (!ACCEPTED.test(file?.type ?? '')) {
    throw new ImageRejected(
      'Choose a PNG, JPEG or WebP image. (SVG is not accepted — it can carry script.)',
    )
  }

  const bitmap = await createImageBitmap(file)
  try {
    // Only ever DOWN. Scaling a small logo up would ship a blurry one at the
    // cost of a bigger file.
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    // The default is a cheap nearest-neighbour resample, and at hero size the
    // aliasing is visible.
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)

    let url = canvas.toDataURL('image/webp', quality)
    // Safari before 16 has no WebP encoder and does not say so — it returns a
    // PNG data URL from the same call. Falling back to "whatever we got" is
    // how a 4 MB PNG of a photograph reaches the server.
    if (!url.startsWith('data:image/webp')) {
      url = canvas.toDataURL(kind === 'photo' ? 'image/jpeg' : 'image/png', quality)
    }
    return { url, width, height }
  } finally {
    // Released even if encoding throws — an ImageBitmap holds decoded pixels,
    // and a hero photograph is tens of megabytes of them.
    bitmap.close?.()
  }
}
