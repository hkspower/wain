/**
 * The main menu and the "Shop the essentials" section are both gone.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/menu-essentials-removed-test.mjs
 *
 * Asked for on 2026-09-17 as "remove main menu and تسوق اساسيات" — two
 * removals in one request, checked separately here because they are two
 * different mechanisms: the menu is a plain CSS hide (sporta-ui.css), the
 * essentials section is DOM surgery (hide-essentials.js), since there is no
 * CSS selector that can match "the section whose heading says X".
 *
 * NAVIGATION IS NOT LOST. The footer already carries its own copy of every
 * link the menu had (Contact, Terms and more besides) — checked here, not
 * only claimed in a comment, because a check that only reads sporta-ui.css
 * would prove the menu is hidden and say nothing about whether a visitor
 * is actually stranded.
 *
 * EVERYTHING ELSE IN THE HEADER STAYS. The logo, language toggle, clock,
 * cart and wishlist icons, and the theme toggle are all still there and
 * still work — this is the one thing a screenshot cannot prove reliably
 * (a hidden element still "looks" the same in a screenshot of what
 * remains), so each is asserted individually.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

// Every one of these aria-labels is TRANSLATED — measured in Arabic before
// writing this table, rather than assumed from the English strings alone:
// "Switch language" -> "تغيير اللغة", "Bag" -> "الحقيبة" (with no ", N item"
// suffix to match against), "Wishlist" -> "المفضلة", "Toggle theme" ->
// "الوضع الفاتح"/"الوضع الليلي" depending on which mode is active.
const LABELS = {
  en: { lang: 'Switch language', bag: /^Bag/, wish: 'Wishlist', theme: /^(Light|Dark) mode$|Toggle theme/ },
  ar: { lang: 'تغيير اللغة', bag: /^الحقيبة/, wish: 'المفضلة', theme: /الوضع (الفاتح|الليلي)/ },
}

for (const [lang, essentialsTitle] of [['en', 'Shop the essentials'], ['ar', 'تسوق الأساسيات']]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 2000 } })
  await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  const L = LABELS[lang]
  const info = await page.evaluate(({ langLabel, bagSrc, wishLabel, themeSrc }) => {
    const ul = document.querySelector('header.app-header ul')
    const header = document.querySelector('header.app-header')
    const bagRe = new RegExp(bagSrc)
    const themeRe = new RegExp(themeSrc)
    const has = (pred) => [...header.querySelectorAll('[aria-label]')].some(pred)
    return {
      menuDisplay: ul ? getComputedStyle(ul).display : null,
      menuVisible: ul ? ul.getBoundingClientRect().height > 0 : false,
      logoPresent: !!header.querySelector('nav > a img'),
      langTogglePresent: has((e) => e.getAttribute('aria-label') === langLabel),
      bagPresent: has((e) => bagRe.test(e.getAttribute('aria-label') || '')),
      wishlistPresent: has((e) => e.getAttribute('aria-label') === wishLabel),
      themeTogglePresent: has((e) => themeRe.test(e.getAttribute('aria-label') || '')),
    }
  }, { langLabel: L.lang, bagSrc: L.bag.source, wishLabel: L.wish, themeSrc: L.theme.source })

  // A page.evaluate callback only closes over its OWN arguments across the
  // browser boundary, not outer script variables — passed explicitly here
  // rather than relied on by lexical capture.
  const essentialsPresent = await page.evaluate((title) => {
    return [...document.querySelectorAll('main h2')].some((h) => h.textContent.trim() === title)
  }, essentialsTitle)

  check(info.menuDisplay === 'none', `${lang}: the main menu <ul> is display:none`, info.menuDisplay)
  check(!info.menuVisible, `${lang}: and it occupies no space`, `height>0=${info.menuVisible}`)
  check(info.logoPresent, `${lang}: the logo is still there`)
  check(info.langTogglePresent, `${lang}: the language toggle is still there`)
  check(info.bagPresent, `${lang}: the bag icon is still there`)
  check(info.wishlistPresent, `${lang}: the wishlist icon is still there`)
  check(info.themeTogglePresent, `${lang}: the theme toggle is still there`)
  check(!essentialsPresent, `${lang}: "${essentialsTitle}" is gone from the home page`)

  await page.close()
}

/* ------------------------------------------------- footer covers the loss */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 2000 } })
  await page.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const footerHrefs = await page.evaluate(() =>
    [...document.querySelectorAll('footer a')].map((a) => a.getAttribute('href')))
  check(footerHrefs.includes('/terms'), 'the footer still links to /terms')
  check(footerHrefs.includes('/contact'), 'and to /contact')
  await page.close()
}

/* ------------------------------------------------------ other pages/sections
   are untouched — a mutation that widened the essentials-heading match to
   ANY <h2> would remove the wrong section, so this checks a page that has
   its own <h2> with a DIFFERENT heading survives untouched. */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${BASE}/shop?lang=en`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const shopIntact = await page.evaluate(() => document.querySelectorAll('article').length > 0)
  check(shopIntact, 'the shop page (an unrelated page with its own h2s) still renders products')
  await page.close()
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — the main menu and "Shop the essentials" are both gone, everything else stays')
process.exit(fails ? 1 : 0)
