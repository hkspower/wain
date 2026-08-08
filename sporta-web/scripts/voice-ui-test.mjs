// The voice assistant's microphone, in a real browser.
//
// SpeechRecognition does not exist in Chromium-without-Google-services, and it
// could never be driven by a test anyway — it wants a human and a microphone.
// So the test stubs the CONSTRUCTOR and drives it: that is exactly the seam the
// component is written against, and it proves the two things that can actually
// break in production. One, the button is absent where the API is absent
// (Firefox), because a dead mic button reads as a broken shop. Two, a heard
// sentence is sent as a question AND its reply is played WITHOUT a second tap —
// the hands-free half, which is the whole difference between a chat box and a
// call centre.
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8096'
let fails = 0
const is = (c, n, d = '') => {
  if (!c) fails++
  console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${d ? `  — ${d}` : ''}`)
}

const browser = await chromium.launch({
  // The environment's pre-installed Chromium, same as every other browser
  // suite here. Never `npx playwright install`: it downloads a second browser
  // into a fixed disk allowance.
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
})

// ---------------------------------------------------- where the API is absent
{
  const page = await browser.newPage()
  // Delete it BEFORE any script runs — this is Firefox, as far as the app knows.
  await page.addInitScript(() => {
    delete window.SpeechRecognition
    delete window.webkitSpeechRecognition
  })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Sporta assistant|مساعد سبورتا/ }).click()
  const panel = page.locator('[role="dialog"][aria-label="سبورتا AI"]')
  await panel.waitFor()
  const mic = await panel.locator('button[aria-pressed]').count()
  is(mic === 0, 'no microphone button where the browser has no SpeechRecognition',
     'a dead button reads as a broken shop')
  // …and the shop is still usable by typing, which is the point of hiding it.
  is(await panel.locator('input').isEnabled(),
     'and the visitor can still type — nothing else is taken away')
  await page.close()
}

// ------------------------------------------------------- the spoken round trip
{
  const page = await browser.newPage()
  // A recogniser that reports one sentence the moment it is started. `said` is
  // set from the test so the assertion is about OUR wiring, not about speech.
  await page.addInitScript(() => {
    window.__started = 0
    window.__lang = null
    class FakeRec {
      start() {
        window.__started++
        window.__lang = this.lang
        setTimeout(() => {
          this.onresult?.({ results: [[{ transcript: 'where is my order' }]] })
          this.onend?.()
        }, 10)
      }
      stop() { this.onend?.() }
      abort() {}
    }
    window.SpeechRecognition = FakeRec
    window.webkitSpeechRecognition = FakeRec
  })

  // Count the voice fetches. `auto` must play the answer with no second tap;
  // if it does not, this stays at zero and the feature is decorative.
  const spoken = []
  await page.route('**/api.php?r=say*', (route) => {
    spoken.push(route.request().url())
    // 404 rather than audio: this installation has no ElevenLabs key, and the
    // component must survive that (the words are already on screen).
    route.fulfill({ status: 404, body: '' })
  })

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Sporta assistant|مساعد سبورتا/ }).click()
  // Scoped by name, NOT by [role="dialog"] alone — the bag drawer is a dialog
  // too and is in the DOM from page load, so a bare role selector silently
  // asserts about the wrong panel and passes for the wrong reason.
  const dialog = page.locator('[role="dialog"][aria-label="سبورتا AI"]')
  await dialog.waitFor()

  const mic = dialog.locator('button[aria-pressed]')
  is(await mic.count() === 1, 'the microphone button is there when the browser can hear')

  await mic.click()
  await page.waitForFunction(() => window.__started > 0)
  is(await page.evaluate(() => window.__lang) === 'en-US',
     'it listens in the page’s language', await page.evaluate(() => window.__lang))

  // The heard sentence becomes the question, with no typing and no Send.
  await dialog.getByText('where is my order').waitFor({ timeout: 5000 })
  is(true, 'what was heard is sent as the question — no typing, no Send button')

  // And the answer arrives.
  await page.waitForFunction(
    () => document.querySelectorAll('[aria-label="سبورتا AI"] [aria-live] > div').length >= 3,
    null, { timeout: 10000 },
  )
  is(true, 'and the shop answers')

  await page.close()
}

// ------------------------------------------------------- hands-free, or not
//
// THE HEADLINE, AND THE ONE THING THAT MAKES THIS A CALL CENTRE RATHER THAN A
// CHAT BOX: a question asked ALOUD is answered ALOUD, with no second tap.
//
// The reply is stubbed rather than earned, because the browser rig has no
// ElevenLabs key and so issues no `speak` signature — and it is the CLIENT
// wiring under test here. The server half (that the signature is an HMAC, that
// say.php refuses anything else) is assistant-test.mjs's job.
//
// The negative is the more valuable of the two. A TYPED question must NOT play
// audio: there is no user gesture behind it, so the browser's autoplay policy
// rejects the play() and the visitor gets silence — a feature that appears to
// work for the developer who just clicked something and not for the customer.
{
  const stub = async (page) => {
    await page.route('**/api.php?r=assistant', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reply: 'Delivery is one dinar.', speak: 'a'.repeat(32) }),
    }))
  }

  for (const spokenQuestion of [true, false]) {
    const page = await browser.newPage()
    await page.addInitScript(() => {
      class FakeRec {
        start() {
          setTimeout(() => {
            this.onresult?.({ results: [[{ transcript: 'how much is delivery' }]] })
            this.onend?.()
          }, 10)
        }
        stop() {} abort() {}
      }
      window.SpeechRecognition = FakeRec
    })
    await stub(page)

    const played = []
    await page.route('**/api.php?r=say*', (route) => {
      played.push(1)
      route.fulfill({ status: 404, body: '' })
    })

    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Sporta assistant|مساعد سبورتا/ }).click()
    const d = page.locator('[role="dialog"][aria-label="سبورتا AI"]')
    await d.waitFor()

    if (spokenQuestion) {
      await d.locator('button[aria-pressed]').click()
    } else {
      await d.locator('input').fill('how much is delivery')
      await d.locator('input').press('Enter')
    }
    await d.getByText('Delivery is one dinar.').waitFor({ timeout: 5000 })
    // Give any autoplay a real chance to fire before concluding it did not.
    await page.waitForTimeout(500)

    is(spokenQuestion ? played.length === 1 : played.length === 0,
       spokenQuestion
         ? 'a question ASKED aloud is answered ALOUD, with no second tap'
         : 'a question TYPED is answered in silence — autoplay needs a gesture, and typing is not one',
       `${played.length} audio request(s)`)

    // Either way the button is offered, so the answer can be heard on request.
    is(await d.locator('button[aria-label="Listen to this answer"]').count() === 1,
       spokenQuestion ? 'and it can still be replayed' : 'but it can be played on request')

    await page.close()
  }
}

// ------------------------------------------------------------ Arabic listens ar
{
  const page = await browser.newPage()
  await page.addInitScript(() => {
    window.__lang = null
    class FakeRec {
      start() { window.__lang = this.lang; setTimeout(() => this.onend?.(), 10) }
      stop() {} abort() {}
    }
    window.SpeechRecognition = FakeRec
  })
  await page.goto(`${BASE}/?lang=ar`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /مساعد سبورتا|Sporta assistant/ }).click()
  await page.locator('[role="dialog"][aria-label="سبورتا AI"] button[aria-pressed]').click()
  await page.waitForFunction(() => window.__lang !== null)
  const l = await page.evaluate(() => window.__lang)
  // ar-KW, not ar. "وين طلبي" is not Modern Standard Arabic, and it is the
  // sentence people actually say.
  is(l === 'ar-KW', 'an Arabic visitor is heard in KUWAITI Arabic, not MSA', l)
  await page.close()
}

await browser.close()
console.log(fails ? `\n${fails} problem(s) in the voice assistant` : '\nthe voice assistant hears and answers')
process.exit(fails ? 1 : 0)
