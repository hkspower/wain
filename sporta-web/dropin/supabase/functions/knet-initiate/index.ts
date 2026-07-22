// KNET initiate — builds the encrypted payment request and returns the URL to
// redirect the customer to KNET's hosted payment page.
//
// POST { amount: "12.500", trackid: "ORDER123", udf1?, udf2?... }
// -> { redirectUrl }
//
// Required function secrets (supabase secrets set ...):
//   KNET_TRANPORTAL_ID
//   KNET_TRANPORTAL_PASSWORD
//   KNET_RESOURCE_KEY
//   KNET_GATEWAY_URL        e.g. https://kpay.com.kw/kpg/PaymentHTTP.htm (LIVE)
//   KNET_RESPONSE_URL       your knet-response function URL (must be registered with KNET)
//   KNET_ERROR_URL          same as response URL is fine
//   PUBLIC_RETURN_URL       page the customer lands on after payment (your app)

import { knetEncrypt, buildTrandata } from "../_shared/knet.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const env = (k: string) => Deno.env.get(k) ?? "";
  const ID = env("KNET_TRANPORTAL_ID");
  const PW = env("KNET_TRANPORTAL_PASSWORD");
  const KEY = env("KNET_RESOURCE_KEY");
  const GATEWAY = env("KNET_GATEWAY_URL");
  const RESP = env("KNET_RESPONSE_URL");
  const ERR = env("KNET_ERROR_URL") || env("KNET_RESPONSE_URL");

  if (!ID || !PW || !KEY || !GATEWAY || !RESP) {
    return json({ error: "KNET is not fully configured (check function secrets)." }, 500);
  }

  let body: Record<string, string> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const amount = String(body.amount ?? "").trim();
  const trackid = String(body.trackid ?? "").trim();
  if (!amount || !trackid) return json({ error: "amount and trackid are required" }, 400);

  // KNET request fields. currencycode 414 = KWD, action 1 = purchase, langid EN.
  const trandata = buildTrandata({
    id: ID,
    password: PW,
    action: "1",
    langid: "EN",
    currencycode: "414",
    amt: amount,
    responseURL: RESP,
    errorURL: ERR,
    trackid,
    udf1: body.udf1 ?? "",
    udf2: body.udf2 ?? "",
    udf3: body.udf3 ?? "",
    udf4: body.udf4 ?? "",
    udf5: body.udf5 ?? "",
  });

  const encrypted = await knetEncrypt(trandata, KEY);

  // KNET expects trandata + tranportalId + responseURL + errorURL as form params.
  const params = new URLSearchParams({
    trandata: encrypted,
    tranportalId: ID,
    responseURL: RESP,
    errorURL: ERR,
  });

  // The customer's browser should be redirected here (GET) to reach KNET.
  const redirectUrl = `${GATEWAY}?${params.toString()}`;
  return json({ redirectUrl });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
