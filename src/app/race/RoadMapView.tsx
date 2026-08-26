"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { RoadMap } from "@/game/roadmap";
import type { HudData } from "@/game/engine";
import { arabicUI, latinDisplay } from "@/game/fonts";

/**
 * The whole road, full screen.
 *
 * The corner minimap answers one question — is the rival ahead or behind
 * — and everything else this world has been given a name for was
 * invisible on it. Ten districts, two roads with their real signage
 * names, two petrol stations, a drift circle, seven landmarks: the game
 * knew all of it and the map showed a closed outline with two dots.
 *
 * DRAWN ON A CANVAS, LABELS AND ALL, rather than positioned as DOM over
 * a canvas road. Two reasons and the second is the one that decided it:
 * a label has to know what is underneath it to stay readable, which is a
 * drawing problem rather than a layout one; and a map whose road is
 * painted at device resolution while its names are laid out in CSS
 * pixels comes apart the moment anybody zooms, which is exactly the
 * class of fault tools/shots/align.mjs exists to catch.
 *
 * IT DOES NOT PAUSE. The map shows what the HUD already shows, in a size
 * you can read; making it a pause would put an information screen inside
 * the one part of the game where pausing has rules — battles, the SP
 * referee, the challenge window — for no gain.
 */

/** How the marks are drawn, and what they mean. Order is draw order. */
const STYLE = {
  start: { fill: "#f5f5f5", r: 5, label: true },
  station: { fill: "#4ade80", r: 5.5, label: true },
  plaza: { fill: "#c084fc", r: 5.5, label: true },
  landmark: { fill: "#7dd3fc", r: 4, label: true },
  district: { fill: "", r: 0, label: true },
} as const;

const LEG_COLOR = ["#38c9ee", "#f5a524"];

/** The whole unmoving map — road, ticks, marks, labels, scale bar —
 *  painted into `base` at the current buffer size. Called once per
 *  resize, never per frame. */
function drawStatic(
  base: HTMLCanvasElement,
  map: RoadMap,
  W: number,
  H: number,
  side: number,
  ox: number,
  oy: number,
  u: number
): void {
  base.width = W;
  base.height = H;
  const ctx = base.getContext("2d");
  if (!ctx) return;
  const X = (x: number) => ox + x * side;
  const Y = (y: number) => oy + y * side;

  // --- The road: each named leg in its own colour, wide and dark
  // underneath so it reads as a road rather than a wire.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const pass of [0, 1]) {
    for (let i = 0; i < map.legs.length; i++) {
      const leg = map.legs[i];
      ctx.beginPath();
      for (let k = leg.from; k <= leg.to; k++) {
        const p = map.path[k];
        if (k === leg.from) ctx.moveTo(X(p.x), Y(p.y));
        else ctx.lineTo(X(p.x), Y(p.y));
      }
      if (pass === 0) {
        ctx.strokeStyle = "rgba(4,7,10,0.85)";
        ctx.lineWidth = 11 * u;
      } else {
        ctx.strokeStyle = LEG_COLOR[i % LEG_COLOR.length];
        ctx.lineWidth = 4.5 * u;
      }
      ctx.stroke();
    }
  }

  // --- Kilometre ticks, so a distance on the map is readable as one.
  ctx.strokeStyle = "rgba(255,255,255,0.30)";
  ctx.lineWidth = 1.5 * u;
  for (let m = 1000; m < map.lapLength; m += 1000) {
    const a = map.at(m - 6);
    const b = map.at(m + 6);
    // Perpendicular to the road, which is what a distance mark is.
    const dx = X(b.x) - X(a.x);
    const dy = Y(b.y) - Y(a.y);
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 8 * u;
    const ny = (dx / len) * 8 * u;
    const c = map.at(m);
    ctx.beginPath();
    ctx.moveTo(X(c.x) - nx, Y(c.y) - ny);
    ctx.lineTo(X(c.x) + nx, Y(c.y) + ny);
    ctx.stroke();
  }

  // --- Marks.
  //
  // Labels get a dark plate behind them rather than a stroke: this map
  // is drawn over a night scene and an outlined glyph on a dark road is
  // still a glyph on a dark road.
  const plate = (text: string, x: number, y: number, size: number, color: string, font: string) => {
    ctx.font = `600 ${size}px ${font}`;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(4,7,10,0.78)";
    ctx.fillRect(x - w / 2 - 5 * u, y - size * 0.86, w + 10 * u, size * 1.24);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y + size * 0.1);
  };

  for (const mk of map.markers) {
    const st = STYLE[mk.kind];
    const x = X(mk.x);
    const y = Y(mk.y);
    if (mk.kind === "district") {
      plate(mk.name.toUpperCase(), x, y - 15 * u, 13 * u, "rgba(255,255,255,0.92)", latinDisplay());
      plate(mk.arabic, x, y + 4 * u, 14 * u, "rgba(255,255,255,0.66)", arabicUI());
      continue;
    }
    ctx.beginPath();
    ctx.arc(x, y, st.r * u, 0, Math.PI * 2);
    ctx.fillStyle = st.fill;
    ctx.fill();
    ctx.lineWidth = 1.6 * u;
    ctx.strokeStyle = "rgba(4,7,10,0.9)";
    ctx.stroke();
    if (st.label) {
      plate(mk.name, x, y - 12 * u, 11 * u, st.fill || "#fff", latinDisplay());
    }
  }

  // --- Scale bar. A map without one is a picture.
  {
    const metres = 500;
    const px = metres * map.unitsPerMetre * side;
    const bx = ox + 16 * u;
    const by = oy + side - 20 * u;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + px, by);
    ctx.moveTo(bx, by - 5 * u);
    ctx.lineTo(bx, by + 5 * u);
    ctx.moveTo(bx + px, by - 5 * u);
    ctx.lineTo(bx + px, by + 5 * u);
    ctx.stroke();
    ctx.font = `600 ${11 * u}px ${latinDisplay()}`;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.textAlign = "left";
    ctx.fillText(`${metres} m`, bx, by - 9 * u);
  }
}

