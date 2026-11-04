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
//
// THE DATABASE IT RUNS ON is its own (sporta_wa), built the way sandbox.sh
// builds the shared one: install.mysql.sql, the one-file install, and then
// every additive *.mysql.sql in name order. It used to load schema + seed
// only — the database of the first release — and on today's code the first
// checkout 500'd before the first assertion (the stock claim writes
// inventory_version, the outbox has a CHECK on its kinds, orders carry the
// attribution columns…), so the WhatsApp path was unproven on release code.
//
// THE CONFIG IT RUNS ON is named by SPORTA_API_CONFIG_FILE — the VPS rule,
// see config-path.php — and lives in a temp directory of its own. It used to
// swap dropin/php-store/config.php out and back, which pointed the shared rig
// (php -S :8095 reads that file on every request) at the throwaway database
// for the length of a run, and a crash left the swap in place: native, knet
// and tpay all collapsed at once. Nothing in the repo is written now.
//
// Ports 8106/8107: 8102 was shared with assistant-test's fake model server.

import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const STORE = path.join(ROOT, 'dropin/php-store')
const API_PORT = 8106
const FAKE_PORT = 8107
const API = `http://127.0.0.1:${API_PORT}`
const FAKE = `http://127.0.0.1:${FAKE_PORT}`
const DB = 'sporta_wa'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sporta-wa-'))
const CFG = path.join(TMP, 'api-config.php')
const LOG = path.join(TMP, 'fake-wa.log')
const ENV = { ...process.env, SPORTA_API_CONFIG_FILE: CFG }

let fails = 0
const is = (cond, label, note = '') => {
  if (cond) console.log('ok  ', label, note ? ` — ${note}` : '')
  else { console.log('\x1b[31mFAIL\x1b[0m', label, note ? ` — ${note}` : ''); fails++ }
}
// utf8mb4 on the client too, or Meta's em dash in a stored error comes back
// as a latin1 byte and prints as U+FFFD in a note.
const sql = (q) => run('mariadb', ['--default-character-set=utf8mb4', DB, '-N', '-B', '-e', q]).then((r) => r.stdout.trim())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- a database of its own, so this cannot disturb the other suites --------
await run('mariadb', ['-e', `drop database if exists ${DB};
  create database ${DB} character set utf8mb4 collate utf8mb4_unicode_ci;
  create user if not exists 'sporta'@'localhost' identified by 'test-pass';
  grant all on ${DB}.* to 'sporta'@'localhost';`])
const importSql = (f) => run('bash', ['-c', `mariadb ${DB} < ${JSON.stringify(path.join(STORE, f))}`])
// The same five files sandbox.sh skips after the one-file install: four are
// inside it already, the fifth is it.
const INSTALLED = new Set(['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql'])
await importSql('install.mysql.sql')
const additive = fs.readdirSync(STORE).filter((f) => f.endsWith('.mysql.sql') && !INSTALLED.has(f)).sort()
for (const f of additive) {
  try { await importSql(f) } catch (e) {
    // A migration that fails on a fresh install is a finding, not a setup
    // problem to paper over: the live database gets these same files.
    is(false, `${f} imports on a fresh database`, String(e.stderr ?? e.message).trim().split('\n')[0])
  }
}
// Test stock, same reason as sandbox.sh: the store claims garments inside
// the order and refuses a size with none, and the seed carries the shop's
// real counts. Throwaway database only.
await sql('update product_variants set stock = 1000')
console.log(`database ${DB}: install.mysql.sql + ${additive.length} additive files`)

// ---- config, in a temp file the store is pointed at ------------------------
function phpArr(o) {
  const body = Object.entries(o).map(([k, v]) =>
    `  ${JSON.stringify(k)} => ${typeof v === 'string' ? JSON.stringify(v) : v}`).join(',\n')
  return `[\n${body},\n]`
}
const writeConfig = (extra) => fs.writeFileSync(CFG, `<?php return ${phpArr({
  db_host: 'localhost', db_name: DB, db_user: 'sporta', db_pass: 'test-pass',
  cron_key: 'test-cron-key',
  // Seven orders from one address and one phone in a few seconds; the
  // one-a-minute cooldown is proven on its own store by test:order-cooldown.
  order_cooldown_seconds: 0,
  whatsapp_api_base: FAKE,
  ...extra,
})};\n`)
const FULL = {
  whatsapp_token: 'test-wa-token',
  whatsapp_phone_number_id: '111222333',
  whatsapp_template_confirmed: 'order_confirmed',
  whatsapp_template_shipped: 'order_shipped',
}
writeConfig(FULL)

