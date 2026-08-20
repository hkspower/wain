"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconLocate, IconPinSolid } from "@/components/icons";
import {
  centreFrame,
  embedUrl,
  fitFrame,
  project,
  unproject,
  zoomFrame,
  type MapFrame,
} from "@/lib/map-frame";

/**
 * Set a location by pointing at it.
 *
 * Coordinates were typed as two decimal numbers, which is exactly how a place
 * ends up a kilometre from where it is: nobody can tell 47.9857 from 47.9957
 * by reading it, and nothing on the form disagrees.
 *
 * Clicking maps back to a real coordinate rather than an approximation,
 * because the bbox and the frame are the same shape by construction — the same
 * property the result pins depend on. The numbers stay visible and editable;
 * this is a second way in, not a replacement.
 */

const DEFAULT_CENTRE = { lat: 29.3759, lng: 47.9774 }; // Mubarakiya
const ASPECT = 1.6;

export default function CoordinatePicker({
  lat,
  lng,
  onPick,
  label = "اضغط على الخريطة لتحديد الموقع",
}: {
  lat: number | null;
  lng: number | null;
  onPick: (at: { lat: number; lng: number }) => void;
  label?: string;
}) {
  const has = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng);
  const point = has ? { lat: lat as number, lng: lng as number } : DEFAULT_CENTRE;

  const [frame, setFrame] = useState<MapFrame>(() =>
    // A single point gives a street-level view; a wide one would make a click
    // land hundreds of metres from where it looked.
    fitFrame([point], { maxAspect: ASPECT, minAspect: ASPECT })
  );
  const [online, setOnline] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    addEventListener("online", sync);
    addEventListener("offline", sync);
    return () => {
      removeEventListener("online", sync);
      removeEventListener("offline", sync);
    };
  }, []);

  // Follow the numbers when they are edited by hand, so the two inputs and the
  // map never disagree about where the place is.
  const key = has ? `${lat},${lng}` : "";
  useEffect(() => {
    if (!has) return;
    setFrame((f) => centreFrame(f, { lat: lat as number, lng: lng as number }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the pair
  }, [key]);

  const marker = useMemo(() => (has ? project(frame, point) : null), [frame, has, point.lat, point.lng]);

  function pick(e: React.MouseEvent<HTMLDivElement>) {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    const at = unproject(frame, x, y);
    onPick({ lat: +at.lat.toFixed(5), lng: +at.lng.toFixed(5) });
  }

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        onPick({
          lat: +pos.coords.latitude.toFixed(5),
          lng: +pos.coords.longitude.toFixed(5),
        }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-500">{label}</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFrame((f) => zoomFrame(f, 0.5))}
            aria-label="تكبير"
            className="grid size-11 place-items-center rounded-xl border border-sand-300 bg-white text-lg font-bold text-ink-700 transition hover:border-sea-300"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setFrame((f) => zoomFrame(f, 2))}
            aria-label="تصغير"
            className="grid size-11 place-items-center rounded-xl border border-sand-300 bg-white text-lg font-bold text-ink-700 transition hover:border-sea-300"
          >
            −
          </button>
          <button
            type="button"
            onClick={useMyLocation}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-sand-300 bg-white px-3 text-xs font-semibold text-ink-700 transition hover:border-sea-300"
          >
            <IconLocate className="size-4" />
            موقعي
          </button>
        </div>
      </div>

      <div
        ref={boxRef}
        onClick={pick}
        style={{ aspectRatio: String(frame.aspect) }}
        className="relative w-full cursor-crosshair overflow-hidden rounded-2xl border border-sand-200 bg-sand-100"
      >
        {online && (
          <iframe
            src={embedUrl(frame)}
            title="اختر الموقع"
            loading="lazy"
            tabIndex={-1}
            aria-hidden="true"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className="pointer-events-none absolute inset-0 block h-full w-full border-0"
          />
        )}

        {marker && (
          <span
            aria-hidden="true"
            style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
            className="absolute z-10 -translate-x-1/2 -translate-y-full text-coral-600 drop-shadow"
          >
            <IconPinSolid className="size-9" />
          </span>
        )}

        {!has && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="rounded-full bg-ink-900/80 px-3 py-1.5 text-xs font-semibold text-white">
              اضغط لتحديد الموقع
            </span>
          </span>
        )}
      </div>

      {has && (
        <p dir="ltr" className="mt-1.5 text-center text-xs text-ink-500">
          {(lat as number).toFixed(5)}, {(lng as number).toFixed(5)}
        </p>
      )}
    </div>
  );
}
