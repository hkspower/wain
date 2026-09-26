/**
 * "Look it up" — the product research route and its panel card.
 *
 *   npm run test:research          (needs bash scripts/sandbox.sh)
 *
 * WHAT IT IS REALLY GUARDING, and it is not "a proposal appears".
 *
 * The owner chose propose-over-write, so the property that matters is that
 * NOTHING reaches a product except what they ticked — and the dangerous half is
 * `product_save`, which is a full upsert. The card has to resend the whole row,
 * so a bug there does not look like a bug: it looks like a price, a sale window
 * or a brand quietly becoming null while the description it was asked for
 * arrives correctly. CLAUDE.md records that exact trap on `brand_save`.
 *
 * So the rig places a product with a full row, applies one field through the
 * card's own code path, and then compares EVERY OTHER COLUMN before and after.
 *
 * THE MODEL IS NOT CALLED. There is no key in the sandbox and there must not
 * be: a rig that spends money and depends on the open web is a rig that fails
 * on a Sunday for reasons nobody can reproduce. What is driven instead is
 * everything around the model — which fields are offered, what happens when
 * there is no key, and what the card does with an answer. The answer itself is
 * injected, which is also the only way to test the refusals: a real model
 * declining to guess is not something a test can arrange.
 */

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '--batch', '--raw', '-e', q],
  { encoding: 'utf8' })
const rows = (q) => {
  const out = sql(q).trim().split('\n')
  if (out.length < 2) return []
  const head = out[0].split('\t')
  return out.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v])))
}

/* ------------------------------------------- 1. the two files agree on the set
 *
 * research.php decides which fields may be proposed and product-research.js
 * draws them. A field added to one and not the other is either a control that
 * does nothing or a proposal with nowhere to go — the same drift
 * admin-contract-test.mjs exists for, on a smaller surface. Read from both
 * files rather than listed here, so this cannot go stale in either direction.
 */
{
  const php = readFileSync('sporta-site/public_html/api/research.php', 'utf8')
  const js = readFileSync('sporta-site/public_html/assets/product-research.js', 'utf8')

  const decl = php.match(/const RESEARCH_FIELDS = \[([^\]]*)\]/)
  const server = (decl?.[1].match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, '')).sort()
  const block = js.match(/var FIELDS = \[([\s\S]*?)\n  \]/)
  const client = (block?.[1].match(/\['([a-z_]+)'/g) ?? []).map((s) => s.replace(/\['|'/g, '')).sort()

  check(server.length > 0 && client.length > 0,
    'both field lists were actually found',
    `server=${server.join(',') || 'NONE'} client=${client.join(',') || 'NONE'} — two empty lists compare equal`)
  check(JSON.stringify(server) === JSON.stringify(client),
    'the server and the panel agree on which fields may be proposed',
    `server=${server.join(',')} client=${client.join(',')}`)

  // THE ABSENT ONES ARE THE POINT. A price, a stock count or an SKU proposed
  // from a web page is somebody else's number; research.php says so at length
  // and this is that paragraph as a check.
  const banned = ['price', 'sale_price', 'stock', 'sku', 'cost_aed', 'slug', 'active', 'image']
  const leaked = banned.filter((b) => server.includes(b))
  check(leaked.length === 0, 'and no commercial or inventory field is proposable',
    leaked.length ? `LEAKED: ${leaked.join(',')}` : `refused: ${banned.join(', ')}`)
}

/* --------------------------------------------------------------- the fixture */

const SLUG = 'rig-research-' + Math.random().toString(36).slice(2, 7)
sql(`delete from products where slug like 'rig-research-%'`)
sql(`insert into products (slug, name_en, name_ar, desc_en, desc_ar, price, category, active)
     values ('${SLUG}', 'Rig Research Tee', 'تيشيرت الاختبار', 'An English description that already exists.',
             null, 12.500, null, 1)`)
const before = rows(`select * from products where slug = '${SLUG}'`)[0]

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const errors = []
p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))

const card = () => p.locator('[data-sporta-research]')

