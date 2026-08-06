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
    'ai_model' => 'claude-haiku-4-5-20251001',

    // ElevenLabs, for reading answers aloud in Arabic.
    //
    // voice_id is the ONE value you have to choose yourself: open
    // elevenlabs.io -> Voices, filter to Arabic, and audition until you find a
    // Kuwaiti/Gulf male around 40. Paste its ID here. There is no "Kuwaiti"
    // switch — the accent lives in the voice you pick, not in a setting.
    //
    // The model must be multilingual or the Arabic comes out as English
    // phonemes read off Arabic letters, which is worse than silence.
    'tts_key'      => '',
    'tts_voice_id' => '',
    'tts_model'    => 'eleven_multilingual_v2',
    // Spoken answers are cached here by content hash. The fixed replies
    // (delivery, returns, payment) are identical every time, so they are
    // synthesised ONCE and never paid for again. Above public_html: an audio
    // cache in the web root is a directory anyone can walk.
    'tts_cache_dir' => __DIR__ . '/../../sporta-voice',
    // Audio format. Speech, not music: 22 kHz / 32 kbps mono is a quarter of
    // the bytes of the API's 128 kbps default with nothing a listener can hear
    // for it, and these play on Kuwaiti mobile data. Part of the cache key —
    // change it and the cache is cold, so re-run the warmer.
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
    // Override only to pin an API version or to point the tests at a fake.
    'whatsapp_api_base' => 'https://graph.facebook.com/v21.0',
];
