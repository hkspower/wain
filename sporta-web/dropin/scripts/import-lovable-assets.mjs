// Import "stranded" Lovable asset stubs into real files.
//
// Lovable sometimes commits placeholder stubs `X.png.asset.json` instead of the
// binary. Each stub is JSON like: { "url": "/assets/hero-flame-abc.png",
// "size": 20345, "type": "image/png" }. This script, for every
// src/assets/**/*.asset.json:
//   1. reads its `url` and `size`,
//   2. downloads {PREVIEW_HOST}{url} with `curl -f` to the stub path minus
//      ".asset.json",
//   3. verifies the downloaded size is within ~2% of `size` and that `file`
//      reports a matching type,
//   4. deletes the stub,
//   5. rewrites any import that referenced the ".asset.json" path.
//
// Run from the project root (where src/ lives):
//   LOVABLE_PREVIEW_URL=https://id-preview--XXXX.lovable.app \
//     node scripts/import-lovable-assets.mjs
//
// RUN THIS IN THE REAL REPO — it needs the .asset.json stubs to exist.

import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative } from 'node:path'

const HOST =
  process.env.LOVABLE_PREVIEW_URL ||
  'https://id-preview--c5bf1be6-60af-4efe-96ec-ae6da15af2eb.lovable.app'
const ASSETS_DIR = 'src/assets'
const SRC_DIR = 'src'
// --dry-run: show what would happen, download/write/delete NOTHING.
const DRY = process.argv.includes('--dry-run')

function walk(dir) {
  const out = []
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const stubs = walk(ASSETS_DIR).filter((f) => f.endsWith('.asset.json'))
if (!stubs.length) {
  console.log(`No *.asset.json stubs under ${ASSETS_DIR}. Nothing to do.`)
  process.exit(0)
}
console.log(`Found ${stubs.length} stub(s).`)

let ok = 0
const failures = []

for (const stub of stubs) {
  const target = stub.replace(/\.asset\.json$/, '')
  try {
    const meta = JSON.parse(readFileSync(stub, 'utf8'))
    if (!meta.url) throw new Error('stub has no "url" field')
    const url = HOST + meta.url

    if (DRY) {
      console.log(`· would download ${url}\n    -> ${relative('.', target)} (~${meta.size ?? '?'} bytes, ${meta.type ?? '?'})`)
      continue
    }

    // 2) download (curl -f fails on HTTP errors)
    execFileSync('curl', ['-f', '-s', '-S', '-o', target, url], { stdio: 'pipe' })

    // 3) verify size + type
    const size = statSync(target).size
    if (meta.size && Math.abs(size - meta.size) / meta.size > 0.02) {
      throw new Error(`size ${size} != stub ${meta.size} (>2%)`)
    }
    let type = ''
    try {
      type = execFileSync('file', ['-b', '--mime-type', target]).toString().trim()
    } catch {
      /* file not available; skip type check */
    }
    if (meta.type && type && !type.startsWith(meta.type.split('/')[0])) {
      throw new Error(`type ${type} != stub ${meta.type}`)
    }

    // 4) delete stub
    unlinkSync(stub)
    ok++
    console.log(`✓ ${relative('.', target)}  (${size} bytes${type ? ', ' + type : ''})`)
  } catch (e) {
    failures.push(`${stub}: ${e.message}`)
    console.error(`✗ ${stub}: ${e.message}`)
  }
}

// 5) rewrite imports that referenced the ".asset.json" path explicitly.
let fixedImports = 0
for (const f of walk(SRC_DIR)) {
  if (!/\.(js|jsx|ts|tsx|css)$/.test(f)) continue
  const before = readFileSync(f, 'utf8')
  const after = before.replace(/\.asset\.json(['"`)])/g, '$1')
  if (after !== before) {
    if (!DRY) writeFileSync(f, after)
    fixedImports++
    console.log(`${DRY ? '· would fix' : '↻ fixed'} import(s) in ${relative('.', f)}`)
  }
}

console.log(`\nDone: ${ok}/${stubs.length} imported, ${fixedImports} file(s) had imports fixed.`)
if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n  ` + failures.join('\n  '))
  process.exit(1)
}
