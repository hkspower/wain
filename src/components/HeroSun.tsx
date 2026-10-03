"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { haptic } from "@/lib/haptics";

/**
 * The hero's sun, as one round button — 3 October, on request («make sun like
 * full button with active haptic feel»).
 *
 * The whole disc was always the link, but nothing about it said so: only the
 * small «ابدأ» pill looked pressable, and a press changed a 5% tint nobody
 * could see. Now the disc carries a light rim at rest, and on press it sinks —
 * an inner shadow and a shade over the painted sun, the label dipping with it
 * — with a tick under the finger.
 *
 * Why a client component at all: the tick. `haptic()` is the Vibration API,
 * which Android Chrome has and iOS Safari does not (see lib/haptics.ts), so on
 * an iPhone the sinking is the whole of the feedback, by design.
 *
 * `data-pressed` rather than `:active` alone, for two reasons measured on
 * phones before: iOS applies `:active` only to elements with a touch listener,
 * and a tap that navigates releases within a frame, so the press was never
 * seen. The state holds for at least PRESS_MS so the sink is visible.
 */
const PRESS_MS = 140;

export default function HeroSun({
  style,
  labelStyle,
}: {
  style: CSSProperties;
  labelStyle: CSSProperties;
}) {
  const [pressed, setPressed] = useState(false);
  const since = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const down = () => {
    if (timer.current) clearTimeout(timer.current);
    since.current = performance.now();
    setPressed(true);
    haptic("tap");
  };
  const up = () => {
    const left = Math.max(0, PRESS_MS - (performance.now() - since.current));
    timer.current = setTimeout(() => setPressed(false), left);
  };

  return (
    <Link
      href="/find"
      data-hero-sun
      data-pressed={pressed || undefined}
      aria-label="إلى وين؟ — اكتب أو كلّم شوق"
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={up}
      className="hero-sun group absolute aspect-square rounded-full focus-visible:ring-offset-0"
      style={style}
    >
      {/* A ring that breathes out from the disc's rim, so the sun reads as
          something to press. A ring and not a fill: a fill would wash yellow
          over the Kuwait Towers standing in front of it. Still while pressed. */}
      <span aria-hidden="true" className="absolute inset-0 rounded-full ring-4 ring-sun-200 animate-pulse-ring group-data-pressed:animate-none group-data-pressed:opacity-0" />
      {/* The face: a rim at rest, a sink under the finger. */}
      <span aria-hidden="true" className="hero-sun-face absolute inset-0 rounded-full" />
      <span
        className="hero-sun-label absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-[2cqw] text-center"
        style={labelStyle}
      >
        <span className="home-hero-title font-display font-bold text-ink-900">إلى وين؟</span>
        <span className="home-hero-go rounded-full bg-ink-900 font-semibold text-sun-100 shadow-sm transition group-hover:bg-ink-800">
          ابدأ
        </span>
      </span>
    </Link>
  );
}
