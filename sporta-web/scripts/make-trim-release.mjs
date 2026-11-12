#!/usr/bin/env node
// MAKE TRIM RELEASE - the Payments trim as a file that can ship without an API release.
//
//   node scripts/make-trim-release.mjs           write both files below
//   node scripts/make-trim-release.mjs --check   exit 1 if either file is not what this tool makes
//
// WHY. public/sporta-admin-brands.js on the branch carries blocks the live admin.php cannot serve yet (Shipping, Database
// center, ...), so it cannot be deployed as is. The live file is commit 2b22a9a's (deploy-20261111T201854Z-2b22a9a). The
// trim is ONE self-contained block, ops/release/payments-trim-block.js (it uses no variable of any other block). This tool
//   1. puts that exact text into public/sporta-admin-brands.js, right after block 4 (the CBK connection), i.e. right before
//      "/* ===== ADMIN SITE CONTENT - begin", replacing any earlier copy between its begin/end markers;
//   2. writes ops/release/sporta-admin-brands.trim-1112.js = the LIVE file (git show 2b22a9a:...) with the same text inserted
//      at the same place, and nothing else changed (every byte outside the block is the live file's).
// Deploying it is a separate, owner-approved step: it is the readable source, and the deploy must produce BOTH live names
// (the loader sporta-admin-brands.js and sporta-admin-brands.full.js) the way scripts/split-admin-addon.mjs does.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
export const LIVE_SHA = '2b22a9a'
export const BLOCK_FILE = join(WEB, 'ops/release/payments-trim-block.js')
export const PUBLIC_FILE = join(WEB, 'public/sporta-admin-brands.js')
export const RELEASE_FILE = join(WEB, 'ops/release/sporta-admin-brands.trim-1112.js')
const BEGIN = '/* ===== ADMIN PAYMENTS TRIM - begin'
const END = '/* ===== ADMIN PAYMENTS TRIM - end'
const ANCHOR = '/* ===== ADMIN SITE CONTENT - begin'

export const liveFile = () => execFileSync('git', ['show', `${LIVE_SHA}:sporta-web/public/sporta-admin-brands.js`], { cwd: WEB, encoding: 'utf8', maxBuffer: 64 << 20 })

export function splice(src, block) {
  let out = src
  const b = out.indexOf(BEGIN)
  if (b >= 0) {
    const e = out.indexOf('\n', out.indexOf(END, b)) + 1
    out = out.slice(0, b) + out.slice(e).replace(/^\n/, '')
  }
  const at = out.indexOf(ANCHOR)
  if (at < 0 || out.indexOf(ANCHOR, at + 1) >= 0) throw new Error('the anchor must appear exactly once: ' + ANCHOR)
  return out.slice(0, at) + block.replace(/\n*$/, '\n') + '\n' + out.slice(at)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check')
  const block = readFileSync(BLOCK_FILE, 'utf8')
  const want = { [PUBLIC_FILE]: splice(readFileSync(PUBLIC_FILE, 'utf8'), block), [RELEASE_FILE]: splice(liveFile(), block) }
  let bad = 0
  for (const [f, text] of Object.entries(want)) {
    let have = ''
    try { have = readFileSync(f, 'utf8') } catch {}
    if (have === text) { console.log('ok   ' + f.slice(WEB.length + 1) + ' is current'); continue }
    if (check) { console.log('FAIL ' + f.slice(WEB.length + 1) + ' is not what make-trim-release.mjs makes'); bad++; continue }
    writeFileSync(f, text)
    console.log('wrote ' + f.slice(WEB.length + 1) + ' (' + text.length + ' bytes)')
  }
  process.exit(bad ? 1 : 0)
}
