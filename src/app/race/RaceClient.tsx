"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DriverCard, GameEngine, HudData } from "@/game/engine";
import { GEARS } from "@/game/gears";
import { RIVALS, RivalDef } from "@/game/rivals";
import { HubClient, DuelInvite, loadProfile, formatLap } from "@/game/net";
import {
  Settings,
  loadSettings,
  saveSettings,
  applySettings,
  haptic,
  HAPTIC,
} from "@/game/settings";
import {
  PARTS,
  Part,
  GarageState,
  loadGarage,
  saveGarage,
  CARS,
  CLASS_LABELS,
  CarClass,
  getCar,
  WAGERS,
} from "@/game/mods";

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
    maxWager: number;
    /** null while the player is still choosing car + stake */
    answer: { accepted: boolean; reason: string } | null;
    sent: boolean;
  } | null>(null);
  const [wager, setWager] = useState(0);
  const [raceCar, setRaceCar] = useState<string>("wain-special");
  const challengeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [garageOpen, setGarageOpen] = useState(false);
  const [garage, setGarage] = useState<GarageState | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boostWrapRef = useRef<HTMLDivElement>(null);
  const boostRef = useRef<HTMLDivElement>(null);
  const nosWrapRef = useRef<HTMLDivElement>(null);
  const nosRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGarage(loadGarage()); // client-only: reads localStorage
    // Phones and tablets get on-screen controls; desktop stays keyboard
    setIsTouch(navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches);
    const st = loadSettings();
    applySettings(st);
    setSettings(st);
  }, []);

  const updateSetting = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSettings((prev) => {
      const next = { ...(prev ?? loadSettings()), [k]: v };
      saveSettings(next);
      haptic(HAPTIC.tap, next.haptics);
      return next;
    });
  }, []);

  const buyOrDrive = useCallback((carId: string) => {
    const g = loadGarage();
    const car = getCar(carId);
    if (!g.cars.includes(carId)) {
      if (g.kd < car.price) return;
      g.kd -= car.price;
      g.cars.push(carId);
    }
    g.car = carId; // buying it also puts you behind the wheel
    saveGarage(g);
    setGarage(g);
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
  // PvP
  const [invite, setInvite] = useState<DuelInvite | null>(null);
  const [duelResult, setDuelResult] = useState<{ won: boolean; reason: string; wager: number } | null>(null);
  const [nearby, setNearby] = useState<{ id: number; name: string; dist: number } | null>(null);
  const nearbyRef = useRef<{ id: number; name: string; dist: number } | null>(null);
  const duelRef = useRef(false);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      // Nearest online driver — the PvP challenge target
      nearbyRef.current = d.nearestRemote;
      setNearby((prev) => {
        const n = d.nearestRemote;
        if (!n && !prev) return prev;
        if (n && prev && n.id === prev.id && Math.abs(n.dist - prev.dist) < 3) return prev;
        return n;
      });

      // A live duel drives the same SP bars as a rival battle
      if (d.duel && battleRef.current) {
        battleRef.current.style.opacity = "1";
        if (playerBarRef.current) playerBarRef.current.style.width = `${d.duel.you}%`;
        if (rivalBarRef.current) rivalBarRef.current.style.width = `${d.duel.them}%`;
        if (battleNameRef.current)
          battleNameRef.current.textContent = `DUEL · ${d.duel.opponent} · ${
            d.duel.gap >= 0 ? `${Math.round(d.duel.gap)} m ahead` : `${Math.round(-d.duel.gap)} m behind`
          }`;
      }

      // Garage gauges: turbo boost + NOS charge (hidden without the mods)
      if (boostWrapRef.current)
        boostWrapRef.current.style.display = d.boost === null ? "none" : "flex";
      if (boostRef.current && d.boost !== null)
        boostRef.current.style.width = `${Math.round(d.boost * 100)}%`;
      if (nosWrapRef.current) nosWrapRef.current.style.display = d.nos === null ? "none" : "flex";
      if (nosRef.current && d.nos !== null)
        nosRef.current.style.width = `${Math.round(d.nos * 100)}%`;

      if (battleRef.current && !d.duel) {
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
        haptic(HAPTIC.impact, loadSettings().haptics);
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
      onChallenge: (player, rival, maxWager) => {
        haptic(HAPTIC.challenge, loadSettings().haptics);
        if (challengeTimer.current) clearTimeout(challengeTimer.current);
        const g = loadGarage();
        setRaceCar(g.car);
        setWager(WAGERS.filter((w) => w <= maxWager).slice(-1)[0] ?? 0);
        setChallenge({ player, rival, maxWager, answer: null, sent: false });
      },
      onChallengeResult: (accepted, reason) => {
        setChallenge((c) => (c ? { ...c, answer: { accepted, reason } } : c));
        if (accepted) setGarage(loadGarage());
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
          onDuelInvite: (inv) => setInvite(inv),
          onDuelStart: (opponent, w) => {
            duelRef.current = true;
            setInvite(null);
            showMessage(`⚔ DUEL — ${opponent}`, w > 0 ? `${w} KD on the line` : "Pride only");
          },
          onDuelSp: (you, them, gap) => {
            const opp = nearbyRef.current?.name ?? "Rival";
            engine.setDuel({ you, them, gap, opponent: opp });
          },
          onDuelEnd: (won, reason, w) => {
            duelRef.current = false;
            engine.setDuel(null);
            if (w > 0) {
              const g = loadGarage();
              g.kd = Math.max(0, g.kd + (won ? w : -w));
              saveGarage(g);
              setGarage(g);
            }
            setDuelResult({ won, reason, wager: w });
            if (resultTimer.current) clearTimeout(resultTimer.current);
            resultTimer.current = setTimeout(() => setDuelResult(null), 4200);
          },
          onDuelDeclined: () => showMessage("Challenge declined", "They weren't interested"),
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
      if (resultTimer.current) clearTimeout(resultTimer.current);
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
        <div className="hud-safe-t hud-safe-l absolute">
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
          <div className="grn-panel hud-safe-r absolute bottom-[calc(env(safe-area-inset-bottom)+6rem)] max-w-xs space-y-1 px-3 py-2 text-right text-xs">
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
          className="grn-panel hud-safe-t hud-safe-r absolute p-1"
        />

        {/* Battle SP bars */}
        <div
          ref={battleRef}
          className="absolute left-1/2 top-4 w-[min(560px,90vw)] -translate-x-1/2 opacity-0 transition-opacity"
        >
          <div className="mb-1.5 flex items-end justify-between">
            <span className="grn-label text-[0.66rem] text-emerald-300 [text-shadow:0_0_10px_rgba(52,211,153,0.8)]">
              ▲ SP <span className="grn-ar">أنت</span>
            </span>
            <span className="grn-label rival-ink text-[0.66rem] text-rose-300 [text-shadow:0_0_10px_rgba(251,113,133,0.8)]">
              ▼ Rival SP
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
              className="rival-bar h-full bg-gradient-to-r from-rose-700 via-rose-500 to-amber-300 shadow-[0_0_18px_rgba(244,63,94,0.85)] transition-[width] duration-150"
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
        <div
          className={`hud-safe-l absolute select-none ${
            isTouch
              ? "origin-bottom-left scale-90 bottom-[calc(env(safe-area-inset-bottom)+7rem)]"
              : "bottom-[calc(env(safe-area-inset-bottom)+1.75rem)]"
          }`}
        >
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
        <div
          className={`grn-panel hud-safe-b hud-safe-r absolute px-3 py-2 text-right font-display text-[0.78rem] leading-5 tracking-wide text-white/60 ${
            isTouch ? "hidden" : ""
          }`}
        >
          W/↑ accelerate · S/↓ brake · A D steer · N nitro · H horn
          <br />F flash headlights · M mute · B music · V voices · G glow fx
        </div>
      </div>

      {/* PvP: challenge the nearest online driver */}
      {phase === "playing" && nearby && !invite && !duelResult && (
        <div className="pointer-events-none absolute left-1/2 top-40 z-[6] -translate-x-1/2 text-center">
          <div className="grn-panel px-4 py-2">
            <div className="grn-label text-[0.58rem] text-gulf-300">Online driver</div>
            <div className="grn-display text-xl leading-tight">{nearby.name}</div>
            <div className="grn-label mt-0.5 text-[0.55rem]">
              {Math.abs(Math.round(nearby.dist))} m {nearby.dist >= 0 ? "ahead" : "behind"}
            </div>
            <div className="mt-2 flex items-center justify-center gap-1.5">
              <button
                onClick={() => {
                  // Cycle the stake through what you can actually cover
                  const bal = garage?.kd ?? 0;
                  const tiers = [0, ...WAGERS.filter((w) => w <= bal)];
                  const i = tiers.indexOf(wager);
                  setWager(tiers[(i + 1) % tiers.length] ?? 0);
                }}
                className="pointer-events-auto grn-btn border border-white/20 px-2.5 py-1.5 text-[0.62rem] text-white/70 hover:bg-white/10"
                title="Cycle the stake"
              >
                ⇅
              </button>
              <button
                onClick={() => hubRef.current?.challengePlayer(nearby.id, wager)}
                className="pointer-events-auto grn-btn grn-btn-ghost px-4 py-1.5 text-xs"
              >
                CHALLENGE ⚔ {wager > 0 ? `${wager} KD` : "PRIDE"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PvP: someone challenged you */}
      {invite && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
          <div className="grn-dialog w-full max-w-md px-9 py-8 text-center">
            <div className="grn-label text-[0.66rem] text-gulf-300">Incoming challenge</div>
            <div className="grn-display mt-2 text-4xl italic">
              {invite.tag ? <span className="text-sodium-400">[{invite.tag}] </span> : null}
              {invite.name}
            </div>
            <div className="mt-2 text-sm text-white/70">
              wants to race you for{" "}
              <span className="grn-display text-lg text-sodium-400">
                {invite.wager > 0 ? `${invite.wager} KD` : "pride"}
              </span>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => hubRef.current?.answerDuel(true)}
                className="grn-btn grn-btn-primary flex-1 py-3 text-lg"
              >
                ACCEPT — <span className="grn-ar">يلا</span>
              </button>
              <button
                onClick={() => {
                  hubRef.current?.answerDuel(false);
                  setInvite(null);
                }}
                className="grn-btn border border-white/20 px-6 py-3 text-sm text-white/70 hover:bg-white/10"
              >
                DECLINE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PvP: result */}
      {duelResult && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/55">
          <div className="grn-dialog px-12 py-9 text-center">
            <div
              className={`grn-display text-6xl italic ${
                duelResult.won
                  ? "text-emerald-400 [text-shadow:0_0_30px_rgba(52,211,153,0.8)]"
                  : "text-rose-500 [text-shadow:0_0_30px_rgba(244,63,94,0.8)]"
              }`}
            >
              {duelResult.won ? "DUEL WON" : "DUEL LOST"}
            </div>
            <div className="grn-label mt-3 text-[0.66rem]">{duelResult.reason}</div>
            {duelResult.wager > 0 && (
              <div className="grn-display mt-2 text-2xl text-sodium-400">
                {duelResult.won ? "+" : "−"}
                {duelResult.wager} KD
              </div>
            )}
          </div>
        </div>
      )}

      {/* Challenge cards — both drivers revealed, rival answers */}
      {challenge && phase === "playing" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center overflow-y-auto bg-black/70 px-4 py-6">
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
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="grn-label text-[0.58rem]">Car</span>
                    <span className="grn-display text-right text-[0.95rem] text-gulf-300">
                      {i === 0 ? getCar(raceCar).name : d.car}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 min-h-[9rem] w-full max-w-3xl text-center">
            {challenge.answer === null && !challenge.sent ? (
              <div className="grn-panel px-5 py-4 text-left">
                {/* Pick the machine */}
                <div className="grn-label text-[0.6rem]">
                  Your car — <span className="grn-ar">اختر سيارتك</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(garage?.cars ?? ["wain-special"]).map((id) => {
                    const c = getCar(id);
                    const on = raceCar === id;
                    return (
                      <button
                        key={id}
                        onClick={() => setRaceCar(id)}
                        className={`pointer-events-auto rounded-lg border px-3 py-1.5 text-left transition ${
                          on
                            ? "border-sodium-400 bg-sodium-500/15"
                            : "border-white/15 hover:border-white/35"
                        }`}
                      >
                        <div className="grn-display text-sm leading-tight">{c.name}</div>
                        <div className="grn-label text-[0.52rem]">{c.cls}</div>
                      </button>
                    );
                  })}
                </div>

                {/* Pick the purse */}
                <div className="grn-label mt-4 text-[0.6rem]">
                  Stake — <span className="grn-ar">مبلغ السباق</span>
                  <span className="ml-2 text-white/40">
                    winner takes both · max {challenge.maxWager} KD
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[0, ...WAGERS.filter((w) => w <= challenge.maxWager)].map((w) => (
                    <button
                      key={w}
                      onClick={() => setWager(w)}
                      className={`pointer-events-auto grn-display rounded-lg border px-3.5 py-1.5 text-sm transition ${
                        wager === w
                          ? "border-gulf-400 bg-gulf-500/20 text-gulf-300"
                          : "border-white/15 text-white/70 hover:border-white/35"
                      }`}
                    >
                      {w === 0 ? "PRIDE" : `${w} KD`}
                    </button>
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={() => {
                      setChallenge((c) => (c ? { ...c, sent: true } : c));
                      engineRef.current?.confirmChallenge(wager, raceCar);
                    }}
                    className="pointer-events-auto grn-btn grn-btn-primary flex-1 py-3 text-lg"
                  >
                    SEND CHALLENGE — <span className="grn-ar">تحداه</span>
                  </button>
                  <button
                    onClick={() => {
                      engineRef.current?.cancelChallenge();
                      setChallenge(null);
                    }}
                    className="pointer-events-auto grn-btn border border-white/20 px-5 py-3 text-sm text-white/70 hover:bg-white/10"
                  >
                    BACK OFF
                  </button>
                </div>
              </div>
            ) : challenge.answer === null ? (
              <div className="grn-label animate-pulse text-base text-white/80">
                Awaiting response… <span className="grn-ar">ينتظر الرد</span>
              </div>
            ) : challenge.answer.accepted ? (
              <div>
                <div className="grn-display text-4xl italic text-emerald-400 [text-shadow:0_0_26px_rgba(52,211,153,0.85)]">
                  ACCEPTED — <span className="grn-ar">قبل التحدي</span> ✓
                </div>
                <div className="grn-label mt-1.5 text-[0.66rem] text-sodium-400">
                  {challenge.answer.reason}
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

      {/* On-screen controls (touch devices) */}
      {isTouch && phase === "playing" && !challenge && !garageOpen && (
        <div className="absolute inset-x-0 bottom-0 z-[5] select-none px-[calc(env(safe-area-inset-left)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div className="flex items-end justify-between gap-4">
            <div className="flex gap-3">
              {([["\u25c0", -1], ["\u25b6", 1]] as const).map(([glyph, dir]) => (
                <button
                  key={glyph}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    engineRef.current?.setTouchInput({ steer: dir });
                  }}
                  onPointerUp={() => engineRef.current?.setTouchInput({ steer: 0 })}
                  onPointerCancel={() => engineRef.current?.setTouchInput({ steer: 0 })}
                  className="tap grn-panel grid size-[4.5rem] place-items-center text-2xl text-white/85 active:bg-white/20"
                  aria-label={dir < 0 ? "steer left" : "steer right"}
                >
                  {glyph}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onPointerDown={() => engineRef.current?.touchFlash()}
                className="tap grn-panel grn-label px-5 py-3.5 text-[0.6rem] text-gulf-300 active:bg-gulf-500/25"
              >
                Flash
              </button>
              <button
                onPointerDown={() => engineRef.current?.touchNos(true)}
                onPointerUp={() => engineRef.current?.touchNos(false)}
                onPointerCancel={() => engineRef.current?.touchNos(false)}
                className="tap grn-panel grn-label px-5 py-3.5 text-[0.6rem] text-indigo-300 active:bg-indigo-500/25"
              >
                NOS
              </button>
              <button
                onPointerDown={() => engineRef.current?.touchHorn(true)}
                onPointerUp={() => engineRef.current?.touchHorn(false)}
                onPointerCancel={() => engineRef.current?.touchHorn(false)}
                className="tap grn-panel grn-label px-5 py-3.5 text-[0.6rem] text-white/70 active:bg-white/20"
              >
                Horn
              </button>
            </div>

            <div className="flex gap-3">
              <button
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  engineRef.current?.setTouchInput({ brake: 1 });
                }}
                onPointerUp={() => engineRef.current?.setTouchInput({ brake: 0 })}
                onPointerCancel={() => engineRef.current?.setTouchInput({ brake: 0 })}
                className="tap grn-panel grn-label grid size-[4.5rem] place-items-center text-[0.62rem] text-rose-300 active:bg-rose-500/25"
              >
                Brake
              </button>
              <button
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  engineRef.current?.setTouchInput({ throttle: 1 });
                }}
                onPointerUp={() => engineRef.current?.setTouchInput({ throttle: 0 })}
                onPointerCancel={() => engineRef.current?.setTouchInput({ throttle: 0 })}
                className="tap grn-panel grn-label grid size-[5.5rem] place-items-center text-[0.66rem] text-emerald-300 active:bg-emerald-500/25"
              >
                Gas
              </button>
            </div>
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
        <div className="safe-pad absolute inset-0 flex flex-col items-center justify-center overflow-y-auto bg-gradient-to-b from-[#05070f] via-[#0a1226] to-[#05070f] text-center">
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
              className="tap grn-btn grn-btn-ghost px-9 py-4 text-xl"
            >
              GARAGE 🔧 <span className="grn-ar">الكراج</span>
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              className="tap grn-btn border border-white/20 px-5 py-4 text-xl text-white/70 hover:bg-white/10"
            >
              ⚙
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

      {/* Settings */}
      {settingsOpen && settings && (
        <div className="safe-pad absolute inset-0 z-30 overflow-y-auto bg-gradient-to-b from-[#05070f] via-[#0a1226] to-[#05070f]">
          <div className="mx-auto max-w-xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="grn-label text-[0.72rem] tracking-[0.42em] text-gulf-400">
                  Settings
                </div>
                <h2 className="grn-display mt-1 text-4xl italic">
                  <span className="grn-ar">الإعدادات</span>
                </h2>
              </div>
              <button
                onClick={() => setSettingsOpen(false)}
                className="tap grn-btn bg-white px-6 py-2.5 text-sm text-black hover:bg-white/85"
              >
                DONE
              </button>
            </div>

            {/* Accessibility */}
            <h3 className="grn-label mt-7 border-b border-white/10 pb-2 text-[0.68rem]">
              Accessibility · إمكانية الوصول
            </h3>
            <div className="mt-3 space-y-2">
              {(
                [
                  ["reducedMotion", "Reduced motion", "Stops splashes, pulses and camera shake"],
                  ["colorBlindSafe", "Colour-blind safe", "Rival switches off the red/green pair"],
                  ["largeHud", "Large HUD", "Bigger speed, gauges and prompts"],
                  ["haptics", "Haptics", "Vibrate on impacts, challenges and rewards"],
                ] as const
              ).map(([key, label, hint]) => (
                <button
                  key={key}
                  onClick={() => updateSetting(key, !settings[key])}
                  role="switch"
                  aria-checked={settings[key]}
                  className="tap grn-panel flex w-full items-center justify-between gap-4 p-4 text-left transition hover:border-white/30"
                >
                  <span>
                    <span className="grn-display block text-lg leading-tight">{label}</span>
                    <span className="text-[0.78rem] text-white/50">{hint}</span>
                  </span>
                  <span
                    className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                      settings[key] ? "bg-emerald-500/80" : "bg-white/15"
                    }`}
                  >
                    <span
                      className={`absolute top-1 size-5 rounded-full bg-white transition-all ${
                        settings[key] ? "left-6" : "left-1"
                      }`}
                    />
                  </span>
                </button>
              ))}
            </div>

            {/* Quality */}
            <h3 className="grn-label mt-7 border-b border-white/10 pb-2 text-[0.68rem]">
              Graphics · الرسومات
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["auto", "high", "balanced", "battery"] as const).map((q) => (
                <button
                  key={q}
                  onClick={() => updateSetting("quality", q)}
                  className={`tap grn-panel px-3 py-3 text-center capitalize transition ${
                    settings.quality === q
                      ? "border-sodium-400/80 bg-sodium-500/10 text-sodium-400"
                      : "text-white/70 hover:border-white/30"
                  }`}
                >
                  <span className="grn-display text-base">{q}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[0.76rem] text-white/45">
              Auto measures your frame rate for six seconds and drops glow and shadows if the
              device can&apos;t hold it. Battery caps the resolution as well.
            </p>

            {/* Audio */}
            <h3 className="grn-label mt-7 border-b border-white/10 pb-2 text-[0.68rem]">
              Audio · الصوت
            </h3>
            <div className="mt-3 space-y-4">
              {(
                [
                  ["musicVolume", "Music"],
                  ["sfxVolume", "Effects"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="flex items-baseline justify-between">
                    <span className="grn-label text-[0.62rem]">{label}</span>
                    <span className="grn-display text-sm text-white/70">
                      {Math.round(settings[key] * 100)}%
                    </span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(settings[key] * 100)}
                    onChange={(e) => updateSetting(key, Number(e.target.value) / 100)}
                    className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-sodium-400"
                  />
                </label>
              ))}
            </div>

            <div className="h-10" />
          </div>
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
              Buy a car, then bolt parts to it. Both apply when you start the engine. Race for a
              purse — you and the rival each stake the same money, winner takes it all. Tap an
              equipped part to run stock in that slot.
            </p>
            <div className="grn-panel mt-4 inline-flex items-center gap-3 px-4 py-2">
              <span className="grn-label text-[0.58rem]">In the driveway</span>
              <span className="grn-display text-lg text-sodium-400">
                {getCar(garage.car).name}
              </span>
            </div>
            {/* Showroom — priced high to low */}
            {(["supercar", "sport", "normal"] as CarClass[]).map((cls) => (
              <div key={cls} className="mt-7">
                <h3 className="grn-label border-b border-white/10 pb-2 text-[0.68rem]">
                  {CLASS_LABELS[cls]}
                </h3>
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {CARS.filter((c) => c.cls === cls).map((c) => {
                    const owned = garage.cars.includes(c.id);
                    const driving = garage.car === c.id;
                    const affordable = garage.kd >= c.price;
                    return (
                      <button
                        key={c.id}
                        onClick={() => buyOrDrive(c.id)}
                        disabled={!owned && !affordable}
                        className={`grn-panel p-3.5 text-left transition ${
                          driving
                            ? "border-sodium-400/80 bg-sodium-500/10 shadow-[0_0_30px_-10px_rgba(245,165,36,0.7)]"
                            : owned
                              ? "border-emerald-400/45 hover:border-emerald-400/70"
                              : affordable
                                ? "hover:border-white/30 hover:bg-white/[0.09]"
                                : "cursor-not-allowed opacity-40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="grn-display text-lg leading-tight">{c.name}</div>
                            <div className="grn-ar text-[0.78rem] text-white/55">{c.ar}</div>
                          </div>
                          <span
                            className="mt-1 size-5 shrink-0 rounded-full border border-white/40"
                            style={{ backgroundColor: `#${c.color.toString(16).padStart(6, "0")}` }}
                          />
                        </div>
                        <div className="mt-2 text-[0.76rem] leading-5 text-white/55">{c.desc}</div>
                        <div className="mt-2.5 grid grid-cols-3 gap-1 border-t border-white/10 pt-2 text-center">
                          {(
                            [
                              ["PWR", c.power.toFixed(2) + "×"],
                              ["GRIP", c.grip.toFixed(1)],
                              ["BRK", String(c.brake)],
                            ] as const
                          ).map(([k, v]) => (
                            <div key={k}>
                              <div className="grn-label text-[0.5rem]">{k}</div>
                              <div className="grn-display text-sm text-white/85">{v}</div>
                            </div>
                          ))}
                        </div>
                        <div className="grn-label mt-2.5 text-[0.6rem]">
                          {driving ? (
                            <span className="text-sodium-400">Driving now ✓</span>
                          ) : owned ? (
                            <span className="text-emerald-300">Owned — tap to drive</span>
                          ) : (
                            <span
                              className={`grn-display text-base tracking-normal ${
                                affordable ? "text-gulf-300" : "text-white/40"
                              }`}
                            >
                              {c.price.toLocaleString()} KD
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

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
