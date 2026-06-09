"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameEngine, HudData } from "@/game/engine";
import { RIVALS, RivalDef } from "@/game/rivals";

type Phase = "menu" | "playing" | "defeated" | "champion";

export default function RaceClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const mapPathRef = useRef<Array<[number, number]>>([]);

  const speedRef = useRef<HTMLSpanElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const rivalInfoRef = useRef<HTMLDivElement>(null);
  const battleRef = useRef<HTMLDivElement>(null);
  const playerBarRef = useRef<HTMLDivElement>(null);
  const rivalBarRef = useRef<HTMLDivElement>(null);
  const battleNameRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>("menu");
  const [message, setMessage] = useState<{ title: string; sub?: string } | null>(null);
  const [beatenBy, setBeatenBy] = useState<RivalDef | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drawMap = useCallback((d: HudData) => {
    const canvas = mapRef.current;
    if (!canvas || !d.map) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    mapPathRef.current.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x * w, y * h);
      else ctx.lineTo(x * w, y * h);
    });
    ctx.closePath();
    ctx.stroke();
    if (d.map.rx >= 0) {
      ctx.fillStyle = "#ff4d4d";
      ctx.beginPath();
      ctx.arc(d.map.rx * w, d.map.ry * h, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#4ade80";
    ctx.beginPath();
    ctx.arc(d.map.px * w, d.map.py * h, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  const onHud = useCallback(
    (d: HudData) => {
      if (speedRef.current) speedRef.current.textContent = String(Math.round(d.speedKmh));
      if (areaRef.current) areaRef.current.textContent = `${d.areaName} · ${d.areaArabic}`;
      if (progressRef.current)
        progressRef.current.textContent = `Rivals beaten: ${d.defeated} / ${d.total}`;

      if (rivalInfoRef.current) {
        if (d.battle === null && d.rivalDist !== null) {
          const dist = Math.round(d.rivalDist);
          rivalInfoRef.current.textContent =
            dist >= 0 ? `Rival ${dist} m ahead` : `Rival ${-dist} m behind`;
          rivalInfoRef.current.style.opacity = "1";
        } else {
          rivalInfoRef.current.style.opacity = "0";
        }
      }
      // visibility, not opacity: animate-pulse animates opacity and would
      // override an inline opacity toggle
      if (flashRef.current) flashRef.current.style.visibility = d.canFlash ? "visible" : "hidden";

      if (battleRef.current) {
        battleRef.current.style.opacity = d.battle ? "1" : "0";
        if (d.battle) {
          if (playerBarRef.current) playerBarRef.current.style.width = `${d.battle.playerSp}%`;
          if (rivalBarRef.current) rivalBarRef.current.style.width = `${d.battle.rivalSp}%`;
          if (battleNameRef.current)
            battleNameRef.current.textContent = `${d.battle.rivalName} ${d.battle.rivalArabic} · ${d.battle.rivalCrew}`;
        }
      }
      drawMap(d);
    },
    [drawMap]
  );

  const showMessage = useCallback((title: string, sub?: string) => {
    setMessage({ title, sub });
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMessage(null), 3500);
  }, []);

  const startGame = useCallback(async () => {
    if (engineRef.current || !canvasRef.current) return;
    const { GameEngine } = await import("@/game/engine");
    const engine = new GameEngine(canvasRef.current, {
      onHud,
      onMessage: showMessage,
      onBump: () => {
        const el = canvasRef.current;
        if (!el) return;
        el.classList.remove("race-bump");
        void el.offsetWidth;
        el.classList.add("race-bump");
      },
      onDefeat: (rival) => {
        setBeatenBy(rival);
        setPhase("defeated");
      },
      onChampion: () => setPhase("champion"),
    });
    engineRef.current = engine;
    mapPathRef.current = engine.getMapPath();
    engine.resize();
    engine.start();
    setPhase("playing");
  }, [onHud, showMessage]);

  useEffect(() => {
    const onResize = () => engineRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      engineRef.current?.dispose();
      engineRef.current = null;
      if (msgTimer.current) clearTimeout(msgTimer.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === "menu" && e.key === "Enter") startGame();
      if (phase === "defeated" && e.key.toLowerCase() === "r") {
        engineRef.current?.retryBattle();
        setPhase("playing");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, startGame]);

  return (
    <div className="fixed inset-0 z-[60] bg-black text-white">
      <canvas ref={canvasRef} className="h-full w-full" />

      {/* HUD */}
      <div
        className={`pointer-events-none absolute inset-0 transition-opacity ${
          phase === "playing" ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Area + progress */}
        <div className="absolute left-4 top-4">
          <div ref={areaRef} className="text-lg font-bold drop-shadow" />
          <div ref={progressRef} className="text-xs text-white/70" />
        </div>

        {/* Minimap */}
        <canvas
          ref={mapRef}
          width={150}
          height={150}
          className="absolute right-4 top-4 rounded-xl bg-black/40 backdrop-blur-sm"
        />

        {/* Battle SP bars */}
        <div
          ref={battleRef}
          className="absolute left-1/2 top-4 w-[min(560px,90vw)] -translate-x-1/2 opacity-0 transition-opacity"
        >
          <div className="mb-1 flex justify-between text-[11px] font-bold tracking-widest">
            <span className="text-emerald-300">YOU — أنت</span>
            <span className="text-red-300">RIVAL</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-white/15">
            <div ref={playerBarRef} className="h-full rounded-full bg-emerald-400 transition-[width]" />
          </div>
          <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-white/15">
            <div ref={rivalBarRef} className="h-full rounded-full bg-red-500 transition-[width]" />
          </div>
          <div ref={battleNameRef} className="mt-1 text-center text-xs font-semibold text-white/85" />
        </div>

        {/* Rival distance + flash prompt */}
        <div className="absolute left-1/2 top-24 -translate-x-1/2 text-center">
          <div ref={rivalInfoRef} className="text-sm font-semibold text-amber-300 drop-shadow" />
          <div
            ref={flashRef}
            className="invisible mt-1 animate-pulse text-base font-extrabold text-cyan-300 drop-shadow"
          >
            PRESS F TO FLASH ⚡ اضغط F
          </div>
        </div>

        {/* Speedometer */}
        <div className="absolute bottom-5 left-5 select-none">
          <span ref={speedRef} className="text-6xl font-black italic tabular-nums drop-shadow-lg">
            0
          </span>
          <span className="ml-2 text-lg font-bold text-white/70">km/h</span>
        </div>

        {/* Controls hint */}
        <div className="absolute bottom-5 right-5 text-right text-[11px] leading-5 text-white/50">
          W/↑ accelerate · S/↓ brake · A D steer
          <br />F flash headlights · M mute
        </div>
      </div>

      {/* Center message toast */}
      {message && phase === "playing" && (
        <div className="pointer-events-none absolute left-1/2 top-1/3 w-[min(640px,92vw)] -translate-x-1/2 text-center">
          <div className="text-2xl font-black drop-shadow-lg sm:text-3xl">{message.title}</div>
          {message.sub && (
            <div className="mt-1 text-sm font-medium text-white/80">{message.sub}</div>
          )}
        </div>
      )}

      {/* Menu */}
      {phase === "menu" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-[#05070f] via-[#0a1226] to-[#05070f] px-6 text-center">
          <div className="text-sm font-bold tracking-[0.4em] text-cyan-400">KUWAIT XTREME RACER</div>
          <h1 className="mt-3 text-5xl font-black italic sm:text-7xl">
            GULF ROAD <span className="text-amber-400">NIGHTS</span>
          </h1>
          <div className="mt-2 text-2xl font-bold text-white/80" dir="rtl">
            ليالي شارع الخليج
          </div>
          <p className="mt-6 max-w-xl text-sm leading-6 text-white/60">
            Midnight on the corniche. Six street legends rule the loop from Kuwait City to Jahra.
            Hunt them down, flash your headlights, and drain their spirit — TXR style. وين الحدود؟
          </p>
          <div className="mt-8 grid grid-cols-2 gap-x-10 gap-y-1 text-left text-xs text-white/55 sm:grid-cols-3">
            {RIVALS.map((r, i) => (
              <div key={r.id}>
                {i + 1}. {r.name} <span className="text-white/35">· {r.area}</span>
              </div>
            ))}
          </div>
          <button
            onClick={startGame}
            className="mt-10 rounded-xl bg-amber-400 px-10 py-4 text-lg font-black text-black shadow-lg shadow-amber-400/30 transition hover:bg-amber-300"
          >
            START ENGINE — يلا 🏁
          </button>
          <div className="mt-3 text-xs text-white/40">or press Enter</div>
        </div>
      )}

      {/* Defeat */}
      {phase === "defeated" && beatenBy && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 px-6 text-center backdrop-blur-sm">
          <div className="text-5xl font-black text-red-500">DEFEATED</div>
          <div className="mt-2 text-xl font-bold text-white/85">
            {beatenBy.name} {beatenBy.arabicName} takes the night
          </div>
          <div className="mt-1 text-sm text-white/55">&quot;{beatenBy.taunt}&quot;</div>
          <button
            onClick={() => {
              engineRef.current?.retryBattle();
              setPhase("playing");
            }}
            className="mt-8 rounded-xl bg-white px-8 py-3 text-base font-black text-black transition hover:bg-white/85"
          >
            REMATCH (R)
          </button>
        </div>
      )}

      {/* Champion */}
      {phase === "champion" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 px-6 text-center backdrop-blur-sm">
          <div className="text-6xl">👑</div>
          <div className="mt-3 text-5xl font-black text-amber-400">KING OF GULF ROAD</div>
          <div className="mt-2 text-2xl font-bold" dir="rtl">
            ملك شارع الخليج
          </div>
          <div className="mt-3 max-w-md text-sm text-white/65">
            All six legends defeated — from Salmiya to Jahra, every street is yours. Mabrook! 🇰🇼
          </div>
          <button
            onClick={() => {
              engineRef.current?.resetProgress();
              setPhase("playing");
            }}
            className="mt-8 rounded-xl bg-amber-400 px-8 py-3 text-base font-black text-black transition hover:bg-amber-300"
          >
            RUN IT BACK — من جديد
          </button>
        </div>
      )}
    </div>
  );
}
