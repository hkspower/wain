# n8n — security review of the webhook workflows

Reviewed against the live instance (`sportake.app.n8n.cloud`) by reading each
workflow's node graph. **Nothing was changed** — every write to n8n from this
session is blocked by an approval gate, so this is the document to work from.

**Seven workflows were read in full.** Six are inactive; one is live. Eight
others (the scheduled AI agents — راشد, أنيلكا, الحارس, سالم, Intelligence
Center, Fahad TTS, MySQL Order Monitor) were **not** individually reviewed —
they are schedule-driven rather than webhook-driven, so they are not internet-
reachable, but that is an assumption from their trigger type, not a finding.

---

## Do this first

| # | Action | Why |
|---|---|---|
| 1 | **Archive `جسر النشر لهوستنجر 🌉` and `أداة ملفات وين 🔧`** | Together they are arbitrary file **read and write** on the live server. See §1. |
| 2 | **Archive `Sporta Shell` and `Sporta DB`** | Arbitrary shell and arbitrary SQL. See §2. |
| 3 | **Rotate the FTP password** in hPanel | The two file workflows hold the FTP credential. Treat it as exposed. |
| 4 | **Deactivate `فحص اتصال هوستنجر 🔌`** | The one workflow that is **live right now**, unauthenticated. See §3. |
| 5 | Rotate every `…_غيّرني` secret, or delete the workflows using them | They are placeholders, not secrets. See §4. |

Archiving is reversible in n8n (⋯ menu → Archive), so step 1 and 2 cost
nothing but a click if you later decide you want them back.

---

## 1. Arbitrary file read AND write on the live server — CRITICAL

Two workflows share one placeholder secret, `WAIN_DEPLOY_2026_غيّرني`, and
between them they can do anything to the filesystem behind the FTP credential.

**`أداة ملفات وين 🔧`** (`/webhook/wain-file-tool`) downloads any path the
caller names, and in `patch` mode writes it back:

```
path  = String(b.path).replace(/\.\./g,'')     <- the only guard
mode  = 'grep'   -> FTP download, returns file contents in the response
mode  = 'patch'  -> FTP upload, writes the modified file back
```

**`جسر النشر لهوستنجر 🌉`** (`/webhook/wain-deploy`) uploads a list of files
supplied as base64 or fetched from a URL, to any path the caller names, with
the same guard.

**The guard does not work.** Stripping `..` stops relative traversal and does
nothing about an **absolute path**, which is all an attacker needs:

* `grep` on `public_html/knet/config.php` returns the **Tranportal
  credentials** — the KNET money path — in the HTTP response.
* `grep` on `public_html/api/config.php` returns the **database credentials**
  and the admin session secrets.
* `deploy` of one file to `public_html/anything.php` is a **webshell**.

This is precisely the risk the project's own rule was written about — *"Never
build a PHP deploy endpoint. The live server had one, answering to anyone on
the internet. That is a way in, not a bridge."* Moving it into n8n does not
change what it is; it changes which logs it appears in.

**Fix:** archive both. `npm run publish` (FTPS, from the owner's machine, with
`config.php` and `config.js` in a hard-coded never-touch list) already does the
deploying, and `npm run ftp` already does the browsing — both with credentials
that never leave the laptop and no endpoint exposed to anyone.

## 2. Arbitrary shell and arbitrary SQL — CRITICAL

```
Sporta Shell   command = {{ $json.body.command }}   -> SSH node
Sporta DB      query   = {{ $json.body.query }}     -> MySQL executeQuery
```

No allow-list, no read-only mode. Once the secret is known this is remote code
execution and full database control. `DROP TABLE orders` is a valid `query`.

`Sporta Shell` also quietly reverses a standing decision: **SSH is off on this
account permanently**, after 24 brute-force attempts were logged and because
the account's shell is `/sbin/nologin` anyway. A workflow that reopens shell
access over HTTP undoes that without anybody choosing to.

**Fix:** archive both. If the MySQL one is genuinely useful, give its
credential a `SELECT`-only database user first, so a leaked secret cannot
write.

## 3. The one live workflow is unauthenticated — MODERATE

`فحص اتصال هوستنجر 🔌` is the only workflow with `active: true`.

```
GET https://sportake.app.n8n.cloud/webhook/wain-host-check
authentication: none
query: SELECT VERSION(), NOW(), DATABASE()
```

The query is **fixed**, so there is no injection here — this is the mildest of
the findings. But it is reachable by anyone, and it:

* returns the **MySQL version and database name**, which is reconnaissance for
  targeting a known CVE;
* opens a **database connection on every request**, so it is a free way to load
  the shop's database from the outside;
* burns n8n execution quota on every request.

**Fix:** deactivate it, or add Header Auth (§5). A connectivity check is
something you run when you are debugging, not something that needs to be
listening permanently.

## 4. The secrets are the words "change me"

Every gate is a plain string comparison against a value that was never changed
from the generator's placeholder — the Arabic word **غيّرني**, meaning *change
me*:

```
SPORTA_SHELL_2026_غيّرني
SPORTA_DB_2026_غيّرني
HOSTINGER_FS_2026_غيّرني
WAIN_DEPLOY_2026_غيّرني     <- shared by BOTH file workflows
```

These are not secrets. They follow an obvious pattern, they are printed in the
workflow descriptions, and they sit in plain text inside the workflow JSON,
which anything with read access — including an n8n API token — can export.
Treat all four as publicly known.

## 5. The webhooks have no authentication of their own

Every trigger reviewed is `authentication: "none"`. The only check is an IF node
*after* the request has been accepted and the execution started.

* n8n counts the execution either way, so an attacker can burn your quota with
  requests that never pass the gate.
* The denial path returns a distinct body (`unauthorized: secret mismatch`), so
  the endpoint confirms for free whether a guess was wrong.
* The secret travels in the **request body** — the part most likely to end up
  in a log, a proxy trace or a shell history.

**Fix:** set the webhook node's *Authentication* to **Header Auth** and attach a
credential (you already have a `Header Auth account`). The value is then stored
encrypted by n8n and never appears in an export — which is the real improvement
over an IF node.

## 6. `Wain — Events Hub` is an open WhatsApp relay — HIGH

```
recipientPhoneNumber = {{ $json.body.data.bizPhone }}
textBody             = {{ ...from the request body... }}
```

Recipient **and** message body both come from the caller, on an unauthenticated
webhook with `allowedOrigins: "*"`. Published, that is a free service for
sending WhatsApp messages to arbitrary numbers from your business account.

The consequence is not only spam: WhatsApp bans business accounts for exactly
this, and the number is the shop's.

**Fix:** authenticate the webhook, and stop taking the recipient from the
request — look it up server-side, or use a fixed configured number, so a caller
can only ever trigger a message to a number the shop already knows.

---

## The WhatsApp integration cannot currently send at all

Separate from security:

* `phoneNumberId` is still the literal string `REPLACE_PHONE_NUMBER_ID`.
* **No WhatsApp credential is attached** to the sending node, though two exist
  — `WhatsApp account` and `WhatsApp account 2`. Delete the duplicate once you
  know which is real, so it is unambiguous which one is live.
* It sends **freeform text**, which WhatsApp permits only inside the 24-hour
  window that opens when the *customer* messages you. A business-initiated
  notification fails with error `132001`; it must use an approved template.

**None of this affects sporta.com.kw.** The shop's order updates go through
`cron-whatsapp.php`, which calls the Cloud API directly with approved
templates, a queue, retries and its own test suite. It has no dependency on
n8n, deliberately — an order confirmation should not stop arriving because a
second service is down.
