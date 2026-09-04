import type { Metadata } from "next";
import QueueTracker from "@/components/QueueTracker";

export const metadata: Metadata = {
  title: "دوري",
  description: "تابع دورك في الصالون — كم واحد قدامك، وكم باقي تقريباً.",
  // Empty until a device has taken a number, so there is nothing to index.
  robots: { index: false, follow: false, nocache: true },
};

export default function QueuePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 standalone:px-3 standalone:py-4 sm:px-6 sm:py-14">
      <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">دوري</h1>
      <p className="mt-2 text-ink-600">
        الأدوار اللي أخذتها اليوم من هذا الجهاز.
      </p>
      <div className="mt-8">
        <QueueTracker />
      </div>
    </div>
  );
}
