/* Does a DROP and a PASTE actually queue a photograph? Driven in a real
   browser against the built panel, because a hook that compiles and never
   fires is the whole failure mode here. */
import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:8899'
let fails = 0
const check = (ok, what, extra='') => { if(!ok) fails++; console.log(`${ok?'ok  ':'FAIL'} ${what}${extra&&!ok?` — ${extra}`:''}`) }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0,140)))

await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// sign in
const email = await p.$('input[inputmode="email"], input[type="email"]')
if (email) {
  await email.fill('manager@sporta.com.kw')
  const pw = await p.$('input[type="password"]'); await pw.fill('correct horse')
  await p.keyboard.press('Enter'); await p.waitForTimeout(2500)
}
await p.goto(`${BASE}/backends/images`, { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)

check(/Photographs|images/i.test(await p.content()), 'the images screen loaded')

// Pick a garment so the drop zone is enabled.
const skuBtn = await p.$$('text=/^A-[A-Z0-9-]+$/')
if (skuBtn.length) { await skuBtn[0].click(); await p.waitForTimeout(1800) }

check(/drag photographs onto this page/i.test(await p.content()),
  'the page says dropping works')

// THE DROP. A real 4x4 PNG, delivered through DataTransfer exactly as a
// browser would deliver a file from the desktop.
const queued = await p.evaluate(async () => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR42mNk+M9QzzCKRsEoGgWjAAB5eAX9k1i1YwAAAABJRU5ErkJggg=='
  const bin = atob(b64); const arr = new Uint8Array(bin.length)
  for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i)
  const file = new File([arr], 'dropped.png', { type: 'image/png' })
  const dt = new DataTransfer(); dt.items.add(file)
  document.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
  document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  await new Promise(r => setTimeout(r, 900))
  return document.body.innerText.includes('dropped.png')
})
check(queued, 'a DROPPED file appears in the queue by name')

// THE PASTE.
const pasted = await p.evaluate(async () => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR42mNk+M9QzzCKRsEoGgWjAAB5eAX9k1i1YwAAAABJRU5ErkJggg=='
  const bin = atob(b64); const arr = new Uint8Array(bin.length)
  for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i)
  const file = new File([arr], 'pasted.png', { type: 'image/png' })
  const dt = new DataTransfer(); dt.items.add(file)
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  await new Promise(r => setTimeout(r, 900))
  return document.body.innerText.includes('pasted.png')
})
check(pasted, 'a PASTED image appears in the queue by name')

check(errs.length === 0, `no page errors (${errs.length})`, errs.join(' | '))
await b.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — dropping and pasting both queue a photograph')
process.exit(fails ? 1 : 0)
