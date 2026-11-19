// Which local files a suite's script pulls in (static `import ... from './x.mjs'`, `import './x'`, `import('./x')`,
// `require('./x')`), followed transitively. `--changed` uses it so that a change to a shared helper under scripts/
// (build-addon-css.mjs, db-schema-diff.mjs, ...) selects every suite that imports it, not only the suite whose own
// script changed. Paths are relative to sporta-web/, with forward slashes. Reads files; spawns nothing.
import fs from 'node:fs'
import path from 'node:path'

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g

export function localImports(webDir, relFile) {
  let src = ''
  try { src = fs.readFileSync(path.join(webDir, relFile), 'utf8') } catch { return [] }
  const out = new Set()
  for (const m of src.matchAll(IMPORT_RE)) {
    const abs = path.resolve(path.dirname(path.join(webDir, relFile)), m[1])
    const rel = path.relative(webDir, abs).split(path.sep).join('/')
    if (rel.startsWith('..')) continue
    out.add(rel)
  }
  return [...out]
}

// The script itself plus everything it imports, transitively (only files that exist).
export function scriptClosure(webDir, relScript) {
  const seen = new Set()
  const todo = [relScript]
  while (todo.length) {
    const f = todo.pop()
    if (seen.has(f)) continue
    seen.add(f)
    if (!/\.(?:mjs|js|cjs)$/.test(f)) continue
    for (const d of localImports(webDir, f)) if (!seen.has(d) && fs.existsSync(path.join(webDir, d))) todo.push(d)
  }
  return [...seen]
}
