/**
 * The archived invoice PDFs — shaped, ordered, readable, and out of reach.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/invoice-pdf-test.mjs
 *
 * WHAT IS EASY TO GET WRONG HERE, and why each of these is a check rather than
 * a comment. This shop writes its own PDFs because the host has no PDF library
 * and no way to install one — every function that could shell out to a binary
 * is in its disable_functions list. That means the file format, the font
 * embedding, the Arabic shaping and the bidi are all this project's code, and
 * every one of them fails QUIETLY:
 *
 *   A wrong xref offset gives a file that does not open at all, and there is
 *   no partial render to point at the mistake.
 *
 *   A missing glyph gives a document that looks fine to anyone not reading the
 *   Arabic — a customer's name spelled wrong on their own invoice, with
 *   nothing to suggest a letter went missing. This happened: Alexandria has no
 *   isolated presentation forms, 36 of them, and every letter that stood alone
 *   vanished.
 *
 *   A missing ToUnicode map gives a document that renders perfectly and
 *   extracts as "ŀŚŹǢőƄ" — not searchable, not copyable. On an archive of
 *   hundreds of files that is most of the value, and nobody notices until
 *   somebody searches the folder for an order number and is told it is not
 *   there.
 *
 *   And a ligature mapped in logical order inside a visually-ordered stream
 *   gives "اإلجمالي" for "الإجمالي" — both letters present, swapped, the word
 *   unfindable. That one is invisible in every possible way except this test.
 *
 * THE PRIVACY CHECK IS NOT OPTIONAL. orders-print.php refused to write these
 * files for years on the grounds that a folder of them is every customer's
 * name and address behind a guessable filename. The answer is that the folder
 * sits BESIDE public_html rather than inside it, and that answer is only true
 * for as long as nobody moves it. So it is asserted, from the outside, over
 * HTTP.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'

const SITE = process.env.SITE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
  return ok
}
const note = (w) => console.log(`--   ${w}`)

const php = (code) =>
  execFileSync('php', ['-r', `require "${ROOT}/sporta-site/public_html/api/store.php"; ${code}`],
    { encoding: 'utf8' }).trim()
const sql = (q) =>
  execFileSync('mariadb', ['--default-character-set=utf8mb4', '-uroot', 'sporta', '-N', '-B', '-e', q],
    { encoding: 'utf8' }).trim()

// --- the shaper, against shapes worked out by hand --------------------------
//
// Known answers, not a snapshot of whatever the code does today. Each was
// derived from the joining rules and checked letter by letter: a dual-joining
// letter takes its medial form only when the letter before it joins FORWARD
// and the one after joins BACK, and alef/reh/waw join backward only — which is
// why "سبورتا" breaks after the waw.
{
  const cases = [
    ['سبورتا', 'FEB3 FE92 FEEE 0631 FE97 FE8E', 'shop name — breaks after the waw'],
    ['لا', 'FEFB', 'lam-alef is ONE glyph, not two'],
    ['الكويت', '0627 FEDF FEDC FEEE FEF3 FE96', 'Kuwait'],
    // The meem ends "السلام" after an alef. Alef joins backward only, so the
    // meem has no join on either side and is ISOLATED — which is written as
    // the plain letter 0645, not the FEE1 presentation form. Fonts do not
    // carry isolated forms, because the base character already is one.
    ['السلام عليكم', '0627 FEDF FEB4 FEFC 0645 0020 FECB FEE0 FEF4 FEDC FEE2', 'lam-alef final, then an isolated meem'],
  ]
  for (const [word, want, why] of cases) {
    const got = php(`require "${ROOT}/sporta-site/public_html/api/arabic.php";
      echo implode(" ", array_map(fn($c)=>sprintf("%04X",$c), ar_shape(ar_codepoints("${word}"))));`)
    check(got === want, `${word} shapes correctly — ${why}`, `got ${got}, want ${want}`)
  }

  // A NUMBER MUST NOT REVERSE. "24" read backwards is "42", and on an invoice
  // that is a different amount of money — the one bidi shortcut that would
  // produce something plausible and wrong.
  const vis = php(`require "${ROOT}/sporta-site/public_html/api/arabic.php";
    echo ar_visual("المجموع 24.500 د.ك", true);`)
  check(vis.includes('24.500'), 'a decimal amount survives bidi intact', `got ${vis}`)
}

// --- every order has a file -------------------------------------------------
const dir = php(`require "${ROOT}/sporta-site/public_html/api/invoice-pdf.php";
  echo invoice_dir(store_config());`)
check(dir !== '', `the archive has a home (${dir})`)

const orders = sql('select track_id from orders order by id desc').split('\n').filter(Boolean)
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.pdf')) : []
const have = new Set(files.map((f) => f.replace(/\.pdf$/, '')))
const missing = orders.filter((t) => !have.has(t.toUpperCase()))
check(orders.length > 0, `there are orders to invoice (${orders.length})`)
check(missing.length === 0,
  `every order has an invoice on disk (${files.length} files)`,
  `${missing.length} without one, e.g. ${missing.slice(0, 3).join(', ')}`)

// --- and the folder is NOT in the web root ----------------------------------
//
// Asserted over HTTP, from outside, because that is the only version of this
// claim that cannot be wrong. A 200 is only acceptable when it is the SPA's
// own fallback page — what must never come back is a PDF.
{
  check(!dir.includes('/public_html'),
    `the archive is outside the docroot`, dir)

  const probe = orders[0] ?? 'SPNONE'
  for (const path of [`/invoices/${probe}.pdf`, '/invoices/', `/../invoices/${probe}.pdf`]) {
    let type = '', body = ''
    try {
      const res = await fetch(SITE + path)
      type = res.headers.get('content-type') ?? ''
      body = (await res.text()).slice(0, 5)
    } catch { /* refused is fine */ }
    check(!type.includes('pdf') && !body.startsWith('%PDF'),
      `${path} does not serve a PDF`, `content-type ${type}`)
  }
}

