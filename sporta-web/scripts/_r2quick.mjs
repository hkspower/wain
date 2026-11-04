// سبورتا AI, against the real database.
//
//   npm run test:assistant     (needs MariaDB and php -S 127.0.0.1:8095 php-store)
//
// The assistant answers questions about money and delivery, so the thing being
// tested is not "does it reply" — it is "is the reply TRUE". Every check below
// puts a known row in the database and asks whether the answer matches it.
//
// The Arabic half is the larger half on purpose. A keyword list that does not
// fold hamza, alef maqsura, ta marbuta, tatweel and Arabic-Indic digits
// matches almost no real question, and it fails silently: the English tests
// pass, the shop looks bilingual, and half the customers get "I did not quite
// follow that" for every sentence they type.
import { execFile, spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { runRegression } from './assistant-regression.mjs'

const BASE = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'
const run = promisify(execFile)
const sql = async (q) => (await run('mariadb', ['sporta', '-N', '-B', '-e', q])).stdout.trim()

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)

// The endpoint is throttled at 30/minute per IP — correctly, since it is
// unauthenticated and hits the database. A suite firing forty questions in a
// second trips it and every check after that fails as 429, which reads like
// forty broken features instead of one working guard. So the counter is reset
// between sections, and the throttle gets a deliberate test of its own at the
// end where it cannot poison anything.
const unthrottle = () => sql('delete from rate_limit')

