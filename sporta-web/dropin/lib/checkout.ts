// Start a CBK payment from the React app.
//
// Flow: create an order row with a UNIQUE track_id, then send the browser to
// the PHP endpoint on Hostinger, which redirects to CBK's hosted page.
//
// Set VITE_PAY_BASE_URL to your Hostinger pay folder, e.g.
//   VITE_PAY_BASE_URL=https://www.sporta.com.kw/pay

import { supabase } from "@/integrations/supabase/client";

const PAY_BASE = import.meta.env.VITE_PAY_BASE_URL || "https://www.sporta.com.kw/pay";

// Generate a unique, CBK-safe track id (alphanumeric, <= 30 chars).
export function makeTrackId(prefix = "SP"): string {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}${rand[0].toString(36)}${rand[1].toString(36)}`.slice(0, 30).toUpperCase();
}

export type StartCheckoutInput = {
  amount: number | string;   // KWD, up to 3 decimals, e.g. 12.5 -> "12.500"
  orderId?: string;          // your internal order id, if any
  ref?: string;              // short description shown on the pay page
  lang?: "en" | "ar";
  payType?: "" | "1" | "2";  // '' choose, '1' KNET, '2' T-Pay QR
};

// Formats amount to 3 decimals as CBK expects.
function fmtAmount(a: number | string): string {
  const n = typeof a === "string" ? parseFloat(a) : a;
  return Number.isFinite(n) ? n.toFixed(3) : "0.000";
}

// Creates the order (pending) then redirects to payment.
export async function startCbkCheckout(input: StartCheckoutInput): Promise<void> {
  const trackId = makeTrackId();
  const amount = fmtAmount(input.amount);

  // Record a pending order so callback.php can match on track_id later.
  const { error } = await supabase.from("orders").insert({
    track_id: trackId,
    amount,
    payment_status: "pending",
    order_ref: input.orderId ?? null,
  });
  if (error) throw new Error(`Could not create order: ${error.message}`);

  const params = new URLSearchParams({ amount, trackid: trackId });
  if (input.ref) params.set("ref", input.ref);
  if (input.lang) params.set("lang", input.lang);
  if (input.payType) params.set("paytype", input.payType);

  window.location.href = `${PAY_BASE}/pay.php?${params.toString()}`;
}
