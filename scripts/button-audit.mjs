/**
 * Every button, on every screen — does it answer?
 *
 *   bash scripts/sandbox.sh
 *   node scripts/button-audit.mjs
 *   APP=… SITE=… node scripts/button-audit.mjs
 *
 * A control that does nothing is invisible to every other rig in this repo.
 * The contrast rigs measure it, the border rig measures its edge, test:pages
 * checks the page it sits on renders — and all of them pass on a button whose
 * handler was never wired, whose href is '#', or which is covered by something
 * else and cannot be tapped at all. The only way to find that is to press it.
 *
 * So this presses them. For each control it takes a fingerprint of the page —
 * the URL, the rendered text, the number of nodes, how many requests have gone
 * out, where focus is, what is in storage — clicks, waits, and takes it again.
 * If NOTHING moved, the control did nothing, and that is a failure.
 *
 * It also checks, without clicking, the three things that make a control
 * unusable rather than merely inert:
 *
 *   - no accessible name. A screen reader announces "button" and stops. The
 *     shop is bilingual and half its controls are icons, which is exactly the
 *     case where this goes wrong.
 *   - a tap target under 44×44. The project's own standard is TapTarget=48
 *     and Apple's floor is 44; measured on the real rendered box, so a 12px
 *     icon in a 48px pressable passes and a bare 12px icon does not.
 *   - a link with no destination — href '#', '', or 'javascript:'.
 *
 * WHAT IT WILL NOT PRESS, and says so rather than quietly skipping: anything
 * that spends money, sends a message, or cannot be undone — the checkout's
 * pay button, a bank dropin, WhatsApp and tel: links, the admin panel's
 * destructive moves. Those are listed by name in SKIP below with the reason,
 * and they are REPORTED at the end, so the list cannot become a place where a
 * broken button hides.
 */
import { chromium } from 'playwright'

const APP = process.env.APP ?? 'http://127.0.0.1:4173'
const SITE = process.env.SITE ?? 'http://127.0.0.1:4300'

/** The app's own routes, and the website's. Both halves of the shop. */
const ONLY = process.env.ONLY
const PAGES = (ONLY ? (x) => x.filter((r) => r[2] === ONLY) : (x) => x)([
  ['app ', APP, '/'],
  ['app ', APP, '/shop'],
  ['app ', APP, '/cart'],
  ['app ', APP, '/account'],
  ['app ', APP, '/exchange'],
  ['app ', APP, '/product/cloudsoft-jacket-army-green'],
  ['site', SITE, '/'],
  ['site', SITE, '/shop'],
  ['site', SITE, '/cart'],
  ['site', SITE, '/about'],
  ['site', SITE, '/contact'],
  ['site', SITE, '/returns'],
  ['site', SITE, '/returns/request'],
  ['site', SITE, '/card'],
  ['site', SITE, '/product/cloudsoft-jacket-army-green'],
])

/**
 * Controls that are NOT pressed, and why. Matched against the accessible name
 * and the href, case-insensitively. Every one of these is reported at the end
 * with its reason — a skip nobody can see is a hiding place.
 */
const SKIP = [
  [/wa\.me|whatsapp|واتساب/i, 'sends a real message to the shop'],
  [/^tel:|^mailto:/i, 'opens a dialler or a mail client'],
  [/checkout|الدفع|ادفع|place order|إتمام/i, 'takes money'],
  [/knet|t-?pay|pay\.php/i, "the bank's hosted page"],
  [/sign out|تسجيل الخروج|logout/i, 'ends the session the rig is using'],
  [/delete|حذف|remove|إزالة/i, 'destructive'],
  [/instagram|facebook|twitter|tiktok/i, 'leaves the site'],
]

const skipFor = (name, href) => {
  for (const [re, why] of SKIP) if (re.test(name) || re.test(href)) return why
  return null
}

