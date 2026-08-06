# n8n — security review of the webhook workflows

Reviewed against the live instance (`sportake.app.n8n.cloud`) by reading each
workflow's node graph. Nothing here was changed; this is the write-up to work
from.

**Nothing is exploitable today**, because every affected workflow is
`active: false` and an inactive n8n workflow does not serve its production
webhook. That is the *only* thing standing between these and the internet.
Publishing any one of them, for a minute, is enough.

---

## Summary

| Workflow | Webhook | If published, an anonymous request can… | Severity |
|---|---|---|---|
| `Sporta Shell 🖥️ — SSH Control` | `/webhook/sporta-shell` | run **any shell command** on the Hostinger server and read stdout | **critical** |
| `Sporta DB 🗄️ — MySQL Control` | `/webhook/sporta-db` | run **any SQL** against the shop database and read every row | **critical** |
| `Hostinger Files 📁 — FTP Control` | `/webhook/hostinger-fs` | list any directory over FTP | high |
| `Wain — Events Hub` | `/webhook/wain-events` | send **WhatsApp messages to any number it chooses** on your account | high |

---

## 1. The shared secrets were never changed

All three control workflows gate on a literal string comparison, and in all
three that string is still the generator's placeholder — the Arabic word
**غيّرني**, which means *change me*:

```
Sporta Shell    secret == "SPORTA_SHELL_2026_غيّرني"
Sporta DB       secret == "SPORTA_DB_2026_غيّرني"
Hostinger Files secret == "HOSTINGER_FS_2026_غيّرني"
```

These are not secrets. They follow an obvious pattern, they are documented in
the workflow descriptions, and they were produced by a template anyone can
generate. Treat all three as publicly known.

**Fix:** replace each with a random 32+ character value, and do not keep it in
the workflow body — see §3.

## 2. The webhooks themselves have no authentication

Every one of these four triggers is `authentication: "none"`. The only check is
the IF node *after* the request has already been accepted and routed.

That matters more than it looks:

* n8n counts the execution either way, so an attacker can burn your execution
  quota by hammering a webhook they cannot pass.
* A string comparison in an IF node is not constant-time, and the denial path
  returns a distinct body (`unauthorized: secret mismatch`), so the endpoint
  confirms for free whether a guess was wrong.
* The secret travels in the **request body**, which is the part most likely to
  end up in a log, a proxy trace, or a shell history.

**Fix:** set the webhook node's *Authentication* to **Header Auth** and attach
a credential (you already have a `Header Auth account` credential). The
credential value is stored encrypted by n8n and never appears in the workflow
JSON, which is the actual improvement — the IF-node approach puts the secret in
plain text inside an export anyone with read access can download.

## 3. The secret is stored in the workflow, in plain text

Because the check is `rightValue: "SPORTA_SHELL_2026_غيّرني"`, the secret is
part of the workflow definition. Anyone who can read the workflow — including
anything with an n8n API token, and any exported JSON — has it. Moving to a
credential (§2) removes this entirely.

## 4. The two control workflows pass user input straight to an interpreter

```
Sporta Shell:  command = {{ $json.body.command }}   -> SSH node
Sporta DB:     query   = {{ $json.body.query }}     -> MySQL executeQuery
```

There is no allow-list, no statement-type restriction, and no read-only mode.
Once the secret is known, this is remote code execution and full database
control — not "a tool with a weak password". `DROP TABLE orders` is a valid
`query`.

**Fix, in order of preference:**

1. **Delete or archive them.** They were built to let an assistant drive the
   server. That job is now done by `npm run ftp` (FTPS, with the four config
   files protected from overwrite) and `npm run publish`, both running from the
   owner's own machine with credentials that never leave it. A webhook that
   grants shell access to the internet is a much larger door than the problem
   it solves.
2. If they are kept, make the MySQL one **read-only**: give the MySQL node a
   database user with `SELECT` only, so a leaked secret cannot write.
3. Never re-enable the SSH one. **SSH is off on this account permanently** —
   after 24 brute-force attempts were logged and because the account's shell is
   `/sbin/nologin` anyway. A workflow that re-opens shell access through an
   HTTP endpoint reverses that decision without anybody deciding it.

## 5. `Wain — Events Hub` is an open WhatsApp relay

```
recipientPhoneNumber = {{ $json.body.data.bizPhone }}
textBody             = {{ ...from the request body... }}
```

The recipient **and** the message content both come from the caller, on a
webhook with no authentication and `allowedOrigins: "*"`. Published, that is a
service for sending WhatsApp messages to arbitrary numbers, from your business
account, free of charge to whoever finds it.

The consequence is not just spam: WhatsApp bans business accounts for it, and
the number is the shop's.

**Fix:** authenticate the webhook (§2), and do not take the recipient from the
request. Look it up server-side — from the order, or from a fixed configured
number — so a caller can only ever trigger a message to a number the shop
already knows.

---

## Notes on the WhatsApp integration itself

Separate from security, the WhatsApp path in n8n cannot currently send at all:

* `phoneNumberId` is still the literal string `REPLACE_PHONE_NUMBER_ID`.
* No WhatsApp credential is attached to the sending node, though two exist
  (`WhatsApp account` and `WhatsApp account 2` — a duplicate worth removing so
  it is unambiguous which one is live).
* It sends **freeform text**, which WhatsApp only permits inside the 24-hour
  window that opens when the *customer* messages you. A business-initiated
  notification will fail with error `132001`. Business-initiated messages must
  use a pre-approved template.

None of this affects **sporta.com.kw**: the shop's own order updates go through
`cron-whatsapp.php`, which calls the Cloud API directly with approved
templates, a queue, retries and its own test suite. It has no dependency on
n8n, and deliberately so — order confirmations should not stop when a second
service is down.

---

## Suggested order of work

1. **Confirm all four stay unpublished** until the rest is done. This is the
   whole mitigation right now.
2. **Delete or archive** `Sporta Shell` and `Sporta DB`. FTPS from the owner's
   machine already covers what they were for, without exposing anything.
3. If any workflow is kept: **Header Auth on the webhook**, secret in a
   credential, placeholder secrets rotated.
4. **`Wain — Events Hub`**: authenticate it, and stop taking the recipient
   number from the caller.
5. Delete the duplicate `WhatsApp account 2` credential once you know which is
   real.
