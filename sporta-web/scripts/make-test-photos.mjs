#!/usr/bin/env node
// TEST RIG ONLY. The shop lists a product only with a name, a price and a PHOTO (dropin/php-store/product-listable.php),
// and the photo is a file named after the slug in images/products beside the api folder. The rig has no product
// photographs, so this writes a placeholder per active product, in the folders the rig's API reads: dropin/images
// (served on :8095) and dist/images (served on :8096 and :8188). A file that already exists is left alone, so a
// real photo is never overwritten. Nothing here reaches a bundle or a deploy: the folders are git-ignored and the
// bundler copies only dropin/php-store.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const slugs = execFileSync('mariadb', ['sporta', '-N', '-B', '-e', 'select slug from products where active = 1'], { encoding: 'utf8' })
  .split('\n').map((s) => s.trim()).filter(Boolean)
const targets = [join(root, 'dropin', 'images', 'products')]
if (existsSync(join(root, 'dist'))) targets.push(join(root, 'dist', 'images', 'products'))

let made = 0
for (const dir of targets) {
  mkdirSync(dir, { recursive: true })
  for (const slug of slugs) {
    const file = join(dir, `${slug}.jpg`)
    if (existsSync(file)) continue
    writeFileSync(file, 'placeholder')
    made++
  }
}
console.log(`test photos: ${slugs.length} products, ${made} placeholder file(s) written`)
