// The "stub bank on :8131" that e2e-checkout, payment-methods-test and
// runtime-config-test all name as a prerequisite — and which no script in the
// repo actually provided, so each of them had to be stood up by hand.
//
//   node scripts/test-stub-bank.mjs &
//
// It answers every path with 200 and echoes the query string, because that is
// the whole assertion those tests make: was the browser handed over, to WHICH
// gateway path, and with what parameters. In particular they check that no
// `amount` is ever sent — pay.php reads the order's stored amount, so the
// browser cannot influence what is charged.
import { createServer } from 'node:http'

createServer((req, res) => {
  console.log(`${req.method} ${req.url}`)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(
    `<!doctype html><meta charset="utf-8"><title>stub bank</title>` +
      `<h1>stub bank</h1><pre>${req.url.replace(/[<>&]/g, '')}</pre>`,
  )
}).listen(8131, '127.0.0.1', () => console.log('stub bank on http://127.0.0.1:8131'))
