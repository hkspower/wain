import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { pixelRatioFor, bufferFor, type Resolution } from "./render";
import { HANDLING } from "./handling";
import { nextView, viewSpec, type CameraView } from "./views";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import { Track, ROAD_HALF_WIDTH, LANES, DRIFT_PLAZA, COAST_U, STATIONS, FORECOURT } from "./track";
import { buildWorld, areaAt, roadAt, nextAreaAt, AREAS, LANDMARK_S, STREETS, WorldHandle } from "./world";
import { createCar, crownShell, CROWN, setContactStrength, TAIL, TIRE_RADIUS } from "./cars";
import { RIVALS, RivalDef } from "./rivals";
import { VoiceBox } from "./voice";
import { SoundEngine } from "./sound";
import { ParticleSystem, radialSprite } from "./vfx";
import { solveTwoBone, aimConstrained } from "./ik";
import { nightEnvironment } from "./env";
import { RIG } from "./rig";
import { paceDelta, newPaceState, refreshFromIntervals, type PaceState } from "./pacing";
import { textTexture, arabicUI } from "./text";
import { GradeShader, AutoExposure, ExposurePass } from "./grade";
import type { DriverRig } from "./characters";
// The driver pose lives in its own module now: the menu's rolling intro
// and the showroom put a rigged driver in the seat too, and a private
// method is only available to whoever already has an engine running.
import { solveDriverRig } from "./driver";
import { FLAGS, FLAG_IDS, flagTexture } from "./flags";
import { verticalFov, chaseDolly, RACE_DOLLY } from "./aspect";
import { gripAtSpeed, newLoadState, solveLoad, type LoadResult } from "./grip";
import { bestTow, solveTow, NO_TOW, TOW_REACH, type TowInput, type TowResult } from "./slipstream";
import { buildRoadMap, nextStation, type RoadMap } from "./roadmap";
import {
  kuwaitHours,
  RACE_OPEN_H as CLOCK_RACE_OPEN_H,
  RACE_CLOSE_H as CLOCK_RACE_CLOSE_H,
} from "./clock";
import { CHANNELS, Music, musicIntensity } from "./music";
import { Radio } from "./radio";
import {
  solveDrift,
  newDriftState,
  breakChain,
  type DriftState,
} from "./drift";
import {
  solveBrakes,
  newBrakeState,
  brakeCeiling,
  type BrakeState,
  type BrakeResult,
} from "./brakes";
import { GEARS, revFractionIn, upshiftAt } from "./gears";
import { PAD } from "./pads";
import { playerId, inviteCode, normaliseCode, isCodeShaped } from "./community";
import { distanceById, distanceMetres, DEFAULT_DISTANCE } from "./distances";
import {
  EMPTY_PROGRESS, MATCHED_KMH, MATCHED_FLOOR_KMH, MET_M, TOGETHER_M,
  loadProgress, newlyDone, questLabel, questFraction, saveProgress,
  QUESTS, type Quest, type QuestProgress,
} from "./quests";
import {
  ENGINES,
  torqueShape,
  firingHz,
  fuelLitresPerSecond,
  fuelLitresPerHour,
  FUEL_RATE,
  FUEL_FILS_PER_LITRE,
  PUMP_LITRES_PER_SEC,
  PUMP_MAX_KMH,
  rpmAt,
} from "./engines";
import { loadGarage, saveGarage, computeEffects, addKd, fuelOf, setFuel, TuneEffects, getCar, CARS, rivalsBeaten, saveRivalsBeaten, EXHAUSTS } from "./mods";
import { levelInfo, recordRace, recordLap, loadProfileStats, LevelInfo } from "./profile";

// Tokyo-Xtreme-Racer-style rules, Kuwait edition: cruise the loop, find the
// rival, flash your headlights (F) to start a battle. Both drivers have SP
// (Spirit Points); the one trailing bleeds SP, crashes bleed more. Empty
// the rival's bar to take their crown and move up the roster.

const KMH = 3.6;
const SMOKE_N = 110;
/** Pre-battle cinematic length in real seconds (shots at 1.8 / 3.6):
 *  the rival's close-up, the side-by-side two-shot at the line, and the
 *  pull up into the chase as the flag drops. */
const CINE_LEN = 14.0;

/** Where each shot ends, seconds into the film. Named rather than
 *  spelled out at every branch, because the boundaries appear in four
 *  places — the camera, the rival's formation, the test and the export
 *  — and four hand-written 2.4s drift apart the first time one moves.
 *
 *  The film is six seconds longer than it was, and the six went into
 *  new shots rather than into slower versions of the old ones. Stretching
 *  a 1.8 s orbit to 4 s does not make a longer film, it makes a slow one:
 *  what a longer cut needs is more to look at.
 *
 *    CHALLENGE  you, behind, putting three high beams into their boot
 *    ANSWER     the rival takes it — seen from in front of them, so the
 *               beams are coming at the lens and the reply is their car
 *               closing on you rather than a caption saying so
 *    ORBIT      round their machine, the shot that says who you drew
 *    FLANK      a low tracking pass down YOUR car, the reverse angle the
 *               film never had — it showed you the rival twice and your
 *               own machine only in a wide two-shot
 *    TWO-SHOT   both of them abreast at speed, names on the bars
 *    CHASE      the fall into the driving camera as the flag drops */
const CINE_CHALLENGE_END = 2.4;
const CINE_ANSWER_END = 4.6;
const CINE_ORBIT_END = 7.0;
const CINE_FLANK_END = 9.6;
const CINE_TWOSHOT_END = 12.0;

/** The challenge shot: how long the film holds behind the rival while
 *  the high beams go in. Ends when the third hit has faded. */
const CINE_FLASH_END = CINE_CHALLENGE_END;

/** When each of the three high-beam hits lands, seconds into the film.
 *
 *  Evenly spaced but not metronomic — 0.62 between the first two and
 *  0.58 between the last two, so the pattern accelerates fractionally.
 *  Three identical intervals read as a warning light; three that close
 *  up read as somebody leaning on the stalk. */
const CINE_FLASH_AT = [0.5, 1.12, 1.7];

/** How far ahead the rival runs during the challenge shot, metres. Far
 *  enough that the beams have somewhere to travel and the tail lights
 *  are a separate thing from the car, close enough to fill the frame. */
const CINE_FLASH_GAP = 15;

/** The shape of one high-beam hit, in seconds: up, held, back down.
 *
 *  The hold is what makes it read as ONE deliberate hit rather than a
 *  blink — a flash with no plateau is a glitch, a flash that sits there
 *  for a sixth of a second is somebody's hand on the stalk. */
const CINE_FLASH_RISE = 0.04;
const CINE_FLASH_HOLD = 0.15;
const CINE_FLASH_FALL = 0.19;

/**
 * How far into a high beam the film is at time `t`, 0 (dipped) to 1
 * (full main beam).
 *
 * A FUNCTION OF FILM TIME, not an animation. The first version drove
 * each hit with its own requestAnimationFrame chain, which works while
 * the film is playing and fails everywhere else: a chain outlives a
 * skip and lands a flash over the green flag, it cannot be reproduced
 * frame by frame, and it is invisible to any tool that poses the film
 * rather than watching it — the export would have rendered fourteen
 * seconds of a car that never flashed. Asking the film's own clock what
 * the lamps should be doing removes all three at once.
 */
function cineFlashBoost(t: number): number {
  let best = 0;
  for (const at of CINE_FLASH_AT) {
    const e = t - at;
    if (e < 0 || e > CINE_FLASH_RISE + CINE_FLASH_HOLD + CINE_FLASH_FALL) continue;
    const k =
      e < CINE_FLASH_RISE
        ? e / CINE_FLASH_RISE
        : e < CINE_FLASH_RISE + CINE_FLASH_HOLD
          ? 1
          : 1 - (e - CINE_FLASH_RISE - CINE_FLASH_HOLD) / CINE_FLASH_FALL;
    if (k > best) best = k;
  }
  return best;
}
/** Fallback normaliser for speed-driven camera effects, used only
 *  before a tune is applied. The live value follows the car's own
 *  governor (see topSpeedRef), so a 180 km/h hatch feels as fast at its
 *  limit as a 400 km/h flagship does at its. */
const PLAYER_TOP_SPEED = 92; // m/s ≈ 331 km/h
/** One shared empty list, so a lap with nobody else on the road does not
 *  allocate a new array sixty times a second for nothing. */
const EMPTY_MAP_OTHERS: ReadonlyArray<{ x: number; y: number; name: string }> = [];

const FLASH_RANGE = 60;

/**
 * The player's own headlight flash.
 *
 * A LEVEL READ OFF A CLOCK, the way the film's hits are — see
 * cineFlashBoost, whose comment explains why an animation that owns a
 * timer is the wrong shape for this. The player's flash was the version
 * that comment describes as replaced: a setInterval that captured
 * `this.headlight.intensity` as its baseline, toggled the lamp by
 * reading its own output, and wrote the baseline back when it finished.
 *
 * Measured, it did this at night with a dipped beam of 90:
 *
 *   one press                       peak 90  floor 0  settled 0
 *   two, 220 ms apart               peak  0  floor 0  settled 0
 *   the ritual: three, 180 ms apart peak 90  floor 0  settled 90
 *
 * Two separate faults in three lines. The lamps could be left OFF —
 * a second press captures its baseline while the first has the lamp
 * dark, and restores the dark — on the key you are required to press
 * three times in three seconds to start a race. And the brightest the
 * flash ever got was the dipped beam it started from, because it was
 * built as a blink DOWN: headlights going out, not a main beam going in.
 * A driver flashing you does not turn their lights off.
 *
 * So: up, not down. The same rise-hold-fall the film uses, because it is
 * the same gesture, and two pulses because that is what a hand on a
 * stalk actually does.
 */
const FLASH_RISE = 0.035;
const FLASH_HOLD = 0.09;
const FLASH_FALL = 0.13;
/** The second pulse of one press. */
const FLASH_PULSE_AT = [0, 0.19];
/** How far past the dipped beam a main beam reaches. Brightness alone
 *  reads as a lamp fault; the cone has to open and throw further with
 *  it, which is what the eye actually recognises as high beam. */
const FLASH_GAIN = 1.9;
const FLASH_ANGLE_GAIN = 0.22;
const FLASH_REACH_GAIN = 0.55;

function playerFlashBoost(sinceS: number): number {
  let best = 0;
  for (const at of FLASH_PULSE_AT) {
    const e = sinceS - at;
    if (e < 0 || e > FLASH_RISE + FLASH_HOLD + FLASH_FALL) continue;
    const k =
      e < FLASH_RISE
        ? e / FLASH_RISE
        : e < FLASH_RISE + FLASH_HOLD
          ? 1
          : 1 - (e - FLASH_RISE - FLASH_HOLD) / FLASH_FALL;
    if (k > best) best = k;
  }
  return best;
}
/** Seconds one press lasts, end to end. */
const FLASH_LEN = FLASH_PULSE_AT[FLASH_PULSE_AT.length - 1] + FLASH_RISE + FLASH_HOLD + FLASH_FALL;

export interface BattleHud {
  playerSp: number;
  rivalSp: number;
  rivalName: string;
  rivalArabic: string;
  rivalCrew: string;
  /** How long this race is, in km. */
  raceKm: number;
  /** How much of it is left. A finish line nobody can see is not a
   *  finish line — an SP fight that suddenly ends would read as a bug. */
  leftKm: number;
}

export interface HudData {
  /** Headlight flashes landed so far in the current challenge window (0-3). */
  flashCount: number;
  speedKmh: number;
  areaName: string;
  areaArabic: string;
  /** The road, and its nickname where this stretch has one. The game is
   *  named after a road and never used to say which one you were on. */
  roadName: string;
  roadArabic: string;
  /** Where you are heading and how far. The road line and the district
   *  line both name places you have already arrived at; this is the only
   *  part of the plate that is a guide rather than a caption. */
  nextArea: string;
  nextArabic: string;
  nextInM: number;
  roadNick: string | null;
  roadNickArabic: string | null;
  /** The game clock, 0..24, and whether a race can be started right
   *  now. The window is the rule the whole night runs on, so the HUD
   *  has to be able to say it. */
  hour: number;
  racingOpen: boolean;
  rivalDist: number | null;
  /** True when there is a driver close enough to read — the prompt. */
  canSizeUp: boolean;
  canFlash: boolean;
  battle: BattleHud | null;
  defeated: number;
  total: number;
  /** Everything a map needs that changes from frame to frame. The road
   *  itself does not — it comes from engine.getRoadMap(), once. */
  map: {
    /** You, in 0..1 of the map's square box. */
    px: number;
    py: number;
    /** The rival, or -1 when there is not one. */
    rx: number;
    ry: number;
    /** Which way you are pointing, radians in map space. */
    facing: number;
    /** Metres from the start line. */
    s: number;
    /** Metres to the next petrol station, going forwards. */
    toPump: number;
    /** Other drivers online. Empty, and the same empty array every
     *  frame, when nobody else is on the road. */
    others: ReadonlyArray<{ x: number; y: number; name: string }>;
  } | null;
  /** Nearest online player within challenge range, if any. */
  nearestRemote: { id: number; name: string; dist: number } | null;
  /** Live PvP duel state, or null when not duelling. */
  duel: { you: number; them: number; gap: number; opponent: string } | null;
  /** The online run in front of the player right now — name, one line of
   *  what to do, and how far along it is. Null when every run is done.
   *  The HUD only shows it while there is somebody else out there. */
  run: {
    name: string;
    ar: string;
    hint: string;
    hintAr: string;
    /** "3 / 5", "4.2 / 10 km" — questLabel does the formatting. */
    label: string;
    frac: number;
  } | null;
  /** How deep the car is sitting in another car's wake, 0..1.
   *
   *  On the HUD because an invisible advantage is not a mechanic. The
   *  drag saving is real either way, but a driver who cannot see it has
   *  no reason to go looking for it, and finding it is the interesting
   *  part. */
  tow: number;
  /** Turbo boost 0..1, or null when no turbo is fitted. */
  boost: number | null;
  /** NOS charge 0..1, or null when no kit is fitted. */
  /** null when no NOS is fitted. `charge` is 1 full, 0 spent. */
  nos: { charge: number; firing: boolean; ready: boolean } | null;
  /** The tank: litres left, litres it holds, and whether the engine has
   *  already stopped for want of any. */
  fuel: { litres: number; capacity: number; dry: boolean };
  /** Set while the car is on a forecourt slow enough to fill up. */
  pump: { litres: number; capacity: number; costKd: number; filling: boolean } | null;
  /** Live drift readout — non-null while sliding (and briefly after).
   *  `chain` is the link multiplier; `spinning` means it got away. */
  drift: {
    deg: number;
    score: number;
    active: boolean;
    chain: number;
    spinning: boolean;
  } | null;
  /** Brake state the driver needs to see: locked wheels, ABS, fade. */
  brakes: { lock: number; fade: number; abs: boolean };
  /**
   * The rev counter, from the engine's own needle.
   *
   * The HUD used to work its own revs out of the speed with
   * `revFraction()`, which is the pure gearbox function and knows
   * nothing about the clutch: at a standing launch it read zero while
   * the engine was screaming at the torque peak. This is the SAME
   * fraction the torque curve integrated this frame, turned into rpm
   * against this car's own idle and redline, so a four-cylinder that
   * spins to 8,400 and a V8 that stops at 6,200 get different dials
   * rather than the same bar with different numbers on it.
   */
  tach: {
    rpm: number;
    idle: number;
    redline: number;
    /** 0..1 across the rev range — what the needle sweeps. */
    frac: number;
    /** 1-based, or 0 for neutral at a standstill. */
    gear: number;
    /** True inside the last of the range, where you should be shifting. */
    shift: boolean;
    /** How hard the engine is against its rev limiter, 0..1. Stays at
     *  zero for the whole life of an engine the box changes up early —
     *  which is most of them, and the point of EngineSpec.shiftAt. */
    limiter: number;
  };
}

export interface DriverCard {
  name: string;
  arabicName?: string;
  crew: string;
  level: number;
  country: string;
  flag: string;
  color: number;
  /** Machine on the line. */
  car: string;
}

/**
 * Everything the game knows about a rival, for the player who wants to
 * know it BEFORE committing.
 *
 * All of this already existed on the challenge card — and the challenge
 * card only appears after you have already flashed. Sizing somebody up
 * is what the ritual is for: you pull alongside, you have a look, and
 * then you decide.
 */
export interface RivalDossier {
  name: string;
  arabicName: string;
  crew: string;
  area: string;
  country: string;
  flag: string;
  car: string;
  /** Overall length of the machine they bring, metres, when it is one
   *  the showroom also sells. */
  lengthM: number | null;
  topSpeedKmh: number;
  /** Where they sit on the roster, and how long the roster is. */
  order: number;
  total: number;
  beaten: boolean;
  taunt: string;
  color: number;
  accent: number;
  /** Metres up the road, signed: negative means they are behind you. */
  gap: number;
}

/** How close you have to be to read a driver: about fifteen car lengths.
 *  Close enough that you are plainly alongside, far enough that it is
 *  not a knife fight. */
const SIZE_UP_RANGE = 60;

/** One line of the post-race reward reel. */
export interface RewardLine {
  /** An icon NAME the UI draws (see race/Icons.tsx), never a glyph:
   *  an emoji here is artwork chosen by the operating system. */
  icon: string;
  title: string;
  sub: string;
}

/** Everything the results sequence needs, computed once when a race ends. */
export interface RaceResult {
  outcome: "win" | "loss";
  /** 1st or 2nd — the podium line at the top of the card. */
  position: 1 | 2;
  rival: DriverCard;
  /** KD staked by each side. */
  purse: number;
  /** Signed KD change (prize + purse, or the purse lost). */
  kd: number;
  balance: number;
  xpGain: number;
  /** Level bar before and after the XP is applied — drives the fill. */
  levelBefore: LevelInfo;
  levelAfter: LevelInfo;
  /** How the XP was earned, itemised. */
  xpBreakdown: Array<{ label: string; value: number }>;
  stats: {
    topSpeedKmh: number;
    durationMs: number;
    contacts: number;
    clean: boolean;
    /** Biggest SP gap held over the rival, 0..100. */
    maxLeadSp: number;
    distanceM: number;
  };
  career: { races: number; wins: number; streak: number; bestStreak: number };
  rewards: RewardLine[];
  champion: boolean;
  /** Who is waiting next, when the roster continues. */
  nextRival: { name: string; arabicName: string; crew: string } | null;
}

export interface EngineEvents {
  onHud(d: HudData): void;
  onMessage(title: string, sub?: string): void;
  onBump(): void;
  onDefeat(rival: RivalDef): void;
  onChampion(): void;
  /** Fired when a full lap is completed, with the lap time in ms. */
  onLap?(ms: number): void;
  /** The needle has just arrived on the limiter. One event per arrival,
   *  not one per frame while it sits there — the shell answers this
   *  with a vibration, and a pad asked to rumble sixty times a second
   *  simply stops rumbling. */
  onLimiterHit?(): void;
  /** Fired the moment a battle begins — drives the VS splash. */
  onBattleStart?(rival: RivalDef): void;
  /** Three flashes landed: both cars revealed, race setup opens. */
  onChallenge?(
    player: DriverCard,
    rival: DriverCard,
    maxWager: number,
    /** The length this rival calls you out at — what the card opens on. */
    distanceId: string
  ): void;
  /** The rival's answer to the challenge. */
  onChallengeResult?(accepted: boolean, reason: string): void;
  /** A race ended — drives the full results sequence. */
  onResult?(r: RaceResult): void;
  /** Pre-battle cinematic begins/ends — drives the letterbox and the
   *  versus cards. `stake` is the KD each side has up (0 = pride only);
   *  `you` is the player's own card for the right side of the VS frame. */
  onCinematic?(active: boolean, rival: DriverCard, stake: number, you?: DriverCard): void;
  /** The controller's Start button — the UI opens its pause menu. */
  onPauseRequest?(): void;
  /** An online run just finished. Fired once, on the frame it crossed —
   *  the UI pays the reward and says so. */
  onRunDone?(q: Quest): void;
}

interface RemotePlayer {
  name: string;
  mesh: THREE.Group;
  s: number;
  lat: number;
  snapS: number;
  snapLat: number;
  snapSpeed: number;
  snapAt: number;
  /** Smoothed visible steer for the remote car's driver rig. */
  steerVis: number;
  /**
   * Acceleration, differenced from consecutive snapshots.
   *
   * The wire carries a speed and a time. Two of those are an
   * acceleration, and it was being thrown away: a remote player braking
   * hard for the roundabout showed a driver sitting perfectly still.
   * This is the only longitudinal kinematics available for a car whose
   * inputs are on somebody else's machine, so it is worth taking.
   */
  accel: number;
  /** Smoothed brake pressure for the rig. */
  brakeVis: number;
}

interface TrafficCar {
  mesh: THREE.Group;
  s: number;
  lat: number;
  speed: number;
  /** Smoothed visible steer for this car's driver. */
  steerVis: number;
  /**
   * What this car did to its own speed last frame, m/s^2.
   *
   * Traffic brakes — up to 6 m/s^2 when it closes on a slower car in
   * its own lane — and its driver was being solved with a hard-coded
   * zero for both brake and longitudinal g, so a civilian standing on
   * the pedal behind a bus sat bolt upright with their foot in the air.
   * The code that solves them complains, correctly, that "a body that
   * never answers the corner is the difference between a person driving
   * and a mannequin being carried along"; this is the same sentence
   * about the other axis.
   */
  accel: number;
  /** Smoothed brake pressure, so the fold does not snap on and off. */
  brakeVis: number;
  /** Seconds of SIMULATED time since this car's rig was last solved.
   *  Sim time and not wall clock, deliberately: tests drive update(1/60)
   *  in tight loops where each frame takes milliseconds of wall time,
   *  and a wall-clock ease would run five to fifteen times slow there. */
  rigDt: number;
}

interface Rival {
  def: RivalDef;
  mesh: THREE.Group;
  s: number;
  lat: number;
  targetLat: number;
  speed: number;
  sp: number;
  state: "cruise" | "battle" | "defeated";
  // What the rival's driver is seen doing: smoothed steer and pedal
  // work derived from the AI's own kinematics, fed to the same IK that
  // animates the player's driver.
  steerVis: number;
  throttleVis: number;
  brakeVis: number;
}

/** Traffic drivers are solved inside this range — stalest first, so
 *  every in-range driver keeps updating; see solveTrafficDrivers. */
const TRAFFIC_DRIVER_RANGE = 120;
const TRAFFIC_DRIVERS_SOLVED = 6;

/**
 * How many civilians share the road.
 *
 * Raised from 30. Every one of them now carries a driver rig, and the
 * measurement that made this safe was that thirty of those cost no draw
 * calls at all once the steering spokes came off the lean build — so
 * the ceiling here is not the GPU, it is the O(n^2) scan below where
 * each car checks every other for the one ahead in its lane. At 46 that
 * is ~2,100 comparisons a frame against a CPU update budget measured at
 * 1 ms median, which is room to spare; at a few hundred cars it would
 * need a lane bucket instead of a nested loop.
 */
const TRAFFIC_COUNT = 46;

const TRAFFIC_COLORS = [0x8a96a3, 0x5d6770, 0xb0a890, 0x6e7f8d, 0x4a5560, 0x9c8f7a];

// Unsharp-mask crispening + film vignette + animated grain, in linear
// space before output.
/**
 * How fast the throttle must close for the exhaust to bang, in pedal
 * travel per second. Above BURBLE_LIFT_RATE in sound.ts, deliberately:
 * easing off burbles, snapping off bangs, and the two thresholds are
 * the only thing separating them.
 */
/** The jolt when the needle first arrives on the limiter. Same scale as
 *  a kerb strike (0.55) and a light contact (0.3), and deliberately
 *  under both: it is the engine talking, not the road. */
const LIMITER_HIT_SHAKE = 0.26;
/** The sustained buzz while it sits there, scaled by how hard. Small —
 *  a limiter you cannot drive through is a broken car, not a fast one. */
const LIMITER_BUZZ_SHAKE = 0.07;

const BACKFIRE_LIFT_RATE = 6;
/** One lift, one bang. Seconds. */
const BACKFIRE_LOCKOUT = 0.25;

// Final grade: unsharp crispen, vignette, luminance-weighted grain, then a
// hard black point. Order matters — the black point runs last so nothing
// downstream can lift the shadows back up.
/** Spin a car's wheels with road speed; fronts also take a steer angle. */
/**
 * Roll the wheels.
 *
 * The rate is the real one, omega = v / r against the tire's own 0.36 m
 * radius, but a wheel is not always doing v / r. Two cases matter and
 * both are things the player is deliberately causing:
 *
 *   `lock` — a wheel past the tire's limit under braking has stopped
 *   turning and is sliding. Everything else already said so — the smoke,
 *   the squeal, the stopping distance — and four wheels spinning happily
 *   through a locked stop was the one thing still giving it away.
 *
 *   `spin` — torque the driven axle could not put down. Only the REAR
 *   wheels get it: a burnout with all four spinning is a four-wheel-drive
 *   car, and none of these are.
 */
function spinWheels(
  car: THREE.Object3D,
  speed: number,
  dt: number,
  steer = 0,
  lock = 0,
  spin = 0
): void {
  const wheels = car.userData.wheels as THREE.Group[] | undefined;
  if (!wheels) return;
  // The radius THIS car's wheels actually have, recorded by createCar
  // after the silhouette's scale and its length fit. It used to be the
  // constant 0.36 — the radius in the car's own units, correct until
  // every car was fitted to its real length in metres, after which the
  // wheels were between 5.5% and 21.8% out and quietly skidding.
  const R = (car.userData.wheelR as number | undefined) ?? TIRE_RADIUS;
  const rolling = speed * (1 - lock);
  for (let i = 0; i < wheels.length; i++) {
    const driven = i >= 2; // 0,1 front · 2,3 rear
    const surface = rolling + (driven ? spin * 0.8 : 0);
    wheels[i].rotation.x += (surface / R) * dt;
    if (i < 2) wheels[i].rotation.y = steer;
  }
}

/**
 * The headlight splash on the asphalt: two overlapping lobes rather than
 * one blob, because a car has two lamps and the pair reads as a wide hot
 * bar near the bumper that merges into a single pool further out. The
 * near edge is cut off sharply — light does not wrap back under the car.
 */
function headlightPoolTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  // v runs 0 at the near (bumper) edge to 1 far up the road
  const lobe = (cx: number, cy: number, rx: number, ry: number, a: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    // Sampled, not three stops. At 0.42 of peak still 45% of the way
    // out, each lobe was a plateau with a soft rim, and the pair read as
    // a hard-edged wedge painted on the road rather than as light
    // falling on it. This is broader than a point source — it is light
    // landing on tarmac — but it still has to decay the whole way.
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const f = (1 - t * t) ** 1.9;
      g.addColorStop(t, `rgba(255,${Math.round(248 - 12 * t)},${Math.round(222 - 32 * t)},${(a * f).toFixed(4)})`);
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  ctx.globalCompositeOperation = "lighter";
  // Two lamp lobes, splayed and reaching up the road
  lobe(S * 0.36, S * 0.56, S * 0.3, S * 0.42, 0.5);
  lobe(S * 0.64, S * 0.56, S * 0.3, S * 0.42, 0.5);
  // The shared hot spot where both beams overlap
  lobe(S * 0.5, S * 0.44, S * 0.26, S * 0.3, 0.34);
  // Fade the very near edge so the pool does not start under the nose
  const cut = ctx.createLinearGradient(0, S, 0, S * 0.74);
  cut.addColorStop(0, "rgba(0,0,0,1)");
  cut.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = cut;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Length-wise gradient for the visible beam cone. A cone painted a flat
 * colour reads as a solid wedge of plastic; real light in dusty air is
 * brightest at the lamp and dissolves as it spreads.
 */
function beamGradientTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  // The cone is additive and double-sided, so the eye sums both walls —
  // and those walls converge at the apex, piling the accumulation into a
  // bright dome sitting on top of the car. So the shaft fades to nothing
  // at BOTH ends: out at the apex to kill that dome, and out at the far
  // end where the light should dissolve into the night.
  // v runs 0 at the wide far end to 1 at the apex. The profile is kept
  // deliberately FLAT between the end fades: from the chase camera you
  // look straight down the cone's axis, and any peak along its length
  // accumulates into a defined bright lens floating over the road. Even
  // haze reads as air; a shaped core reads as a solid object.
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0.0, "rgba(255,238,195,0)"); // far end, dissolved
  g.addColorStop(0.22, "rgba(255,242,205,0.5)");
  g.addColorStop(0.78, "rgba(255,244,210,0.55)");
  g.addColorStop(1.0, "rgba(255,244,210,0)"); // apex, hidden at the lamp
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Floating name banner above an online player's car.
 *
 * Players on a Kuwaiti server type their names in Arabic, and this drew
 * them in a bare `sans-serif` on a raw canvas — the exact failure
 * text.ts was written to prevent. Two things went wrong at once: the
 * generic face has no Arabic coverage, so the shaper fell back per
 * glyph and the letters came out unjoined; and a raw canvas is painted
 * once and uploaded to the GPU, so even after the real face loaded the
 * texture kept whatever it had. textTexture() repaints when the fonts
 * land, and the Arabic stack now carries the Latin face after it, so
 * one call covers a name in either script or a name in both.
 */
