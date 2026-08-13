"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DriverCard, GameEngine, HudData, RaceResult } from "@/game/engine";
import { playSfx, preloadSfx, setSfxVolume } from "@/game/sfx";
import Results from "./Results";
import Onboarding, { CoachHint, CoachState, hasOnboarded } from "./Onboarding";
import Garage from "./Garage";
import { GEARS } from "@/game/gears";
import { RIVALS, RivalDef } from "@/game/rivals";
import { HubClient, DuelInvite, loadProfile, formatLap } from "@/game/net";
import {
  Profile,
  loadProfileStats,
  levelInfo,
  rankTitle,
} from "@/game/profile";
import {
  Settings,
  loadSettings,
  saveSettings,
  applySettings,
  haptic,
  HAPTIC,
} from "@/game/settings";
import {
  EXCLUSIVE_CATS,
  Part,
  GarageState,
  loadGarage,
  saveGarage,
  getCar,
  WAGERS,
} from "@/game/mods";


type Phase = "menu" | "loading" | "playing" | "champion" | "error";

/** Rivals defeated so far, as the engine saves it. */
function readBeaten(): number {
  try {
    return Math.min(RIVALS.length, Number(localStorage.getItem("gulf-road-nights-progress") ?? "0"));
  } catch {
    return 0;
  }
}

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
  const garageWasOpen = useRef(false);
  const [garage, setGarage] = useState<GarageState | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [cine, setCine] = useState<{ card: DriverCard; stake: number } | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const driftRef = useRef<HTMLDivElement>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [coach, setCoach] = useState<CoachState | null>(null);
  const coachRef = useRef<CoachState | null>(null);
  const [career, setCareer] = useState<Profile | null>(null);
  const [beaten, setBeaten] = useState(0);
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
    setSfxVolume(st.sfxVolume);
    preloadSfx();
    // First-time players get the five-card primer before the menu.
    if (!hasOnboarded()) setOnboarding(true);
    setCareer(loadProfileStats());
    setBeaten(readBeaten());
  }, []);

  const updateSetting = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSettings((prev) => {
      const next = { ...(prev ?? loadSettings()), [k]: v };
      saveSettings(next);
      haptic(HAPTIC.tap, next.haptics);
      if (k === "sfxVolume") setSfxVolume(next.sfxVolume);
      if (k === "quality") engineRef.current?.applyQualityTier(next.quality);
      if (k === "sky") engineRef.current?.setSky(next.sky);
      if (k === "frameCap") engineRef.current?.setFrameCap(next.frameCap);
      playSfx("ui-tap", 0.6);
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

      // Drift readout: angle while sliding, banked score lingering after
      if (driftRef.current) {
        if (d.drift) {
          driftRef.current.style.opacity = "1";
          driftRef.current.textContent = d.drift.active
            ? `DRIFT ${d.drift.deg}° ${"|".repeat(Math.min(14, 1 + (d.drift.score / 60) | 0))}`
            : `DRIFT +${d.drift.score}`;
          driftRef.current.style.color = d.drift.active
            ? d.drift.deg > 26
              ? "#ffc45c"
              : "#7fe3ff"
            : "#a7f3d0";
        } else {
          driftRef.current.style.opacity = "0";
        }
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
      coachRef.current = {
        speedKmh: d.speedKmh,
        rivalDist: d.rivalDist ?? 0,
        inBattle: d.battle !== null,
      };
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

  const exitToMenu = useCallback(() => {
    engineRef.current?.dispose();
    engineRef.current = null;
    startingRef.current = false;
    if (sendTimer.current) clearInterval(sendTimer.current);
    hubRef.current?.close();
    hubRef.current = null;
    setOnlineCount(null);
    setPauseOpen(false);
    setResult(null);
    setChallenge(null);
    setCine(null);
    setMessage(null);
    setGarage(loadGarage());
    setCareer(loadProfileStats());
    setBeaten(readBeaten());
    setPhase("menu");
  }, []);

  const startGame = useCallback(async () => {
    // startingRef guards the async import window — without it a double
    // Enter/click builds two engines on the same canvas
    if (engineRef.current || startingRef.current || !canvasRef.current) return;
    startingRef.current = true;
    setPhase("loading");
    let GameEngine: typeof import("@/game/engine").GameEngine;
    try {
      ({ GameEngine } = await import("@/game/engine"));
    } catch (err) {
      console.error(err);
      startingRef.current = false;
      setPhase("error");
      return;
    }
    // Dev helper: ?start=<metres> spawns further along the lap
    const startS = parseFloat(new URLSearchParams(window.location.search).get("start") ?? "");
    let engine: GameEngine;
    try {
      engine = new GameEngine(canvasRef.current, {
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
        // Unreachable while onResult is wired (the results screen owns the
        // loss), kept so the engine contract stays honest.
        onDefeat: (rival) => showMessage(`${rival.name} takes the night`, "Press R for a rematch"),
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
        onResult: (r) => {
          setChallenge(null);
          setVsRival(null);
          setMessage(null);
          haptic(r.outcome === "win" ? HAPTIC.reward : HAPTIC.impact, loadSettings().haptics);
          setGarage(loadGarage());
          setCareer(loadProfileStats());
          setBeaten(readBeaten()); // engine has already saved by now
          setResult(r);
        },
        onPauseRequest: () => setPauseOpen((p) => !p),
      onCinematic: (active, rival, stake) => {
        setCine(active ? { card: rival, stake } : null);
        if (active) setChallenge(null); // the film replaces the setup card
      },
      onChallengeResult: (accepted, reason) => {
          setChallenge((c) => (c ? { ...c, answer: { accepted, reason } } : c));
          if (accepted) setGarage(loadGarage());
          if (challengeTimer.current) clearTimeout(challengeTimer.current);
          challengeTimer.current = setTimeout(() => setChallenge(null), accepted ? 1200 : 2600);
        },
      }, Number.isFinite(startS) ? { startS } : undefined);
      mapPathRef.current = engine.getMapPath();
      engine.resize();
      engine.start();
    } catch (err) {
      // Almost always "no WebGL" — a blank black screen is the worst
      // possible answer, so say what happened and offer a way out.
      console.error(err);
      startingRef.current = false;
      setPhase("error");
      return;
    }
    engineRef.current = engine;
    const boot = loadSettings();
    if (boot.quality !== "auto") engine.applyQualityTier(boot.quality);
    if (boot.sky !== "night") engine.setSky(boot.sky);
    if (boot.frameCap !== "display") engine.setFrameCap(boot.frameCap);
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

  // A controller is welcomed the moment it wakes up
  useEffect(() => {
    const hello = () => showMessage("Controller connected 🎮", "Stick steer · RT gas · LT brake · B drift · X flash · A NOS");
    window.addEventListener("gamepadconnected", hello);
    return () => window.removeEventListener("gamepadconnected", hello);
  }, [showMessage]);

  // Coach hints read the live HUD at 4 Hz — enough to feel responsive
  // without re-rendering React every frame.
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => setCoach(coachRef.current), 250);
    return () => clearInterval(id);
  }, [phase]);

  // The touch pads unmount whenever an overlay covers them, which eats
  // their pointerup events — release every input or a held Gas/Drift pad
  // stays latched through the overlay and beyond.
  const padsVisible =
    isTouch && phase === "playing" && !challenge && !garageOpen && !result && !onboarding && !cine;
  useEffect(() => {
    if (padsVisible) return;
    const e = engineRef.current;
    if (!e) return;
    e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
    e.touchDrift(false);
    e.touchNos(false);
    e.touchHorn(false);
  }, [padsVisible]);

  // The pause menu freezes the race (and holds it frozen under the
  // settings screen); the garage and results manage their own pause.
  useEffect(() => {
    if (phase !== "playing" || garageOpen || result) return;
    engineRef.current?.setPaused(pauseOpen || settingsOpen);
  }, [pauseOpen, settingsOpen, phase, garageOpen, result]);

  // The garage is a full-screen overlay: freeze the race behind it, and
  // rebuild the car with whatever was bought on the way out.
  useEffect(() => {
    if (phase !== "playing") return;
    const e = engineRef.current;
    if (!e) return;
    e.setPaused(garageOpen);
    if (garageOpen) garageWasOpen.current = true;
    else if (garageWasOpen.current) {
      garageWasOpen.current = false;
      e.refreshGarage();
    }
  }, [garageOpen, phase]);

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
      if (
        e.key === "Escape" &&
        phase === "playing" &&
        !garageOpen &&
        !settingsOpen &&
        !onboarding &&
        !result &&
        !cine &&
        !challenge
      ) {
        setPauseOpen((p) => !p);
      }
      // Enter must not fall through a modal and start the race behind it
      if (
        phase === "menu" &&
        e.key === "Enter" &&
        !e.repeat &&
        !garageOpen &&
        !settingsOpen &&
        !onboarding
      )
        startGame();
      if (result && result.outcome === "loss" && e.key.toLowerCase() === "r") {
        setResult(null);
        engineRef.current?.setPaused(false);
        engineRef.current?.retryBattle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, startGame, result, garageOpen, settingsOpen, onboarding, cine, challenge]);

  const lvl = levelInfo(career?.xp ?? 0);
  const rank = rankTitle(lvl.level);

  return (
    <div className="fixed inset-0 z-[60] bg-black text-white">
      <canvas ref={canvasRef} className="h-full w-full" />

      {/* HUD */}
      <div
        className={`pointer-events-none absolute inset-0 transition-opacity ${
          phase === "playing" && !cine ? "opacity-100" : "opacity-0"
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
          <div className="grn-panel hud-safe-r absolute bottom-[calc(env(safe-area-inset-bottom)+16rem)] max-w-xs space-y-1 px-3 py-2 text-right text-xs">
            {feed.map((m) => (
              <p key={m.key} className="leading-4">
                <span className="font-bold text-gulf-300">{m.name}:</span>{" "}
                <span className="text-white/85">{m.text}</span>
              </p>
            ))}
          </div>
        )}

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

        {/* Drift angle + style counter */}
        <div className="pointer-events-none absolute left-1/2 top-[66%] -translate-x-1/2">
          <div
            ref={driftRef}
            className="grn-display text-xl italic tracking-[0.14em] opacity-0 transition-opacity duration-300 [text-shadow:0_0_18px_rgba(56,201,238,0.5),0_2px_10px_rgba(0,0,0,0.9)]"
          />
        </div>

        {/* First-run coaching, in-world */}
        {phase === "playing" && !result && <CoachHint state={coach} />}

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

        {/* Bottom-right stack: minimap pinned above the controls hint.
            One flex column rather than three independently-positioned
            panels, so they can never overlap at any viewport size and the
            hint disappearing on touch simply closes the gap. */}
        <div className="hud-safe-b hud-safe-r absolute flex flex-col items-end gap-2">
          <canvas
            ref={mapRef}
            width={150}
            height={150}
            className="grn-panel p-1"
          />
          <div
            className={`grn-panel px-3 py-2 text-right font-display text-[0.78rem] leading-5 tracking-wide text-white/60 ${
              isTouch ? "hidden" : ""
            }`}
          >
            W/↑ accelerate · S/↓ brake · A D steer · Space drift · N nitro
            <br />F flash · Esc pause · M mute · B music · V voices · 🎮 supported
          </div>
        </div>
      </div>

      {/* PvP: challenge the nearest online driver */}
      {phase === "playing" && nearby && !invite && !duelResult && !cine && (
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
      {invite && !cine && (
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
      {padsVisible && (
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
                  engineRef.current?.touchDrift(true);
                }}
                onPointerUp={() => engineRef.current?.touchDrift(false)}
                onPointerCancel={() => engineRef.current?.touchDrift(false)}
                className="tap grn-panel grn-label grid size-[4.5rem] place-items-center text-[0.6rem] text-sodium-400 active:bg-sodium-500/25"
              >
                Drift
              </button>
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
        <div className="safe-pad screen-in absolute inset-0 z-10 overflow-y-auto bg-gradient-to-b from-[#05070f] via-[#0a1226] to-[#05070f]">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
            {/* Driver bar — who you are, what you have, how far you are */}
            <div className="grn-panel flex items-center gap-3 px-3 py-2.5">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-sodium-500/50 bg-sodium-500/15">
                <span className="grn-display tnum text-lg leading-none text-sodium-400">
                  {lvl.level}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="grn-display truncate text-sm text-white">
                    {rank.en}{" "}
                    <span className="grn-ar hidden text-white/50 sm:inline">{rank.ar}</span>
                  </span>
                  <span className="grn-label tnum shrink-0 text-[0.52rem] text-white/45">
                    {lvl.into}/{lvl.need} XP
                  </span>
                </div>
                <div className="grn-meter mt-1 h-2">
                  <div
                    className="xp-fill h-full bg-gradient-to-r from-gulf-500 to-gulf-300"
                    style={{ width: `${Math.round(lvl.pct * 100)}%` }}
                  />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="grn-label text-[0.5rem] text-white/45">Balance</div>
                <div className="grn-display tnum text-lg leading-tight text-sodium-400">
                  {(garage?.kd ?? 0).toLocaleString()}
                  <span className="ml-0.5 text-[0.6rem] text-white/50">KD</span>
                </div>
              </div>
              <button
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                className="tap grid shrink-0 place-items-center rounded-xl border border-white/15 text-lg text-white/70 hover:bg-white/10"
              >
                ⚙
              </button>
            </div>

            <div className="menu-grid">
             <div className="menu-col">
            {/* Title */}
            <div className="menu-title mt-5 text-center sm:mt-7">
              <div className="grn-label text-[0.62rem] tracking-[0.45em] text-gulf-400 [text-shadow:0_0_20px_rgba(56,201,238,0.5)]">
                Kuwait Xtreme Racer
              </div>
              <h1 className="grn-display menu-wordmark mt-1.5 text-[clamp(2.4rem,12vw,5rem)] italic leading-[0.88]">
                GULF ROAD <span className="text-sodium-400">NIGHTS</span>
              </h1>
              <div className="grn-ar mt-1.5 text-lg text-white/70" dir="rtl">
                ليالي شارع الخليج
              </div>
            </div>

            {/* Career stats — the returning-player payoff */}
            {career && career.races > 0 && (
              <div className="mt-4 grid grid-cols-4 gap-2">
                {[
                  { k: "Races", v: String(career.races) },
                  { k: "Wins", v: String(career.wins) },
                  { k: "Top speed", v: career.topSpeed ? `${career.topSpeed}` : "—" },
                  { k: "Best lap", v: career.bestLapMs ? formatLap(career.bestLapMs) : "—" },
                ].map((x) => (
                  <div
                    key={x.k}
                    className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-center"
                  >
                    <div className="grn-display tnum text-base leading-tight text-white">{x.v}</div>
                    <div className="grn-label text-[0.48rem] text-white/45">{x.k}</div>
                  </div>
                ))}
              </div>
            )}

             </div>

             <div className="menu-col">
            {/* Next race — the one thing the menu is for */}
            <div className="grn-dialog mt-5 p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <span className="grn-label text-[0.55rem] text-gulf-400">
                  {beaten >= RIVALS.length ? "Career complete" : "Next race"}
                </span>
                <span className="grn-label tnum text-[0.55rem] text-white/45">
                  {beaten} / {RIVALS.length} legends beaten
                </span>
              </div>
              {beaten >= RIVALS.length ? (
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-3xl">👑</span>
                  <div>
                    <div className="grn-display text-xl text-sodium-400">King of Gulf Road</div>
                    <div className="text-[0.75rem] text-white/55">
                      Every street is yours — run it back for the times.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-3">
                  <span
                    className="size-11 shrink-0 rounded-lg border border-white/15"
                    style={{
                      background: `linear-gradient(140deg, #${RIVALS[beaten].bodyColor
                        .toString(16)
                        .padStart(6, "0")}, #0a0e18)`,
                    }}
                  />
                  <div className="min-w-0">
                    <div className="grn-display truncate text-xl text-white">
                      {RIVALS[beaten].name}{" "}
                      <span className="grn-ar text-white/60">{RIVALS[beaten].arabicName}</span>
                    </div>
                    <div className="truncate text-[0.75rem] text-white/55">
                      {RIVALS[beaten].crew} · {RIVALS[beaten].area}
                    </div>
                  </div>
                  <div className="ml-auto shrink-0 text-right">
                    <div className="grn-label text-[0.5rem] text-white/45">Prize</div>
                    <div className="grn-display tnum text-base text-sodium-400">
                      {(400 + beaten * 300).toLocaleString()} KD
                    </div>
                  </div>
                </div>
              )}

              {/* Roster progress */}
              <div className="mt-3 flex gap-1" aria-label="Career progress">
                {RIVALS.map((r, i) => (
                  <span
                    key={r.id}
                    title={r.name}
                    className={`h-1.5 flex-1 rounded-full ${
                      i < beaten
                        ? "bg-sodium-400"
                        : i === beaten
                          ? "bg-gulf-400"
                          : "bg-white/15"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Primary actions */}
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <button
                onClick={startGame}
                className="grn-btn grn-btn-primary tap flex-1 whitespace-nowrap px-6 py-4 text-base sm:text-lg"
              >
                {beaten > 0 ? "CONTINUE" : "START ENGINE"} <span className="grn-ar">يلا</span> 🏁
              </button>
              <button
                onClick={() => {
                  setGarage(loadGarage());
                  setGarageOpen(true);
                }}
                className="tap grn-btn grn-btn-ghost whitespace-nowrap px-6 py-4 text-base sm:text-lg"
              >
                GARAGE 🔧 <span className="grn-ar">الكراج</span>
              </button>
            </div>

             </div>
            </div>

            <div className="mt-auto flex items-center justify-between pt-4">
              <button
                onClick={() => setOnboarding(true)}
                className="grn-label tap px-1 text-[0.55rem] text-white/45 hover:text-white"
              >
                How to play
              </button>
              <a
                href="/hub"
                className="grn-label text-[0.55rem] text-gulf-300 underline-offset-4 hover:underline"
              >
                Online hub →
              </a>
            </div>
          </div>
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
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(["auto", "ultra", "high", "balanced", "battery"] as const).map((q) => (
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

            {/* Frame pacing */}
            <h3 className="grn-label mt-7 border-b border-white/10 pb-2 text-[0.68rem]">
              Frame rate · معدل الإطارات
            </h3>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {(
                [
                  ["display", "Display"],
                  ["vrr", "G-Sync"],
                  [144, "144"],
                  [120, "120"],
                  [60, "60"],
                  [30, "30"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={String(v)}
                  onClick={() => updateSetting("frameCap", v)}
                  className={`tap grn-panel px-2 py-3 text-center transition ${
                    settings.frameCap === v
                      ? "border-sodium-400/80 bg-sodium-500/10 text-sodium-400"
                      : "text-white/70 hover:border-white/30"
                  }`}
                >
                  <span className="grn-display text-sm">{label}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[0.76rem] text-white/45">
              Display follows your panel&apos;s own refresh rate. G-Sync sits a few frames under
              it, which is what keeps a variable-refresh screen inside its window instead of
              falling back to v-sync. Browsers lock rendering to v-sync and offer no way to
              switch it off, so a cap is the only pacing control there is here.
            </p>

            {/* Time of day */}
            <h3 className="grn-label mt-7 border-b border-white/10 pb-2 text-[0.68rem]">
              Sky · السما
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(
                [
                  ["night", "Midnight", "ليل", "Sodium lamps, full stars, the classic run"],
                  ["dawn", "First light", "فجر", "Sunrise band on the horizon, stars fading"],
                ] as const
              ).map(([mode, label, ar, desc]) => (
                <button
                  key={mode}
                  onClick={() => updateSetting("sky", mode)}
                  className={`tap grn-panel px-3 py-3 text-left transition ${
                    settings.sky === mode
                      ? "border-sodium-400/80 bg-sodium-500/10"
                      : "hover:border-white/30"
                  }`}
                >
                  <span className="grn-display block text-base">
                    {label} <span className="grn-ar text-white/55">{ar}</span>
                  </span>
                  <span className="block text-[0.7rem] text-white/50">{desc}</span>
                </button>
              ))}
            </div>

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
        <Garage
          garage={garage}
          onClose={() => setGarageOpen(false)}
          onBuyCar={buyOrDrive}
          onBuyPart={buyOrEquip}
        />
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
              Every legend on the roster defeated — from Salmiya to Jahra, the street is yours. Mabrook! 🇰🇼
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

      {/* Pre-battle rival cinematic: letterbox + card, tap to skip */}
      {cine && (
        <button
          onClick={() => engineRef.current?.skipCinematic()}
          className="absolute inset-0 z-[25] block w-full cursor-default text-left"
          aria-label="Skip intro"
        >
          <div className="cine-bar cine-bar-t" />
          <div className="cine-bar cine-bar-b" />
          {/* Rival card rides the lower bar */}
          <div className="cine-card absolute bottom-[calc(11vh+env(safe-area-inset-bottom))] left-[calc(env(safe-area-inset-left)+1.25rem)]">
            <div className="grn-label text-[0.58rem] text-sodium-400">
              Challenger · تحدي
            </div>
            <div className="grn-display mt-0.5 text-[clamp(1.6rem,6vw,2.6rem)] italic leading-none text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.9)]">
              {cine.card.name}{" "}
              <span className="grn-ar not-italic text-white/70">{cine.card.arabicName}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[0.75rem] text-white/70">
              <span
                className="inline-block size-3 rounded-sm border border-white/25"
                style={{ background: `#${cine.card.color.toString(16).padStart(6, "0")}` }}
              />
              <span>{cine.card.car}</span>
              <span className="text-white/35">·</span>
              <span>{cine.card.crew}</span>
              <span className="text-white/35">·</span>
              <span>
                LV {cine.card.level} {cine.card.flag}
              </span>
            </div>
            <div className="grn-display mt-1.5 text-[0.8rem] tracking-[0.12em] text-sodium-400">
              {cine.stake > 0 ? (
                <>
                  {cine.stake.toLocaleString()} KD EACH — ON THE LINE{" "}
                  <span className="grn-ar">على المحك</span>
                </>
              ) : (
                <>
                  PRIDE ONLY <span className="grn-ar">على الشرف</span>
                </>
              )}
            </div>
          </div>
          <div className="grn-label cine-skip absolute bottom-[calc(3vh+env(safe-area-inset-bottom))] right-[calc(env(safe-area-inset-right)+1.25rem)] text-[0.55rem] text-white/50">
            tap to skip ▸▸
          </div>
        </button>
      )}

      {/* Pause menu — Escape or the controller's Start button */}
      {pauseOpen && phase === "playing" && !garageOpen && !settingsOpen && !result && (
        <div
          className="absolute inset-0 z-[28] flex items-center justify-center bg-night-950/85 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Paused"
        >
          <div className="grn-dialog screen-in w-[min(400px,92vw)] p-6 text-center">
            <div className="grn-label text-[0.6rem] tracking-[0.4em] text-gulf-400">Paused</div>
            <div className="grn-display mt-1 text-4xl italic">
              PIT STOP <span className="grn-ar not-italic text-white/60">وقفة</span>
            </div>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                onClick={() => setPauseOpen(false)}
                className="grn-btn grn-btn-primary tap w-full px-6 py-3.5 text-base"
              >
                RESUME — <span className="grn-ar">كمّل</span>
              </button>
              <button
                onClick={() => {
                  setPauseOpen(false);
                  setGarage(loadGarage());
                  setGarageOpen(true);
                }}
                className="grn-btn grn-btn-ghost tap w-full px-6 py-3 text-sm"
              >
                GARAGE 🔧
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="grn-btn grn-btn-ghost tap w-full px-6 py-3 text-sm"
              >
                SETTINGS ⚙
              </button>
              <button
                onClick={exitToMenu}
                className="grn-btn tap w-full border border-rose-400/40 px-6 py-3 text-sm text-rose-300 hover:bg-rose-500/15"
              >
                EXIT TO MENU
              </button>
            </div>
            <p className="grn-label mt-4 text-[0.52rem] text-white/40">
              Esc / 🎮 Start to resume · progress is saved
            </p>
          </div>
        </div>
      )}

      {/* Loading — the engine build takes a beat on a phone */}
      {phase === "loading" && (
        <div className="safe-pad absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-b from-[#05070f] via-[#0a1226] to-[#05070f]">
          <div className="grn-label text-[0.6rem] tracking-[0.45em] text-gulf-400">
            Warming up
          </div>
          <div className="grn-display mt-2 text-[clamp(1.4rem,6vw,2.2rem)] italic">
            BUILDING THE CORNICHE
          </div>
          <div className="grn-ar mt-1 text-sm text-white/50">جاري تجهيز الشارع</div>
          <div className="grn-meter mt-5 h-2 w-[min(320px,70vw)]">
            <div className="h-full w-1/3 animate-pulse bg-gradient-to-r from-gulf-500 to-gulf-300" />
          </div>
          <div className="mt-6 w-[min(420px,80vw)] space-y-2">
            <div className="skeleton h-3 w-2/3" />
            <div className="skeleton h-3 w-1/2" />
          </div>
          <p className="mt-6 max-w-sm text-center text-[0.72rem] leading-5 text-white/40">
            Tip: flash your headlights three times behind a rival to start a
            battle — the trailing car loses SP.
          </p>
        </div>
      )}

      {/* Error — never leave a black screen unexplained */}
      {phase === "error" && (
        <div className="safe-pad absolute inset-0 z-30 flex items-center justify-center bg-night-950/95 px-6">
          <div className="grn-dialog w-[min(460px,92vw)] p-6 text-center">
            <div className="text-4xl">⚠️</div>
            <h2 className="grn-display mt-3 text-2xl">ENGINE WOULD NOT START</h2>
            <p className="mt-2 text-sm leading-6 text-white/65">
              The 3D renderer could not be created. This usually means WebGL is
              disabled or unavailable on this device.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                onClick={() => {
                  startingRef.current = false;
                  setPhase("menu");
                }}
                className="grn-btn grn-btn-ghost tap flex-1 px-5 py-3 text-sm"
              >
                BACK TO MENU
              </button>
              <button
                onClick={() => window.location.reload()}
                className="grn-btn grn-btn-primary tap flex-1 px-5 py-3 text-sm"
              >
                TRY AGAIN
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-race results sequence */}
      {result && settings && (
        <Results
          result={result}
          haptics={settings.haptics}
          onNext={() => {
            setResult(null);
            engineRef.current?.resumeAfterResult();
          }}
          onRetry={() => {
            setResult(null);
            engineRef.current?.setPaused(false);
            engineRef.current?.retryBattle();
          }}
          onGarage={() => {
            setResult(null);
            engineRef.current?.resumeAfterResult();
            setGarage(loadGarage());
            setGarageOpen(true);
          }}
        />
      )}

      {/* First-run onboarding */}
      {onboarding && (
        <Onboarding
          haptics={settings?.haptics ?? true}
          onDone={() => setOnboarding(false)}
        />
      )}
    </div>
  );
}
