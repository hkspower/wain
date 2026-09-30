import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } })
const hits = []
p.on('request', r => { if (r.url().includes('admin.php?r=')) hits.push(r.url().split('r=')[1].split('&')[0]) })
await p.goto('http://127.0.0.1:4300/backends', { waitUntil: 'networkidle' })
await p.fill('input[type=email]', 'manager@sporta.com.kw')
await p.fill('input[type=password]', 'correct horse')
await p.keyboard.press("Enter")
await p.waitForTimeout(4000)
console.log('sign-in + first screen:', hits.length, 'requests')
const counts = {}; hits.forEach(h => counts[h] = (counts[h]||0)+1)
console.log(JSON.stringify(counts))
// click through the panel's tabs
hits.length = 0
for (const label of await p.$$eval('nav a, [role=tab], button', els => els.map(e => e.textContent.trim()).filter(Boolean).slice(0,40))) {
  const el = await p.$(`text="${label}"`).catch(() => null)
  if (!el) continue
  await el.click({ timeout: 1500 }).catch(() => {})
  await p.waitForTimeout(500)
}
console.log('clicking around the panel:', hits.length, 'more requests')
await b.close()
