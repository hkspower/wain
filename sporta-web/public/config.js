/* ===========================================================================
   Sporta — site configuration.  سبورتا — إعدادات الموقع
   ---------------------------------------------------------------------------
   Edit the two values below, save, and reload the site. Nothing to rebuild.
   حرّر القيمتين أدناه ثم احفظ وأعد تحميل الموقع. لا حاجة لإعادة البناء.

   Where to find them:
     Supabase dashboard -> Project Settings -> API
       supabaseUrl      = "Project URL"
       supabaseAnonKey  = the "anon" / "public" key   (NOT the service key)

   The anon key is meant to be public — the browser needs it, and row-level
   security is what protects your data. The SERVICE key is different: it must
   never appear in this file. It belongs only in knet/config.php on the server.
   مفتاح anon عام بطبيعته. أما مفتاح service فلا يوضع هنا إطلاقاً.
   =========================================================================== */

window.SPORTA_CONFIG = {
  /* -------------------------------------------------------------------------
     WHICH BACKEND?  أي خادم؟
     Leave `backend` EMPTY to use Supabase (the two values below it).
     Set backend: 'php' to run NATIVE — MySQL on this same Hostinger plan,
     no Supabase anywhere. Needs /api uploaded and the database imported:
     see NATIVE-BACKEND.md. Flipping this line back restores Supabase.
     ------------------------------------------------------------------------- */
  backend: '',

  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'your-anon-public-key',

  // Where the KNET PHP endpoints live. Leave EMPTY unless you moved them —
  // empty means "use the built-in default", https://www.sporta.com.kw/knet.
  // (A concrete value here wins over everything, including a build-time
  // VITE_PAY_BASE_URL, which is why the default is empty rather than the URL.)
  payBaseUrl: '',

  // Where the CBK hosted gateway lives — the one that does T-Pay QR. Leave
  // EMPTY unless you moved it; empty means https://www.sporta.com.kw/pay.
  // This is a DIFFERENT integration from payBaseUrl above, with different
  // credentials from the bank. T-Pay cannot work through /knet.
  cbkBaseUrl: '',
}
