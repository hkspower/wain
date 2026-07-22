import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";

// Customer lands here after CBK:
//   /payment/result?status=success|failed|cancelled|error&trackid=...&payid=...&ref=...
// We show the outcome and (optionally) re-confirm against the orders table.
export default function PaymentResult() {
  const [params] = useSearchParams();
  const status = params.get("status") ?? "error";
  const trackid = params.get("trackid") ?? "";
  const payid = params.get("payid") ?? "";

  const [confirmed, setConfirmed] = useState<null | string>(null);
  const [loading, setLoading] = useState(true);

  // Best-effort re-check of the order's stored status (source of truth).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!trackid) return setLoading(false);
      const { data } = await supabase
        .from("orders")
        .select("payment_status")
        .eq("track_id", trackid)
        .maybeSingle();
      if (alive) {
        setConfirmed(data?.payment_status ?? null);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [trackid]);

  const effective = confirmed === "paid" ? "success" : confirmed === "failed" ? "failed" : status;

  const view = {
    success: {
      icon: <CheckCircle2 className="h-16 w-16 text-emerald-500" />,
      title: "Payment successful",
      msg: "Your payment was received. Thank you!",
    },
    failed: {
      icon: <XCircle className="h-16 w-16 text-rose-500" />,
      title: "Payment failed",
      msg: "Your payment was not completed. You have not been charged.",
    },
    cancelled: {
      icon: <Clock className="h-16 w-16 text-amber-500" />,
      title: "Payment cancelled",
      msg: "The payment was cancelled or expired. You can try again.",
    },
    error: {
      icon: <XCircle className="h-16 w-16 text-slate-400" />,
      title: "Something went wrong",
      msg: "We couldn't confirm your payment. If you were charged, contact support.",
    },
  }[effective] ?? {
    icon: <XCircle className="h-16 w-16 text-slate-400" />,
    title: "Unknown status",
    msg: "",
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
        {loading ? (
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-indigo-600" />
        ) : (
          <>
            <div className="mb-4 flex justify-center">{view.icon}</div>
            <h1 className="text-2xl font-bold text-slate-800">{view.title}</h1>
            <p className="mt-2 text-slate-500">{view.msg}</p>
            {trackid && (
              <p className="mt-4 text-xs text-slate-400">
                Order: {trackid}
                {payid && ` · Payment: ${payid}`}
              </p>
            )}
            <div className="mt-6 flex justify-center gap-3">
              <Button asChild className="bg-indigo-600 hover:bg-indigo-700">
                <Link to="/">Back to home</Link>
              </Button>
              {effective !== "success" && (
                <Button asChild variant="outline">
                  <Link to="/checkout">Try again</Link>
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
