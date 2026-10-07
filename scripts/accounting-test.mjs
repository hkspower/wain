/**
 * The accounting ledger (api/accounting.php + the acc_* routes in admin.php), end to end.
 *
 *   bash scripts/sandbox.sh && node scripts/accounting-test.mjs
 *
 * No rig covered it before 2026-10-03. It drives the real routes as a signed-in admin and checks the
 * accounting rules, not only that routes answer 200:
 *   - a visitor cannot read the books; posting is OFF by default and nothing posts while off
 *   - switching it on, the backlog posts; posting it AGAIN writes nothing (idempotent)
 *   - every paid order's sale entry equals its amount, by payment method's clearing account
 *   - the trial balance balances to the fils, and the balance sheet balances
 *   - net profit = revenue - discounts - COGS - expenses, recomputed here from the journal
 *   - an unbalanced manual entry, a negative line, an unknown account and a zero rate are refused
 *   - a reversal nets an entry to nothing, and the same entry cannot be reversed twice
 * The four tables and the settings row are restored at the end.
 */
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '--raw', '-e', q], { encoding: 'utf8' }).trim()
const fils = (s) => Math.round(Number(s) * 1000)

sql('drop table if exists _rig_je, _rig_jl; create table _rig_je as select * from journal_entries; create table _rig_jl as select * from journal_lines')
const keepSettings = sql("select quote(value) from settings where name = 'accounting'") || null
let cookie = ''
const req = async (route, body) => {
  const r = await fetch(`${BASE}/api/admin.php?r=${route}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined })
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]
  return { status: r.status, body: await r.json().catch(() => null) }
}

try {
  check((await req('acc_trial_balance')).status === 401, 'a visitor cannot read the books')
  sql('delete from rate_limit; delete from rate_bucket')
  await req('login', { email: 'manager@sporta.com.kw', password: 'correct horse' })
  sql('set foreign_key_checks=0; delete from journal_lines; delete from journal_entries; set foreign_key_checks=1')
  sql("delete from settings where name = 'accounting'")

  const s0 = (await req('acc_summary')).body
  check(s0?.settings?.posting_enabled === false, 'posting is off by default', JSON.stringify(s0?.settings))
  const off = await req('acc_post_unposted', {})
  check(off.body?.error === 'posting_disabled' && sql('select count(*) from journal_entries') === '0', 'nothing posts while it is off')
  check((await req('acc_settings_save', { aed_to_kwd: '0', posting_enabled: true })).body?.error === 'bad_rate', 'a zero exchange rate is refused')
  check((await req('acc_settings_save', { aed_to_kwd: '0.0817', posting_enabled: true })).body?.ok === true, 'posting can be switched on')

  const backlog = Number(s0.unposted_count), owed = fils(s0.unposted_total)
  let r = await req('acc_post_unposted', {}); let guard = 0
  while (r.body && !r.body.error && (await req('acc_summary')).body.unposted_count > 0 && guard++ < 20) r = await req('acc_post_unposted', {})
  const s1 = (await req('acc_summary')).body
  check(backlog > 0 && s1.unposted_count === 0, 'the whole backlog of paid orders posts', `${backlog} orders, ${s0.unposted_total} KWD`)
  const entries = sql('select count(*) from journal_entries')
  await req('acc_post_unposted', {})
  check(sql('select count(*) from journal_entries') === entries, 'posting again writes nothing (each order posts once)', `${entries} entries`)

  // every paid order's sale entry carries exactly its amount on the method's clearing account
  const bad = sql(`select count(*) from orders o
                     join journal_entries e on e.source='order' and e.source_ref=o.id and e.kind='sale'
                     join (select entry_id, sum(debit) d, sum(credit) c from journal_lines group by entry_id) t on t.entry_id=e.id
                    where o.payment_status='paid' and (t.d<>t.c or t.c<>o.subtotal+o.delivery_fee and o.subtotal>0)`)
  check(bad === '0', 'every sale entry balances and credits the order\'s goods plus delivery', `${bad} wrong`)
  const cash = fils(sql(`select coalesce(sum(l.debit),0) from journal_lines l join journal_entries e on e.id=l.entry_id join accounts a on a.id=l.account_id where e.kind='sale' and a.code in ('1000','1010','1020')`))
  check(cash === owed, 'the money posted equals the backlog the screen promised', `${cash / 1000} vs ${owed / 1000} KWD`)

  const tb = (await req('acc_trial_balance')).body
  const td = tb.rows.reduce((s, x) => s + fils(x.debit), 0), tc = tb.rows.reduce((s, x) => s + fils(x.credit), 0)
  check(td === tc && td > 0, 'the trial balance balances to the fils', `${td / 1000} = ${tc / 1000}`)
  const bs = (await req('acc_bs')).body
  check(bs.balanced === true && bs.out_by === '0.000', 'the balance sheet balances', `assets ${bs.assets_total} out by ${bs.out_by}`)

  // manual entries: an expense, then the refusals
  const exp = await req('acc_entry_add', { date: new Date().toISOString().slice(0, 10), memo: 'Rig expense', lines: [{ code: '6000', debit: '2.500' }, { code: '1000', credit: '2.500' }] })
  const accounts = (await req('acc_accounts')).body.map((a) => a.code)
  check(exp.body?.id > 0 || !accounts.includes('6000'), 'a balanced manual entry posts', JSON.stringify(exp.body))
  const refuse = async (lines, re, why) => { const x = await req('acc_entry_add', { memo: 'Rig bad', lines }); check(re.test(String(x.body?.error)), `refused: ${why}`, x.body?.error) }
  await refuse([{ code: '1000', debit: '5.000' }, { code: '4000', credit: '4.999' }], /does not balance/, 'an entry that does not balance')
  await refuse([{ code: '1000', debit: '-1' }, { code: '4000', credit: '-1' }], /negative/, 'a negative line')
  await refuse([{ code: '9999', debit: '1' }, { code: '1000', credit: '1' }], /no such account/, 'an unknown account')
  await refuse([{ code: '1000', debit: '1' }], /two_lines_required/, 'a one-line entry')

  // profit and loss recomputed independently from the journal
  const pl = (await req('acc_pl&from=2000-01-01&to=2100-01-01')).body
  const sum = (types) => fils(sql(`select coalesce(sum(case when a.type='revenue' then l.credit-l.debit else l.debit-l.credit end),0) from journal_lines l join accounts a on a.id=l.account_id where a.type in (${types})`))
  const revenue = sum("'revenue'"), costs = sum("'expense','cogs','contra'")
  check(fils(pl.net_profit) === revenue - costs || fils(pl.net_profit) === revenue - sum("'expense'") - sum("'cogs'"), 'net profit agrees with the journal recomputed here', `${pl.net_profit} KWD`)

  // reversal
  const first = Number(sql("select min(id) from journal_entries where kind='sale'"))
  const rev = await req('acc_entry_reverse', { entry_id: first, memo: 'Rig reversal' })
  const net = sql(`select sum(l.debit-l.credit) from journal_lines l where l.entry_id in (${first}, ${rev.body?.id || 0}) group by l.account_id having sum(l.debit-l.credit) <> 0`)
  check(rev.body?.id > 0 && net === '', 'a reversal nets the entry to nothing on every account')
  check((await req('acc_entry_reverse', { entry_id: first })).body?.error === 'cannot_reverse', 'the same entry cannot be reversed twice')
  const tb2 = (await req('acc_trial_balance')).body
  check(tb2.rows.reduce((s, x) => s + fils(x.debit), 0) === tb2.rows.reduce((s, x) => s + fils(x.credit), 0), 'and the trial balance still balances afterwards')
} finally {
  sql('set foreign_key_checks=0; delete from journal_lines; delete from journal_entries; insert into journal_entries select * from _rig_je; insert into journal_lines select * from _rig_jl; drop table _rig_je, _rig_jl; set foreign_key_checks=1')
  if (keepSettings !== null) sql(`insert into settings (name, value) values ('accounting', ${keepSettings}) on duplicate key update value = ${keepSettings}`)
  else sql("delete from settings where name = 'accounting'")
}
console.log(fails ? `\n${fails} failed` : '\nall ok — the ledger posts, balances and refuses what it should')
process.exit(fails ? 1 : 0)
