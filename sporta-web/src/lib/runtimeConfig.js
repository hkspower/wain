// Runtime configuration.
//
// Settings used to be baked in at build time from .env, which meant changing a
// Supabase URL required Node, the repo, and a rebuild. On a host reached only
// through a browser file manager that is not possible, and a build with no
// .env ships a store whose checkout refuses every order.
//
// So values are read from /config.js on the server first, and only fall back
// to the build-time .env. Both routes keep working: `npm run deploy` bakes
// values in as before, and the upload-a-folder route edits config.js in place.
//
// Nothing secret lives here. The Supabase anon key is designed to be public —
// it is what the browser authenticates with, and row-level security is what
// protects the data. The service key and the KNET credentials never leave the
// server: they live in knet/config.php, which is not web-readable.

const runtime = typeof window !== 'undefined' ? window.SPORTA_CONFIG : undefined

// The shipped config.js carries these so an unedited file is obvious rather
// than looking like a real, broken value.
const PLACEHOLDERS = ['YOUR-PROJECT', 'your-anon-public-key', 'PASTE_', 'CHANGE_ME']

const usable = (v) =>
  typeof v === 'string' && v.trim() !== '' && !PLACEHOLDERS.some((p) => v.includes(p))

export function configValue(key, buildTimeValue) {
  if (usable(runtime?.[key])) return runtime[key].trim()
  if (usable(buildTimeValue)) return buildTimeValue.trim()
  return ''
}

// Named so the message points at the file to edit rather than at a variable
// name that only exists in a repo the site owner may not have.
export function warnUnconfigured(what) {
  console.warn(
    `[sporta] ${what} is not configured. Edit /config.js on the server ` +
      '(or set the matching VITE_ variable and rebuild).',
  )
}
