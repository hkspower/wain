#!/usr/bin/env node
// Copies the native KNET PHP endpoints into dist/knet/ so ONE deploy ships the
// whole site: React build + payment endpoints. config.php is never copied — it
// holds live Tranportal credentials and exists only on the server.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'dropin', 'php-knet')
const dest = join(root, 'dist', 'knet')
const SKIP = new Set(['config.php', 'README.md'])

if (!existsSync(src)) { console.error('php-knet not found:', src); process.exit(1) }
if (!existsSync(join(root, 'dist'))) { console.error('dist/ missing — run the build first'); process.exit(1) }

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync(src, dest, {
  recursive: true,
  filter: (s) => !SKIP.has(s.split('/').pop()),
})
console.log('bundled PHP payment endpoints -> dist/knet/ (config.php intentionally excluded)')
