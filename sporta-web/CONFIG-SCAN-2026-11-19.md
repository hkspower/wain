# Config file scan, 2026-11-19 (read-only)

Owner: "scan config file". Scope: the live configuration files (the store's `api-config.php`, the KNET and T-Pay files, the mail file, the public `config.js`) and the
rules the code applies to them. **No secret value was read out or printed**: the live scan reports key names with a verdict (present / empty / absent / equals the shipped
example / length bucket); only an allow-list of non-secret settings (modes, public URLs, hosts, file paths, numbers) shows a value. Nothing was written or changed.

**Method.** (1) `scripts/sec-config-scan.mjs` with `SEC_MODE=keys` (commit `dc644d07`), a one-shot job on the VPS with `/docker/sporta` mounted read-only (project
`sporta-cfgscan`, deleted afterwards). (2) `node scripts/config-rules-test.mjs`, the static rules suite (the resolver, broken configs, numeric edges, the key inventory, the
database, `config.js`): 148 ok, **4 failing checks**, 17 known gaps.

## Live files

| File | Mode, owner | Verdict |
|---|---|---|
| `private/api-config.php` (9,655 B, 34 keys) | 0440 root:33, folder 0755 | right: not readable by others, not writable |
| `private/config/knet-config.php` (22 keys) | 0600 33:33, folder 0700 | right |
| `private/config/pay-config.php` (24 keys) | 0600 33:33, folder 0700 | right |
| `private/mail/msmtprc` | 0440 root:33 | right: TLS and auth on, host `smtp.hostinger.com:465`, the password is read at send time from `/run/sporta-mail/password` |
| `site/config.js` (public by design) | 0644 | holds only `payBaseUrl`, `cbkBaseUrl`, `phpApiUrl`; no secret-looking word |
| `site/` | | no `config.php`, `.env`, `api-config.php`, `knet-config.php` or `pay-config.php` anywhere in the web root; the three log and token files are outside it (`/var/lib/sporta/`) |

The database name, user and password are read from `/run/secrets/` by all three files; the KNET and T-Pay values equal the secret files.

## Findings

| # | Severity | What | Who decides |
|---|---|---|---|
| CF-01 | **High** | **The live KNET credentials are the shipped placeholders.** In `private/config/knet-config.php`, `tranportal_id`, `tranportal_password` and `resource_key` all EQUAL the values in `config.example.php`; `resource_key` is not 16 bytes (AES-128 needs exactly 16); `env` is `test`. The direct KNET card path cannot take a payment. This is why checkout offers cash only (known since 2026-11-18). The merchant and terminal ids are set. | Owner: real Tranportal credentials from KNET (and `env=production` when live). |
| CF-02 | Medium | **Two stray config copies sit next to the live ones:** `private/knet-config.php` (3,643 B) and `private/pay-config.php` (4,172 B). The shop does not read them. The KNET one carries the same placeholder credentials and is the file `set-knet.sh` edits (`KNET-K063-CHECK.md` A1), so an edit made with that script lands in a file nothing reads. Both are 0600 33:33, outside the web root, so not reachable. | Owner: delete or rename them (a deletion on the server needs an explicit yes). |
| CF-03 | Medium | **T-Pay has only test credentials, and KNET is switched onto it.** In `pay-config.php`: `client_id`, `client_secret` and `encrp_key` equal the `test_*` ones, the `production_*` ones are empty, `env` is `test`, `server_ip_1` and `server_ip_2` are empty (the VPS address `187.7.78.123` is to be registered with CBK as Merchant Server IP 1), and **`knet_via_cbk` is `true`**, so `/knet/pay.php` hands a KNET order to the CBK page. If card payments are switched on in /backends today, they would run on the CBK **test** gateway. (On 2026-11-18 the T-Pay `client_id` was not set; it is now: the owner entered test credentials in the meantime.) | Owner: production credentials, `env=production`, the server IP, before turning cards on. |
| CF-04 | Low | `cod_hold_hours` is absent. The code default (24 hours) applies, so the 24-hour cash-order auto-cancel runs; the key is just not written down. | None needed; write it if the owner wants a different number. |
| CF-05 | Info | **Features that are off because their keys are empty:** `ai_key` (Sporta AI answers fixed texts only), `tts_key` and `tts_voice_id` (no voice), `n8n_webhook` and `n8n_secret`, `whatsapp_token`, `whatsapp_phone_number_id` and the three WhatsApp templates. | Owner decision per feature. |
| CF-06 | Info | The live KNET file has keys its shipped example does not mention (`test_merchant_id`, `test_terminal_id`, `production_merchant_id`, `production_terminal_id`, `merchant_id`, `terminal_id`); the T-Pay example lacks `server_ip_*`, the `test_*` and `production_*` triples and `knet_via_cbk`. | Repo: add them to the two `config.example.php` files. |
| CF-07 | Info | The generic T-Pay triple equals the `test_*` triple (one value used under two names). Harmless while `env` is `test`; it means the production triple must be filled in separately. | Part of CF-03. |

## What the static rules suite says (`config-rules-test.mjs`, 148 ok)

Four failing checks, all bookkeeping of keys added after the manifest was last updated, none a behaviour fault:

1. **Key manifest lacks `apple_state_secret`, `apple_services_id`, `apple_signin_enabled`, `apple_jwks_url` and `admin_alert_email`** (the code reads them; no manifest entry with a default and a secret flag).
2. **Three of them (`apple_state_secret`, `apple_services_id`, `apple_jwks_url`) are read without a default and without a stated reason** (asserted, gated or required).
3. **`config.example.php` documents `hide_products_without_photo`, `hide_products_without_sku` and `admin_alert_email`, which the manifest does not know.**
4. **`config-13` "gap closed":** the `settings_save` `!empty()` problem was fixed since the suite recorded it; its entry in the known-gaps list must be deleted and the rule made a plain assertion.

Seventeen known gaps stay open (each stated in the suite with its fix): a `SPORTA_PRIVATE_CONFIG_DIR="0"` spelling, a BOM in `api-config.php` reaching the browser, junk in `order_cooldown_seconds` / `cod_hold_hours` reading as "off",
`stock_hold_minutes=''` and `assistant_late_hours=''` meaning 15 minutes / 1 hour, `result_page_url` read without a default in both bank callbacks, a hand-edited `knet_via_cbk` of `'false'` switching KNET onto CBK,
three birthday columns no `.sql` file creates, unvalidated public hero and theme JSON, a hero row that makes `json_encode()` fail (an empty 200), `config.js` URLs used as written, and **`config-14`: the theme defaults and the invalid-colour fallback
are terracotta `#c76a42` / `#99452b`, not the brand orange `#FF7B17`** (the owner decides whether the shop's own default theme should follow the brand rule). The `test:config-rules` script is not in `package.json` (run `node scripts/config-rules-test.mjs`).

## What was not done

No value was compared or shown beyond the allow-list; the owner's saved `settings` rows (checkout switches, theme) are in the database, not in these files, and were not read. Whether `checkout.knet` is on was not checked.

## Status, 2026-11-19 (owner: "fix all") — fixed in the repo, NOT deployed (ships with the next API release, behind the release gate)

`node scripts/config-rules-test.mjs` (also `npm run test:config-rules` now): **0 failing checks, 161 ok, 7 known gaps open** (it was 4 failing, 148 ok, 17 gaps).

- **The four failing bookkeeping checks:** the manifest now has `apple_signin_enabled`, `apple_services_id`, `apple_state_secret`, `apple_jwks_url`, `admin_alert_email`,
  `hide_products_without_photo` and `hide_products_without_sku` (default, secret flag, the reason a bare read is safe); `config-13` is a plain assertion now.
- **Closed gaps (code fixed, rule asserted):**
  - `config-1` `SPORTA_PRIVATE_CONFIG_DIR="0"`: the store tests the variable against false and "" like both gateways (`config-path.php`), so all three refuse it.
  - `config-2` a BOM or stray output in the store config: `store_config()` buffers and discards the `require`, so it can no longer stop the response's headers.
  - `config-4` and `config-5`: one reader, `store_config_int()`: absent, '' and anything that is not a plain number (a word, NAN, INF, a boolean, an array) is the DEFAULT, never 0 = "off"; real numbers are clamped. Used by `order_cooldown_seconds`, `cod_hold_hours`, `order_client_units`, `stock_hold_minutes` (new `store_stock_hold_minutes()`, `abandoned.php`, `cron-stock.php`) and `assistant_late_hours`.
  - `config-6` both bank callbacks fall back to `https://www.sporta.com.kw/payment/result` when `result_page_url` is missing or empty.
  - `config-7` `order_client_units`, `tts_url` and T-Pay `server_ip_1` / `_2` are in the example files.
  - `config-12` `store_json()` (behind `store_out` and `store_out_early`) substitutes what `json_encode()` cannot write (INF, NAN, invalid UTF-8) instead of answering an empty 200.
  - `config-13` `theme.dark` is read as a boolean spelling (the string "false" is off); hero `shuffle` / `autoplay` already went through `store_admin_switch()`.
- **CF-06 closed:** the three example files list the keys the live files carry (`test_*` / `production_*` merchant, terminal and credential slots, `knet_via_cbk`, `server_ip_*`), commented out.
- **Still open, and why:** `config-9` (`knet_via_cbk` read with `!empty()`: a hand-edited "false" string would send KNET to CBK; the fix is the same helper in four gateway files, two of which must also run without the shared resolver: a money-path change for the review gate); `config-10` (three birthday columns no `.sql` creates: needs a migration and the live schema's answer); `config-11` (hero and theme answers returned unvalidated); `config-14` (the default theme colours are terracotta, not the brand orange: the owner decides); `config-15` (`config.js` URLs used as written).
- **Not code, still the owner's:** CF-01 (real KNET credentials), CF-02 (delete the two stray config copies in `private/`), CF-03 (T-Pay production credentials and server IP before cards go on), CF-05 (features whose keys are empty).
