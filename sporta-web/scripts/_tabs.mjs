import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' })
const ctx = await b.newContext({ viewport:{width:1400,height:1000}, deviceScaleFactor:2, serviceWorkers:'block' })
const p = await ctx.newPage()
const errs=[]; p.on('pageerror', e=>errs.push(e.message))
await p.goto('http://127.0.0.1:8096/backends', { waitUntil:'networkidle' })
await p.locator('input[type=email]').fill('cs@sporta.com.kw')
await p.locator('input[type=password]').fill('correct-horse-battery-kw')
await p.getByRole('button',{name:'Sign in'}).click()
await p.getByRole('button',{name:'Orders'}).first().waitFor({timeout:15000})
for (const tab of ['Slides','Promotions','Discounts']) {
  await p.getByRole('button',{name:tab}).first().click()
  await p.waitForTimeout(1200)
  await p.screenshot({ path:`/tmp/claude-0/adm-${tab.toLowerCase()}.png`, fullPage:true })
  console.log(tab, '→', (await p.locator('main h1').first().textContent()))
}
console.log('pageerrors:', errs.length?errs.join('|'):'none')
await b.close()
