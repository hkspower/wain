"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import ShouqCallButton from "@/components/ShouqCallButton";
import { IconSearch } from "@/components/icons";
import { WAIN_AI_COPY } from "@/lib/wain-ai";

/**
 * The two ways to say what you want, drawn as one choice rather than found
 * along the way.
 *
 * This used to be the dial's own in-place panel: tap «إلى وين؟», get the
 * five nearest places, ranked live against a GPS fix taken in the same
 * gesture. That panel is gone — this page replaces it, on request, so a tap
 * on the dial now asks HOW you want to look before showing you anything,
 * rather than assuming "nearest" is always the question. /search still
 * answers the "nearest" case (شوق can ask where you are; nothing here
 * requests location any more).
 *
 * Two options, not three: شوق is one call, not two — سالم is a mid-call
 * voice swap (`WainAiCall`'s «بصوت سالم» button), not a second persona to
 * choose between up front. Naming him here would promise a different
 * assistant when it is the same one, in a different voice, one tap deeper.
 */
export default function FindChoice() {
  const router = useRouter();

  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2">
      <Link
        href="/search"
        className="flex flex-col items-center gap-3 rounded-3xl border border-line bg-white p-8 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
      >
        <span className="grid size-20 place-items-center rounded-full bg-sea-50 text-sea-700">
          <IconSearch className="size-9" />
        </span>
        <span className="font-display text-xl font-bold text-ink-900">اكتب</span>
        <span className="text-sm text-ink-500">دوّر باسم المكان أو المنطقة</span>
      </Link>

      {/* Not a button wrapping ShouqCallButton — the two are the same
          control, and nesting them would either bury the real one under a
          dead click target or (nested <button>s are invalid) break it
          outright. The real ShouqCallButton IS the tap target here; the
          heading and hint beside it are label, not a second control — same
          shape as `SearchHub`, which sits it next to a hint span for the
          identical reason: a bespoke button drawn to look like this one
          would ring silently, because the tap has to spend the user gesture
          on haptic/primeAudio synchronously, inside the real component. */}
      <div className="flex flex-col items-center gap-3 rounded-3xl border border-line bg-white p-8 text-center shadow-sm">
        <ShouqCallButton
          size="lg"
          className="bg-coral-50"
          onTapped={() => router.push("/search")}
        />
        <span className="font-display text-xl font-bold text-ink-900">
          كلّم {WAIN_AI_COPY.name}
        </span>
        <span className="text-sm text-ink-500">{WAIN_AI_COPY.callHint}</span>
      </div>
    </div>
  );
}