function makeNameTag(name: string): THREE.Sprite {
  const tex = textTexture(256, 64, (ctx) => {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.roundRect(8, 10, 240, 44, 12);
    ctx.fill();
    ctx.fillStyle = "#7ee8ff";
    ctx.font = `700 28px ${arabicUI()}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name.slice(0, 16), 128, 33);
  });
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  sprite.scale.set(5, 1.25, 1);
  sprite.position.y = 3;
  return sprite;
}

/**
 * What each moment of the game looks like.
 *
 * Tints are normalised against their own luma before use, so a look
 * changes the COLOUR of the frame and not its exposure — otherwise
 * "cool for a battle" would also mean "darker for a battle", and the
 * player would read it as the sun going in.
 */
export type Situation = "cruise" | "challenge" | "battle" | "win" | "lose";

interface Look {
  tint: THREE.Vector3;
  sat: number;
  contrast: number;
}
const balance = (r: number, g: number, b: number): THREE.Vector3 => {
  const v = new THREE.Vector3(r, g, b);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return v.multiplyScalar(1 / l);
};
const SITUATION_LOOKS: Record<Situation, Look> = {
  // The road at night, as graded. Everything else is a departure from
  // this and comes back to it.
  cruise: { tint: balance(1, 1, 1), sat: 1, contrast: 1 },
  // A rival has looked at you. Warmer and a touch harder — the sodium
  // comes up, the moment leans in.
  challenge: { tint: balance(1.05, 1.0, 0.95), sat: 1.06, contrast: 1.04 },
  // The fight. Cool and hard, with the colour pulled back: the street
  // stops being scenery and becomes the thing you are working against.
  // Measured, not guessed: at sat 0.88 with a stronger cast the frame's
  // chroma did not move at all, because a blue wash ADDS distance from
  // grey at the same rate the desaturation removed it. The cast is
  // gentler now and the drain deeper, so the street's sodium actually
  // recedes instead of merely turning blue.
  battle: { tint: balance(0.96, 0.99, 1.07), sat: 0.74, contrast: 1.13 },
  // Won. Warm and open, the one moment in the game that is allowed to
  // look generous.
  //
  // The saturation went from 1.18 to 1.30 when the contrast curve
  // changed shape. These looks were tuned against a one-sided gamma
  // about a mid-grey pivot, which ran bright pixels past 1.0 and let the
  // knee compress them — and a compressed highlight has lost chroma, so
  // a warm cast had plenty of room to put some back. The S-curve lands
  // those pixels below 1.0 with their colour intact, so the same cast
  // adds less: measured, the win's lift over cruise fell from a clear
  // step to 2%. This is that step, restored against the new curve.
  win: { tint: balance(1.11, 1.02, 0.91), sat: 1.3, contrast: 0.99 },
  // Lost. The colour goes out of it. Not dark — drained, which is worse.
  lose: { tint: balance(0.98, 0.99, 1.02), sat: 0.5, contrast: 0.92 },
};

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private track = new Track();
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private paused = false;

  private keys = new Set<string>();
  /** On-screen (touch) controls, merged with the keyboard. */
  private touch = { throttle: 0, brake: 0, steer: 0, drift: false };
  // Gamepad: polled every frame, merged into the same input model as
  // keys/touch. Sticks steer, triggers drive, face buttons do the rest.
  private pad = { steer: 0, throttle: 0, brake: 0, drift: false, nos: false };
  private padButtons: boolean[] = [];
  private padSeen = false;
  /** RAF throttles hard on hidden/paused pages; a timer keeps the Start
   *  button responsive there. Edges are consumed per poll, so the two
   *  callers can never double-fire one press. */
  private padTimer: ReturnType<typeof setInterval> | null = null;
  private events: EngineEvents;

  // Player — spawns just past the start-line gantry
  private player = { s: 40, lat: LANES[1], speed: 0, sp: 100 };
  private playerMesh: THREE.Group;
  private carBody: THREE.Group;
  private headlight: THREE.SpotLight;
  /** The off-side lamp. No shadow map — one caster is plenty and two
   *  sources are what make the pair visibly diverge and cross. */
  private headlightR!: THREE.SpotLight;
  /**
   * What the lamps are bolted to.
   *
   * The lights, their targets and the visible cones all used to hang off
   * playerMesh, which is the ROAD frame — it sits on the track and looks
   * down the tangent. The car's own attitude lives on carBody: its yaw
   * (including how far the tail is out), its dive under braking, its
   * roll in a corner. So the beams pointed down the road no matter what
   * the car was doing. Sideways at forty degrees of drift, the lamps
   * still lit the lane ahead.
   *
   * This node carries carBody's rotation and nothing else, so everything
   * on it is bolted to the shell the way a headlamp is. It is a sibling
   * of carBody rather than a child of it because applyGarage() destroys
   * and rebuilds carBody on every car change, and anything parented to
   * it would go with it.
   */
  private lampRig!: THREE.Group;
  /** The light on the asphalt. Stays flat on the road — it is where the
   *  beam LANDS, not part of the car — but follows the aim. */
  private poolPivot!: THREE.Group;
  private pool!: THREE.Mesh;
  /** Adaptive front lighting: how far the lamps have swivelled into the
   *  corner, in target-metres of lateral offset. Damped, so it leans
   *  rather than twitches. */
  private lampSwivel = 0;
  /** The two visible cones, so they can be moved onto the car's lamps. */
  private beams: THREE.Mesh[] = [];
  /** Visible beam cones — flared with the lamps during the flash ritual. */
  private beamMat: THREE.MeshBasicMaterial | null = null;
  private beamBaseOpacity = 0.05;
  /** When the current flash started, in seconds of performance time.
   *  Negative infinity means the stalk has never been touched. */
  private flashStart = -Infinity;
  /** The dipped beam, as the clock last set it. Every flash is measured
   *  from HERE rather than from whatever the lamp happened to be doing,
   *  which is the whole of the bug this replaced. */
  private lampRest: {
    spot: number; off: number; angle: number; reach: number;
    emissive: number; glow: number[];
  } = { spot: 90, off: 54, angle: 0.32, reach: 95, emissive: 0, glow: [] };
  /** The night-time values the daylight response scales down from. */
  private beamBaseOpacityNight = 0.05;
  private headlightBase = 1;
  private beamCamDir = new THREE.Vector3();
  private beamCarDir = new THREE.Vector3();
  // Live reflection probe: a low-res cube camera rides with the player so
  // streetlights, towers and neon actually sweep across the paint.
  private cubeRT!: THREE.WebGLCubeRenderTarget;
  private cubeCam!: THREE.CubeCamera;
  /** Every car in the scene — player, rival, traffic, other players — so
   *  one reflection policy dresses all of them. See dressReflections. */
  private carGroups = new Set<THREE.Object3D>();
  private cubeFrame = 0;
  private liveReflections = true;
  // Dynamic resolution: a continuous governor scales the internal render
  // resolution to hold frame rate; the tier sets the ceiling.
  //
  // The ratio is DERIVED now rather than assigned. It used to be written
  // in three places — the constructor, the quality tier and the auto
  // governor — and each of them owned it until the next one ran, so a
  // window resize silently reverted whatever the last one had decided.
  // resize() computes it from the three things that actually determine
  // it: the chosen resolution, the tier's ceiling, and the governor.
  private resolution: Resolution = "native";
  /** The quality tier's ceiling on NATIVE. An explicit resolution is not
   *  subject to it — see pixelRatioFor. */
  private tierRatioCap = 2;
  /** Ultra supersamples: render above the panel and let the downsample
   *  do the anti-aliasing. Multiplies the native ratio only. */
  private tierRatioBoost = 1;
  private renderScale = 1;
  private drsEnabled = true;
  private drsAt = 0;
  /** Biggest buffer the GL stack will allocate, either axis. */
  private maxBuffer = 4096;

  private traffic: TrafficCar[] = [];
  /** The wake the player is sitting in this frame — see slipstream.ts. */
  private tow: TowResult = NO_TOW;
  private rival: Rival | null = null;
  private rivalIndex = 0;
  private inBattle = false;
  /** 0 cruising, 1 racing — the eased weight behind the race framing, so
   *  the camera walks in rather than cutting. */
  private raceFrame = 0;
  /** One critical-SP radio call per battle, not one per frame. */
  private spWarned = false;
  private locked = false; // input locked after defeat / championship

  // Challenge ritual: three headlight flashes inside a rolling window
  private flashCount = 0;
  private flashWindowUntil = 0;
  private challengePending = false;
  private challengeTimers: ReturnType<typeof setTimeout>[] = [];
  private challengePace = 0;
  private challengeAccepted = false;
  /** KD staked on the current race (each side puts it up). */
  private wager = 0;
  /**
   * How long the current race is, as an id from distances.ts, and the
   * same in metres so the hot loop is not looking it up every frame.
   *
   * Set when the challenge is confirmed; the rival's own signature
   * distance is the default the card opens on.
   */
  private raceDistanceId = DEFAULT_DISTANCE;
  private raceDistanceM = distanceMetres(DEFAULT_DISTANCE);
  /** Per-battle telemetry, reset at the green light, read at the finish. */
  private bstat = { startAt: 0, dist: 0, topSpeed: 0, contacts: 0, maxLead: 0, driftScore: 0 };

  /** Set when a film ends; cleared the first frame nothing is held. */
  private handbrakeStale = false;

  // Drift: the handbrake breaks the rear loose. driftYaw is how far the
  // body points past the direction of travel; the velocity heading is
  // dragged after it, which is what actually carries the car around.
  // The balance that holds it there — and the spin that ends one that got
  // away — live in drift.ts; this is the state it carries between frames.
  private ds: DriftState = newDriftState();
  private bs: BrakeState = newBrakeState();
  /** Last frame's brake solve, for the HUD, the squeal and the smoke. */
  private brakeOut: BrakeResult | null = null;
  /** The angle itself. An accessor rather than a field because the whole
   *  engine — camera, body pose, smoke, sound, the debug surface — reads
   *  and writes it, and the solver needs it in one object. */
  private get driftYaw(): number {
    return this.ds.angle;
  }
  private set driftYaw(v: number) {
    this.ds.angle = v;
  }
  /** The current car's governed speed in m/s — what the camera, FOV and
   *  rumble normalise against. */
  private get topSpeedRef(): number {
    return Math.max(20, (this.tune?.topSpeedKmh ?? PLAYER_TOP_SPEED * KMH) / KMH);
  }

  /** m/s² of engine torque the driven tires could NOT transmit this
   *  frame — the launch-burnout signal for wheels, smoke and power-over. */
  private wheelspin = 0;
  /** Style points for the current, still-unbanked slide. */
  private get driftRun(): number {
    return this.ds.run;
  }
  private set driftRun(v: number) {
    this.ds.run = v;
  }
  /** Seconds the readout lingers after the slide ends. */
  private driftFlash = 0;

  // Pre-battle rival cinematic: wall-clock start for the camera timeline,
  // world in slow motion underneath. Null when not playing.
  /** `hits` counts the beams whose CLICK has been played — the light
   *  itself is a function of the film's clock, see cineFlashBoost, so
   *  only the sound needs an edge to fire on. `lamps` is where the
   *  headlights rest, captured when the film starts and restored when
   *  it ends, so a skip mid-flash cannot drive into the race on main
   *  beam. */
  private cine: {
    start: number;
    r: Rival;
    hits: number;
    lamps: { spot: number; off: number; emissive: number; glow: number[]; beam: number };
  } | null = null;

  // Online cruise
  private remotes = new Map<number, RemotePlayer>();
  /** Live duel, mirrored from the hub referee for the HUD. */
  private duel: { you: number; them: number; gap: number; opponent: string } | null = null;

  // --- Runs: the online objectives. quests.ts is the design; this is
  // only the counting.
  private runs: QuestProgress = { ...EMPTY_PROGRESS };
  /** The last totals a completion was announced for. Kept so the check
   *  is `newlyDone(seen, now)` rather than a claimed flag — see the note
   *  on that function. */
  private runsSeen: QuestProgress = { ...EMPTY_PROGRESS };
  /**
   * Remote ids that have come within MET_M this session.
   *
   * Per session, not per save: a hub id is a connection, and a name is
   * whatever the player typed, so there is nothing here that could
   * honestly recognise the same stranger on two different nights. The
   * consequence is that meeting the same five people twice counts twice,
   * which makes the FIRST run slightly easier than it reads and no run
   * after it easier at all. That is the right way round for the trade.
   */
  private metThisSession = new Set<number>();
  /** True while another player is within TOGETHER_M. The drift bank
   *  reads it, and that happens earlier in the frame than the counting
   *  does, so it is a field rather than a local. */
  private besideRemote = false;
  /** Unsaved run progress, and when it was last written. Local storage
   *  is synchronous; this does not belong on every frame. */
  private runsDirty = false;
  private runsSavedAt = 0;

  // Lap timing (wall clock, credited back for pauses and film slow-mo)
  private lapStartAt = 0;
  private pausedAt = 0;
  private lapDistance = 0;

  private bumpCooldown = 0;
  private scrapeCooldown = 0;
  // Garage tuning (loaded once at engine start; edit in the menu garage)
  private tune: TuneEffects = computeEffects(loadGarage());
  private boost = 0; // turbo spool 0..1
  /** Where the needle sat this frame, 0..1 of the rev range. Shared by
   *  the torque curve, the sound and the HUD so they cannot disagree. */
  private revFrac = 0.12;
  /** The gear the box is actually holding, with hysteresis — see the
   *  shift block in the physics step. */
  private gearHeld = 0;
  /** Seconds left in the current shift, and what it is crossing from. */
  private shiftT = 0;
  private shiftFrom = 0.12;
  private shiftUp = true;
  /** How hard the car is leaning on its rev limiter, 0..1. Solved with
   *  the revs and read by both the torque cut and the sound, so the two
   *  cannot disagree about whether the ECU is cutting. */
  private revLimited = 0;
  /** The suspension's memory: how much load has moved, and where it is.
   *  Read a frame after it is written, which is the physical order —
   *  springs take a couple of tenths to compress. */
  private readonly ls = newLoadState();
  private load: LoadResult = solveLoad(newLoadState(), { dt: 1, aLong: 0 });
  /** Litres in the tank. Loaded from the car's save, written back when
   *  the session ends and every time the pump runs. */
  private fuel = fuelOf(loadGarage());
  /** Litres burned this session — what the HUD's trip figure reports. */
  private fuelBurned = 0;
  /** True once the tank is dry: the throttle stops meaning anything
   *  until there is fuel in it again. */
  private outOfFuel = false;
  /** The forecourt the car is standing on, if any, and what filling up
   *  from here would cost. Null anywhere else. */
  private pumpState: HudData["pump"] = null;
  /** KD owed for fuel already pumped this visit but not yet charged.
   *  Billed in whole fils as it flows rather than in one lump, so
   *  driving off mid-fill costs exactly what went in. */
  private pumpOwed = 0;
  private nosCharge = 1; // 0..1, drains while N is held
  private nosActive = false;
  // Handling model: heading relative to the track tangent, smoothed
  // steering input, centrifugal slip in curves, weight-transfer pitch
  private heading = 0;
  private steerSmooth = 0;
  private slipVel = 0;
  private pitch = 0;
  private pitchVel = 0;
  /** Body roll, radians. Leans out of the corner. */
  private roll = 0;
  private rollVel = 0;
  /** Slip angle last frame, for the lateral-acceleration derivative. */
  private prevBeta = 0;
  private prevSpeed = 0;
  /** Lateral acceleration this frame, m/s^2 — exposed for the HUD and
   *  the tests that assert the body leans the right way. */
  private latAccel = 0;
  /** Longitudinal acceleration this frame, m/s^2 — the driver leans on
   *  this too. */
  private longAccel = 0;
  /** How far the shell leans at the limit of grip. Real cars manage
   *  three to five degrees; a stiff one less. */
  /** The old fleet-wide lean, kept only as the fallback for a tune that
   *  predates rollMax. Every car now carries its own — see mods.ts. */
  private static readonly MAX_ROLL = 0.055;
  private fovCurrent = 62;
  private camInit = false;

  // Rendering quality
  private world: WorldHandle;
  private composer: EffectComposer;
  /** The multisampled buffer the scene is rendered into. Kept so the
   *  quality ladder can turn samples down without rebuilding the chain. */
  private msaaTarget!: THREE.WebGLRenderTarget;
  private bloomPass: UnrealBloomPass;
  private grainPass: ShaderPass;
  private autoExp!: AutoExposure;
  private exposurePass!: ExposurePass;
  private fxaaPass: ShaderPass;
  private fpsEma = 60;
  /**
   * Frame pacing. The browser hands us requestAnimationFrame, which is
   * already v-sync locked and cannot be turned off from JS — there is no
   * web API for v-sync or for G-Sync/VRR. What we CAN do is choose how
   * often we accept a frame, which is the half of the problem that
   * actually matters here.
   */
  /**
   * What this device can actually do. Ceilings were hardcoded — an 8192
   * shadow map on Ultra, a 256 cube probe — which is simultaneously too
   * large for a GPU reporting a 4096 texture limit (the allocation fails
   * or is silently clamped) and too small for one that could serve four
   * times that. Read the limits and scale to them.
   */
  private caps = {
    maxTexture: 4096,
    maxCube: 4096,
    memoryGB: 4,
    cores: 4,
  };
  private refreshHz = 0;          // measured panel refresh, 0 until known
  private refreshSamples: number[] = [];
  private frameMinMs = 0;         // 0 = accept every frame the browser offers
  private lastFrameAt = 0;
  /** Recent frame deltas, for the pacing filter. */
  private pace: PaceState = newPaceState();
  private frameCap: "display" | "vrr" | number = "display";
  private qualityLocked = false; // user took manual control with G
  private startedAt = 0;
  /** Where the key light stands, relative to what it lights. Seeded with
   *  the night direction and re-read from the world on every hour change
   *  — see syncKeyDirection. It used to be a constant, which is how the
   *  clock came to have no say in which way a shadow pointed. */
  private moonDir = new THREE.Vector3(-300, 176, 200).normalize();
  private lightRight = new THREE.Vector3();
  private lightUp = new THREE.Vector3();

  // Drift tire smoke spawn accumulator (see updateEffects)
  private sparkFx!: ParticleSystem;
  private smokeFx!: ParticleSystem;
  private flameFx!: ParticleSystem;
  /** Brake-rotor temperature, 0..1, per wheel — heat in, heat out. */
  private rotorHeat = 0;
  /** Throttle as it was on the previous simulation step, for measuring
   *  how fast the driver's foot came off. */
  private lastThrottleFx = 0;
  /**
   * How fast the throttle is closing, in pedal travel per SECOND.
   *
   * Measured ONCE per step and shared, so the flame at the exhaust tip,
   * the bang that goes with it and the decel burble are all answering
   * the same question about the same event. They used to ask it three
   * separate times against three per-frame thresholds, which is how the
   * burble could fire without the flame.
   */
  private liftRate = 0;
  /** Seconds until the exhaust may bang again. One lift is one bang:
   *  without this the detector fired on two consecutive frames as the
   *  pedal ramped through, and a 40 ms flick backfired twice at 60 fps. */
  private backfireLockout = 0;
  private smokeAcc = 0;

  // Minimap
  /** Built on first use — see getRoadMap. */
  private roadMap: RoadMap | null = null;

  // Audio
  private sound: SoundEngine | null = null;
  private music: Music | null = null;
  /** The car radio. Steps through stations; the first is the music
   *  above, so the dash still does something with no network. */
  private radio: Radio | null = null;
  private voice = new VoiceBox();

  // Camera motion
  private shake = 0; // impact jolt energy, decays
  private camBase = new THREE.Vector3(); // lerped chase position, pre-shake
  private camRoll = 0;
  /** Which shot the player is watching from. */
  private view: CameraView = "chase";
  /** Where a car-mounted camera sits and what it aims at, both children
   *  of the shell so they inherit its yaw, its dive and its lean. */
  private camAnchor: THREE.Object3D | null = null;
  private camTarget: THREE.Object3D | null = null;
  /** Scratch, like v1..v4 — allocating a quaternion a frame is how a
   *  driving game acquires a stutter it cannot find. */
  private q1 = new THREE.Quaternion();
  private curvature = 0; // signed, from the handling model
  private streaks!: THREE.LineSegments;
  private streakData: Array<{ s: number; lat: number; y: number; len: number }> = [];

  // scratch
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, events: EngineEvents, opts?: { startS?: number }) {
    this.events = events;
    if (opts?.startS !== undefined && Number.isFinite(opts.startS)) {
      this.player.s = Math.max(0, opts.startS);
    }
    // The runs carry over from every previous night. `runsSeen` starts
    // equal to them so a run finished last week is not announced and
    // paid again the moment the engine boots.
    this.runs = loadProgress();
    this.runsSeen = { ...this.runs };
    // Ask for the discrete GPU by name.
    //
    // Without this hint the browser picks the "default" adapter, and on
    // a hybrid laptop — an NVIDIA card alongside the CPU's integrated
    // graphics, which is most gaming laptops — default frequently means
    // the integrated one. The game then runs on the weaker GPU while
    // the NVIDIA card idles, and nothing in the game can tell you that
    // is happening. It is the single largest performance lever
    // available to a browser game and it costs one property.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    {
      const gl = this.renderer.getContext();
      const nav = navigator as Navigator & { deviceMemory?: number };
      // Asked before the first setSize, because it is the ceiling on it.
      // A colour target and a depth buffer at the requested size have to
      // fit, and past this they simply fail to allocate: the picture
      // goes black and nothing says why — on exactly the wide, high
      // resolution setups most likely to reach it.
      this.maxBuffer = Math.max(
        2048,
        (gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number) || 4096
      );
      this.caps = {
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
        maxCube: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE) as number,
        // deviceMemory is coarse and absent on Safari/Firefox; 4 GB is the
        // conservative read, not an optimistic one.
        memoryGB: nav.deviceMemory ?? 4,
        cores: navigator.hardwareConcurrency || 4,
      };
    }
    // Native by default: on a 4K panel this renders 4K, not an upscaled
    // 1080p. Adaptive quality drops it if the GPU cannot hold up, and
    // the resolution setting overrides both — see setResolution.
    this.renderer.setPixelRatio(this.currentRatio());
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    // Colour management on, explicitly. It has defaulted to on since
    // three r152, but every material colour in this project is authored
    // as an sRGB hex and every canvas texture is tagged sRGB — the whole
    // build assumes the renderer converts those to linear before it
    // lights them and back on the way out. Leaving that to a library
    // default is leaving the accuracy of every colour in the game to a
    // default.
    THREE.ColorManagement.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Exposure is applied by ExposurePass, in the chain, so the renderer
    // itself stays neutral — otherwise the two would multiply.
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    // PCF, not PCFSoft: three 0.184 deprecated PCFSoftShadowMap and its
    // shadow map silently overwrites the type with PCFShadowMap on the
    // first render. Asking for soft and receiving hard is worse than
    // asking for what you get — this is the filter that actually runs.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Far plane is matched to the fog, not to the track. FogExp2 at density
    // 0.0009 has hidden everything by ~2,550 m, so anything past that was
    // being rasterised for nothing. Clipping there costs no visible range
    // and buys back depth precision (near:far 5200:1 instead of 14000:1),
    // which also steadies the road markings against z-fighting.
    this.camera = new THREE.PerspectiveCamera(62, canvas.clientWidth / canvas.clientHeight, 0.6, 2600);

    this.buildEnvironment();
    this.world = buildWorld(this.scene, this.track);
    // After buildWorld, not before: the map marks the landmarks at the
    // distances the world actually placed them at, and until the world
    // exists there are none to mark.
    this.getRoadMap();

    // Moonlight shadows: a compact ortho frustum that the loop keeps
    // centred on the player, so nearby cars, rails, and poles all throw
    // long moon shadows across the asphalt.
    const moon = this.world.moonLight;
    moon.castShadow = true;
    moon.shadow.mapSize.setScalar(this.budget(4096));
    moon.shadow.camera.left = -90;
    moon.shadow.camera.right = 90;
    moon.shadow.camera.top = 90;
    moon.shadow.camera.bottom = -90;
    // The light sits MOON_DIST along its own axis from whatever it is
    // aimed at, so the casters inside a 180 m box are all within about
    // half that box's diagonal of the middle, plus the tallest thing
    // standing in it. near/far bracket exactly that and nothing else.
    //
    // It used to be 50..1000 against a scene that measured 56 m deep:
    // 5.9% of the depth range in use, which is four bits of precision
    // thrown away for nothing. Depth precision is what a shadow bias is
    // paid out of, and a bias is what detaches a shadow from the foot of
    // the thing casting it.
    // +/- 250 rather than +/- 180: the tower masts stand 427 m up, which
    // puts them 187 m nearer the light than the middle of the box, and a
    // clipped caster throws nothing at all. Their own shadows land 875 m
    // away and will never be seen — but "nothing is clipped" is an
    // invariant worth being able to state plainly, and a test that fails
    // on something harmless is a test somebody eventually deletes. The
    // margin costs a little precision and buys a rule with no asterisk.
    moon.shadow.camera.near = GameEngine.MOON_DIST - 250;
    moon.shadow.camera.far = GameEngine.MOON_DIST + 250;
    // Acne vs peter-panning: lean on normalBias (surface-slope aware)
    // rather than a large constant depth bias. Both are smaller than
    // they were, because the tightened range above pays for them.
    moon.shadow.bias = -0.00008;
    moon.shadow.normalBias = 0.025;
    // Softness. In three 0.184 the PCF path is a five-tap Vogel disk
    // rotated per pixel by interleaved gradient noise, and `radius`
    // scales it in texels — so this is a real penumbra control and not
    // the no-op it was in the versions this code was first written
    // against. At 4.4 cm per texel, 3.5 texels is about 15 cm of
    // gradient: soft enough to read as a night shadow, tight enough that
    // a car still has a recognisable outline on the asphalt.
    moon.shadow.radius = 3.5;
    this.scene.add(moon.target);
    this.syncKeyDirection();

    // Bloom makes the night work: lamps, taillights, cat-eyes and the
    // tower spheres all halo. Auto-disabled on weak machines (see loop).
    //
    // MULTISAMPLING.
    //
    // This buffer used to be single-sampled, with a note saying an MSAA
    // composer target "silently breaks the shadow-map pass on some GL
    // stacks (shadows vanish entirely)" and that FXAA would cover the
    // edges instead. FXAA does not cover them, and that is measurable:
    // tools/shots/edges.mjs walks the long geometry silhouettes in a
    // frame and asks how many pixels each one takes to cross from one
    // side to the other. With FXAA the answer got NARROWER, not wider —
    // 1.63 px against 1.88 without it — because FXAA blends ALONG an
    // edge and cannot widen its cross-section. It has no sub-pixel
    // coverage to work from, because nothing ever computed any.
    //
    // MSAA computes it. Four samples per pixel on the geometry pass is
    // the only thing in this chain that can put a genuinely
    // partially-covered pixel on a gantry leg or a lamp post, which is
    // what this scene is full of and what FXAA is worst at.
    //
    // The shadow warning is respected rather than dismissed: it is
    // TESTED. tests/shadows.mjs measures the car's own shadow by
    // difference and fails if it disappears, and it is green with this
    // on. If a GL stack somewhere still cannot do both, the tier below
    // drops back to no samples and FXAA alone.
    const drawing = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const msaaTarget = new THREE.WebGLRenderTarget(drawing.x, drawing.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.msaaTarget = msaaTarget;
    this.composer = new EffectComposer(this.renderer, msaaTarget);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Exposure sits here on purpose: after the scene, before bloom and
    // tone mapping. It is the only point in the chain where the numbers
    // are still scene-referred light rather than picture, and putting it
    // ahead of the bloom means the bloom thresholds against exposed
    // light the way a real camera's would.
    this.autoExp = new AutoExposure();
    this.exposurePass = new ExposurePass(this.autoExp);
    this.composer.addPass(this.exposurePass);
    // Comfort-tuned: enough halo to sell the sodium lamps, tight enough
    // that bright edges never smear across dark areas and tire the eye.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      0.42,
      0.4,
      0.85
    );
    this.composer.addPass(this.bloomPass);
    // OutputPass (tone map + sRGB encode) must run BEFORE the grade.
    // Grading scene-referred HDR meant the final clamp(0,1) clipped every
    // emissive above 1 — lamps, taillights and beacons lost their ACES
    // shoulder and the black point was operating in the wrong space.
    this.composer.addPass(new OutputPass());
    this.grainPass = new ShaderPass(GradeShader);
    this.composer.addPass(this.grainPass);
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaaPass);
    this.updateFxaaResolution();

    // Sparks: white-hot at birth, ember by death, and they skitter along
    // the asphalt instead of sinking through it.
    // Sparks are additive, and sixty of them overlap in the same square
    // of screen during a scrape — so each one's brightness is not what
    // reaches the eye, the SUM is. At full opacity with a near-white
    // core the pile saturated: 210 pixels pinned to pure white on a
    // single wall hit, before bloom had its turn on them. A spark is the
    // brightest thing in a night frame and should read that way, but a
    // white hole with no shape in it is not a shower of sparks.
    // Held down so a lone spark still punches and a shower stacks into
    // hot amber instead of flat paper white.
    //
    // Metered since: a full-severity scrape run twice, once with the
    // sparks drawn and once with them hidden, moves about ten pixels of
    // a 129,600-pixel frame across the clipping point. They are not
    // blowing the picture out — what makes them read hot is that they
    // are the only thing in a night frame at full luminance, and the
    // bloom threshold sits below them. Stepped down once more here
    // rather than reaching for the bloom, which the sodium lamps share.
    this.sparkFx = new ParticleSystem(140, {
      map: radialSprite(0.35, 1.4),
      colorA: 0xffdf9e, // hot, with headroom left above it
      colorB: 0xff5a12,
      blending: THREE.AdditiveBlending,
      grow: 0.5, // sparks shrink as they cool
      opacity: 0.4,
      fadeIn: 0.02,
    });
    this.scene.add(this.sparkFx.points);

    // Tire smoke: each puff expands, turns and thins on its own clock.
    this.smokeFx = new ParticleSystem(SMOKE_N, {
      map: radialSprite(0.0, 1.5),
      colorA: 0xc4c9d2,
      colorB: 0x3c4148,
      grow: 2.2,
      spin: 0.3,
      opacity: 0.13,
      fadeIn: 0.12,
    });
    this.scene.add(this.smokeFx.points);

    // Exhaust: backfire on lift, and the nitrous flame while it is open.
    this.flameFx = new ParticleSystem(90, {
      map: radialSprite(0.25, 1.2),
      colorA: 0xffd9a0,
      colorB: 0xff2a00,
      blending: THREE.AdditiveBlending,
      grow: 2.2,
      opacity: 0.9,
      fadeIn: 0.05,
    });
    this.scene.add(this.flameFx.points);

    // Wind streaks — motion lines that fade in past ~220 km/h
    {
      const N = 40;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      this.streaks = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          color: 0xcfe8ff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      this.streaks.frustumCulled = false;
      this.scene.add(this.streaks);
      for (let i = 0; i < N; i++) this.streakData.push(this.newStreak(this.player.s));
    }

    // Player car — Kuwait flag colours: white body, green stripe
    this.carBody = this.trackCar(createCar({
      body: this.tune.paint,
      accent: this.tune.accent ?? 0x007a3d,
        stripes: this.tune.stripes,
      style: this.tune.bodyStyle,
      underglow: this.tune.glow ?? undefined,
      spoiler: this.tune.spoiler,
      goldRims: this.tune.goldRims,
      engineCover: this.tune.engineCover ?? undefined,
      carbon: this.tune.carbon,
      raceKit: this.tune.raceKit,
        kit: this.tune.kit,
        headlamps: this.tune.headlamps,
        tint: this.tune.tint,
        finish: this.tune.finish,
      stickers: this.tune.stickers,
      fullStripe: this.tune.fullStripe,
      stickerNumber: this.stickerNumber(),
      name: this.tune.carName,
      nameAr: this.tune.carNameAr,
      lengthM: this.tune.lengthM,
      crew: this.tune.crew ?? undefined,
      exhaust: this.tune.exhaust,
    }));
    this.playerMesh = new THREE.Group();
    this.playerMesh.add(this.carBody);
    // The contact blob must stay flat on the road — carBody pitches and
    // rolls with weight transfer, which would tilt it into the asphalt
    const contact = this.carBody.userData.contact as THREE.Object3D | undefined;
    if (contact) this.playerMesh.add(contact);
    this.scene.add(this.playerMesh);

    this.lampRig = new THREE.Group();
    this.playerMesh.add(this.lampRig);

    // Narrower than it was (0.42 rad, a 48-degree spread) because that
    // much cone spreads the same light over twice the road and gives a
    // pool with no edge to it. A dipped beam is a wide, shallow, sharply
    // cut thing; 0.32 with a soft penumbra is much closer.
    this.headlight = new THREE.SpotLight(0xfff2cc, 90, 95, 0.32, 0.55, 1.4);
    this.headlightBase = 90;
    // Aimed slightly DOWN — a real dipped beam meets the road, it does
    // not shine at the horizon. Source height and this target height
    // together set the cutoff distance; fitLampsToCar() puts the source
    // at the car's own lamps.
    this.headlight.target.position.set(0, -0.55, 42);
    // Your own headlights throw real moving shadows off traffic and rails
    this.headlight.castShadow = true;
    this.headlight.shadow.mapSize.set(1024, 1024);
    this.headlight.shadow.camera.near = 2;
    // (shadow far is governed by the light's distance, 90 m)
    this.headlight.shadow.bias = -0.002;
    this.headlight.shadow.normalBias = 0.03;

    // Cool rim light riding behind the roofline — the body edge reads
    // against dark asphalt instead of dissolving into it.
    const rim = new THREE.PointLight(0x86a9ff, 4.5, 13, 1.8);
    rim.position.set(0, 2.6, -4.4);
    this.playerMesh.add(rim);

    // The live paint probe. HalfFloat so HDR lamp emissives survive into
    // the clearcoat as real hot streaks — with an LDR fallback where float
    // render targets don't exist. No mip chain: physical materials read
    // the cube through a PMREM conversion, which filters for itself.
    const floatOk =
      this.renderer.extensions.has("EXT_color_buffer_float") ||
      this.renderer.extensions.has("EXT_color_buffer_half_float");
    this.cubeRT = new THREE.WebGLCubeRenderTarget(128, {
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      type: floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });
    this.cubeCam = new THREE.CubeCamera(0.5, 420, this.cubeRT);
    this.scene.add(this.cubeCam);
    this.applyLiveReflections();
    this.headlightR = new THREE.SpotLight(0xfff2cc, 54, 95, 0.34, 0.6, 1.4);
    this.headlightR.target.position.set(0, -0.55, 42);
    this.lampRig.add(
      this.headlight,
      this.headlight.target,
      this.headlightR,
      this.headlightR.target
    );

    // Visible beam cones + a splash of light on the road ahead
    {
      const beamGeo = new THREE.ConeGeometry(1.5, 13, 14, 1, true);
      beamGeo.rotateX(-Math.PI / 2); // apex toward the car, opening forward
      const beamMat = new THREE.MeshBasicMaterial({
        map: beamGradientTexture(),
        color: 0xfff3cf,
        transparent: true,
        opacity: 0.05, // barely-there haze; the road pool does the work
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      this.beamMat = beamMat;
      this.beamBaseOpacity = beamMat.opacity;
      this.beamBaseOpacityNight = beamMat.opacity;
      this.beams = [];
      for (const sx of [-1, 1]) {
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(sx * 0.66, 0.66, 8.7);
        // Splay each beam outward a touch so the pair diverges down the
        // road instead of running as two parallel tubes
        beam.rotation.y = -sx * 0.035;
        this.lampRig.add(beam);
        this.beams.push(beam);
      }
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 17),
        new THREE.MeshBasicMaterial({
          map: headlightPoolTexture(),
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        })
      );
      pool.rotation.x = -Math.PI / 2;
      // Rotated flat, the plane's +v axis points back toward the car, so
      // the texture's near-edge cut lands at the bumper end.
      pool.rotation.z = Math.PI;
      pool.position.set(0, 0.07, 10.5);
      // On a pivot rather than straight onto the car. The pool is where
      // the beam LANDS, so it has to swing with the aim — but it also
      // has to stay flat on the asphalt, which it would not if it
      // inherited the body's roll and pitch. The pivot takes the yaw and
      // leaves the rest.
      this.pool = pool;
      this.poolPivot = new THREE.Group();
      this.poolPivot.add(pool);
      this.playerMesh.add(this.poolPivot);
    }

    this.fitLampsToCar();

    this.spawnTraffic(TRAFFIC_COUNT);

    this.rivalIndex = this.loadProgress();
    this.spawnRival();

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  /**
   * Put the lights where this car's lamps actually are.
   *
   * Every silhouette carries its lamps somewhere different — the wedge's
   * are a light bar low across the nose, the coupe's are pop-ups on top
   * of it — and cars.ts records the positions it built them at. A beam
   * that starts somewhere other than the lamp it is supposed to come out
   * of is most of what makes headlights look painted on, and the old rig
   * started every beam from a fixed point 1.1 m up, which is roof height
   * on all fourteen of them.
   *
   * Called again after every garage change, because the shell those
   * positions came from is rebuilt from scratch each time.
   */
  private fitLampsToCar(): void {
    const raw = (this.carBody?.userData.lampPositions as THREE.Vector3[]) ?? [];
    // Left-most and right-most, so a car with a light bar (which records
    // two) and one with pop-ups plus indicators (which records more)
    // both give the outer pair.
    const sorted = [...raw].sort((a, b) => a.x - b.x);
    const left = sorted[0] ?? new THREE.Vector3(-0.66, 0.66, 1.9);
    const right = sorted[sorted.length - 1] ?? new THREE.Vector3(0.66, 0.66, 1.9);
    // A hair proud of the lens so the source is not inside its own glass.
    const out = 0.06;
    this.headlight.position.set(left.x, left.y, left.z + out);
    this.headlightR.position.set(right.x, right.y, right.z + out);
    this.headlight.target.position.set(left.x * 0.35, -0.55, 42);
    this.headlightR.target.position.set(right.x * 0.35, -0.55, 42);
    if (this.beams.length === 2) {
      this.beams[0].position.set(left.x, left.y, left.z + 6.9);
      this.beams[1].position.set(right.x, right.y, right.z + 6.9);
    }
    // The shadow camera's near plane has to clear the car's own nose or
    // the bumper shadows the road immediately in front of it.
    this.headlight.shadow.camera.near = 1.2;
    this.headlight.shadow.camera.updateProjectionMatrix?.();
  }

  /** The night the paint reflects — see env.ts. Shared with the main
   *  menu's turntable so both are lit by the same city. */
  private buildEnvironment(): void {
    this.scene.environment = nightEnvironment(this.renderer);
  }

  // ---------------------------------------------------------------- public

  start(): void {
    try {
      this.sound = new SoundEngine();
      this.sound.setEngine(this.tune.engine);
      this.sound.configureAspiration(
        this.tune.aspiration === "super" ? "super" : this.tune.boostMult > 0 ? "turbo" : "none"
      );
      // The system that is already bolted on when the engine first fires,
      // not only the one fitted later in the garage.
      this.sound.setExhaust(
        this.tune.exhaust.pitch,
        this.tune.exhaust.rasp,
        this.tune.exhaust.loud,
        this.tune.exhaust.tone
      );
      this.sound.revStart();
      this.music = new Music(this.sound.audioContext, this.sound.mixBus);
      // The tuner shares the mix bus, and owns whether the house
      // station is playing: tuning to a stream stops the synthesised
      // music rather than layering two soundtracks over each other.
      this.radio = new Radio(
        this.sound.audioContext,
        this.sound.mixBus,
        (channelId) => {
          if (!this.music) return;
          const on = channelId !== null;
          if (on) this.music.setChannel(channelId);
          if (this.music.enabled !== on) this.music.toggle();
        }
      );
      // Wire the voice into the mix: whenever anyone speaks — a recorded
      // ElevenLabs line or the synthesized fallback — the bed and the
      // score step back, and come home when they stop.
      this.voice.onSpeaking = (speaking) => {
        this.sound?.duckForVoice(speaking);
        this.music?.duckForVoice(speaking);
        this.radio?.duckForVoice(speaking);
      };
      this.music.start();
    } catch {
      this.sound = null;
    }
    this.clock.getDelta();
    this.lapStartAt = performance.now();
    this.startedAt = performance.now();
    this.padTimer = setInterval(() => this.pollGamepad(), 50);
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const nowMs = performance.now();
      this.measureRefresh(nowMs);
      // Frame limiter. The half-millisecond slack matters: without it a
      // cap set equal to the refresh rate loses the race with itself
      // every other frame and the game runs at exactly half rate.
      if (this.frameMinMs > 0) {
        // Frame limiting on a fixed schedule, not on arrival times.
        //
        // Re-basing the next deadline on the moment a frame happened to
        // arrive lets the error accumulate, and when the cap sits near
        // the panel's own rate the two beat against each other: most
        // frames pass, then one lands a hair early and is dropped, so a
        // steady 60 becomes a visible 60/30 judder while the average
        // still reads 60. Advancing the deadline by whole frame periods
        // keeps the cadence locked to the target instead.
        const due = this.lastFrameAt + this.frameMinMs;
        if (nowMs < due - 0.5) return;
        // Resync rather than sprint to catch up if we fell more than a
        // frame behind — a hidden tab or a long stall must not be repaid
        // with a burst of frames.
        this.lastFrameAt = nowMs - due > this.frameMinMs ? nowMs : due;
      }
      const raw = this.clock.getDelta();
      // The FPS readout keeps the RAW delta: it is a report on what the
      // machine actually managed, and smoothing it before displaying it
      // would be reporting the fix rather than the throughput.
      if (raw > 0) this.fpsEma = this.fpsEma * 0.95 + (1 / raw) * 0.05;
      this.autoQuality();
      this.updateDrs(performance.now());
      // ...but the SIMULATION gets a paced delta. A display presents on
      // a fixed grid and rAF's timestamp jitters around it by about a
      // millisecond, which at 200 km/h is four centimetres of difference
      // in how far the world moved between one frame and the next —
      // small, regular, and exactly the scale the eye notices. See
      // src/game/pacing.ts.
      const dt = paceDelta(this.pace, raw, this.refreshHz);
      // Polled outside update() so Start still works while paused
      this.pollGamepad();
      if (!this.paused) this.update(dt);
      // Refresh the paint's reflection probe — ONE cube face per frame.
      //
      // CubeCamera.update() renders the whole scene six times in a single
      // call. Doing that on a stride gave the probe a full refresh every
      // sixth frame and made that frame cost roughly seven times its
      // neighbours: the average frame rate looked fine while every sixth
      // frame missed its vsync deadline, which is what a player feels as
      // a stutter rather than as a low number. Rendering face n on frame
      // n keeps exactly the same refresh cadence — all six faces inside
      // six frames — with the cost spread flat.
      //
      // Every face render would redraw the shadow maps too, so freeze
      // them for the probe (the main render's maps are reused), and
      // re-convolve the PMREM cache once per completed sweep or the
      // paint keeps the first frame forever.
      if (this.liveReflections && !this.paused) {
        this.renderProbeFace();
      }
      // One pipeline for both quality modes keeps colour grading identical
      this.composer.render();
    };
    loop();
    const r = this.rival;
    if (r) {
      this.events.onMessage(
        `Find ${r.def.name} — ${r.def.arabicName}`,
        `${r.def.crew} · close in and flash 3× to challenge`
      );
      this.voice.speak("يلا! دوّر على خصمك", {}, "announcer-start"); // announcer
    } else if (this.rivalIndex >= RIVALS.length) {
      // Reloaded as a reigning champion — straight to the crown screen.
      // Deferred: the caller sets its "playing" state right after start().
      setTimeout(() => {
        if (!this.disposed) this.events.onChampion();
      }, 0);
    }
  }

  setPaused(p: boolean): void {
    if (p && !this.paused) this.pausedAt = performance.now();
    else if (!p && this.paused) this.lapStartAt += performance.now() - this.pausedAt;
    this.paused = p;
    this.sound?.setPaused(p);
  }

  /**
   * The pixel ratio the current settings ask for, right now.
   *
   * Derived rather than remembered. A pinned resolution is a line count,
   * so it depends on the height of the window and has to be recomputed
   * every time the window changes — which is exactly the case the old
   * "assign it in three places" arrangement got wrong: pin 1080p, resize
   * the window, and the buffer silently went back to native.
   */
  private currentRatio(): number {
    const c = this.renderer.domElement;
    const base = pixelRatioFor(
      this.resolution,
      c.clientWidth || 1,
      c.clientHeight || 1,
      (window.devicePixelRatio || 1) * this.tierRatioBoost,
      this.maxBuffer,
      this.tierRatioCap
    );
    // The frame-rate governor only ever moves NATIVE. Asking for 4K and
    // being quietly given 2.6K is the game lying about the one number
    // the player set by hand; if it cannot hold the frame rate, the
    // effects governor still has bloom, shadows and the paint probe to
    // give up first.
    return this.resolution === "native" ? base * this.renderScale : base;
  }

  /** What the game is rendering at, for the settings screen and for a
   *  test that has to check the buffer rather than trust the setting. */
  renderInfo(): {
    resolution: Resolution;
    ratio: number;
    buffer: [number, number];
    css: [number, number];
    display: [number, number];
    pinned: boolean;
    maxBuffer: number;
  } {
    const c = this.renderer.domElement;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const dpr = window.devicePixelRatio || 1;
    return {
      resolution: this.resolution,
      ratio: this.renderer.getPixelRatio(),
      buffer: [size.x, size.y],
      css: [c.clientWidth, c.clientHeight],
      display: [Math.round(screen.width * dpr), Math.round(screen.height * dpr)],
      pinned: this.resolution !== "native",
      maxBuffer: this.maxBuffer,
    };
  }

  /** Player-chosen render resolution. Takes effect on the next frame. */
  setResolution(res: Resolution): void {
    this.resolution = res;
    // A pin is a pin: hand the governor's scale back to 1 so leaving the
    // ladder does not strand the picture at whatever it had wound down
    // to while the pin was holding it still.
    if (res !== "native") this.renderScale = 1;
    this.resize();
  }

  resize(): void {
    const c = this.renderer.domElement;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w === 0 || h === 0) return;
    // Ratio first, then size: three multiplies one by the other, and a
    // pinned line count is a function of the height that just changed.
    const ratio = this.currentRatio();
    if (Math.abs(ratio - this.renderer.getPixelRatio()) > 1e-6) {
      this.renderer.setPixelRatio(ratio);
      this.composer.setPixelRatio(ratio);
    }
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    (this.grainPass.uniforms.uTexel.value as THREE.Vector2).set(1 / buf.x, 1 / buf.y);
    this.updateFxaaResolution();
    const bufH = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    this.sparkFx?.setPixelScale(bufH);
    this.smokeFx?.setPixelScale(bufH);
    this.flameFx?.setPixelScale(bufH);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private updateFxaaResolution(): void {
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const res = this.fxaaPass.material.uniforms["resolution"].value as THREE.Vector2;
    res.set(1 / buf.x, 1 / buf.y);
  }

  /**
   * Render one face of the reflection probe, advancing round the cube.
   * Mirrors what CubeCamera.update() does per face, minus the five it
   * would do in the same frame.
   */
  /** Test hook: run one frame of the probe exactly as the loop does. */
  renderProbe(): void {
    this.renderProbeFace();
  }

  /** Which cube face the probe will render next, 0..5. */
  get probeFace(): number {
    return this.cubeFrame % 6;
  }

  private renderProbeFace(): void {
    const cams = this.cubeCam.children as THREE.PerspectiveCamera[];
    const face = this.cubeFrame % 6;
    const cam = cams[face];
    if (!cam) return;

    const shadowAuto = this.renderer.shadowMap.autoUpdate;
    const prevTarget = this.renderer.getRenderTarget();
    const prevFace = this.renderer.getActiveCubeFace();
    const prevMip = this.renderer.getActiveMipmapLevel();
    // Mipmaps are generated on the last write to the target, so only the
    // face that completes the sweep may generate them.
    const genMips = this.cubeRT.texture.generateMipmaps;

    this.renderer.shadowMap.autoUpdate = false;
    this.playerMesh.visible = false; // the car must not reflect itself
    // And nor may any of the others, now that all of them sample this
    // cube. A car drawn INTO the target its own material is reading is a
    // framebuffer feedback loop, and the renderer resolves it by dropping
    // the object — which made the probe's per-face cost lurch between 348
    // draw calls and 132 depending on when the convolution landed. That
    // unevenness is exactly what the frame-pacing check exists to catch.
    // No loss: at probe resolution the rest of the fleet is a few dark
    // smears, and the world — road, lamps, towers, sky — is what a
    // reflection is for.
    const hidden: THREE.Object3D[] = [];
    for (const g of this.carGroups) {
      if (g.visible) {
        g.visible = false;
        hidden.push(g);
      }
    }
    try {
      this.cubeCam.position.copy(this.playerMesh.position);
      this.cubeCam.position.y += 1.2;
      this.cubeCam.updateMatrixWorld(true);
      this.cubeRT.texture.generateMipmaps = face === 5 ? genMips : false;
      this.renderer.setRenderTarget(this.cubeRT, face);
      this.renderer.render(this.scene, cam);
    } finally {
      this.cubeRT.texture.generateMipmaps = genMips;
      this.renderer.setRenderTarget(prevTarget, prevFace, prevMip);
      this.playerMesh.visible = true;
      // Restore only what this call hid: a remote player waiting on its
      // first snapshot is invisible on purpose.
      for (const g of hidden) g.visible = true;
      this.renderer.shadowMap.autoUpdate = shadowAuto;
    }

    // A sweep is complete: convolve it once, not once per face.
    if (face === 5) this.cubeRT.texture.needsPMREMUpdate = true;
    this.cubeFrame++;
  }

  /** Push whatever the settings now imply onto the renderer. resize()
   *  is the only place that touches the ratio, so this is just it. */
  private applyRenderScale(): void {
    this.resize();
  }

  /**
   * Dynamic resolution: walk the internal render scale down 10% at a
   * time while the frame rate is under target, and back up 5% at a time
   * once there is headroom. Runs continuously (Auto tier), unlike the
   * one-shot effects governor below.
   */
  /**
   * Learn the panel's refresh rate from the frames it gives us. Median of
   * the first 40 intervals rather than a mean: a single scheduling hitch
   * during startup would drag a mean far enough to mistake a 120 Hz panel
   * for a 90 Hz one and cap the game below its display for the session.
   */
  private measureRefresh(now: number): void {
    if (this.lastRefreshSample === 0) {
      this.lastRefreshSample = now;
      return;
    }
    const gap = now - this.lastRefreshSample;
    this.lastRefreshSample = now;
    this.refreshFrames++;
    // Accept anything from 4 Hz up. A tighter window looks reasonable
    // until the machine is genuinely slow or the tab is throttled, at
    // which point every sample is rejected and the probe never resolves
    // at all — leaving the governors guessing 60 Hz forever.
    if (gap > 2 && gap < 250) this.refreshSamples.push(gap);
    // Commit on enough samples, or bail out — bounded by BOTH frames and
    // wall clock. A frame budget alone is unbounded in time: at the ~1.4 Hz
    // a throttled tab delivers, 240 frames is nearly three minutes, and the
    // governors would spend all of it aiming at a guessed rate.
    if (this.refreshProbeStart === 0) this.refreshProbeStart = now;
    const elapsed = now - this.refreshProbeStart;
    const first = this.refreshHz === 0;
    if (first && this.refreshSamples.length < 40 && this.refreshFrames < 240 && elapsed < 2000) {
      return;
    }
    if (first && this.refreshSamples.length < 5) {
      // Nothing usable at all: assume the common case rather than stall.
      this.refreshHz = 60;
      this.refreshSamples = [];
      this.applyFrameCap();
      return;
    }
    // AND IT KEEPS LOOKING. The first estimate is taken during the
    // slowest two seconds of the session — shaders compiling, assets
    // landing — and on a variable-refresh panel the frame rate IS the
    // refresh rate, so a slow start reads as a slow monitor and used to
    // be latched there for good. A 144 Hz G-Sync display that managed 50
    // fps through startup got capped at 45 for the session and had the
    // resolution governor push resolution UP until the frame rate fell
    // to meet it.
    //
    // So the probe re-reads on a slow cadence, and it only ever revises
    // the rate UPWARD: the game cannot present faster than the panel
    // refreshes, so a faster reading is new evidence about the hardware,
    // while a slower one is only evidence about the load. See
    // refreshFromIntervals for why it is a low percentile rather than a
    // median.
    if (!first && elapsed - this.lastRefreshRead < GameEngine.REFRESH_RECHECK_MS) return;
    const seen = refreshFromIntervals(this.refreshSamples);
    this.refreshSamples = [];
    this.lastRefreshRead = elapsed;
    if (seen <= 0) return;
    if (first || seen > this.refreshHz) {
      this.refreshHz = seen;
      this.applyFrameCap(); // re-resolve "display"/"vrr" now the rate is known
    }
  }
  /** How often the refresh probe takes another look, in ms of session. */
  private static readonly REFRESH_RECHECK_MS = 4000;
  private lastRefreshRead = 0;
  private lastRefreshSample = 0;
  private refreshFrames = 0;
  private refreshProbeStart = 0;

  /** What the GPU and device report they can carry. */
  get deviceCaps(): { maxTexture: number; maxCube: number; memoryGB: number; cores: number } {
    return { ...this.caps };
  }

  /**
   * The texture budget for a tier, scaled to the hardware rather than
   * assumed. A machine reporting 8 GB and a 16384 texture limit gets
   * shadow maps twice the size of one reporting 4 GB — and neither is
   * handed an allocation its driver will refuse.
   */
  private budget(want: number, kind: "texture" | "cube" = "texture"): number {
    const limit = kind === "cube" ? this.caps.maxCube : this.caps.maxTexture;
    // Below 4 GB, halve — those devices are usually sharing memory with
    // the system and an oversized map costs more than it shows.
    const lean = this.caps.memoryGB < 4 ? 0.5 : 1;
    // Only ever clamps DOWN. An earlier floor of 512 quietly raised the
    // lower tiers instead — the high tier's 128 probe became 512, costing
    // memory on exactly the machines that asked for less.
    return Math.max(64, Math.min(limit, Math.floor(want * lean)));
  }

  /** Panel refresh in Hz once measured, else 0. */
  get displayHz(): number {
    return this.refreshHz;
  }

  /** The frame rate the governors are aiming at. */
  get targetFps(): number {
    return this.frameMinMs > 0 ? 1000 / this.frameMinMs : this.refreshHz || 60;
  }

  /**
   * Choose the pacing. Browser v-sync is always on and not ours to
   * disable, so the only real lever is how often we accept a frame.
   */
  /**
   * Which GPU the browser actually handed us.
   *
   * powerPreference is a HINT. The browser can ignore it, and on a
   * hybrid laptop the difference between the NVIDIA card and the
   * integrated one is the difference between the game running well and
   * badly — with nothing on screen to say which you got. This reads the
   * driver's own unmasked string so the answer is checkable rather than
   * assumed.
   */
  gpuName(): string {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
      return String(gl.getParameter(gl.RENDERER));
    } catch {
      return "unknown";
    }
  }

  setFrameCap(cap: "display" | "vrr" | number): void {
    this.frameCap = cap;
    this.applyFrameCap();
  }

  private applyFrameCap(): void {
    const hz = this.refreshHz || 60;
    let target: number;
    if (this.frameCap === "display") target = 0; // take every frame offered
    else if (this.frameCap === "vrr") {
      // Standard G-Sync/FreeSync practice: sit a few frames under the
      // ceiling. Crossing it hands you back to v-sync and its queued
      // frame of latency, which is the thing VRR exists to avoid.
      target = Math.max(30, hz - 3);
    } else target = this.frameCap;
    this.frameMinMs = target > 0 ? 1000 / target : 0;
    this.lastFrameAt = 0;
  }

  private updateDrs(now: number): void {
    if (!this.drsEnabled || this.paused) return;
    // A pinned resolution is not the governor's to move. It can still
    // run — leaving the ladder should not need the governor restarted —
    // but currentRatio() ignores its scale while a pin is held, so
    // spending frames recomputing a ratio nothing will use is waste.
    if (this.resolution !== "native") return;
    if (now - this.startedAt < 4000 || now - this.drsAt < 1500) return;
    // Thresholds relative to what we are actually aiming at. Fixed 50/58
    // numbers silently assumed a 60 Hz panel: on a 144 Hz display,
    // holding 58 fps is a failure, yet it read as headroom and the
    // governor would keep pushing resolution up.
    const target = this.targetFps;
    const floor = target * 0.83;
    const ceiling = target * 0.97;
    if (this.fpsEma < floor && this.renderScale > 0.6) {
      this.drsAt = now;
      this.renderScale = Math.max(0.6, this.renderScale - 0.1);
      this.applyRenderScale();
    } else if (this.fpsEma > ceiling && this.renderScale < 1) {
      this.drsAt = now;
      this.renderScale = Math.min(1, this.renderScale + 0.05);
      this.applyRenderScale();
    }
  }

  /** Drop the expensive effects once it's clear the machine can't keep up. */
  private autoQuality(): void {
    if (this.qualityLocked || performance.now() - this.startedAt < 6000) return;
    this.qualityLocked = true;
    // Also relative: 32 fps is a crisis on a 60 Hz panel but merely
    // half-rate on a 144 Hz one, where the machine is plainly coping.
    if (this.fpsEma < this.targetFps * 0.53) {
      this.bloomPass.enabled = false;
      this.world.moonLight.castShadow = false;
      this.headlight.castShadow = false;
      // The blob goes back to full strength as the real shadow leaves,
      // so a machine that drops to this tier does not also lose the only
      // thing keeping its cars on the road.
      this.applyContactStrength();
      // Performance mode drops the samples too: multisampling is a
      // per-pixel cost on the geometry pass and this tier exists because
      // the machine could not keep up. FXAA is what is left, and here it
      // IS worth having — it costs one full-screen pass and there is no
      // coverage for it to undo.
      this.msaaTarget.samples = 0;
      this.fxaaPass.enabled = true;
      this.liveReflections = false;
      this.applyLiveReflections();
      this.events.onMessage("Performance mode", "Glow & shadows off — press G to toggle them back");
    }
  }

  /** Repaint the world for midnight or dawn (settings screen). */
  /**
   * The three grading controls, in the order a colourist reaches for
   * them. Exposure acts before tone mapping because that is where
   * exposure physically acts; contrast and highlights act on the
   * picture afterwards.
   */
  setExposure(stops: number, auto = true): void {
    const u = this.autoExp.exposureMat.uniforms;
    u.uBias.value = THREE.MathUtils.clamp(stops, -2, 2);
    u.uAuto.value = auto ? 1 : 0;
    // Manual sits at 1.15, the hand-set exposure this game shipped with,
    // so zero on the slider is exactly the look it always had.
    u.uManual.value = 1.15;
  }

  /** Current exposure and metered luminance. Reads back from the GPU, so
   *  it is for debug readouts and tests — never per frame. */
  sampleExposure(): Promise<{ exposure: number; luminance: number }> {
    return this.autoExp.sample(this.renderer);
  }

  setContrast(v: number): void {
    this.baseContrast = THREE.MathUtils.clamp(v, 0.7, 1.5);
    this.applyLook();
  }

  /**
   * Brightness, 0.7 (dim) to 1.5 (bright). A gamma about black, so it
   * lifts the asphalt between the lamps without touching white.
   *
   * A player control rather than a tuning constant. The one fact that
   * decides the right value here is the one the game cannot know: what
   * screen this is and how much light is in the room. A night game
   * graded for a dark room is unreadable in a bright one, and graded
   * for a bright one it is a grey film in a dark one.
   */
  setBrightness(v: number): void {
    this.grainPass.uniforms.uBrightness.value = THREE.MathUtils.clamp(v, 0.7, 1.5);
  }

  /** Global saturation, 0.6 (washed) to 1.4 (poster). */
  setSaturation(v: number): void {
    this.baseSaturation = THREE.MathUtils.clamp(v, 0.6, 1.4);
    this.applyLook();
  }

  // ------------------------------------------------------- the situation
  //
  // The music has always known what is happening — setMood switches it
  // between cruise and battle — and the picture never did. A challenge
  // was raised, a fight was won or lost, and the frame looked exactly
  // the same throughout.
  //
  // Each situation is a colour balance, a saturation and a contrast, and
  // they are MULTIPLIERS on whatever the player has set in the picture
  // menu rather than absolute values. Writing the uniforms directly
  // would have a battle quietly overwrite a slider the player moved, and
  // the setting would never come back.
  private baseContrast = 1;
  private baseSaturation = 1;
  private look: Situation = "cruise";
  /** Where the blend has actually reached, so a change part-way through
   *  a transition carries on from here instead of snapping. */
  private lookTint = new THREE.Vector3(1, 1, 1);
  private lookSat = 1;
  private lookCon = 1;

  /** Latched by a win or a loss, cleared when the player moves on. The
   *  frame-by-frame derivation below cannot express these: both happen
   *  with inBattle already false, and both have to hold while the result
   *  card is up. */
  private resultLook: "win" | "lose" | null = null;
  /** Overrides everything, for the grade suite. Nothing in the game
   *  calls it. It exists because the situation is otherwise derived from
   *  private state every frame — the first version of this was a public
   *  setter that update() silently overwrote a sixteenth of a second
   *  later, so a battle grade could be asked for and never arrived. */
  setSituation(s: Situation | null): void {
    this.forcedLook = s;
  }
  private forcedLook: Situation | null = null;

  /** What the moment is, from what is actually happening. */
  private deriveLook(): Situation {
    if (this.forcedLook) return this.forcedLook;
    if (this.resultLook) return this.resultLook;
    if (this.inBattle || this.duel) return "battle";
    if (this.cine || this.challengePending) return "challenge";
    return "cruise";
  }

  /** Push base x situation into the shader. */
  private applyLook(): void {
    const u = this.grainPass.uniforms;
    u.uContrast.value = THREE.MathUtils.clamp(this.baseContrast * this.lookCon, 0.6, 1.7);
    u.uSaturation.value = THREE.MathUtils.clamp(this.baseSaturation * this.lookSat, 0.2, 1.6);
    (u.uTint.value as THREE.Vector3).copy(this.lookTint);
  }

  /** Walk the live grade toward the current situation's. */
  private stepLook(dt: number): void {
    const want = SITUATION_LOOKS[this.look];
    // Exponential approach: fast enough to land inside a second, slow
    // enough that a hard cut is never visible. A battle that snapped its
    // grade on would read as a rendering glitch, not as a change of key.
    const k = 1 - Math.exp(-dt * 4.5);
    this.lookTint.lerp(want.tint, k);
    this.lookSat += (want.sat - this.lookSat) * k;
    this.lookCon += (want.contrast - this.lookCon) * k;
    this.applyLook();
  }

  /** -1 recovers the highlights, +1 pushes them toward clipping. */
  setHighlights(v: number): void {
    const h = THREE.MathUtils.clamp(v, -1, 1);
    this.grainPass.uniforms.uHighlights.value = h;
    // Recovering highlights also brings the shoulder down to meet them,
    // so the roll starts earlier instead of only shrinking what is above it.
    this.grainPass.uniforms.uKnee.value = 0.86 - Math.max(0, -h) * 0.16;
  }

  /** Hours 0..24. Fixed looks are hours too; "cycle" lets it run. */
  /** Half past midnight: the night has just opened. */
  private timeHours = 0.5;
  /** The world is on Kuwait's own clock, read every frame. */
  private timeReal = false;
  private timeCycling = true;
  /** Set once the window has closed, so the message fires once. */
  private nightClosed = false;
  private skyAccum = 0;
  /** Minutes of play for a full 24-hour turn. Long enough that a race
   *  happens in one light, short enough to see the sun move. */
  private static readonly CYCLE_MINUTES = 16;

  /**
   * THE NIGHT.
   *
   * Racing on the corniche is a thing that happens between midnight and
   * the call to fajr, and the game is now built that way rather than
   * merely lit that way: the clock opens at 00:00 and racing closes at
   * 05:50. Outside those hours the world is still there and the car
   * still drives — you are just rolling.
   *
   * A race already under way when the clock runs out is allowed to
   * finish. The window gates STARTING one; taking a win away from
   * somebody two corners from the end because a number crossed a
   * threshold would be a rule enforcing itself against the point of
   * having it.
   */
  static readonly RACE_OPEN_H = CLOCK_RACE_OPEN_H;
  /** World up, for the cross products that build a light basis. */
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  /** How far along its own axis the key light stands from what it is
   *  lighting. The shadow frustum's near/far bracket this. */
  static readonly MOON_DIST = 400;
  static readonly RACE_CLOSE_H = CLOCK_RACE_CLOSE_H;
  /** Minutes of play the racing window lasts. The clock keeps running
   *  afterwards — the sun comes up, and you can stay out in it. */
  private static readonly NIGHT_MINUTES = 40;

  /** Whether a new race can be started right now. */
  racingOpen(): boolean {
    return (
      this.timeHours >= GameEngine.RACE_OPEN_H && this.timeHours < GameEngine.RACE_CLOSE_H
    );
  }

  setSky(mode: "night" | "dawn" | "noon" | "dusk" | "cycle" | "kuwait"): void {
    const HOURS: Record<string, number> = {
      // Inside the racing window, because that is when this game happens.
      night: 0.5,
      dawn: 5.6,
      noon: 12.5,
      dusk: 18.2,
    };
    this.timeCycling = mode === "cycle";
    // KUWAIT: the world runs on the real clock in Kuwait, to the second.
    //
    // The corner of the HUD has always carried a dial reading the true
    // time there. The sky beside it ran on its own accelerated cycle, so
    // the game showed two clocks at once and the sun agreed with
    // neither — a screenshot taken at ten past three in the afternoon
    // was shot at half past four in the game.
    //
    // Both now come from one place, src/game/clock.ts, and the zone is
    // named rather than assumed: a clock that reads "Kuwait" and renders
    // the player's own timezone is right for one player in the world.
    this.timeReal = mode === "kuwait";
    // A cycle starts where the eye expects this game to start: dusk,
    // with the lights just coming on.
    this.timeHours = this.timeReal
      ? kuwaitHours()
      : this.timeCycling
        ? GameEngine.RACE_OPEN_H
        : HOURS[mode] ?? 0.5;
    this.nightClosed = false;
    this.world.setTimeOfDay(this.timeHours);
    this.applyDaylight();
  }

  /**
   * How much daylight there is, 0..1 — the sun's altitude, clamped.
   * Everything that only makes sense in the dark reads this.
   */
  private get daylight(): number {
    const alt = Math.sin(((this.timeHours - 6) / 24) * Math.PI * 2);
    return THREE.MathUtils.clamp(alt * 3.2, 0, 1);
  }

  /**
   * Headlights, beams and lamp glare exist because it is dark. In broad
   * daylight a spot light throws no visible pool and a volumetric beam
   * is just a grey cone hanging off the bumper, so both fade out — the
   * lamps themselves stay lit, which is what Gulf drivers do anyway.
   */
  /**
   * Take the key light's direction from the world's clock, and rebuild
   * the basis the shadow frustum is texel-snapped against.
   *
   * These two have to move together. lightRight/lightUp are the axes the
   * snapping rounds along, so leaving them pointing at the old sun makes
   * the rounding happen in the wrong plane and the shadow edges crawl —
   * which is the exact artefact the snapping exists to prevent.
   */
  private syncKeyDirection(): void {
    const dir = this.world?.moonLight?.userData?.keyDir as THREE.Vector3 | undefined;
    if (dir) this.moonDir.copy(dir);
    this.lightRight.crossVectors(this.moonDir, GameEngine.UP).normalize();
    this.lightUp.crossVectors(this.lightRight, this.moonDir).normalize();
  }

  /**
   * Turn the painted-on contact blob down when a real shadow is being
   * drawn, and back up when it is not.
   *
   * The blob predates the car ever having a visible shadow, and with the
   * key raked it now competes with the real one for the same asphalt —
   * measured swallowing 40% of it. It stays at full strength wherever
   * shadow casting is off, because there it is not competing with
   * anything: it IS the shadow.
   */
  private applyContactStrength(): void {
    setContactStrength(this.world.moonLight.castShadow ? 0.5 : 1);
  }

  private applyDaylight(): void {
    this.syncKeyDirection();
    const dark = 1 - this.daylight;
    // The grade's shadow lift is a night look and is switched by the same
    // sun that switches the headlights. Twilight gets a fraction of it,
    // which is what dusk on the corniche actually wants.
    const alt = Math.sin(((this.timeHours - 6) / 24) * Math.PI * 2);
    this.grainPass.material.uniforms.uNight.value = THREE.MathUtils.clamp(
      (0.05 - alt) / 0.4,
      0,
      1
    );
    // The dipped beam, recorded as well as written. A flash is a level
    // ABOVE this, applied every frame from here — so the hour can change
    // mid-flash, two flashes can overlap, and the lamps still come home
    // to the light the clock says they should be showing.
    this.lampRest.spot = this.headlightBase * (0.25 + 0.75 * dark);
    this.lampRest.off = this.headlightBase * 0.6 * (0.25 + 0.75 * dark);
    this.headlight.intensity = this.lampRest.spot;
    this.headlightR.intensity = this.lampRest.off;
    this.beamBaseOpacity = this.beamBaseOpacityNight * dark;
    const glows = (this.carBody?.userData.headGlowMats as THREE.SpriteMaterial[]) ?? [];
    for (const g of glows) g.opacity = 0.9 * dark;
  }

  /**
   * Player-chosen quality tier from the settings screen. "auto" hands
   * control back to the frame-rate governor; the explicit tiers lock it.
   */
  applyQualityTier(tier: "auto" | "ultra" | "high" | "balanced" | "battery"): void {
    if (tier === "auto") {
      this.qualityLocked = false;
      this.drsEnabled = true;
      this.renderScale = 1;
      this.tierRatioCap = 2;
      this.tierRatioBoost = 1;
      this.applyRenderScale();
      this.startedAt = performance.now(); // give the governors a fresh window
      return;
    }
    this.qualityLocked = true;
    this.drsEnabled = false; // explicit tiers pin their resolution
    const ultra = tier === "ultra";
    const high = tier === "high" || ultra;
    const balanced = tier === "balanced";
    this.bloomPass.enabled = high || balanced;
    this.world.moonLight.castShadow = high || balanced;
    this.headlight.castShadow = high || balanced;
    this.applyContactStrength();
    // Multisampling where the machine can afford it, and FXAA only where
    // it cannot — never both.
    //
    // Stacking them is worse than either alone, measured: with MSAA
    // supplying real coverage, adding FXAA on top took the hard-step
    // fraction of the long silhouettes from 39.6% back up to 48.6%. It
    // blends along an edge and re-hardens the cross-section MSAA had
    // just resolved, then blurs what it did not. FXAA is the fallback
    // for a tier that cannot pay for samples, not a finishing pass on
    // top of one.
    this.msaaTarget.samples = high ? 4 : balanced ? 2 : 0;
    this.fxaaPass.enabled = !high && !balanced;
    // The live paint probe is the most expensive single toy — high only
    this.liveReflections = high;
    this.applyLiveReflections();
    // Ultra is for desktop GPUs driving a 4K panel. A 4K monitor usually
    // reports devicePixelRatio 1, so "native" already means 3840x2160 and
    // the only way further up is supersampling: render above the panel and
    // let the downsample do the anti-aliasing, which resolves the lamp
    // filaments and lane edges that even TSR-class upscalers soften.
    //
    // These are the tier's ceiling on NATIVE, not the ratio itself. A
    // player who has picked 4K from the resolution ladder has said what
    // they want more plainly than a tier can, and Battery pulling that
    // back to 1080p behind their back is the game overruling them.
    this.tierRatioBoost = ultra ? 1.5 : 1;
    this.tierRatioCap = ultra || tier === "high" ? 2 : balanced ? 1.5 : 1;
    // Sharper shadow cascades to match the extra pixels
    const shadowSize = this.budget(ultra ? 4096 : 1024);
    if (this.headlight.shadow.mapSize.x !== shadowSize) {
      this.headlight.shadow.mapSize.setScalar(shadowSize);
      this.headlight.shadow.map?.dispose();
      this.headlight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    const moonSize = this.budget(ultra ? 16384 : 4096);
    if (this.world.moonLight.shadow.mapSize.x !== moonSize) {
      this.world.moonLight.shadow.mapSize.setScalar(moonSize);
      this.world.moonLight.shadow.map?.dispose();
      this.world.moonLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    // 256 on high, not 128. The probe is what the paint reflects, and a
    // lamppost twenty metres off is one pixel wide in a 128-face — after
    // the PMREM blur it is a smear across a 1.7 m flank, on the tier
    // whose whole point is a desktop GPU with pixels to spend. A face is
    // rendered once per frame, so 256 is 65 k pixels a frame, and the
    // pacing check that once caught the six-face stutter would catch a
    // regression here. Ultra keeps 512.
    if (this.liveReflections) this.setProbeResolution(this.budget(ultra ? 512 : 256, "cube"));
    this.renderScale = 1;
    this.applyRenderScale();
  }

  /** After a defeat: refill SP and rematch the same rival. */
  retryBattle(): void {
    this.player.sp = 100;
    this.locked = false;
    this.inBattle = false;
    // Off the result look and back to the road; the derivation takes it
    // from here, and finds "battle" again when the fight is on.
    this.resultLook = null;
    this.spawnRival();
    const r = this.rival!;
    this.events.onMessage(`Rematch — ${r.def.name}`, "Catch up and press F to flash");
  }

  /** Wipe progress and start over from the first rival. */
  resetProgress(): void {
    this.rivalIndex = 0;
    this.saveProgress();
    this.player.sp = 100;
    this.locked = false;
    this.inBattle = false;
    this.spawnRival();
  }

  // ------------------------------------------------------------- online

  /** Add (or re-style) another player's car in the shared cruise. */
  upsertRemote(id: number, name: string, color: string): void {
    this.removeRemote(id);
    const hex = new THREE.Color(color).getHex();
    const mesh = this.trackCar(createCar({ body: hex, underglow: hex }));
    mesh.add(makeNameTag(name));
    mesh.visible = false; // until the first state snapshot lands
    this.scene.add(mesh);
    this.remotes.set(id, {
      name,
      mesh,
      s: 0,
      lat: 0,
      snapS: 0,
      snapLat: 0,
      snapSpeed: 0,
      snapAt: 0,
      steerVis: 0,
      accel: 0,
      brakeVis: 0,
    });
  }

  updateRemoteState(id: number, s: number, lat: number, speed: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    if (!r.mesh.visible) {
      r.mesh.visible = true;
      r.s = s;
      r.lat = lat;
    }
    // Two snapshots are an acceleration, and it was being discarded.
    // A remote player's inputs are on somebody else's machine, so this
    // difference is the ONLY longitudinal kinematics available for
    // them — without it their driver sat still through every stop.
    //
    // Guarded at the bottom and CLAMPED at the top, which is the right
    // way round and was not the first way I wrote it.
    //
    // The first version rejected any interval longer than a second, on
    // the theory that a stalled connection makes the quotient
    // meaningless. It does not: a long gap divides the same speed change
    // by a bigger number, so it yields a SMALL acceleration, which is
    // harmless and roughly true. The dangerous end is the short one,
    // where two packets arriving a millisecond apart divide by almost
    // nothing and produce a spike.
    //
    // The one-second cliff also made the mechanism untestable in an
    // environment slower than the one it was written on. tests/ik.mjs
    // asked for a 120 ms wait between two snapshots and got 4,658 ms,
    // because the page is running a game loop on a headless machine —
    // so the guard rejected the very case the test was constructed to
    // exercise, and the feature looked broken when it was the cliff.
    //
    // So: a floor on the interval, and a clamp on the answer at a
    // deceleration no road car exceeds.
    const now = performance.now();
    const gap = (now - r.snapAt) / 1000;
    r.accel =
      r.snapAt > 0 && gap > 0.001
        ? THREE.MathUtils.clamp((speed - r.snapSpeed) / gap, -14, 14)
        : 0;
    r.snapS = s;
    r.snapLat = lat;
    r.snapSpeed = speed;
    r.snapAt = now;
  }

  removeRemote(id: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.untrackCar(r.mesh);
    this.scene.remove(r.mesh);
    this.remotes.delete(id);
  }

  /** Feed the referee's SP numbers into the HUD. */
  setDuel(d: { you: number; them: number; gap: number; opponent: string } | null): void {
    this.duel = d;
  }

  getLocalState(): { s: number; lat: number; speed: number } {
    return { s: this.player.s, lat: this.player.lat, speed: this.player.speed };
  }

  getMapPath(): Array<[number, number]> {
    // The same centreline the full map draws, so the two can never
    // disagree about the shape of the road.
    return this.getRoadMap().path.map((p) => [p.x, p.y] as [number, number]);
  }

  dispose(): void {
    // Write the tank back before anything else is torn down: what is
    // left in it is the whole reason the pump is worth driving to.
    this.saveFuel();
    // ...and the runs, for the same reason: the throttle in flushRuns
    // means up to five seconds of progress is sitting unwritten.
    if (this.runsDirty) {
      this.runsDirty = false;
      saveProgress(this.runs);
    }
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const t of this.challengeTimers) clearTimeout(t);
    this.challengeTimers = [];
    if (this.padTimer) clearInterval(this.padTimer);
    this.cubeRT?.dispose();
    this.sparkFx?.dispose();
    this.smokeFx?.dispose();
    this.flameFx?.dispose();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.music?.dispose();
    this.sound?.dispose();
    this.voice.dispose();
    this.exposurePass?.dispose();
    this.autoExp?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- input

  private onKeyDown = (e: KeyboardEvent) => {
    // Any trusted gesture may be our only chance to un-suspend audio
    this.sound?.resume();
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (this.cine && (k === "enter" || k === " ") && !e.repeat) {
      this.skipCinematic();
      return; // deliberately not added to this.keys — Space is the handbrake
    }
    this.keys.add(k);
    if (k === "f") this.tryFlash();
    if (k === "m" && !e.repeat && this.sound) {
      const muted = this.sound.toggleMute();
      this.events.onMessage(muted ? "Sound off" : "Sound on");
    }
    if (k === "h" && !e.repeat) this.sound?.hornOn();
    if (k === "b" && !e.repeat && this.music) {
      const on = this.music.toggle();
      this.events.onMessage(on ? "Music on" : "Music off");
    }
    if (k === "r" && !e.repeat && this.radio) {
      const { station, mode } = this.radio.next();
      // The Arabic name is the headline, the way every other place name
      // in this game is presented — this is a Kuwaiti radio. The track
      // goes underneath it, because a station that names what is playing
      // is a radio and one that does not is a mute button with steps.
      const playing = mode === "synth" ? this.music?.nowPlaying() : null;
      this.events.onMessage(
        `${station.ar} · ${station.name}`,
        mode === "direct"
          ? "Streaming outside the mix"
          : playing
            ? `${playing.track.ar} · ${playing.track.name}`
            : undefined
      );
    }
    if (k === "v" && !e.repeat) {
      const on = this.voice.toggle();
      this.events.onMessage(on ? "Voices on — الأصوات شغالة" : "Voices off");
      if (on) this.voice.speak("الأصوات شغالة", {}, "voices-on");
    }
    if (k === "g" && !e.repeat) {
      this.qualityLocked = true;
      this.bloomPass.enabled = !this.bloomPass.enabled;
      this.world.moonLight.castShadow = this.bloomPass.enabled;
      this.headlight.castShadow = this.bloomPass.enabled;
      this.applyContactStrength();
      // Same rule as the tier ladder: samples when the effects are on,
      // FXAA only when they are off. Never both — see applyQualityTier.
      this.msaaTarget.samples = this.bloomPass.enabled ? 4 : 0;
      this.fxaaPass.enabled = !this.bloomPass.enabled;
      this.liveReflections = this.bloomPass.enabled;
      this.applyLiveReflections();
      this.events.onMessage(
        this.bloomPass.enabled ? "Glow & shadows on" : "Glow & shadows off"
      );
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    this.keys.delete(k);
    if (k === "h") this.sound?.hornOff();
  };

  /** Focus loss eats keyup events — release everything or the throttle
   *  sticks and the horn drones forever. */
  private onBlur = () => {
    this.keys.clear();
    this.touch = { throttle: 0, brake: 0, steer: 0, drift: false };
    this.sound?.hornOff();
  };

  private get throttle(): number {
    if (this.locked || this.cine) return 0;
    // A dry tank is not a penalty on the car, it is an engine that has
    // stopped running: no thrust, no note above idle, and no fuel burned
    // either, since there is none to burn. Cutting it here rather than
    // at the thrust means every consumer agrees — the sim, the sound and
    // the tacho all see a driver whose right foot has stopped mattering.
    if (this.outOfFuel) return 0;
    const key = this.keys.has("arrowup") || this.keys.has("w") ? 1 : 0;
    return Math.max(key, this.touch.throttle, this.pad.throttle);
  }
  private get brake(): number {
    if (this.locked || this.cine) return 0;
    const key = this.keys.has("arrowdown") || this.keys.has("s") ? 1 : 0;
    return Math.max(key, this.touch.brake, this.pad.brake);
  }
  private get steer(): number {
    if (this.locked || this.cine) return 0;
    let s = 0;
    if (this.keys.has("arrowleft") || this.keys.has("a")) s -= 1;
    if (this.keys.has("arrowright") || this.keys.has("d")) s += 1;
    return THREE.MathUtils.clamp(s + this.touch.steer + this.pad.steer, -1, 1);
  }

  private get handbrake(): boolean {
    if (this.locked || this.cine) return false;
    const held = this.keys.has(" ") || this.touch.drift || this.pad.drift;
    // A hold carried through the film (key auto-repeat re-adds it) must
    // not drag the handbrake at the green flag — demand a fresh press.
    if (!held) this.handbrakeStale = false;
    return held && !this.handbrakeStale;
  }

  /**
   * Standard pad layout: left stick steers (deadzone + a gentle curve so
   * small corrections stay small), triggers drive, A = NOS, B = drift,
   * X = flash, LB = horn, Start = pause. Merged with keyboard/touch, so
   * plugging a pad in never disables anything else.
   */
  private pollGamepad(): void {
    const pads = typeof navigator !== "undefined" ? navigator.getGamepads?.() : null;
    const gp = pads ? Array.from(pads).find((p) => p && p.connected) : null;
    if (!gp) {
      if (this.padSeen) this.pad = { steer: 0, throttle: 0, brake: 0, drift: false, nos: false };
      this.padSeen = false;
      return;
    }
    this.padSeen = true;
    const edge = (i: number) => {
      const now = gp.buttons[i]?.pressed ?? false;
      const was = this.padButtons[i] ?? false;
      this.padButtons[i] = now;
      return now && !was;
    };

    if (!this.paused) {
      const x = gp.axes[PAD.steer] ?? 0;
      const dz = 0.15;
      this.pad.steer =
        Math.abs(x) < dz ? 0 : Math.sign(x) * Math.pow((Math.abs(x) - dz) / (1 - dz), 1.3);
      // Indices come from the one table the controls screen draws
      // from — see pads.ts. They used to sit here as literals with the
      // names in comments, which is a diagram that can drift.
      this.pad.throttle = gp.buttons[PAD.throttle]?.value ?? 0;
      this.pad.brake = gp.buttons[PAD.brake]?.value ?? 0;
      this.pad.nos = gp.buttons[PAD.nos]?.pressed ?? false;
      this.pad.drift = gp.buttons[PAD.drift]?.pressed ?? false;
      if (edge(PAD.flash)) this.tryFlash();
      const hornNow = gp.buttons[PAD.horn]?.pressed ?? false;
      if (hornNow && !this.padButtons[PAD.horn]) this.sound?.hornOn();
      if (!hornNow && this.padButtons[PAD.horn]) this.sound?.hornOff();
      this.padButtons[PAD.horn] = hornNow;
    } else {
      this.pad = { steer: 0, throttle: 0, brake: 0, drift: false, nos: false };
      this.padButtons[PAD.flash] = gp.buttons[PAD.flash]?.pressed ?? false;
      this.padButtons[PAD.horn] = gp.buttons[PAD.horn]?.pressed ?? false;
    }
    if (edge(PAD.pause)) {
      // Start: during the film it skips; otherwise the UI takes over
      if (this.cine) this.skipCinematic();
      else this.events.onPauseRequest?.();
    }
  }

  // ---------------------------------------------------------- touch API

  /** Drive from on-screen controls (phones, tablets, Steam Deck touch). */
  setTouchInput(v: Partial<{ throttle: number; brake: number; steer: number }>): void {
    if (v.throttle !== undefined) this.touch.throttle = THREE.MathUtils.clamp(v.throttle, 0, 1);
    if (v.brake !== undefined) this.touch.brake = THREE.MathUtils.clamp(v.brake, 0, 1);
    if (v.steer !== undefined) this.touch.steer = THREE.MathUtils.clamp(v.steer, -1, 1);
    this.sound?.resume();
  }

  /** Touch equivalents of the keyboard actions. */
  touchFlash(): void {
    this.sound?.resume();
    this.tryFlash();
  }
  touchDrift(on: boolean): void {
    this.touch.drift = on;
    this.sound?.resume();
  }
  touchNos(on: boolean): void {
    if (on) this.keys.add("n");
    else this.keys.delete("n");
  }
  touchHorn(on: boolean): void {
    if (on) this.sound?.hornOn();
    else this.sound?.hornOff();
  }

  // ---------------------------------------------------------------- spawning

  private spawnTraffic(count: number): void {
    for (let i = 0; i < count; i++) {
      const mesh = this.trackCar(
        createCar({ body: TRAFFIC_COLORS[i % TRAFFIC_COLORS.length], simple: true })
      );
      this.scene.add(mesh);
      this.traffic.push({
        mesh,
        s: this.track.wrap(120 + (i / count) * this.track.length),
        lat: LANES[i % LANES.length],
        speed: 21 + Math.random() * 9, // 75–108 km/h
        steerVis: 0,
        accel: 0,
        brakeVis: 0,
        rigDt: 0,
      });
    }
  }

  private spawnRival(): void {
    if (this.rival) {
      this.untrackCar(this.rival.mesh);
      this.scene.remove(this.rival.mesh);
      this.rival = null;
    }
    if (this.rivalIndex >= RIVALS.length) return;
    const def = RIVALS[this.rivalIndex];
    // The showroom entry for the machine they brought. It was already
    // being looked up for the length; it carries the body kit too, and a
    // rival turning up in an unmodified version of a car the showroom
    // sells with arches on it is the wrong car.
    const rivalCar = CARS.find((c) => c.name === def.car);
    const mesh = this.trackCar(
      createCar({
        body: def.bodyColor,
        accent: def.accentColor,
        style: def.bodyStyle,
        spoiler: def.bodyStyle === "gtr",
        underglow: def.accentColor,
        // Built as far as its class is built — arches, aero and all.
        // These are the cars you spend the game looking at from a metre
        // away at 200 km/h, and until now they were the only cars in the
        // game wearing nothing at all.
        kit: rivalCar?.kit,
        raceKit: rivalCar?.kit === "attack",
        // A rival runs a livery. Racing numbers come from the roster
        // position so two rivals never wear the same one.
        stickers: true,
        stickerNumber: 20 + this.rivalIndex,
        name: def.car,
        // The machine they actually bring, at the length it actually is.
        // A rival's car is named on their card and sold in the showroom;
        // building it a different size from the one you can buy is two
        // answers to the same question.
        lengthM: rivalCar?.lengthM,
      })
    );
    this.scene.add(mesh);
    this.rival = {
      def,
      mesh,
      s: this.track.wrap(this.player.s + 260),
      lat: LANES[2],
      targetLat: LANES[2],
      speed: 27,
      sp: 100,
      state: "cruise",
      steerVis: 0,
      throttleVis: 0,
      brakeVis: 0,
    };
  }

  // ---------------------------------------------------------------- battle

  /** Headlight flash. Three inside 3 s while alongside a rival issues a
   *  challenge — the TXR ritual: reveal, size each other up, answer. */
  private tryFlash(): void {
    const r = this.rival;
    if (!r || this.inBattle || this.locked || this.challengePending || this.cine) return;
    if (!this.racingOpen()) {
      // Flashing outside the hours does what flashing at a stranger on a
      // motorway does: the lamps blink and nothing else happens.
      this.flashHeadlights();
      this.events.onMessage(
        this.timeHours < GameEngine.RACE_CLOSE_H
          ? "Nobody races before midnight."
          : "The night is over — racing opens again at midnight."
      );
      return;
    }
    // A live duel is refereed on the wall clock by the hub — pausing into
    // the setup card + film mid-duel would forfeit it.
    if (this.duel) return;
    if (r.state !== "cruise") return;
    const gap = this.track.deltaAhead(this.player.s, r.s);
    if (gap < 2 || gap > FLASH_RANGE) return;

    const now = performance.now();
    if (now > this.flashWindowUntil) this.flashCount = 0;
    this.flashWindowUntil = now + 3000;
    this.flashCount++;
    this.flashHeadlights();
    this.sound?.flashClick();

    if (this.flashCount >= 3) {
      this.flashCount = 0;
      this.issueChallenge();
    }
  }

  private playerCard(): DriverCard {
    let name = "You";
    let country = "Kuwait";
    let flag = "🇰🇼";
    try {
      const raw = localStorage.getItem("gulf-road-nights-profile");
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.name === "string" && p.name.trim()) name = p.name.trim();
        if (typeof p.country === "string" && p.country.trim()) country = p.country.trim();
        if (typeof p.flag === "string" && p.flag.trim()) flag = p.flag.trim();
      }
    } catch {}
    return {
      name,
      arabicName: "أنت",
      crew: "Privateer",
      level: levelInfo(loadProfileStats().xp).level,
      country,
      flag,
      color: this.tune.paint,
      car: this.tune.carName,
    };
  }

  /**
   * The driver alongside, in full — or null when there is nobody close
   * enough to read, which is what greys the prompt out.
   *
   * Deliberately unavailable in a battle: mid-race is not when you size
   * somebody up, and a full-screen card over a duel is a pause button
   * with extra steps.
   */
  sizeUpRival(): RivalDossier | null {
    const r = this.rival;
    if (!r || this.inBattle || this.cine || this.locked) return null;
    const gap = this.track.deltaAhead(this.player.s, r.s);
    if (Math.abs(gap) > SIZE_UP_RANGE) return null;
    const def = r.def;
    const machine = CARS.find((c) => c.name === def.car);
    return {
      name: def.name,
      arabicName: def.arabicName,
      crew: def.crew,
      area: def.area,
      country: def.country ?? "Kuwait",
      flag: def.flag ?? "🇰🇼",
      car: def.car ?? "Street Tuned",
      lengthM: machine?.lengthM ?? null,
      topSpeedKmh: def.topSpeedKmh,
      order: RIVALS.indexOf(def) + 1,
      total: RIVALS.length,
      beaten: this.rivalIndex > RIVALS.indexOf(def),
      taunt: def.taunt,
      color: def.bodyColor,
      accent: def.accentColor,
      gap: Math.round(gap),
    };
  }

  private rivalCard(def: RivalDef): DriverCard {
    return {
      name: def.name,
      arabicName: def.arabicName,
      crew: def.crew,
      level: RIVALS.indexOf(def) + 1,
      country: def.country ?? "Kuwait",
      flag: def.flag ?? "🇰🇼",
      color: def.bodyColor,
      car: def.car ?? "Street Tuned",
    };
  }

  /** Both cars reveal, then the race-setup screen opens: the player
   *  picks the car and the stake before the rival is asked. */
  private issueChallenge(): void {
    const r = this.rival;
    if (!r) return;
    this.challengePending = true;
    this.flashRival(r);
    this.sound?.battleSting();

    // Pace is judged at the moment of the flash, before the game pauses
    this.challengePace = Math.max(r.speed * 0.85, 8);
    this.challengeAccepted = this.player.speed >= this.challengePace;

    // Bigger names play for bigger money
    const garage = loadGarage();
    const rivalCeiling = 1000 * Math.pow(2, this.rivalIndex);
    const maxWager = Math.max(0, Math.min(garage.kd, rivalCeiling));

    this.setPaused(true);
    this.events.onChallenge?.(
      this.playerCard(), this.rivalCard(r.def), maxWager, r.def.distance
    );
  }

  /** UI callback: the player confirmed a car, a stake and a length. */
  confirmChallenge(wager: number, carId?: string, distanceId?: string): void {
    const r = this.rival;
    if (!r || !this.challengePending) return;

    if (carId) {
      const g = loadGarage();
      if (g.cars.includes(carId) && g.car !== carId) {
        g.car = carId;
        saveGarage(g);
        this.applyGarage();
      }
    }
    this.wager = Math.max(0, Math.round(wager));
    // An unknown id falls back to the standard length rather than to
    // zero: a race with no distance would end on its first frame.
    this.raceDistanceId = distanceById(distanceId ?? r.def.distance).id;
    this.raceDistanceM = distanceMetres(this.raceDistanceId);
    this.setPaused(false);

    this.challengeTimers.push(
      setTimeout(() => {
        if (this.disposed || !this.rival) return;
        const rv = this.rival;
        this.challengePending = false;
        if (this.challengeAccepted) {
          this.events.onChallengeResult?.(
            true,
            this.wager > 0 ? `Stakes: ${this.wager} KD each` : "Pride only"
          );
          this.beginBattleCinematic(rv);
        } else {
          this.wager = 0;
          this.events.onChallengeResult?.(
            false,
            `Keep pace with them — ${Math.round(this.challengePace * KMH)} km/h or better`
          );
          this.voice.speak(
            rv.def.rejectLine ?? "مو الحين",
            rv.def.voice,
            `${rv.def.id}-reject`
          );
        }
      }, 2200)
    );
  }

  /** UI callback: the player backed out of the race setup. */
  cancelChallenge(): void {
    this.challengePending = false;
    this.wager = 0;
    this.setPaused(false);
  }

  /**
   * Re-read the garage and rebuild the car. Public so the UI can open the
   * garage mid-session and have the change take effect immediately.
   */
  refreshGarage(): void {
    this.applyGarage();
  }

  /** Point the player's paint at the live probe (or back at the baked
   *  environment when the probe is off for performance). */
  /**
   * Rebuild the paint's reflection probe at a new face resolution.
   * 128 is plenty at 1080p, but on a 4K panel the probe is the limiting
   * factor in how the clearcoat reads — the lamp streaks that slide along
   * the bodywork are literally probe texels, and at 128 they are visibly
   * chunky once the frame carries four times the pixels.
   */
  private setProbeResolution(size: number): void {
    if (this.cubeRT.width === size) return;
    const previous = this.cubeRT;
    const floatOk =
      this.renderer.extensions.has("EXT_color_buffer_float") ||
      this.renderer.extensions.has("EXT_color_buffer_half_float");
    this.cubeRT = new THREE.WebGLCubeRenderTarget(size, {
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      type: floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });
    this.scene.remove(this.cubeCam);
    this.cubeCam = new THREE.CubeCamera(0.5, 420, this.cubeRT);
    this.scene.add(this.cubeCam);
    // Re-point the paint at the new target before dropping the old one,
    // or the material spends a frame sampling a disposed texture.
    this.applyLiveReflections();
    previous.dispose();
  }

  /** Racing number for the sticker pack — stable per machine, so the
   *  Kaiju is always the same car on the door no matter the paint. */
  private stickerNumber(): number {
    let h = 0;
    for (const ch of this.tune.carId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return (h % 90) + 10;
  }

  /**
   * Dress one car's paint and metal with the current reflection policy.
   *
   * Every car on the road gets the SAME source and the same gains, which
   * is the only way they can be guaranteed to match. Only the player's
   * car used to be dressed at all; rivals, traffic and other players ran
   * on the materials' own defaults against the baked environment, and
   * the two setups do not land in the same place. Measured on one car
   * under one camera, swapping only these settings: the player's tuned
   * pair clipped 14 pixels of the frame, the untuned one every other car
   * was wearing clipped 72 and sat 11% brighter overall. The hero car
   * was the only one on the street that was not blown out.
   *
   * Sharing the player's probe with traffic reflects the player's
   * surroundings on a car fifty metres away, which is wrong in principle
   * and invisible in practice: it is the same road, the same lamps and
   * the same sky, at a resolution where the paint shows a smear of
   * sodium rather than a picture of anything.
   */
  private dressReflections(group: THREE.Object3D): void {
    // The player's car is built before the probe exists, so this runs
    // once with nothing to point at; applyLiveReflections dresses every
    // car again as soon as the target is up.
    const env = this.liveReflections && this.cubeRT ? this.cubeRT.texture : null;
    const body = group.userData.bodyMat as THREE.MeshPhysicalMaterial | undefined;
    if (body) {
      body.envMap = env;
      // 2.1 on BOTH tiers. This was 1.35 on the live probe, on a clipping
      // argument recorded on the rims below — and measured on the road at
      // night the argument does not bind: swept 1.35 / 1.7 / 2.1 / 2.6 on
      // navy gloss at metalness 0.95, clipping was 0.00% at every gain.
      // What 1.35 was actually doing was making the tier that costs more
      // reflect LESS — the probe sees the real lamps at about 2.6x white
      // where the static sky's synthetic ones sit at 8.5x, and sampling
      // the dimmer environment at the lower gain compounded it. At 2.1
      // the probe lifts 13.1% of the paint by more than 25 (7.4% before)
      // and the bright end goes from 109 to 120. The rims keep their own
      // 1.9x on top for the same reason they always had it.
      body.envMapIntensity = 2.1;
      body.needsUpdate = true;
    }
    // The rims, chrome and brake discs mirror the same world the paint
    // does. Higher gain than the paint: the probe is mostly night sky,
    // and a near-pure metal goes black under it — the lamps it does
    // carry need amplifying for the alloy to read as alloy.
    const metals = group.userData.reflectMats as
      | THREE.MeshStandardMaterial[]
      | undefined;
    for (const m of metals ?? []) {
      const base = (m.userData.baseEnvIntensity as number) ?? 1.5;
      m.envMap = env;
      m.envMapIntensity = this.liveReflections ? base * 1.9 : base;
      m.needsUpdate = true;
    }
  }

  /** Start dressing this car, and dress it now. */
  private trackCar<T extends THREE.Object3D>(group: T): T {
    this.carGroups.add(group);
    this.dressReflections(group);
    return group;
  }

  /** Stop dressing a car that is being disposed — its materials are
   *  about to go, and a policy change must not reach into them. */
  private untrackCar(group: THREE.Object3D | null | undefined): void {
    if (group) this.carGroups.delete(group);
  }

  private applyLiveReflections(): void {
    for (const g of this.carGroups) this.dressReflections(g);
  }

  /** Rebuild the player car after a garage change (new model, paint, mods). */
  /**
   * The pumps.
   *
   * A forecourt fills the car if it is standing on one, off the through
   * lanes and slow enough to be stopping rather than passing. No button:
   * a petrol station is a place you go, and arriving is the input.
   *
   * Petrol is charged in fils as it flows — Kuwait's 91 at 85 fils a
   * litre — rather than billed in a lump at the end, so pulling away
   * half-full costs exactly the half tank that went in. A full 60-litre
   * tank is about five KD, which against a rival purse of several
   * hundred is what it should be: an errand, not a tax.
   */
  private updatePump(dt: number): void {
    const p = this.player;
    const near = STATIONS.find(
      (st) => Math.abs(this.track.deltaAhead(st.s, p.s)) < FORECOURT.halfSpan
    );
    // On the apron: past the through lanes, and slow.
    const onApron = !!near && p.lat > ROAD_HALF_WIDTH - 0.5;
    const stopped = p.speed * KMH < PUMP_MAX_KMH;
    if (!near || !onApron) {
      if (this.pumpOwed > 0) this.chargeForFuel();
      this.pumpState = null;
      return;
    }
    const capacity = this.tune.tankLitres;
    let filling = false;
    if (stopped && this.fuel < capacity - 0.01) {
      const litres = Math.min(PUMP_LITRES_PER_SEC * dt, capacity - this.fuel);
      this.fuel += litres;
      this.pumpOwed += litres * FUEL_FILS_PER_LITRE * 0.001;
      filling = true;
      if (this.outOfFuel && this.fuel > 0.5) {
        this.outOfFuel = false;
        this.events.onMessage("Fuelled — عبّينا", "Back on the road");
      }
    }
    this.pumpState = {
      litres: this.fuel,
      capacity,
      costKd: (capacity - this.fuel) * FUEL_FILS_PER_LITRE * 0.001,
      filling,
    };
    // Bank the bill once a whole fils has accumulated, so a long fill
    // does not write to storage sixty times a second.
    if (this.pumpOwed >= 0.05) this.chargeForFuel();
  }

  private chargeForFuel(): void {
    const owed = this.pumpOwed;
    this.pumpOwed = 0;
    if (owed <= 0) return;
    this.saveFuel();
    addKd(-owed);
  }

  /** Persist the tank against the car that burned it. */
  private saveFuel(): void {
    try {
      setFuel(this.fuel, this.tune.carId);
    } catch {}
  }

  private applyGarage(): void {
    // Bank what the car being put away has left, before the new one's
    // tank is read. `this.tune` is still the old machine at this point,
    // which is exactly why this line goes first.
    this.saveFuel();
    const g = loadGarage();
    this.tune = computeEffects(g);
    // A different car is a different tank. Reading it here — rather than
    // carrying the old car's litres across — is what stops a swap into
    // the pickup from inheriting the hatchback's range.
    this.fuel = fuelOf(g);
    this.outOfFuel = this.fuel <= 0;
    const contact = this.carBody.userData.contact as THREE.Object3D | undefined;
    if (contact) this.playerMesh.remove(contact);
    this.playerMesh.remove(this.carBody);
    // The old car is gone for good — release its per-car materials, or a
    // player cycling paints leaks a shader program per visit. Geometries
    // and module-shared materials stay (other cars still use them).
    // Out of the reflection registry before its materials are released.
    this.untrackCar(this.carBody);
    for (const key of ["bodyMat", "tailMat", "tailCoreMat", "headMat"] as const) {
      (this.carBody.userData[key] as THREE.Material | undefined)?.dispose();
    }
    this.carBody = this.trackCar(
      createCar({
        body: this.tune.paint,
        accent: this.tune.accent ?? 0x007a3d,
        stripes: this.tune.stripes,
        style: this.tune.bodyStyle,
        underglow: this.tune.glow ?? undefined,
        spoiler: this.tune.spoiler,
        goldRims: this.tune.goldRims,
        engineCover: this.tune.engineCover ?? undefined,
        carbon: this.tune.carbon,
        raceKit: this.tune.raceKit,
        kit: this.tune.kit,
        headlamps: this.tune.headlamps,
        tint: this.tune.tint,
        finish: this.tune.finish,
        stickers: this.tune.stickers,
        fullStripe: this.tune.fullStripe,
        stickerNumber: this.stickerNumber(),
        name: this.tune.carName,
        nameAr: this.tune.carNameAr,
        lengthM: this.tune.lengthM,
        crew: this.tune.crew ?? undefined,
        exhaust: this.tune.exhaust,
      })
    );
    this.playerMesh.add(this.carBody);
    const newContact = this.carBody.userData.contact as THREE.Object3D | undefined;
    if (newContact) this.playerMesh.add(newContact);
    // The in-car rig hung off the old shell and went with it.
    this.buildViewRig();
    this.fitLampsToCar();
    this.sound?.setEngine(this.tune.engine);
    this.sound?.configureAspiration(
      this.tune.aspiration === "super" ? "super" : this.tune.boostMult > 0 ? "turbo" : "none"
    );
    const ex = this.tune.exhaust;
    this.sound?.setExhaust(ex.pitch, ex.rasp, ex.loud, ex.tone);
  }

  /**
   * The short pre-battle film: slow-motion orbit of the rival's machine,
   * a side pass of yours, then the camera falls back into the chase and
   * the fight is on. Skippable; reduced motion goes straight to battle.
   */
  private beginBattleCinematic(r: Rival): void {
    const reduced =
      typeof document !== "undefined" &&
      (document.documentElement.dataset.reducedMotion === "1" ||
        (typeof matchMedia !== "undefined" &&
          matchMedia("(prefers-reduced-motion: reduce)").matches));
    if (reduced || !this.events.onCinematic) {
      this.startBattle(r);
      return;
    }
    const headMat0 = this.carBody.userData.headMat as THREE.MeshStandardMaterial | undefined;
    const glows0 = (this.carBody.userData.headGlowMats as THREE.SpriteMaterial[]) ?? [];
    this.cine = {
      start: performance.now(),
      r,
      hits: 0,
      lamps: {
        spot: this.headlight.intensity,
        off: this.headlightR.intensity,
        emissive: headMat0?.emissiveIntensity ?? 0,
        glow: glows0.map((m) => m.opacity),
        beam: this.beamMat?.opacity ?? 0,
      },
    };
    // The intro line plays over the film instead of after it
    this.voice.speak(r.def.lines.intro, r.def.voice, `${r.def.id}-intro`);
    this.events.onCinematic(true, this.rivalCard(r.def), this.wager, this.playerCard());
  }

  /** How long the pre-race film runs, seconds.
   *
   *  Published so the exporter can ask rather than assume: it has to
   *  know how many frames to render, and a hard-coded 14 there would be
   *  a fourth place the timeline is written down and the first one to
   *  go stale. */
  get cineLength(): number {
    return CINE_LEN;
  }

  /** UI callback: the player tapped through the intro film. */
  skipCinematic(): void {
    if (this.cine) this.endCinematic();
  }

  private endCinematic(): void {
    const r = this.cine?.r ?? null;
    // Lamps home before anything else: a film skipped mid-flash must not
    // put the car on the green flag with its main beams up.
    this.applyCineBeam(0);
    this.cine = null;
    // A key or pad held through the film must not fire at the green flag
    this.handbrakeStale = true;
    // Snap the chase camera home instead of lerping across the map
    this.camInit = false;
    if (r) {
      this.events.onCinematic?.(false, this.rivalCard(r.def), this.wager, this.playerCard());
      this.startBattle(r, true);
    }
  }

  /**
   * Line the pair up for the drop: level, abreast, matched.
   *
   * The green flag used to fall wherever the two cars happened to be.
   * The rival is spawned 260 m up the road and cruises; you catch them,
   * flash, sit through the film, and the fight begins from whatever gap
   * that left — sometimes half a length up, sometimes six lengths back,
   * and it decided the race before the flag did.
   *
   * A street race starts rolling and abreast. Both cars are put level on
   * the track, one lane apart, at the same speed, and it is a race from
   * the first metre. The rival takes the lane on the side of the road
   * with more room, so the pair is never lined up with one of them
   * against the barrier.
   */
  /**
   * The lane a car should hold alongside the player: one lane over,
   * toward the middle of the road, and never against the barrier.
   *
   * One function because two callers need the same answer. The intro
   * film's formation and the green flag each worked this out for
   * themselves, with different margins — 1.4 m and 2.2 m off the
   * barrier — so on the narrow sections the rival changed lane at the
   * exact moment the flag dropped.
   */
  private abreastLane(atS: number, playerLat: number): number {
    const half = this.track.halfWidthAt(atS);
    const toward = playerLat > 0 ? -1 : 1;
    return THREE.MathUtils.clamp(playerLat + toward * 3.5, -(half - 2.2), half - 2.2);
  }

  private lineUpAbreast(r: Rival): void {
    const p = this.player;
    // Level, and by moving the RIVAL: moving the player at the green
    // flag is moving the car under the driver's hands, which is the one
    // thing a start must never do.
    r.s = p.s;
    const lane = this.abreastLane(p.s, p.lat);
    r.lat = lane;
    r.targetLat = lane;
    // Matched, and never from a standstill: a rolling start is rolling.
    r.speed = Math.max(p.speed, 14);
    p.speed = Math.max(p.speed, 14);
  }

  private startBattle(r: Rival, fromCine = false): void {
    this.inBattle = true;
    r.state = "battle";
    this.lineUpAbreast(r);
    this.player.sp = 100;
    r.sp = 100;
    this.bstat = { startAt: performance.now(), dist: 0, topSpeed: 0, contacts: 0, maxLead: 0, driftScore: 0 };
    this.spWarned = false;
    // Style points earned cruising before the flag don't count in the race
    breakChain(this.ds);
    this.driftFlash = 0;
    if (fromCine) {
      // The film already introduced them — just drop the green flag.
      this.events.onMessage("GO — يلا!", `"${r.def.taunt}"`);
      // The crew, over the radio, as the flag drops
      this.voice.radioSpeak("يلا، خلّه وراك — روح!", { pitch: 1.05, rate: 1.2 });
    } else {
      this.voice.speak(r.def.lines.intro, r.def.voice, `${r.def.id}-intro`);
      if (this.events.onBattleStart) this.events.onBattleStart(r.def);
      else this.events.onMessage(`BATTLE — ${r.def.name} ${r.def.arabicName}`, `"${r.def.taunt}"`);
    }
  }

  /** The rival flashes back — the reveal. */
  private flashRival(r: Rival): void {
    const mat = r.mesh.userData.headMat as THREE.MeshStandardMaterial | undefined;
    if (!mat) return;
    const glows = (r.mesh.userData.headGlowMats as THREE.SpriteMaterial[]) ?? [];
    const base = mat.emissiveIntensity;
    const baseGlow = glows.map((m) => m.opacity);
    let n = 0;
    const id = setInterval(() => {
      const on = mat.emissiveIntensity <= base;
      mat.emissiveIntensity = on ? base * 4 : base;
      glows.forEach((m, i) => (m.opacity = on ? Math.min(1, baseGlow[i] * 2.1) : baseGlow[i]));
      if (++n >= 6 || this.disposed) {
        clearInterval(id);
        mat.emissiveIntensity = base;
        glows.forEach((m, i) => (m.opacity = baseGlow[i]));
      }
    }, 110);
  }

  /**
   * Put the headlights at `boost` of the way to main beam, 0..1.
   *
   * Two and a half times dipped output at full, which is about what a
   * main beam is over a dipped one, with both lamps, the beam cones and
   * the lamp faces moving together — a flash that only brightens the
   * pool on the road is invisible from every camera the film uses.
   *
   * Level rather than animation: the film's clock decides when, this
   * decides how much, and nothing here owns a timer that could outlive
   * the shot it belongs to.
   */
  private applyCineBeam(boost: number): void {
    const base = this.cine?.lamps;
    if (!base) return;
    const headMat = this.carBody.userData.headMat as THREE.MeshStandardMaterial | undefined;
    const glows = (this.carBody.userData.headGlowMats as THREE.SpriteMaterial[]) ?? [];
    this.headlight.intensity = base.spot * (1 + 1.5 * boost);
    this.headlightR.intensity = base.off * (1 + 1.5 * boost);
    if (headMat) headMat.emissiveIntensity = base.emissive * (1 + 1.6 * boost);
    glows.forEach((m, i) => {
      m.opacity = Math.min(1, (base.glow[i] ?? m.opacity) * (1 + 1.1 * boost));
    });
    if (this.beamMat) this.beamMat.opacity = Math.min(1, base.beam * (1 + 1.3 * boost));
  }

  /**
   * Hit the stalk. Everything else is a function of when.
   *
   * There is no timer here on purpose: a flash is a level the frame loop
   * reads off this mark, so pausing pauses it, the exporter can pose it,
   * and a second press cannot corrupt the first one's idea of what the
   * lamps were doing.
   */
  private flashHeadlights(): void {
    this.flashStart = performance.now() / 1000;
  }

  /**
   * The lamps, this frame: the dipped beam the clock set, plus however
   * much main beam the flash is currently asking for.
   *
   * The cone opens and throws further as well as brightening. A main
   * beam is not a dipped beam turned up — it is aimed higher and reaches
   * past where the dipped one is cut off, and that is the part the eye
   * actually reads as "somebody just flashed me".
   */
  private applyFlashBeam(): void {
    if (this.cine) return; // the film owns the lamps while it runs
    const boost = playerFlashBoost(performance.now() / 1000 - this.flashStart);
    const rest = this.lampRest;
    const headMat = this.carBody?.userData.headMat as THREE.MeshStandardMaterial | undefined;
    const glows = (this.carBody?.userData.headGlowMats as THREE.SpriteMaterial[]) ?? [];
    if (boost <= 0) {
      // At rest, BY DEFINITION — so this is where the rest state is
      // learned, rather than at the start of a flash where it might be
      // read out of the middle of another one. That was the whole bug.
      rest.emissive = headMat?.emissiveIntensity ?? rest.emissive;
      rest.glow = glows.map((g) => g.opacity);
      this.headlight.intensity = rest.spot;
      this.headlightR.intensity = rest.off;
      this.headlight.angle = rest.angle;
      this.headlight.distance = rest.reach;
      return;
    }
    this.headlight.intensity = rest.spot * (1 + FLASH_GAIN * boost);
    this.headlightR.intensity = rest.off * (1 + FLASH_GAIN * boost);
    this.headlight.angle = rest.angle * (1 + FLASH_ANGLE_GAIN * boost);
    this.headlight.distance = rest.reach * (1 + FLASH_REACH_GAIN * boost);
    if (headMat) headMat.emissiveIntensity = rest.emissive * (1 + 1.6 * boost);
    glows.forEach((g, i) => {
      g.opacity = Math.min(1, (rest.glow[i] ?? g.opacity) * (1 + 1.1 * boost));
    });
    // The cone last, and multiplied rather than assigned:
    // updateBeamVisibility rebuilds it from beamBaseOpacity every frame,
    // so this rides on top of it and cannot compound.
    if (this.beamMat) this.beamMat.opacity = Math.min(1, this.beamMat.opacity * (1 + 1.3 * boost));
  }

  /** Snapshot the battle telemetry and settle XP, stats and rewards. */
  private buildResult(
    r: Rival,
    outcome: "win" | "loss",
    money: { purse: number; kd: number; balance: number },
    champion: boolean
  ): RaceResult {
    // A slide still in progress at the flag counts too
    this.bstat.driftScore += this.driftRun;
    this.driftRun = 0;
    const clean = this.bstat.contacts === 0;
    const durationMs = Math.max(0, performance.now() - this.bstat.startAt);
    const topSpeedKmh = Math.round(this.bstat.topSpeed);
    const tier = RIVALS.indexOf(r.def);

    // XP is itemised so the player can see exactly where it came from —
    // the breakdown is what teaches the scoring, not a tooltip.
    const xpBreakdown: Array<{ label: string; value: number }> = [];
    if (outcome === "win") {
      xpBreakdown.push({ label: "Race won", value: 150 });
      xpBreakdown.push({ label: `Rival tier ${tier + 1}`, value: 40 * (tier + 1) });
      if (clean) xpBreakdown.push({ label: "Clean run — no contact", value: 75 });
      if (this.bstat.maxLead >= 60) xpBreakdown.push({ label: "Dominant lead", value: 60 });
      if (topSpeedKmh >= 280) xpBreakdown.push({ label: `Top speed ${topSpeedKmh} km/h`, value: 40 });
      if (this.bstat.driftScore >= 250)
        xpBreakdown.push({
          label: `Drift style ${Math.round(this.bstat.driftScore)}`,
          value: Math.min(120, Math.round(this.bstat.driftScore / 25)),
        });
      if (money.purse > 0) xpBreakdown.push({ label: "Stakes race", value: 50 });
      if (champion) xpBreakdown.push({ label: "King of Gulf Road", value: 500 });
    } else {
      xpBreakdown.push({ label: "Race completed", value: 30 });
      if (this.bstat.maxLead > 0) xpBreakdown.push({ label: "Led the battle", value: 20 });
      if (durationMs > 45000) xpBreakdown.push({ label: "Went the distance", value: 25 });
    }
    const xpGain = xpBreakdown.reduce((a, b) => a + b.value, 0);
    const { before, after } = recordRace(xpGain, outcome, { topSpeed: topSpeedKmh, clean });

    // Rewards: only things that actually changed state get a card.
    const rewards: RewardLine[] = [];
    const lvlBefore = levelInfo(before.xp);
    const lvlAfter = levelInfo(after.xp);
    if (lvlAfter.level > lvlBefore.level) {
      rewards.push({
        icon: "star",
        title: `Level ${lvlAfter.level}`,
        sub: "Driver level up — مستوى جديد",
      });
    }
    if (outcome === "win" && !champion) {
      const next = RIVALS[this.rivalIndex];
      if (next) {
        rewards.push({
          icon: "flag",
          title: `${next.name} unlocked`,
          sub: next.crew,
        });
      }
    }
    if (champion) {
      rewards.push({ icon: "crown", title: "King of Gulf Road", sub: "ملك شارع الخليج" });
    }
    // Anything newly affordable is worth telling them about — it is the
    // difference between "I won money" and "I can buy the GT-R now".
    const owned = new Set(loadGarage().cars);
    const unlockable = CARS.filter(
      (c) => !owned.has(c.id) && c.price <= money.balance && c.price > money.balance - money.kd
    ).sort((a, b) => b.price - a.price)[0];
    if (unlockable) {
      rewards.push({
        icon: "key",
        title: `${unlockable.name} affordable`,
        sub: `${unlockable.price.toLocaleString()} KD in the showroom`,
      });
    }
    if (after.streak >= 3 && outcome === "win") {
      rewards.push({ icon: "streak", title: `${after.streak}-race streak`, sub: "On a run — ما يوقف" });
    }

    return {
      outcome,
      position: outcome === "win" ? 1 : 2,
      rival: this.rivalCard(r.def),
      purse: money.purse,
      kd: money.kd,
      balance: money.balance,
      xpGain,
      levelBefore: lvlBefore,
      levelAfter: lvlAfter,
      xpBreakdown,
      stats: {
        topSpeedKmh,
        durationMs,
        contacts: this.bstat.contacts,
        clean,
        maxLeadSp: Math.round(Math.max(0, this.bstat.maxLead)),
        distanceM: Math.round(this.bstat.dist),
      },
      career: {
        races: after.races,
        wins: after.wins,
        streak: after.streak,
        bestStreak: after.bestStreak,
      },
      rewards,
      champion,
      nextRival: champion
        ? null
        : RIVALS[this.rivalIndex]
          ? {
              name: RIVALS[this.rivalIndex].name,
              arabicName: RIVALS[this.rivalIndex].arabicName,
              crew: RIVALS[this.rivalIndex].crew,
            }
          : null,
    };
  }

  private winBattle(): void {
    const r = this.rival!;
    r.state = "defeated";
    this.inBattle = false;
    this.resultLook = "win";
    // Prize money scales with the roster depth, plus the staked purse
    const payout = 400 + this.rivalIndex * 300 + this.wager;
    const balance = addKd(payout);
    const staked = this.wager;
    this.wager = 0;
    this.rivalIndex++;
    this.saveProgress();
    this.voice.speak(r.def.lines.lose, r.def.voice, `${r.def.id}-lose`);
    const champion = this.rivalIndex >= RIVALS.length;
    const result = this.buildResult(r, "win", { purse: staked, kd: payout, balance }, champion);

    if (champion) {
      this.sound?.championFanfare();
      this.locked = false;
      // Let the ghost concede before the announcer crowns you
      setTimeout(() => this.voice.speak("مبروك! إنت ملك شارع الخليج", {}, "announcer-champion"), 3200);
    } else {
      this.sound?.winSting();
    }

    if (this.events.onResult) {
      // The results screen owns the moment: pause the world behind it.
      this.setPaused(true);
      this.events.onResult(result);
      return;
    }
    // Fallback for hosts without a results screen (e.g. the Unity shim).
    if (champion) {
      this.events.onMessage("KING OF GULF ROAD", "كل الشوارع لك — every street is yours");
      setTimeout(() => this.events.onChampion(), 1800);
    } else {
      this.events.onMessage(`VICTORY — ${r.def.name} defeated`, `+${payout} KD · balance ${balance} KD`);
      setTimeout(() => this.advanceToNextRival(), 2600);
    }
  }

  /**
   * Leave the results screen: spawn the next rival, or hand the
   * championship screen over to the UI.
   */
  resumeAfterResult(): void {
    if (this.disposed) return;
    this.setPaused(false);
    this.resultLook = null;
    if (this.rivalIndex >= RIVALS.length) {
      this.events.onChampion();
      return;
    }
    if (this.rival?.state === "defeated" || !this.rival) this.advanceToNextRival();
  }

  private advanceToNextRival(): void {
    if (this.disposed) return;
    this.spawnRival();
    const next = this.rival;
    if (next) {
      this.events.onMessage(
        `Next: ${next.def.name} — ${next.def.arabicName}`,
        `${next.def.crew} · flash (F) to battle`
      );
    }
  }

  private loseBattle(): void {
    const r = this.rival!;
    r.state = "cruise";
    this.inBattle = false;
    this.locked = true;
    this.resultLook = "lose";
    const staked = this.wager;
    let balance = loadGarage().kd;
    if (staked > 0) {
      balance = addKd(-staked);
      this.wager = 0;
    }
    this.sound?.loseSting();
    this.voice.speak(r.def.lines.win, r.def.voice, `${r.def.id}-win`);
    const result = this.buildResult(r, "loss", { purse: staked, kd: -staked, balance }, false);
    if (this.events.onResult) {
      this.setPaused(true);
      this.events.onResult(result);
      return;
    }
    if (staked > 0) this.events.onMessage(`Lost the purse — ${staked} KD`, `Balance ${balance} KD`);
    this.events.onDefeat(r.def);
  }

  private saveProgress(): void {
    saveRivalsBeaten(this.rivalIndex);
  }

  private loadProgress(): number {
    // RIVALS.length (one past the roster) is a persisted championship.
    // The key itself lives in mods.ts, beside the showroom, because the
    // showroom now gates a car on this number.
    return Math.min(rivalsBeaten(), RIVALS.length);
  }

  // ---------------------------------------------------------------- update

  private update(dt: number): void {
    // Pre-battle cinematic: the camera runs on wall time (so the film is
    // always CINE_LEN seconds, whatever the frame rate) while the world
    // underneath drops into slow motion.
    if (this.cine) {
      // The three hits, fired off the film's own clock rather than a
      // chain of timers: a timer chain keeps running through a skip and
      // lands its last flash over the green flag.
      const ct = (performance.now() - this.cine.start) / 1000;
      // The click is an edge — once per hit, as it starts.
      while (
        this.cine.hits < CINE_FLASH_AT.length &&
        ct >= CINE_FLASH_AT[this.cine.hits]
      ) {
        this.cine.hits++;
        this.sound?.flashClick();
      }
      // ...and the light is a level, read straight off the film's clock.
      this.applyCineBeam(cineFlashBoost(ct));
      if ((performance.now() - this.cine.start) / 1000 >= CINE_LEN) this.endCinematic();
      else {
        // The lap clock is wall-time; credit back what slow-mo swallows
        this.lapStartAt += dt * (1 - 0.22) * 1000;
        dt *= 0.22;
      }
    }
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    this.scrapeCooldown = Math.max(0, this.scrapeCooldown - dt);

    // The clock. A full day turns in CYCLE_MINUTES of play, so a single
    // race happens in one light while a session sees the sun come round.
    if (this.timeReal) {
      // Read, not advanced. A clock that ticks itself drifts from the one
      // it claims to be; this one cannot, because it is that one.
      this.timeHours = kuwaitHours();
      if (this.timeHours < GameEngine.RACE_CLOSE_H) this.nightClosed = false;
      this.skyAccum += dt;
      if (this.skyAccum >= 0.25) {
        this.skyAccum = 0;
        this.world.setTimeOfDay(this.timeHours);
        this.applyDaylight();
      }
    } else if (this.timeCycling) {
      // Inside the window the clock runs at the NIGHT rate, so the five
      // hours and fifty minutes of racing take a session rather than
      // four minutes. Once the window has closed it reverts to the old
      // full-day rate, so the sun comes up at a watchable speed for
      // anyone who stays out in it.
      const perSecond = this.racingOpen()
        ? (GameEngine.RACE_CLOSE_H - GameEngine.RACE_OPEN_H) /
          (GameEngine.NIGHT_MINUTES * 60)
        : 24 / (GameEngine.CYCLE_MINUTES * 60);
      const wasOpen = this.racingOpen();
      this.timeHours = (this.timeHours + perSecond * dt) % 24;
      if (wasOpen && !this.racingOpen() && !this.nightClosed) {
        this.nightClosed = true;
        this.events.onMessage("05:50 — the night is over. Roll home.");
      }
      if (this.timeHours < GameEngine.RACE_CLOSE_H) this.nightClosed = false;
      // The sky is a handful of uniform writes; at 4 Hz it is free and
      // still smooth, because every value it sets is interpolated.
      this.skyAccum += dt;
      if (this.skyAccum >= 0.25) {
        this.skyAccum = 0;
        this.world.setTimeOfDay(this.timeHours);
        this.applyDaylight();
      }
    }

    // The meter and the adaptation run on the GPU inside the pass; it
    // only needs to know how much time this frame took.
    this.exposurePass.dt = dt;

    this.updatePlayer(dt);
    this.updateTraffic(dt);
    this.updateRival(dt);
    this.updateRemotes(dt);
    this.updateRuns(dt);
    if (this.inBattle) this.updateBattle(dt);
    // The film gets its own score. It used to share the battle track,
    // which is the right music for a fight and the wrong music for the
    // eight seconds that start one: the challenge cue is faster, states
    // its hook every bar, and cuts in rather than fading, because a
    // half-second crossfade spends a sixteenth of the film easing.
    this.music?.setMood(
      this.cine ? "challenge" : this.inBattle || this.duel ? "battle" : "cruise"
    );
    // The picture follows the same moment the music does.
    // How fast the foot came off, per SECOND rather than per frame.
    //
    // A frame is not a unit of time, and the overrun sounds used to be
    // triggered by a per-frame difference: measured, the same 40 ms
    // flick backfired twice at 60 fps, once at 30 and never at 144,
    // and a normal 120 ms analogue release fired at none of them. The
    // car's whole overrun character was a function of the display.
    //
    // Long frames are clamped to a thirtieth of a second rather than
    // taken at face value. Across a 500 ms stall the pedal genuinely
    // did close, and dividing by the stall would report a gentle
    // roll-off and swallow the event; treating it as the slowest
    // playable frame keeps a real lift a real lift.
    {
      const th = this.throttle;
      const dtLift = Math.max(1e-4, Math.min(dt, 1 / 30));
      this.liftRate = Math.max(0, (this.lastThrottleFx - th) / dtLift);
      this.lastThrottleFx = th;
      if (this.backfireLockout > 0) this.backfireLockout -= dt;
    }
    this.look = this.deriveLook();
    this.stepLook(dt);
    // Intensity: how fast, how close, how nearly lost. A comfortable
    // battle and a two-second-from-defeat battle share a mood; they
    // should not share a temperature.
    {
      // The weights live in music.ts with the reasoning; this reads the
      // car and hands over three numbers between 0 and 1.
      const speedFrac = this.player.speed / (this.tune.topSpeedKmh / KMH);
      let battle: { closeness: number; desperation: number } | null = null;
      if (this.inBattle && this.rival) {
        const gap = Math.abs(this.track.deltaAhead(this.player.s, this.rival.s));
        battle = {
          closeness: 1 - Math.min(1, gap / 120), // side by side = 1
          desperation: 1 - this.player.sp / 100,
        };
      }
      this.music?.setIntensity(musicIntensity(speedFrac, battle));
    }
    this.updateCamera(dt);
    this.updateBeamVisibility();
    // After the cone is rebuilt from its base, and OUTSIDE it: that
    // function returns early on a car with no visible beam mesh, and the
    // flash is a property of the lamps rather than of the cone.
    this.applyFlashBeam();
    this.updateStreaks();
    this.updateAudio();
    this.world.setCrowdFocus(
      this.playerMesh.position.x,
      this.playerMesh.position.y + 1,
      this.playerMesh.position.z,
      dt
    );
    this.world.tick(dt);
    // The verge answers the car. Wind on every plant, and the wake of
    // this one on the plants beside it — solved on the CPU into one
    // attribute per instance and bent in the vertex shader, which is the
    // only place a thousand of them can afford to move.
    this.world.solvePlants(
      performance.now() / 1000,
      this.playerMesh.position.x,
      this.playerMesh.position.z,
      this.player.speed
    );
    this.updateEffects(dt);
    this.emitHud();
  }

  private updatePlayer(dt: number): void {
    const p = this.player;

    // Accel/drag equilibrium sits at ~92 m/s (≈330 km/h) stock — garage
    // mods raise the multiplier, ceiling, and brake force from there.
    // Turbo spool: pressure builds under throttle, dumps on lift.
    if (this.tune.boostMult > 0 && !this.cine) {
      const spoolRate = this.tune.aspiration === "twin" ? 2.6 : 1.5;
      const target = this.throttle > 0.5 && p.speed > 4 ? 1 : 0;
      if (target < this.boost - 0.4 && this.boost > 0.5) this.sound?.blowOff();
      this.boost += (target - this.boost) * Math.min(1, dt * spoolRate);
    }
    this.updatePump(dt);

    // NOS: hold N for a shove; the bottle refills slowly
    this.nosActive =
      this.tune.hasNos &&
      (this.keys.has("n") || this.pad.nos) &&
      this.nosCharge > 0.02 &&
      this.throttle > 0;
    if (this.nosActive) this.nosCharge = Math.max(0, this.nosCharge - dt / 3);
    else this.nosCharge = Math.min(1, this.nosCharge + dt * 0.06);
    this.sound?.setNos(this.nosActive);

    // Where the needle is, and therefore what the engine is willing to
    // give. A 1.6 at a quarter revs and a 5.7 at a quarter revs are not
    // the same machine, and this is the line that makes that true.
    //
    // The shape averages exactly 1.0 across the usable rev range, so it
    // redistributes the car's power rather than adding any — and it is
    // folded into `power` HERE, above the ceiling solve, on purpose. The
    // governor works by solving a thrust curve that meets drag exactly
    // at the limiter; scale the thrust after that solve and every car
    // quietly asymptotes below its own governor instead of reaching it.
    // The clutch, which this model otherwise does not have.
    //
    // revFraction() is a pure gearbox function: at a standstill it
    // reports the bottom of first, 12% of the rev range. That is where
    // the needle sits when you are ROLLING slowly — and it is not where
    // anybody launches from. A standing start is a slipping clutch
    // holding the engine up near its own torque peak, which is why a
    // 1.6 can chirp its tyres at all. Without this the peaky engines
    // make 0.4x torque off the line, cannot break traction, and the
    // starter car quietly stops being able to spin its wheels — which
    // is exactly what test:motion caught.
    //
    // Scaled by throttle so it is a launch and not a permanent lie, and
    // faded out by 24 km/h, where the clutch is home.
    // The gear, held rather than re-derived.
    //
    // gearAt() answers from speed alone, so a car sitting on a shift
    // point flips gear every frame. That was only a flutter on the
    // needle while a shift was free; now that one costs torque it would
    // be a wall at 55 km/h. The box commits, and only changes its mind
    // once the speed is clear of the boundary by HANDLING.shiftHysteresisKmh.
    const kmh = p.speed * KMH;
    let g = this.gearHeld;
    // WHERE THE BOX CHANGES UP IS THE ENGINE'S BUSINESS.
    //
    // These used to be the raw gear boundaries, identical for every
    // car, so a 1.6 that spins to 8,400 and a 5.7 that stops at 6,200
    // were both taken to the top of every gear and both bounced off
    // their limiter in every one. The only difference between a
    // high-revving car and a torquey one was the numerals printed on
    // the dial.
    //
    // The DOWNSHIFT point moves with it, and has to. Changing up early
    // leaves the car below the next gear's nominal bottom, so a box
    // that still dropped back at GEARS[g] would hunt between the two
    // on every short shift. Falling below where you would have changed
    // up from the gear beneath is the same rule read backwards, and at
    // shiftAt 1 both lines are exactly what they were.
    const shiftAt = this.tune.engine.shiftAt;
    if (g < GEARS.length - 2 && kmh >= upshiftAt(g, shiftAt) + HANDLING.shiftHysteresisKmh) g++;
    else if (g > 0 && kmh < upshiftAt(g - 1, shiftAt) - HANDLING.shiftHysteresisKmh) g--;
    if (g !== this.gearHeld) {
      // A shift is an event with a duration. Start it from wherever the
      // needle actually is, not from where the old gear says it should
      // be, so a shift interrupted by another one carries on from the
      // truth rather than snapping back.
      this.shiftFrom = this.revFrac;
      this.shiftUp = g > this.gearHeld;
      this.shiftT = this.shiftUp ? HANDLING.shiftUpTime : HANDLING.shiftDownTime;
      this.gearHeld = g;
    }

    let gearRev = revFractionIn(this.gearHeld, kmh);
    if (this.shiftT > 0) {
      const total = this.shiftUp ? HANDLING.shiftUpTime : HANDLING.shiftDownTime;
      this.shiftT = Math.max(0, this.shiftT - dt);
      // Smoothstep, not linear: a needle that starts and stops abruptly
      // reads as an animation. The revs leave and arrive gently and move
      // fastest in the middle, which is what a falling engine does.
      const k = Math.min(1, Math.max(0, 1 - this.shiftT / total));
      const e = k * k * (3 - 2 * k);
      gearRev = this.shiftFrom + (gearRev - this.shiftFrom) * e;
    }
    const launch = Math.max(0, 1 - kmh / 24) * this.throttle;
    this.revFrac = gearRev + (this.tune.engine.peakAt - gearRev) * launch;

    // Leaning on the rev limiter. Ramped over the last few percent of
    // the range rather than tripped at exactly 1.0, so it arrives as the
    // needle reaches the stop and a passing frame cannot step over it.
    const revLimitedBefore = this.revLimited;
    this.revLimited =
      this.throttle > 0.6
        ? THREE.MathUtils.clamp(
            (this.revFrac - HANDLING.limiterRevStart) /
              (1 - HANDLING.limiterRevStart),
            0,
            1
          )
        : 0;
    // An engine on its limiter is not a quiet event. The ECU is cutting
    // and restoring fuel several times a second and the whole car
    // shakes with it — that is what tells a driver to change up without
    // looking at anything. The sound has had the cut since the stutter
    // was pinned to the clock; the car itself did not move.
    //
    // Two parts, because they are two different feelings. The first
    // touch is a HIT: a single jolt on the edge, the moment the needle
    // arrives. After that it is a sustained buzz that grows with how
    // hard the car is leaning on the stop, small enough to read as an
    // engine rather than as a kerb.
    if (this.revLimited > 0.05 && revLimitedBefore <= 0.05) {
      this.shake = Math.max(this.shake, LIMITER_HIT_SHAKE);
      this.events.onLimiterHit?.();
    }
    if (this.revLimited > 0.05) {
      this.shake = Math.max(this.shake, LIMITER_BUZZ_SHAKE * this.revLimited);
    }

    // Fuel. An engine is an air pump and the burn follows the air it
    // moved, so the thirst of each of the five falls straight out of its
    // displacement and the revs it is turning — see engines.ts. A dry
    // tank is not a penalty applied to the car; it is an engine that has
    // stopped running, so the throttle simply stops meaning anything and
    // the car coasts to whatever it can reach.
    if (!this.cine) {
      const burn =
        fuelLitresPerSecond(this.tune.engine, this.throttle, this.revFrac) * FUEL_RATE * dt;
      this.fuel = Math.max(0, this.fuel - burn);
      this.fuelBurned += Math.min(burn, this.fuel + burn);
      const dry = this.fuel <= 0;
      if (dry !== this.outOfFuel) {
        this.outOfFuel = dry;
        if (dry) this.events.onMessage("Out of fuel — بنزين خلص", "Coast to a station and fill up");
      }
    }

    const torque = torqueShape(this.tune.engine, this.revFrac);
    // Torque interruption, and only on the way UP. That is the half of a
    // shift a driver feels in their back: the clutch comes out, the car
    // stops pulling for a fifth of a second, and the revs fall because
    // nothing is driving them. A downshift is the opposite — the road is
    // dragging the engine up — so cutting there would be inventing a
    // pause that a real box does not have.
    const shiftCut =
      this.shiftT > 0 && this.shiftUp
        ? 1 -
          (1 - HANDLING.shiftTorqueCut) *
            (this.shiftT / HANDLING.shiftUpTime)
        : 1;
    // The limiter's own cut. Deliberately NOT in top gear: there the
    // governor is what holds the car, and it is already solved into the
    // thrust curve above — cutting again would drag every car below the
    // top speed printed on its own card, which is what test:topspeed
    // exists to catch.
    const inTopGear = this.gearHeld >= GEARS.length - 2;
    const limiterCut = inTopGear
      ? 1
      : 1 - (1 - HANDLING.limiterTorqueCut) * this.revLimited;
    const power =
      this.tune.accelMult *
      torque *
      shiftCut *
      limiterCut *
      (1 + this.boost * this.tune.boostMult);
    // Every car is governed at its own number (180-400 km/h), and the
    // thrust curve is solved so that at exactly that speed thrust equals
    // drag — the limiter is where the car naturally runs out of road,
    // not a figure printed on a card it never reaches. If a build lacks
    // the power to hold its governor, the curve simply tops out lower;
    // the governor is a ceiling, never a promise of thrust.
    const limitMs = this.tune.topSpeedKmh / KMH;
    const dragAtLimit = (0.0012 * limitMs * limitMs + 1.2) * 0.35;
    const headroom = 1 - dragAtLimit / (19 * power);
    // The curve keeps its old shape (115 m/s asymptote) unless the car's
    // governor needs more room than that. Tying it *down* to a slow car's
    // limiter would flatten the mid-range until the tires never lit up.
    const ceiling = Math.max(115, headroom > 0.08 ? limitMs / headroom : limitMs * 12);
    // Sideways tires can't put all the power down — a slide trades a
    // little speed for the angle, so gripping is always the faster line.
    const driveGrip = 1 - Math.min(0.55, Math.abs(this.driftYaw) * 1.1);
    // The engine proposes, the tires dispose: torque beyond what the
    // driven axle can transmit becomes wheelspin, not thrust. Traction
    // climbs as speed builds (weight settles, aero starts working), so
    // launches are traction-limited and the top end stays power-limited —
    // which is why the big-power cars leave the line in smoke instead of
    // teleporting.
    const engineAccel =
      this.throttle * Math.max(0, 19 * power * (1 - p.speed / ceiling));
    // Grip, as it is at this speed. The tyres are a constant; the aero
    // is not — a wing works on air and there is four times as much of it
    // at twice the speed. Everything grip-limited below reads this one
    // number: what the driven axle can put down, what the brakes can
    // reach, and how hard the car can be turned.
    const grip = gripAtSpeed(this.tune.gripAccel, this.tune.downforce, p.speed);
    // ...and where that grip IS. The load solver ran last frame, on last
    // frame's acceleration, which is the physically correct order: load
    // lags the pedal by the time the springs take to compress.
    const load = this.load;
    const tractionCap =
      grip *
      (0.8 + 0.2 * Math.min(1, p.speed / 22)) *
      this.tune.tractionMult *
      // Squat presses the driven axle into the road. Bounded tightly —
      // see grip.ts — because uncapped this feeds itself.
      load.driveScale;
    this.wheelspin = Math.max(0, engineAccel - tractionCap) * driveGrip;
    const accel =
      Math.min(engineAccel, tractionCap) * driveGrip + (this.nosActive ? 14 : 0);

    // Brakes are grip-limited, not pad-limited: pads can out-torque the
    // tire, but the tire cannot out-grip the road. Better pads still pay
    // — they reach the tires' limit and hold it — the tires just set
    // most of the ceiling. Everything past that ceiling — locking,
    // anti-lock, fade, and the rotation a light rear gives up — is
    // brakes.ts; this is where its answer is applied.
    const latDemand = Math.min(1, (Math.abs(this.steerSmooth) * p.speed) / 40);
    const brakeCap = brakeCeiling(this.tune, latDemand, grip);
    const bk = solveBrakes(this.bs, {
      dt,
      brake: this.brake,
      speed: p.speed,
      latDemand,
      grip,
      steer: this.steerSmooth,
      throttle: this.throttle,
      tune: this.tune,
    });
    this.brakeOut = bk;
    const braking = bk.decel;
    // The tow. Only the aerodynamic term is discounted — the constant
    // 1.2 is rolling resistance, which is the tyres deforming against
    // the road and does not care what the air is doing. Multiplying the
    // whole drag figure would have the wake reduce friction, which is
    // both wrong and the kind of wrong that only shows up as cars
    // coasting further than they should.
    this.updateTow();
    const drag = 0.0012 * p.speed * p.speed * this.tow.drag + 1.2;
    p.speed = Math.max(0, p.speed + (accel - braking - drag * (this.throttle ? 0.35 : 1)) * dt);
    // The governor cuts fuel: nitrous and a tow can get you here faster,
    // but not past it.
    if (p.speed > limitMs) p.speed = limitMs;

    // What the car actually did this frame, fed back into the springs so
    // next frame's grip is where this frame's pedals put it.
    this.load = solveLoad(this.ls, {
      dt,
      aLong: accel - braking - drag * (this.throttle ? 0.35 : 1),
      drive: this.tune.drive,
      throttle: this.throttle,
    });

    // --- Steering: the car carries a heading relative to the lane.
    // Yaw authority is grip-limited, so it shrinks as speed rises — and
    // friction circle, half two: heavy braking or a spinning rear axle
    // leaves less grip to turn with, so the car pushes wide instead of
    // holding an impossible arc.
    // Steering, and the caster under it.
    //
    // The smoother chases the driver's input at the rack's own rate. The
    // caster is what a released wheel does ON TOP of that: a real one is
    // self-aligning torque from the front tyres, so it grows with road
    // speed and is worth nothing standing still. Scaled by how far the
    // driver has LET GO — full when the input is centred, none when they
    // are holding lock — because a caster fights the hands rather than
    // helping them, and a car that centres itself while you are steering
    // is a car with a fault.
    const caster =
      HANDLING.casterRate *
      Math.min(1, p.speed / HANDLING.casterRefSpeed) *
      (1 - Math.min(1, Math.abs(this.steer)));
    this.steerSmooth +=
      (this.steer - this.steerSmooth) *
      Math.min(1, dt * (this.tune.steerRate + caster));
    const longDemand = Math.min(1, (braking + this.wheelspin) / (brakeCap || 1));
    const yawRateMax =
      Math.min(1.6, grip / Math.max(p.speed, 2)) *
      (1 - 0.35 * this.tune.understeerMult * longDemand) *
      // Steering comes off the FRONT axle, and how much is on it
      // depends on what the driver is doing with the other two pedals.
      // Dive under braking loads the nose and the car turns in; squat
      // under power unloads it and the car pushes wide. This one term is
      // most of what "the car has dynamics" means, and it was missing.
      load.steerScale *
      // Dirty air. The nose is the first thing into the wake and the
      // first thing to go light in it, which is what stops the tow from
      // being a button that says "go faster": free speed on the straight,
      // a vague front end if you are still sitting there when the road
      // bends. Six percent — enough to feel on turn-in, not enough to
      // punish.
      this.tow.frontGrip *
      // Locked front tires are erasers: they do not steer at all, which
      // is why the car that goes straight on into the barrier is nearly
      // always the one with the pedal buried rather than modulated.
      bk.steerScale;
    this.heading += this.steerSmooth * yawRateMax * dt;
    // Cornering isn't free: held near the limit, the front tires scrub
    // speed off — the reason real drivers straighten before they send it.
    //
    // ...and it comes out of the SAME grip budget the brakes are
    // spending, which it did not used to. The brake ceiling already
    // gives up its share to lateral demand; this is the other leg of
    // that circle, and without it a car at full lock on the brakes got
    // a reduced brake AND an undiminished scrub — the tyre billed
    // twice. It hid until load transfer arrived and made the car turn
    // in 22% harder on the brakes, at which point a full-lock stop came
    // out the same length as a straight one, which no tyre can do.
    const latAvail = Math.sqrt(Math.max(0, 1 - 0.6 * longDemand * longDemand));
    p.speed *= 1 - Math.abs(this.heading) * Math.min(1, p.speed / 40) * 0.3 * latAvail * dt;
    // Caster self-centering when the wheel is released
    if (Math.abs(this.steer) < 0.1) {
      this.heading -= this.heading * Math.min(1, dt * 2.4);
    }
    this.heading = THREE.MathUtils.clamp(this.heading, -0.45, 0.45);

    // --- Drift. The handbrake breaks the rear tires loose: the body
    // rotates past the direction of travel (driftYaw) while the velocity
    // heading is dragged behind it, so the car goes through the corner
    // sideways. Everything that decides how far it goes, what holds it
    // there, and what happens when nobody catches it is drift.ts.
    const dr = solveDrift(this.ds, {
      dt,
      speed: p.speed,
      steer: this.steerSmooth,
      throttle: this.throttle,
      handbrake: this.handbrake,
      wheelspin: this.wheelspin,
      brakeRotate: bk.rotate,
      rearLight: load.rearLight,
      drive: this.tune.drive,
      driftAngleMult: this.tune.driftAngleMult,
    });
    // The slide's own scrub, on the same budget as everything else.
    // Sideways scrub is lateral tyre work, and a tyre already spending
    // its grip on the brakes has less of it to spend sideways — the
    // same circle the brake ceiling is drawn from, read the other way
    // round. Without this, a car at full lock on the brakes decelerated
    // HARDER than the same car braking flat out in a straight line,
    // which is not a thing a tyre can do.
    p.speed *= 1 - dr.scrubRate * latAvail * dt;
    if (dr.jolt > 0) this.shake = Math.max(this.shake, dr.jolt);
    if (dr.spun) {
      // Losing it is an event, not a slow fade — the camera and the tires
      // both say so, and the run that was building is gone.
      this.shake = Math.max(this.shake, 0.55);
      this.sound?.scrape(0.8);
      this.driftFlash = 0;
    }
    // A trail-braked entry rotates the car's line as well as its body:
    // this is the difference between pointing sideways and going there.
    if (!dr.spinning && Math.abs(bk.rotate) > 0.05) {
      this.heading += bk.yaw * dt;
    }
    if (dr.gained > 0) this.driftFlash = 1.2;
    else if (this.driftFlash > 0) this.driftFlash -= dt;
    if (dr.banked > 0 && this.inBattle) this.bstat.driftScore += dr.banked;
    // ...and the same points count towards the online run when there was
    // somebody alongside. `besideRemote` is last frame's answer by the
    // time this reads it, which is the difference between a slide that
    // ended with a stranger next to you and one that ended sixteen
    // milliseconds after they were.
    if (dr.banked > 0 && this.besideRemote) {
      this.runs.driftBeside += dr.banked;
      this.runsDirty = true;
    }
    if (dr.linked) this.sound?.driftLink(dr.chain);

    // --- Centrifugal push: sweepers shove the car toward the outside,
    // demanding counter-steer at speed.
    this.track.tangentAt(p.s, this.v1);
    this.track.tangentAt(p.s + 8, this.v2);
    const crossY = this.v1.z * this.v2.x - this.v1.x * this.v2.z;
    const curvature = -Math.asin(THREE.MathUtils.clamp(crossY, -1, 1)) / 8;
    const pushAccel = THREE.MathUtils.clamp(
      curvature * p.speed * p.speed * 0.22 * this.tune.slipMult,
      -8,
      8
    );
    this.slipVel += (pushAccel - this.slipVel * 2.5) * dt;
    this.curvature = curvature;

    // Sideways tires translate less of the heading into lateral travel —
    // the body hangs out while the trajectory stays controllable.
    const driftScrub = 1 - 0.5 * Math.min(1, Math.abs(this.driftYaw) / 0.5);
    p.lat += (Math.sin(this.heading) * p.speed * driftScrub + this.slipVel) * dt;

    // The wall follows the drivable width — constant four lanes except
    // through the Sharq plaza, where the road swells into the circle
    const maxLat = this.track.halfWidthAt(p.s) - 1.1;
    let hitKerb = Math.abs(p.lat) > maxLat;
    if (hitKerb) p.lat = THREE.MathUtils.clamp(p.lat, -maxLat, maxLat);

    // The plaza island is solid too: push out radially in (s, lat) space
    {
      const ds = this.track.deltaAhead(DRIFT_PLAZA.s, p.s);
      if (Math.abs(ds) < DRIFT_PLAZA.islandRadius + 4) {
        const dLat = p.lat - DRIFT_PLAZA.islandLat;
        const dist = Math.hypot(ds, dLat);
        const minR = DRIFT_PLAZA.islandRadius + 0.9; // half a car of margin
        if (dist < minR) {
          const push = minR - dist;
          p.s = this.track.wrap(p.s + (ds / (dist || 1)) * push);
          p.lat += (dLat / (dist || 1)) * push;
          hitKerb = true;
        }
      }
    }

    if (hitKerb) {
      // A wall hit is not one thing. The speed component INTO the
      // barrier decides what happened: near-parallel contact is a scrape
      // that grinds the door, a steep arrival is a crash that deflects
      // the nose, kills real speed and bounces the car back off.
      const side = Math.sign(p.lat) || 1;
      const intoWall = Math.max(
        0,
        (Math.sin(this.heading) * p.speed * driftScrub + this.slipVel) * side
      );
      const severity = Math.min(1, intoWall / 12);
      // Sustained rubbing: friction scales with how hard the car is
      // pressed into the steel, not a flat rate
      p.speed *= 1 - (0.35 + 1.3 * severity) * dt;
      if (Math.sign(this.heading) === side) {
        // The barrier turns the nose away — steeper arrivals rebound more
        this.heading *= -(0.1 + 0.3 * severity);
      }
      this.slipVel *= 0.2;
      // The wall ends the slide — and takes the unbanked style points
      // and the multiplier with it. A chain you can carry through a
      // barrier is a chain that rewards bouncing off one.
      this.driftYaw *= 0.25;
      breakChain(this.ds);
      if (this.scrapeCooldown <= 0) {
        this.scrapeCooldown = 0.5;
        // The impact itself, once per contact: energy loss and a shove
        // off the barrier, both scaled by how hard it was hit — and by
        // how much of it a cage absorbs
        p.speed *= 1 - 0.28 * severity * (1 - this.tune.crashResist);
        this.slipVel = -side * (1.2 + 5 * severity);
        this.events.onBump();
        if (this.inBattle) this.bstat.contacts++;
        this.spawnSparks(Math.sign(p.lat) || 1, severity);
        this.sound?.scrape(severity);
        this.shake = Math.max(this.shake, 0.3 + 0.9 * severity);
        if (this.inBattle)
          p.sp = Math.max(
            0,
            p.sp - Math.round((2 + 8 * severity) * (1 - this.tune.crashResist))
          );
      }
    }

    // Lap timing: a lap counts when the start line is crossed after
    // covering (almost) the full circuit since the previous crossing.
    this.lapDistance += p.speed * dt;
    const unwrapped = p.s + p.speed * dt;
    if (unwrapped >= this.track.length) {
      const now = performance.now();
      if (this.lapDistance >= this.track.length * 0.995) {
        const ms = now - this.lapStartAt;
        recordLap(ms);
        this.events.onLap?.(ms);
      }
      this.lapStartAt = now;
      this.lapDistance = 0;
    }
    p.s = this.track.wrap(unwrapped);

    this.track.pose(p.s, p.lat, this.v1, this.v2);
    this.track.tangentAt(p.s, this.v3);
    this.playerMesh.position.copy(this.v1);
    this.v4.copy(this.v1).add(this.v3);
    this.playerMesh.lookAt(this.v4);
    // Body language: nose follows the heading, and the shell moves on
    // its springs.
    this.carBody.rotation.y = -(this.heading * 0.85 + this.driftYaw);

    // --- Roll, from cornering force rather than from steering angle.
    //
    // This used to be `heading * 0.06 + driftYaw * 0.1`: a fraction of
    // the angle the car was POINTING at. A car does not lean because its
    // nose is turned, it leans because the tyres are pushing it sideways
    // — so a car crawling through a car park at full lock leant as hard
    // as one at 200 through a sweeper, and a fast sweeper taken with the
    // wheel nearly straight barely leant at all. Backwards in both
    // directions.
    //
    // Lateral acceleration, properly: the rate at which the direction of
    // TRAVEL is turning, times how fast it is going. Both halves are
    // already in this model — the road's own curvature, and the slip
    // angle between where the car points and where it is going — so this
    // is bookkeeping rather than a new force.
    const beta = Math.atan2(
      Math.sin(this.heading) * p.speed * driftScrub + this.slipVel,
      Math.max(1, p.speed)
    );
    const betaRate = (beta - this.prevBeta) / Math.max(dt, 1e-4);
    this.prevBeta = beta;
    const latAccel = (this.curvature * p.speed + betaRate) * p.speed;
    // One consequence worth knowing before somebody files it as a bug:
    // holding lock on a STRAIGHT eventually produces almost no lean. The
    // handling model is lane-relative — steering sets a crab angle
    // rather than integrating into a circle — so once that angle
    // settles, the direction of travel has stopped changing and there is
    // genuinely no cornering force left to lean against. The transient
    // is there (measured: a peak of 2.4 degrees on turn-in, settling to
    // 0.3), and the track's own curvature carries the rest: the Ras
    // Al-Ard sweep leans the car 1.75 degrees with the wheel dead
    // straight. Adding a term to make a forceless state lean anyway
    // would be putting back exactly what this change took out.
    //
    // Leaning OUT of the corner, which is what a car on soft springs
    // does; the sign is asserted in tests/body.mjs rather than trusted.
    // Per car, not one number for the fleet. MAX_ROLL was a static, so
    // a pickup leaned exactly as far as a race-kitted supercar — 3.15
    // degrees at 1.43 g, all sixteen. The tune carries a roll gradient
    // now, off the silhouette and what is bolted to it, and coilovers
    // finally do the most visible thing stiffer springs do.
    const rollTarget =
      THREE.MathUtils.clamp(-latAccel / 14, -1, 1) *
      (this.tune.rollMax ?? GameEngine.MAX_ROLL);

    // --- Pitch, from what the car is actually doing rather than from
    // where the pedals are. Pedal position lies: a car against its
    // governor is at full throttle and not accelerating, and one
    // spinning its wheels is at full throttle and barely moving.
    const longAccel = (p.speed - this.prevSpeed) / Math.max(dt, 1e-4);
    this.prevSpeed = p.speed;
    this.longAccel = longAccel;
    const pitchTarget = THREE.MathUtils.clamp(-longAccel * 0.0039, -0.02, 0.045);

    // Both on springs. A body settles on its suspension — it does not
    // arrive. Slightly underdamped, so a quick flick leaves it rocking
    // for a beat the way a real shell does, and clamped in dt so a
    // dropped frame cannot make the integrator explode.
    const dts = Math.min(dt, 1 / 30);
    this.rollVel += ((rollTarget - this.roll) * 95 - this.rollVel * 13.5) * dts;
    this.roll += this.rollVel * dts;
    this.pitchVel += ((pitchTarget - this.pitch) * 120 - this.pitchVel * 16) * dts;
    this.pitch += this.pitchVel * dts;
    this.carBody.rotation.z = this.roll;
    this.carBody.rotation.x = this.pitch;
    this.latAccel = latAccel;

    // The lamps, bolted on. One copy of the body's attitude and the
    // beams dive under braking, lift under power, roll into a corner and
    // — the one that shows most — sweep across the scenery as the tail
    // steps out, because driftYaw is part of that rotation.
    this.lampRig.rotation.copy(this.carBody.rotation);

    // Adaptive front lighting. Real swivelling lamps lead the car into a
    // corner by up to about fifteen degrees; this leads by eight at full
    // lock, damped so it leans rather than twitches on every correction.
    const swivelTarget = this.steerSmooth * 5.5;
    this.lampSwivel += (swivelTarget - this.lampSwivel) * Math.min(1, dt * 4);
    this.headlight.target.position.x = this.lampSwivel + this.headlight.position.x * 0.35;
    this.headlightR.target.position.x = this.lampSwivel + this.headlightR.position.x * 0.35;

    // The pool on the asphalt follows the aim but stays flat: it is
    // where the light lands, not part of the car. Yaw from the body,
    // reach from the pitch — brake hard and the lit patch pulls in
    // toward the bumper, which is exactly what a diving nose does to it.
    this.poolPivot.rotation.y = this.carBody.rotation.y;
    this.pool.position.x = this.lampSwivel * 0.5;
    this.pool.position.z = 10.5 - this.pitch * 62;
    // Lit-up rears visibly overspin the road speed — the launch tell.
    //
    // The wheels roll at the component of travel along the car's OWN
    // axis, not at road speed. Sideways they turn slower than the car is
    // moving; at ninety degrees they stop turning altogether while the
    // car is still doing a hundred; past ninety, in a spin that has come
    // round, they turn backwards. It is the same cos that decides how
    // much of the velocity the tyre can roll off and how much it has to
    // scrub, and until now the wheels were spinning merrily at road
    // speed through the middle of a spin.
    spinWheels(
      this.carBody,
      p.speed * Math.cos(this.driftYaw),
      dt,
      // Road wheels turn about 30 degrees at full lock. This was 0.3 rad
      // — 17 degrees — which reads as a car that never quite commits to
      // the corner it is visibly taking.
      -this.steerSmooth * 0.52,
      this.brakeOut?.lock ?? 0,
      this.wheelspin
    );
    this.updateDriver(dt);
    if (typeof window !== "undefined" && !(window as unknown as { __ikSolve?: unknown }).__ikSolve) {
      // Debug hook: lets the IK test drive the solver directly
      (window as unknown as { __ikSolve: unknown }).__ikSolve = (
        arm: { shoulder: THREE.Object3D; elbow: THREE.Object3D; upper: number; lower: number },
        target: THREE.Vector3,
        pole: THREE.Vector3
      ) =>
        solveTwoBone({
          root: arm.shoulder,
          mid: arm.elbow,
          upper: arm.upper,
          lower: arm.lower,
          target,
          pole,
          // The same limits and softening the driver passes. A hook that
          // drove the bare solver measured the pre-limit chain: joint
          // limits and the reach edge both read as broken while every
          // arm in the game was fine.
          minBend: (RIG.driver.elbowMinDeg * Math.PI) / 180,
          maxBend: (RIG.driver.elbowMaxDeg * Math.PI) / 180,
          softReach: RIG.driver.softReach,
        });
    }
    const brakeLit = this.brake > 0 || this.handbrake;
    // The levels live in cars.ts (TAIL) beside the materials they are
    // set on, rather than as six unnamed numbers split across two files.
    (this.carBody.userData.tailMat as THREE.MeshStandardMaterial).emissiveIntensity = brakeLit
      ? TAIL.lensBrake
      : TAIL.lensIdle;
    // The hot inner element flares with the lens, a step brighter, so the
    // lamp has a centre rather than being one even slab of red.
    const tailCore = this.carBody.userData.tailCoreMat as THREE.MeshStandardMaterial | undefined;
    if (tailCore) tailCore.emissiveIntensity = brakeLit ? TAIL.coreBrake : TAIL.coreIdle;
    // The glow halos behind the lenses flare with them
    const tailGlows = this.carBody.userData.tailGlowMats as THREE.MeshBasicMaterial[] | undefined;
    if (tailGlows) {
      for (const g of tailGlows) g.opacity = brakeLit ? TAIL.glowBrake : TAIL.glowIdle;
    }

    // Traffic collisions. Severity comes from the closing speed, the way
    // it does on a real bumper: matching the flow and tapping a car is a
    // shunt; arriving 80 km/h faster is a wreck.
    if (this.bumpCooldown <= 0) {
      for (const t of this.traffic) {
        const ds = this.track.deltaAhead(p.s, t.s);
        // Margins sized to the 1.12x presence scale in cars.ts — the
        // hitbox stays a touch inside the visual metal (forgiving beats
        // phantom contact), but not so far that bumpers overlap.
        if (Math.abs(ds) < 4.4 && Math.abs(t.lat - p.lat) < 2.1) {
          this.bumpCooldown = 1;
          const rel = p.speed - t.speed; // + = we ran into them
          const closing = Math.abs(rel);
          const sev = Math.min(1, closing / 22);
          if (rel >= 0) {
            // We hit them: the closing speed is mostly shed, and a harder
            // hit sheds proportionally more of it
            p.speed = Math.max(
              0,
              t.speed + rel * (0.4 - 0.25 * sev * (1 - this.tune.crashResist))
            );
            // Knock the player out of the hitbox, or the cooldown
            // re-bumps forever and glues them to the traffic car's tail.
            if (ds >= 0) p.s = this.track.wrap(t.s - 5.0);
          } else {
            // They hit us: a rear shunt shoves the car forward by a share
            // of the striker's closing momentum — not to its full speed,
            // which would be a free elastic slingshot off every bumper.
            p.speed += closing * 0.45;
            if (ds < 0) p.s = this.track.wrap(t.s + 5.0);
          }
          // The nose glances off toward the open side and the body gets
          // kicked off line — a shunt is never perfectly square
          const shove = Math.sign(p.lat - t.lat) || 1;
          p.lat += shove * (0.4 + 0.9 * sev);
          this.heading += shove * 0.06 * (0.5 + sev);
          this.driftYaw = this.driftYaw * 0.25 + shove * 0.12 * sev;
          breakChain(this.ds);
          this.events.onBump();
          if (this.inBattle) this.bstat.contacts++;
          this.spawnSparks(Math.sign(p.lat - t.lat) || 0, sev);
          this.sound?.bump(0.5 + sev);
          this.shake = 0.5 + 0.7 * sev;
          if (this.inBattle)
            p.sp = Math.max(
              0,
              p.sp - Math.round((4 + 8 * sev) * (1 - this.tune.crashResist))
            );
          break;
        }
      }
    }
  }

  private updateTraffic(dt: number): void {
    for (const t of this.traffic) {
      const was = t.speed;
      // Ease off if another civilian is right ahead in the same lane.
      //
      // Find the NEAREST one and brake once. This used to brake once per
      // car it found, inside the loop — so a queue four deep took four
      // times the deceleration in a single frame, and the driver-IK test
      // measured 72 m/s2 off a rule whose whole point is a 6 m/s2 limit.
      // Seven g in a Corolla. It was invisible while nothing read the
      // number; the moment a driver's body was solved from it, the body
      // folded like a crash test.
      let lead: TrafficCar | null = null;
      let leadGap = Infinity;
      for (const o of this.traffic) {
        if (o === t) continue;
        const ds = this.track.deltaAhead(t.s, o.s);
        if (ds > 0 && ds < 14 && Math.abs(o.lat - t.lat) < 2 && ds < leadGap) {
          leadGap = ds;
          lead = o;
        }
      }
      if (lead) t.speed = Math.max(lead.speed * 0.95, t.speed - 6 * dt);
      // What the car just did to itself, which is the only longitudinal
      // kinematics a civilian has. Differenced here rather than inside
      // the driver solver because only a fraction of the traffic is
      // solved at any moment (see TRAFFIC_DRIVERS_SOLVED) and the speed
      // has to be tracked for all of them or the difference is taken
      // across however many frames that car last happened to be near.
      t.accel = dt > 0 ? (t.speed - was) / dt : 0;
      t.s = this.track.wrap(t.s + t.speed * dt);
      this.track.pose(t.s, t.lat, this.v1, this.v2);
      this.track.tangentAt(t.s, this.v3);
      t.mesh.position.copy(this.v1);
      this.v4.copy(this.v1).add(this.v3);
      t.mesh.lookAt(this.v4);
      spinWheels(t.mesh, t.speed, dt);
    }
    this.solveTrafficDrivers(dt);
  }

  /**
   * Pose the traffic's drivers — but only the ones close enough to be
   * seen doing it.
   *
   * Every car on this road carries a driver now, which is thirty rigs.
   * Solving all of them every frame would spend most of the work on
   * cars behind the camera or half a kilometre up the road. In-range
   * rigs are solved STALEST FIRST on a fixed budget: with six or fewer
   * in range every driver solves every frame with dt unchanged --
   * bit-identical to solving them all -- and with more than six each
   * solves six-Nths of the frames with its accumulated sim time handed
   * to that solve, so the eases converge at the same rate and the IK
   * (which lands exactly on each solve) is simply sampled less often.
   *
   * It used to be nearest-first, and nearest-first had a failure mode
   * this replaces: a rig that dropped out of the top six FROZE at its
   * last solved pose -- held lock, held lean -- because the solver
   * writes pose absolutely and nothing ever reset it. The old comment
   * here claimed evicted cars "keep the seated rest pose"; the code did
   * not do that, and staleness scheduling makes the claim unnecessary
   * rather than making it true. A car re-entering range after a long
   * absence has its accumulator capped at 0.25 s, and 0.25 times the
   * slowest rig rate is past 1, so its first solve snaps to the correct
   * pose at the range edge instead of easing there visibly.
   */
  private solveTrafficDrivers(dt: number): void {
    const near: TrafficCar[] = [];
    for (const t of this.traffic) {
      const rig = t.mesh.userData.driver as DriverRig | undefined;
      if (!rig) continue;
      // Every rig ages, in range or not, so a car wandering back into
      // range presents an honest "how long since I was posed".
      t.rigDt += dt;
      // Signed gap, so a car just behind you counts as close too
      const gap = Math.abs(this.track.deltaAhead(this.player.s, t.s));
      if (gap < TRAFFIC_DRIVER_RANGE) near.push(t);
    }
    // Cap the count as well as the range: a queue in one lane could put
    // a dozen cars inside the radius at once. Stalest first -- V8's sort
    // is stable, so at six or fewer this degenerates to solving all of
    // them, every frame, in spawn order.
    near.sort((a, b) => b.rigDt - a.rigDt);
    for (let i = 0; i < near.length && i < TRAFFIC_DRIVERS_SOLVED; i++) {
      const t = near[i];
      const rig = t.mesh.userData.driver as DriverRig;
      // The sim time this solve answers for. Capped: a car that has
      // been out of range for a minute needs a snap, not a lurch.
      const dtSolve = Math.min(0.25, t.rigDt);
      t.rigDt = 0;
      // Traffic holds its lane, so there is no lane-change signal to
      // read — but a car following a curving road still holds lock, and
      // this road curves. Take the steer from the road itself: the
      // change in tangent heading over the next stretch.
      this.track.tangentAt(t.s, this.v3);
      this.track.tangentAt(this.track.wrap(t.s + 30), this.v4);
      let dHead = Math.atan2(this.v4.x, this.v4.z) - Math.atan2(this.v3.x, this.v3.z);
      while (dHead > Math.PI) dHead -= Math.PI * 2;
      while (dHead < -Math.PI) dHead += Math.PI * 2;
      const steerWant = THREE.MathUtils.clamp(dHead * 2.2, -1, 1);
      t.steerVis += (steerWant - t.steerVis) * Math.min(1, dtSolve * RIG.rival.steerRate);
      this.track.pose(
        t.s + RIG.driver.lookAheadM,
        t.lat * RIG.driver.lookLatK,
        this.v1,
        this.v2
      );
      this.v1.y += RIG.driver.lookHeight;
      // Traffic leans too. The g is the road's, not the driver's: a car
      // holding its lane through a bend is still pulling v-squared over
      // the radius, and dHead over 30 m IS that radius. Solved with a
      // zero brake and a steady throttle because that is what a cruising
      // car is doing — but a body that never answers the corner is the
      // difference between a person driving and a mannequin being
      // carried along, and traffic is what the player spends the night
      // threading between.
      const tLat = (dHead / 30) * t.speed * t.speed;
      // ...and they brake. The brake and the longitudinal g were both
      // hard-coded zero here, which meant a civilian standing on the
      // pedal behind a slower car sat perfectly upright with their foot
      // in the air — the same mannequin the comment above objects to,
      // on the axis it did not check. The pressure is smoothed for the
      // same reason the rival's is: traffic decides to lift on one
      // frame and the fold should not snap.
      const wantBrake =
        t.accel < RIG.rival.brakeAccel
          ? Math.min(1, -t.accel / RIG.rival.brakeScale)
          : 0;
      t.brakeVis += (wantBrake - t.brakeVis) * Math.min(1, dtSolve * RIG.rival.pedalRate);
      solveDriverRig(
        rig,
        t.steerVis,
        // Off the throttle while braking, as anyone is.
        RIG.rival.cruiseThrottle * (1 - t.brakeVis),
        t.brakeVis,
        this.v1,
        dtSolve,
        tLat,
        t.accel
      );
    }
  }

  private updateRival(dt: number): void {
    const r = this.rival;
    if (!r) return;

    // During the intro film the rival holds formation on the player's
    // flank — the two-shot needs both cars filling the frame, not the
    // rival cruising off on its own errand. AI resumes at the flag.
    if (this.cine && this.cine.r === r) {
      const p = this.player;
      r.speed = p.speed;
      // The film opens on the challenge, so it opens where a challenge
      // happens: the rival up the road IN YOUR LANE, with the gap the
      // beams have to cross. It then closes to half a car ahead and one
      // lane over for the two-shot — a dead-level two-shot is a flat one
      // — and lineUpAbreast levels the pair again at the flag.
      //
      // The gap closes on an ease rather than a cut, because the shot
      // change at CINE_FLASH_END is a CUT and a car that teleports
      // across it is the one thing a cut cannot hide.
      const ct = (performance.now() - this.cine.start) / 1000;
      // The gap holds through the CHALLENGE and the ANSWER — the answer
      // shot is the rival closing on you, so a gap already shut before
      // it starts has nothing to show — and shuts across the orbit,
      // where the camera is on the rival's bodywork and not on the road
      // between the cars. Both shot changes are cuts, and a car that
      // teleports across a cut is the one thing a cut cannot hide.
      const close = THREE.MathUtils.clamp(
        (ct - CINE_ANSWER_END) / (CINE_ORBIT_END - CINE_ANSWER_END),
        0,
        1
      );
      const eased = close * close * (3 - 2 * close);
      r.s = this.track.wrap(
        p.s + THREE.MathUtils.lerp(CINE_FLASH_GAP, 1.2, eased)
      );
      // Same lane while the beams are going in; the pair separates as
      // the rival drops back alongside.
      const lane = THREE.MathUtils.lerp(
        p.lat,
        this.abreastLane(r.s, p.lat),
        eased
      );
      r.lat += (lane - r.lat) * Math.min(1, dt * 6);
      r.targetLat = lane;
      this.track.pose(r.s, r.lat, this.v1, this.v2);
      this.track.tangentAt(r.s, this.v3);
      r.mesh.position.copy(this.v1);
      this.v4.copy(this.v1).add(this.v3);
      r.mesh.lookAt(this.v4);
      spinWheels(r.mesh, r.speed, dt);
      // Holding formation is still driving: hands on the wheel for the
      // two-shot, feet steady on a cruise throttle.
      this.animateRivalDriver(r, 0, dt);
      return;
    }

    const top = r.def.topSpeedKmh / KMH;
    let targetSpeed: number;

    if (r.state === "cruise") {
      // Hang around the player so the chase never gets dull.
      const gap = this.track.deltaAhead(this.player.s, r.s);
      targetSpeed = gap > 350 ? 18 : gap > 120 ? 26 : 33;
    } else if (r.state === "battle") {
      const gap = this.track.deltaAhead(this.player.s, r.s);
      if (gap > 0) {
        // Rival leads: let the player claw back unless they're slow.
        targetSpeed = top * (gap > 120 ? 0.86 : 0.97);
      } else {
        // Chasing — capped below the player's ~92 m/s ceiling so a clean
        // driver can hold a lead against every rival, boss included.
        //
        // ...and the rival gets the tow too, or the wake is a mechanic
        // only one car on the road is allowed to use. It sits in your
        // air and closes, which is what a driver would do and what makes
        // a lead something you have to defend rather than merely reach.
        //
        // Drag goes as v-squared, so a given power against a discounted
        // drag reaches roughly 1/sqrt of it — a full tow is worth about
        // 30%, and it goes to the slower cars, which is where it matters.
        // The 90 m/s ceiling is applied AFTER, deliberately: it is the
        // promise that a clean driver can hold a lead, and a wake is not
        // a reason to break it. A rival already fast enough to sit on
        // that cap gains nothing from the tow; one that is not can use
        // your air to get back on terms.
        const rTow = solveTow({
          gap: this.track.deltaAhead(r.s, this.player.s) - 4.5,
          lat: this.player.lat - r.lat,
          speed: r.speed,
        });
        targetSpeed = Math.min((top * 1.05) / Math.sqrt(rTow.drag), 90);
      }
    } else {
      targetSpeed = Math.max(0, r.speed - 8 * dt); // defeated: pull over
      r.targetLat = ROAD_HALF_WIDTH - 1.4;
    }

    const prevSpeed = r.speed;
    r.speed += THREE.MathUtils.clamp(targetSpeed - r.speed, -22 * dt, 13 * dt);

    // Lane choice: dodge traffic ahead.
    if (r.state !== "defeated") {
      let blocked = false;
      for (const t of this.traffic) {
        const ds = this.track.deltaAhead(r.s, t.s);
        if (ds > 0 && ds < 42 && Math.abs(t.lat - r.targetLat) < 2.4) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        let bestLane = r.targetLat;
        let bestClear = -1;
        for (const lane of LANES) {
          let clear = 200;
          for (const t of this.traffic) {
            const ds = this.track.deltaAhead(r.s, t.s);
            if (ds > -6 && Math.abs(t.lat - lane) < 2.4) clear = Math.min(clear, ds);
          }
          if (clear > bestClear) {
            bestClear = clear;
            bestLane = lane;
          }
        }
        r.targetLat = bestLane;
      }
    }
    r.lat += THREE.MathUtils.clamp(r.targetLat - r.lat, -6 * dt, 6 * dt);

    r.s = this.track.wrap(r.s + r.speed * dt);
    this.track.pose(r.s, r.lat, this.v1, this.v2);
    this.track.tangentAt(r.s, this.v3);
    r.mesh.position.copy(this.v1);
    this.v4.copy(this.v1).add(this.v3);
    r.mesh.lookAt(this.v4);
    spinWheels(r.mesh, r.speed, dt);
    this.animateRivalDriver(r, dt > 0 ? (r.speed - prevSpeed) / dt : 0, dt);
  }

  private updateRemotes(dt: number): void {
    if (this.remotes.size === 0) return;
    const now = performance.now();
    for (const r of this.remotes.values()) {
      if (!r.mesh.visible) continue;
      // Dead-reckon from the last snapshot, then ease the shown car onto it.
      const age = Math.min((now - r.snapAt) / 1000, 1.5);
      const predicted = this.track.wrap(r.snapS + r.snapSpeed * age);
      const blend = Math.min(1, dt * 8);
      r.s = this.track.wrap(r.s + this.track.deltaAhead(r.s, predicted) * blend);
      r.lat += (r.snapLat - r.lat) * blend;

      this.track.pose(r.s, r.lat, this.v1, this.v2);
      this.track.tangentAt(r.s, this.v3);
      r.mesh.position.copy(this.v1);
      this.v4.copy(this.v1).add(this.v3);
      r.mesh.lookAt(this.v4);
      spinWheels(r.mesh, r.snapSpeed, dt);

      // Remote cruisers carry drivers too: steer dead-reckoned from the
      // lane blend, a steady cruise throttle, eyes on the road ahead.
      const rig = r.mesh.userData.driver as DriverRig | undefined;
      if (rig) {
        const steerWant = THREE.MathUtils.clamp((r.snapLat - r.lat) * 0.6, -1, 1);
        r.steerVis += (steerWant - r.steerVis) * Math.min(1, dt * RIG.rival.steerRate);
        // The glance. The rival's driver turns to look at you when you
        // pull alongside, and remote drivers did not — a cruiser running
        // door-to-door with you, the exact situation the runs score as
        // "beside remote", stared dead ahead like the mannequin every
        // comment in this file objects to. Same constants as the
        // rival's glance, so the two kinds of company behave alike;
        // aimConstrained clamps the neck and eases at its own rate, so
        // the head cannot snap however abruptly the gap opens.
        const glanceGap = this.track.deltaAhead(r.s, this.player.s);
        if (
          Math.abs(glanceGap) < RIG.rival.glanceGapM &&
          Math.abs(this.player.lat - r.lat) > RIG.rival.glanceLatM
        ) {
          this.v1.copy(this.playerMesh.position);
          this.v1.y += 0.6;
        } else {
          this.track.pose(
            r.s + RIG.driver.lookAheadM,
            r.lat * RIG.driver.lookLatK,
            this.v1,
            this.v2
          );
          this.v1.y += RIG.driver.lookHeight;
        }
        // A remote player's driver gets the same treatment: their lane
        // blend is the only kinematics we have off the wire, so the lean
        // comes from how fast they are crossing it.
        const remLat = (r.snapLat - r.lat) * 0.6 * r.snapSpeed * 0.35;
        // ...and their braking, from the snapshot difference. Smoothed,
        // because snapshots arrive at the network's rate rather than the
        // frame's, and an unsmoothed brake would step once per packet.
        const wantBrake =
          r.accel < RIG.rival.brakeAccel
            ? Math.min(1, -r.accel / RIG.rival.brakeScale)
            : 0;
        r.brakeVis += (wantBrake - r.brakeVis) * Math.min(1, dt * RIG.rival.pedalRate);
        solveDriverRig(
          rig,
          r.steerVis,
          r.snapSpeed > 0.5
            ? RIG.rival.cruiseThrottle * 1.5 * (1 - r.brakeVis)
            : 0,
          r.brakeVis,
          this.v1,
          dt,
          remLat,
          r.accel
        );
      }
    }
  }

  /**
   * Count the night's runs.
   *
   * Everything here is measured off state the frame has already
   * computed — where the remote cars ended up, what wake the player is
   * in, how fast everyone is going — so this is arithmetic and a Set,
   * once a frame, and it costs nothing when nobody else is online.
   *
   * The one thing it does NOT do is decide what a run is worth or when
   * it is finished. That is quests.ts, so that the wording, the targets
   * and the payouts can all be read in one place and changed without
   * touching the engine.
   */
  private updateRuns(dt: number): void {
    this.besideRemote = false;
    if (this.remotes.size === 0) {
      // Still flush a pending save: a player who was online a moment ago
      // and is now alone has progress worth keeping.
      this.flushRuns();
      return;
    }

    const p = this.player;
    const kmh = p.speed * KMH;
    let nearest = Infinity;
    let matched = false;
    // The best wake a REMOTE PLAYER is giving us. `this.tow` is the one
    // the physics uses and it counts traffic and the rival too — a run
    // called "in their wake" that ticked up behind a lorry would be
    // measuring the wrong thing.
    let towOnline = 0;
    const half = (this.tune.lengthM || 4.5) / 2;
    const NOMINAL_HALF = 2.25;

    for (const [id, r] of this.remotes) {
      if (!r.mesh.visible) continue;
      const along = this.track.deltaAhead(p.s, r.s);
      const across = r.lat - p.lat;
      // Along the road and across it, not through the scenery: two cars
      // either side of a barrier on opposite carriageways are metres
      // apart in world space and are not driving together.
      const dist = Math.hypot(along, across);
      if (dist < nearest) nearest = dist;
      if (dist <= MET_M && !this.metThisSession.has(id)) {
        this.metThisSession.add(id);
        this.runs.metDrivers++;
        this.runsDirty = true;
      }
      if (dist <= TOGETHER_M) {
        this.besideRemote = true;
        if (
          kmh >= MATCHED_FLOOR_KMH &&
          r.snapSpeed * KMH >= MATCHED_FLOOR_KMH &&
          Math.abs(kmh - r.snapSpeed * KMH) <= MATCHED_KMH
        ) {
          matched = true;
        }
      }
      const gap = along - half - NOMINAL_HALF;
      if (gap > 0 && gap <= TOW_REACH) {
        towOnline = Math.max(
          towOnline,
          solveTow({ gap, lat: across, speed: p.speed }).strength
        );
      }
    }

    if (this.besideRemote) {
      this.runs.togetherM += p.speed * dt;
      this.runsDirty = true;
    }
    if (matched) {
      this.runs.matchedSeconds += dt;
      this.runsDirty = true;
    }
    // Half strength is "actually in it" rather than "clipping the edge
    // of it at forty metres" — the same threshold the HUD's tow bar
    // reads as a meaningful tow.
    if (towOnline > 0.5) {
      this.runs.towSeconds += dt;
      this.runsDirty = true;
    }

    this.settleRuns();
    this.flushRuns();
  }

  /** Announce and pay anything that just crossed its target. */
  private settleRuns(): void {
    const done = newlyDone(this.runsSeen, this.runs);
    if (done.length === 0) return;
    this.runsSeen = { ...this.runs };
    this.runsDirty = true;
    for (const q of done) this.events.onRunDone?.(q);
  }

  /** Write the totals out, at most every few seconds. */
  private flushRuns(): void {
    if (!this.runsDirty) return;
    const now = performance.now();
    if (now - this.runsSavedAt < 5000) return;
    this.runsSavedAt = now;
    this.runsDirty = false;
    saveProgress(this.runs);
  }

  /** A duel the referee says we won. Called from the hub client, because
   *  the referee lives on the server and the engine only mirrors it. */
  creditDuelWin(): void {
    this.runs.duelWins++;
    this.runsDirty = true;
    this.settleRuns();
  }

  /** The run the HUD should be showing: the first unfinished one, in the
   *  order quests.ts lists them, which is the order a night goes in. */
  private activeRun(): Quest | null {
    for (const q of QUESTS) {
      if ((this.runs[q.metric] ?? 0) < q.target) return q;
    }
    return null;
  }

  /** The totals, for the lobby's runs panel. A copy: nothing outside
   *  this class gets to write them. */
  getRuns(): QuestProgress {
    return { ...this.runs };
  }

  /**
   * The best wake the player is sitting in, this frame.
   *
   * Every car on the road is a candidate — traffic, the rival, other
   * people online — because the air does not know which of them you
   * happen to be racing. That is most of the point: a driver who is
   * losing ground on the straight can duck in behind a truck and come
   * back out on terms.
   *
   * Nose to tail, not centre to centre. A metre off the bumper of a
   * five-metre car and a metre off a four-metre one are the same
   * distance from the bodywork and a different `deltaAhead`, and the
   * wake starts at the bodywork.
   */
  private updateTow(): void {
    const p = this.player;
    const half = (this.tune.lengthM || 4.5) / 2;
    const cand: TowInput[] = [];
    // Traffic and remote cars carry no length of their own, so they get
    // the fleet's middle. Being half a metre out on where a wake starts
    // is well inside what the exponential does over that distance.
    const NOMINAL_HALF = 2.25;
    const add = (s: number, lat: number): void => {
      const gap = this.track.deltaAhead(p.s, s) - half - NOMINAL_HALF;
      if (gap > 0 && gap <= TOW_REACH) {
        cand.push({ gap, lat: lat - p.lat, speed: p.speed });
      }
    };
    for (const t of this.traffic) add(t.s, t.lat);
    if (this.rival) add(this.rival.s, this.rival.lat);
    for (const r of this.remotes.values()) add(r.s, r.lat);
    this.tow = bestTow(cand);
  }

  private updateBattle(dt: number): void {
    const r = this.rival!;
    const gap = this.track.deltaAhead(this.player.s, r.s); // >0 → rival ahead

    // Telemetry for the results card
    this.bstat.dist += this.player.speed * dt;
    this.bstat.topSpeed = Math.max(this.bstat.topSpeed, this.player.speed * KMH);
    this.bstat.maxLead = Math.max(this.bstat.maxLead, this.player.sp - r.sp);

    if (gap > 4) {
      let drain = 1.7 + Math.min(gap, 160) * 0.04;
      if (gap > 230) drain += 16;
      this.player.sp = Math.max(0, this.player.sp - drain * dt);
    } else if (gap < -4) {
      const lead = -gap;
      let drain = 1.7 + Math.min(lead, 160) * 0.04;
      if (lead > 230) drain += 16;
      r.sp = Math.max(0, r.sp - drain * dt);
    }

    // One radio warning when the fight turns critical — once per battle,
    // not every frame the bar is low.
    if (!this.spWarned && this.player.sp < 25 && this.player.sp > 0) {
      this.spWarned = true;
      this.voice.radioSpeak("انتبه! نقاطك تروح — قرّب عليه", { rate: 1.22 });
    }

    if (r.sp <= 0) this.winBattle();
    else if (this.player.sp <= 0) this.loseBattle();
    else if (this.bstat.dist >= this.raceDistanceM) {
      // The finish line.
      //
      // Two evenly matched cars drain each other at the same rate, so an
      // SP fight between equals has no end on its own — it runs until
      // somebody makes a mistake, which on a straight empty corniche can
      // be a very long time. The distance guarantees a result without
      // changing how the result is reached: whoever spent the night in
      // front has more SP left, and that is who takes it.
      //
      // Measured on the PLAYER's odometer, not on the rival's and not on
      // track position. Track position wraps every 8.5 km, so it cannot
      // express a twenty kilometre race at all; and using the rival's
      // distance would mean the loser decides when the race is over.
      //
      // A dead heat goes to the rival. Somebody has to hold the tie and
      // it should not be the person who came to take their money.
      if (this.player.sp > r.sp) this.winBattle();
      else this.loseBattle();
    }
  }

  /**
   * The vertical FOV to hand three.js for the window we actually have.
   *
   * The reasoning, the curve and the numbers are `aspect.ts` — it is
   * arithmetic with one degree of freedom and it belongs somewhere a
   * test can reach it without a WebGL context.
   */
  private aspectFov(vFovDeg: number): number {
    return verticalFov(vFovDeg, this.camera.aspect);
  }


  /**
   * A light shaft is air made visible, and air only shows when you look
   * ACROSS it. From the chase camera you look straight down the beams'
   * axis, where an additive cone accumulates its full depth into a disc
   * hanging over the road — no opacity is low enough to fix that, only
   * hiding it is. So the shafts fade out as the view aligns with them and
   * return in side and head-on views, where they read as real light.
   */
  private updateBeamVisibility(): void {
    if (!this.beamMat) return;
    this.camera.getWorldDirection(this.beamCamDir);
    this.playerMesh.getWorldDirection(this.beamCarDir);
    // +1 = looking the same way the car points (down the beams from
    // behind); 0 = across them; -1 = head-on into them, which should
    // stay bright because that is what oncoming headlights do.
    const align = this.beamCamDir.dot(this.beamCarDir);
    const behind = Math.max(0, align);
    const hide = behind * behind * (3 - 2 * behind); // smoothstep
    this.beamMat.opacity = this.beamBaseOpacity * (1 - hide);
  }

  /** Which shot is live. */
  get cameraView(): CameraView {
    return this.view;
  }

  /** Move to a named shot, or round the ring with no argument. */
  setView(v?: CameraView): CameraView {
    this.view = v ?? nextView(this.view);
    this.buildViewRig();
    // A car-mounted camera starts where it is bolted; a road-mounted one
    // should not lerp across the map from wherever the last shot ended.
    this.camInit = false;
    return this.view;
  }

  /**
   * Hang the in-car rig off the shell.
   *
   * Two empties parented to the BODY, not to the road node: the body is
   * what yaws past the direction of travel, dives under braking and
   * leans in a corner, and inheriting all three is the entire difference
   * between an in-car view and a chase camera moved forward.
   *
   * Rebuilt whenever the car is, because the old one went with it.
   */
  private buildViewRig(): void {
    const spec = viewSpec(this.view);
    if (this.camAnchor) this.camAnchor.parent?.remove(this.camAnchor);
    if (this.camTarget) this.camTarget.parent?.remove(this.camTarget);
    this.camAnchor = null;
    this.camTarget = null;
    // The driver's head is in front of the driver's eyes. Put it back
    // first, in case the last view was the cockpit.
    const rig = this.carBody?.userData.driver as DriverRig | undefined;
    if (rig?.head) rig.head.visible = true;
    if (!spec.mounted || !this.carBody) return;

    const d = this.carBody.userData.dims as
      | { nose: number; hoodY: number; dashY: number; wiperZ: number }
      | undefined;
    if (!d) return;
    const seat = (this.carBody.userData.driver as DriverRig | undefined)?.group.position;
    let pos: [number, number, number];
    if (this.view === "bumper") pos = [0, 0.44, d.nose - 0.08];
    else if (this.view === "bonnet") pos = [0, d.hoodY + 0.16, d.nose - 0.95];
    else {
      // Cockpit: measured off the STEERING WHEEL, not off the seat node.
      //
      // Hung off the seat it came out level with the top of the bonnet
      // and pointing over it — a roof cam, not a driver's eye line, and
      // with nothing of the car in frame to say otherwise. Every rig in
      // this game already holds a wheel at the height its hands are; the
      // eyes are a hand above it and a forearm behind it, and that is a
      // measurement rather than a guess.
      // Measured off the glasshouse the head is inside, not off the seat
      // node and not off the wheel. Hung off the seat it came out level
      // with the top of the bonnet and pointing over it — a roof cam;
      // hung off the wheel it came out lower still. A driver's eyes are
      // a head's height below the roof lining and just ahead of the
      // seat, and the canopy shell is the only thing on this car that
      // knows where the roof lining is.
      // Right behind the screen, a third of a metre over the bonnet line.
      //
      // Three placements were tried and looked at. Off the seat node it
      // came out level with the top of the bonnet and pointing over it —
      // a roof cam. Off the steering wheel it came out lower still. Off
      // the roof lining it was the right height and too far back, so the
      // whole bonnet and both mirrors filled the lower half of the frame
      // and the road was a strip above them.
      //
      // The honest constraint is that these shells have no interior to
      // speak of — a dash box, two seats and a wheel — so a view that
      // frames a cabin has nothing to frame. What reads is a dash cam:
      // eyes just behind the screen, a sliver of bonnet at the bottom,
      // the mirrors at the edges of vision where they actually are.
      let eyeY = d.hoodY + 0.35;
      let canopy: THREE.Mesh | null = null;
      this.carBody.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.userData.shell === "canopy") canopy = o as THREE.Mesh;
      });
      if (canopy) {
        const g = (canopy as THREE.Mesh).geometry;
        g.computeBoundingBox();
        // Never through the roof, whatever the bonnet line says.
        eyeY = Math.min(eyeY, g.boundingBox!.max.y - 0.24);
      }
      pos = [seat ? seat.x : 0.38, eyeY, d.wiperZ - 0.15];
      if (rig?.head) rig.head.visible = false;
    }
    const anchor = new THREE.Object3D();
    anchor.position.set(pos[0], pos[1], pos[2]);
    this.carBody.add(anchor);
    const target = new THREE.Object3D();
    target.position.set(pos[0], pos[1] - 0.05, pos[2] + spec.look);
    this.carBody.add(target);
    this.camAnchor = anchor;
    this.camTarget = target;
  }

  private updateCamera(dt: number): void {
    if (this.cine) {
      this.updateCineCamera();
      return;
    }
    const p = this.player;
    const spec = viewSpec(this.view);
    this.track.pose(p.s, p.lat, this.v1, this.v2);
    this.track.tangentAt(p.s, this.v3);

    if (spec.mounted && this.camAnchor && this.camTarget) {
      this.updateMountedCamera(dt, spec);
      return;
    }

    // Chase position pulls back and rises with speed. "Close" is the
    // same rig tucked in: same road frame, same behaviour through a
    // slide, a shorter arm.
    //
    // ...and on a window narrower than 16:9 it walks back further still.
    // A narrow screen loses horizontal field, and there are only two
    // ways to get world back into frame: a wider lens, or more distance.
    // The lens runs out first — holding a 16:9 horizontal field on a
    // portrait phone needs 133 degrees of vertical, which is a peephole,
    // not a camera — so aspect.ts gives back what it safely can and
    // hands the rest here. Only the road-mounted views can take it: a
    // bumper cam is bolted to the shell and has nowhere to go.
    const reach = this.view === "close" ? 0.62 : 1;
    // Tighter while a race is on, and only while a race is on. The
    // letterbox has already restored the reference framing by cutting
    // the picture to 16:9; this is the deliberate extra on top, so the
    // car reads bigger during a battle than it does cruising. Eased
    // rather than switched, or the shot would jump the moment a rival
    // agreed to race.
    const wantRace = this.inBattle ? 1 : 0;
    this.raceFrame += (wantRace - this.raceFrame) * Math.min(1, dt * 2.5);
    const raceTight = 1 + (RACE_DOLLY - 1) * this.raceFrame;
    const dist =
      (9.5 + p.speed * 0.02) * reach * chaseDolly(spec.fov, this.camera.aspect) * raceTight;
    this.v4
      .copy(this.v1)
      .addScaledVector(this.v3, -dist)
      .add(this.v2.set(0, (3.4 + p.speed * 0.007) * (this.view === "close" ? 0.66 : 1), 0));
    if (!this.camInit) {
      this.camInit = true;
      this.camBase.copy(this.v4);
    } else {
      this.camBase.lerp(this.v4, Math.min(1, dt * 5.5));
    }

    // Impact jolt + speed rumble as smooth pseudo-noise, applied on top of
    // the lerped base — never fed back into it, or it compounds
    this.shake = Math.max(0, this.shake - this.shake * 3.5 * dt);
    const t = performance.now() / 1000;
    const amp = Math.pow(p.speed / this.topSpeedRef, 3) * 0.055 + this.shake * 0.32;
    this.camera.position.copy(this.camBase);
    this.camera.position.x += (Math.sin(t * 31.7) + Math.sin(t * 17.3)) * 0.5 * amp;
    this.camera.position.y += (Math.sin(t * 27.1) + Math.sin(t * 13.9)) * 0.5 * amp;

    // Look ahead into the curve so sweepers read like sweepers
    const lookAside = THREE.MathUtils.clamp(this.curvature * p.speed * p.speed * 0.045, -4, 4);
    this.track.sideAt(p.s, this.v2);
    this.v4.copy(this.v1).addScaledVector(this.v3, spec.look).addScaledVector(this.v2, lookAside);
    this.v4.y += 1.4;
    this.camera.lookAt(this.v4);

    // Lateral-G camera roll.
    //
    // The drift term is clamped like the other two, and it has to be:
    // it was written when the body angle could not exceed about 1.3 rad,
    // which made its most extreme contribution seven degrees of horizon.
    // A spin that goes round now reaches eight or nine radians, and the
    // same line was quietly rolling the camera fifty degrees over —
    // which looked, in the screenshots, like the car had left the road
    // and gone over a bank. A slide leans the shot. A spin should not
    // put the horizon on its ear.
    const rollTarget =
      THREE.MathUtils.clamp(this.heading * (p.speed / this.topSpeedRef), -0.5, 0.5) * 0.14 +
      THREE.MathUtils.clamp(this.slipVel * 0.012, -0.03, 0.03) +
      THREE.MathUtils.clamp(this.driftYaw * 0.1, -0.13, 0.13);
    this.camRoll += (rollTarget - this.camRoll) * Math.min(1, dt * 4);
    this.camera.rotateZ(this.camRoll + Math.sin(t * 23.7) * this.shake * 0.02);

    // FOV: speed stretch + a launch kick under throttle from low speed
    this.applyFov(dt, spec.fov);
  }

  private applyFov(dt: number, base: number): void {
    const p = this.player;
    const launchKick = this.throttle * THREE.MathUtils.clamp(1 - p.speed / 40, 0, 1) * 5;
    const targetFov = base + (p.speed / this.topSpeedRef) * 18 + launchKick;
    this.fovCurrent += (targetFov - this.fovCurrent) * Math.min(1, dt * 3);
    this.camera.fov = this.aspectFov(this.fovCurrent);
    this.camera.updateProjectionMatrix();
  }

  /**
   * A camera bolted to the car.
   *
   * No lerp on the position: a rigid mount is rigid, and easing it turns
   * a bonnet cam into a chase cam on a short arm. What IS smoothed is
   * nothing at all — the shell already moves on its springs, and that
   * motion is the shot.
   *
   * The lateral-G roll the chase camera applies is deliberately absent:
   * the body is already leaning, the camera is on the body, and adding
   * the roll again would lean the horizon twice.
   */
  private updateMountedCamera(dt: number, spec: ReturnType<typeof viewSpec>): void {
    const p = this.player;
    this.carBody.updateMatrixWorld(true);
    this.camAnchor!.getWorldPosition(this.camBase);
    this.camInit = true;
    this.shake = Math.max(0, this.shake - this.shake * 3.5 * dt);
    const t = performance.now() / 1000;
    // Half the chase camera's rumble. Mounted on the shell, every bump
    // is already coming through the springs; doubling it is a headache
    // rather than a sensation.
    const amp = (Math.pow(p.speed / this.topSpeedRef, 3) * 0.055 + this.shake * 0.32) * 0.5;
    this.camera.position.copy(this.camBase);
    this.camera.position.x += (Math.sin(t * 31.7) + Math.sin(t * 17.3)) * 0.5 * amp;
    this.camera.position.y += (Math.sin(t * 27.1) + Math.sin(t * 13.9)) * 0.5 * amp;
    this.camTarget!.getWorldPosition(this.v4);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.v4);
    // Roll comes from the shell: read the body's own lean off its world
    // matrix rather than recomputing it, so the two can never disagree.
    this.carBody.getWorldQuaternion(this.q1);
    this.v2.set(1, 0, 0).applyQuaternion(this.q1);
    const roll = Math.asin(THREE.MathUtils.clamp(this.v2.y, -1, 1));
    this.camera.rotateZ(-roll + Math.sin(t * 23.7) * this.shake * 0.02);
    this.applyFov(dt, spec.fov);
  }

  /**
   * Three shots on the real-time clock:
   *   A 0.0–1.8s  orbit of the rival, rear quarter sweeping to the nose
   *   B 1.8–3.1s  low side pass of the player's own machine
   *   C 3.1–4.2s  pull back and settle into the chase camera
   */
  private updateCineCamera(): void {
    const c = this.cine!;
    const t = (performance.now() - c.start) / 1000;
    const p = this.player;

    const ease = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 2);

    if (t < CINE_FLASH_END) {
      // THE CHALLENGE. Low and just off the player's quarter, looking up
      // its own beams at the rival ahead — the shot has to hold three
      // things at once for the flashes to mean anything: the lamps that
      // are firing, the road they are firing down, and the car at the
      // end of it lighting up. So the camera sits BEHIND the player and
      // slightly outboard, at bumper height, and drifts inboard as it
      // creeps forward, which brings the rival off the player's shoulder
      // and into clear air by the time the third hit lands.
      const k = ease(t / CINE_FLASH_END);
      this.track.pose(p.s, p.lat, this.v1, this.v2); // v1 = player
      this.track.tangentAt(p.s, this.v3);
      const sx = -this.v3.z;
      const sz = this.v3.x;
      // Which side to hang on: the open one, so the shot never has the
      // barrier between the lens and the car.
      const side = p.lat > 0 ? -1 : 1;
      const out = THREE.MathUtils.lerp(2.9, 1.5, k);
      const back = THREE.MathUtils.lerp(7.4, 5.2, k);
      this.camera.position.set(
        this.v1.x - this.v3.x * back + sx * out * side,
        this.v1.y + THREE.MathUtils.lerp(0.82, 1.05, k),
        this.v1.z - this.v3.z * back + sz * out * side
      );
      // Aimed up the road past the car, not at it: the subject of this
      // shot is the gap between the two machines.
      this.v4.set(
        this.v1.x + this.v3.x * 13,
        this.v1.y + 1.0,
        this.v1.z + this.v3.z * 13
      );
      this.camera.lookAt(this.v4);
    } else if (t < CINE_ANSWER_END) {
      // THE ANSWER. Reverse angle: the lens is up the road IN FRONT of
      // the rival, looking back down at both cars, so the beams that
      // were leaving the frame in the last shot are now coming at you.
      // The reply is the rival's own machine closing on yours — which is
      // a thing you can watch happen, rather than a caption telling you
      // the challenge was accepted.
      const k = ease((t - CINE_CHALLENGE_END) / (CINE_ANSWER_END - CINE_CHALLENGE_END));
      this.track.pose(c.r.s, c.r.lat, this.v1, this.v2); // v1 = rival
      this.track.tangentAt(c.r.s, this.v3);
      // Ahead of the rival and falling back toward it: the gap shrinking
      // in frame is the gap shrinking on the road.
      const lead = THREE.MathUtils.lerp(11.5, 6.0, k);
      this.camera.position.set(
        this.v1.x + this.v3.x * lead,
        this.v1.y + THREE.MathUtils.lerp(1.35, 1.05, k),
        this.v1.z + this.v3.z * lead
      );
      // Aimed past the rival at the player behind it, so both cars and
      // the beam between them are in the shot.
      this.track.pose(p.s, p.lat, this.v4, this.v2);
      this.v4.set(
        (this.v1.x + this.v4.x) / 2,
        this.v1.y + 0.85,
        (this.v1.z + this.v4.z) / 2
      );
      this.camera.lookAt(this.v4);
    } else if (t < CINE_ORBIT_END) {
      const k = ease((t - CINE_ANSWER_END) / (CINE_ORBIT_END - CINE_ANSWER_END));
      this.track.pose(c.r.s, c.r.lat, this.v1, this.v2); // v1 = rival
      this.track.tangentAt(c.r.s, this.v3);
      const a = 2.55 - 1.35 * k; // rear-quarter → front-side sweep
      const radius = 6.2 - 1.2 * k;
      const sx = -this.v3.z;
      const sz = this.v3.x;
      this.camera.position.set(
        this.v1.x + (this.v3.x * Math.cos(a) + sx * Math.sin(a)) * radius,
        this.v1.y + 1.5 - 0.7 * k,
        this.v1.z + (this.v3.z * Math.cos(a) + sz * Math.sin(a)) * radius
      );
      this.v4.set(this.v1.x, this.v1.y + 0.6, this.v1.z);
      this.camera.lookAt(this.v4);
    } else if (t < CINE_FLANK_END) {
      // YOUR CAR. The reverse of the orbit, and the angle this film
      // never had: it showed the rival twice — round it, then at it —
      // and your own machine only as half of a wide two-shot. A low
      // tracking pass down the flank, from the tail to the nose, close
      // enough that the car fills the frame and the paint carries the
      // lamps along it.
      const k = ease((t - CINE_ORBIT_END) / (CINE_FLANK_END - CINE_ORBIT_END));
      this.track.pose(p.s, p.lat, this.v1, this.v2); // v1 = player
      this.track.tangentAt(p.s, this.v3);
      const sx = -this.v3.z;
      const sz = this.v3.x;
      // Open side again, so the barrier is never between lens and car.
      const side = p.lat > 0 ? -1 : 1;
      // Slides from behind the rear wheel to ahead of the nose.
      const along = THREE.MathUtils.lerp(-3.4, 4.2, k);
      this.camera.position.set(
        this.v1.x + this.v3.x * along + sx * 3.5 * side,
        this.v1.y + 0.72,
        this.v1.z + this.v3.z * along + sz * 3.5 * side
      );
      this.v4.set(this.v1.x, this.v1.y + 0.62, this.v1.z);
      this.camera.lookAt(this.v4);
    } else if (t < CINE_TWOSHOT_END) {
      // The two-shot: both machines side by side at speed. The camera
      // hangs ahead of the pair, low over the asphalt, dollying slowly
      // back toward them and aimed at the midpoint so player and rival
      // share the frame with their names on the bars below.
      const k = ease((t - CINE_FLANK_END) / (CINE_TWOSHOT_END - CINE_FLANK_END));
      this.track.pose(p.s, p.lat, this.v1, this.v2); // v1 = player
      this.track.pose(c.r.s, c.r.lat, this.v4, this.v2); // v4 = rival
      const midX = (this.v1.x + this.v4.x) / 2;
      const midZ = (this.v1.z + this.v4.z) / 2;
      const midY = (this.v1.y + this.v4.y) / 2;
      this.track.tangentAt(p.s, this.v3);
      const ahead = 9.5 - 1.6 * k; // dolly drifts back toward the cars
      this.camera.position.set(
        midX + this.v3.x * ahead,
        midY + 0.95,
        midZ + this.v3.z * ahead
      );
      this.v4.set(midX, midY + 0.7, midZ);
      this.camera.lookAt(this.v4);
    } else {
      const k = ease((t - CINE_TWOSHOT_END) / (CINE_LEN - CINE_TWOSHOT_END));
      this.track.pose(p.s, p.lat, this.v1, this.v2);
      this.track.tangentAt(p.s, this.v3);
      const sx = -this.v3.z;
      const sz = this.v3.x;
      // From the side-rear up into the standard chase position
      const dist = 9.5 + p.speed * 0.02;
      const chaseY = this.v1.y + 3.4 + p.speed * 0.007;
      this.camera.position.set(
        this.v1.x + THREE.MathUtils.lerp(sx * 4.2 - this.v3.x * 2.5, -this.v3.x * dist, k),
        THREE.MathUtils.lerp(this.v1.y + 1.1, chaseY, k),
        this.v1.z + THREE.MathUtils.lerp(sz * 4.2 - this.v3.z * 2.5, -this.v3.z * dist, k)
      );
      this.v4.set(
        this.v1.x + this.v3.x * (k * 14),
        this.v1.y + THREE.MathUtils.lerp(0.55, 1.4, k),
        this.v1.z + this.v3.z * (k * 14)
      );
      this.camera.lookAt(this.v4);
    }
    // The film is framed at the lens's resting focal length
    if (this.fovCurrent !== 58) {
      this.fovCurrent += (58 - this.fovCurrent) * 0.1;
      this.camera.fov = this.aspectFov(this.fovCurrent);
      this.camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------ streaks

  private newStreak(baseS: number): { s: number; lat: number; y: number; len: number } {
    const side = Math.random() < 0.5 ? -1 : 1;
    return {
      s: this.track.wrap(baseS + 25 + Math.random() * 75),
      lat: side * (2.5 + Math.random() * 13),
      y: 1 + Math.random() * 5.5,
      len: 2.5 + Math.random() * 2,
    };
  }

  private updateStreaks(): void {
    const speedKmh = this.player.speed * 3.6;
    const mat = this.streaks.material as THREE.LineBasicMaterial;
    mat.opacity = THREE.MathUtils.clamp((speedKmh - 190) / 110, 0, 1) * 0.4;
    // Skip the draw call entirely below the fade-in speed
    this.streaks.visible = mat.opacity > 0;
    if (!this.streaks.visible) return;

    const pos = this.streaks.geometry.getAttribute("position") as THREE.BufferAttribute;
    const len = 2 + this.player.speed * 0.06;
    for (let i = 0; i < this.streakData.length; i++) {
      let st = this.streakData[i];
      if (this.track.deltaAhead(this.player.s, st.s) < -15) {
        st = this.streakData[i] = this.newStreak(this.player.s);
      }
      // One point + one tangent eval per streak; right vector = (-Tz, 0, Tx)
      this.track.pointAt(st.s, this.v1);
      this.track.tangentAt(st.s, this.v3);
      const px = this.v1.x - this.v3.z * st.lat;
      const pz = this.v1.z + this.v3.x * st.lat;
      pos.setXYZ(i * 2, px, st.y, pz);
      pos.setXYZ(i * 2 + 1, px + this.v3.x * len, st.y, pz + this.v3.z * len);
    }
    pos.needsUpdate = true;
  }

  private updateEffects(dt: number): void {
    // Keep the moon's shadow frustum centred on the player, snapped to
    // shadow-map texels — a continuously sliding ortho frustum makes
    // every shadow edge crawl and flicker at speed
    const moon = this.world.moonLight;
    const texel = 180 / moon.shadow.mapSize.x; // ortho width / map size
    const p = this.playerMesh.position;
    const u = p.dot(this.lightRight);
    const v = p.dot(this.lightUp);
    this.v1
      .copy(p)
      .addScaledVector(this.lightRight, Math.round(u / texel) * texel - u)
      .addScaledVector(this.lightUp, Math.round(v / texel) * texel - v);
    moon.position.copy(this.v1).addScaledVector(this.moonDir, GameEngine.MOON_DIST);
    moon.target.position.copy(this.v1);

    this.grainPass.uniforms.uTime.value = (performance.now() / 1000) % 100;

    // Sky dome, stars and moon ride with the camera — they are backdrop,
    // not geometry, so they must never fall outside the far plane. Each
    // keeps the offset it was authored with, so the moon stays off to one
    // side instead of being dragged overhead.
    for (const o of this.world.skyFollowers) {
      const off = o.userData.skyOffset as THREE.Vector3;
      o.position.x = this.camera.position.x + off.x;
      o.position.z = this.camera.position.z + off.z;
    }

    // --- Sparks: they cool, fall, and skitter along the asphalt
    this.sparkFx.update(dt, { gravity: 17, drag: 0.7, bounce: 0.42, groundY: 0.03 });

    // --- Tire smoke while drifting: pour from both rear arches, rise,
    // spread downwind of the slide, die in about a second. A launch with
    // the rears lit up smokes the same arches before the car is moving
    // fast enough to drift.
    const burnout = this.wheelspin > 3 && this.player.speed < 22;
    // Locked wheels smoke as surely as spinning ones: same rubber, same
    // road, and the only difference is which way the mismatch runs.
    const locked = (this.brakeOut?.lock ?? 0) > 0.4 && this.player.speed > 14;
    const drifting =
      ((Math.abs(this.driftYaw) > 0.14 && this.player.speed > 12) ||
        burnout ||
        locked) &&
      !this.cine;
    if (drifting) {
      this.track.tangentAt(this.player.s, this.v3);
      const px = this.playerMesh.position.x;
      const pz = this.playerMesh.position.z;
      // Rear axle sits behind the car centre; ± the side vector per wheel
      const bx = px - this.v3.x * 1.6;
      const bz = pz - this.v3.z * 1.6;
      const sx = -this.v3.z;
      const sz = this.v3.x;
      // Time-budgeted so density is refresh-rate independent. A spin is
      // four tyres sliding rather than two, so it pours accordingly —
      // this is the difference between a slide and having lost it, and
      // it should be visible from the first frame.
      const spinning = this.ds.spinT > 0;
      // 120 rather than more: past about that the plume closes over the
      // car, and the one thing a player needs during a spin is to see
      // which way they are pointing so they can catch the exit.
      this.smokeAcc += (spinning ? 120 : Math.abs(this.driftYaw) > 0.4 ? 85 : 55) * dt;
      const spawn = Math.floor(this.smokeAcc);
      this.smokeAcc -= spawn;
      const out = Math.sign(this.driftYaw) || 1;
      // A slide throws its smoke sideways because the tyre is travelling
      // across itself. A locked wheel is travelling straight down the
      // road, so its smoke just boils up off the patch and gets left
      // behind — the same particles, thrown a different way.
      const sideways = Math.min(1, Math.abs(this.driftYaw) / 0.25);
      const lockOnly = 1 - sideways;
      // Locked fronts smoke at the front axle, not behind the rears.
      const ax = bx + this.v3.x * 3.2 * lockOnly;
      const az = bz + this.v3.z * 3.2 * lockOnly;
      for (let n = 0; n < spawn; n++) {
        const side = (n % 2 === 0 ? 0.85 : -0.85) + (Math.random() - 0.5) * 0.5;
        // In a spin every corner is sliding, so half of it comes off the
        // front axle. Alternating rather than random: two arches and two
        // arches, which is what four wheels look like.
        const axle = spinning && n % 4 >= 2 ? 3.2 : 0;
        this.smokeFx.spawn(
          ax + this.v3.x * axle + sx * side + (Math.random() - 0.5) * 0.55,
          0.24 + Math.random() * 0.22,
          az + this.v3.z * axle + sz * side + (Math.random() - 0.5) * 0.55,
          (sx * out * (1.2 + Math.random()) + (Math.random() - 0.5)) * sideways -
            this.v3.x * 2.2 * lockOnly,
          1.3 + Math.random() * 1.5,
          (sz * out * (1.2 + Math.random()) + (Math.random() - 0.5)) * sideways -
            this.v3.z * 2.2 * lockOnly,
          0.95 + Math.random() * 0.55,
          1.9 + Math.random() * 0.9
        );
      }
    }
    // Billowing smoke sheds its outward speed as it expands
    this.smokeFx.update(dt, { drag: 1.6, gravity: -0.35 });

    // --- Exhaust. A backfire is unburnt fuel lighting in the pipe on a
    // hard lift, so it fires on the throttle's falling edge at revs; the
    // nitrous flame burns continuously while the bottle is open.
    if (!this.cine && this.carBody.userData.exhaustTips) {
      const tips = this.carBody.userData.exhaustTips as THREE.Vector3[];
      const pop = this.tune.exhaust.pop;
      // A hard lift at revs always pops — the randomness belongs in how
      // big the flame is, not in whether the car has an exhaust. The
      // rate is measured once per step at the top of update(); the
      // lockout is what makes one lift one bang.
      const backfire =
        this.liftRate > BACKFIRE_LIFT_RATE &&
        this.backfireLockout <= 0 &&
        this.player.speed > 14;
      if (backfire) this.backfireLockout = BACKFIRE_LOCKOUT;
      const nos = this.nosActive;
      if (backfire && this.sound) this.sound.backfire(pop);
      if (backfire || nos) {
        // A straight pipe throws a bigger flame than a cat-back, and both
        // throw more than the factory system.
        const n = nos
          ? 2
          : Math.round((3 + Math.random() * 4) * (0.6 + pop * 0.45));
        for (const tip of tips) {
          // The anchor is car-local; carBody carries the presence scale
          // and the drift yaw, so ask it for the world position.
          this.carBody.localToWorld(this.v4.copy(tip));
          for (let k = 0; k < n; k++) {
            const back = -(2 + Math.random() * 5);
            this.track.tangentAt(this.player.s, this.v3);
            this.flameFx.spawn(
              this.v4.x + (Math.random() - 0.5) * 0.12,
              this.v4.y + (Math.random() - 0.5) * 0.08,
              this.v4.z + (Math.random() - 0.5) * 0.12,
              this.v3.x * back + (Math.random() - 0.5) * 1.2,
              0.4 + Math.random() * 0.8,
              this.v3.z * back + (Math.random() - 0.5) * 1.2,
              nos
                ? 0.14 + Math.random() * 0.08
                : (0.16 + Math.random() * 0.12) * (0.8 + pop * 0.22),
              nos ? 0.22 : 0.3
            );
          }
        }
      }
    }

    this.flameFx.update(dt, { drag: 3.2, gravity: -1.2 });

    // --- Brake rotors glow with the heat they are actually absorbing.
    // Energy in scales with pedal pressure and road speed; it radiates
    // away on its own clock, so the discs stay orange down the straight
    // after a hard stop and cool through the corner.
    {
      const heatIn = this.brake * Math.min(1, this.player.speed / 28);
      this.rotorHeat = THREE.MathUtils.clamp(
        this.rotorHeat + (heatIn * 1.35 - this.rotorHeat * 0.55) * dt,
        0,
        1
      );
      const wheels = this.carBody.userData.wheels as THREE.Group[] | undefined;
      if (wheels) {
        for (const w of wheels) {
          const m = w.userData.rotorMat as THREE.MeshStandardMaterial | undefined;
          // Front discs do most of the work, so they run hotter
          if (m) m.emissiveIntensity = this.rotorHeat * this.rotorHeat * 2.6;
        }
      }
    }
  }


  /**
   * The player's driver, solved from the real inputs. The head looks
   * where the car is going, not where it is pointing.
   */
  private updateDriver(dt: number): void {
    const rig = this.carBody.userData.driver as DriverRig | undefined;
    if (!rig) return;
    this.track.pose(
      this.player.s + RIG.driver.lookAheadM,
      this.player.lat * RIG.driver.lookLatK,
      this.v1,
      this.v2
    );
    this.v1.y += RIG.driver.lookHeight;
    solveDriverRig(
      rig,
      this.steerSmooth,
      this.throttle,
      this.brake,
      this.v1,
      dt,
      this.latAccel,
      this.longAccel,
      // The hand on the lever is the tell that a slide is a decision
      // rather than a mistake. Read through the same debounced getter
      // the physics uses, so the hand and the rear axle answer the same
      // press — a driver whose hand is on the wheel while the tail is
      // out is a car sliding with nobody making it.
      this.handbrake ? 1 : 0
    );
  }

  /**
   * The rival's driver, driven off the rival's own kinematics: steer
   * follows the lane change, the feet follow the speed change, and
   * within a couple of car lengths the helmet turns to size you up —
   * the look-over before the headlight flash is half the ritual.
   */
  private animateRivalDriver(r: Rival, accel: number, dt: number): void {
    const rig = r.mesh.userData.driver as DriverRig | undefined;
    if (!rig) return;
    const R = RIG.rival;
    const steerWant = THREE.MathUtils.clamp((r.targetLat - r.lat) * R.steerPerLat, -1, 1);
    r.steerVis += (steerWant - r.steerVis) * Math.min(1, dt * R.steerRate);
    const wantThrottle =
      accel > R.throttleAccel
        ? Math.min(1, accel / R.throttleScale)
        : r.speed > 1
          ? R.cruiseThrottle
          : 0;
    const wantBrake = accel < R.brakeAccel ? Math.min(1, -accel / R.brakeScale) : 0;
    r.throttleVis += (wantThrottle - r.throttleVis) * Math.min(1, dt * R.pedalRate);
    r.brakeVis += (wantBrake - r.brakeVis) * Math.min(1, dt * R.pedalRate);

    const gap = this.track.deltaAhead(r.s, this.player.s);
    if (Math.abs(gap) < R.glanceGapM && Math.abs(this.player.lat - r.lat) > R.glanceLatM) {
      this.v1.copy(this.playerMesh.position);
      this.v1.y += 0.6;
    } else {
      this.track.pose(
        r.s + RIG.driver.lookAheadM,
        r.lat * RIG.driver.lookLatK,
        this.v1,
        this.v2
      );
      this.v1.y += RIG.driver.lookHeight;
    }
    // The rival's g comes from their own kinematics: how fast they are
    // crossing the lane, and the acceleration the caller measured.
    const rivalLat = ((r.targetLat - r.lat) * R.steerPerLat) * r.speed * 0.35;
    solveDriverRig(
      rig,
      r.steerVis,
      r.throttleVis,
      r.brakeVis,
      this.v1,
      dt,
      rivalLat,
      accel
    );
  }

  /**
   * Burst of sparks at the car. `side` is which flank made contact
   * (-1 left, +1 right, 0 centre/rear) so the shower comes off the
   * panel that actually hit something instead of the car's middle.
   */
  private spawnSparks(side = 0, intensity = 1): void {
    const p = this.playerMesh.position;
    this.track.tangentAt(this.player.s, this.v3);
    const sx = -this.v3.z;
    const sz = this.v3.x;
    const n = Math.round(26 + 34 * intensity);
    for (let i = 0; i < n; i++) {
      const along = -0.6 + Math.random() * 1.2;
      const lat = side * (0.95 + Math.random() * 0.15);
      const back = -(5 + Math.random() * 12) * (0.6 + intensity * 0.6);
      this.sparkFx.spawn(
        p.x + sx * lat + this.v3.x * along,
        0.22 + Math.random() * 0.3,
        p.z + sz * lat + this.v3.z * along,
        this.v3.x * back + sx * side * (1 + Math.random() * 4) + (Math.random() - 0.5) * 3,
        // Upward throw. This was 1.5-6.5 m/s, which against the 17 m/s^2
        // the spark system pulls puts the apex 1.2 m ABOVE the sill it
        // came off: measured, sparks reached 1.48 m and a tenth of them
        // spent their life above a metre — arcing over the roof of the
        // car that made them. Grinding steel on a barrier throws sparks
        // out and back along the panel, not into the air. 0.5-3.5 m/s
        // tops out around 0.36 m of climb, so they skip along the flank
        // and die on the asphalt where they belong.
        0.5 + Math.random() * 3,
        this.v3.z * back + sz * side * (1 + Math.random() * 4) + (Math.random() - 0.5) * 3,
        0.35 + Math.random() * 0.5,
        0.09 + Math.random() * 0.07
      );
    }
  }

  private updateAudio(): void {
    if (!this.sound) return;
    const speedKmh = this.player.speed * 3.6;
    const gear = this.gearHeld;
    // The same needle the torque curve read this frame, clutch and all —
    // so flooring it from rest sounds like a car being launched rather
    // than one idling away from a light.
    const rpmFrac = this.revFrac;
    // Tires complain when the heading fights the lane at speed — and a
    // locked wheel is the loudest complaint of all, because it is one
    // patch of rubber being erased at road speed instead of rolling.
    const skid = Math.max(
      0,
      Math.abs(this.heading) * (speedKmh / 140) +
        Math.abs(this.slipVel) * 0.12 +
        Math.abs(this.driftYaw) * (speedKmh / 95) +
        (this.brakeOut?.lock ?? 0) * Math.min(1, speedKmh / 60) * 0.85 -
        0.22
    );
    // Against the governor: within a hair of the car's limit on full
    // throttle is the car fighting its own ECU.
    const limitMs = this.tune.topSpeedKmh / KMH;
    const governed =
      this.throttle > 0.6 && this.player.speed > limitMs - 0.4 ? 1 : 0;
    // ...and against the REV limiter, which is the same ECU doing the
    // same thing at the top of every gear rather than only the last one.
    // Read from the physics step rather than solved again here: the cut
    // the car feels and the stutter it makes have to be the same event.
    const limited = Math.max(governed, this.revLimited);

    // Running wide onto the shoulder — the kerb buzz through the floor
    const edge = this.track.halfWidthAt(this.player.s) - 1.35;
    const rumble = THREE.MathUtils.clamp(
      (Math.abs(this.player.lat) - edge) / 0.8,
      0,
      1
    );

    // The ears ride the camera, not the car
    this.camera.getWorldDirection(this.v3);
    const cam = this.camera.position;

    // How coastal the road is here, and where the water lies. The sea is
    // on the left of the coastal leg, which is the Gulf Road's whole
    // character — it should be audible, not just visible.
    const u = this.track.wrap(this.player.s) / this.track.length;
    const coastal =
      u >= COAST_U.from && u <= COAST_U.to
        ? 1
        : Math.max(0, 1 - Math.min(Math.abs(u - COAST_U.to), Math.abs(u - COAST_U.from)) * 12);
    this.track.pose(this.player.s, -55, this.v1, this.v2); // 55 m to seaward

    const r = this.rival;
    // Everyone else within earshot, nearest first.
    //
    // Forty-six cars on this road and only the rival ever made a sound.
    // Taken by distance from the LISTENER rather than from the car,
    // because the ears ride the camera — in a chase cam the nearest car
    // to the camera is not always the nearest to the bumper, and it is
    // the camera that decides what you can hear.
    //
    // Cut at the panner's own maxDistance: past that it contributes
    // silence, and sorting a car nobody can hear is work done for the
    // benefit of nothing.
    const heard: Array<{ x: number; y: number; z: number; speedKmh: number; d: number }> = [];
    for (const car of this.traffic) {
      const p = car.mesh.position;
      const dx = p.x - cam.x;
      const dz = p.z - cam.z;
      const d = dx * dx + dz * dz;
      if (d > 160000) continue; // 400 m, the panner's maxDistance
      heard.push({ x: p.x, y: p.y + 0.5, z: p.z, speedKmh: car.speed * KMH, d });
    }
    for (const rp of this.remotes.values()) {
      if (!rp.mesh.visible) continue;
      const p = rp.mesh.position;
      const dx = p.x - cam.x;
      const dz = p.z - cam.z;
      const d = dx * dx + dz * dz;
      if (d > 160000) continue;
      // The wire's own last reported speed — a remote car has no
      // local speed of its own, only the snapshots it arrives in.
      heard.push({ x: p.x, y: p.y + 0.5, z: p.z, speedKmh: rp.snapSpeed * KMH, d });
    }
    heard.sort((a, b) => a.d - b.d);
    this.sound.update({
      speedKmh,
      throttle: this.throttle,
      rpmFrac,
      gear: speedKmh < 2 ? 0 : gear + 1,
      skid,
      boost: this.boost,
      nosActive: this.nosActive,
      brake: this.brake,
      driftYaw: this.driftYaw,
      limited,
      rumble,
      liftRate: this.liftRate,
      listener: {
        x: cam.x, y: cam.y, z: cam.z,
        fx: this.v3.x, fy: this.v3.y, fz: this.v3.z,
        ux: 0, uy: 1, uz: 0,
      },
      rival: r
        ? {
            x: r.mesh.position.x,
            y: r.mesh.position.y + 0.5,
            z: r.mesh.position.z,
            speedKmh: r.speed * KMH,
            throttle: r.state === "battle" ? 1 : 0.55,
          }
        : null,
      others: heard.slice(0, 4),
      coast: coastal,
      seaX: this.v1.x,
      seaZ: this.v1.z,
    });
  }

  // ---------------------------------------------------------------- hud

  /**
   * The map of the whole road, built once and shared.
   *
   * Everything that shows a position — the corner minimap, the
   * full-screen map, the dots on both — goes through this one
   * projection, because two maps of the same road that disagree about
   * where a thing is are worse than one map.
   */
  getRoadMap(): RoadMap {
    this.roadMap ??= buildRoadMap(this.track);
    return this.roadMap;
  }

  private toMap(x: number, z: number): [number, number] {
    // Was: normalise x and z independently to fill the box. That made
    // the lap's shape a function of the shape of the widget it was drawn
    // in — this lap is 2.0 by 3.5 km, so it came out 43% wider than the
    // road really is, and any two boxes of different proportions drew
    // two different roads. roadmap.ts fits it with one scale for both
    // axes and centres it, so a metre is a metre whichever way you go.
    const p = this.getRoadMap().project(x, z);
    return [p.x, p.y];
  }

  private emitHud(): void {
    const area = areaAt(this.track, this.player.s);
    const road = roadAt(this.track, this.player.s);
    const next = nextAreaAt(this.track, this.player.s);
    const r = this.rival;

    // Dev/tuning handle — inspect live state from the console.
    let nearest: { ds: number; lat: number } | null = null;
    for (const t of this.traffic) {
      const ds = this.track.deltaAhead(this.player.s, t.s);
      if (ds > 0 && ds < 90 && (!nearest || ds < nearest.ds)) nearest = { ds, lat: t.lat };
    }
    // Dev handles: the live state snapshot plus the engine itself, so
    // scripted play-tests can stage situations the sim reaches slowly.
    (window as unknown as { __grnEngine: GameEngine }).__grnEngine = this;
    (window as unknown as { __grnGpu: string }).__grnGpu = this.gpuName();
    // THREE itself and the layout constants, so a test can raycast the
    // world it is looking at rather than re-derive where things ought to
    // be — the street-network test walks the city with these.
    (window as unknown as { __grnThree: typeof THREE }).__grnThree = THREE;
    (window as unknown as { __grnStreets: typeof STREETS }).__grnStreets = STREETS;
    (window as unknown as { __grnCoastU: typeof COAST_U }).__grnCoastU = COAST_U;
    (window as unknown as { __grnRoadHalf: number }).__grnRoadHalf = ROAD_HALF_WIDTH;
    // The district table and where each landmark was actually placed, so
    // the road test can check the lap against the real Kuwait rather
    // than against a second copy of the same guess.
    (window as unknown as { __grnAreas: typeof AREAS }).__grnAreas = AREAS;
    // The engine roster and its maths. A test that re-implements the
    // torque curve to check the torque curve proves only that it can
    // copy an equation, so it gets the real function instead.
    (window as unknown as { __grnEngines: typeof ENGINES }).__grnEngines = ENGINES;
    // The car factory and the showroom, so a test can build all fourteen
    // shells and measure them without driving fourteen garage purchases.
    (window as unknown as { __grnBuildCar: typeof createCar }).__grnBuildCar = createCar;
    (window as unknown as { __grnCars: typeof CARS }).__grnCars = CARS;
    (window as unknown as { __grnRig: typeof RIG }).__grnRig = RIG;
    // The tuner, so a test can step through the dash and read back what
    // is playing and how it is routed.
    (window as unknown as { __grnRadio: unknown }).__grnRadio = this.radio;
    // The station table, so a test can ask what makes each one different
    // rather than listening to four beds and forming an opinion.
    (window as unknown as { __grnChannels: unknown }).__grnChannels = CHANNELS;
    // Every exhaust in the shop, so a test can drive the three bands
    // from the spec side and hear whether they actually differ.
    (window as unknown as { __grnExhausts: typeof EXHAUSTS }).__grnExhausts = EXHAUSTS;
    // The flags, so a test can read back what was actually drawn rather
    // than trusting that seventeen draw() functions all did something.
    (
      window as unknown as {
        __grnFlags: { FLAGS: typeof FLAGS; FLAG_IDS: typeof FLAG_IDS; flagTexture: typeof flagTexture };
      }
    ).__grnFlags = { FLAGS, FLAG_IDS, flagTexture };
    // The real tune for any car in the showroom, so a test can race the
    // machine the game would hand over instead of inventing a plausible
    // set of numbers and then measuring its own invention.
    (
      window as unknown as { __grnTuneFor: (carId: string) => TuneEffects }
    ).__grnTuneFor = (carId: string) => computeEffects(loadGarage(), carId);
    (
      window as unknown as {
        __grnEngineMath: {
          torqueShape: typeof torqueShape;
          firingHz: typeof firingHz;
          fuelLitresPerHour: typeof fuelLitresPerHour;
        };
      }
    ).__grnEngineMath = { torqueShape, firingHz, fuelLitresPerHour };
    // Where the pumps are, so the fuel test can drive to one rather than
    // be told where it is.
    (window as unknown as { __grnStations: typeof STATIONS }).__grnStations = STATIONS;
    // The garage's own reader and writer, so a test can set up a save the
    // way the game does — including every migration — instead of writing
    // localStorage by hand and then testing its own JSON.
    (window as unknown as { __grnLoadGarage: typeof loadGarage }).__grnLoadGarage = loadGarage;
    // The invite-code machinery, so its output can be checked rather
    // than eyeballed on a lobby screen — which is how the first version
    // of it shipped a thirty-character code reading "undefined" three
    // times.
    (
      window as unknown as {
        __grnCommunity: {
          playerId: typeof playerId;
          inviteCode: typeof inviteCode;
          normaliseCode: typeof normaliseCode;
          isCodeShaped: typeof isCodeShaped;
        };
      }
    ).__grnCommunity = { playerId, inviteCode, normaliseCode, isCodeShaped };
    (window as unknown as { __grnSaveGarage: typeof saveGarage }).__grnSaveGarage = saveGarage;
    // The drift solver and its constants, on their own.
    //
    // A spin is a model, and a model is best measured by itself: driving
    // it through the whole engine mixes in the heading scrub, the
    // centrifugal push, the wall and the traction solver, and the number
    // that comes out the other end is the game rather than the model. It
    // is also the only practical way to sweep a constant — the alternative
    // is rebuilding and reloading once per value.
    (
      window as unknown as {
        __grnDriftModel: {
          solveDrift: typeof solveDrift;
          newDriftState: typeof newDriftState;
          HANDLING: typeof HANDLING;
        };
      }
    ).__grnDriftModel = { solveDrift, newDriftState, HANDLING };
    // The rear lamp levels, so their effect on the picture can be swept
    // rather than guessed one rebuild at a time.
    (window as unknown as { __grnTail: typeof TAIL }).__grnTail = TAIL;
    // The resolution arithmetic itself, so a test can walk every window
    // shape against every rung of the ladder in one page load instead of
    // booting the whole city twenty-five times to check twenty-five
    // multiplications.
    (
      window as unknown as {
        __grnRender: { pixelRatioFor: typeof pixelRatioFor; bufferFor: typeof bufferFor };
      }
    ).__grnRender = { pixelRatioFor, bufferFor };
    // The grip model, swept the same way the drift model is: what the
    // load solver does is a function of one number and a dt, and running
    // a lap of the corniche to find out what a stop on the brakes does
    // to the front axle measures the game rather than the model.
    (
      window as unknown as {
        __grnGrip: {
          newLoadState: typeof newLoadState;
          solveLoad: typeof solveLoad;
          gripAtSpeed: typeof gripAtSpeed;
          HANDLING: typeof HANDLING;
        };
      }
    ).__grnGrip = { newLoadState, solveLoad, gripAtSpeed, HANDLING };
    // The surfacing pass, so a test can ask the FUNCTION what it does to
    // a section instead of inferring it from a screenshot of a car.
    (
      window as unknown as {
        __grnCrown: { crownShell: typeof crownShell; CROWN: typeof CROWN };
      }
    ).__grnCrown = { crownShell, CROWN };
    (window as unknown as { __grnLandmarks: typeof LANDMARK_S }).__grnLandmarks = LANDMARK_S;
    // Where the sea stops being on your left, in metres. Derived from
    // COAST_U and the live track rather than typed, so it cannot drift
    // the way a second copy of a distance would: the lap has already
    // grown once, from 7.34 km to 8.49 km, when the return leg became
    // the Second Ring. Anything placed beside the road needs this to
    // know which verge is a verge and which is the Gulf.
    (window as unknown as { __grnCoastEndM: number }).__grnCoastEndM =
      COAST_U.to * this.track.length;
    (window as unknown as { __grnDebug: object }).__grnDebug = {
      playerSpeed: this.player.speed,
      playerLat: this.player.lat,
      // Where the weight is, and what the air is doing. Live, so a test
      // can watch the balance shift under the pedals rather than infer
      // it from a lap time.
      loadFront: this.load.front,
      loadRear: this.load.rear,
      rearLight: this.load.rearLight,
      steerScale: this.load.steerScale,
      driveScale: this.load.driveScale,
      pitchG: this.load.pitchG,
      downforce: this.tune.downforce,
      // The wake, so a test can put the car behind another one and check
      // that the air answered rather than time two laps and hope.
      tow: this.tow.strength,
      towDrag: this.tow.drag,
      towFrontGrip: this.tow.frontGrip,
      gripNow: gripAtSpeed(this.tune.gripAccel, this.tune.downforce, this.player.speed),
      gripStatic: this.tune.gripAccel,
      rivalSpeed: r?.speed,
      rivalState: r?.state,
      gap: r ? this.track.deltaAhead(this.player.s, r.s) : null,
      inBattle: this.inBattle,
      locked: this.locked,
      trafficAhead: nearest,
      remotes: this.remotes.size,
      lapDistance: this.lapDistance,
      s: this.player.s,
      heading: this.heading,
      slipVel: this.slipVel,
      shake: this.shake,
      streakOpacity: (this.streaks.material as THREE.LineBasicMaterial).opacity,
      driftYaw: this.driftYaw,
      driftRun: this.driftRun,
      driftChain: this.ds.chain,
      spinning: this.ds.spinT > 0,
      brakeLock: this.brakeOut?.lock ?? 0,
      brakeTemp: Math.round(this.brakeOut?.temp ?? 0),
      brakeFade: this.brakeOut?.fade ?? 0,
      abs: this.brakeOut?.abs ?? false,
      cine: this.cine ? (performance.now() - this.cine.start) / 1000 : null,
      renderScale: this.renderScale,
      fpsEma: Math.round(this.fpsEma),
      sound: this.sound?.debugState() ?? null,
    };

    let rivalDist: number | null = null;
    let canFlash = false;
    let map: HudData["map"] = null;

    this.track.pointAt(this.player.s, this.v1);
    const [px, py] = this.toMap(this.v1.x, this.v1.z);
    // Which way you are pointing, in map space. The projection is a
    // rigid scale of the world's x and z, so the road's tangent IS the
    // map's tangent and no separate bearing has to be tracked — the one
    // thing an aspect-correct map buys that a stretched one cannot.
    this.track.tangentAt(this.player.s, this.v3);
    const facing = Math.atan2(this.v3.z, this.v3.x);
    // Where the nearest pump is. The tank has a fail state, and a map
    // that cannot answer "which way is the next one" is a decoration.
    const pump = nextStation(this.track.length, this.track.wrap(this.player.s));

    // Everyone else on the road, for the full map. Built only when there
    // is somebody there — an empty array every frame at sixty frames a
    // second is garbage for nothing.
    let others: ReadonlyArray<{ x: number; y: number; name: string }> = EMPTY_MAP_OTHERS;
    if (this.remotes.size > 0) {
      const list: Array<{ x: number; y: number; name: string }> = [];
      for (const rp of this.remotes.values()) {
        if (!rp.mesh.visible) continue;
        this.track.pointAt(rp.s, this.v1);
        const [ox, oy] = this.toMap(this.v1.x, this.v1.z);
        list.push({ x: ox, y: oy, name: rp.name });
      }
      others = list;
      this.track.pointAt(this.player.s, this.v1);
    }

    const common = {
      px, py,
      facing,
      s: this.track.wrap(this.player.s),
      toPump: pump.metres,
      others,
    };
    if (r && r.state !== "defeated") {
      const gap = this.track.deltaAhead(this.player.s, r.s);
      rivalDist = gap;
      canFlash = !this.inBattle && !this.challengePending && gap >= 2 && gap <= FLASH_RANGE;
      this.track.pointAt(r.s, this.v1);
      const [rx, ry] = this.toMap(this.v1.x, this.v1.z);
      map = { ...common, rx, ry };
    } else {
      map = { ...common, rx: -1, ry: -1 };
    }

    let nearestRemote: HudData["nearestRemote"] = null;
    for (const [id, r] of this.remotes) {
      if (!r.mesh.visible) continue;
      const d = this.track.deltaAhead(this.player.s, r.s);
      if (Math.abs(d) > 70) continue;
      if (!nearestRemote || Math.abs(d) < Math.abs(nearestRemote.dist)) {
        nearestRemote = { id, name: r.name, dist: d };
      }
    }

    const run = this.activeRun();
    this.events.onHud({
      nearestRemote,
      duel: this.duel,
      run: run
        ? {
            name: run.name,
            ar: run.ar,
            hint: run.hint,
            hintAr: run.hintAr,
            label: questLabel(run, this.runs),
            frac: questFraction(run, this.runs),
          }
        : null,
      flashCount: performance.now() > this.flashWindowUntil ? 0 : this.flashCount,
      speedKmh: this.player.speed * KMH,
      tach: (() => {
        const eng = this.tune.engine;
        const frac = Math.min(1, Math.max(0, this.revFrac));
        return {
          rpm: rpmAt(eng, frac),
          idle: eng.idleRpm,
          redline: eng.redlineRpm,
          frac,
          gear: this.player.speed * KMH < 2 ? 0 : this.gearHeld + 1,
          shift: frac > 0.93,
          /**
           * How hard the engine is against its limiter, 0..1.
           *
           * Not `frac > something`: the limiter already ramps in over
           * the top of the band and cuts torque as it goes, and the
           * alert should read that ramp rather than re-derive a
           * threshold that could disagree with the one the physics
           * uses. Brushing it is a flicker; sitting on it is a solid
           * red.
           *
           * On an engine geared to change up early this never leaves
           * zero, which is the point — see EngineSpec.shiftAt.
           */
          limiter: this.revLimited,
        };
      })(),
      areaName: area.name,
      areaArabic: area.arabic,
      roadName: road.name,
      roadArabic: road.arabic,
      nextArea: next.area.name,
      nextArabic: next.area.arabic,
      nextInM: Math.round(next.metres),
      roadNick: road.nick,
      roadNickArabic: road.nickArabic,
      hour: this.timeHours,
      racingOpen: this.racingOpen(),
      rivalDist,
      canSizeUp: !!this.rival && !this.inBattle && !this.cine && !this.locked &&
        Math.abs(this.track.deltaAhead(this.player.s, this.rival.s)) <= SIZE_UP_RANGE,
      canFlash,
      battle:
        this.inBattle && r
          ? {
              playerSp: this.player.sp,
              rivalSp: r.sp,
              rivalName: r.def.name,
              rivalArabic: r.def.arabicName,
              rivalCrew: r.def.crew,
              /** How long this race is, and how much of it is left. A
               *  finish line nobody can see is not a finish line. */
              raceKm: this.raceDistanceM / 1000,
              leftKm: Math.max(0, this.raceDistanceM - this.bstat.dist) / 1000,
            }
          : null,
      defeated: this.rivalIndex,
      total: RIVALS.length,
      map,
      tow: this.tow.strength,
      boost: this.tune.boostMult > 0 ? this.boost : null,
      // Charge alone cannot drive a gauge that has to read "firing",
      // "ready" and "too empty to fire" as three different things — the
      // last two are both a partly-full bar.
      nos: this.tune.hasNos
        ? { charge: this.nosCharge, firing: this.nosActive, ready: this.nosCharge > 0.02 }
        : null,
      fuel: {
        litres: this.fuel,
        capacity: this.tune.tankLitres,
        dry: this.outOfFuel,
      },
      pump: this.pumpState,
      drift:
        this.driftFlash > 0 || Math.abs(this.driftYaw) > 0.06
          ? {
              // While it is away, the number that matters is not where
              // the body is pointing but how far round it has been —
              // the difference between a half spin and a 540.
              deg:
                this.ds.spinT > 0
                  ? Math.round((this.ds.spinSwept * 180) / Math.PI)
                  : Math.round((Math.abs(this.driftYaw) * 180) / Math.PI),
              score: Math.round(this.driftRun),
              active: Math.abs(this.driftYaw) > 0.14,
              chain: this.ds.chain,
              spinning: this.ds.spinT > 0,
            }
          : null,
      brakes: {
        lock: this.brakeOut?.lock ?? 0,
        fade: this.brakeOut?.fade ?? 0,
        abs: this.brakeOut?.abs ?? false,
      },
    });
  }
}
