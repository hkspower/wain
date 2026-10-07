/* ===========================================================================
   Sporta — site configuration.  سبورتا — إعدادات الموقع
   ---------------------------------------------------------------------------
   There is almost nothing to set here any more.

   The shop runs on ONE backend: MySQL on this same Hostinger plan, with PHP
   at /api. Its credentials live in public_html/api/config.php, on the server,
   never in this file — this one is served to every visitor.

   Edit, save, reload. Nothing to rebuild.
   حرّر واحفظ وأعد التحميل. لا حاجة لإعادة البناء.
   =========================================================================== */

window.SPORTA_CONFIG = {
  // Where the KNET PHP endpoints live. Leave EMPTY unless you moved them —
  // empty means "use the built-in default", https://www.sporta.com.kw/knet.
  payBaseUrl: '',

  // Where the CBK T-Pay endpoints live. Leave EMPTY unless you moved them;
  // empty means https://www.sporta.com.kw/pay. This is a DIFFERENT integration
  // from payBaseUrl above, with different credentials from the bank.
  cbkBaseUrl: '',

  // Where the store API lives. Leave EMPTY unless you moved /api.
  phpApiUrl: '',

  // Is T-Pay LIVE?  هل تي-باي مفعّل؟
  //
  // false until CBK has activated it and pay/config.php exists on the server
  // with the client id, secret and encrp key they issue. Until then the
  // checkout does not offer it — because an order placed against a gateway
  // that is not configured is taken, recorded, and then fails at the bank,
  // which is worse for the customer than never being offered the choice.
  //
  // Set to true, save, reload. No rebuild.
  //
  // SWITCHED ON 2026-10-07 at the owner's instruction, while the CBK ClientSecret and ENCRP_KEY were still
  // placeholders (the gateway is in TEST mode, pgtest.cbk.com). Until they are saved in /backends -> Payments a shopper
  // who chooses T-Pay is refused at the bank. To take it off again: set this back to false (or switch the method off in
  // /backends -> Payments, which hides it without a publish).
  // A STRING, not a boolean: the bundle reads config through a helper that only returns non-empty strings, and the
  // checkout compares the result with 'true' (patched 2026-10-07 — it used to compare with the boolean true, which that
  // helper can never return, so this switch could not turn T-Pay on). Anything else keeps T-Pay hidden.
  tpayEnabled: 'true',
}
