import { useState } from "react";
import { Button } from "@/components/ui/button";
import { startCbkCheckout, type StartCheckoutInput } from "@/lib/checkout";
import { Loader2 } from "lucide-react";

// Drop-in "Pay with KNET / CBK" button.
//   <CheckoutButton amount={12.5} ref="Order #1024" />
export function CheckoutButton({
  amount,
  orderId,
  payRef,
  lang,
  payType,
  children,
}: {
  amount: number | string;
  orderId?: string;
  payRef?: string;
  lang?: "en" | "ar";
  payType?: "" | "1" | "2";
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pay() {
    setBusy(true);
    setError("");
    try {
      const input: StartCheckoutInput = { amount, orderId, ref: payRef, lang, payType };
      await startCbkCheckout(input); // redirects away on success
    } catch (e) {
      setError((e as Error).message || "Could not start payment.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={pay} disabled={busy} className="bg-indigo-600 hover:bg-indigo-700">
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {children ?? `Pay ${Number(amount).toFixed(3)} KWD`}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
