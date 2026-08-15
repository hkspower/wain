// WhatsApp order updates, end to end, against a fake Cloud API that refuses
// the same things Meta refuses.
//
//   npm run test:whatsapp
//
// It runs the real cron against a real MariaDB and a real HTTP server speaking
// the Graph shape. What it is actually protecting:
//
//   * The customer is told when the money SETTLES, never on insert. The
//     warehouse queue deliberately fires before payment; sending a shopper
//     "your order is confirmed" before the bank agrees is a message the shop
//     may have to retract.
//   * One message per order per kind, under a callback that fires twice —
//     which KNET's does, through the customer's browser.
//   * The language is the one the customer was READING, not a guess.
//   * A missing token or template stops the queue instead of burning the
//     retry budget on sends that cannot work.

import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const STORE = path.join(ROOT, 'dropin/php-store')
const API = 'http://127.0.0.1:8102'
const FAKE = 'http://127.0.0.1:8103'
const LOG = '/tmp/fake-wa-test.log'
const DB = 'sporta_wa'

let fails = 0
const is = (cond, label, note = '') => {
  if (cond) console.log('ok  ', label, note ? ` — ${note}` : '')
  else { console.log('\x1b[31mFAIL\x1b[0m', label, note ? ` — ${note}` : ''); fails++ }
}
const sql = (q) => run('mariadb', [DB, '-N', '-B', '-e', q]).then((r) => r.stdout.trim())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- a database of its own, so this cannot disturb the other suites --------
await run('mariadb', ['-e', `drop database if exists ${DB}; create database ${DB}`])
for (const f of ['schema.mysql.sql', 'seed.mysql.sql']) {
  const p = path.join(STORE, f)
  if (fs.existsSync(p)) await run('bash', ['-c', `mariadb ${DB} < ${JSON.stringify(p)}`])
}

// ---- config.php pointing at the fake ---------------------------------------
const CFG = path.join(STORE, 'config.php')
const saved = fs.existsSync(CFG) ? fs.readFileSync(CFG, 'utf8') : null
// REFUSE TO RUN ON A POISONED CONFIG. This file swaps config.php out and puts
// it back on exit, which is fine until a run dies between those two moments:
// the next run then "saves" the TEST config as if it were the real one and
// restores that at the end, quietly pointing the other suites at the throwaway
// database. It happened — native, knet and tpay all collapsed at once, and the
// cause looked nothing like a stale config file.
//
// The voice test carries the same guard for the same reason. If this fires,
// config.php is already a leftover: restore the real one before rerunning.
if (saved !== null && saved.includes('whatsapp_api_base') && saved.includes('127.0.0.1:8103')) {
  console.error('\nconfig.php is a leftover from a crashed run of THIS test.')
  console.error('It points at the fake API and the throwaway database. Restore the real')
  console.error('config.php before running again — otherwise this run would save the')
  console.error('leftover as if it were yours and hand it back to every other suite.\n')
  process.exit(1)
}
const writeConfig = (extra) => fs.writeFileSync(CFG, `<?php return ${phpArr({
  db_host: 'localhost', db_name: DB, db_user: 'sporta', db_pass: 'test-pass',
  cron_key: 'test-cron-key',
  whatsapp_api_base: FAKE,
  ...extra,
})};\n`)
function phpArr(o) {
  const body = Object.entries(o).map(([k, v]) =>
    `  ${JSON.stringify(k)} => ${typeof v === 'string' ? JSON.stringify(v) : v}`).join(',\n')
  return `[\n${body},\n]`
}
const FULL = {
  whatsapp_token: 'test-wa-token',
  whatsapp_phone_number_id: '111222333',
  whatsapp_template_confirmed: 'order_confirmed',
  whatsapp_template_shipped: 'order_shipped',
}
writeConfig(FULL)

// ---- servers ----------------------------------------------------------------
fs.writeFileSync(LOG, '')
const startApi = () => spawn('php', ['-S', '127.0.0.1:8102', '-t', STORE], { stdio: 'ignore' })
const servers = [
  startApi(),
  spawn('php', ['-S', '127.0.0.1:8103', path.join(HERE, 'fake-whatsapp.php')],
    { stdio: 'ignore', env: { ...process.env, FAKE_WA_LOG: LOG } }),
]

