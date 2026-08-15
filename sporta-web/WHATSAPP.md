# WhatsApp order updates

The shop can message a customer on WhatsApp when their order is **confirmed**
(the bank settled) and when it is **shipped**. Off by default: with the config
blank, nothing is queued and nothing is sent, and that is a valid production
setup.

Everything below the "what you must do" section is already built and tested
(`npm run test:whatsapp`, 23 checks against a fake Cloud API). The remaining
work is in Meta's console and in `api/config.php` on the server, because
neither can be done from a repository.

---

## What you must do

### 1. Get the two ids — and notice they are different

In **Meta Business Manager → WhatsApp → API Setup** you will see, on one screen:

| Value | Looks like | Used for |
|---|---|---|
| WhatsApp **Business Account ID** (WABA) | `9832771907…` (15 digits) | managing templates. **NOT used by this code.** |
| **Phone Number ID** | a similar long number | every send. **This is the one to configure.** |

They are both long digit strings sitting next to each other, and putting the
WABA id in the phone-number field returns an error that reads like a
permissions problem while sending nobody anything. Copy the **Phone Number ID**.

### 2. Create a permanent token

**Business Settings → Users → System Users →** add a system user, give it the
WhatsApp Business Account asset with *Manage* permission, then **Generate
token** with `whatsapp_business_messaging`.

Use a **System User** token. A token from the Graph API Explorer expires in
about an hour: it will work while you test and every message the next day will
fail with an auth error.

### 3. Register two templates — in BOTH languages

Every message this shop sends is *business-initiated*: the customer has not
messaged you, so the 24-hour freeform window is shut and always will be. Meta
only allows a pre-approved template.

Create these in **WhatsApp Manager → Message templates**, category
**Utility** (not Marketing — utility templates are cheaper and are not subject
to marketing opt-out rules):

**`order_confirmed`** and **`order_shipped`**, each registered in **Arabic and
English under the same name**. The code picks the language per message from
what the customer was reading at checkout.

Body variables are **positional** and must be declared in this order:

| Variable | Is |
|---|---|
| `{{1}}` | customer name |
| `{{2}}` | order number |
| `{{3}}` | amount in KWD |

Getting the order wrong silently swaps the name and the order number in every
message, and Meta will not complain — the template is valid, it just says the
wrong thing.

Suggested Arabic body for `order_confirmed`:

> مرحباً {{1}}، تم تأكيد طلبك رقم {{2}} بمبلغ {{3}} د.ك. سنعلمك عند شحنه. شكراً لتسوقك مع سبورتا.

and English:

> Hi {{1}}, your order {{2}} is confirmed — {{3}} KWD. We'll message you when it ships. Thank you for shopping with Sporta.

### 4. Fill in `api/config.php` on the server

Never in the repository — same rule as the Tranportal and CBK credentials.

```php
'whatsapp_token'              => 'EAAG…',        // the System User token
'whatsapp_phone_number_id'    => '1234567890',   // NOT the WABA id
'whatsapp_template_confirmed' => 'order_confirmed',
'whatsapp_template_shipped'   => 'order_shipped',
```

### 5. Add the cron

hPanel → **Advanced → Cron Jobs**, every 5 minutes:

```
wget -qO- "https://www.sporta.com.kw/api/cron-whatsapp.php?key=<cron_key>"
```

It is HTTP-gated rather than run from a shell because **there is no shell** on
this account — SSH is off permanently, and a cron that needs one never runs.
Same arrangement as `cron-fulfilment.php`.

### 6. Import the schema

hPanel → phpMyAdmin → import `whatsapp.mysql.sql`. It is additive and safe to
re-run.

---

## How it works, and why it works that way

### The customer hears from us only when the money is in

`fulfilment_outbox` mails the **warehouse on INSERT** — before payment, on
purpose, because the owner would rather see an order that never gets paid than
miss one that does.

A **customer cannot be told that.** "Your order is confirmed" sent before the
bank has agreed is a message the shop may have to retract, and a shopper whose
card was declined receiving a confirmation is worse than silence: they stop
watching for the failure and the sale is lost quietly. So `whatsapp_outbox` is
written when payment **settles**, never on insert.

A **failed** payment sends nothing at all. The shopper is already looking at
the failure on screen; a WhatsApp message about it would arrive minutes later,
out of context, about an order they may have already re-placed successfully.

### One message per order per kind

Enforced by a unique index, not by care. KNET's callback comes back through the
**customer's browser** and really does fire more than once — without the index
a customer gets two confirmations for one order.

### Nothing is sent during checkout

`store_queue_whatsapp()` writes a row and returns. No HTTP call happens in the
request path: a checkout that waits on `graph.facebook.com` is a checkout that
fails when Meta is slow, and the customer is standing at the bank's payment
page while it does. The row is written **in the same transaction as the order**,
so the message cannot go missing, and the cron delivers it.

### The language is recorded, not guessed

`orders.customer_lang` stores the language the checkout was **rendered in**.
This is a bilingual shop in a country that is roughly 70% expatriate, so
neither "everyone here reads Arabic" nor "default to English" is true, and the
browser is the only thing that knows. By the time the message is sent it is
long gone. Orders placed before this column existed fall back to Arabic.

### A number the shop cannot use is skipped, not guessed

Kuwaiti mobiles are 8 digits starting 5, 6 or 9, and the Cloud API wants E.164
without the plus (`96599887766`). Anything else — a landline, a foreign number,
a typo an admin introduced while editing an address — queues **nothing**. A
message sent to a number the shop invented is worse than one not sent.

### Failures are kept, with the reason

A warehouse email that does not arrive is noticed within the hour by a person
expecting it. A WhatsApp message that does not arrive is noticed by nobody. So
a failed row keeps its `last_error` and its attempt count, stops after five
tries, and sits visibly in the table. The token is never written into the
error.

The three errors worth recognising:

| Meta says | It means |
|---|---|
| `132001 template does not exist in the translation` | the template name is wrong, or you only approved one language |
| `131026 receiver is not a WhatsApp user` | that number has no WhatsApp account |
| `190 invalid OAuth access token` | you used a temporary token, or it was revoked |

### Missing configuration stops the queue

The cron refuses **before claiming** anything. Claiming rows it cannot send
would burn their five retries while the real problem is one empty setting
nobody has looked at yet.

---

## Testing

```
npm run test:whatsapp
```

23 checks against a real MariaDB and a real HTTP server speaking the Graph
shape — including a fake that reproduces Meta's own refusals, so the failure
paths are exercised and not just imagined.
