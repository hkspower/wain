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
}
