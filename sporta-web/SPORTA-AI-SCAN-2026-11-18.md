# Sporta AI — full scan, 2026-11-18 (owner: "full scan sporta ai")

Independent, read-only scan of the assistant (`dropin/php-store/assistant.php`, the `assistant` and `voice` routes, `cron-voice.php`, the admin
setup routes, the widget and the admin screen). Nothing was run against the live server; the live facts are from the 2026-11-12 read-only probe
(`ai_key` EMPTY: fixed answers only, no model; `tts_key` / `tts_voice_id` EMPTY: no voice). Both states were scanned: keys empty (today) and
keys set (the day the owner switches them on). Status below is as of the commit that carries this file.

## Verdict

- **Keys empty (today): safe.** No input made the assistant reveal another customer's data, a key, a prompt or admin data.
- **Model on (`ai_key` set): not yet.** F1 and F2 must be fixed first, F6 is strongly advised. (The model can only reword a hello, a thank-you
  or a product list, so it adds almost nothing today.)
- **Voice on (`tts_key` set): after F7 (fixed), F8 and F9.**

## Tests run

`test:assistant` 2,277 ok (corpus of 1,787 messages: 1,786 as expected, one known entry), `test:assistant-admin` 96, `test:assistant-admin-ui` 47,
`test:voice-ui` 15, `test:ai-icon` 76, `test:admin-ai-switch` 18 ok + 1 FAIL ("the add-on file still ends with the block", `admin-ai-switch-test.mjs:69`:
a stale assertion, the add-on file now ends with the invoices block, not a product defect). After the fixes below: `test:assistant` 2,300+ ok, 0 FAIL;
`test:assistant-admin` 98.

## Findings

| # | Sev. | What | Status |
|---|---|---|---|
| F1 | blocker for model-on | No availability or spend guard on the model: a stalled provider held each "hello" 6 s (no failure breaker, no connect timeout, no global or daily cap); greeting, thanks, bye, ack, found and recommend all call it, so at the 30-per-minute client cap that is up to 43,200 paid calls a day, on Apache workers shared with checkout (`assistant.php` ~4399-4430). Fix: never call the model for the fixed sentences, skip it for 60 s after a failure, 1 s connect / 3 s total timeout, a daily counter. | OPEN (matters only when a key is set) |
| F2 | blocker for model-on | The Privacy page would be untrue: `Privacy.jsx:53-55` says typed text is read "on our server" and names only the driver and the payment provider; with a key the raw text goes to the model provider. `AssistantPanel.jsx:235-241` says the microphone is on-device with no third party (Chrome and Safari send the audio to Google and Apple). Fix: update Privacy section 4 in both languages and the comment. The live storefront is a different build, so the live text is changed in /backends -> Site content, not here. | OPEN |
| F3 | should-fix today | Card numbers got past the redaction (a left-to-right mark after each group, comma or letter separators, a number written as five groups, a trailing group); the text went to the n8n hand-off e-mail. | FIXED: separator is any 1-3 non-digits, up to 31 digits; 9 masked-in-full and 4 left-alone checks, no runaway pattern |
| F4 | should-fix today | A refunded or voided order was told "Payment not confirmed" (and its card showed unpaid). These states became real when `refunds.mysql.sql` went live. | FIXED: `stage_refunded` and `stage_voided`, Arabic and English, said before every other stage; 5 checks |
| F5 | should-fix today | Fixed answers ignore settings the owner can edit: "14 days" and a fixed phone and e-mail (`assistant.php` ~3771-3796, 3146, 3753) never read `settings.returns_policy` or the Site content contact; when the Shipping API ships, "1 KWD to every area, 24 h" is wrong for closed zones, free-over orders and zones with their own time. | OPEN |
| F6 | should-fix before model-on | The output filter passes bad model text (a bare domain, "send card details to our new WhatsApp", an insult, a coupon code without digits). Order data never reaches the model. Fix: send the model none of the visitor's text; watch bare domains and the words coupon, code, خصم. | OPEN |
| F7 | should-fix before voice-on | Twelve of the shop's own sentences read the phone as one big number ("twenty-two million...") because the digit rule refused a number followed by a full stop. | FIXED: `(?!\d\|\.\d)`; checked on a sentence-ending number and on prices |
| F8 | should-fix before voice-on | The voice signing key is the cron key and the docs put it in a URL (`SPORTA-AI-VOICE.md:73`, `cron-voice.php:58`); anyone with it can sign up to 1,000 characters of free text-to-speech on the shop's account; the cache shares a disk with payment logs and admin sessions. Fix: a separate `tts_sign_key`, `cron-voice` from the CLI only, a daily synthesis cap. | OPEN |
| F9 | should-fix before voice-on | An unwritable cache means a paid call on every press, silently (5 presses of one sentence made 5 provider calls). Fix: log the failure, set the `.fail` marker, make `status` report `is_writable`. | OPEN |
| F10 | should-fix | The setup screen is hidden in the admin add-on (`sporta-admin-brands.js` ~11078): the owner cannot enter a key, turn phrasing off or run Test; the only kill switch also kills the fixed answers. `late_hours` accepted 1, which made every order "late" and e-mailed staff. | PART: `late_hours` floor 24 on save and on read (FIXED, 2 checks). The hidden screen is an owner decision (below) |
| F11 | should-fix | Widget accessibility: `tap-target` is defined nowhere; at 390 px Close is 29x36, the speaker 32x25, the mic 40x48; the "thinking" line and the speaker are light grey on white; the panel stays on screen at 390x420. The live storefront is a different build: check the live widget separately. | OPEN |

Notes (no action taken): the model key is stored as plain JSON in `settings.assistant_secret`; hand-off e-mails are limited per client only and n8n
retention is unchecked; model-reworded answers get no speaker; the branch's `invoice` sentence ("shows area only") is true only with the new `api.php`;
a database outage returns `cause: "db_user or db_pass"` to the public and no fixed answers; `cron-voice status` counts only `.mp3`, `days` is
unvalidated, the voice log has no rotation; small misroutes (gift wrapping gets product picks, "my number is 9999..." with a product question gets the
contact line); confirm `trusted_proxy_ips` includes Traefik on the VPS (a spoofed `X-Forwarded-For` did not bypass the 30-per-minute limit in the rig).

## Checked and fine

Only `orders` by order number is read (number, amount, payment state, method, stage, placed time: the same exposure as `?r=status`); about 50 injection
and exfiltration phrases in English and Arabic got fixed answers; keys are never returned, logged or placed in a URL; every URL the code fetches comes
from the root-owned config and cURL follows no redirects; the widget and the admin screen use text nodes only (no `innerHTML`); admin routes answer 401
without a session and the writes need JSON and a same-site request; oversized, malformed, wrong-content-type, cross-site and burst requests are refused;
115 crafted 500-character inputs ran with no ReDoS (worst 66 ms) and no exception; voice signatures bind language and exact text, the cache is 0700/0600
with atomic writes and ElevenLabs receives only the shop's own sentences; all 46 product prices match `store_effective_price`; the n8n workflow verifies
the signature and sends plain text with fixed subjects.

## Owner decisions this scan needs

1. **Switch the model on?** Not until F1, F2 and F6 are done. It adds little today (rewording only).
2. **Switch the voice on?** Needs an ElevenLabs key, a Kuwaiti voice picked by ear (`SPORTA-AI-VOICE.md`), and F8-F9.
3. **Show the AI setup screen in /backends?** It is hidden today; without it the owner cannot enter a key from the admin.
