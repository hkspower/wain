/**
 * Hero slides download only near the current one (assets/hero-lazy.js, 2026-10-02).
 *
 *   bash scripts/sandbox.sh && node scripts/hero-lazy-test.mjs
 *
 * The sandbox has three slides, where every slide is a neighbour and nothing can be saved, so the rig
 * adds three more (copies of the existing rows) and takes them away again at the end. Phone and desktop:
 * the first visit fetches exactly the current slide and its two neighbours (the wrap-around one
 * included); "Next" fetches the new neighbour; the slide on screen is never a deferred (hidden) picture
 * and has its bytes. Mutation: without the script the first visit fetches all six.
 */
import { chromium, devices } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '--raw', '-e', q], { encoding: 'utf8' }).trim()
sql('delete from hero_slides where id > 100')
sql(`insert into hero_slides (id, sort, active, image, image_hash, image_w, image_h, focal_x, focal_y)
     select id + 100, sort + 10, 1, image, concat(substr(image_hash, 1, 8), 'rig', id), image_w, image_h, focal_x, focal_y
       from hero_slides where active = 1 and image is not null`)
const ids = sql('select id from hero_slides where active = 1 order by sort, id').split('\n').map(Number)
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
try {
  check(ids.length >= 6, 'the sandbox has enough slides for a saving to be possible', `${ids.length} active`)
  const expect = (cur) => [ids[(cur - 1 + ids.length) % ids.length], ids[cur], ids[(cur + 1) % ids.length]].sort((a, b) => a - b).join(',')
  for (const [nm, dev] of [['phone', devices['Pixel 7']], ['desktop', { viewport: { width: 1280, height: 900 } }]]) {
    const ctx = await browser.newContext(dev); const p = await ctx.newPage(); const got = new Set()
    p.on('request', (r) => { const m = r.url().match(/slide_image&id=(\d+)/); if (m) got.add(+m[1]) })
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
    const first = [...got].sort((a, b) => a - b).join(',')
    check(first === expect(0), `${nm}: the first visit fetches only the current slide and its two neighbours`, `${first} of ${ids.length}`)
    await p.locator('button[aria-label="الشريحة التالية"], button[aria-label="Next slide"]').first().evaluate((x) => x.click()); await p.waitForTimeout(1500)
    const next = [...got].sort((a, b) => a - b).join(',')
    const want = [...new Set([...expect(0).split(','), ...expect(1).split(',')].map(Number))].sort((a, b) => a - b).join(',')
    check(next === want, `${nm}: "Next" fetches the new neighbour`, next)
    const shown = await p.evaluate(() => { const i = [...document.querySelectorAll('img[src*="r=slide_image"]')].find((x) => x.parentElement.parentElement.getAttribute('aria-hidden') === 'false'); return i ? { deferred: i.hasAttribute('data-hero-defer'), h: i.naturalHeight } : null })
    check(shown && !shown.deferred && shown.h > 0, `${nm}: the slide on screen is shown with its picture loaded`, JSON.stringify(shown))
    await ctx.close()
  }
} finally {
  sql('delete from hero_slides where id > 100')
  await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — hero slides download only near the current one')
process.exit(fails ? 1 : 0)