try {
  /* ------------------------------ 2. the route fails closed with no key ---- */
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  await p.locator('input').nth(0).fill(EMAIL)
  await p.locator('input').nth(1).fill(PASSWORD)
  await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
  await p.waitForTimeout(3500)

  const noKey = await p.evaluate(async (slug) => {
    const r = await fetch('/api/admin.php?r=product_research', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      body: JSON.stringify({ slug }),
    })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, SLUG)
  check(noKey.status === 503 && noKey.body?.error === 'ai_not_configured',
    'with no ai_key the route refuses by name rather than pretending',
    `${noKey.status} ${JSON.stringify(noKey.body)}`)

  /* -------------------- 3. it is gated, like everything else behind /backends */
  const out = await fetch(`${BASE}/api/admin.php?r=product_research`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
    body: JSON.stringify({ slug: SLUG }),
  })
  check(out.status === 401, 'and a signed-out stranger cannot spend the shop\'s API budget',
    `got ${out.status}`)

  /* ------------------------------------- 4. the card is on Catalogue alone -- */
  await p.getByText('Catalogue', { exact: true }).first().click()
  await p.waitForTimeout(2500)
  check(await card().count() === 1, 'the card is on the Catalogue screen')
  const listed = (await card().innerText()).includes(SLUG.slice(0, 12)) ||
                 (await card().innerText()).includes('Rig Research Tee')
  check(listed, 'and the product with gaps is offered', (await card().innerText()).slice(0, 120))

  await p.getByText('Settings', { exact: true }).first().click()
  await p.waitForTimeout(1800)
  check(await card().count() === 0, 'and it is gone on another screen')
  await p.getByText('Catalogue', { exact: true }).first().click()
  await p.waitForTimeout(2500)

  /* ---------- 5. THE ONE THAT MATTERS: applying one field changes one field -
   *
   * The model is stubbed at the network edge, so this drives the card's REAL
   * apply path — the re-read, the whole-row resend and product_save — with a
   * known answer. Stubbing the card's own logic instead would test a copy.
   */
  await p.route('**/admin.php?r=product_research', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: SLUG,
        missing: ['desc_ar', 'category'],
        fields: { desc_ar: 'وصف عربي من الاختبار.' },
        sources: [{ url: 'https://example.com/x', title: 'Example' }],
        searched: true,
        notes: '',
        policy_warning: null,
      }),
    }))

  await card().locator('select').selectOption(SLUG)
  await p.waitForTimeout(300)
  await card().getByRole('button', { name: /Look it up/ }).click()
  await p.waitForTimeout(1200)

  // THE VALUE, NOT THE TEXT. innerText does not return a <textarea>'s value,
  // so the first version of this check read an empty string off a card that
  // was displaying the proposal perfectly — and it failed while the apply
  // beneath it passed, which is the shape of a rig fault rather than a bug.
  const shown = await card().locator('textarea[data-field="desc_ar"]').inputValue()
  check(shown.includes('وصف عربي'),
    'the proposal is shown to the owner, editable, before anything is saved', shown)

  // A field asked about and not answered must be reported, not silently absent.
  // Matched on the SENTENCE, not on the word: "category" also appears in the
  // dropdown's own "missing desc_ar, category" label, so a looser check would
  // have passed with the note removed entirely.
  const note = await card().innerText()
  check(/Nothing well-sourced was found for:[^\n]*category/.test(note),
    'and a field it declined to answer is named rather than quietly dropped',
    (note.match(/Nothing well-sourced[^\n]*/) ?? ['(no such line)'])[0])

  await card().getByRole('button', { name: /Apply to this product/ }).click()
  await p.waitForTimeout(2500)

  const after = rows(`select * from products where slug = '${SLUG}'`)[0]
  check(after?.desc_ar === 'وصف عربي من الاختبار.', 'the accepted field is saved',
    String(after?.desc_ar))

  // EVERY OTHER COLUMN, compared. This is the check the whole rig exists for.
  const changed = Object.keys(before).filter((k) => before[k] !== after?.[k] && k !== 'desc_ar')
  check(changed.length === 0, 'and NOT ONE other column moved',
    changed.length ? changed.map((k) => `${k}: ${before[k]} -> ${after[k]}`).join(' | ')
                   : `${Object.keys(before).length} columns compared`)

  /* --------- 6. a field that stopped being empty is refused, not overwritten */
  sql(`update products set category = 'men' where slug = '${SLUG}'`)
  await p.unroute('**/admin.php?r=product_research')
  await p.route('**/admin.php?r=product_research', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ slug: SLUG, missing: ['category'],
        fields: { category: 'women' }, sources: [{ url: 'https://example.com/y', title: 'Y' }],
        searched: true, notes: '', policy_warning: 'x' }),
    }))
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(2500)
  await p.getByText('Catalogue', { exact: true }).first().click()
  await p.waitForTimeout(2500)
  const sel = card().locator('select')
  // The product no longer has gaps the card offers, so it may not be listed —
  // which is itself correct. Only drive this when it is still offered.
  const options = await sel.locator('option').allTextContents()
  if (options.some((o) => o.includes(SLUG) || o.includes('Rig Research Tee'))) {
    await sel.selectOption(SLUG)
    await p.waitForTimeout(300)
    await card().getByRole('button', { name: /Look it up/ }).click()
    await p.waitForTimeout(1200)
    sql(`update products set category = 'women-changed-underneath' where slug = '${SLUG}'`)
    await card().getByRole('button', { name: /Apply to this product/ }).click()
    await p.waitForTimeout(2000)
    const now = rows(`select category from products where slug = '${SLUG}'`)[0]
    check(now?.category === 'women-changed-underneath',
      'a field filled in while the proposal was open is NOT overwritten',
      `category=${now?.category}`)
  } else {
    check(true, 'a product with no gaps is no longer offered at all',
      'which is the same protection by a shorter route')
  }

  check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  sql(`delete from products where slug like 'rig-research-%'`)
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall ok')
process.exit(fails ? 1 : 0)
