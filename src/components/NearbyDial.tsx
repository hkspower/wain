"use client";

import { useState } from "react";
import Link from "next/link";
import { distanceKm, places, toArabicDigits, type Place } from "@/lib/places";

type Status = "idle" | "locating" | "done" | "denied" | "unsupported";

const RADIUS_KM = 10;

export default function NearbyDial() {
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<(Place & { km: number })[]>([]);

  function findNearby() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const ranked = places
          .map((p) => ({ ...p, km: distanceKm(me, p) }))
          .sort((a, b) => a.km - b.km);
        setResults(ranked.slice(0, 4));
        setStatus("done");
      },
      () => setStatus("denied"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  const withinRadius = results.filter((p) => p.km <= RADIUS_KM);
  const shown = withinRadius.length > 0 ? withinRadius : results.slice(0, 3);

  return (
    <div className="flex flex-col items-center">
      {/* The dial */}
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-sun-300/60 animate-pulse-ring"
        />
        <button
          type="button"
          onClick={findNearby}
          disabled={status === "locating"}
          className="relative grid size-60 place-items-center rounded-full border-[6px] border-white bg-gradient-to-b from-sun-200 to-sun-400 px-6 text-center shadow-[0_18px_40px_-12px_rgba(180,120,10,0.55)] transition hover:from-sun-100 hover:to-sun-300 focus-visible:ring-offset-4 disabled:opacity-90 sm:size-72"
        >
          <span className="flex flex-col items-center gap-1">
            <span className="font-display text-4xl font-extrabold leading-none text-ink-900 sm:text-5xl">
              إلى وين؟
            </span>
            <span className="text-sm font-medium text-sun-900/80">
              {status === "locating" ? "نحدّد موقعك…" : "اضغط ودوّر حواليك"}
            </span>
            <span className="mt-2 rounded-full bg-ink-900 px-5 py-2 text-sm font-bold text-sun-100 shadow-sm">
              {status === "locating" ? "لحظة…" : "ابحث"}
            </span>
            <span className="mt-1 text-xs font-medium text-sun-900/70">
              أقرب الأماكن — {toArabicDigits(RADIUS_KM)} كم حواليك
            </span>
          </span>
        </button>
      </div>

      {/* Results / states */}
      <div className="mt-6 w-full max-w-xl">
        {status === "done" && (
          <div className="rounded-3xl border border-sand-200 bg-white/90 p-4 shadow-lg backdrop-blur">
            <p className="mb-3 text-center text-sm font-bold text-ink-800">
              {withinRadius.length > 0
                ? `لقينا ${toArabicDigits(withinRadius.length)} مكان قريب منك`
                : "ما فيه شي داخل النطاق، بس هذي أقرب الأماكن لك"}
            </p>
            <ul className="space-y-2">
              {shown.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/places/${p.slug}`}
                    className="flex items-center gap-3 rounded-2xl border border-transparent p-2.5 transition hover:border-sand-200 hover:bg-sand-50"
                  >
                    <span
                      aria-hidden="true"
                      className={`grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-xl ${p.gradient}`}
                    >
                      {p.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-ink-900">{p.nameAr}</span>
                      <span className="block truncate text-xs text-ink-500">{p.areaAr}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-sea-50 px-2.5 py-1 text-xs font-bold text-sea-700">
                      {toArabicDigits(p.km.toFixed(1))} كم
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(status === "denied" || status === "unsupported") && (
          <div className="rounded-3xl border border-sand-200 bg-white/90 p-5 text-center shadow-lg backdrop-blur">
            <p className="text-sm font-semibold text-ink-800">
              {status === "denied"
                ? "ما قدرنا نوصل لموقعك — تقدر تتصفّح كل الأماكن."
                : "متصفحك ما يدعم تحديد الموقع — تقدر تتصفّح كل الأماكن."}
            </p>
            <Link
              href="/explore"
              className="mt-3 inline-block rounded-xl bg-ink-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-ink-800"
            >
              تصفّح الأماكن
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