// Wait until the server is answering with (or without) a voice configured.
// See the note at the voice section: a config file rewritten on disk is not a
// config file the PHP process has read yet.
const settle = async (wantVoice) => {
  for (let i = 0; i < 80; i++) {
    const { body } = await ask('when will it arrive')
    if ((body?.speak !== undefined) === wantVoice) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

const ask = async (message, lang = 'en') => {
  const res = await fetch(`${BASE}/api.php?r=assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, lang }),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

// STRAIGHT INTO PHP, for the checks that need many answers or a database
// state no customer could create. No HTTP, so no rate limit to dodge; and a
// database change runs inside a transaction that is rolled back, so a crash
// mid-check leaves nothing behind. The input travels as JSON in $argv[1].
const AP = new URL('../dropin/php-store/assistant.php', import.meta.url).pathname
const SP = new URL('../dropin/php-store/store.php', import.meta.url).pathname
const php = async (code, input = null) => {
  const { stdout } = await run('php', ['-r', code, '--', JSON.stringify(input)], { maxBuffer: 16 << 20 })
  return JSON.parse(stdout)
}
const intents = (msgs) => php(`require ${JSON.stringify(AP)};
  echo json_encode(array_map('assistant_intent', json_decode($argv[1], true)));`, msgs)
// assistant_answer for each [message, lang], with `sql` applied first and
// rolled back after. One process per call: the catalogue and the settings
// are read once per request, exactly as on the server.
const answersIn = (sql, msgs, cfg = {}) => php(`require ${JSON.stringify(SP)}; require ${JSON.stringify(AP)};
  $in = json_decode($argv[1], true); $db = store_db(); $cfg = array_merge(store_config(), $in['cfg']);
  $db->beginTransaction();
  try { foreach ($in['sql'] as $s) $db->exec($s);
        $out = []; foreach ($in['msgs'] as [$m, $l]) $out[] = assistant_answer($db, $cfg, $m, $l); }
  finally { $db->rollBack(); }
  echo json_encode($out, JSON_UNESCAPED_UNICODE);`, { sql, msgs, cfg })
const slugs = (a) => (a?.data?.items ?? []).map((p) => p.slug)
const canned = (key, ar, cfg = {}) => php(`require ${JSON.stringify(AP)}; $in = json_decode($argv[1], true);
  echo json_encode(assistant_canned($in['cfg'], $in['key'], $in['ar']), JSON_UNESCAPED_UNICODE);`, { key, ar, cfg })
// How many fixed sentences the warmer buys per language. Read from the PHP,
// asserted against the number written here, so adding a line is a decision
// this file notices (and the warmer's "N of 2N warm" moves with it).
const CANNED = 46
const routes = (msgs) => php(`require ${JSON.stringify(AP)};
  echo json_encode(array_map('assistant_route', json_decode($argv[1], true)), JSON_UNESCAPED_UNICODE);`, msgs)

await unthrottle()
// ================================================== ROUND 2 REVIEW (assistant lane)
//
// Nineteen findings from the second independent review, each quoted as the
// customer wrote it. They are routing tests (assistant_route straight into PHP,
// one process for the lot) plus a few answer-level ones. The rule they share:
// a message that a PERSON must read (a cancel, a payment that moved, a
// complaint) must reach one, and a message that is only a question must not be
// emailed to the shop as a problem.
{
  const R = async (rows) => {
    const out = await routes(rows.map((r) => r[0]))
    rows.forEach(([q, want, topic], i) => {
      const got = out[i] ?? []
      const okIntent = got[0] === want
      const okTopic = topic === undefined || (got[1] ?? null) === topic
      is(okIntent && okTopic, `«${q}» -> ${want}${topic !== undefined ? '/' + topic : ''}`, `${got[0]}/${got[1] ?? ''}`)
    })
  }

  head('r2 #1/#14/#18: a cancel or a stop, however it is worded or misspelled, is a CANCEL')
  await R([
    ['وقفوا الطلب SP9PACKED001', 'cancel'], ['SP9PACKED001 I no longer need it', 'cancel'], ['stop shipping my order', 'cancel'],
    ['وقفوا الطلب', 'cancel'], ['وقف طلبي', 'cancel'], ['لا تجهزون طلبي', 'cancel'], ['لا اريد الطلب', 'cancel'],
    ['لا ارغب بالطلب', 'cancel'], ['ما بغيت الطلب', 'cancel'], ["I don't need the order", 'cancel'],
    ['I do not want this order', 'cancel'], ['hold my order', 'cancel'], ["don't prepare my order", 'cancel'],
    ['cansel my order', 'cancel'], ['cancal my order', 'cancel'], ['canccel my order', 'cancel'],
    ['kancel my order', 'cancel'], ['canel my order', 'cancel'],
    ['ما عاد ابي الطلب', 'cancel'], ['ماعاد ابغى الطلب', 'cancel'], ['ما عاد ابغى اشتري', 'cancel'], ['لا تجهزون الطلب', 'cancel'],
    ['ابي استرجع طلبي قبل لا يوصل', 'cancel'],
    ['stop the delivery', 'cancel'], ['pause my delivery', 'cancel'], ['no need to deliver', 'cancel'],
    ['اوقفوا الشحنه', 'cancel'], ['وقف التوصيل', 'cancel'], ['اوقفوا التوصيل', 'cancel'],
    ['please stop the delivery of my order', 'cancel'], ['can you stop the shipment', 'cancel'], ['hold the shipment', 'cancel'],
    ["I don't need the order anymore", 'cancel'], ['I want the order removed', 'cancel'], ['ما اشتي الطلب', 'cancel'],
    ['please stop the delivery I am travelling', 'contact', 'order_change'],
    ['hold my delivery until sunday', 'contact', 'order_change'],
    // …and the opposite of a request is still a person's, not a cancellation.
    ["please don't stop my order", 'contact'],
  ])

  head('r2 #3: money outranks cancel; a cancel of something that is not an order is not CANCEL')
  await R([
    ['I was charged twice, please cancel the duplicate', 'contact', 'money'],
    ['ابي الغي الطلب لان انخصم مني مرتين', 'contact', 'money'],
    ['cancel my return request', 'contact'], ['cancel the coupon', 'contact'], ['cancel my account', 'contact', 'privacy_request'],
    ['cancel the jacket and keep the leggings', 'contact', 'order_change'], ['ابي الغي الكود', 'contact'],
    ['الغي طلب الارجاع', 'contact'],
    ['what is your cancellation policy', 'returns'], ['if I cancel do I get a refund', 'returns'], ['is cancellation free', 'returns'],
    // a real cancel is still a cancel
    ['please cancel my order', 'cancel'], ['ابي الغي طلبي', 'cancel'],
  ])

  head('r2 #2/#13: money that left the account, said any way and spelled any way, reaches a person')
  await R([
    ['I see two transactions on my bank statement', 'contact', 'money'], ['duplicate transaction on my statement', 'contact', 'money'],
    ['I lost my money', 'contact', 'money'], ['you kept my money', 'contact', 'money'],
    ['paid the amount, order not visible', 'contact', 'money'], ['حولت المبلغ ولا انعمل الطلب', 'contact', 'money'],
    ['تم تحويل المبلغ ولم يتم تأكيد الطلب', 'contact', 'money'], ['انقص رصيدي والطلب ما تأكد', 'contact', 'money'],
    ['نقص من حسابي ١٠ دنانير', 'contact', 'money'], ['قصوا من حسابي فلوس', 'contact', 'money'],
    ['ما انرجعت الفلوس', 'contact', 'refund'], ['payment went but order missing', 'contact', 'money'],
    ['KD 8 gone from my card', 'contact', 'money'], ['طلع من بطاقتي مبلغ والطلب ما ظهر', 'contact', 'money'],
    ['بنكي خصم ولا شفت طلبي', 'contact', 'money'],
    // no apostrophe, and a joined «ما»
    ['payment went through but i didnt get an email', 'contact', 'money'], ['دفعت وماجاني تأكيد', 'contact', 'money'],
    ['دفعت بالكي نت وماجاني ايميل', 'contact', 'money'], ['دفعت ماتاكد الطلب', 'contact', 'money'],
    ['I paid but didnt get any confirmation', 'contact', 'money'], ['i paid but order didnt go through', 'contact', 'money'],
    ['i paid but the order didnt show up', 'contact', 'money'],
    ["payment went through but i didn't get an email", 'contact', 'money'],
    // and what must NOT become one
    ['how do I pay', 'payment'], ['can I pay by knet', 'payment'],
  ])

  head('r2 #4: a question about WHEN the card is charged is a payment question')
  await R([
    ['is my card charged immediately?', 'payment'], ['هل ينخصم المبلغ مباشرة؟', 'payment'],
    ["I haven't paid yet, how do I pay", 'payment'], ['will my card be charged now or later', 'payment'],
    ['is my card charged at checkout', 'payment'],
  ])

  head('r2 #5: "can I still get a refund" is the policy; a refund chase is a chase')
  await R([
    ['can I still get a refund?', 'returns'], ['can I still get my money back', 'returns'],
    ['am I still eligible for a refund', 'returns'], ['where to request a refund', 'returns'],
    ['do I still get my money back after 15 days', 'returns'], ["I've changed my mind, can I still get a refund", 'returns'],
    ['رجعت القطعة ولا استلمت الفلوس', 'contact', 'refund'], ['where is my refund', 'contact', 'refund'],
  ])

  head('r2 #6: "I changed my mind" with a don\'t-want clause is a person, not a dead end')
  await R([
    ['غيرت رايي ما ابي', 'contact'], ["I changed my mind, I don't want it", 'contact'], ['I changed my mind about buying', 'contact'],
    ['غيرت راي', 'contact'], ['ما ابي ابي غيرت رايي', 'contact'], ['I changed my mind', 'contact'],
    ['غيرت رايي في اللون', 'contact'],
  ])

  head('r2 #7: where is my shipment / the jacket I ordered is a look-up')
  await R([
    ['وين شحنتي؟', 'order_status'], ['وين الشحنة', 'order_status'], ['اين الشحنة', 'order_status'], ['وين الطرد', 'order_status'],
    ['has it shipped yet', 'order_status'], ['is it shipped', 'order_status'], ['has the courier picked it up', 'order_status'],
    ['where is the jacket I ordered', 'order_status'], ['وين الجاكيت اللي طلبته', 'order_status'],
    ['وين الاوردر', 'order_status'], ['الاوردر ما وصل', 'order_status'],
  ])

  head('r2 #8: Gulf "call me" is a request for a person')
  await R([
    ['ممكن تتصلون علي؟', 'contact'], ['ابي احد يتصل فيني', 'contact'], ['ابيكم تتصلون', 'contact'],
    ['a7ad ykalemni', 'contact'], ['تكلمني', 'contact'],
  ])

  head('r2 #9: a named item the shop does not sell, with a size, is "we do not carry that"')
  await R([
    ['do you have running shoes in size 43', 'search'], ['ابي حذاء رياضي مقاس 43', 'search'], ['nike shoes size 42', 'search'],
    ['hi, do you have size 42?', 'search'],
    ['what size should I get', 'sizes'], ['do you have size M', 'sizes'],
  ])
  {
    const A = await answersIn([], [['do you have running shoes in size 43', 'en'], ['ابي حذاء رياضي مقاس 43', 'ar'], ['nike shoes size 42', 'en']])
    const NC = [await canned('not_carried', false), await canned('not_carried', true), await canned('not_carried', false)]
    A.forEach((a, i) => is(a.reply === NC[i], `shoes + a size is answered "not carried": ${a.reply.slice(0, 40)}`, a.reply))
  }

  head('r2 #11: English loanwords written in Arabic script are understood')
  await R([
    ['ابي ريتيرن', 'returns'], ['ابي ريفند', 'returns'], ['ابي ايكسشينج', 'returns'], ['كم الديليفري', 'delivery'],
    ['ابي اتكلم مع الكاستمر سيرفس', 'contact'], ['شنو السايز المناسب', 'sizes'], ['وين الديليفري', 'order_status'],
  ])
  {
    const [a] = await answersIn([], [['عندكم ليقنز بلاك', 'ar']])
    is(/black/.test(slugs(a)[0] ?? ''), 'بلاك is the colour black: the first card is a black one', slugs(a).join(','))
  }

  head('r2 #12: a greeting with a question gets the question answered (or logged), not the Welcome line')
  await R([
    ['hi what time do you close', 'location'], ['hello are you open now', 'location'],
    ['السلام عليكم هل انتم مفتوحين', 'location'], ['what are your opening hours', 'location'],
    ['hi', 'greeting'], ['hello how are you', 'greeting'], ['السلام عليكم ورحمة الله وبركاته', 'greeting'],
  ])
  {
    const Q = [['هلا، عندكم خدمة طباعة؟', 'ar'], ['hi do you have wholesale prices', 'en'], ['hi do you have anything for kids', 'en'],
               ['hello do you have school uniform', 'en']]
    const A = await answersIn([], Q)
    A.forEach((a, i) => is(a.intent === 'search', `greeting + «${Q[i][0]}» is searched (and logged as a gap), not Welcome`, a.intent))
  }

  head('r2 #15: a pasted card number never leaves the server')
  {
    const msg = 'I was charged twice, my card is 4111 1111 1111 1111 exp 12/27 cvv 123, please refund'
    const out = await php(`require ${JSON.stringify(AP)};
      echo json_encode([assistant_redact($argv[1] ? json_decode($argv[1]) : ''), assistant_handoff_payload([], json_decode($argv[1]), 'x', 'contact', 'en', 'money')], JSON_UNESCAPED_UNICODE);`, msg)
    is(!/4111|1111/.test(out[0]) && !/12\/27/.test(out[0]) && !/cvv 123/i.test(out[0]), 'the card number, expiry and CVV are masked', out[0])
    is(!/4111|1111/.test(out[1]) && !/12\/27/.test(out[1]) && !/123/.test(out[1].replace(/\d{4}-\d{2}-\d{2}T[\d:+]+/g, '')), 'and the n8n body carries none of them', out[1])
    const keep = await php(`require ${JSON.stringify(AP)}; echo json_encode(assistant_redact(json_decode($argv[1])), JSON_UNESCAPED_UNICODE);`,
      'order SP1AU702NKHTKDV for KD 12.500, phone 99887766, 14 days')
    is(keep === 'order SP1AU702NKHTKDV for KD 12.500, phone 99887766, 14 days', 'an order number, a phone number and a price are left alone', keep)
    for (const k of ['money', 'checkout_problem', 'complaint']) {
      for (const ar of [false, true]) {
        const line = await canned(k, ar)
        is(ar ? /بطاق/.test(line) : /card/i.test(line), `the ${k} line (${ar ? 'ar' : 'en'}) tells the customer not to send card details`, line)
      }
    }
  }

  head('r2 #16: corrections, exchanges and a parcel already received are not CANCEL')
  await R([
    ['I entered the wrong address by mistake in my order', 'contact', 'order_change'],
    ['I put the wrong phone number by mistake on my order', 'contact', 'order_change'],
    ['I selected the wrong size by mistake in my order', 'contact', 'order_change'],
    ['I ordered the wrong size by mistake', 'contact', 'order_change'],
    ['I changed my mind about the size in my order', 'contact', 'order_change'],
    ['I changed my mind about my order, I want size L instead', 'contact', 'order_change'],
    ['I changed my mind and want to exchange my order', 'returns'],
    ['I received my order but I changed my mind', 'returns'],
    ['my order arrived and I changed my mind, I want to return it', 'returns'],
    ['بالغلط حطيت عنوان غلط في طلبي', 'contact', 'order_change'],
    ['غيرت رايي بخصوص مقاس طلبي', 'contact', 'order_change'],
    ['الطلب وصلني بس ما ابيه', 'returns'], ['استلمت الطلب وما ابيه', 'returns'],
    // the real ones stay
    ['I ordered twice by mistake', 'cancel'], ['I changed my mind about my order', 'cancel'], ['الطلب مكرر', 'cancel'],
  ])

  head('r2 #17: has my payment worked? is a look-up, not the list of payment methods')
  await R([
    ['did my payment go through', 'order_status'], ['has my payment been received', 'order_status'],
    ['I did not get a payment confirmation', 'contact', 'money'], ['I already paid by knet, what now', 'order_status'],
    ['how do I confirm my payment', 'order_status'], ['payment status', 'order_status'], ['check my payment', 'order_status'],
    ['هل الدفع تم', 'order_status'], ['تم الدفع كيف اعرف الطلب انقبل', 'order_status'], ['دفعت كي نت', 'order_status'],
    ['do you take knet', 'payment'], ['can I pay by card', 'payment'],
  ])

  head('r2 #19: «تسلم» (thanks) is not «تسلمت / تسلمون / تسلمنا»')
  await R([
    ['تسلمت الطلب وفيه مشكلة', 'contact', 'complaint'], ['متى تسلمون الطلب', 'delivery'], ['لا تسلمون الطلب', 'cancel'],
    ['ما تسلمنا الطلب', 'contact', 'not_received'], ['تسلمت الطلب', 'contact'],
    ['تسلم ايدك', 'thanks'], ['يعطيك العافية تسلم', 'thanks'], ['شكرا', 'thanks'],
  ])

  head('r2 #14: an order or money word that matches nothing else goes to a person, never to the product search')
  await R([
    ['طلبي فيه شي غريب', 'contact'], ['فلوسي وين راحت بعد الطلب', 'contact'],
    ['do you have black leggings', 'search'],
  ])
}


console.log(fails?`\n${fails} failing`:'\nall ok'); process.exit(fails?1:0)