export default function RoadMapView({
  map,
  liveRef,
  onClose,
}: {
  map: RoadMap;
  /** The per-frame half, read straight from the HUD feed rather than
   *  through React state — this redraws at the display's rate and a
   *  setState per frame would re-render the whole overlay with it. */
  liveRef: RefObject<HudData["map"] | null>;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    // Everything that never moves — the road, the ticks, every label,
    // the scale bar — is drawn ONCE into this offscreen canvas and
    // blitted each frame. The first version repainted it all every
    // requestAnimationFrame: thirty-odd text plates measured and filled
    // sixty times a second, for a picture identical between frames. On a
    // phone that is battery for nothing, and on a software renderer it
    // pegged the main thread so hard that Playwright's element waiter —
    // which rides the page's own rAF — resolved the map canvas and then
    // starved before it could say so. Only the dots move, so only the
    // dots redraw.
    const base = document.createElement("canvas");
    let baseKey = "";

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // The buffer follows the box at device resolution, so the road is
      // a hairline rather than a smear on a phone.
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const box = canvas.getBoundingClientRect();
      const want = [Math.round(box.width * dpr), Math.round(box.height * dpr)];
      if (canvas.width !== want[0] || canvas.height !== want[1]) {
        canvas.width = want[0];
        canvas.height = want[1];
      }
      const W = canvas.width;
      const H = canvas.height;

      // The model is square and aspect-correct — see roadmap.ts — so a
      // non-square box gets the square centred in it rather than the
      // road stretched to fill it. That is the whole point of the
      // projection and it would be undone here by one careless multiply.
      const side = Math.min(W, H);
      const ox = (W - side) / 2;
      const oy = (H - side) / 2;
      const X = (x: number) => ox + x * side;
      const Y = (y: number) => oy + y * side;
      /** One scale for text and marks, so the map reads the same at any size. */
      const u = side / 700;

      const key = `${W}x${H}`;
      if (key !== baseKey) {
        drawStatic(base, map, W, H, side, ox, oy, u);
        baseKey = key;
      }
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(base, 0, 0);

      const live = liveRef.current;

      // Labels for the moving dots — the static ones live on `base`.
      const plate = (text: string, x: number, y: number, size: number, color: string, font: string) => {
        ctx.font = `600 ${size}px ${font}`;
        const w = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(4,7,10,0.78)";
        ctx.fillRect(x - w / 2 - 5 * u, y - size * 0.86, w + 10 * u, size * 1.24);
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(text, x, y + size * 0.1);
      };

      // --- Everyone on the road.
      if (live) {
        for (const o of live.others) {
          ctx.beginPath();
          ctx.arc(X(o.x), Y(o.y), 5 * u, 0, Math.PI * 2);
          ctx.fillStyle = "#a5b4fc";
          ctx.fill();
          plate(o.name, X(o.x), Y(o.y) - 11 * u, 10 * u, "#c7d2fe", latinDisplay());
        }
        if (live.rx >= 0) {
          ctx.beginPath();
          ctx.arc(X(live.rx), Y(live.ry), 7 * u, 0, Math.PI * 2);
          ctx.fillStyle = "#ff4d4d";
          ctx.fill();
          ctx.lineWidth = 2 * u;
          ctx.strokeStyle = "rgba(4,7,10,0.9)";
          ctx.stroke();
        }

        // You: an arrow rather than a dot, because on a map of a loop
        // the direction you are facing is half the information — a dot
        // cannot tell you whether the pump 400 m away is 400 m ahead or
        // 8 km ahead.
        ctx.save();
        ctx.translate(X(live.px), Y(live.py));
        ctx.rotate(live.facing);
        ctx.beginPath();
        ctx.moveTo(13 * u, 0);
        ctx.lineTo(-8 * u, 8 * u);
        ctx.lineTo(-4 * u, 0);
        ctx.lineTo(-8 * u, -8 * u);
        ctx.closePath();
        ctx.fillStyle = "#4ade80";
        ctx.fill();
        ctx.lineWidth = 2 * u;
        ctx.strokeStyle = "rgba(4,7,10,0.95)";
        ctx.stroke();
        ctx.restore();
      }

    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [map, liveRef]);

  return (
    <div className="pointer-events-auto fixed inset-0 z-[40] flex flex-col bg-night-950/92 backdrop-blur-sm">
      <div className="safe-pad flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="grn-label text-[0.55rem] text-white/45">The lap</div>
          <div className="grn-display truncate text-lg leading-tight">
            Gulf Road Nights{" "}
            <span className="grn-ar text-white/55" lang="ar">
              ليالي شارع الخليج
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {map.legs.map((leg, i) => (
            <div key={leg.name} className="hidden items-center gap-1.5 sm:flex">
              <span
                className="inline-block h-1 w-6 rounded-full"
                style={{ backgroundColor: LEG_COLOR[i % LEG_COLOR.length] }}
              />
              <span className="grn-label text-[0.55rem] text-white/60">{leg.name}</span>
            </div>
          ))}
          <button
            onClick={onClose}
            className="grn-btn grn-btn-primary tap px-4 py-2 text-sm"
          >
            CLOSE — <span className="grn-ar" lang="ar">سكّر</span>
          </button>
        </div>
      </div>

      <canvas ref={canvasRef} data-testid="road-map" className="min-h-0 w-full flex-1" />

      <MapFooter liveRef={liveRef} lapLength={map.lapLength} />
    </div>
  );
}

