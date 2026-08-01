"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  categoryGradient,
  countAr,
  distanceKm,
  places,
  PLACES_COUNT,
  toArabicDigits,
} from "@/lib/places";

/** Kuwait City (Mubarakiya). Used so results work without asking for location. */
const KUWAIT_CENTER = { lat: 29.3759, lng: 47.9774 };
const RADIUS_KM = 10;
/** Beyond this the visitor clearly is not in Kuwait, so distances are useless. */
const OUTSIDE_KUWAIT_KM = 150;
const MAX_SHOWN = 5;

type GeoError = "denied" | "unavailable" | "timeout" | "insecure" | "outside";

export default function NearbyDial() {
  const [opened, setOpened] = useState(false);
  const [locating, setLocating] = useState(false);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<GeoError | null>(null);

  const from = origin ?? KUWAIT_CENTER;

  const ranked = useMemo(
    () =>
      places
        .map((p) => ({ ...p, km: distanceKm(from, p) }))
        .sort((a, b) => a.km - b.km),
    [from]
  );

  // Count across ALL places, not just the ones we happen to display.
  const nearby = ranked.filter((p) => p.km <= RADIUS_KM);
  const shown = (nearby.length > 0 ? nearby : ranked).slice(0, MAX_SHOWN);

  function useMyLocation() {
    setGeoError(null);

    // Geolocation is only available in a secure context; on plain http it
    // silently never resolves, which looks like a hang.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setGeoError("insecure");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("unavailable");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocating(false);
        if (distanceKm(me, KUWAIT_CENTER) > OUTSIDE_KUWAIT_KM) {
          // Keep showing Kuwait rather than "٤٣٢١ كم".
          setGeoError("outside");
          return;
        }
        setOrigin(me);
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "denied"
            : err.code === err.TIMEOUT
              ? "timeout"
              : "unavailable"
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  const errorText: Record<GeoError, string> = {
    denied: "ما سمحت لنا بموقعك — نعرض لك أماكن وسط الكويت.",
    unavailable: "متصفحك ما يدعم تحديد الموقع — نعرض لك أماكن وسط الكويت.",
    timeout: "طوّلنا وما وصلنا لموقعك — جرّب مرة ثانية.",
    insecure: "تحديد الموقع يحتاج اتصال آمن (HTTPS).",
    outside: "يبدو إنك برّا الكويت — نعرض لك أشهر الأماكن في الكويت.",
  };

  return (
    <div className="flex flex-col items-center">
      {/* The dial. Tapping it just reveals places — it does not ask for
          permission, so no browser prompt appears unprompted. */}
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-sun-300/60 animate-pulse-ring"
        />
        <button
          type="button"
          onClick={() => setOpened(true)}
          aria-expanded={opened}
          className="relative grid size-60 place-items-center rounded-full border-[6px] border-white bg-gradient-to-b from-sun-200 to-sun-400 px-6 text-center shadow-[0_18px_40px_-12px_rgba(180,120,10,0.55)] transition hover:from-sun-100 hover:to-sun-300 focus-visible:ring-offset-4 sm:size-72"
        >
          <span className="flex flex-col items-center gap-1">
            <span className="font-display text-4xl font-extrabold leading-none text-ink-900 sm:text-5xl">
              إلى وين؟
            </span>
            <span className="text-sm font-semibold text-sun-900">
              اضغط ودوّر حواليك
            </span>
            <span className="mt-2 rounded-full bg-ink-900 px-5 py-2 text-sm font-bold text-sun-100 shadow-sm">
              ابحث
            </span>
            <span className="mt-1 text-xs font-semibold text-sun-900">
              أقرب الأماكن — {toArabicDigits(RADIUS_KM)} كم حواليك
            </span>
          </span>
        </button>
      </div>

      {opened && (
        <div className="mt-6 w-full max-w-xl rounded-3xl border border-sand-200 bg-white/95 p-4 shadow-lg backdrop-blur">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-ink-800">
              {/* "حواليك" is a preposition, so it agrees with every count
                  form — unlike an adjective, which would need to inflect. */}
              {nearby.length > 0
                ? `${countAr(nearby.length, PLACES_COUNT)} ${origin ? "حواليك" : "في وسط الكويت"}`
                : "أقرب الأماكن لك"}
            </p>
            {origin ? (
              <span className="flex items-center gap-1 rounded-full bg-palm-500/10 px-2.5 py-1 text-xs font-bold text-palm-600">
                <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden="true">
                  <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
                </svg>
                من موقعك
              </span>
            ) : (
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                className="flex items-center gap-1.5 rounded-full bg-sea-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-sea-800 disabled:opacity-70"
              >
                <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden="true">
                  <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
                </svg>
                {locating ? "نحدّد موقعك…" : "استخدم موقعي"}
              </button>
            )}
          </div>

          {geoError && (
            <p className="mb-3 rounded-2xl bg-sand-100 px-3 py-2 text-xs font-semibold text-ink-600">
              {errorText[geoError]}
            </p>
          )}

          <ul className="space-y-2">
            {shown.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/places/${p.slug}`}
                  className="flex items-center gap-3 rounded-2xl border border-transparent p-2.5 transition hover:border-sand-200 hover:bg-sand-50"
                >
                  <span
                    aria-hidden="true"
                    className={`grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-xl ${categoryGradient(p.category)}`}
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

          <Link
            href="/explore"
            className="mt-3 block rounded-2xl bg-ink-900 px-5 py-2.5 text-center text-sm font-bold text-white transition hover:bg-ink-800"
          >
            شوف كل الأماكن ↗
          </Link>
        </div>
      )}
    </div>
  );
}
