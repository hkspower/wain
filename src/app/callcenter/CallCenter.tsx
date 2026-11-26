"use client";

import { useState } from "react";
import SalemChat from "@/app/salem/SalemChat";
import ShouqCallButton from "@/components/ShouqCallButton";
import Link from "next/link";

/**
 * «مركز الاتصال»: شوق and سالم on one page, one tab each. شوق's tab is her
 * call button (the same launcher as /find and the header, so the call runs
 * the same way); سالم's tab is his typed chat, mounted inline (SalemChat's
 * `inline` mode), so the two never sit on top of each other.
 */
type Tab = "shouq" | "salem";

export default function CallCenter() {
  const [tab, setTab] = useState<Tab>("shouq");
  const tabs: { id: Tab; label: string }[] = [
    { id: "shouq", label: "شوق" },
    { id: "salem", label: "سالم" },
  ];

  return (
    <div className="mx-auto max-w-2xl gutter pb-6 pt-4">
      <div role="tablist" aria-label="مركز الاتصال" className="flex gap-2 rounded-2xl bg-white p-1 shadow-xs">
        {tabs.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`cc-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`cc-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`min-h-tap flex-1 rounded-xl px-4 py-2 font-display text-lg font-semibold transition ${
                on ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-sand-100"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "shouq" && (
        <div
          role="tabpanel"
          id="cc-panel-shouq"
          aria-labelledby="cc-tab-shouq"
          className="mt-4 flex flex-col items-center gap-6 rounded-3xl bg-white p-6 text-center shadow-xs"
        >
          <h2 className="font-display text-2xl font-bold text-ink-900">شوق — دليلتك في الكويت</h2>
          <p className="text-ink-600">كلّمها، وتدوّر لك وين تطلع.</p>
          <ShouqCallButton size="call" />
          <Link href="/search" className="inline-flex min-h-tap items-center px-4 text-sm font-semibold text-sea-700 underline">
            أو ابحث بالكتابة
          </Link>
        </div>
      )}

      {tab === "salem" && (
        <div role="tabpanel" id="cc-panel-salem" aria-labelledby="cc-tab-salem" className="mt-4">
          <SalemChat inline />
        </div>
      )}
    </div>
  );
}
