<?php
// Sporta native backend — configuration TEMPLATE.
//
// Copy to config.php on the SERVER and fill in. config.php is never committed,
// never in the zip, never uploaded by npm run publish — the same rule as
// knet/config.php, for the same reason: it holds live credentials.
//
// The MySQL database is created in hPanel -> Databases -> MySQL Databases.
// Hostinger names them like u130124229_sporta; the user and password are set
// on the same screen.

return [
    // ---- MySQL (from hPanel -> Databases) ----
    'db_host' => 'localhost',
    'db_name' => 'u130124229_sporta_kw',
    'db_user' => 'u130124229_sporta_user',
    'db_pass' => '',

    // ---- Fulfilment emails (cron-fulfilment.php) ----
    // The logistics company. Comma-separated for more than one recipient.
    'warehouse_email' => '',
    // Must be an address on a domain with SPF/DKIM set (DNS-EMAIL-RECORDS.txt)
    // or the mail lands in spam and nobody is told.
    'mail_from'       => 'cs@sporta.com.kw',
    'mail_reply_to'   => 'cs@sporta.com.kw',
    // A warehouse message that failed five times in a row is tried again only
    // in the first N minutes of each hour (up to 24 attempts), and the owner is
    // told on the Activity page which order it was. Optional: absent means 10,
    // 0 switches the slow retry off.
    // 'warehouse_retry_window_minutes' => 10,
    // Database center (/backends -> Settings): where to read the backup status from. Optional: absent means
    // /var/lib/sporta/backup-status, the small file (the last-status and last-success lines of the backup job, nothing
    // else) the server's backup job may copy there. No file: the screen says "not reported", never "fine".
    // 'db_backup_status_file' => '/var/lib/sporta/backup-status',
    'admin_mail_from' => 'cs@sporta.com.kw',
    // Customer password recovery uses this verified mailbox, independently
    // of the logistics sender. Keep it on the Sporta domain with SPF/DKIM.
    // Better a mailbox of its own (noreply@): anyone can ask for a reset, and
    // although one address gets at most 3 an hour and 10 a day, reset mail
    // sent from cs@ uses up the same sending quota the warehouse mail needs.
    'customer_mail_from' => 'cs@sporta.com.kw',
    // HTTPS page used in admin password-reset emails. Keep this on Sporta's
    // own origin; the API validates it before creating a link.
    'admin_reset_url' => 'https://www.sporta.com.kw/backends',

    // ---- Optional Google sign-in for an already linked administrator ----
    // Create a Google OAuth Web client with this exact redirect URI:
    // https://www.sporta.com.kw/api/admin-google.php
    // Keep both values in the private server config, never in the web root.
    'google_oauth_client_id' => '',
    'google_oauth_client_secret' => '',

    // ---- Abuse controls (optional, server-only) ----
    // Used to HMAC IP/account rate-limit keys, reset-request addresses and the
    // admin's sporta_dev browser cookie. Generate a long random value.
    // Existing installs safely derive a private fallback from their DB config,
    // but setting this keeps the limiter independent of future DB rotation.
    // Setting or changing it later is safe: counters start again, and each
    // admin browser is treated as new until its next sign-in. T-Pay (pay/)
    // reads this value from here; do not copy it into pay-config.php.
    'rate_limit_secret' => '',
    // Trust X-Forwarded-For only when the direct REMOTE_ADDR is one of these
    // exact IPs or CIDRs. Leave empty on ordinary/shared hosting. On a reverse
    // proxy deployment, list only the proxy network you administer. KNET and
    // T-Pay read this list from here too (payment logs, T-Pay's limits), so
    // with it empty behind a proxy every shopper counts as one client.
    'trusted_proxy_ips' => [],

    // ---- Cron shared secret ----
    // hPanel -> Advanced -> Cron Jobs calls cron-fulfilment.php with this in
    // the query string, so a stranger cannot make the server send mail:
    //   wget -qO- "https://www.sporta.com.kw/api/cron-fulfilment.php?key=PASTE_THE_SAME_VALUE"
    // Any long random string. Change it here and in the cron line together.
    'cron_key' => '',

    // ---- Stock holds (cron-stock.php --release, every 15 minutes) ----
    // Stock is reserved when the order is placed. These say how long an
    // order that never completes may keep it.
    //   stock_hold_minutes  a KNET / T-Pay order whose customer never came
    //                       back from the bank. Default 120, minimum 15.
    //   cod_hold_hours      a CASH ON DELIVERY order still 'pending' and still
    //                       'unfulfilled' this many hours after it was placed
    //                       is CANCELLED and its stock put back. Default 24
    //                       when this line is absent or ''; 0 switches it
    //                       off. Mark a real cash order 'packed' in /backends
    //                       within the hold and it is never touched — nor is
    //                       anything packed, shipped, delivered or paid.
    'stock_hold_minutes' => 120,
    'cod_hold_hours'     => 24,

    // ---- One order a minute ----
    // After an order is ACCEPTED, the same client (address; IPv6 by /64) and
    // the same phone get no NEW order for this many seconds: 429
    // previous_order_pending. A retry of the same attempt is never refused,
    // and a declined or cancelled order holds nothing. Default 60 when absent
    // or ''; 0 switches it off; at most 3600.
    'order_cooldown_seconds' => 60,

    // ---- Where admin sessions live (optional) ----
    // A directory of their own, ABOVE the web root, so PHP's sweep for other
    // sessions (24 minutes by default) cannot sign the admin out. Leave ''
    // for the automatic choice: /var/lib/sporta/admin-sessions on the VPS,
    // else sporta-admin-sessions in the account home, else the temp dir.
    'admin_session_dir' => '',

    // ---------------------------------------------------- سبورتا AI (optional)
    //
    // The assistant works with every one of these empty. They add, in order: a
    // model that rewords answers, a voice that speaks them, and a webhook that
    // hands a customer to a human.

    // A language model. It may only ever REWORD facts the shop already looked
    // up — it is never asked what an order's status is. Leave blank and every
    // answer is the shop's own wording.
    //
    // ai_model is the same default assistant.php uses when this is unset. On
    // a claude-haiku-5 model the shop also turns thinking off and asks for low
    // effort, which keeps a rewording inside the 6-second budget; any other
    // model is sent the plain request, because some reject those two fields.
    // A reply that adds a number, an order number, a link or an email the
    // shop did not say — or DROPS one it did, drops a condition (women's
    // clothing, unworn with tags, confirmed orders), runs past 1.3x the shop's
    // own sentence, or writes Arabic in Western digits — or is cut off, is
    // thrown away for the shop's own. Arabic is asked for in a Kuwaiti/Gulf
    // register, as the shop's own sentences are written.
    'ai_key'   => '',
    'ai_url'   => 'https://api.anthropic.com/v1/messages',
    'ai_model' => 'claude-haiku-5-5',

    // ElevenLabs, for reading answers aloud in Arabic.
    //
    // voice_id is the ONE value you have to choose yourself: open
    // elevenlabs.io -> Voices, filter to Arabic, and audition until you find a
    // Kuwaiti/Gulf male around 40. Paste its ID here. There is no "Kuwaiti"
    // switch — the accent lives in the voice you pick, not in a setting.
    //
    // The model must be multilingual or the Arabic comes out as English
    // phonemes read off Arabic letters, which is worse than silence.
    //
    // FOR A KUWAITI-ARABIC SHOP VOICE, two good choices:
    //   eleven_multilingual_v2  — highest quality, auto-detects language, a
    //                             little slower to synthesise. The safe default.
    //   eleven_turbo_v2_5       — faster and cheaper, and it ACCEPTS a fixed
    //                             language_code (below), which removes the
    //                             per-sentence language guess that trips up an
    //                             Arabic reply carrying a Latin order number.
    //                             Recommended once you have picked a voice.
    // Audio is cached after the first synthesis, so the model's speed only
    // costs on brand-new sentences — but the enforced language is a quality win
    // on every play. Pick an ElevenLabs voice that was cloned or designed on
    // Gulf/Kuwaiti Arabic; the model cannot add an accent the voice lacks.
    'tts_key'      => '',
    'tts_voice_id' => '',
    'tts_model'    => 'eleven_multilingual_v2',
    // ISO 639-1 language, e.g. 'ar'. Sent to ElevenLabs to PIN pronunciation
    // instead of letting the model detect it per request. Left blank it detects,
    // which is the old behaviour and the only option on multilingual_v2 (which
    // ignores this field). Set it to 'ar' when you move to eleven_turbo_v2_5.
    // Part of the cache key: changing it means the shop buys fresh audio.
    'tts_language_code' => '',
    // Spoken answers are cached here by content hash. The fixed replies
    // (delivery, returns, payment) are identical every time, so they are
    // synthesised ONCE and never paid for again. Above public_html: an audio
    // cache in the web root is a directory anyone can walk.
    'tts_cache_dir' => __DIR__ . '/../../sporta-voice',
    // Audio format. Speech, not music: 22 kHz / 32 kbps mono is a quarter of
    // the bytes of the API's 128 kbps default with nothing a listener can hear
    // for it, and these play on Kuwaiti mobile data. Part of the cache key —
    // change it and the cache is cold, so re-run the warmer.
    //
    // OTHER FORMATS WORK, and what changes with them is not only the bitrate:
    //   mp3_44100_192  high-quality mp3, roughly six times the bytes
    //   pcm_44100      LOSSLESS. The API returns HEADERLESS 16-bit samples,
    //                  which no browser will play, so the shop wraps them in a
    //                  WAV header and serves audio/wav. About 1.4 MB per eight
    //                  seconds — fine for the fixed sentences if you bake and
    //                  upload them (scripts/voice-bake.mjs), painful if a
    //                  customer's own order-status line is synthesised live on
    //                  Kuwaiti mobile data.
    // The extension and the Content-Type follow this setting; nothing else
    // needs changing.
    'tts_format' => 'mp3_22050_32',
    // Voice character. Stability low-ish keeps some life in the read; push it
    // up and a shop greeting starts to sound like a station announcement.
    // Worth an evening with the ElevenLabs preview before touching.
    'tts_stability'     => 0.45,
    'tts_similarity'    => 0.8,
    'tts_style'         => 0.0,
    'tts_speaker_boost' => true,
    // Seconds to wait for the voice. The customer is already reading the same
    // words on screen, so a slow voice is skipped rather than waited on.
    'tts_timeout' => 10,
    // Seconds a failed synthesis (no answer, a timeout, a 5xx) is remembered for that one sentence. Inside the window the
    // speaker answers 502 at once instead of calling the voice again, so a voice that is down cannot hold the server's workers
    // (round three, finding 14). Optional: absent means 30; 0 turns it off.
    'tts_fail_ttl' => 30,
    // Why a speaker button did nothing: wrong key, unknown voice, spent quota.
    // Defaults to sporta-voice.log beside the cache, ABOVE public_html.
    'tts_log' => '',

    // n8n. When a customer asks for a human, or the assistant cannot answer,
    // the conversation is POSTed here. n8n does the rest — WhatsApp, email,
    // a row in a sheet, whatever the shop wants. Blank = nothing is sent.
    'n8n_webhook' => '',
    // Sent as X-Sporta-Signature so the workflow can refuse anything that did
    // not come from this shop. A webhook URL is a secret only until it is in
    // somebody's browser history.
    'n8n_secret'  => '',

    // How old, in hours, a packed, shipped or not-yet-started order may be before
    // the assistant calls it LATE: it stops saying "within 24 hours" / "on its way"
    // and a person is told (n8n topic late_order). The promise is 24 hours, so 48
    // leaves a day of slack. OPTIONAL — a config without it behaves as 48.
    'assistant_late_hours' => 48,

    // EVERYTHING IN THIS SECTION CAN ALSO BE SET IN /backends -> "Sporta AI"
    // (assistant.php, "the owner's settings"): on/off, the welcome, ai_model,
    // the API key, assistant_late_hours and the hand-off number and e-mail. A
    // value saved there WINS over this file; a field left empty there falls back
    // to this file, and a key absent here falls back to the default in code.
    // The key saved there is write-only (the screen shows "set / not set"). The
    // model's address (ai_url) is NOT editable there: only this file sets it, and
    // with a key saved there and no ai_url here the Anthropic API is used.
    //
    // All OPTIONAL. Off answers every question with one line that says the
    // assistant is off and gives the number and e-mail below.
    'assistant_enabled' => true,
    // The welcome a hello is answered with, one per language. '' = the shop's own.
    'assistant_welcome_ar' => '',
    'assistant_welcome_en' => '',
    // The number (WhatsApp and calls) and e-mail every hand-off sentence gives.
    // Written as the sentences print it. Absent = '+965 22091914' / 'cs@sporta.com.kw'.
    'shop_phone' => '+965 22091914',
    'shop_email' => 'cs@sporta.com.kw',

    // ---------------------------------------------------------------- WhatsApp
    // Order updates to the CUSTOMER, through Meta's WhatsApp Cloud API.
    // Blank = the feature is off: nothing is queued and nothing is sent, so
    // leaving these empty is a valid production setup. See WHATSAPP.md.
    //
    // The PERMANENT access token, from a System User in Meta Business Manager.
    // A token generated in the Graph API Explorer expires in about an hour and
    // will strand every message with an auth error the day after it is set up.
    'whatsapp_token' => '',
    // The PHONE NUMBER ID — NOT the WhatsApp Business Account ID, and not the
    // phone number. All three are long digit strings on the same screen in
    // Meta's console, which is exactly why this is worth saying: the WABA id
    // in this field returns an error that reads like a permissions problem and
    // sends nobody anything.
    'whatsapp_phone_number_id' => '',
    // The approved TEMPLATE names. Every message this shop sends is
    // business-initiated — the customer has not messaged us — so freeform text
    // is not an option and a template is required. Register each name in Meta
    // Business Manager in BOTH Arabic and English; the language is chosen per
    // message from the one the customer was reading at checkout.
    //
    // Body variables are POSITIONAL and must be declared in this order:
    //   {{1}} customer name   {{2}} order number   {{3}} amount in KWD
    'whatsapp_template_confirmed' => '',
    'whatsapp_template_shipped'   => '',
    // The review invitation, sent once an order is marked DELIVERED. Its
    // variables differ from the two above because it carries a link:
    //   {{1}} customer name   {{2}} order number
    // and the button/URL variable is the signed review path, which the queue
    // supplies. Leave empty and no review is ever requested — the whole
    // feature is off, and nothing else changes.
    'whatsapp_template_review'    => '',
    // Override only to pin an API version or to point the tests at a fake.
    'whatsapp_api_base' => 'https://graph.facebook.com/v21.0',
];
