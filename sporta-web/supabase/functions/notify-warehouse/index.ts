// notify-warehouse — drains fulfilment_outbox and emails the logistics company.
//
// Deploy:  supabase functions deploy notify-warehouse
// Secrets: supabase secrets set WAREHOUSE_EMAIL=... MAIL_FROM=... RESEND_API_KEY=...
//
// ============================ HOW IT IS TRIGGERED ==========================
// Two ways, and you want BOTH:
//
//   1. A Database Webhook on INSERT into fulfilment_outbox — Supabase dashboard,
//      Database -> Webhooks. This is what makes it immediate.
//   2. A schedule, every few minutes (pg_cron, or any uptime pinger hitting this
//      URL). This is the safety net, and it is not optional: a webhook that
//      fails to fire leaves an order sitting unsent forever, and nobody finds
//      out until a customer asks where their parcel is.
//
// The function is safe to call at any time from anywhere authorised — it sends
// only what has not been sent, and claim_fulfilment's `for update skip locked`
// means the webhook and the schedule firing together cannot double-send.
//
// ============================== AUTHORISATION ==============================
// Requires the service role key. It reads customer names, phone numbers and
// home addresses; the anon key must never reach it, and the SQL side revokes
// the functions from anon and authenticated so that even a mistake here cannot
// expose them.
import { renderMessage } from './render.mjs'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// The logistics company. Comma-separated if more than one person there wants a
// copy. Configuration, not code — the warehouse changing is a settings edit.
const WAREHOUSE_EMAIL = Deno.env.get('WAREHOUSE_EMAIL') ?? ''
// Must be a domain you have SPF+DKIM for, or this mail lands in spam. See
// DNS-EMAIL-RECORDS.txt.
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? 'orders@sporta.com.kw'
const MAIL_REPLY_TO = Deno.env.get('MAIL_REPLY_TO') ?? 'cs@sporta.com.kw'
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

async function rpc(fn: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`)
  return res.json()
}

// The one place that knows which email provider is in use. Swapping Resend for
// SES, Postmark or plain SMTP is this function and nothing else.
async function sendEmail(to: string, subject: string, html: string, text: string) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: to.split(',').map((s) => s.trim()).filter(Boolean),
      reply_to: MAIL_REPLY_TO,
      subject,
      html,
      text,
    }),
  })
  if (!res.ok) throw new Error(`resend: ${res.status} ${await res.text()}`)
}

Deno.serve(async () => {
  // Fail loudly and BEFORE claiming anything. Claiming rows we cannot send
  // would burn an attempt each time and march every message to its retry limit
  // while the real problem is one missing setting.
  if (!WAREHOUSE_EMAIL) {
    return new Response(
      JSON.stringify({ error: 'WAREHOUSE_EMAIL is not set — nothing would be delivered' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const rows = (await rpc('claim_fulfilment', { p_limit: 20 })) as Array<{
    id: string
    kind: 'new' | 'payment'
    payload: Record<string, unknown>
  }>

  let sent = 0
  const failed: Array<{ id: string; error: string }> = []

  for (const row of rows) {
    try {
      const { subject, html, text } = renderMessage(row.kind, row.payload)
      await sendEmail(WAREHOUSE_EMAIL, subject, html, text)
      await rpc('mark_fulfilment_sent', { p_id: row.id })
      sent++
    } catch (e) {
      // One bad message must not stop the rest of the queue. The error is
      // written to the row so it shows up in the admin rather than only in a
      // log nobody opens.
      const error = e instanceof Error ? e.message : String(e)
      failed.push({ id: row.id, error })
      await rpc('mark_fulfilment_sent', { p_id: row.id, p_error: error.slice(0, 500) })
    }
  }

  return new Response(JSON.stringify({ claimed: rows.length, sent, failed }), {
    status: failed.length ? 207 : 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