// Rewriting config.php is not enough to change what the server SEES: PHP holds
// a compiled copy for a couple of seconds, so a rewrite followed by a request
// is served the old settings. Sleeping past it looked like it worked and then
// failed one run in three — a flaky test is worse than no test, because it
// teaches everyone to ignore a red result. Restarting the process removes the
// timing from the question entirely.
const reloadApi = async (extra) => {
  writeConfig(extra)
  try { servers[0].kill() } catch {}
  await sleep(300)
  servers[0] = startApi()
  await sleep(900)
}
const stop = () => { servers.forEach((s) => { try { s.kill() } catch {} }); if (saved !== null) fs.writeFileSync(CFG, saved); else fs.rmSync(CFG, { force: true }) }
process.on('exit', stop)
await sleep(1200)

const post = async (r, body) => {
  const res = await fetch(`${API}/api.php?r=${r}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let t = await res.text(); try { t = JSON.parse(t) } catch {}
  return { status: res.status, body: t }
}
const cron = async () => {
  const res = await fetch(`${API}/cron-whatsapp.php?key=test-cron-key`)
  let t = await res.text(); try { t = JSON.parse(t) } catch {}
  return { status: res.status, body: t }
}
const logLines = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

const slug = (await (await fetch(`${API}/api.php?r=products`)).json())[0]?.slug
const cust = (over = {}) => ({ name: 'Fatima', phone: '99887766', governorate: 'hawalli',
  area: 'Salmiya', block: '4', street: '12', building: '5', ...over })
let n = 0
const newOrder = async (over = {}, lang = 'ar') => {
  const track = 'SPWA' + (++n) + Date.now().toString(36).toUpperCase()
  await post('order', { track_id: track, customer: cust(over), payment_method: 'knet',
    items: [{ slug, qty: 1, size: 'M' }], lang })
  return sql(`select id from orders where track_id = '${track}'`)
}

console.log('\n\x1b[1mNOTHING IS SENT BEFORE THE MONEY SETTLES\x1b[0m')
{
  const id = await newOrder()
  is((await sql(`select count(*) from whatsapp_outbox where order_id = ${id}`)) === '0',
     'a new unpaid order queues NO customer message')
  await sql(`update orders set payment_status='failed' where id=${id}`)
  is((await sql(`select count(*) from whatsapp_outbox where order_id = ${id}`)) === '0',
     'and a FAILED payment still queues nothing')
}

console.log('\n\x1b[1mON PAYMENT, ONE MESSAGE — AND ONLY ONE\x1b[0m')
{
  const id = await newOrder()
  // Settle it the way the callback does, twice, because KNET's callback comes
  // back through the customer's browser and really does fire more than once.
  const settle = `<?php require '${STORE}/store.php'; $db = store_db();
    $db->prepare("update orders set payment_status='paid', paid_at=now() where id=?")->execute([${id}]);
    store_payment_settled($db, ${id}, 'paid');`
  fs.writeFileSync('/tmp/wa-settle.php', settle)
  await run('php', ['/tmp/wa-settle.php'])
  await run('php', ['/tmp/wa-settle.php'])
  is((await sql(`select count(*) from whatsapp_outbox where order_id=${id} and kind='confirmed'`)) === '1',
     'settling TWICE still queues exactly one confirmation')

  const r = await cron()
  is(r.body?.sent === 1, 'the cron sends it', JSON.stringify(r.body))
  const sentRow = await sql(`select sent_at is not null, wa_message_id from whatsapp_outbox where order_id=${id}`)
  is(sentRow.startsWith('1') && sentRow.includes('wamid.'), 'the row records sent_at and Meta’s message id', sentRow)

  const msg = logLines().at(-1)
  is(msg.type === 'template', 'sent as a TEMPLATE, which is the only thing allowed business-initiated')
  is(msg.to === '96599887766', 'the local 8-digit number became E.164 with the country code', msg.to)
  is(msg.template.language.code === 'ar', 'in the language the customer was reading', msg.template.language.code)
  const vars = msg.template.components[0].parameters.map((p) => p.text)
  is(vars[0] === 'Fatima', 'variable 1 is the name', vars[0])
  is(/^SPWA/.test(vars[1]), 'variable 2 is the order number', vars[1])
  is(/^\d+\.\d{3}$/.test(vars[2]), 'variable 3 is the amount, three decimals like every other price', vars[2])

  const again = await cron()
  is(again.body?.sent === 0, 'a second cron run does not send it again', JSON.stringify(again.body))
}

console.log('\n\x1b[1mLANGUAGE FOLLOWS THE CUSTOMER\x1b[0m')
{
  const id = await newOrder({}, 'en')
  await run('bash', ['-c', `php -r "require '${STORE}/store.php'; \\$db=store_db(); store_queue_whatsapp(\\$db, ${id}, 'confirmed');"`])
  await cron()
  is(logLines().at(-1).template.language.code === 'en',
     'an order placed in English gets the English template')
}

console.log('\n\x1b[1mSHIPPED IS ITS OWN MESSAGE\x1b[0m')
{
  const id = await newOrder()
  await run('bash', ['-c', `php -r "require '${STORE}/store.php'; \\$db=store_db(); store_queue_whatsapp(\\$db, ${id}, 'shipped');"`])
  await cron()
  is(logLines().at(-1).template.name === 'order_shipped', 'the shipped template is used', logLines().at(-1).template.name)
  is((await sql(`select count(*) from whatsapp_outbox where order_id=${id}`)) === '1',
     'shipped and confirmed are separate rows, so one does not block the other')
}

console.log('\n\x1b[1mA NUMBER THE SHOP CANNOT USE IS SKIPPED, NOT GUESSED\x1b[0m')
{
  // The checkout will not ACCEPT a non-Kuwaiti mobile — ?r=order validates the
  // phone, and my first attempt at this test failed because the order was
  // refused before it existed. So the row is created normally and the number
  // corrupted afterwards, which is also the realistic path: an admin editing
  // the delivery details is the one place a stored number can become unusable.
  const id = await newOrder()
  await sql(`update orders set customer_phone = '12345678' where id = ${id}`)
  await run('bash', ['-c', `php -r "require '${STORE}/store.php'; \\$db=store_db(); store_queue_whatsapp(\\$db, ${id}, 'confirmed');"`])
  is((await sql(`select count(*) from whatsapp_outbox where order_id=${id}`)) === '0',
     'an unusable number queues nothing rather than inventing a country code')
}

console.log('\n\x1b[1mMETA’S REFUSALS ARE RECORDED, NOT SWALLOWED\x1b[0m')
{
  const id = await newOrder()
  await sql(`insert into whatsapp_outbox (order_id, kind, to_e164, template, lang, payload)
             values (${id}, 'confirmed', '96599887766', 'no_such_template', 'ar', '{"name":"x","track_id":"y","amount":"1.000"}')`)
  const r = await cron()
  is(r.body?.sent === 0 && r.body?.failed?.length === 1, 'an unapproved template fails the send', JSON.stringify(r.body))
  const err = await sql(`select last_error from whatsapp_outbox where order_id=${id}`)
  is(/does not exist/i.test(err), 'and the REASON is kept, so the fix is obvious', err.slice(0, 60))
  is(!/test-wa-token/.test(err), 'the token is never written into the error')
}

console.log('\n\x1b[1mMISSING CONFIG STOPS THE QUEUE INSTEAD OF BURNING RETRIES\x1b[0m')
{
  const before = await sql('select attempts from whatsapp_outbox order by id desc limit 1')
  await reloadApi({ ...FULL, whatsapp_token: '' })
  const r = await cron()
  is(r.status === 500, 'no token: the cron refuses outright', `${r.status}`)
  const after = await sql('select attempts from whatsapp_outbox order by id desc limit 1')
  is(before === after, 'and it claimed nothing, so no retry budget was spent', `${before} -> ${after}`)
  await reloadApi(FULL)
}

console.log('\n\x1b[1mTHE CRON IS NOT OPEN TO THE INTERNET\x1b[0m')
{
  const res = await fetch(`${API}/cron-whatsapp.php`)
  is(res.status === 403, 'no key is refused', `${res.status}`)
  const bad = await fetch(`${API}/cron-whatsapp.php?key=wrong`)
  is(bad.status === 403, 'a wrong key is refused', `${bad.status}`)
}

console.log(fails ? `\n${fails} problem(s) in the WhatsApp path` : '\nWhatsApp: every check passed')
stop()
process.exit(fails ? 1 : 0)
