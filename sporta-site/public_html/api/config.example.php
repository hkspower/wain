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
    'db_name' => '',
    'db_user' => '',
    'db_pass' => '',

    // ---- Fulfilment emails (cron-fulfilment.php) ----
    // The logistics company. Comma-separated for more than one recipient.
    'warehouse_email' => '',
    // Must be an address on a domain with SPF/DKIM set (DNS-EMAIL-RECORDS.txt)
    // or the mail lands in spam and nobody is told.
    'mail_from'       => 'orders@sporta.com.kw',
    'mail_reply_to'   => 'cs@sporta.com.kw',

    // ---- Cron shared secret ----
    // hPanel -> Advanced -> Cron Jobs calls cron-fulfilment.php with this in
    // the query string, so a stranger cannot make the server send mail:
    //   wget -qO- "https://www.sporta.com.kw/api/cron-fulfilment.php?key=PASTE_THE_SAME_VALUE"
    // Any long random string. Change it here and in the cron line together.
    'cron_key' => '',

    // ---------------------------------------------------- سبورتا AI (optional)
    //
    // The assistant works with every one of these empty. They add, in order: a
    // model that rewords answers, a voice that speaks them, and a webhook that
    // hands a customer to a human.

    // A language model. It may only ever REWORD facts the shop already looked
    // up — it is never asked what an order's status is. Leave blank and every
    // answer is the shop's own wording.
    'ai_key'   => '',
    'ai_url'   => 'https://api.anthropic.com/v1/messages',
    // UNDATED on purpose. A dated snapshot pins the shop to one build and
    // stops working when that build is retired — and assistant_llm() treats a
    // failed call exactly like an unconfigured one, so the shop would go quiet
    // without saying so. Haiku is the right tier here rather than a cheap
    // choice: this call only rewords two sentences the shop has already
    // written, under a 6-second timeout, while a customer waits.
    'ai_model' => 'claude-haiku-4-5',

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

    // ------------------------------------------------------------- Web Push
    // A notification on the OWNER's phone when an order arrives. Blank = the
    // feature is off: nothing is queued, nothing is sent, and /backends says
    // so rather than offering a button that cannot work.
    //
    // These are a VAPID key pair — a P-256 public point and its private
    // scalar, both base64url. Generate them once, on the server, with:
    //
    // Run it on the Mac, in the repo — the server has no shell, and the pair
    // is not tied to the machine that made it. Full setup in NOTIFICATIONS.md.
    //
    //   php -r 'require "dropin/php-store/webpush.php";
    //           [$k,$p] = wp_generate_keypair();
    //           $d = openssl_pkey_get_details($k);
    //           echo "public : ", wp_b64_encode($p), "\n";
    //           echo "private: ", wp_b64_encode(str_pad($d["ec"]["d"],32,"\0",STR_PAD_LEFT)), "\n";'
    //
    // THE PAIR IS PERMANENT. Every subscription a phone has already made is
    // bound to the public key it was created with, so changing these silently
    // kills every existing subscription — the push service answers 403 and the
    // phone simply stops buzzing. Generate once, keep the private half here
    // and nowhere else.
    'vapid_public'  => '',
    'vapid_private' => '',
    // The `sub` claim: how a push service reaches a human about this sender.
    // Apple and Google both require it and both accept mailto: or https:.
    'vapid_subject' => 'mailto:cs@sporta.com.kw',

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

    // ------------------------------------------------------------------
    // Three settings the code already reads and this file never mentioned.
    //
    // Each has a working default, so nothing was broken — which is exactly
    // why they were easy to miss. A default nobody can see is a setting that
    // does not exist as far as the person running the shop is concerned, and
    // the way you discover one is by reading the source, which is the thing
    // this file exists to save you from.
    // ------------------------------------------------------------------

    // What the assistant tells a customer who asks how to reach a human.
    // MUST match the number the rest of the site shows. The storefront keeps
    // its own copy in the i18n translations, and npm run test:claims holds the
    // two together — it reads this file, because a phone number the assistant
    // reads aloud is not in the page HTML the suite scrapes, so a stale one
    // here would be quoted to customers with nothing to catch it.
    'shop_phone' => '+965 22091914',
    'shop_email' => 'cs@sporta.com.kw',

    // How long a PENDING CARD order keeps its stock reserved before
    // cron-stock.php puts it back. Minimum 15 minutes, whatever is set here.
    //
    // Both directions cost something, so it is a judgement rather than a
    // number to optimise. Too short and a shopper who is slowly typing a card
    // number loses the size out from under them. Too long and a size sits
    // reserved for somebody who closed the tab, invisible to everyone else.
    // Two hours is the default: comfortably longer than a checkout, short
    // enough that an abandoned bag frees up the same morning.
    'stock_hold_minutes' => 120,

    // NOT LISTED ON PURPOSE: tts_url. It exists to point the voice tests at a
    // fake ElevenLabs and has no reason to be set on a real server — a
    // production override would send the assistant's text to whatever host was
    // typed there.
];
