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
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['config.php', 'README.md', '.cbk_token.json'])
// Editor and manual backups (config.php~, config.php.bak, …) are never shipped:
// a backup of a credential file served as text is a leak (review finding, high).
// config.* other than the two named includes is never shipped either.
const BACKUP = /(~|\.(bak|orig|old|save|swp))$/i
const CONFIG_OK = new Set(['config-path.php', 'config.example.php'])
const skipName = (name) => SKIP.has(name) || BACKUP.test(name) || (/^config\./i.test(name) && !CONFIG_OK.has(name))
// php-store is the native backend: /api serves the storefront and the admin
// from MySQL on the same plan. schema/seed ship too — they are how the owner
// imports the database in phpMyAdmin — but they are denied by the folder's
// .htaccess, so shipping them is not serving them.
const BUNDLES = [['php-knet', 'knet'], ['php-cbk', 'pay'], ['php-store', 'api']]

if (!existsSync(join(root, 'dist'))) { console.error('dist/ missing — run the build first'); process.exit(1) }

// Rebuilt from its parts on every bundle, so it cannot ship stale. A
// generated file that is only regenerated when someone remembers is the
// hand-made zip all over again.
execFileSync('node', [join(root, 'scripts', 'make-install-sql.mjs')], { stdio: 'inherit' })

for (const [from, to] of BUNDLES) {
  const src = join(root, 'dropin', from)
  const dest = join(root, 'dist', to)
  if (!existsSync(src)) { console.error(`${from} not found:`, src); process.exit(1) }
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true, filter: (s) => !skipName(s.split('/').pop()) })
  console.log(`bundled ${from} -> dist/${to}/ (config.php intentionally excluded)`)
}
