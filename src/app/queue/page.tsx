import type { Metadata } from "next";
import QueueTracker from "@/components/QueueTracker";
import BackButton from "@/components/BackButton";

export const metadata: Metadata = {
  title: "دوري",
  description: "تابع دورك في الصالون — كم واحد قدامك، وكم باقي تقريباً.",
  // Empty until a device has taken a number, so there is nothing to index.
  robots: { index: false, follow: false, nocache: true },
  // No canonical: the layout's «/» beside «noindex» said «do not index me,
  // I am the home page».
  alternates: { canonical: null },
};

export default function QueuePage() {
  return (
    <div className="mx-auto max-w-3xl gutter py-2 sm:py-3">
      <BackButton />
      <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">دوري</h1>
      <p className="mt-2 text-ink-600">
        الأدوار اللي أخذتها اليوم من هالمتصفح.
      </p>
      <div className="mt-8">
        <QueueTracker />
      </div>
    </div>
  );
}
