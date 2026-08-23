"use client";

import { useEffect, useRef } from "react";

/**
 * An analogue clock reading the real time in Kuwait.
 *
 * The one thing this must not do is show the PLAYER'S time. A clock
 * that reads "Kuwait" and quietly renders whatever the machine's own
 * timezone is would be right for one player in the world and wrong for
 * everyone else, and it would look correct while doing it — which is
 * the kind of bug that ships. So the zone is named, once, and the time
 * is derived from it rather than from the browser's locale.
 *
 * Kuwait is UTC+3 all year and has never observed daylight saving. That
 * is a fact about today and not a guarantee, so the offset is asked for
 * by IANA zone rather than typed in as three hours, and it is re-asked
 * every minute. If the country ever changes its mind the clock follows;
 * a hard-coded +3 would need a code change nobody would think to make.
 *
 * This is deliberately NOT the in-game clock. The game runs its own
 * time of day — racing is gated to the small hours — and the two would
 * be confused if they looked alike, so this one is labelled and sits
 * apart from the driving instruments.
 */

/** Milliseconds to add to UTC to get the wall-clock time in `zone`. */
function zoneOffsetMs(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const f: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") f[p.type] = Number(p.value);
  // hour comes back as 24 at midnight under hour12:false in some
  // engines, which Date.UTC would roll into the next day correctly
  // anyway — but the modulo makes the intent explicit.
  const asUTC = Date.UTC(f.year, f.month - 1, f.day, f.hour % 24, f.minute, f.second);
  // The formatted parts carry no milliseconds, so compare against the
  // instant truncated to the second or the offset comes out with the
  // current millisecond baked into it.
  return asUTC - (at.getTime() - at.getMilliseconds());
}

const ZONE = "Asia/Kuwait";

/**
 * The dial: twelve ticks, the quarters longer.
 *
 * The coordinates are ROUNDED, and that is not tidiness. Math.sin and
 * Math.cos are not required to be bit-identical between JavaScript
 * engines, and this component is server-rendered and then hydrated: Node
 * computed a tick at x = -23.815698604072054 and Chrome computed the
 * same tick at -23.815698604072058, React compared the two strings, and
 * every page load logged a hydration mismatch. Three decimals on a
 * 72-unit viewBox is a thousandth of the dial — far under a pixel — and
 * both engines agree on the string.
 */
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function ticks() {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const quarter = i % 3 === 0;
    const r0 = quarter ? 25 : 27.5;
    const r1 = 31;
    out.push(
      <line
        key={i}
        x1={r3(Math.sin(a) * r0)}
        y1={r3(-Math.cos(a) * r0)}
        x2={r3(Math.sin(a) * r1)}
        y2={r3(-Math.cos(a) * r1)}
        stroke="currentColor"
        strokeWidth={quarter ? 2.4 : 1.1}
        strokeLinecap="round"
        opacity={quarter ? 0.9 : 0.45}
      />
    );
  }
  return out;
}

export default function KuwaitClock() {
  const hourRef = useRef<SVGGElement | null>(null);
  const minRef = useRef<SVGGElement | null>(null);
  const secRef = useRef<SVGGElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let offset = zoneOffsetMs(ZONE, new Date());
    let offsetCheckedAt = Date.now();

    const tick = () => {
      const nowMs = Date.now();
      // Re-ask the zone once a minute rather than every frame: building
      // an Intl.DateTimeFormat is expensive and the answer changes at
      // most twice a year anywhere, and never here.
      if (nowMs - offsetCheckedAt > 60_000) {
        offset = zoneOffsetMs(ZONE, new Date(nowMs));
        offsetCheckedAt = nowMs;
      }
      // Kuwait's wall clock, expressed as an instant, then read with the
      // UTC getters — which is what makes this independent of whatever
      // timezone the player's machine is set to.
      const k = new Date(nowMs + offset);
      const h = k.getUTCHours() % 12;
      const m = k.getUTCMinutes();
      const s = k.getUTCSeconds() + k.getUTCMilliseconds() / 1000;

      // Hands carry the finer units, the way a real movement does: the
      // hour hand is already a third of the way between four and five at
      // twenty past, and a clock whose hour hand jumps on the hour reads
      // as a diagram of a clock rather than as one.
      const sa = (s / 60) * 360;
      const ma = ((m + s / 60) / 60) * 360;
      const ha = ((h + m / 60) / 12) * 360;
      hourRef.current?.setAttribute("transform", `rotate(${ha})`);
      minRef.current?.setAttribute("transform", `rotate(${ma})`);
      secRef.current?.setAttribute("transform", `rotate(${sa})`);

      if (textRef.current) {
        const hh = String(k.getUTCHours()).padStart(2, "0");
        const mm = String(k.getUTCMinutes()).padStart(2, "0");
        const next = `${hh}:${mm}`;
        // Only touch the DOM when the string actually changes — this
        // runs sixty times a second beside a 3D renderer.
        if (textRef.current.textContent !== next) textRef.current.textContent = next;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      data-testid="kuwait-clock"
      className="grn-panel pointer-events-none flex flex-col items-center gap-1 px-2.5 py-2"
    >
      <svg
        viewBox="-36 -36 72 72"
        className="size-[62px] text-white"
        aria-hidden="true"
      >
        <circle r="33" fill="rgba(6,8,11,0.55)" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
        {ticks()}
        {/* Hands are drawn pointing up and rotated, so the transform is
            the only thing that ever changes. */}
        <g ref={hourRef}>
          <line
            x1="0" y1="4" x2="0" y2="-17"
            stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"
          />
        </g>
        <g ref={minRef}>
          <line
            x1="0" y1="5" x2="0" y2="-25"
            stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"
          />
        </g>
        <g ref={secRef}>
          <line
            x1="0" y1="7" x2="0" y2="-28"
            stroke="var(--color-sodium-400, #f5b301)" strokeWidth="1" strokeLinecap="round"
          />
        </g>
        <circle r="2.1" fill="var(--color-sodium-400, #f5b301)" />
      </svg>
      <div className="flex items-baseline gap-1.5">
        <span
          ref={textRef}
          data-testid="kuwait-clock-digits"
          className="grn-display text-[0.7rem] tabular-nums tracking-[0.08em] text-white/85"
        />
        <span className="grn-label text-[0.5rem] tracking-[0.16em] text-white/45">
          KWT
        </span>
      </div>
    </div>
  );
}
