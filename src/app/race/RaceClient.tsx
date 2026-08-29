"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DriverCard, GameEngine, HudData, RaceResult } from "@/game/engine";
import { playSfx, preloadSfx, setSfxVolume } from "@/game/sfx";
import Results from "./Results";
import Onboarding, { CoachHint, CoachState, hasOnboarded } from "./Onboarding";
import { ICONS, IconFlash, IconCrown, IconGear, IconFlagKW, type IconName } from "./Icons";
import Garage from "./Garage";
import KuwaitClock from "./KuwaitClock";
import RoadMapView from "./RoadMapView";
import type { RoadMap } from "@/game/roadmap";
import { gearAt } from "@/game/gears";
import { RIVALS, RivalDef } from "@/game/rivals";
import { HubClient, DuelInvite, loadProfile, saveProfile, formatLap } from "@/game/net";
import { RACE_DISTANCES, distanceById } from "@/game/distances";
import { cleanHandle, rollHandle } from "@/game/handles";
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
import { RESOLUTIONS, formatBuffer } from "@/game/render";
import { hudInset } from "@/game/aspect";
import { VIEWS, viewSpec } from "@/game/views";
import {
  EXCLUSIVE_CATS,
  Part,
  GarageState,
  CarBuild,
  editBuild,
  clampTint,
  loadGarage,
  saveGarage,
  sellCar,
  CARS,
  getCar,
  lockedBy,
  rivalsBeaten,
  WAGERS,
} from "@/game/mods";

/**
 * A racing number written on the rival's own paint.
 *
 * This is one of the few places in the interface where the background is
 * DATA — it is whatever colour that car's bodywork is — so neither the
 * ink nor the swatch can be a constant, and a swatch that ran from the
 * paint to near-black could not be fixed by choosing an ink at all:
 * white vanished at the light end (measured 1.47:1 on the silver cars)
 * and black vanished at the dark end. No single ink passes on a chip
 * that spans the whole luminance range, so the chip stops spanning it.
 *
 * The paint is pushed away from the middle until one ink clears 4.5:1
 * against BOTH ends of the gradient, and the gradient's second stop
 * stays in the same band so it still reads as paint rather than as a
 * flat colour chip. Bright paints go lighter and take black; everything
 * else goes darker and takes white.
 */
const INK_DARK = "#101014";
const INK_LIGHT = "#f6f6f2";

function lumOf(rgb: [number, number, number]): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(rgb[0] / 255) + 0.7152 * lin(rgb[1] / 255) + 0.0722 * lin(rgb[2] / 255);
}
const hex6 = (c: [number, number, number]) =>
  "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function plate(bodyColor: number): { background: string; color: string; textShadow: string } {
  const paint: [number, number, number] = [
    (bodyColor >> 16) & 255,
    (bodyColor >> 8) & 255,
    bodyColor & 255,
  ];
  const mix = (c: [number, number, number], t: number, to: number): [number, number, number] =>
    [c[0] + (to - c[0]) * t, c[1] + (to - c[1]) * t, c[2] + (to - c[2]) * t];
  // Where 4.5:1 lands against each ink, in relative luminance.
  const light = lumOf(paint) >= 0.2;
  const want = light ? 0.26 : 0.14;
  let top = paint;
  for (let i = 0; i < 12; i++) {
    const L = lumOf(top);
    if (light ? L >= want : L <= want) break;
    top = mix(top, 0.12, light ? 255 : 0);
  }
  // The second stop shades within the same band rather than crossing it.
  const bottom = light ? mix(top, 0.22, 0) : mix(top, 0.35, 0);
  return {
    background: `linear-gradient(140deg, ${hex6(top)}, ${hex6(bottom)})`,
    color: light ? INK_DARK : INK_LIGHT,
    textShadow: light ? "0 1px 2px rgba(255,255,255,0.45)" : "0 1px 3px rgba(0,0,0,0.85)",
  };
}

/**
 * The rev counter.
 *
 * The tach used to be a skewed gradient bar, which tells you a fraction
 * and nothing else. A driver does not read a fraction — they read where
 * the needle is against the red, and they read it without looking
 * away from the road, which is the whole reason instruments are round:
 * an angle is legible in peripheral vision and a bar length is not.
 *
 * So: a real dial, with the speed and the gear inside it the way a
 * modern cluster puts them. Drawn in SVG rather than canvas because it
 * is vector at any pixel ratio, needs no draw loop of its own, and the
 * only thing that changes per frame is one transform and a couple of
 * text nodes — which is why everything below is driven through refs.
 *
 * The scale is the ENGINE'S, not a constant. A 1.6 that spins to 8,400
 * and a 5.7 that stops at 6,200 get different dials, with the redline
 * where that engine's redline actually is.
 */
// Degrees clockwise from twelve o'clock. 234 is about seven o'clock and
// the 252-degree sweep ends at 126, about five — symmetric about the top
// with the gap at the bottom, which is where every rev counter puts it
// because the bottom of the dial is the part a driver's hand covers.
const TACH_START = 234;
const TACH_SWEEP = 252;

function tachAngle(frac: number): number {
  return TACH_START + TACH_SWEEP * Math.min(1, Math.max(0, frac));
}

/** A point on the dial, in the 100x100 viewBox. */
function tachPoint(frac: number, radius: number): [number, number] {
  const a = ((tachAngle(frac) - 90) * Math.PI) / 180;
  return [50 + Math.cos(a) * radius, 50 + Math.sin(a) * radius];
}

