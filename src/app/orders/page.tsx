import type { Metadata } from "next";
import OrderTracker from "@/components/OrderTracker";

export const metadata: Metadata = {
  title: "طلباتي",
  description: "تابع طلباتك المسبقة — وين وصل كل طلب، ومتى يصير جاهز للاستلام.",
  // Nothing here is content: the page is empty until a device that has placed
  // an order opens it. Keeping it out of search also keeps it out of previews.
  robots: { index: false, follow: false, nocache: true },
};

export default function OrdersPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 standalone:py-5 sm:px-6 sm:py-14">
      <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">طلباتي</h1>
      <p className="mt-2 text-ink-600">
        الطلبات اللي أرسلتها من هذا الجهاز. الدفع دايماً عند الاستلام.
      </p>
      <div className="mt-8">
        <OrderTracker />
      </div>
    </div>
  );
}
