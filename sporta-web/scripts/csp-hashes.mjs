// Writes the hashes of every inline <script> in dist/index.html into the
// deployed .htaccess Content-Security-Policy, in place of the placeholder
// `__SCRIPT_HASHES__`, so the policy can drop 'unsafe-inline' from script-src.
//
// Why a build step: the inline scripts are Vite output and their bytes change
// every build, so a hash typed into .htaccess by hand is wrong on the next
// deploy and the page goes blank. Running this after `vite build` means the
// hashes always describe the exact HTML that ships.
//
// JSON-LD blocks (type="application/ld+json") are data, not code; browsers
// never execute them, so they are not hashed.
//
// It refuses to write when the placeholder is missing (the policy would be
// silently unchanged) or when no inline script is found (the page would be
// blocked from its own boot code). Run automatically as `postbuild`.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const htaccessPath = join(dist, '.htaccess')
if (!existsSync(htaccessPath)) throw new Error('dist/.htaccess missing: run after vite build')
const ht = readFileSync(htaccessPath, 'utf8')
if (!ht.includes('__SCRIPT_HASHES__')) throw new Error('dist/.htaccess has no __SCRIPT_HASHES__ placeholder')

const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/type\s*=\s*"application\/ld\+json"/.test(m[1]))
  .map(m => `'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`)
if (hashes.length === 0) throw new Error('no inline scripts found in dist/index.html; refusing to write an empty policy')

writeFileSync(htaccessPath, ht.replace('__SCRIPT_HASHES__', hashes.join(' ')))
console.log(`csp: ${hashes.length} inline script hash(es) written to dist/.htaccess`)
