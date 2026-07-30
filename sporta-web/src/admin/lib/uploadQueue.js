import { supabase } from '../../lib/supabase'
import {
  ORIGINALS,
  WEB,
  describeFile,
  makeWebVersion,
  safeKey,
  uploadFile,
} from './imageUpload'

// The upload queue.
//
// UNLIMITED FILES, BOUNDED CONNECTIONS
// Any number of files can be selected, dropped or pasted — a whole folder of 400
// photographs is a legitimate thing to hand this. They do not all upload at
// once: a browser allows about six connections per origin, so firing 400
// requests means 394 of them sit in the browser's own queue with no progress to
// report, every one competing for the same uplink, and the first timeout takes a
// random handful with it. Four at a time saturates a domestic connection, keeps
// every in-flight file's progress meaningful, and means a failure is one file's
// failure.
//
// One retry per file, automatically, because the commonest failure on a phone
// tether is transient. After that it is left as failed with the reason, and the
// UI offers the retry — a queue that retries forever hides a real problem.
const CONCURRENCY = 4

let seq = 0
export const makeItem = (file) => {
  const check = describeFile(file)
  return {
    id: `f${++seq}`,
    file,
    name: file.name,
    size: file.size,
    // The preview is an object URL of the ORIGINAL file: no decode, no copy, no
    // memory spike, and it appears the instant the file is chosen. It must be
    // revoked when the item goes away or a folder of 400 photographs leaks every
    // one of them.
    preview: check.ok ? URL.createObjectURL(file) : null,
    heic: !!check.heic,
    state: check.ok ? 'queued' : 'rejected',
    reason: check.ok ? null : check.reason,
    progress: 0,
    path: null,
    webPath: null,
    tries: 0,
  }
}

export const disposeItem = (item) => {
  if (item.preview) URL.revokeObjectURL(item.preview)
}

// Runs the queue. `update(id, patch)` is called on every state change, and
// `getItems()` is read fresh each pass so files added mid-run are picked up
// rather than needing a second start.
export async function runQueue({ getItems, update, makeWeb, signal }) {
  const token = (await supabase?.auth.getSession())?.data?.session?.access_token
  if (!token) return { error: 'not_signed_in' }

  let active = 0
  let done = false
  // Claimed ids, tracked HERE and not read back out of React state.
  //
  // This was a real bug, and the test caught it: update() is a setState, so it
  // does not take effect synchronously. pump() runs from each upload's finally,
  // reads getItems() fresh, and saw items it had already started still marked
  // 'queued' — so the same file was uploaded two or three times. 26 files
  // produced 31 uploads. A Set that is written before the await is the only
  // thing that can be trusted inside a loop that also awaits.
  const claimed = new Set()

  const next = () => getItems().find((i) => i.state === 'queued' && !claimed.has(i.id))

  return new Promise((resolve) => {
    const finish = () => {
      if (done) return
      done = true
      resolve({})
    }

    const pump = () => {
      if (signal?.aborted) {
        for (const i of getItems()) if (i.state === 'queued') update(i.id, { state: 'cancelled' })
        if (active === 0) finish()
        return
      }
      while (active < CONCURRENCY) {
        const item = next()
        if (!item) break
        claimed.add(item.id)
        active++
        update(item.id, { state: 'uploading', progress: 0 })
        one(item, token, { update, makeWeb, signal, release: (id) => claimed.delete(id) })
          .finally(() => {
            active--
            pump()
          })
      }
      if (active === 0 && !next()) finish()
    }

    pump()
  })
}

async function one(item, token, { update, makeWeb, signal, release }) {
  const path = `${ORIGINALS}/${safeKey(item.name)}`
  try {
    // The master, byte for byte.
    await uploadFile({
      file: item.file,
      path,
      token,
      signal,
      onProgress: (p) => update(item.id, { progress: p }),
    })
    update(item.id, { path, progress: 1, state: makeWeb ? 'deriving' : 'done' })

    if (!makeWeb) return

    // The derivative. A failure here is not the upload failing: the master is
    // already stored, so this is reported as "no web copy" rather than an error.
    const web = await makeWebVersion(item.file)
    if (!web) {
      update(item.id, { state: 'done', webPath: null, note: item.heic ? 'heic_no_preview' : 'no_web_copy' })
      return
    }
    const webPath = `${WEB}/${safeKey(item.name).replace(/\.[^.]+$/, '')}.webp`
    await uploadFile({
      file: new File([web.blob], 'web.webp', { type: 'image/webp' }),
      path: webPath,
      token,
      signal,
    })
    update(item.id, { state: 'done', webPath, webBytes: web.blob.size, webW: web.width, webH: web.height })
  } catch (e) {
    const reason = e?.message ?? 'failed'
    if (reason === 'cancelled') {
      update(item.id, { state: 'cancelled' })
      return
    }
    // One automatic retry, and only for the failures that are worth retrying.
    // Retrying "file too large" or "mime not allowed" would just fail again
    // slower, and retrying "already exists" would be wrong.
    const transient = reason === 'network' || /^http_5/.test(reason)
    if (transient && item.tries < 1) {
      // Released from `claimed` so the next pump can pick it up again — the
      // retry is a genuine re-queue, not a flag nobody reads.
      release(item.id)
      update(item.id, { state: 'queued', tries: item.tries + 1, progress: 0 })
      return
    }
    update(item.id, { state: 'failed', reason, progress: 0 })
  }
}
