// KNET response — KNET posts the encrypted result here after payment.
// Decrypts, verifies, records the payment, then redirects the customer back
// to your app's success/failure page.
//
// Register THIS function's URL with KNET Co as your production responseURL.
//
// Secrets used: KNET_RESOURCE_KEY, PUBLIC_RETURN_URL,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (to update the order).

import { knetDecrypt, parseResponse } from "../_shared/knet.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const env = (k: string) => Deno.env.get(k) ?? "";
  const KEY = env("KNET_RESOURCE_KEY");
  const RETURN = env("PUBLIC_RETURN_URL"); // e.g. https://www.sporta.com.kw/payment/result

  // KNET posts application/x-www-form-urlencoded with a "trandata" field.
  let trandata = "";
  try {
    const form = await req.formData();
    trandata = String(form.get("trandata") ?? "");
  } catch {
    const url = new URL(req.url);
    trandata = url.searchParams.get("trandata") ?? "";
  }

  if (!trandata || !KEY) {
    return redirect(`${RETURN}?status=error&reason=missing_data`);
  }

  let fields: Record<string, string>;
  try {
    const plain = await knetDecrypt(trandata, KEY);
    fields = parseResponse(plain);
  } catch {
    return redirect(`${RETURN}?status=error&reason=decrypt_failed`);
  }

  // KNET result codes: CAPTURED / APPROVED = success. Others = not paid.
  const result = (fields.result ?? "").toUpperCase();
  const paid = result === "CAPTURED" || result === "APPROVED";
  const trackid = fields.trackid ?? "";
  const paymentid = fields.paymentid ?? "";
  const tranid = fields.tranid ?? "";
  const ref = fields.ref ?? "";
  const auth = fields.auth ?? "";

  // Record the outcome against the order (best-effort; don't block redirect).
  try {
    const supaUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (supaUrl && serviceKey && trackid) {
      const supabase = createClient(supaUrl, serviceKey);
      await supabase.from("orders").update({
        payment_status: paid ? "paid" : "failed",
        knet_result: result,
        knet_paymentid: paymentid,
        knet_tranid: tranid,
        knet_ref: ref,
        knet_auth: auth,
        paid_at: paid ? new Date().toISOString() : null,
      }).eq("track_id", trackid);
    }
  } catch (_e) {
    // Logged server-side; still redirect the customer with the KNET result.
  }

  const status = paid ? "success" : "failed";
  return redirect(
    `${RETURN}?status=${status}&trackid=${encodeURIComponent(trackid)}&payid=${encodeURIComponent(paymentid)}&ref=${encodeURIComponent(ref)}`,
  );
});

function redirect(url: string) {
  // KNET expects an HTTP redirect response from the responseURL.
  return new Response(null, { status: 302, headers: { Location: url } });
}
