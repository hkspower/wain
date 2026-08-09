"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DriverCard, GameEngine, HudData } from "@/game/engine";
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
  const [challenge, setChallenge] = useState<{
    player: DriverCard;
    rival: DriverCard;
    answer: { accepted: boolean; reason: string } | null;
  } | null>(null);
  const challengeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      if (flashRef.current) {
        flashRef.current.style.visibility = d.canFlash ? "visible" : "hidden";
        // "○○○" filling to "●●○" as the three challenge flashes land
        const dots = "●".repeat(d.flashCount) + "○".repeat(Math.max(0, 3 - d.flashCount));
        flashRef.current.textContent = `FLASH 3× TO CHALLENGE ⚡ ${dots}`;
      }

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
      onChallenge: (player, rival) => {
        if (challengeTimer.current) clearTimeout(challengeTimer.current);
        setChallenge({ player, rival, answer: null });
      },
      onChallengeResult: (accepted, reason) => {
        setChallenge((c) => (c ? { ...c, answer: { accepted, reason } } : c));
        if (challengeTimer.current) clearTimeout(challengeTimer.current);
        challengeTimer.current = setTimeout(() => setChallenge(null), accepted ? 1200 : 2600);
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
      if (challengeTimer.current) clearTimeout(challengeTimer.current);
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
          <div className="grn-plate px-4 py-2">
            <div ref={areaRef} className="grn-display text-xl leading-tight tracking-wide" />
            <div ref={progressRef} className="grn-label mt-0.5 text-[0.62rem]" />
          </div>
          {onlineCount !== null && (
            <div className="grn-panel mt-2 inline-flex items-center gap-1.5 px-3 py-1">
              <span className="size-1.5 rounded-full bg-gulf-400 shadow-[0_0_8px_var(--color-gulf-400)]" />
              <span className="grn-label text-[0.62rem] text-gulf-300">
                {onlineCount} cruising online
              </span>
            </div>
          )}
        </div>

        {/* Hub chat feed */}
        {feed.length > 0 && (
          <div className="grn-panel absolute bottom-24 right-5 max-w-xs space-y-1 px-3 py-2 text-right text-xs">
            {feed.map((m) => (
              <p key={m.key} className="leading-4">
                <span className="font-bold text-gulf-300">{m.name}:</span>{" "}
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
          className="grn-panel absolute right-4 top-4 p-1"
        />

        {/* Battle SP bars */}
        <div
          ref={battleRef}
          className="absolute left-1/2 top-4 w-[min(560px,90vw)] -translate-x-1/2 opacity-0 transition-opacity"
        >
          <div className="mb-1.5 flex items-end justify-between">
            <span className="grn-label text-[0.66rem] text-emerald-300 [text-shadow:0_0_10px_rgba(52,211,153,0.8)]">
              SP <span className="grn-ar">أنت</span>
            </span>
            <span className="grn-label text-[0.66rem] text-rose-300 [text-shadow:0_0_10px_rgba(251,113,133,0.8)]">
              Rival SP
            </span>
          </div>
          <div className="grn-meter h-[18px] -skew-x-12">
            <div
              ref={playerBarRef}
              className="h-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-emerald-200 shadow-[0_0_18px_rgba(52,211,153,0.85)] transition-[width] duration-150"
            />
          </div>
          <div className="grn-meter mt-2 h-[18px] -skew-x-12">
            <div
              ref={rivalBarRef}
              className="h-full bg-gradient-to-r from-rose-700 via-rose-500 to-amber-300 shadow-[0_0_18px_rgba(244,63,94,0.85)] transition-[width] duration-150"
            />
          </div>
          <div
            ref={battleNameRef}
            className="grn-display mt-1.5 text-center text-sm tracking-[0.14em] text-white/90 [text-shadow:0_2px_10px_rgba(0,0,0,0.9)]"
          />
        </div>

        {/* Rival distance + flash prompt */}
        <div className="absolute left-1/2 top-24 -translate-x-1/2 text-center">
          <div
            ref={rivalInfoRef}
            className="grn-display text-base tracking-[0.16em] text-sodium-400 transition-opacity [text-shadow:0_2px_12px_rgba(0,0,0,0.95)]"
          />
          <div
            ref={flashRef}
            className="grn-display invisible mt-1.5 animate-pulse text-lg tracking-[0.14em] text-gulf-300 [text-shadow:0_0_16px_rgba(56,201,238,0.7),0_2px_10px_rgba(0,0,0,0.9)]"
          >
            FLASH 3× TO CHALLENGE ⚡ ○○○
          </div>
        </div>

        {/* Speed cluster: digital speed, gear, tach bar */}
        <div className="absolute bottom-7 left-16 select-none">
          <div className="flex items-end gap-3.5">
            <span
              ref={speedRef}
              className="grn-display block text-[5.5rem] italic leading-[0.78] tabular-nums text-white [text-shadow:0_0_28px_rgba(56,201,238,0.35),0_4px_18px_rgba(0,0,0,0.95)]"
            >
              0
            </span>
            <div className="pb-1">
              <div className="grn-label text-[0.62rem]">km/h</div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="grn-label text-[0.6rem]">Gear</span>
                <span
                  ref={gearRef}
                  className="grn-display text-3xl italic leading-none text-sodium-400 [text-shadow:0_0_16px_rgba(245,165,36,0.6)]"
                >
                  N
                </span>
              </div>
            </div>
          </div>
          <div className="grn-meter mt-2 h-2.5 w-64 -skew-x-12">
            <div
              ref={rpmRef}
              className="h-full bg-gradient-to-r from-cyan-400 via-amber-400 to-red-500"
              style={{ width: "0%" }}
            />
          </div>
          <div ref={boostWrapRef} className="mt-1 items-center gap-2" style={{ display: "none" }}>
            <span className="grn-label w-11 text-[0.58rem] text-gulf-300">Boost</span>
            <div className="grn-meter h-2 w-52 -skew-x-12">
              <div
                ref={boostRef}
                className="h-full bg-gradient-to-r from-gulf-500 to-gulf-300 shadow-[0_0_12px_rgba(56,201,238,0.8)]"
                style={{ width: "0%" }}
              />
            </div>
          </div>
          <div ref={nosWrapRef} className="mt-1 items-center gap-2" style={{ display: "none" }}>
            <span className="grn-label w-11 text-[0.58rem] text-indigo-300">NOS</span>
            <div className="grn-meter h-2 w-52 -skew-x-12">
              <div
                ref={nosRef}
                className="h-full bg-gradient-to-r from-indigo-500 to-sky-300 shadow-[0_0_12px_rgba(129,140,248,0.8)]"
                style={{ width: "0%" }}
              />
            </div>
          </div>
        </div>

        {/* Controls hint */}
        <div className="grn-panel absolute bottom-5 right-5 px-3 py-2 text-right font-display text-[0.78rem] leading-5 tracking-wide text-white/60">
          W/↑ accelerate · S/↓ brake · A D steer · N nitro · H horn
          <br />F flash headlights · M mute · V voices · G glow fx
        </div>
      </div>

      {/* Challenge cards — both drivers revealed, rival answers */}
      {challenge && phase === "playing" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 px-4">
          <div className="grn-label text-[0.7rem] tracking-[0.42em] text-gulf-300 [text-shadow:0_0_18px_rgba(56,201,238,0.6)]">
            Headlights flashed ×3 — <span className="grn-ar">التحدي</span>
          </div>
          <div className="mt-4 flex w-full max-w-3xl items-stretch justify-center gap-4">
            {[challenge.player, challenge.rival].map((d, i) => (
              <div
                key={i}
                className={`${i === 0 ? "card-in-left" : "card-in-right"} grn-panel flex-1 p-5 ${
                  i === 0
                    ? "border-emerald-400/60 shadow-[0_0_40px_-12px_rgba(52,211,153,0.6)]"
                    : "border-rose-400/60 shadow-[0_0_40px_-12px_rgba(244,63,94,0.6)]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`grn-label text-[0.62rem] ${
                      i === 0 ? "text-emerald-300" : "text-rose-300"
                    }`}
                  >
                    {i === 0 ? "Challenger" : "Defender"}
                  </span>
                  <span
                    className="size-5 rounded-full border border-white/50 shadow-[0_0_12px_rgba(255,255,255,0.25)]"
                    style={{ backgroundColor: `#${d.color.toString(16).padStart(6, "0")}` }}
                  />
                </div>
                <div className="grn-display mt-2 text-3xl italic leading-none">{d.name}</div>
                {d.arabicName && (
                  <div className="grn-ar mt-1 text-lg text-white/75">{d.arabicName}</div>
                )}
                <div className="mt-4 space-y-1.5 border-t border-white/10 pt-3 text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="grn-label text-[0.58rem]">Level</span>
                    <span className="grn-display text-lg text-sodium-400">LV. {d.level}</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="grn-label text-[0.58rem]">Country</span>
                    <span className="font-semibold">
                      {d.flag} {d.country}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="grn-label text-[0.58rem]">Crew</span>
                    <span className="text-right text-[0.8rem] font-semibold text-white/85">
                      {d.crew}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 h-10 text-center">
            {challenge.answer === null ? (
              <div className="grn-label animate-pulse text-base text-white/80">
                Awaiting response… <span className="grn-ar">ينتظر الرد</span>
              </div>
            ) : challenge.answer.accepted ? (
              <div>
                <div className="grn-display text-4xl italic text-emerald-400 [text-shadow:0_0_26px_rgba(52,211,153,0.85)]">
                  ACCEPTED — <span className="grn-ar">قبل التحدي</span> ✓
                </div>
              </div>
            ) : (
              <div>
                <div className="grn-display text-4xl italic text-rose-500 [text-shadow:0_0_26px_rgba(244,63,94,0.85)]">
                  REJECTED — <span className="grn-ar">رفض</span> ✕
                </div>
                <div className="mt-1.5 text-sm font-semibold text-white/70">
                  {challenge.answer.reason}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TXR-style VS splash on battle start */}
      {vsRival && phase === "playing" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden bg-black/55">
          <div className="vs-slide-left w-[38%] text-right">
            <div className="grn-display text-6xl italic text-emerald-300 [text-shadow:0_0_28px_rgba(52,211,153,0.85)] sm:text-7xl">
              YOU
            </div>
            <div className="grn-ar mt-1 text-xl text-white/75" dir="rtl">
              أنت
            </div>
          </div>
          <div className="vs-pop grn-display mx-8 text-8xl italic text-sodium-400 [text-shadow:0_0_34px_rgba(245,165,36,0.9)] sm:text-9xl">
            VS
          </div>
          <div className="vs-slide-right w-[38%]">
            <div className="grn-display text-5xl italic text-rose-400 [text-shadow:0_0_28px_rgba(244,63,94,0.85)] sm:text-6xl">
              {vsRival.name}
            </div>
            <div className="grn-ar mt-1 text-xl text-white/80">{vsRival.arabicName}</div>
            <div className="grn-label mt-2 text-[0.66rem]">{vsRival.crew}</div>
            <div className="mt-2.5 text-sm italic text-white/70">&quot;{vsRival.taunt}&quot;</div>
          </div>
        </div>
      )}

      {/* Center message toast */}
      {message && phase === "playing" && (
        <div className="pointer-events-none absolute left-1/2 top-1/3 w-[min(640px,92vw)] -translate-x-1/2 text-center">
          <div className="grn-display text-3xl leading-tight [text-shadow:0_4px_20px_rgba(0,0,0,0.95)] sm:text-4xl">
            {message.title}
          </div>
          {message.sub && (
            <div className="mt-1.5 text-sm font-medium text-white/75 [text-shadow:0_2px_10px_rgba(0,0,0,0.9)]">
              {message.sub}
            </div>
          )}
        </div>
      )}

      {/* Menu */}
      {phase === "menu" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-[#05070f] via-[#0a1226] to-[#05070f] px-6 text-center">
          <div className="grn-label text-[0.8rem] tracking-[0.45em] text-gulf-400 [text-shadow:0_0_20px_rgba(56,201,238,0.5)]">
            Kuwait Xtreme Racer
          </div>
          <h1 className="grn-display mt-3 text-6xl italic leading-[0.9] sm:text-8xl">
            GULF ROAD <span className="text-sodium-400">NIGHTS</span>
          </h1>
          <div className="grn-ar mt-3 text-2xl text-white/75" dir="rtl">
            ليالي شارع الخليج
          </div>
          <p className="mt-7 max-w-xl text-[0.95rem] leading-7 text-white/60">
            Midnight on the real Gulf Road — 7 km from the Kuwait Towers down the corniche to Ras
            Al-Ard and back through the city. Six street legends rule it. Hunt them down, flash
            your headlights, and drain their spirit — TXR style. وين الحدود؟
          </p>
          <div className="grn-panel mt-8 grid grid-cols-2 gap-x-8 gap-y-1.5 px-6 py-4 text-left sm:grid-cols-3">
            {RIVALS.map((r, i) => (
              <div key={r.id} className="text-sm">
                <span className="grn-display mr-1.5 text-sodium-400">{i + 1}.</span>
                <span className="font-semibold text-white/85">{r.name}</span>
                <span className="text-white/35"> · {r.area}</span>
              </div>
            ))}
          </div>
          <div className="mt-10 flex items-center gap-4">
            <button
              onClick={startGame}
              className="grn-btn grn-btn-primary px-12 py-4 text-xl"
            >
              START ENGINE — <span className="grn-ar">يلا</span> 🏁
            </button>
            <button
              onClick={() => {
                setGarage(loadGarage());
                setGarageOpen(true);
              }}
              className="grn-btn grn-btn-ghost px-9 py-4 text-xl"
            >
              GARAGE 🔧 <span className="grn-ar">الكراج</span>
            </button>
          </div>
          <div className="grn-label mt-4 text-[0.62rem] text-white/40">
            press Enter to start
            {garage ? (
              <span className="text-sodium-400"> · balance {garage.kd} KD</span>
            ) : null}
          </div>
          <a
            href="/hub"
            className="mt-6 text-sm font-semibold text-gulf-300 underline-offset-4 transition hover:underline"
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
                <div className="grn-label text-[0.72rem] tracking-[0.42em] text-gulf-400">
                  The Garage
                </div>
                <h2 className="grn-display mt-1 text-4xl italic">
                  <span className="grn-ar">الكراج</span>{" "}
                  <span className="text-sodium-400">TUNING</span>
                </h2>
              </div>
              <div className="text-right">
                <div className="grn-label text-[0.58rem]">Balance</div>
                <div className="grn-display text-3xl italic text-sodium-400 [text-shadow:0_0_20px_rgba(245,165,36,0.5)]">
                  {garage.kd} KD
                </div>
                <button
                  onClick={() => setGarageOpen(false)}
                  className="grn-btn mt-2 bg-white px-6 py-2 text-sm text-black hover:bg-white/85"
                >
                  DONE — <span className="grn-ar">يلا نطلع</span>
                </button>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-[0.82rem] leading-6 text-white/50">
              Parts apply when you start the engine. Win battles to earn KD — deeper rivals pay
              more. Tap an equipped part to run stock in that slot.
            </p>
            {Object.entries(CAT_LABELS).map(([cat, label]) => (
              <div key={cat} className="mt-6">
                <h3 className="grn-label border-b border-white/10 pb-2 text-[0.68rem]">{label}</h3>
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
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
                        className={`grn-panel p-3.5 text-left transition ${
                          equipped
                            ? "border-sodium-400/80 bg-sodium-500/10 shadow-[0_0_30px_-10px_rgba(245,165,36,0.7)]"
                            : owned
                              ? "border-emerald-400/45 hover:border-emerald-400/70"
                              : affordable
                                ? "hover:border-white/30 hover:bg-white/[0.09]"
                                : "cursor-not-allowed opacity-40"
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="grn-display text-lg leading-tight">{p.name}</span>
                          <span className="grn-ar text-[0.8rem] text-white/60">{p.ar}</span>
                        </div>
                        {p.desc && (
                          <div className="mt-1.5 text-[0.76rem] leading-5 text-white/55">
                            {p.desc}
                          </div>
                        )}
                        <div className="grn-label mt-2.5 text-[0.6rem]">
                          {equipped ? (
                            <span className="text-sodium-400">Equipped ✓</span>
                          ) : owned ? (
                            <span className="text-emerald-300">
                              {EXCLUSIVE_CATS.has(p.cat) ? "Owned — tap to equip" : "Installed ✓"}
                            </span>
                          ) : (
                            <span
                              className={`grn-display text-base tracking-normal ${
                                affordable ? "text-gulf-300" : "text-white/40"
                              }`}
                            >
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
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
          <div className="grn-dialog w-full max-w-lg px-10 py-9 text-center">
            <div className="grn-label text-[0.7rem] text-rose-300">Battle lost</div>
            <div className="grn-display mt-2 text-6xl italic text-rose-500 [text-shadow:0_0_30px_rgba(244,63,94,0.7)]">
              DEFEATED
            </div>
            <div className="mt-4 text-lg font-semibold text-white/85">
              {beatenBy.name} <span className="grn-ar">{beatenBy.arabicName}</span> takes the night
            </div>
            <div className="mt-2 text-sm italic text-white/55">&quot;{beatenBy.taunt}&quot;</div>
            <button
              onClick={() => {
                engineRef.current?.retryBattle();
                setPhase("playing");
              }}
              className="grn-btn mt-8 w-full bg-white px-8 py-3.5 text-lg text-black hover:bg-white/85"
            >
              REMATCH <span className="text-black/50">(R)</span>
            </button>
          </div>
        </div>
      )}

      {/* Champion */}
      {phase === "champion" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
          <div className="grn-dialog w-full max-w-xl px-10 py-10 text-center">
            <div className="text-6xl">👑</div>
            <div className="grn-display mt-4 text-5xl italic text-sodium-400 [text-shadow:0_0_34px_rgba(245,165,36,0.75)] sm:text-6xl">
              KING OF GULF ROAD
            </div>
            <div className="grn-ar mt-3 text-2xl text-white/85" dir="rtl">
              ملك شارع الخليج
            </div>
            <div className="mx-auto mt-4 max-w-md text-[0.95rem] leading-6 text-white/65">
              All six legends defeated — from Salmiya to Jahra, every street is yours. Mabrook! 🇰🇼
            </div>
            <button
              onClick={() => {
                engineRef.current?.resetProgress();
                setPhase("playing");
              }}
              className="grn-btn grn-btn-primary mt-8 w-full px-8 py-3.5 text-lg"
            >
              RUN IT BACK — <span className="grn-ar">من جديد</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
