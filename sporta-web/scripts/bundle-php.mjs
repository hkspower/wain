#!/usr/bin/env node
// Copies the PHP payment endpoints into dist/ so ONE deploy ships the whole
// site: React build + both gateways.
//
//   dropin/php-knet -> dist/knet   classic KNET (Tranportal, AES trandata)
//   dropin/php-cbk  -> dist/pay    CBK hosted gateway: KNET, cards, T-Pay QR
//
// They are separate integrations with separate credentials, not two copies of
// one thing: /knet uses a Tranportal ID and resource key, /pay uses a CBK
// ClientId, ClientSecret and ENCRP_KEY. A site can run either or both.
//
// No config.php is ever copied — both hold live bank credentials and exist only
// on the server.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['config.php', 'README.md', '.cbk_token.json'])
const BUNDLES = [['php-knet', 'knet'], ['php-cbk', 'pay']]

if (!existsSync(join(root, 'dist'))) { console.error('dist/ missing — run the build first'); process.exit(1) }

for (const [from, to] of BUNDLES) {
  const src = join(root, 'dropin', from)
  const dest = join(root, 'dist', to)
  if (!existsSync(src)) { console.error(`${from} not found:`, src); process.exit(1) }
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true, filter: (s) => !SKIP.has(s.split('/').pop()) })
  console.log(`bundled ${from} -> dist/${to}/ (config.php intentionally excluded)`)
}