let fails = 0, pressed = 0, seen = 0
const dead = []
const unnamed = []
const small = []
const nowhere = []
const skipped = []
const offCanvas = []
const skipLinks = []
const inert = []
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ' — ' + extra : ''}`)
}

/** Enumerate the controls, with everything needed to judge them, in the page. */
const LIST = () => {
  const SEL = 'button, a, input[type=submit], input[type=button], summary,' +
              '[role="button"], [role="link"], [role="radio"], [role="checkbox"],' +
              '[role="switch"], [role="tab"], [role="menuitem"]'
  const out = []
  document.querySelectorAll(SEL).forEach((el, i) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return
    if (r.width === 0 && r.height === 0) return
    // A stable handle. Playwright locators go stale across a React re-render,
    // so each control is stamped and looked up again by the stamp.
    el.setAttribute('data-audit', String(i))
    // The accessible name, near enough: what a screen reader would read.
    const name = (
      el.getAttribute('aria-label') ||
      (el.getAttribute('aria-labelledby')
        ? (document.getElementById(el.getAttribute('aria-labelledby'))?.textContent ?? '')
        : '') ||
      el.textContent ||
      el.getAttribute('title') ||
      // An icon-only control whose only label is on an <img> or an <svg>.
      el.querySelector('img[alt]')?.getAttribute('alt') ||
      el.querySelector('svg title')?.textContent ||
      el.getAttribute('value') ||
      ''
    ).trim().replace(/\s+/g, ' ')
    out.push({
      stamp: String(i),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') ?? '',
      name: name.slice(0, 60),
      href: el.getAttribute('href') ?? '',
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
      // Is it ALREADY the selected one? The page says so itself, in the
      // attributes it hands a screen reader.
      current: el.getAttribute('aria-current') !== null &&
               el.getAttribute('aria-current') !== 'false',
      pressed: el.getAttribute('aria-pressed') === 'true' ||
               el.getAttribute('aria-selected') === 'true' ||
               el.getAttribute('aria-checked') === 'true',
      w: Math.round(r.width),
      h: Math.round(r.height),
      // NO "is something covering it" CHECK HERE, deliberately. There was one,
      // measured with elementFromPoint at load, and it reported the product
      // page's two size-help buttons as unreachable: they sit at y=822 in an
      // 844-high viewport, under the sticky action bar, and the bar's own
      // buttons are what elementFromPoint finds. Both click perfectly — the
      // customer scrolls a little, exactly as they would for anything else
      // under a fixed bottom bar.
      //
      // Coverage at ONE scroll position is not the question. The question is
      // whether the control can be reached at all, and the click below is the
      // ground truth for that: Playwright scrolls it into view first and then
      // refuses, naming the element in the way, only if something really is
      // permanently on top.
    })
  })
  return out
}

/**
 * What the page looks like right now, in one comparable object.
 *
 * TWO HASHES AND A COUNTER, and each of the three is here because a cheaper
 * version of it missed something real:
 *
 *   html   a hash of the markup, NOT its length. It was a length, and the
 *          quantity stepper on the product page reads "1" before and "2"
 *          after — same length, so the rig called it dead. A hash also picks
 *          up the class change on a size pill that has no aria state to flip,
 *          which is the only trace some selections leave.
 *
 *   geom   where everything IS, over the WHOLE document. It was the first
 *          three hundred elements, and the cart drawer is not in the first
 *          three hundred: pressing the bag slid it from x=-390 to x=0, the
 *          most visible response on the site, and the rig saw nothing. Some
 *          of this shop's most important controls change no markup at all.
 *
 *   store  localStorage, for the basket and the theme.
 *
 * FOCUS IS DELIBERATELY ABSENT. It was in here, and it made the whole file
 * worthless: clicking a button moves focus to that button, so every control
 * "responded" whatever it did. Proved by mutation — the loyalty page's submit
 * button, neutered to a <button type="button"> with nothing bound to it, was
 * reported as answering. Only what a CUSTOMER can see counts.
 */
const PRINT = () => {
  const hash = (s) => {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
    return h
  }
  let g = 0
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    g = (Math.imul(g, 31) + Math.round(r.x) * 7 + Math.round(r.y) * 3 + Math.round(r.width)) | 0
  }
  return {
    url: location.href,
    html: hash(document.body.innerHTML),
    geom: g,
    store: (() => { try { return JSON.stringify(localStorage).length } catch { return 0 } })(),
  }
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

for (const [half, base, path] of PAGES) {
  const where = `${half} ${path}`
  // reducedMotion, and animations killed outright below. The product page uses
  // scroll-driven animations, and Playwright refuses to click an element that
  // is still moving — it reported thirty-six "not stable" controls that are
  // perfectly clickable by a person, because a person does not insist the
  // button hold still first.
  // hasTouch AND isMobile, not merely a 390px viewport. This matters for the
  // tap-target check and it caught this file out: the website sizes its header
  // icons with `.tap { min-width: 44px }` inside @media (pointer: coarse), so
  // a desktop-pointer browser at phone width computes min-width:auto and the
  // icons measure 22x22. They are 44 on an actual phone. Measuring 98 tap
  // targets as too small, every one of them fine in the hand, is what a
  // narrow window gets you — a phone is not a small desktop.
  const p = await b.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    hasTouch: true,
    isMobile: true,
  })
  await p.addInitScript(() => {
    const kill = document.createElement('style')
    kill.textContent =
      '*,*::before,*::after{animation:none !important;transition:none !important;' +
      'animation-timeline:auto !important;scroll-behavior:auto !important}'
    const put = () => document.head?.appendChild(kill)
    if (document.head) put()
    else document.addEventListener('DOMContentLoaded', put)
  })
  // A new tab per page, and popups are closed as they open: a control that
  // opens one is answering, and letting them pile up drifts the fingerprint.
  p.on('popup', (pop) => pop.close().catch(() => {}))

  let requests = 0
  p.on('request', () => { requests++ })

  try {
    await p.goto(base + path, { waitUntil: 'networkidle' })
  } catch (e) {
    check(false, `${where} loads`, String(e).slice(0, 90))
    await p.close()
    continue
  }
  await p.waitForTimeout(1200)

  const all = await p.evaluate(LIST)
  seen += all.length

  // ONE PRESS PER DISTINCT CONTROL, not per instance. The shop page carries
  // fifty "add" buttons rendered by one component; pressing all fifty proves
  // nothing the third does not, and it is what turned the first run of this
  // file into something that had not finished a page in ten minutes. Controls
  // are grouped by what they ARE — tag, role, rendered size, and the SHAPE of
  // the name with the words replaced — and three of each group are pressed.
  const signature = (c) =>
    `${c.tag}|${c.role}|${c.w}x${c.h}|${c.name.replace(/[\p{L}\p{N}]+/gu, '.').slice(0, 24)}`
  const groups = new Map()
  for (const c of all) {
    const k = signature(c)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(c)
  }
  const controls = [...groups.values()].flatMap((g) => g.slice(0, 3))
  const represented = all.length - controls.length

  let deadHere = 0, pressedHere = 0, dirty = false
  for (const c of controls) {
    const label = `${where} <${c.tag}${c.role ? ' role=' + c.role : ''}> "${c.name || '(no name)'}"`

    // --- the three static faults ------------------------------------------
    if (!c.name) unnamed.push(label)
    // A disabled control is allowed to be small and is not pressed — it is
    // announcing that it cannot be used, which is itself a response.
    if (!c.disabled && (c.w < 44 || c.h < 44)) small.push(`${label} ${c.w}×${c.h}`)
    if (c.tag === 'a' && (!c.href || c.href === '#' || /^javascript:/i.test(c.href))) {
      nowhere.push(`${label} href="${c.href}"`)
    }
    if (c.disabled) continue

    // A SKIP LINK is parked off-screen on purpose and appears on focus. That
    // is the pattern working, not a fault — so it is tested the way it is
    // used: focus it, and it must come into view. One that never appears is
    // genuinely broken, and this is the only check that would find it.
    if (/تجاوز|skip to/i.test(c.name)) {
      const el = p.locator(`[data-audit="${c.stamp}"]`).first()
      const shown = await el.evaluate((n) => {
        n.focus()
        return new Promise((res) =>
          setTimeout(() => res(n.getBoundingClientRect().top >= 0), 250))
      }).catch(() => false)
      if (shown) skipLinks.push(`${label} — parked off-screen, appears on focus`)
      else {
        dead.push(`${label} — a skip link that never appears, even focused`)
        deadHere++
      }
      continue
    }

    // OFF-CANVAS. A control sitting outside the viewport is normally inside a
    // menu or drawer that is closed, and calling it dead would be a lie — the
    // rig simply cannot reach it without knowing how this particular drawer
    // opens. Reported, so it is visible, and not counted as a failure.
    if (c.w > 0 && c.h > 0) {
      const box = await p.locator(`[data-audit="${c.stamp}"]`).first()
        .boundingBox().catch(() => null)
      if (box && (box.x + box.width <= 0 || box.x >= 390)) {
        offCanvas.push(`${label} at x=${Math.round(box.x)} — outside the page, probably in a closed drawer`)
        continue
      }
    }

    const why = skipFor(c.name, c.href)
    if (why) { skipped.push(`${label} — ${why}`); continue }

    // ALREADY THERE. A control that puts the page into the state it is
    // already in is SUPPOSED to do nothing: the Home tab on the home page, the
    // "All" filter when nothing is filtered, the Arabic radio in an Arabic
    // app. Pressing it and finding the page unchanged is the correct
    // behaviour, not a dead button — so these are reported rather than failed,
    // and they are still pressed, so one that throws is still caught.
    const already =
      c.current || c.pressed ||
      (c.href && new URL(c.href, base + path).href.replace(/\/$/, '') ===
                 (base + path).replace(/\/$/, ''))

    // --- press it ----------------------------------------------------------
    // An external destination is answered for by its href: following it would
    // leave the shop, and the point of the check is that the control leads
    // SOMEWHERE, which the attribute already proves.
    if (/^https?:/i.test(c.href) && !c.href.startsWith(base)) {
      pressedHere++
      continue
    }

    const el = p.locator(`[data-audit="${c.stamp}"]`).first()
    if ((await el.count()) === 0) continue        // re-rendered away between passes

    // A PRESS THAT CHANGED THE PAGE WITHOUT LEAVING IT dirties everything
    // after it. Two buttons on the product page raise the same "choose a
    // size" message; the first showed it and the second found it already
    // there, so the second read as dead. Reload when the page was left
    // changed, and only then — most presses either navigate or do very little,
    // so this costs a reload on a handful of controls rather than on all 283.
    if (dirty) {
      await p.goto(base + path, { waitUntil: 'domcontentloaded' })
      await p.waitForTimeout(700)
      await p.evaluate(LIST)
      dirty = false
    }

    const before = await p.evaluate(PRINT)
    const reqBefore = requests
    try {
      await el.click({ timeout: 3000, noWaitAfter: true })
    } catch (e) {
      // The REASON, not just the fact. Playwright refuses a click when another
      // element would receive it, and says which — that message is the finding,
      // and without it this line reads as fifty broken buttons.
      // The REASON, and WHAT DID IT. Playwright names the element that
      // receives the click instead — that name is the finding, and without it
      // the line reads as a broken button rather than as something painted
      // over it.
      const m = String(e)
      const blocker = m.match(/<[^>]{0,70}>\s*(?:from)?\s*intercepts pointer events/)
      const why = blocker
        ? `blocked by ${blocker[0].replace(/\s*(from\s*)?intercepts pointer events/, '')}`
        : (m.match(/outside of the viewport|not stable|not visible|not enabled/) ?? ['?'])[0]
      dead.push(`${label} — could not be clicked: ${why}`)
      deadHere++
      continue
    }
    await p.waitForTimeout(450)
    const after = await p.evaluate(PRINT).catch(() => null)
    pressedHere++
    pressed++

    // Navigated away entirely: unambiguously a response.
    if (after === null || after.url !== before.url) {
      // domcontentloaded, not networkidle: this is a reset between presses
      // rather than the measurement, and networkidle here doubles the run.
      await p.goto(base + path, { waitUntil: 'domcontentloaded' })
      await p.waitForTimeout(700)
      await p.evaluate(LIST)                       // re-stamp after the reload
      continue
    }

    // AN OVERLAY LEFT OPEN BLOCKS EVERY CONTROL AFTER IT. This file reported
    // the header's search button dead on seven pages and thirty-six controls
    // dead on the product page; every one of them clicks perfectly in
    // isolation. What had actually happened is that an earlier press opened
    // the cart drawer or the gallery lightbox, and everything after it was
    // clicking into the back of a modal.
    //
    // The detector is the site's OWN declaration — [aria-modal="true"] — not a
    // node count. A slide-in drawer is in the DOM the whole time and only
    // moves, so counting nodes finds nothing; the attribute is exact, and it
    // is the same one that tells a screen reader the rest of the page is inert.
    const modalOpen = () => p.evaluate(() =>
      [...document.querySelectorAll('[aria-modal="true"]')].some((d) => {
        const r = d.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== 'hidden' &&
               r.left < innerWidth && r.right > 0
      }))

    const moved =
      after.html !== before.html ||
      after.geom !== before.geom ||
      after.store !== before.store ||
      requests > reqBefore

    if (moved) dirty = true
    if (!moved) {
      if (already) {
        inert.push(`${label} — the page is already in the state it would set`)
      } else {
        dead.push(`${label} — nothing changed: no navigation, no DOM, no request, no geometry, no state`)
        deadHere++
      }
    }

    // Escape first, because that is what a person does and it is the cheaper
    // reset; a reload only if the modal is still there.
    if (await modalOpen().catch(() => false)) {
      await p.keyboard.press('Escape').catch(() => {})
      await p.waitForTimeout(350)
      if (await modalOpen().catch(() => false)) {
        await p.goto(base + path, { waitUntil: 'domcontentloaded' })
        await p.waitForTimeout(700)
        await p.evaluate(LIST)
      }
    }
  }

  check(deadHere === 0,
    `${where.padEnd(46)} ${all.length} controls, ${pressedHere} pressed` +
    (represented ? `, ${represented} identical to one that was` : ''),
    `${deadHere} did nothing`)
  await p.close()
}

const list = (title, rows, n = 10) => {
  if (!rows.length) return
  console.log(`\n--- ${title} (${rows.length}) ---`)
  for (const r of rows.slice(0, n)) console.log('  ' + r)
  if (rows.length > n) console.log(`  … and ${rows.length - n} more`)
}

list('DEAD — pressed and nothing happened', dead, 20)
list('no accessible name — a screen reader announces the role and stops', unnamed)
list('under 44×44 — Apple\'s floor, and this project\'s TapTarget is 48', small)
list('a link with no destination', nowhere)
list('inert on purpose — already in the state they would set', inert, 10)
list('off-canvas — not reachable without opening whatever holds them', offCanvas, 8)
list('skip links, working as intended', skipLinks, 3)
list('not pressed, and why', skipped, 14)

console.log(`\n${seen} controls found, ${pressed} pressed, across ${PAGES.length} pages`)
console.log(fails ? `${fails} pages carry a control that does nothing` : 'all ok — every button answers')
await b.close()
process.exit(fails ? 1 : 0)