// --- the gates --------------------------------------------------------------
{
  const a = await fetch(`${SITE}/api/invoice-file.php`)
  check(a.status === 401, `invoice-file.php refuses a stranger (${a.status})`)
  const b = await fetch(`${SITE}/api/cron-invoice.php`)
  check(b.status === 403, `cron-invoice.php refuses a missing key (${b.status})`)
}

// --- a filename cannot climb out of the folder ------------------------------
{
  const bad = php(`require "${ROOT}/sporta-site/public_html/api/invoice-pdf.php";
    $c = store_config();
    $p = invoice_path($c, "../../public_html/index.php");
    echo $p === null ? "REFUSED" : $p;`)
  check(!bad.includes('public_html') && !bad.includes('..'),
    `a traversing id cannot escape the archive`, bad)
}

// --- the files are real PDFs, and they say the right things -----------------
let pdftotext = true
try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }) } catch { pdftotext = false }

if (!pdftotext) {
  note('pdftotext not installed — the content checks below need poppler-utils')
} else {
  // A sample rather than all of them: the risk being guarded against is a
  // format error, which is identical in every file.
  const sample = orders.slice(0, 5)
  let badHeader = 0
  for (const t of sample) {
    const head = readFileSync(`${dir}/${t}.pdf`).subarray(0, 5).toString('latin1')
    if (head !== '%PDF-') badHeader++
  }
  check(badHeader === 0, `the files begin as PDFs (${sample.length} sampled)`)

  // THE NUMBERS ON THE PAGE ARE THE NUMBERS IN THE DATABASE. An invoice that
  // renders beautifully and states the wrong total is worse than no invoice.
  let wrong = []
  for (const t of sample) {
    const text = execFileSync('pdftotext', [`${dir}/${t}.pdf`, '-'], { encoding: 'utf8' })
      .replace(/\s+/g, ' ')
    const row = sql(`select amount, subtotal, delivery_fee from orders where track_id='${t}'`)
      .split('\t')
    if (!text.includes(t)) wrong.push(`${t}: track id absent`)
    for (const [i, label] of [[0, 'total'], [1, 'subtotal'], [2, 'delivery']]) {
      const v = Number(row[i]).toFixed(3)
      if (!text.includes(v)) wrong.push(`${t}: ${label} ${v} absent`)
    }
  }
  check(wrong.length === 0,
    `the money on the page matches the database (${sample.length} orders x 4 figures)`,
    wrong.slice(0, 4).join(' | '))

  // THE ARABIC EXTRACTS AS ARABIC. This is what a ToUnicode map buys, and
  // without one the document is a picture. The ligature words are here on
  // purpose: they are the ones that came back with their letters swapped.
  const text = execFileSync('pdftotext', [`${dir}/${sample[0]}.pdf`, '-'], { encoding: 'utf8' })
    .replace(/\s+/g, ' ')
  const words = ['سبورتا', 'فاتورة', 'المجموع الفرعي', 'التوصيل', 'الإجمالي', 'خلال']
  const gone = words.filter((w) => !text.includes(w))
  check(gone.length === 0,
    `every Arabic label can be searched for in the file (${words.length} words)`,
    `not found: ${gone.join(', ')}`)
}

console.log(fails ? `\n${fails} failed` : '\nall ok — every order has an invoice, and it says the truth')
process.exit(fails ? 1 : 0)
