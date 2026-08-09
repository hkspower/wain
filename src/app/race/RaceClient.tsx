"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameEngine, HudData } from "@/game/engine";
import { GEARS } from "@/game/gears";
import { RIVALS, RivalDef } from "@/game/rivals";
import { HubClient, loadProfile, formatLap } from "@/game/net";
import { PARTS, Part, GarageState, loadGarage, saveGarage } from "@/game/mods";

const EXCLUSIVE_CATS = new Set(["aspiration", "brakes", "tires", "paint", "glow"]);
const CAT_LABELS: Record<string, string> = {
  aspiration: "ENGINE — TURBO & SUPERCHARGER · المكينة",
  internals: "INTERNALS · القطع الداخلية",
  brakes: "BRAKES · البريكات",
  tires: "TIRES · التواير",
  extras: "EXTRAS & NOS · الإضافات",
  paint: "PAINT · الصبغ",
  glow: "UNDERGLOW · الليتات",
};

type Phase = "menu" | "playing" | "defeated" | "champion";

interface FeedMsg {
  name: string;
  text: string;
  key: number;
}

export default function RaceClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const mapPathRef = useRef<Array<[number, number]>>([]);

  const speedRef = useRef<HTMLSpanElement>(null);
  const gearRef = useRef<HTMLDivElement>(null);
  const rpmRef = useRef<HTMLDivElement>(null);
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
  const [vsRival, setVsRival] = useState<RivalDef | null>(null);
  const [garageOpen, setGarageOpen] = useState(false);
  const [garage, setGarage] = useState<GarageState | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boostWrapRef = useRef<HTMLDivElement>(null);
  const boostRef = useRef<HTMLDivElement>(null);
  const nosWrapRef = useRef<HTMLDivElement>(null);
  const nosRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGarage(loadGarage()); // client-only: reads localStorage
  }, []);

  const buyOrEquip = useCallback((p: Part) => {
    const g = loadGarage();
    const owned = g.owned.includes(p.id);
    const exclusive = EXCLUSIVE_CATS.has(p.cat);
    if (!owned) {
      if (g.kd < p.price) return;
      g.kd -= p.price;
      g.owned.push(p.id);
      if (exclusive) g.equipped[p.cat as keyof GarageState["equipped"]] = p.id;
    } else if (exclusive) {
      const key = p.cat as keyof GarageState["equipped"];
      // Tap the equipped part again to run stock in that slot
      if (g.equipped[key] === p.id) delete g.equipped[key];
      else g.equipped[key] = p.id;
    }
    saveGarage(g);
    setGarage(g);
  }, []);

  // Online cruise
  const hubRef = useRef<HubClient | null>(null);
  const sendTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedKey = useRef(0);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [feed, setFeed] = useState<FeedMsg[]>([]);

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
      // Gear + in-gear RPM fraction
      let g = 0;
      while (g < GEARS.length - 2 && d.speedKmh >= GEARS[g + 1]) g++;
      const rpm = Math.min(1, Math.max(0.12, (d.speedKmh - GEARS[g]) / (GEARS[g + 1] - GEARS[g])));
      if (gearRef.current) gearRef.current.textContent = d.speedKmh < 2 ? "N" : String(g + 1);
      if (rpmRef.current) rpmRef.current.style.width = `${Math.round(rpm * 100)}%`;
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

      // Garage gauges: turbo boost + NOS charge (hidden without the mods)
      if (boostWrapRef.current)
        boostWrapRef.current.style.display = d.boost === null ? "none" : "flex";
      if (boostRef.current && d.boost !== null)
        boostRef.current.style.width = `${Math.round(d.boost * 100)}%`;
      if (nosWrapRef.current) nosWrapRef.current.style.display = d.nos === null ? "none" : "flex";
      if (nosRef.current && d.nos !== null)
        nosRef.current.style.width = `${Math.round(d.nos * 100)}%`;

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

  const startingRef = useRef(false);

  const startGame = useCallback(async () => {
    // startingRef guards the async import window — without it a double
    // Enter/click builds two engines on the same canvas
    if (engineRef.current || startingRef.current || !canvasRef.current) return;
    startingRef.current = true;
    const { GameEngine } = await import("@/game/engine");
    // Dev helper: ?start=<metres> spawns further along the lap
    const startS = parseFloat(new URLSearchParams(window.location.search).get("start") ?? "");
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
      onLap: (ms) => {
        showMessage(`LAP — ${formatLap(ms)}`);
        hubRef.current?.sendLap(ms);
      },
      onBattleStart: (rival) => {
        setVsRival(rival);
        if (vsTimer.current) clearTimeout(vsTimer.current);
        vsTimer.current = setTimeout(() => setVsRival(null), 2400);
      },
    }, Number.isFinite(startS) ? { startS } : undefined);
    engineRef.current = engine;
    mapPathRef.current = engine.getMapPath();
    engine.resize();
    engine.start();
    setPhase("playing");

    // Online cruise: connect to the hub and mirror the other drivers.
    if (new URLSearchParams(window.location.search).has("online")) {
      const profile = loadProfile();
      const hub = new HubClient(
        {
          onWelcome: (selfId, roster) => {
            setOnlineCount(roster.length);
            for (const p of roster) {
              if (p.id !== selfId) engine.upsertRemote(p.id, p.name, p.color);
            }
          },
          onJoined: (p) => {
            engine.upsertRemote(p.id, p.name, p.color);
            setOnlineCount((n) => (n === null ? n : n + 1));
            showMessage(`${p.name} joined the cruise`);
          },
          onLeft: (id) => {
            engine.removeRemote(id);
            setOnlineCount((n) => (n === null ? n : Math.max(1, n - 1)));
          },
          onStates: (states) => {
            for (const [id, s, lat, speed] of states) {
              if (id !== hub.selfId) engine.updateRemoteState(id, s, lat, speed);
            }
          },
          onChat: (name, text) =>
            setFeed((prev) => [...prev.slice(-3), { name, text, key: feedKey.current++ }]),
          onClose: () => {
            setOnlineCount(null);
            showMessage("Hub disconnected", "Cruising solo — the road is still yours");
          },
        },
        profile.name || "racer",
        profile.color
      );
      hubRef.current = hub;
      sendTimer.current = setInterval(() => {
        if (hub.connected) {
          const st = engine.getLocalState();
          hub.sendState(st.s, st.lat, st.speed);
        }
      }, 100);
    }
  }, [onHud, showMessage]);

  useEffect(() => {
    const onResize = () => engineRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      engineRef.current?.dispose();
      engineRef.current = null;
      startingRef.current = false;
      if (msgTimer.current) clearTimeout(msgTimer.current);
      if (vsTimer.current) clearTimeout(vsTimer.current);
      if (sendTimer.current) clearInterval(sendTimer.current);
      hubRef.current?.close();
      hubRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === "menu" && e.key === "Enter" && !e.repeat) startGame();
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
          <div className="-skew-x-6 border-l-4 border-amber-400 bg-black/45 px-3 py-1.5 backdrop-blur-sm">
            <div ref={areaRef} className="text-lg font-bold tracking-wide drop-shadow" />
            <div ref={progressRef} className="text-[11px] tracking-widest text-white/70" />
          </div>
          {onlineCount !== null && (
            <div className="mt-1.5 -skew-x-6 bg-black/40 px-3 py-0.5 text-xs font-bold text-cyan-300">
              ● {onlineCount} cruising online
            </div>
          )}
        </div>

        {/* Hub chat feed */}
        {feed.length > 0 && (
          <div className="absolute bottom-16 right-5 max-w-xs space-y-0.5 text-right text-xs">
            {feed.map((m) => (
              <p key={m.key} className="leading-4 drop-shadow">
                <span className="font-bold text-cyan-300">{m.name}:</span>{" "}
                <span className="text-white/85">{m.text}</span>
              </p>
            ))}
          </div>
        )}

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
          <div className="mb-1 flex justify-between text-[11px] font-black tracking-[0.25em]">
            <span className="text-emerald-300 drop-shadow-[0_0_6px_rgba(52,211,153,0.9)]">SP — أنت</span>
            <span className="text-red-300 drop-shadow-[0_0_6px_rgba(248,113,113,0.9)]">RIVAL SP</span>
          </div>
          <div className="relative h-4 -skew-x-12 overflow-hidden rounded-sm bg-black/50 ring-1 ring-white/25">
            <div
              ref={playerBarRef}
              className="h-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-emerald-200 shadow-[0_0_16px_rgba(52,211,153,0.9)] transition-[width]"
            />
            <div className="absolute inset-0 [background:repeating-linear-gradient(90deg,transparent_0,transparent_14px,rgba(0,0,0,0.55)_14px,rgba(0,0,0,0.55)_16px)]" />
          </div>
          <div className="relative mt-1.5 h-4 -skew-x-12 overflow-hidden rounded-sm bg-black/50 ring-1 ring-white/25">
            <div
              ref={rivalBarRef}
              className="h-full bg-gradient-to-r from-red-700 via-red-500 to-orange-300 shadow-[0_0_16px_rgba(239,68,68,0.9)] transition-[width]"
            />
            <div className="absolute inset-0 [background:repeating-linear-gradient(90deg,transparent_0,transparent_14px,rgba(0,0,0,0.55)_14px,rgba(0,0,0,0.55)_16px)]" />
          </div>
          <div ref={battleNameRef} className="mt-1 text-center text-xs font-bold tracking-wider text-white/90 drop-shadow" />
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

        {/* Speed cluster: digital speed, gear, tach bar */}
        <div className="absolute bottom-5 left-16 select-none">
          <div className="flex items-end gap-3">
            <span
              ref={speedRef}
              className="text-7xl font-black italic leading-none tabular-nums drop-shadow-[0_0_14px_rgba(56,232,255,0.45)]"
            >
              0
            </span>
            <div className="pb-0.5">
              <div className="text-[10px] font-bold tracking-widest text-white/60">km/h</div>
              <div className="flex items-baseline gap-1">
                <span className="text-[10px] font-bold tracking-widest text-white/60">GEAR</span>
                <span ref={gearRef} className="text-2xl font-black italic text-amber-400">
                  N
                </span>
              </div>
            </div>
          </div>
          <div className="mt-1.5 h-2 w-64 -skew-x-12 overflow-hidden rounded-sm bg-black/50 ring-1 ring-white/20">
            <div
              ref={rpmRef}
              className="h-full bg-gradient-to-r from-cyan-400 via-amber-400 to-red-500"
              style={{ width: "0%" }}
            />
          </div>
          <div ref={boostWrapRef} className="mt-1 items-center gap-2" style={{ display: "none" }}>
            <span className="w-10 text-[9px] font-black tracking-widest text-cyan-300">BOOST</span>
            <div className="h-1.5 w-52 -skew-x-12 overflow-hidden rounded-sm bg-black/50 ring-1 ring-white/15">
              <div ref={boostRef} className="h-full bg-cyan-400" style={{ width: "0%" }} />
            </div>
          </div>
          <div ref={nosWrapRef} className="mt-1 items-center gap-2" style={{ display: "none" }}>
            <span className="w-10 text-[9px] font-black tracking-widest text-blue-300">NOS</span>
            <div className="h-1.5 w-52 -skew-x-12 overflow-hidden rounded-sm bg-black/50 ring-1 ring-white/15">
              <div ref={nosRef} className="h-full bg-blue-400" style={{ width: "0%" }} />
            </div>
          </div>
        </div>

        {/* Controls hint */}
        <div className="absolute bottom-5 right-5 text-right text-[11px] leading-5 text-white/50">
          W/↑ accelerate · S/↓ brake · A D steer · N nitro · H horn
          <br />F flash headlights · M mute · V voices · G glow fx
        </div>
      </div>

      {/* TXR-style VS splash on battle start */}
      {vsRival && phase === "playing" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden bg-black/55">
          <div className="vs-slide-left w-[38%] text-right">
            <div className="text-5xl font-black italic text-emerald-300 drop-shadow-[0_0_18px_rgba(52,211,153,0.8)] sm:text-6xl">
              YOU
            </div>
            <div className="mt-1 text-xl font-bold text-white/80" dir="rtl">
              أنت
            </div>
          </div>
          <div className="vs-pop mx-8 text-7xl font-black italic text-amber-400 drop-shadow-[0_0_24px_rgba(251,191,36,0.9)] sm:text-8xl">
            VS
          </div>
          <div className="vs-slide-right w-[38%]">
            <div className="text-4xl font-black italic text-red-400 drop-shadow-[0_0_18px_rgba(248,113,113,0.8)] sm:text-5xl">
              {vsRival.name}
            </div>
            <div className="mt-1 text-xl font-bold text-white/85">{vsRival.arabicName}</div>
            <div className="mt-1 text-sm font-bold tracking-widest text-white/60">
              {vsRival.crew.toUpperCase()}
            </div>
            <div className="mt-2 text-sm italic text-white/70">&quot;{vsRival.taunt}&quot;</div>
          </div>
        </div>
      )}

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
            Midnight on the real Gulf Road — 7 km from the Kuwait Towers down the corniche to Ras
            Al-Ard and back through the city. Six street legends rule it. Hunt them down, flash
            your headlights, and drain their spirit — TXR style. وين الحدود؟
          </p>
          <div className="mt-8 grid grid-cols-2 gap-x-10 gap-y-1 text-left text-xs text-white/55 sm:grid-cols-3">
            {RIVALS.map((r, i) => (
              <div key={r.id}>
                {i + 1}. {r.name} <span className="text-white/35">· {r.area}</span>
              </div>
            ))}
          </div>
          <div className="mt-10 flex items-center gap-4">
            <button
              onClick={startGame}
              className="rounded-xl bg-amber-400 px-10 py-4 text-lg font-black text-black shadow-lg shadow-amber-400/30 transition hover:bg-amber-300"
            >
              START ENGINE — يلا 🏁
            </button>
            <button
              onClick={() => {
                setGarage(loadGarage());
                setGarageOpen(true);
              }}
              className="rounded-xl border-2 border-cyan-400/60 px-8 py-4 text-lg font-black text-cyan-300 transition hover:bg-cyan-400/10"
            >
              GARAGE 🔧 الكراج
            </button>
          </div>
          <div className="mt-3 text-xs text-white/40">
            or press Enter{garage ? ` · balance: ${garage.kd} KD` : ""}
          </div>
          <a
            href="/hub"
            className="mt-5 text-sm font-semibold text-cyan-300 underline-offset-4 transition hover:underline"
          >
            Cruise with friends in the Online Hub →
          </a>
        </div>
      )}

      {/* Garage */}
      {garageOpen && garage && (
        <div className="absolute inset-0 z-20 overflow-y-auto bg-gradient-to-b from-[#05070f] via-[#0a1226] to-[#05070f] px-6 py-8">
          <div className="mx-auto max-w-4xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold tracking-[0.4em] text-cyan-400">THE GARAGE</div>
                <h2 className="text-3xl font-black italic">
                  الكراج <span className="text-amber-400">TUNING</span>
                </h2>
              </div>
              <div className="text-right">
                <div className="text-2xl font-black text-amber-400">{garage.kd} KD</div>
                <button
                  onClick={() => setGarageOpen(false)}
                  className="mt-1 rounded-lg bg-white px-5 py-2 text-sm font-black text-black transition hover:bg-white/85"
                >
                  DONE — يلا نطلع
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-white/50">
              Parts apply when you start the engine. Win battles to earn KD — deeper rivals pay
              more. Tap an equipped part to run stock in that slot.
            </p>
            {Object.entries(CAT_LABELS).map(([cat, label]) => (
              <div key={cat} className="mt-6">
                <h3 className="text-sm font-black tracking-widest text-white/60">{label}</h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {PARTS.filter((p) => p.cat === cat).map((p) => {
                    const owned = garage.owned.includes(p.id);
                    const equipped =
                      EXCLUSIVE_CATS.has(p.cat) &&
                      garage.equipped[p.cat as keyof GarageState["equipped"]] === p.id;
                    const affordable = garage.kd >= p.price;
                    return (
                      <button
                        key={p.id}
                        onClick={() => buyOrEquip(p)}
                        disabled={!owned && !affordable}
                        className={`rounded-xl border p-3 text-left transition ${
                          equipped
                            ? "border-amber-400 bg-amber-400/10"
                            : owned
                              ? "border-emerald-400/50 bg-emerald-400/5 hover:bg-emerald-400/10"
                              : affordable
                                ? "border-white/15 bg-white/5 hover:bg-white/10"
                                : "cursor-not-allowed border-white/10 bg-white/5 opacity-40"
                        }`}
                      >
                        <div className="flex items-baseline justify-between">
                          <span className="text-sm font-black">{p.name}</span>
                          <span className="text-xs font-bold text-white/60">{p.ar}</span>
                        </div>
                        {p.desc && <div className="mt-1 text-[11px] text-white/55">{p.desc}</div>}
                        <div className="mt-1.5 text-xs font-black">
                          {equipped ? (
                            <span className="text-amber-400">EQUIPPED ✓</span>
                          ) : owned ? (
                            <span className="text-emerald-300">
                              {EXCLUSIVE_CATS.has(p.cat) ? "OWNED — tap to equip" : "INSTALLED ✓"}
                            </span>
                          ) : (
                            <span className={affordable ? "text-cyan-300" : "text-white/40"}>
                              {p.price} KD
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
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