/**
 * The numbers under the map.
 *
 * Its own component with its own timer because it is the only part of
 * this screen that is text rather than paint, and text does not need
 * sixty updates a second — four is past the point where anybody can read
 * a changing number anyway, and it keeps React out of the draw loop.
 */
function MapFooter({
  liveRef,
  lapLength,
}: {
  liveRef: RefObject<HudData["map"] | null>;
  lapLength: number;
}) {
  const sRef = useRef<HTMLSpanElement>(null);
  const pumpRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const tick = () => {
      const live = liveRef.current;
      if (!live) return;
      if (sRef.current) {
        sRef.current.textContent = `${(live.s / 1000).toFixed(2)} / ${(lapLength / 1000).toFixed(2)} km`;
      }
      if (pumpRef.current) {
        pumpRef.current.textContent =
          live.toPump < 1000
            ? `${Math.round(live.toPump / 10) * 10} m ahead`
            : `${(live.toPump / 1000).toFixed(1)} km ahead`;
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [liveRef, lapLength]);

  return (
    <div className="safe-pad flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-white/10 px-4 py-3">
      <div className="flex items-center gap-5">
        <Legend color="#4ade80" label="You" />
        <Legend color="#ff4d4d" label="Rival" />
        <Legend color="#4ade80" label="Petrol" />
        <Legend color="#c084fc" label="Drift circle" />
        <Legend color="#7dd3fc" label="Landmark" />
      </div>
      <div className="flex items-center gap-6">
        <div className="text-right">
          <div className="grn-label text-[0.5rem] text-white/45">Round the lap</div>
          <span ref={sRef} className="grn-display tnum text-base leading-tight">
            —
          </span>
        </div>
        <div className="text-right">
          <div className="grn-label text-[0.5rem] text-white/45">Next petrol</div>
          <span ref={pumpRef} className="grn-display tnum text-base leading-tight text-emerald-300">
            —
          </span>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="grn-label text-[0.55rem] text-white/60">{label}</span>
    </span>
  );
}