/** An SVG arc path along the dial between two fractions. */
function tachArc(from: number, to: number, radius: number): string {
  const [x0, y0] = tachPoint(from, radius);
  const [x1, y1] = tachPoint(to, radius);
  const large = TACH_SWEEP * (to - from) > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function RevCounter({
  needleRef,
  ringRef,
  ticksRef,
  redlineRef,
  rpmRef,
  speedRef,
  gearRef,
  size,
}: {
  needleRef: React.RefObject<SVGGElement | null>;
  ringRef: React.RefObject<SVGCircleElement | null>;
  ticksRef: React.RefObject<SVGGElement | null>;
  redlineRef: React.RefObject<SVGPathElement | null>;
  rpmRef: React.RefObject<HTMLSpanElement | null>;
  speedRef: React.RefObject<HTMLSpanElement | null>;
  gearRef: React.RefObject<HTMLSpanElement | null>;
  size: number;
}) {
  return (
    <div className="relative select-none" style={{ width: size, height: size }}>
      <svg data-tach="dial" viewBox="0 0 100 100" className="absolute inset-0 size-full overflow-visible">
        <defs>
          {/*
            An instrument is made of four surfaces and the light behaves
            differently on each. Drawn as one flat disc it reads as a
            diagram of a rev counter; these are what make it read as a
            thing sitting in a car.
          */}
          {/* The face: dished. Darkest in the middle where it is deepest,
              lifting toward the rim where it catches the cabin light. */}
          <radialGradient id="tach-face" cx="42%" cy="34%" r="78%">
            <stop offset="0%" stopColor="#232a34" stopOpacity="0.975" />
            <stop offset="55%" stopColor="#141a21" stopOpacity="0.985" />
            <stop offset="100%" stopColor="#070a0e" stopOpacity="0.995" />
          </radialGradient>
          {/* The bezel: a turned metal ring, bright where the light is
              above it and dark underneath. A single flat stroke here is
              the difference between a ring and a circle. */}
          <linearGradient id="tach-bezel" x1="30%" y1="0%" x2="70%" y2="100%">
            <stop offset="0%" stopColor="#8e97a4" />
            <stop offset="34%" stopColor="#464e59" />
            <stop offset="62%" stopColor="#1b2029" />
            <stop offset="100%" stopColor="#5b636f" />
          </linearGradient>
          {/* The glass: one soft sheen across the upper left, which is
              where a windscreen puts it on a real cluster. */}
          <linearGradient id="tach-glass" x1="12%" y1="0%" x2="72%" y2="86%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.15" />
            <stop offset="42%" stopColor="#ffffff" stopOpacity="0.035" />
            <stop offset="70%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          {/* The needle: hot at the tip, deeper at the root, the way a
              lit pointer looks against a dark face. */}
          <linearGradient id="tach-needle" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#ff8a5c" />
            <stop offset="45%" stopColor="#ff3b2f" />
            <stop offset="100%" stopColor="#b3160d" />
          </linearGradient>
          {/* Backlight. Warm, because the whole game is lit by sodium and
              an instrument lit any other colour would be the one cold
              thing on the screen. */}
          <radialGradient id="tach-glow" cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor="#f5a524" stopOpacity="0" />
            <stop offset="88%" stopColor="#f5a524" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#f5a524" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* The dish, then the warm ring of backlight behind the markings,
            then the bezel over the edge of both. */}
        <circle cx="50" cy="50" r="45" fill="url(#tach-face)" />
        <circle cx="50" cy="50" r="45" fill="url(#tach-glow)" />
        <circle
          cx="50" cy="50" r="45.2"
          fill="none" stroke="url(#tach-bezel)" strokeWidth="3.4"
        />
        {/* A thin dark line just inside it, which is the shadow the bezel
            throws onto the face and the reason the ring reads as raised. */}
        <circle cx="50" cy="50" r="43.2" fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="1.2" />

        {/* The scale ring the ticks stand on. Unlit first — this is the
            part of the sweep the needle has not reached. */}
        <path
          d={tachArc(0, 1, 40)}
          fill="none" stroke="rgba(214,226,240,0.16)" strokeWidth="2.6" strokeLinecap="butt"
        />
        {/* The redline, ON the ring rather than beside it, which is where
            a real one is: the last segment of the scale, in red. Its
            start is set per engine at runtime. */}
        <path
          ref={redlineRef}
          d={tachArc(0.88, 1, 40)}
          fill="none" stroke="#e01b0f" strokeWidth="2.6" strokeLinecap="butt"
        />
        {/* Ticks and numerals, laid out at runtime because how many there
            are depends on how far this engine spins. */}
        <g data-tach="ticks" ref={ticksRef} />
        {/* The unit, where every cluster puts it: under the hub, small.
            Static — it is the one thing on the face that does not depend
            on which engine is fitted, and putting it in the group above
            meant a test reading the numerals off the dial got "x1000
            r/min" back as one of them. */}
        {/* fontSize is in the viewBox's units, not pixels: 5 in a 100-unit
            box on a dial that renders about 160 CSS px wide came out at
            8 px on a phone, which is below the size at which a condensed
            face has counters left. */}
        <text
          x="50" y="79" textAnchor="middle"
          fontSize="7" fontWeight="700" letterSpacing="0.6"
          fill="rgba(243,220,180,0.8)"
        >
          x1000 r/min
        </text>

        {/* Shift light: the rim, not one more small thing to look at —
            but OUTSIDE the bezel and thin, so it reads as the
            instrument being lit rather than as the instrument being
            replaced by a red circle. Drawn over the bezel at full
            weight it hid the one part of the dial that says which way
            the light is coming from. */}
        <circle
          ref={ringRef}
          cx="50" cy="50" r="47.4"
          fill="none" stroke="#ff4438" strokeWidth="1.6"
          opacity="0"
          style={{ filter: "drop-shadow(0 0 5px rgba(255,68,56,0.9))" }}
        />

        {/* The needle. Tapered, with the counterweight tail a real one
            carries past the hub to balance it — leave that off and the
            pointer reads as an arrow drawn on the glass. */}
        <g data-tach="needle" ref={needleRef} style={{ transformOrigin: "50px 50px" }}>
          <path
            d="M 50 9 L 51.9 44 L 51.15 57.5 L 48.85 57.5 L 48.1 44 Z"
            fill="url(#tach-needle)"
          />
          {/* The hub: a machined dome, lit from the same side as the
              bezel so the whole instrument agrees about where the light
              is coming from. */}
          <circle cx="50" cy="50" r="5" fill="url(#tach-bezel)" />
          <circle cx="50" cy="50" r="3.4" fill="#0d1116" />
          <circle cx="49" cy="49" r="1.1" fill="rgba(255,255,255,0.22)" />
        </g>

        {/* Glass last, over everything, so the sheen sits on top of the
            needle the way it does on a real dial. */}
        <circle cx="50" cy="50" r="43" fill="url(#tach-glass)" style={{ pointerEvents: "none" }} />
      </svg>
      {/* The middle of the dial: what a cluster puts there. */}
      {/* The middle. Everything here has to clear the rpm labels, which
          sit on a 29.5 radius — so the speed is sized to fit inside
          that circle rather than to fill the dial. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          ref={speedRef}
          className="grn-display block italic leading-[0.78] tabular-nums text-[#e9edf1] [text-shadow:0_0_14px_rgba(56,201,238,0.25),0_3px_12px_rgba(0,0,0,0.9)]"
          style={{ fontSize: size * 0.205 }}
        >
          0
        </span>
        <span className="grn-label text-white/74" style={{ fontSize: size * 0.058, marginTop: size * 0.008 }}>
          km/h
        </span>
        <span
          className="flex items-baseline justify-center gap-[0.4em]"
          style={{ marginTop: size * 0.03 }}
        >
          <span
            ref={gearRef}
            className="grn-display italic leading-none text-sodium-400 [text-shadow:0_0_11px_rgba(245,165,36,0.35)]"
            style={{ fontSize: size * 0.125 }}
          >
            N
          </span>
          <span data-tach="rpm" ref={rpmRef} className="grn-label tabular-nums text-white/70" style={{ fontSize: size * 0.058 }}>
            0
          </span>
        </span>
      </div>
    </div>
  );
}

type Phase = "menu" | "loading" | "playing" | "champion" | "error";

/**
 * The car on the turntable, named for the footer.
 *
 * Only from the state, never from storage. The `?? loadGarage()` this
 * used to have looked like a harmless fallback and was a hydration bug:
 * the server has no localStorage so it rendered nothing, the browser
 * read the save on its very first render and put a name there, and React
 * threw a mismatch warning at every returning player. The state is
 * loaded in an effect a tick later; until then this is empty, which is
 * exactly what the server said.
 */
function carName(g: GarageState | null): string {
  if (!g) return "";
  try {
    return getCar(g.car).name;
  } catch {
    return "";
  }
}

/**
 * What the game is actually putting on the screen, right now.
 *
 * Read off the canvas, not off the setting. The setting is the request;
 * this is the answer, and the two are different often enough to matter —
 * the window is smaller than the panel unless you are in fullscreen, the
 * GL stack has a ceiling on how big a buffer it will hand out, and a
 * ratio lands on whole pixels only after a floor. A resolution setting
 * that shows you what you asked for rather than what you got is a
 * resolution setting you cannot check.
 */
function readRenderInfo(): {
  buffer: [number, number];
  css: [number, number];
  display: [number, number];
  fullscreen: boolean;
} | null {
  if (typeof document === "undefined") return null;
  const live = ([...document.querySelectorAll("canvas")] as HTMLCanvasElement[])
    .filter((c) => c.width > 0 && c.clientWidth > 0)
    // The biggest live buffer on the page is the one being looked at:
    // the race canvas while racing, the intro canvas on the menu.
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!live) return null;
  const dpr = window.devicePixelRatio || 1;
  return {
    buffer: [live.width, live.height],
    css: [live.clientWidth, live.clientHeight],
    display: [Math.round(screen.width * dpr), Math.round(screen.height * dpr)],
    fullscreen: !!document.fullscreenElement,
  };
}

/** Which stage the menu builds. "rolling" for players; a capture tool
 *  sets the key to get the turntable back. */
function attractMode(): "rolling" | "turntable" {
  try {
    return localStorage.getItem("gulf-road-nights-attract") === "turntable"
      ? "turntable"
      : "rolling";
  } catch {
    return "rolling";
  }
}

/** Rivals defeated so far, as the engine saves it. This file used to
 *  spell the storage key out for itself, which made three copies of it
 *  across the codebase; mods.ts holds it now. */
function readBeaten(): number {
  return Math.min(RIVALS.length, rivalsBeaten());
}

interface FeedMsg {
  name: string;
  text: string;
  key: number;
}

/** Draw the flag when we have artwork for it; otherwise show whatever
 *  the data carried, so a roster that grows a new nationality degrades
 *  to the old behaviour rather than to nothing. */
function Flag({ code }: { code?: string }) {
  if (code === "\u{1F1F0}\u{1F1FC}") {
    return <IconFlagKW size={13} className="inline-block align-[-0.1em]" />;
  }
  return <>{code}</>;
}

/** The two roads' colours. The same pair RoadMapView uses — a corner map
 *  and a full map that disagree about which road is which are two maps. */
const MAP_LEG_COLOR = ["#38c9ee", "#f5a524"];

/**
 * A distance on the HUD, in the unit a driver reads it in.
 *
 * Kilometres past a thousand metres. "Rival 4245 m behind" is four
 * digits that have to be counted before they mean anything; "4.2 km
 * behind" is read at a glance, which is the only way anything on this
 * screen gets read at all. Metres below that, because a hundred metres
 * is a distance you are about to cover and a tenth of a kilometre is not
 * a number anybody thinks in.
 *
 * Rounded to ten metres under the kilometre for the same reason the
 * street-sign distance already was: a units digit changing sixty times a
 * second is noise, and a number that never sits still is harder to read
 * at 200 km/h than one that steps.
 */
function metresLabel(m: number): string {
  const v = Math.max(0, Math.round(m));
  return v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v / 10) * 10} m`;
}

export default function RaceClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const mapPathRef = useRef<Array<[number, number]>>([]);
  /** The same legs and marks the full map draws. The corner map had the
   *  outline and nothing else: two roads in one colour, no start line, no
   *  pump, and a dot for a car that is pointing somewhere. */
  const mapLegsRef = useRef<Array<{ from: number; to: number }>>([]);
  const mapMarksRef = useRef<Array<{ x: number; y: number; kind: string }>>([]);
  /** The whole road, built once by the engine. Null until it starts. */
  const [roadMap, setRoadMap] = useState<RoadMap | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  /** The per-frame half of the map, kept on a ref rather than in state:
   *  the full map redraws at the display's rate and a setState per frame
   *  would re-render the overlay with it. */
  const hudMapRef = useRef<HudData["map"] | null>(null);

  const speedRef = useRef<HTMLSpanElement>(null);
  const gearRef = useRef<HTMLSpanElement>(null);
  // The rev counter's moving parts. Refs rather than state: this is
  // sixty updates a second and React has no business in that loop.
  const needleRef = useRef<SVGGElement>(null);
  const shiftRingRef = useRef<SVGCircleElement>(null);
  const ticksRef = useRef<SVGGElement>(null);
  const redlineRef = useRef<SVGPathElement>(null);
  const rpmTextRef = useRef<HTMLSpanElement>(null);
  /** The redline the ticks were last laid out for — an engine swap in
   *  the garage changes the dial, and nothing else does. */
  const dialFor = useRef(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const roadRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLDivElement>(null);
  const rivalInfoRef = useRef<HTMLDivElement>(null);
  const battleRef = useRef<HTMLDivElement>(null);
  const playerBarRef = useRef<HTMLDivElement>(null);
  const rivalBarRef = useRef<HTMLDivElement>(null);
  const battleNameRef = useRef<HTMLDivElement>(null);
  const raceLeftRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>("menu");

  // HUD scale rides the viewport: authored against a ~1500x850 layout,
  // it enlarges on 1080p/4K screens instead of shrinking into the corner
  // of a big panel, and gives back a little on small windows. CSS zoom
  // (not transform) so corner-anchored absolutes keep their anchors.
  const [hudZoom, setHudZoom] = useState(1);
  /** How far in from each edge the HUD anchors — see aspect.ts. Zero on
   *  anything 21:9 or narrower, which is every screen but a few. */
  const [hudInsetX, setHudInsetX] = useState(0);
  const [isFs, setIsFs] = useState(false);
  /** The buffer the game is drawing into, as read off the canvas. */
  const [renderInfo, setRenderInfo] = useState<ReturnType<typeof readRenderInfo>>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const compute = () => {
      const z = Math.min(
        2.5,
        Math.max(0.8, Math.min(window.innerWidth / 1500, window.innerHeight / 850))
      );
      setHudZoom(z);
      // Divided by the zoom, because this lands inside a subtree that
      // CSS `zoom` has already scaled — an inset in raw viewport pixels
      // would be multiplied by it and overshoot.
      setHudInsetX(hudInset(window.innerWidth, window.innerHeight) / z);
    };
    compute();
    setRenderInfo(readRenderInfo());
    const onResize = () => {
      compute();
      // A beat behind the layout: the renderer resizes on its own
      // listener, and reading the canvas in the same tick reads the
      // buffer it is about to replace.
      setTimeout(() => setRenderInfo(readRenderInfo()), 60);
    };
    window.addEventListener("resize", onResize);
    const onFs = () => {
      setIsFs(!!document.fullscreenElement);
      setRenderInfo(readRenderInfo());
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  }, []);
  const [message, setMessage] = useState<{ title: string; sub?: string } | null>(null);
  const [vsRival, setVsRival] = useState<RivalDef | null>(null);
  const [challenge, setChallenge] = useState<{
    player: DriverCard;
    rival: DriverCard;
    maxWager: number;
    /** The length this rival calls you out at — marked "theirs" on the
     *  chooser, and what the card opens on. */
    rivalDistance: string;
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
  const [cine, setCine] = useState<{ card: DriverCard; you?: DriverCard; stake: number } | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const driftRef = useRef<HTMLDivElement>(null);
  const driftTextRef = useRef<HTMLSpanElement>(null);
  const driftBarRef = useRef<HTMLElement>(null);
  const pipsRef = useRef<HTMLSpanElement>(null);
  const brakeRef = useRef<HTMLDivElement>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [coach, setCoach] = useState<CoachState | null>(null);
  /** Somebody is close enough to read, and the card if it is open. */
  const [canSizeUp, setCanSizeUp] = useState(false);
  const sizeUpRef = useRef(false);
  const [dossier, setDossier] = useState<import("@/game/engine").RivalDossier | null>(null);
  const coachRef = useRef<CoachState | null>(null);
  const [career, setCareer] = useState<Profile | null>(null);
  const [beaten, setBeaten] = useState(0);
  const [creditsOpen, setCreditsOpen] = useState(false);
  // Main menu: which item the keyboard is on, and the turntable behind it
  const [menuSel, setMenuSel] = useState(0);
  const attractRef = useRef<HTMLCanvasElement>(null);
  const attractScene = useRef<import("@/game/attract").AttractHandle | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boostWrapRef = useRef<HTMLDivElement>(null);
  const boostRef = useRef<HTMLDivElement>(null);
  const towWrapRef = useRef<HTMLDivElement>(null);
  const towRef = useRef<HTMLDivElement>(null);
  const nosWrapRef = useRef<HTMLDivElement>(null);
  const nosRef = useRef<HTMLDivElement>(null);
  const nosTrackRef = useRef<HTMLDivElement>(null);
  const nosPctRef = useRef<HTMLSpanElement>(null);
  const fuelTrackRef = useRef<HTMLDivElement>(null);
  const fuelRef = useRef<HTMLDivElement>(null);
  const fuelLabelRef = useRef<HTMLSpanElement>(null);
  const pumpRef = useRef<HTMLDivElement>(null);
  // The online run strip. Driven off the frame like the rest of the HUD
  // — through refs rather than state, because a progress bar that moves
  // every frame must not re-render the page every frame.
  const runBoxRef = useRef<HTMLDivElement>(null);
  const runNameRef = useRef<HTMLDivElement>(null);
  const runHintRef = useRef<HTMLDivElement>(null);
  const runLabelRef = useRef<HTMLSpanElement>(null);
  const runBarRef = useRef<HTMLDivElement>(null);

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
      if (k === "cameraView") engineRef.current?.setView(next.cameraView);
      if (k === "resolution") {
        engineRef.current?.setResolution(next.resolution);
        // The menu reads the ladder on resize rather than at build time,
        // so this is all it takes to keep the intro behind the settings
        // screen at the same resolution as the race in front of it.
        attractScene.current?.resize();
        setRenderInfo(readRenderInfo());
      }
      if (k === "sky") engineRef.current?.setSky(next.sky);
      if (k === "frameCap") engineRef.current?.setFrameCap(next.frameCap);
      if (k === "exposure" || k === "autoExposure")
        engineRef.current?.setExposure(next.exposure, next.autoExposure);
      if (k === "brightness") engineRef.current?.setBrightness(next.brightness);
      if (k === "contrast") engineRef.current?.setContrast(next.contrast);
      if (k === "highlights") engineRef.current?.setHighlights(next.highlights);
      if (k === "saturation") engineRef.current?.setSaturation(next.saturation);
      playSfx("ui-tap", 0.6);
      return next;
    });
  }, []);

  // The showroom's rules, where the showroom is. The engine publishes
  // its own internals for the same reason: a greyed-out button is what
  // the player sees, and this is what actually decides — a test that can
  // only read the button cannot tell the difference between a rule and a
  // disabled attribute.
  useEffect(() => {
    const w = window as unknown as {
      __grnShowroom?: { lockedBy(id: string): number; beaten(): number };
    };
    w.__grnShowroom = {
      lockedBy: (id: string) => lockedBy(getCar(id)),
      beaten: rivalsBeaten,
    };
    return () => {
      delete w.__grnShowroom;
    };
  }, []);

  const buyOrDrive = useCallback((carId: string) => {
    const g = loadGarage();
    const car = getCar(carId);
    if (!g.cars.includes(carId)) {
      // Money is not the only gate any more. The showroom greys the
      // locked car out, but the button is not the rule — this is.
      if (lockedBy(car) > 0) return;
      if (g.kd < car.price) return;
      g.kd -= car.price;
      g.cars.push(carId);
      // Write the build the car is delivered with into the save, rather
      // than leaving it to be reconstructed on every read. It matters
      // for exactly one machine — the GTR arrives with twelve parts
      // fitted — and a save that does not record what was handed over
      // is a save that cannot be looked at to find out.
      editBuild(g, carId);
    }
    g.car = carId; // buying it also puts you behind the wheel
    saveGarage(g);
    setGarage(g);
  }, []);

  // The other half of the dealership. The rules live in sellCar — the
  // last car cannot go, the seat moves if it was under you — so this is
  // only plumbing: mutate, save, re-render.
  const onSellCar = useCallback((carId: string) => {
    const g = loadGarage();
    const r = sellCar(g, carId);
    if (!r.ok) return;
    saveGarage(g);
    setGarage(g);
  }, []);

  // Parts are bought for the car on the ramp, not for the player.
  const buyOrEquip = useCallback((p: Part, carId?: string) => {
    const g = loadGarage();
    const build = editBuild(g, carId ?? g.car);
    const owned = build.owned.includes(p.id);
    const exclusive = EXCLUSIVE_CATS.has(p.cat);
    if (!owned) {
      if (g.kd < p.price) return;
      g.kd -= p.price;
      build.owned.push(p.id);
      if (exclusive) build.equipped[p.cat as keyof CarBuild["equipped"]] = p.id;
    } else if (exclusive) {
      const key = p.cat as keyof CarBuild["equipped"];
      // Tap the equipped part again to run stock in that slot
      if (build.equipped[key] === p.id) delete build.equipped[key];
      else build.equipped[key] = p.id;
    }
    saveGarage(g);
    setGarage(g);
  }, []);

  /** Window tint for one car. Free, so it skips the price check
   *  entirely — and clamped on the way in, because a slider is a UI and
   *  a save is forever. */
  const setTint = useCallback((carId: string, pct: number) => {
    const g = loadGarage();
    editBuild(g, carId).tint = clampTint(pct);
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
  /** The length of the race being set up. Opens on the rival's own — see
   *  RivalDef.distance — and the player is free to change it. */
  const [raceDistance, setRaceDistance] = useState("standard");
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
    // The route is drawn INSIDE the panel, not across it.
    //
    // It used to be laid straight onto 0..1 of the buffer, so the loop
    // ran off all four edges and the caption underneath it crossed the
    // road at the bottom of the box — the line and the words fighting
    // over the same pixels, which is the whole reason the map read as
    // unfinished. Reserving a margin, and more of it at the foot where
    // the caption sits, costs a few per cent of the route and buys a
    // gadget that looks made rather than dumped.
    const PAD = 0.1;
    const FOOT = 0.2; // room for "tap to open"
    const X = (x: number) => (PAD + x * (1 - PAD * 2)) * w;
    const Y = (y: number) => (PAD + y * (1 - PAD - FOOT)) * h;
    const path = () => {
      ctx.beginPath();
      mapPathRef.current.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(X(x), Y(y));
        else ctx.lineTo(X(x), Y(y));
      });
      ctx.closePath();
    };
    // The same two roads, in the same two colours the full map uses.
    //
    // This drew one closed stroke in one colour, which is the shape of
    // the lap and nothing else about it. The corniche and the ring are
    // different roads with different names on the signs, and the corner
    // map is the one a driver actually looks at — telling them apart at
    // a glance is the single most useful thing a map of a two-road lap
    // can do, and the full map has been doing it while the minimap next
    // to it said the road was one thing.
    //
    // A road, not a wire: a dark casing with a lit core on top of it is
    // how every map in the world draws one, and it is what stops the
    // line disappearing wherever the panel behind it happens to be pale.
    // Marks scale with the buffer, which is outsized vs the CSS box —
    // hardcoded pixel widths would come out hairline-thin.
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const legs = mapLegsRef.current.length
      ? mapLegsRef.current
      : [{ from: 0, to: mapPathRef.current.length - 1 }];
    const legStroke = (from: number, to: number) => {
      ctx.beginPath();
      for (let k = from; k <= to && k < mapPathRef.current.length; k++) {
        const [x, y] = mapPathRef.current[k];
        if (k === from) ctx.moveTo(X(x), Y(y));
        else ctx.lineTo(X(x), Y(y));
      }
    };
    for (let i = 0; i < legs.length; i++) {
      legStroke(legs[i].from, legs[i].to);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = w / 34;
      ctx.stroke();
    }
    for (let i = 0; i < legs.length; i++) {
      legStroke(legs[i].from, legs[i].to);
      ctx.strokeStyle = MAP_LEG_COLOR[i % MAP_LEG_COLOR.length];
      ctx.lineWidth = w / 75;
      ctx.stroke();
    }

    // Markers get a casing too, for the same reason: a bare dot on a
    // pale stretch of route is a dot you have to hunt for.
    const mark = (x: number, y: number, fill: string, r: number) => {
      ctx.beginPath();
      ctx.arc(X(x), Y(y), r * w, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = w / 90;
      ctx.strokeStyle = "rgba(6,7,9,0.9)";
      ctx.stroke();
    };
    // The start line and every pump, which the tank makes the one piece
    // of routing this game needs.
    for (const mk of mapMarksRef.current) {
      mark(mk.x, mk.y, mk.kind === "station" ? "#4ade80" : "#f5f5f5", 0.02);
    }
    if (d.map.rx >= 0) mark(d.map.rx, d.map.ry, "#ff4d4d", 0.028);
    // You: an arrow, pointing the way the car is pointing.
    //
    // The engine has computed `facing` in map space every frame since
    // the map was written and nothing drew it. A dot on a loop cannot
    // tell you which way round you are going, which is the first
    // question anybody asks of a map of a circuit — and the projection
    // is a rigid scale, so the road's tangent IS the map's tangent and
    // the arrow needs no correction.
    {
      const cx = X(d.map.px);
      const cy = Y(d.map.py);
      const r = w * 0.05;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(d.map.facing);
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.62, r * 0.6);
      ctx.lineTo(-r * 0.3, 0);
      ctx.lineTo(-r * 0.62, -r * 0.6);
      ctx.closePath();
      ctx.fillStyle = "#eaf6ff";
      ctx.fill();
      ctx.lineWidth = w / 90;
      ctx.strokeStyle = "rgba(6,7,9,0.9)";
      ctx.stroke();
      ctx.restore();
    }
  }, []);

  const onHud = useCallback(
    (d: HudData) => {
      hudMapRef.current = d.map;
      if (speedRef.current) speedRef.current.textContent = String(Math.round(d.speedKmh));
      // The rev counter, off the engine's own needle rather than worked
      // back out of the speed: at a standing launch the gearbox function
      // says zero while the engine is at its torque peak.
      const t = d.tach;
      if (gearRef.current) gearRef.current.textContent = t.gear === 0 ? "N" : String(t.gear);
      if (rpmTextRef.current)
        rpmTextRef.current.textContent = `${(t.rpm / 1000).toFixed(1)}k`;
      if (needleRef.current)
        needleRef.current.style.transform = `rotate(${tachAngle(t.frac).toFixed(2)}deg)`;
      if (shiftRingRef.current)
        shiftRingRef.current.style.opacity = t.shift ? "0.9" : "0";
      // Lay the dial out once per engine. The scale is the engine's own,
      // so a swap in the garage rebuilds it and nothing else does.
      if (ticksRef.current && dialFor.current !== t.redline) {
        dialFor.current = t.redline;
        const svgns = "http://www.w3.org/2000/svg";
        const g2 = ticksRef.current;
        while (g2.firstChild) g2.removeChild(g2.firstChild);
        const redFrom = (t.redline * 0.895 - t.idle) / (t.redline - t.idle);
        const REDLINE = t.redline * 0.895;
        if (redlineRef.current)
          redlineRef.current.setAttribute("d", tachArc(Math.max(0, redFrom), 1, 40));
        const line = (from: number, to: number, f: number, w: string, c: string) => {
          const [x0, y0] = tachPoint(f, from);
          const [x1, y1] = tachPoint(f, to);
          const el = document.createElementNS(svgns, "line");
          el.setAttribute("x1", x0.toFixed(2));
          el.setAttribute("y1", y0.toFixed(2));
          el.setAttribute("x2", x1.toFixed(2));
          el.setAttribute("y2", y1.toFixed(2));
          el.setAttribute("stroke", c);
          el.setAttribute("stroke-width", w);
          el.setAttribute("stroke-linecap", "butt");
          g2.appendChild(el);
        };
        // Minor ticks every 250 rpm.
        //
        // The single biggest thing that was missing. A dial with only
        // the thousands on it is a diagram of an instrument; a real one
        // has three or four small marks between every numbered one, and
        // they are what the eye reads the needle's POSITION against
        // between the numbers. They are also most of the visual density
        // — without them the face is empty and the numbers float.
        const span = t.redline - t.idle;
        for (let rpm = Math.ceil(t.idle / 250) * 250; rpm <= t.redline; rpm += 250) {
          if (rpm % 1000 === 0) continue; // the majors are drawn below
          const f = (rpm - t.idle) / span;
          const red = rpm >= REDLINE;
          const half = rpm % 500 === 0; // a longer one at the halves
          line(
            37.2,
            half ? 34.2 : 35.4,
            f,
            half ? "0.85" : "0.6",
            red ? "rgba(255,120,110,0.85)" : "rgba(226,236,248,0.5)"
          );
        }
        // One major per thousand, with its numeral. Where the numbers
        // stop is where this engine stops, which is the point of the
        // dial being the engine's rather than a constant.
        for (let rpm = Math.ceil(t.idle / 1000) * 1000; rpm <= t.redline; rpm += 1000) {
          const f = (rpm - t.idle) / span;
          const red = rpm >= REDLINE;
          line(37.6, 31.8, f, "1.7", red ? "#ff8078" : "rgba(240,247,255,0.92)");
          const [tx, ty] = tachPoint(f, 26.5);
          const label = document.createElementNS(svgns, "text");
          label.setAttribute("x", tx.toFixed(2));
          label.setAttribute("y", (ty + 2.5).toFixed(2));
          label.setAttribute("text-anchor", "middle");
          label.setAttribute("font-size", "8.6");
          label.setAttribute("font-weight", "700");
          // Warm, like the backlight behind them: on a real cluster the
          // numerals are lit by the same lamps as the face and pick up
          // its colour.
          label.setAttribute("fill", red ? "#ff9086" : "#f3dcb4");
          label.textContent = String(rpm / 1000);
          g2.appendChild(label);
        }
      }
      if (roadRef.current) {
        // Two spans for the same reason the district below uses two:
        // the Latin display face carries no Arabic, so a mixed
        // textContent falls back glyph by glyph and loses both.
        //
        // A nickname replaces the name where there is one. شارع الحب is
        // not on any sign and is what everyone calls that stretch, so
        // showing "Second Ring Road" there would be technically right
        // and useless — the point of a name on a HUD is that it matches
        // what a player would say out loud.
        const [rLatin, rArabic] = roadRef.current.children as unknown as HTMLElement[];
        if (rLatin && rArabic) {
          rLatin.textContent = d.roadNick ?? d.roadName;
          rArabic.textContent = d.roadNickArabic ?? d.roadArabic;
        }
      }
      if (nextRef.current) {
        const [tag, nLatin, nArabic, dist] = nextRef.current
          .children as unknown as HTMLElement[];
        if (tag && nLatin && nArabic && dist) {
          if (tag.textContent !== "NEXT") tag.textContent = "NEXT";
          if (nLatin.textContent !== d.nextArea) nLatin.textContent = d.nextArea;
          if (nArabic.textContent !== d.nextArabic) nArabic.textContent = d.nextArabic;
          // Rounded to ten metres, and that is a legibility decision
          // rather than laziness: a units digit changing sixty times a
          // second is noise, and a number that never sits still is
          // harder to read at 200 km/h than one that steps.
          const label = metresLabel(d.nextInM);
          if (dist.textContent !== label) dist.textContent = label;
        }
      }
      if (areaRef.current) {
        // Two spans, not one string: the Latin display face carries no
        // Arabic, so a mixed textContent falls back glyph by glyph and
        // loses both the chosen face and the Arabic typography rules.
        const [latin, arabic] = areaRef.current.children as unknown as HTMLElement[];
        if (latin && arabic) {
          latin.textContent = d.areaName;
          arabic.textContent = d.areaArabic;
        } else {
          areaRef.current.textContent = `${d.areaName} · ${d.areaArabic}`;
        }
      }
      if (progressRef.current)
        progressRef.current.textContent = `Rivals beaten: ${d.defeated} / ${d.total}`;

      if (clockRef.current) {
        const [time, state] = clockRef.current.children as unknown as HTMLElement[];
        const h = Math.floor(d.hour);
        const m = Math.floor((d.hour - h) * 60);
        const stamp = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        if (time && time.textContent !== stamp) time.textContent = stamp;
        if (state) {
          const label = d.racingOpen ? "RACING" : "ROLLING";
          if (state.textContent !== label) {
            state.textContent = label;
            state.className = `rounded-sm px-1.5 py-px text-[0.7rem] ${
              d.racingOpen
                ? "bg-sodium-500/25 text-sodium-400"
                : "bg-white/10 text-white/55"
            }`;
          }
        }
      }

      if (rivalInfoRef.current) {
        if (d.battle === null && d.rivalDist !== null) {
          const dist = Math.round(d.rivalDist);
          rivalInfoRef.current.textContent =
            dist >= 0
              ? `Rival ${metresLabel(dist)} ahead`
              : `Rival ${metresLabel(-dist)} behind`;
          rivalInfoRef.current.style.opacity = "1";
        } else {
          rivalInfoRef.current.style.opacity = "0";
        }
      }
      // visibility, not opacity: animate-pulse animates opacity and would
      // override an inline opacity toggle
      if (flashRef.current) {
        flashRef.current.style.visibility = d.canFlash ? "visible" : "hidden";
        // Three drawn pips fill as the flashes land. This was "○○○"
        // becoming "●●○" — typography standing in for a control, which
        // renders at whatever weight the text font felt like.
        const pips = pipsRef.current?.children;
        if (pips) {
          for (let i = 0; i < pips.length; i++) {
            (pips[i] as HTMLElement).classList.toggle("on", i < d.flashCount);
          }
        }
      }

      // Drift readout: angle while sliding, banked score lingering after
      if (driftRef.current) {
        if (d.drift) {
          driftRef.current.style.opacity = "1";
          // The multiplier only appears once it is above one — a "×1"
          // glued to every slide is decoration, not information.
          const chain = d.drift.chain > 1 ? ` ×${d.drift.chain}` : "";
          if (driftTextRef.current) {
            driftTextRef.current.textContent = d.drift.spinning
              ? `SPUN OUT ${d.drift.deg}°`
              : d.drift.active
                ? `DRIFT ${d.drift.deg}°${chain}`
                : `DRIFT +${Math.round(d.drift.score)}${chain}`;
          }
          // A drawn bar rather than a run of pipe characters. The scale
          // is the same fourteen steps it always was; it is just no
          // longer being spelled out in punctuation.
          if (driftBarRef.current) {
            const steps = d.drift.active
              ? Math.min(14, 1 + ((d.drift.score / 60) | 0))
              : 0;
            driftBarRef.current.style.width = `${(steps / 14) * 100}%`;
            driftBarRef.current.parentElement!.style.opacity =
              d.drift.active && !d.drift.spinning ? "1" : "0";
          }
          driftRef.current.style.color = d.drift.spinning
            ? "#ff7b7b"
            : d.drift.active
              ? d.drift.deg > 26
                ? "#ffc45c"
                : "#7fe3ff"
              : "#a7f3d0";
        } else {
          driftRef.current.style.opacity = "0";
        }
      }

      // Brakes speak up only when something is wrong or working hard.
      // A gauge that is always lit is a gauge nobody reads.
      if (brakeRef.current) {
        const b = d.brakes;
        const msg =
          b.lock > 0.35
            ? "WHEELS LOCKED"
            : b.fade > 0.12
              ? `BRAKE FADE ${Math.round(b.fade * 100)}%`
              : b.abs
                ? "ABS"
                : "";
        brakeRef.current.textContent = msg;
        brakeRef.current.style.opacity = msg ? "1" : "0";
        brakeRef.current.style.color =
          b.lock > 0.35 ? "#ff7b7b" : b.fade > 0.12 ? "#ffc45c" : "#7fe3ff";
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
            d.duel.gap >= 0
              ? `${metresLabel(d.duel.gap)} ahead`
              : `${metresLabel(-d.duel.gap)} behind`
          }`;
      }

      // The run in front of you, while there is somebody to do it with.
      // Offline it is hidden rather than greyed out: every one of these
      // needs another player, so showing them to a solo driver is only
      // telling them what they cannot have.
      {
        const box = runBoxRef.current;
        if (box) {
          const show = !!d.run && !!hubRef.current?.connected && !d.duel;
          box.style.display = show ? "block" : "none";
          if (show && d.run) {
            if (runNameRef.current && runNameRef.current.dataset.run !== d.run.name) {
              runNameRef.current.dataset.run = d.run.name;
              runNameRef.current.textContent = d.run.name;
              if (runHintRef.current) runHintRef.current.textContent = d.run.hint;
            }
            if (runLabelRef.current) runLabelRef.current.textContent = d.run.label;
            if (runBarRef.current)
              runBarRef.current.style.width = `${(d.run.frac * 100).toFixed(1)}%`;
          }
        }
      }

      // The tow, above the garage gauges — it belongs to the road rather
      // than to the car, and it is the only one of the three that
      // appears and disappears on its own. The threshold is a tenth so a
      // car drifting past at the far edge of a wake does not flick the
      // bar on for a frame.
      if (towWrapRef.current)
        towWrapRef.current.style.display = d.tow > 0.1 ? "flex" : "none";
      if (towRef.current && d.tow > 0.1)
        towRef.current.style.width = `${Math.round(d.tow * 100)}%`;

      // Garage gauges: turbo boost + NOS charge (hidden without the mods)
      if (boostWrapRef.current)
        boostWrapRef.current.style.display = d.boost === null ? "none" : "flex";
      if (boostRef.current && d.boost !== null)
        boostRef.current.style.width = `${Math.round(d.boost * 100)}%`;
      if (nosWrapRef.current) nosWrapRef.current.style.display = d.nos === null ? "none" : "flex";
      if (d.nos !== null) {
        const pct = Math.round(d.nos.charge * 100);
        // Sub-1% is not "0%" while the bottle can still fire, and it is
        // not "1%" once it cannot: the readout and the colour have to
        // agree with the button, not with each other.
        if (nosRef.current) nosRef.current.style.width = `${d.nos.charge * 100}%`;
        if (nosTrackRef.current)
          nosTrackRef.current.dataset.state = d.nos.firing
            ? "firing"
            : d.nos.ready
              ? "charged"
              : "spent";
        if (nosPctRef.current) {
          const label = d.nos.ready ? `${Math.max(1, pct)}%` : "EMPTY";
          if (nosPctRef.current.textContent !== label) nosPctRef.current.textContent = label;
        }
      }

      // Fuel. Litres, not a percentage: a quarter of a tank means
      // something different in the pickup and the hatchback, and the
      // number the driver needs is how far they can go — which is
      // litres, against a capacity they can see next to it.
      {
        const f = d.fuel;
        const frac = f.capacity > 0 ? f.litres / f.capacity : 0;
        if (fuelRef.current) fuelRef.current.style.width = `${frac * 100}%`;
        if (fuelTrackRef.current) {
          fuelTrackRef.current.dataset.state = d.pump?.filling
            ? "filling"
            : f.dry
              ? "dry"
              : frac < 0.25
                ? "low"
                : "ok";
        }
        if (fuelLabelRef.current) {
          const label = f.dry ? "DRY" : `${f.litres.toFixed(1)} / ${Math.round(f.capacity)} L`;
          if (fuelLabelRef.current.textContent !== label) {
            fuelLabelRef.current.textContent = label;
          }
          fuelLabelRef.current.classList.toggle("fuel-warn", f.dry);
        }
        if (pumpRef.current) {
          const on = d.pump !== null;
          pumpRef.current.style.opacity = on ? "1" : "0";
          if (on && d.pump) {
            const msg = d.pump.filling
              ? `FILLING · ${d.pump.litres.toFixed(0)} L`
              : d.pump.costKd > 0.01
                ? `STOP TO FILL · ${d.pump.costKd.toFixed(2)} KD`
                : "TANK FULL";
            if (pumpRef.current.textContent !== msg) pumpRef.current.textContent = msg;
          }
        }
      }

      if (battleRef.current && !d.duel) {
        battleRef.current.style.opacity = d.battle ? "1" : "0";
        if (d.battle) {
          if (playerBarRef.current) playerBarRef.current.style.width = `${d.battle.playerSp}%`;
          if (rivalBarRef.current) rivalBarRef.current.style.width = `${d.battle.rivalSp}%`;
          if (battleNameRef.current)
            battleNameRef.current.textContent = `${d.battle.rivalName} ${d.battle.rivalArabic} · ${d.battle.rivalCrew}`;
          // How much of the race is left.
          //
          // The SP bars say who is winning; this says how long they have
          // to keep it up. Without it the race simply stops one day, and
          // a race that ends for a reason the player was never shown
          // reads as a bug rather than as a finish line.
          //
          // Whole metres under a kilometre, one decimal above: "300 m"
          // is a number you can act on and "0.3 km" is not.
          if (raceLeftRef.current) {
            const left = d.battle.leftKm;
            raceLeftRef.current.textContent =
              left < 1 ? `${Math.round(left * 1000)} m left` : `${left.toFixed(1)} km left`;
            // The last half kilometre is the part that decides it.
            raceLeftRef.current.style.color =
              left < 0.5 ? "var(--color-sodium-400)" : "rgba(255,255,255,0.6)";
          }
        }
      }
      coachRef.current = {
        speedKmh: d.speedKmh,
        rivalDist: d.rivalDist ?? 0,
        inBattle: d.battle !== null,
      };
      // The prompt is a React state change, so it is only written when
      // the answer actually flips — the HUD feed runs every frame.
      if (d.canSizeUp !== sizeUpRef.current) {
        sizeUpRef.current = d.canSizeUp;
        setCanSizeUp(d.canSizeUp);
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
        onChallenge: (player, rival, maxWager, distanceId) => {
          setRaceDistance(distanceById(distanceId).id);
          haptic(HAPTIC.challenge, loadSettings().haptics);
          if (challengeTimer.current) clearTimeout(challengeTimer.current);
          const g = loadGarage();
          setRaceCar(g.car);
          setWager(WAGERS.filter((w) => w <= maxWager).slice(-1)[0] ?? 0);
          setChallenge({
            player, rival, maxWager,
            rivalDistance: distanceById(distanceId).id,
            answer: null, sent: false,
          });
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
        onRunDone: (q) => {
          // Paid here rather than in the engine, because the wallet is
          // the UI's — the engine has never written to it and should not
          // start. See quests.ts on why the numbers are small.
          const g = loadGarage();
          g.kd = Math.max(0, g.kd + q.reward);
          saveGarage(g);
          setGarage(g);
          haptic(HAPTIC.reward, loadSettings().haptics);
          showMessage(`${q.name} — ${q.reward} KD`, q.ar);
        },
      onCinematic: (active, rival, stake, you) => {
        setCine(active ? { card: rival, you, stake } : null);
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
      {
        const rm = engine.getRoadMap();
        mapLegsRef.current = rm.legs.map((l) => ({ from: l.from, to: l.to }));
        mapMarksRef.current = rm.markers
          .filter((m) => m.kind === "start" || m.kind === "station")
          .map((m) => ({ x: m.x, y: m.y, kind: m.kind }));
      }
      setRoadMap(engine.getRoadMap());
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
    engine.setExposure(boot.exposure, boot.autoExposure);
    engine.setBrightness(boot.brightness);
    engine.setContrast(boot.contrast);
    engine.setHighlights(boot.highlights);
    engine.setSaturation(boot.saturation);
    if (boot.resolution !== "native") engine.setResolution(boot.resolution);
    if (boot.cameraView !== "chase") engine.setView(boot.cameraView);
    if (boot.frameCap !== "display") engine.setFrameCap(boot.frameCap);
    setPhase("playing");

    // Online cruise: connect to the hub and mirror the other drivers.
    if (new URLSearchParams(window.location.search).has("online")) {
      // A driver who came straight here and never opened the lobby has
      // no name. They used to be called "racer" — as was everybody else
      // who did the same, so a busy road was six cars called racer. Roll
      // one and keep it, so this is the last time the question comes up
      // and the name is the same one next week.
      let profile = loadProfile();
      if (!cleanHandle(profile.name)) {
        profile = { ...profile, name: rollHandle().en };
        saveProfile(profile);
      }
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
            showMessage(`DUEL — ${opponent}`, w > 0 ? `${w} KD on the line` : "Pride only");
          },
          onDuelSp: (you, them, gap) => {
            const opp = nearbyRef.current?.name ?? "Rival";
            engine.setDuel({ you, them, gap, opponent: opp });
          },
          onDuelEnd: (won, reason, w) => {
            duelRef.current = false;
            engine.setDuel(null);
            // The referee is on the server; the engine only mirrors it,
            // so a win has to be told to it rather than noticed by it.
            if (won) engine.creditDuelWin();
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
        profile.name,
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
    const hello = () => showMessage("Controller connected", "Stick steer · RT gas · LT brake · B drift · X flash · A NOS");
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
    engineRef.current?.setPaused(pauseOpen || settingsOpen || !!dossier);
  }, [pauseOpen, settingsOpen, phase, garageOpen, result, dossier]);

  // While the settings screen is open, keep the resolution readout live.
  // Cheap — two integers off a DOM node once a second — and it is the
  // only way a player can see the difference between what they asked the
  // game for and what the window, the panel and the GL stack allowed.
  useEffect(() => {
    if (!settingsOpen) return;
    setRenderInfo(readRenderInfo());
    const t = setInterval(() => setRenderInfo(readRenderInfo()), 1000);
    return () => clearInterval(t);
  }, [settingsOpen]);

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

  // The menu's rolling intro: your own car and the next legend's,
  // abreast on the corniche. Rebuilt whenever the garage or the career
  // changes under it, torn down the moment the race takes the canvas.
  useEffect(() => {
    if (phase !== "menu" || !attractRef.current) return;
    let handle: import("@/game/attract").AttractHandle | null = null;
    let cancelled = false;
    const reduced =
      document.documentElement.dataset.reducedMotion === "1" ||
      (typeof matchMedia === "function" &&
        matchMedia("(prefers-reduced-motion: reduce)").matches);
    (async () => {
      try {
        const [{ buildAttract }, { computeEffects }] = await Promise.all([
          import("@/game/attract"),
          import("@/game/mods"),
        ]);
        if (cancelled || !attractRef.current) return;
        const tune = computeEffects(garage ?? loadGarage());
        // Who is alongside: the legend you have to beat next, in their
        // own colours. Finish the roster and the car that pulls up next
        // to you is the one the roster was for.
        const next = RIVALS[Math.min(beaten, RIVALS.length - 1)];
        const done = beaten >= RIVALS.length;
        const prize = getCar("zeta-300-gtr");
        handle = buildAttract(
          attractRef.current,
          {
            body: tune.paint,
            accent: tune.accent ?? 0x007a3d,
            stripes: tune.stripes,
            style: tune.bodyStyle,
            underglow: tune.glow ?? undefined,
            spoiler: tune.spoiler,
            goldRims: tune.goldRims,
            engineCover: tune.engineCover ?? undefined,
            carbon: tune.carbon,
            raceKit: tune.raceKit,
            kit: tune.kit,
            headlamps: tune.headlamps,
            tint: tune.tint,
            finish: tune.finish,
            stickers: tune.stickers,
            lengthM: tune.lengthM,
            crew: tune.crew ?? undefined,
          },
          reduced,
          {
            // The showroom capture needs one car held at a fixed
            // three-quarter so fifteen cards are comparable, which a
            // road going past cannot give it. Tools ask for the old
            // stage by name rather than the menu carrying a second
            // code path for their benefit.
            mode: attractMode(),
            second: done
              ? {
                  body: prize.color,
                  style: prize.style,
                  raceKit: true,
                  kit: "attack" as const,
                  spoiler: false,
                  lengthM: prize.lengthM,
                }
              : {
                  body: next.bodyColor,
                  accent: next.accentColor,
                  style: next.bodyStyle,
                  underglow: next.accentColor,
                  // Built as far as its class is built, the same as it
                  // will be when you meet it on the road. The rolling
                  // two-shot in the menu is a promise about the car you
                  // are about to race; it should not be a smaller one.
                  kit: CARS.find((c) => c.name === next.car)?.kit,
                  stickers: true,
                  lengthM: CARS.find((c) => c.name === next.car)?.lengthM,
                },
          }
        );
        attractScene.current = handle;
        // Dev handle, same contract as __grnEngine: the turntable cannot
        // be inspected by reading the canvas back, so it reports itself.
        (window as unknown as { __grnAttract: unknown }).__grnAttract = handle;
      } catch {
        // No WebGL, or the import failed: the menu is still a menu.
        // It reads perfectly well over the scrim on its own.
      }
    })();
    const onResize = () => handle?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      handle?.dispose();
      attractScene.current = null;
      delete (window as unknown as { __grnAttract?: unknown }).__grnAttract;
    };
    // `beaten` is in here because the car alongside is the next legend's:
    // win a battle and the machine in the next lane changes with it.
  }, [phase, garage, beaten]);

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
      // C cycles the shot. Live during the race and nothing else — a key
      // that changed the camera under a menu would be a key that changed
      // the camera by accident.
      if (
        e.key.toLowerCase() === "c" &&
        !e.repeat &&
        phase === "playing" &&
        !garageOpen &&
        !settingsOpen &&
        !onboarding &&
        !result &&
        !cine
      ) {
        const v = engineRef.current?.setView();
        if (v) {
          updateSetting("cameraView", v);
          showMessage(viewSpec(v).label.toUpperCase(), viewSpec(v).hint);
        }
      }
      // Tab reads the driver alongside. Held to the same gates as the
      // camera key: a hotkey that fires under a menu is a hotkey that
      // fires by accident.
      if (
        e.key === "Tab" &&
        !e.repeat &&
        phase === "playing" &&
        !garageOpen &&
        !settingsOpen &&
        !onboarding &&
        !result &&
        !cine
      ) {
        e.preventDefault();
        setDossier((cur) => (cur ? null : engineRef.current?.sizeUpRival() ?? null));
      }
      if (e.key === "Escape" && dossier) setDossier(null);
      // Menu navigation. Enter must not fall through a modal and start
      // the race behind it, so every branch is gated on the overlays.
      const menuLive =
        phase === "menu" && !garageOpen && !settingsOpen && !onboarding && !creditsOpen;
      if (menuLive && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const n = menuItemsRef.current.length;
        setMenuSel((s) => (s + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
      }
      if (menuLive && e.key === "Enter" && !e.repeat) {
        menuItemsRef.current[menuSel]?.run();
      }
      // Escape closes the credits the same way it closes everything else
      if (creditsOpen && e.key === "Escape") setCreditsOpen(false);
      if (result && result.outcome === "loss" && e.key.toLowerCase() === "r") {
        setResult(null);
        engineRef.current?.setPaused(false);
        engineRef.current?.retryBattle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, startGame, result, garageOpen, settingsOpen, onboarding, cine, challenge, creditsOpen, menuSel, updateSetting, showMessage, dossier]);

  // The main menu proper: one list, navigable by keyboard or thumb.
  // The first item keeps the wording the whole game is introduced by —
  // START ENGINE for a new driver, CONTINUE for a career in progress.
  const menuItems = useMemo(
    () => [
      {
        key: "start",
        label: beaten > 0 ? "CONTINUE" : "START ENGINE",
        ar: "يلا",
        icon: "flag" as IconName,
        hint: "Take the Gulf Road at midnight",
        run: () => startGame(),
      },
      {
        key: "garage",
        label: "GARAGE",
        ar: "الكراج",
        icon: "wrench" as IconName,
        hint: "Buy, paint and tune the machine",
        run: () => {
          setGarage(loadGarage());
          setGarageOpen(true);
        },
      },
      {
        key: "settings",
        minor: true,
        label: "SETTINGS",
        ar: "الإعدادات",
        icon: "gear" as IconName,
        hint: "Picture, sound and controls",
        run: () => setSettingsOpen(true),
      },
      {
        key: "howto",
        minor: true,
        label: "HOW TO PLAY",
        ar: "كيف تلعب",
        icon: "pad" as IconName,
        hint: "The flash, the battle, the SP bar",
        run: () => setOnboarding(true),
      },
      {
        key: "credits",
        minor: true,
        label: "CREDITS",
        ar: "شكر",
        icon: "star" as IconName,
        hint: "Who built this, and what it is built on",
        run: () => setCreditsOpen(true),
      },
    ],
    [beaten, startGame]
  );
  const menuItemsRef = useRef(menuItems);
  menuItemsRef.current = menuItems;

  // The corner's keyboard reference retires twelve seconds into the
  // first race, not twelve seconds after the page loaded.
  const [hintDone, setHintDone] = useState(false);
  useEffect(() => {
    if (phase !== "playing") return;
    const t = setTimeout(() => setHintDone(true), 12000);
    return () => clearTimeout(t);
  }, [phase]);

  const lvl = levelInfo(career?.xp ?? 0);
  const rank = rankTitle(lvl.level);

  return (
    <div ref={rootRef} className="fixed inset-0 z-[60] bg-black text-white">
      <canvas ref={canvasRef} className="h-full w-full" />

      {/* HUD */}
      <div
        className={`pointer-events-none absolute inset-0 transition-opacity ${
          phase === "playing" && !cine ? "opacity-100" : "opacity-0"
        }`}
        style={{ zoom: hudZoom, "--hud-inset-x": `${hudInsetX}px` } as React.CSSProperties}
      >
        {/* Kuwait wall clock — the real hour on the corniche, which is
            not the game's own time of day. */}
        <div className="hud-safe-t hud-safe-r absolute">
          <KuwaitClock />
        </div>

        {/* Area + progress */}
        <div className="hud-safe-t hud-safe-l absolute">
          <div className="grn-plate px-4 py-2">
            {/* The road, above the district. That order is the order a
                navigation display uses and the order a driver thinks
                in: which road, then which part of it. The game is named
                after a road and never used to say which one you were
                on. */}
            <div ref={roadRef} className="flex items-baseline gap-1.5">
              <span className="grn-label text-[0.7rem] text-sodium-400/90" />
              <span className="grn-ar text-[0.75rem] text-white/70" lang="ar" />
            </div>
            <div ref={areaRef} className="flex items-baseline gap-2 text-xl leading-tight">
              <span className="grn-display tracking-wide" />
              <span className="grn-ar-display text-[0.95em] text-white/80" lang="ar" />
            </div>
            {/* What is COMING. The road line and the district line both
                name where you already are, which a driver can see out of
                the window; the only part of this plate that tells you
                something you cannot see yet is this one. */}
            <div ref={nextRef} className="grn-label mt-0.5 flex items-baseline gap-1.5 text-[0.7rem]">
              <span className="text-white/62" />
              <span className="text-white/70" />
              <span className="grn-ar text-[0.75rem] text-white/70" lang="ar" />
              {/* normal-case, because grn-label uppercases everything and
                  a distance is not an abbreviation: "80 M" reads as a
                  unit symbol shouted, "80 m" reads as a distance. */}
              <span className="tnum normal-case text-sodium-400/85" />
            </div>
            <div ref={progressRef} className="grn-label mt-0.5 text-[0.75rem]" />
            {/* The clock, and whether the night is still open.
                Racing runs midnight to 05:50 and nothing else on screen
                would tell you that — a player who flashes at a rival at
                six in the morning and gets nothing deserves to have been
                able to see why. */}
            <div ref={clockRef} className="grn-label mt-1 flex items-center gap-1.5 text-[0.75rem]">
              <span className="tnum text-white/80" />
              <span className="rounded-sm px-1.5 py-px text-[0.7rem]" />
            </div>
          </div>
          {onlineCount !== null && (
            <div className="grn-panel mt-2 inline-flex items-center gap-1.5 px-3 py-1">
              <span className="size-1.5 rounded-full bg-gulf-400 shadow-[0_0_8px_var(--color-gulf-400)]" />
              <span className="grn-label text-[0.75rem] text-gulf-300">
                {onlineCount} cruising online
              </span>
            </div>
          )}

          {/* The run you are on. One at a time, in the order quests.ts
              lists them, which is the order a night goes in — a wall of
              six objectives is a checklist, and a checklist is not what
              anybody drives here for. Hidden until the hub is connected,
              and hidden again during a duel, where the SP bars own the
              screen. Starts hidden: display is set from the frame. */}
          <div
            ref={runBoxRef}
            style={{ display: "none" }}
            className="grn-panel mt-2 w-56 px-3 py-2 text-left"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div ref={runNameRef} className="grn-label text-[0.75rem] text-sodium-400" />
              <span ref={runLabelRef} className="tnum text-[0.7rem] text-white/70" />
            </div>
            <div ref={runHintRef} className="mt-0.5 text-[0.68rem] leading-4 text-white/72" />
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/12">
              <div
                ref={runBarRef}
                className="h-full rounded-full bg-sodium-400 transition-[width] duration-200"
                style={{ width: "0%" }}
              />
            </div>
          </div>
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
            <span className="grn-label text-[0.75rem] text-emerald-300 [text-shadow:0_0_8px_rgba(52,211,153,0.45)]">
              ▲ SP <span className="grn-ar" lang="ar">أنت</span>
            </span>
            <span className="grn-label rival-ink text-[0.75rem] text-rose-300 [text-shadow:0_0_8px_rgba(251,113,133,0.45)]">
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
          <div
            ref={raceLeftRef}
            className="grn-label mt-1 text-center text-[0.72rem] tabular-nums [text-shadow:0_2px_10px_rgba(0,0,0,0.9)]"
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
            className="grn-display invisible mt-1.5 flex animate-pulse items-center justify-center gap-2.5 text-lg tracking-[0.14em] text-gulf-300 [text-shadow:0_0_11px_rgba(56,201,238,0.4),0_2px_10px_rgba(0,0,0,0.9)]"
          >
            <IconFlash size={20} />
            <span>FLASH 3&times; TO CHALLENGE</span>
            <span className="flash-pips" ref={pipsRef}>
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>

        {/* Drift angle + style counter */}
        <div className="pointer-events-none absolute left-1/2 top-[66%] -translate-x-1/2">
          <div
            ref={driftRef}
            className="grn-display flex flex-col items-center gap-1.5 text-xl italic tracking-[0.14em] opacity-0 transition-opacity duration-300 [text-shadow:0_0_12px_rgba(56,201,238,0.32),0_2px_10px_rgba(0,0,0,0.9)]"
          >
            <span ref={driftTextRef} />
            <span className="drift-meter">
              <i ref={driftBarRef} />
            </span>
          </div>
          {/* Brakes, but only when they have something to say: wheels
              locked, anti-lock working, or pads going away with heat. */}
          <div
            ref={brakeRef}
            className="grn-display mt-1 text-center text-sm tracking-[0.2em] opacity-0 transition-opacity duration-200 [text-shadow:0_2px_10px_rgba(0,0,0,0.9)]"
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
          <RevCounter
            needleRef={needleRef}
            ringRef={shiftRingRef}
            ticksRef={ticksRef}
            redlineRef={redlineRef}
            rpmRef={rpmTextRef}
            speedRef={speedRef}
            gearRef={gearRef}
            size={200}
          />
          {/* The meters, on a ground of their own.
              Every other gadget in this HUD sits on something — the
              clock and the map on a panel, the street name on a plate,
              the hint on white card — and these four sat bare on the
              road, four skewed bars and a row of grey words with the
              night showing through them. A bar reading against tarmac
              at one moment and against a lit shopfront the next has no
              fixed contrast at all. Same panel as the clock and the map,
              so the instrument cluster reads as one instrument. */}
          <div className="grn-panel mt-2 inline-block px-2.5 py-2">
          {/* The tow. Shown only while there is one, because a bar that
              reads zero nine tenths of the time teaches the eye to stop
              looking at it — and the whole reason this is on screen is
              to send the driver hunting for the wake. */}
          <div ref={towWrapRef} className="items-center gap-2" style={{ display: "none" }}>
            <span className="grn-label w-11 text-[0.7rem] text-sodium-300">Tow</span>
            <div className="grn-meter h-1.5 w-44 -skew-x-12">
              <div
                ref={towRef}
                className="h-full bg-gradient-to-r from-sodium-600 to-sodium-300 shadow-[0_0_12px_rgba(245,165,36,0.75)]"
                style={{ width: "0%" }}
              />
            </div>
          </div>
          <div ref={boostWrapRef} className="mt-1 items-center gap-2" style={{ display: "none" }}>
            <span className="grn-label w-11 text-[0.7rem] text-gulf-300">Boost</span>
            <div className="grn-meter h-1.5 w-44 -skew-x-12">
              <div
                ref={boostRef}
                className="h-full bg-gradient-to-r from-gulf-500 to-gulf-300 shadow-[0_0_12px_rgba(56,201,238,0.8)]"
                style={{ width: "0%" }}
              />
            </div>
          </div>
          {/* Nitrous. Taller than the boost bar on purpose: boost is
              something the car does to itself, NOS is a resource the
              player spends, and the one you can run out of is the one
              that has to be readable without looking away from the road. */}
          <div ref={nosWrapRef} className="mt-1 items-center gap-2" style={{ display: "none" }}>
            <span className="grn-label w-11 text-[0.7rem] text-indigo-300">NOS</span>
            <div ref={nosTrackRef} className="nos-meter h-2.5 w-44 -skew-x-12" data-state="charged">
              <div ref={nosRef} className="nos-fill" style={{ width: "100%" }} />
            </div>
            <span
              ref={nosPctRef}
              className="grn-label w-12 text-right text-[0.7rem] tabular-nums text-indigo-200"
            >
              100%
            </span>
          </div>
          {/* Fuel. Always shown — every car has a tank, unlike the two
              gauges above it, which appear only once the parts are
              bought. It reads in litres because that is the unit the
              pump charges in and the unit the driver has to think in. */}
          <div className="mt-1 flex items-center gap-2">
            <span className="grn-label w-11 text-[0.7rem] text-emerald-300">Fuel</span>
            <div ref={fuelTrackRef} className="nos-meter h-2.5 w-44 -skew-x-12" data-state="ok">
              <div ref={fuelRef} className="fuel-fill" style={{ width: "100%" }} />
            </div>
            <span
              ref={fuelLabelRef}
              className="grn-label w-20 text-right text-[0.7rem] tabular-nums text-emerald-200"
            >
              — L
            </span>
          </div>
          <div
            ref={pumpRef}
            className="grn-label mt-1 text-[0.7rem] tracking-wide text-cyan-300 transition-opacity"
            style={{ opacity: 0 }}
          />
          </div>
        </div>

        {/* Bottom-right stack: minimap pinned above the controls hint.
            One flex column rather than three independently-positioned
            panels, so they can never overlap at any viewport size and the
            hint disappearing on touch simply closes the gap. */}
        <div className="hud-safe-b hud-safe-r absolute flex flex-col items-end gap-2">
          <button
            onClick={toggleFullscreen}
            className="pointer-events-auto grn-panel px-2.5 py-1 font-display text-[0.8rem] tracking-wide text-white/60 hover:bg-white/10"
            title={isFs ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFs ? "⛶ exit" : "⛶ fullscreen"}
          </button>
          {/* The minimap is the way into the full one.
              A button rather than a key, and deliberately: every letter
              that means anything is already bound — m is mute, n is
              nitro, r is the radio, c the camera — and inventing a
              mnemonic-free one would be a shortcut nobody finds. Tapping
              the thing you want bigger is the gesture people already
              try, and it is the only version of this that works on a
              phone at all.
              Buffer outsized vs its CSS box so the HUD zoom can enlarge
              it on big screens without going soft. */}
          <button
            onClick={() => setMapOpen(true)}
            disabled={!roadMap}
            title="Open the full map"
            aria-label="Open the full map"
            className="pointer-events-auto grn-panel relative p-1 transition hover:border-white/35 disabled:opacity-60"
          >
            <canvas ref={mapRef} width={320} height={320} className="size-[116px]" />
            <span className="grn-label absolute inset-x-0 bottom-1 text-center text-[0.7rem] text-white/70">
              tap to open
            </span>
          </button>
          <div
            className={`grn-info hud-hint px-3 py-2 text-right font-display text-[0.8rem] leading-[1.35] ${
              isTouch ? "hidden" : ""
            } ${hintDone ? "hud-hint-gone" : ""}`}
          >
            W/↑ accelerate · S/↓ brake · A D steer · Space drift · N nitro
            <br />F flash · C camera · Esc pause · M mute · B music · V voices
            <br />Tab · size up the driver alongside
          </div>
        </div>
      </div>

      {/* Size up the driver alongside — everything the game knows about
          them, before you commit to anything. Square, white, black: the
          one thing on this screen that is meant to be read rather than
          glanced at. */}
      {phase === "playing" && canSizeUp && !dossier && !cine && !result && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-[6] -translate-x-1/2">
          <button
            onClick={() => setDossier(engineRef.current?.sizeUpRival() ?? null)}
            className="grn-info pointer-events-auto px-3 py-1.5 font-display text-[0.8rem] tracking-[0.08em]"
          >
            TAB · SIZE UP THE DRIVER
          </button>
        </div>
      )}
      {dossier && (
        <div
          className="absolute inset-0 z-[24] flex items-center justify-center bg-black/55 px-4"
          onClick={() => setDossier(null)}
        >
          <div
            className="grn-info reveal w-full max-w-md p-5"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="grn-info-key text-[0.7rem]">
                  Legend {dossier.order} of {dossier.total} · {dossier.country}
                </div>
                <div className="grn-display truncate text-3xl leading-none">{dossier.name}</div>
                <div className="grn-ar mt-1 text-lg leading-none" lang="ar">
                  {dossier.arabicName}
                </div>
              </div>
              <span
                className="mt-1 size-8 shrink-0 border-2 border-black"
                style={{ backgroundColor: `#${dossier.color.toString(16).padStart(6, "0")}` }}
              />
            </div>

            <div className="grn-info-rule mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-t pt-4">
              {(
                [
                  ["Crew", dossier.crew],
                  ["Turf", dossier.area],
                  ["Machine", dossier.car],
                  [
                    "Length",
                    dossier.lengthM ? `${dossier.lengthM.toFixed(2)} m` : "—",
                  ],
                  ["Top speed", `${dossier.topSpeedKmh} km/h`],
                  [
                    "Where",
                    `${Math.abs(dossier.gap)} m ${dossier.gap >= 0 ? "ahead" : "behind"}`,
                  ],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <div className="grn-info-key text-[0.7rem]">{k}</div>
                  <div className="grn-display text-base leading-tight">{v}</div>
                </div>
              ))}
            </div>

            <div className="grn-info-rule mt-4 border-t pt-3 text-[0.875rem] leading-6">
              &ldquo;{dossier.taunt}&rdquo;
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="grn-info-key text-[0.7rem]">
                {dossier.beaten ? (
                  <span className="grn-info-accent">Beaten — rematch any time</span>
                ) : (
                  "Flash three times to challenge"
                )}
              </span>
              <button
                onClick={() => setDossier(null)}
                className="grn-btn tap border-2 border-black px-4 py-1.5 text-[0.8rem] font-bold text-black hover:bg-black hover:text-white"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PvP: challenge the nearest online driver */}
      {phase === "playing" && nearby && !invite && !duelResult && !cine && (
        <div className="pointer-events-none absolute left-1/2 top-40 z-[6] -translate-x-1/2 text-center">
          <div className="grn-panel px-4 py-2">
            <div className="grn-label text-[0.7rem] text-gulf-300">Online driver</div>
            <div className="grn-display text-xl leading-tight">{nearby.name}</div>
            <div className="grn-label mt-0.5 text-[0.7rem]">
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
                className="pointer-events-auto grn-btn border border-white/20 px-2.5 py-1.5 text-[0.75rem] text-white/70 hover:bg-white/10"
                title="Cycle the stake"
              >
                ⇅
              </button>
              <button
                onClick={() => hubRef.current?.challengePlayer(nearby.id, wager)}
                className="pointer-events-auto grn-btn grn-btn-ghost px-4 py-1.5 text-xs"
              >
                CHALLENGE {wager > 0 ? `${wager} KD` : "PRIDE"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PvP: someone challenged you */}
      {invite && !cine && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
          <div className="grn-dialog w-full max-w-md px-9 py-8 text-center">
            <div className="grn-label text-[0.75rem] text-gulf-300">Incoming challenge</div>
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
                ACCEPT — <span className="grn-ar" lang="ar">يلا</span>
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
                  ? "text-emerald-400 [text-shadow:0_0_20px_rgba(52,211,153,0.45)]"
                  : "text-rose-500 [text-shadow:0_0_20px_rgba(244,63,94,0.45)]"
              }`}
            >
              {duelResult.won ? "DUEL WON" : "DUEL LOST"}
            </div>
            <div className="grn-label mt-3 text-[0.75rem]">{duelResult.reason}</div>
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
          <div className="grn-label text-[0.8rem] tracking-[0.42em] text-gulf-300 [text-shadow:0_0_12px_rgba(56,201,238,0.36)]">
            Headlights flashed ×3 — <span className="grn-ar" lang="ar">التحدي</span>
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
                    className={`grn-label text-[0.75rem] ${
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
                  <div className="grn-ar mt-1 text-lg text-white/75" lang="ar">{d.arabicName}</div>
                )}
                <div className="mt-4 space-y-1.5 border-t border-white/10 pt-3 text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="grn-label text-[0.7rem]">Level</span>
                    <span className="grn-display text-lg text-sodium-400">LV. {d.level}</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="grn-label text-[0.7rem]">Country</span>
                    <span className="font-semibold">
                      <Flag code={d.flag} /> {d.country}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="grn-label text-[0.7rem]">Crew</span>
                    <span className="text-right text-[0.875rem] font-semibold text-white/85">
                      {d.crew}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="grn-label text-[0.7rem]">Car</span>
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
                <div className="grn-label text-[0.7rem]">
                  Your car — <span className="grn-ar" lang="ar">اختر سيارتك</span>
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
                        <div className="grn-label text-[0.7rem]">{c.cls}</div>
                      </button>
                    );
                  })}
                </div>

                {/* Pick the length.
                    Above the stake, because it is the bigger decision: a
                    sprint and an all-nighter are different races in the
                    same car, and how much you are willing to put on it
                    follows from which one you picked. */}
                <div className="grn-label mt-4 text-[0.7rem]">
                  Distance — <span className="grn-ar" lang="ar">المسافة</span>
                  <span className="ml-2 text-white/66">
                    they usually run {distanceById(challenge.rivalDistance).km} km
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {RACE_DISTANCES.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setRaceDistance(d.id)}
                      title={d.blurb}
                      className={`pointer-events-auto grn-display rounded-lg border px-3.5 py-1.5 text-sm transition ${
                        raceDistance === d.id
                          ? "border-sodium-400 bg-sodium-500/20 text-sodium-300"
                          : "border-white/15 text-white/70 hover:border-white/35"
                      }`}
                    >
                      {d.km} KM
                      {d.id === challenge.rivalDistance && (
                        <span className="ml-1.5 text-[0.62rem] text-white/50">theirs</span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-4 text-white/55">
                  {distanceById(raceDistance).blurb} ·{" "}
                  <span className="grn-ar" lang="ar">
                    {distanceById(raceDistance).ar}
                  </span>
                </p>

                {/* Pick the purse */}
                <div className="grn-label mt-4 text-[0.7rem]">
                  Stake — <span className="grn-ar" lang="ar">مبلغ السباق</span>
                  <span className="ml-2 text-white/66">
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
                      engineRef.current?.confirmChallenge(wager, raceCar, raceDistance);
                    }}
                    className="pointer-events-auto grn-btn grn-btn-primary flex-1 py-3 text-lg"
                  >
                    SEND CHALLENGE — <span className="grn-ar" lang="ar">تحداه</span>
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
                Awaiting response… <span className="grn-ar" lang="ar">ينتظر الرد</span>
              </div>
            ) : challenge.answer.accepted ? (
              <div>
                <div className="grn-display text-4xl italic text-emerald-400 [text-shadow:0_0_18px_rgba(52,211,153,0.5)]">
                  ACCEPTED — <span className="grn-ar" lang="ar">قبل التحدي</span> ✓
                </div>
                <div className="grn-label mt-1.5 text-[0.75rem] text-sodium-400">
                  {challenge.answer.reason}
                </div>
              </div>
            ) : (
              <div>
                <div className="grn-display text-4xl italic text-rose-500 [text-shadow:0_0_18px_rgba(244,63,94,0.5)]">
                  REJECTED — <span className="grn-ar" lang="ar">رفض</span> ✕
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
            <div className="grn-display text-6xl italic text-emerald-300 [text-shadow:0_0_19px_rgba(52,211,153,0.5)] sm:text-7xl">
              YOU
            </div>
            <div className="grn-ar mt-1 text-xl text-white/75" dir="rtl" lang="ar">
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
            <div className="grn-ar mt-1 text-xl text-white/80" lang="ar">{vsRival.arabicName}</div>
            <div className="grn-label mt-2 text-[0.75rem]">{vsRival.crew}</div>
            <div className="mt-2.5 text-sm italic text-white/70">&quot;{vsRival.taunt}&quot;</div>
          </div>
        </div>
      )}

      {/* On-screen controls (touch devices) */}
      {padsVisible && (
        <div
          className="absolute inset-x-0 bottom-0 z-[5] select-none px-[calc(env(safe-area-inset-left)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]"
          style={{ zoom: Math.max(1, hudZoom) }} // thumb targets grow, never shrink
        >
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
                className="tap grn-panel grn-label px-5 py-3.5 text-[0.7rem] text-gulf-300 active:bg-gulf-500/25"
              >
                Flash
              </button>
              <button
                onPointerDown={() => engineRef.current?.touchNos(true)}
                onPointerUp={() => engineRef.current?.touchNos(false)}
                onPointerCancel={() => engineRef.current?.touchNos(false)}
                className="tap grn-panel grn-label px-5 py-3.5 text-[0.7rem] text-indigo-300 active:bg-indigo-500/25"
              >
                NOS
              </button>
              <button
                onPointerDown={() => engineRef.current?.touchHorn(true)}
                onPointerUp={() => engineRef.current?.touchHorn(false)}
                onPointerCancel={() => engineRef.current?.touchHorn(false)}
                className="tap grn-panel grn-label px-5 py-3.5 text-[0.7rem] text-white/70 active:bg-white/20"
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
                className="tap grn-panel grn-label grid size-[4.5rem] place-items-center text-[0.7rem] text-sodium-400 active:bg-sodium-500/25"
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
                className="tap grn-panel grn-label grid size-[4.5rem] place-items-center text-[0.75rem] text-rose-300 active:bg-rose-500/25"
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
                className="tap grn-panel grn-label grid size-[5.5rem] place-items-center text-[0.75rem] text-emerald-300 active:bg-emerald-500/25"
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
          <div className="grn-display text-xl leading-tight [text-shadow:0_4px_20px_rgba(0,0,0,0.95)] sm:text-3xl">
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
        <div className="screen-in absolute inset-0 z-10">
          {/* The turntable: your own car, lit by the night you are about
              to drive into. Behind a scrim so the menu stays readable. */}
          <canvas ref={attractRef} className="attract-canvas" aria-hidden />
          <div className="menu-scrim" aria-hidden />
          <div className="safe-pad absolute inset-0 overflow-y-auto">
          <div className="menu-shell relative mx-auto flex min-h-full w-full max-w-3xl flex-col">
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
                    <span className="grn-ar hidden text-white/74 sm:inline" lang="ar">{rank.ar}</span>
                  </span>
                  <span className="grn-label tnum shrink-0 text-[0.7rem] text-white/70">
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
                <div className="grn-label text-[0.7rem] text-white/70">Balance</div>
                <div className="grn-display tnum text-lg leading-tight text-sodium-400">
                  {(garage?.kd ?? 0).toLocaleString()}
                  <span className="ml-0.5 text-[0.7rem] text-white/74">KD</span>
                </div>
              </div>
              <button
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                className="tap grid shrink-0 place-items-center rounded-xl border border-white/15 text-white/70 hover:bg-white/10"
              >
                <IconGear size={18} />
              </button>
            </div>

            <div className="menu-grid">
             <div className="menu-col">
            {/* Title */}
            <div className="menu-title mt-5 text-center sm:mt-7">
              <div className="grn-label text-[0.75rem] tracking-[0.45em] text-gulf-400 [text-shadow:0_0_20px_rgba(56,201,238,0.5)]">
                Kuwait Xtreme Racer
              </div>
              <h1 className="grn-display menu-wordmark mt-1.5 text-[clamp(2.4rem,12vw,5rem)] italic leading-[0.88]">
                GULF ROAD <span className="text-sodium-400">NIGHTS</span>
              </h1>
              <div className="grn-ar mt-1.5 text-lg text-white/70" dir="rtl" lang="ar">
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
                    <div className="grn-label text-[0.7rem] text-white/70">{x.k}</div>
                  </div>
                ))}
              </div>
            )}

             </div>

             <div className="menu-col">
            {/* Next race — the one thing the menu is for */}
            <div className="grn-dialog mt-5 p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <span className="grn-label text-[0.7rem] text-gulf-400">
                  {beaten >= RIVALS.length ? "Career complete" : "Next race"}
                </span>
                <span className="grn-label tnum text-[0.7rem] text-white/70">
                  {beaten} / {RIVALS.length} legends beaten
                </span>
              </div>
              {beaten >= RIVALS.length ? (
                <div className="mt-2 flex items-center gap-3">
                  <IconCrown size={30} className="text-sodium-400" />
                  <div>
                    <div className="grn-display text-xl text-sodium-400">King of Gulf Road</div>
                    <div className="text-[0.8rem] text-white/55">
                      Every street is yours — run it back for the times.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-3">
                  {/* The rival's racing number, on their own paint.
                      This was a bare gradient swatch, and on a rival
                      with dark bodywork it rendered as an empty grey
                      box — the one obviously unfinished thing on the
                      screen. The number is the same one their car
                      actually wears on its doors, so the card and the
                      machine you are about to meet agree. */}
                  <span
                    className="grn-display tnum relative grid size-11 shrink-0 place-items-center rounded-lg border border-white/20 text-[1.05rem] leading-none"
                    style={plate(RIVALS[beaten].bodyColor)}
                    aria-hidden
                  >
                    {20 + beaten}
                  </span>
                  <div className="min-w-0">
                    <div className="grn-display truncate text-xl text-white">
                      {RIVALS[beaten].name}{" "}
                      <span className="grn-ar text-white/60" lang="ar">{RIVALS[beaten].arabicName}</span>
                    </div>
                    <div className="truncate text-[0.8rem] text-white/55">
                      {RIVALS[beaten].crew} · {RIVALS[beaten].area}
                    </div>
                  </div>
                  <div className="ml-auto shrink-0 text-right">
                    <div className="grn-label text-[0.7rem] text-white/70">Prize</div>
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

            {/* The menu itself */}
            <nav className="mt-5 flex flex-col gap-1.5" aria-label="Main menu">
              {menuItems.map((it, i) => (
                <button
                  key={it.key}
                  onClick={it.run}
                  onMouseEnter={() => setMenuSel(i)}
                  onFocus={() => setMenuSel(i)}
                  aria-current={i === menuSel ? "true" : undefined}
                  className={`menu-item tap ${i === menuSel ? "is-sel" : ""} ${
                    i === 0 ? "is-primary" : ""
                  } ${it.minor ? "is-minor" : ""}`}
                >
                  <span className="menu-item-caret" aria-hidden>
                    ▸
                  </span>
                  <span className="menu-item-icon" aria-hidden>
                    {(() => {
                      const Ico = ICONS[it.icon];
                      return <Ico size={24} />;
                    })()}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="menu-item-label">{it.label}</span>{" "}
                    <span className="grn-ar text-white/74" lang="ar">{it.ar}</span>
                    {!it.minor && <span className="menu-item-hint">{it.hint}</span>}
                  </span>
                </button>
              ))}
            </nav>
            <div className="grn-label mt-2 text-center text-[0.7rem] text-white/62">
              ↑ ↓ to choose · Enter to select
            </div>

             </div>
            </div>

            <div className="mt-auto flex items-center justify-between pt-4">
              <span className="grn-label text-[0.7rem] text-white/58">
                {carName(garage) && (
                  <>
                    {carName(garage)}{" "}
                    <span className="grn-ar text-white/55" lang="ar">في الكراج</span>
                  </>
                )}
              </span>
              <a
                href="/hub"
                className="grn-label text-[0.7rem] text-gulf-300 underline-offset-4 hover:underline"
              >
                Online hub →
              </a>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* Credits */}
      {creditsOpen && (
        <div className="safe-pad absolute inset-0 z-40 overflow-y-auto menu-backdrop">
          <div className="mx-auto max-w-xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="grn-label text-[0.8rem] tracking-[0.42em] text-gulf-400">
                  Credits
                </div>
                <h2 className="grn-display mt-1 text-4xl italic">
                  <span className="grn-ar" lang="ar">شكر وتقدير</span>
                </h2>
              </div>
              <button
                onClick={() => setCreditsOpen(false)}
                className="tap grn-btn bg-white px-6 py-2.5 text-sm text-black hover:bg-white/85"
              >
                BACK
              </button>
            </div>

            <div className="grn-dialog mt-5 p-4 sm:p-5">
              <div className="grn-display text-2xl italic">
                GULF ROAD <span className="text-sodium-400">NIGHTS</span>
              </div>
              <div className="grn-ar mt-1 text-base text-white/70" dir="rtl" lang="ar">
                ليالي شارع الخليج
              </div>
              <p className="mt-3 text-[0.875rem] leading-relaxed text-white/60">
                A midnight racer set on Kuwait&apos;s Gulf Road — the corniche from
                Sharq to Salmiya, its sodium lamps, its water towers and the
                traffic you have to read your way through. Every car, character
                and building here is drawn in code: there is no art package to
                download, and nothing in it is traced from a real marque.
              </p>
            </div>

            {[
              {
                h: "Built with",
                ar: "مبني على",
                rows: [
                  ["three.js", "WebGL scene graph, post-processing and PMREM lighting"],
                  ["Next.js + React", "The shell, the HUD and the menus"],
                  ["Web Audio API", "Every engine, tire, wind and radio voice, synthesised live"],
                  ["Blender", "The high-resolution wheel and palm meshes, swapped in at runtime"],
                ],
              },
              {
                h: "Typefaces",
                ar: "الخطوط",
                rows: [
                  ["IBM Plex Sans Arabic", "Interface and HUD"],
                  ["Cairo", "Display and headings"],
                  ["Noto Naskh Arabic", "Road signage"],
                ],
              },
              {
                h: "Ports",
                ar: "المنافذ",
                rows: [
                  ["Unreal Engine 5", "Code-only port, generated from the same handling data"],
                  ["Unity", "Code-only port, kept in parity by contract tests"],
                ],
              },
            ].map((sec) => (
              <div key={sec.h} className="grn-dialog mt-3 p-4 sm:p-5">
                <div className="flex items-baseline justify-between">
                  <span className="grn-label text-[0.7rem] text-gulf-400">{sec.h}</span>
                  <span className="grn-ar text-[0.875rem] text-white/62" lang="ar">{sec.ar}</span>
                </div>
                <dl className="mt-2 space-y-2">
                  {sec.rows.map(([k, v]) => (
                    <div key={k}>
                      <dt className="grn-display text-base text-white">{k}</dt>
                      <dd className="text-[0.8rem] text-white/74">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}

            <div className="grn-label mt-5 pb-4 text-center text-[0.7rem] text-white/58">
              Made for the road between Sharq and Salmiya
            </div>
          </div>
        </div>
      )}

      {/* Settings */}
      {settingsOpen && settings && (
        <div className="safe-pad absolute inset-0 z-30 overflow-y-auto menu-backdrop">
          <div className="mx-auto max-w-xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="grn-label text-[0.8rem] tracking-[0.42em] text-gulf-400">
                  Settings
                </div>
                <h2 className="grn-display mt-1 text-4xl italic">
                  <span className="grn-ar" lang="ar">الإعدادات</span>
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
            <h3 className="grn-label mt-7 border-b border-white/10 pb-2 text-[0.75rem]">
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
                    <span className="text-[0.8rem] text-white/74">{hint}</span>
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
            <h3 className="grn-label mt-7 border-b border-white/10 pb-2 text-[0.75rem]">
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
            <p className="mt-2 text-[0.8rem] text-white/70">
              Auto measures your frame rate for six seconds and drops glow and shadows if the
              device can&apos;t hold it; Balanced and Battery also cap Native. This tier is the
              effects — the resolution below is the pixels, and a resolution you choose there is
              held whatever the tier would have done.
            </p>

            {/* Resolution */}
            <h3 className="grn-label mt-7 border-b border-white/10 pb-2 text-[0.75rem]">
              Resolution · الدقة
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {RESOLUTIONS.map((r) => (
                <button
                  key={String(r.value)}
                  onClick={() => updateSetting("resolution", r.value)}
                  className={`tap grn-panel px-3 py-3 text-center transition ${
                    settings.resolution === r.value
                      ? "border-sodium-400/80 bg-sodium-500/10 text-sodium-400"
                      : "text-white/70 hover:border-white/30"
                  }`}
                >
                  <span className="grn-display block text-base leading-tight">{r.label}</span>
                  <span className="mt-0.5 block text-[0.7rem] leading-tight text-white/66">
                    {r.hint}
                  </span>
                </button>
              ))}
            </div>
            {/* What you actually got, which is not always what you asked
                for: the window is smaller than the panel outside
                fullscreen, and every GL stack has a ceiling. */}
            {renderInfo && (
              <div className="grn-panel mt-3 p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="grn-label text-[0.7rem]">Rendering at</span>
                  <span className="grn-display tnum text-lg leading-none text-sodium-400">
                    {formatBuffer(renderInfo.buffer[0], renderInfo.buffer[1])}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[0.8rem] text-white/70">
                  <span>
                    Window{" "}
                    <span className="tnum text-white/70">
                      {formatBuffer(renderInfo.css[0], renderInfo.css[1])}
                    </span>
                  </span>
                  <span>
                    Display{" "}
                    <span className="tnum text-white/70">
                      {formatBuffer(renderInfo.display[0], renderInfo.display[1])}
                    </span>
                  </span>
                  <span>
                    <span className="tnum text-white/70">
                      {(
                        (renderInfo.buffer[0] * renderInfo.buffer[1]) /
                        1e6
                      ).toFixed(1)}
                    </span>{" "}
                    megapixels a frame
                  </span>
                </div>
                {!renderInfo.fullscreen &&
                  renderInfo.buffer[1] < renderInfo.display[1] &&
                  settings.resolution === "native" && (
                    <button
                      onClick={toggleFullscreen}
                      className="grn-btn tap mt-3 border border-white/15 px-4 py-2 text-[0.8rem] text-white/75 hover:bg-white/10"
                    >
                      Go fullscreen for the panel&apos;s full{" "}
                      <span className="tnum">{renderInfo.display[1]}</span> lines
                    </button>
                  )}
              </div>
            )}
            <p className="mt-2 text-[0.8rem] text-white/70">
              Native is one rendered pixel per pixel of your display — 4K on a 4K panel, and only
              in fullscreen. The rest are fixed line counts fitted to your window&apos;s shape, so
              4K really is 2160 lines whatever size the window is: pick it above your display to
              supersample, below it to buy frames. A chosen resolution is held exactly and the
              frame-rate governor will not move it.
            </p>

            {/* Camera */}
            <h3 className="grn-label mt-7 border-b border-white/10 pb-2 text-[0.75rem]">
              Camera · الكاميرا
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {VIEWS.map((v) => (
                <button
                  key={v.value}
                  onClick={() => updateSetting("cameraView", v.value)}
                  className={`tap grn-panel px-3 py-3 text-center transition ${
                    settings.cameraView === v.value
                      ? "border-sodium-400/80 bg-sodium-500/10 text-sodium-400"
                      : "text-white/70 hover:border-white/30"
                  }`}
                >
                  <span className="grn-display block text-base leading-tight">{v.label}</span>
                  <span className="mt-0.5 block text-[0.7rem] leading-tight text-white/66">
                    {v.hint}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[0.8rem] text-white/70">
              Press <span className="text-white/75">C</span> during a race to cycle. Chase and
              Close follow the road, so the car yaws inside the shot and you can see what it is
              doing; Bonnet, Bumper and Cockpit are bolted to the shell and go where it goes —
              they dive under braking and point where the car points, not where it is travelling.
            </p>

            {/* Frame pacing */}
            <h3 className="grn-label mt-7 border-b border-white/10 pb-2 text-[0.75rem]">
              Frame rate · معدل الإطارات
            </h3>
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
              {(
                [
                  ["display", "Display"],
                  ["vrr", "G-Sync"],
                  [240, "240"],
                  [165, "165"],
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
            <p className="mt-2 text-[0.8rem] text-white/70">
              Display follows your panel&apos;s own refresh rate. G-Sync sits a few frames under
              it, which is what keeps a variable-refresh screen inside its window instead of
              falling back to v-sync. Browsers lock rendering to v-sync and offer no way to
              switch it off, so a cap is the only pacing control there is here.
            </p>

            {/* Time of day */}
            <h3 className="grn-label mt-7 border-b border-white/10 pb-2 text-[0.75rem]">
              Sky · السما
            </h3>
            {/* Picture */}
            <h3 className="grn-label mt-6 text-[0.75rem] text-white/70">
              PICTURE · <span className="grn-ar" lang="ar">الصورة</span>
            </h3>
            <label className="mt-3 flex items-center justify-between gap-3 text-sm">
              <span>
                Auto exposure
                <span className="block text-[0.75rem] text-white/70">
                  Meters the scene and adapts, like an eye
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings.autoExposure}
                onChange={(e) => updateSetting("autoExposure", e.target.checked)}
                className="size-5 accent-sodium-400"
              />
            </label>
            {(
              [
                ["exposure", "Exposure", "التعريض", -2, 2, 0.25, (v: number) =>
                  `${v > 0 ? "+" : ""}${v.toFixed(2)} EV`],
                ["brightness", "Brightness", "السطوع", 0.7, 1.5, 0.02, (v: number) => v.toFixed(2)],
                ["contrast", "Contrast", "التباين", 0.7, 1.5, 0.05, (v: number) => v.toFixed(2)],
                ["highlights", "Highlights", "الإضاءات", -1, 1, 0.1, (v: number) =>
                  v === 0 ? "neutral" : v < 0 ? `recover ${Math.abs(v).toFixed(1)}` : `push ${v.toFixed(1)}`],
                ["saturation", "Saturation", "التشبع", 0.6, 1.4, 0.02, (v: number) => v.toFixed(2)],
              ] as const
            ).map(([key, label, ar, min, max, step, fmt]) => (
              <label key={key} className="mt-3 block text-sm">
                <span className="flex items-center justify-between">
                  <span>
                    {label} <span className="grn-ar text-white/74" lang="ar">{ar}</span>
                  </span>
                  <span className="grn-display text-[0.875rem] text-sodium-400">
                    {fmt(settings[key] as number)}
                  </span>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={settings[key] as number}
                  onChange={(e) => updateSetting(key, Number(e.target.value))}
                  className="mt-1.5 w-full accent-sodium-400"
                />
              </label>
            ))}

            <div className="mt-3 grid grid-cols-2 gap-2">
              {(
                [
                  ["night", "Midnight", "ليل", "Sodium lamps, full stars, the classic run"],
                  ["dawn", "First light", "فجر", "Sunrise band on the horizon, stars fading"],
                  ["noon", "High sun", "ظهر", "Daylight over the bay, lamps off, hard shadows"],
                  ["dusk", "Maghrib", "مغرب", "The sun going down behind the towers"],
                  ["cycle", "Full cycle", "دورة كاملة", "The clock runs — a whole day every 16 minutes"],
                  ["kuwait", "Kuwait time", "توقيت الكويت", "The sky over Kuwait right now, to the second"],
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
                    {label} <span className="grn-ar text-white/55" lang="ar">{ar}</span>
                  </span>
                  <span className="block text-[0.8rem] text-white/74">{desc}</span>
                </button>
              ))}
            </div>

            {/* Audio */}
            <h3 className="grn-label mt-7 border-b border-white/10 pb-2 text-[0.75rem]">
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
                    <span className="grn-label text-[0.75rem]">{label}</span>
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

      {/* The whole road, full screen. Opened from the minimap, closed on
          Escape or the button — and it does not pause, because it shows
          what the HUD already shows in a size you can read, and making
          it a pause would put an information screen inside the one part
          of the game where pausing has rules. */}
      {mapOpen && roadMap && (
        <RoadMapView
          map={roadMap}
          liveRef={hudMapRef}
          onClose={() => setMapOpen(false)}
        />
      )}

      {/* Garage */}
      {garageOpen && garage && (
        <Garage
          garage={garage}
          onClose={() => setGarageOpen(false)}
          onBuyCar={buyOrDrive}
          onSellCar={onSellCar}
          onBuyPart={buyOrEquip}
          onTint={setTint}
        />
      )}

      {/* Champion */}
      {phase === "champion" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
          <div className="grn-dialog w-full max-w-xl px-10 py-10 text-center">
            <div className="text-sodium-400"><IconCrown size={64} /></div>
            <div className="grn-display mt-4 text-5xl italic text-sodium-400 [text-shadow:0_0_34px_rgba(245,165,36,0.75)] sm:text-6xl">
              KING OF GULF ROAD
            </div>
            <div className="grn-ar mt-3 text-2xl text-white/85" dir="rtl" lang="ar">
              ملك شارع الخليج
            </div>
            <div className="mx-auto mt-4 max-w-md text-[0.95rem] leading-6 text-white/65">
              Every legend on the roster defeated — from Salmiya to Jahra, the street is yours. Mabrook!
            </div>
            <button
              onClick={() => {
                engineRef.current?.resetProgress();
                setPhase("playing");
              }}
              className="grn-btn grn-btn-primary mt-8 w-full px-8 py-3.5 text-lg"
            >
              RUN IT BACK — <span className="grn-ar" lang="ar">من جديد</span>
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
            <div className="grn-label text-[0.7rem] text-sodium-400">
              Challenger · تحدي
            </div>
            <div className="grn-display mt-0.5 text-[clamp(1.6rem,6vw,2.6rem)] italic leading-none text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.9)]">
              {cine.card.name}{" "}
              <span className="grn-ar-display text-[0.9em] not-italic text-white/75" lang="ar">
                {cine.card.arabicName}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[0.8rem] text-white/70">
              <span
                className="inline-block size-3 rounded-sm border border-white/25"
                style={{ background: `#${cine.card.color.toString(16).padStart(6, "0")}` }}
              />
              <span>{cine.card.car}</span>
              <span className="text-white/62">·</span>
              <span>{cine.card.crew}</span>
              <span className="text-white/62">·</span>
              <span>
                LV {cine.card.level} <Flag code={cine.card.flag} />
              </span>
            </div>
            <div className="grn-display mt-1.5 text-[0.875rem] tracking-[0.12em] text-sodium-400">
              {cine.stake > 0 ? (
                <>
                  {cine.stake.toLocaleString()} KD EACH — ON THE LINE{" "}
                  <span className="grn-ar" lang="ar">على المحك</span>
                </>
              ) : (
                <>
                  PRIDE ONLY <span className="grn-ar" lang="ar">على الشرف</span>
                </>
              )}
            </div>
          </div>
          {/* The VS mark, centred over the seam of the lower bar */}
          <div className="cine-card absolute bottom-[calc(13vh+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 text-center">
            <div className="grn-display text-[clamp(2rem,7vw,3.4rem)] italic leading-none text-sodium-400 [text-shadow:0_0_26px_rgba(255,170,60,0.55),0_2px_18px_rgba(0,0,0,0.9)]">
              VS
            </div>
            <div className="grn-ar-display text-[0.875rem] text-white/60" lang="ar">ضد</div>
          </div>

          {/* Your side of the frame, mirrored on the right bar */}
          {cine.you && (
            <div className="cine-card absolute bottom-[calc(11vh+env(safe-area-inset-bottom))] right-[calc(env(safe-area-inset-right)+1.25rem)] text-right">
              <div className="grn-label text-[0.7rem] text-gulf-300">
                You · <span className="grn-ar" lang="ar">أنت</span>
              </div>
              <div className="grn-display mt-0.5 text-[clamp(1.6rem,6vw,2.6rem)] italic leading-none text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.9)]">
                {cine.you.name}
              </div>
              <div className="mt-1 flex items-center justify-end gap-2 text-[0.8rem] text-white/70">
                <span>
                  LV {cine.you.level} <Flag code={cine.you.flag} />
                </span>
                <span className="text-white/62">·</span>
                <span>{cine.you.crew}</span>
                <span className="text-white/62">·</span>
                <span>{cine.you.car}</span>
                <span
                  className="inline-block size-3 rounded-sm border border-white/25"
                  style={{ background: `#${cine.you.color.toString(16).padStart(6, "0")}` }}
                />
              </div>
            </div>
          )}
          <div className="grn-label cine-skip absolute bottom-[calc(3vh+env(safe-area-inset-bottom))] right-[calc(env(safe-area-inset-right)+1.25rem)] text-[0.7rem] text-white/74">
            tap to skip ▸▸
          </div>
        </button>
      )}

      {/* Pause menu — Escape or the controller's Start button */}
      {pauseOpen && phase === "playing" && !garageOpen && !settingsOpen && !result && (
        <div
          className="glass-scrim absolute inset-0 z-[28] flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Paused"
        >
          <div className="grn-dialog-glass screen-in w-[min(400px,92vw)] p-6 text-center">
            {/* gulf-300, not gulf-400: measured on the pause glass the darker
                step lands at 3.27:1, under the 4.5 floor check:menus
                enforces. A label nobody can read is not a quieter
                label, it is a missing one. */}
            <div className="grn-label text-[0.7rem] tracking-[0.4em] text-gulf-300">Paused</div>
            <div className="grn-display mt-1 text-3xl italic">
              PIT STOP <span className="grn-ar not-italic text-white/60" lang="ar">وقفة</span>
            </div>
            {/* The controls live here now. The corner of the screen used
                to carry them for the whole session, which made the
                busiest box on the HUD a thing you read once. */}
            <div className="mt-4 font-display text-[0.8rem] leading-[1.5] tracking-wide text-white/70">
              W/↑ accelerate · S/↓ brake · A D steer
              <br />Space drift · N nitro · F flash
              <br />M mute · B music · V voices · gamepad supported
            </div>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                onClick={() => setPauseOpen(false)}
                className="grn-btn grn-btn-primary tap w-full px-6 py-3.5 text-base"
              >
                RESUME — <span className="grn-ar" lang="ar">كمّل</span>
              </button>
              <button
                onClick={() => {
                  setPauseOpen(false);
                  setGarage(loadGarage());
                  setGarageOpen(true);
                }}
                className="grn-btn grn-btn-ghost tap w-full px-6 py-3 text-sm"
              >
                GARAGE
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="grn-btn grn-btn-ghost tap w-full px-6 py-3 text-sm"
              >
                SETTINGS
              </button>
              <button
                onClick={exitToMenu}
                className="grn-btn tap w-full border border-rose-400/50 px-6 py-3 text-sm text-rose-200 hover:bg-rose-500/15"
              >
                EXIT TO MENU
              </button>
            </div>
            <p className="grn-label mt-4 text-[0.7rem] text-white/66">
              Esc / gamepad Start to resume · progress is saved
            </p>
          </div>
        </div>
      )}

      {/* Loading — the engine build takes a beat on a phone */}
      {phase === "loading" && (
        <div className="safe-pad absolute inset-0 z-20 flex flex-col items-center justify-center menu-backdrop">
          <div className="grn-label text-[0.7rem] tracking-[0.45em] text-gulf-400">
            Warming up
          </div>
          <div className="grn-display mt-2 text-[clamp(1.4rem,6vw,2.2rem)] italic">
            BUILDING THE CORNICHE
          </div>
          <div className="grn-ar mt-1 text-sm text-white/74" lang="ar">جاري تجهيز الشارع</div>
          <div className="grn-meter mt-5 h-2 w-[min(320px,70vw)]">
            <div className="h-full w-1/3 animate-pulse bg-gradient-to-r from-gulf-500 to-gulf-300" />
          </div>
          <div className="mt-6 w-[min(420px,80vw)] space-y-2">
            <div className="skeleton h-3 w-2/3" />
            <div className="skeleton h-3 w-1/2" />
          </div>
          <p className="mt-6 max-w-sm text-center text-[0.8rem] leading-5 text-white/66">
            Tip: flash your headlights three times behind a rival to start a
            battle — the trailing car loses SP.
          </p>
        </div>
      )}

      {/* Error — never leave a black screen unexplained */}
      {phase === "error" && (
        <div className="safe-pad absolute inset-0 z-30 flex items-center justify-center bg-night-950/95 px-6">
          <div className="grn-dialog w-[min(460px,92vw)] p-6 text-center">
            <div className="grn-display text-3xl italic text-sodium-400">!</div>
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