// ---- servers ----------------------------------------------------------------
fs.writeFileSync(LOG, '')
const startApi = () => spawn('php', ['-S', `127.0.0.1:${API_PORT}`, '-t', STORE], { stdio: 'ignore', env: ENV })
const servers = [
  startApi(),
  spawn('php', ['-S', `127.0.0.1:${FAKE_PORT}`, path.join(HERE, 'fake-whatsapp.php')],
    { stdio: 'ignore', env: { ...process.env, FAKE_WA_LOG: LOG } }),
]
const stop = () => {
  servers.forEach((s) => { try { s.kill() } catch {} })
  fs.rmSync(TMP, { recursive: true, force: true })
}
process.on('exit', stop)
// Up means answering, not started: a fixed sleep is the kind of timing that
// passes on an idle box and fails on a busy one.
const answers = async (url, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    try { await fetch(url); return true } catch { await sleep(100) }
  }
  return false
}
if (!(await answers(`${API}/api.php?r=products`)) || !(await answers(`${FAKE}/`))) {
  console.error(`the store (:${API_PORT}) or the fake Cloud API (:${FAKE_PORT}) did not come up — is the port taken?`)
  process.exit(1)
}

// Rewriting the config is not enough to change what the server SEES: PHP may
// hold a compiled copy for a couple of seconds, so a rewrite followed by a
// request is served the old settings. Sleeping past it looked like it worked
// and then failed one run in three — a flaky test is worse than no test,
// because it teaches everyone to ignore a red result. Restarting the process
// removes the timing from the question entirely.
const reloadApi = async (extra) => {
  writeConfig(extra)
  const old = servers[0]
  await new Promise((r) => { if (old.exitCode !== null) r(); else { old.once('exit', r); old.kill() } })
  servers[0] = startApi()
  if (!(await answers(`${API}/api.php?r=products`))) throw new Error('the store did not come back after a restart')
}

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
// The store's own functions, run under the same config: what the payment
// callbacks call when the bank answers, without a bank.
const inStore = async (code) => {
  const f = path.join(TMP, 'run.php')
  fs.writeFileSync(f, `<?php require ${JSON.stringify(path.join(STORE, 'store.php'))};\n$db = store_db();\n${code}\n`)
  return run('php', [f], { env: ENV })
}

// A garment that is really in the catalogue, in a size it really comes in.
const [slug, size] = (await sql('select slug, size from product_variants where stock > 0 order by slug, size limit 1')).split('\t')
const cust = (over = {}) => ({ name: 'Fatima', phone: '99887766', governorate: 'hawalli',
  area: 'Salmiya', block: '4', street: '12', building: '5', ...over })
let n = 0
const newOrder = async (over = {}, lang = 'ar') => {
  const track = 'SPWA' + (++n) + Date.now().toString(36).toUpperCase()
  const r = await post('order', { track_id: track, customer: cust(over), payment_method: 'knet',
    items: [{ slug, qty: 1, size }], lang })
  const id = await sql(`select id from orders where track_id = '${track}'`)
  if (id === '') {
    // Every later assertion is about this order; without it they would all
    // fail for one reason and name it nowhere.
    is(false, 'the checkout accepts an order on this database', `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
    stop(); process.exit(1)
  }
  return id
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
  const settle = `$db->prepare("update orders set payment_status='paid', paid_at=now() where id=?")->execute([${id}]);
    store_payment_settled($db, ${id}, 'paid');`
  await inStore(settle)
  await inStore(settle)
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
  await inStore(`store_queue_whatsapp($db, ${id}, 'confirmed');`)
  await cron()
  is(logLines().at(-1).template.language.code === 'en',
     'an order placed in English gets the English template')
}

console.log('\n\x1b[1mSHIPPED IS ITS OWN MESSAGE\x1b[0m')
{
  const id = await newOrder()
  await inStore(`store_queue_whatsapp($db, ${id}, 'shipped');`)
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
  await inStore(`store_queue_whatsapp($db, ${id}, 'confirmed');`)
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
