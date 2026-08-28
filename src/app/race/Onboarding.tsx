"use client";

import { useEffect, useState } from "react";
import { haptic, HAPTIC } from "@/game/settings";
import { RIVALS } from "@/game/rivals";
import { IconCrown } from "./Icons";

/**
 * First-run onboarding.
 *
 * Five cards, one idea each, answering exactly the five questions a new
 * player has: how do I drive, how do I go faster, how do I win, how do I
 * get better, and what am I working towards. Skippable at any point and
 * never shown twice.
 *
 * The in-race half of onboarding is `CoachHint` at the bottom of this
 * file — the tutorial that only speaks while you are actually driving.
 */

const KEY = "gulf-road-nights-onboarded";

export function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(KEY) === "2";
  } catch {
    return true; // no storage → don't nag every load
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(KEY, "2");
  } catch {}
}

interface Card {
  kicker: string;
  title: string;
  ar: string;
  body: string;
  art: React.ReactNode;
}

const Pad = ({ label, hot }: { label: string; hot?: boolean }) => (
  <span
    className={`grn-display inline-flex size-11 items-center justify-center rounded-xl border text-sm ${
      hot
        ? "coach-ring border-sodium-400/70 bg-sodium-500/20 text-sodium-300"
        : "border-white/25 bg-white/10 text-white/80"
    }`}
  >
    {label}
  </span>
);

const CARDS: Card[] = [
  {
    kicker: "01 · DRIVE",
    title: "Hold the throttle",
    ar: "امسك البنزين",
    body:
      "Right pad accelerates, left pad brakes, and the wheel-side pads steer. " +
      "On a keyboard that is W / S and A / D. The corniche is 7.3 km of real " +
      "Gulf Road — you never have to stop.",
    art: (
      <div className="flex items-center justify-center gap-2">
        <Pad label="◀" />
        <Pad label="▶" />
        <span className="w-4" />
        <Pad label="BRK" />
        <Pad label="GAS" hot />
      </div>
    ),
  },
  {
    kicker: "02 · BOOST",
    title: "Boost, NOS and drift",
    ar: "التيربو والدرفت",
    body:
      "Turbo spools on throttle and NOS (hold N) is a three-second shove. " +
      "Hold DRIFT (Space) while turning to kick the tail out, then EASE OFF " +
      "the lock — keep it buried and the car keeps rotating until it spins. " +
      "Catch it with opposite lock. Reverse a live slide to link it: ×2, ×3, " +
      "up to ×5. Spin or touch a wall and the multiplier is gone.",
    art: (
      <div className="w-full space-y-2">
        <div className="grn-meter h-3">
          <div className="h-full w-3/4 bg-gradient-to-r from-sodium-500 to-sodium-400" />
        </div>
        <div className="grn-meter h-3">
          <div className="h-full w-1/2 bg-gradient-to-r from-gulf-500 to-gulf-300" />
        </div>
      </div>
    ),
  },
  {
    kicker: "03 · WIN",
    title: "Flash to challenge, then break them",
    ar: "لوّح بالضو",
    body:
      "Catch a rival, flash your headlights three times, and agree the stake. " +
      "Whoever falls behind bleeds SP — empty their bar before they empty " +
      "yours. Contact hurts your bar, so keep it clean.",
    art: (
      <div className="w-full space-y-1.5">
        <div className="grn-meter h-3.5">
          <div className="h-full w-[82%] bg-gradient-to-r from-emerald-600 to-emerald-300" />
        </div>
        <div className="grn-meter h-3.5">
          <div className="rival-bar h-full w-[34%] bg-gradient-to-r from-rose-700 to-amber-300" />
        </div>
        <p className="grn-display pt-1 text-center text-xs tracking-[0.2em] text-gulf-300">
          FLASH 3&times; &middot; two of three
        </p>
      </div>
    ),
  },
  {
    kicker: "04 · UPGRADE",
    title: "Spend the winnings",
    ar: "طوّر سيارتك",
    body:
      "Every race pays KD. Buy turbo, brakes, tyres, NOS and paint in the " +
      "garage — or buy a whole new machine in the showroom, from a Sharq " +
      "hatch to something that has no business on a public road.",
    art: (
      <div className="flex w-full items-center justify-center gap-2 text-center">
        {["TURBO", "TYRES", "NOS", "PAINT"].map((t) => (
          <span
            key={t}
            className="grn-label rounded-md border border-white/15 bg-white/[0.06] px-2 py-1.5 text-[0.7rem]"
          >
            {t}
          </span>
        ))}
      </div>
    ),
  },
  {
    kicker: "05 · PROGRESS",
    title: `${RIVALS.length} legends, one crown`,
    ar: "ملك شارع الخليج",
    body:
      "Beating a rival unlocks the next, harder one and raises your driver " +
      `level. Clean wins and big leads pay extra XP. Take all ${RIVALS.length} and the ` +
      "street is yours — King of Gulf Road.",
    art: (
      <div className="flex w-full items-center justify-center gap-1.5">
        {RIVALS.map((_, i) => (
          <span
            key={i}
            className={`h-2.5 flex-1 rounded-full ${
              i === 0 ? "bg-sodium-400" : "bg-white/15"
            }`}
          />
        ))}
        <IconCrown size={18} className="ml-1 text-sodium-400" />
      </div>
    ),
  },
];

export default function Onboarding({
  haptics,
  onDone,
}: {
  haptics: boolean;
  onDone(): void;
}) {
  const [i, setI] = useState(0);
  const last = i === CARDS.length - 1;
  const c = CARDS[i];

  const next = () => {
    haptic(HAPTIC.tap, haptics);
    if (last) {
      markOnboarded();
      onDone();
    } else setI((n) => n + 1);
  };

  const skip = () => {
    markOnboarded();
    onDone();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        next();
      }
      if (e.key === "Escape") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-night-950/92 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="How to play"
    >
      <div className="grn-dialog screen-in safe-pad w-[min(560px,94vw)] p-5 sm:p-7">
        <div className="flex items-center justify-between">
          <span className="grn-label text-[0.7rem] text-sodium-400">{c.kicker}</span>
          <button
            onClick={skip}
            className="grn-label tap px-2 text-[0.7rem] text-white/74 hover:text-white"
          >
            SKIP
          </button>
        </div>

        {/* One card, one idea — remounted per step so it re-animates. */}
        <div key={i} className="reveal mt-3">
          <h2 className="grn-display text-[clamp(1.5rem,6vw,2rem)] leading-tight text-white">
            {c.title}
          </h2>
          <p className="grn-ar mt-0.5 text-base text-sodium-400/90" lang="ar">{c.ar}</p>
          <div className="my-4 flex min-h-[86px] items-center justify-center rounded-xl border border-white/10 bg-black/40 p-4">
            {c.art}
          </div>
          <p className="text-sm leading-relaxed text-white/72">{c.body}</p>
        </div>

        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="flex gap-1.5" aria-hidden>
            {CARDS.map((_, n) => (
              <span
                key={n}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  n === i ? "w-6 bg-sodium-400" : "w-1.5 bg-white/25"
                }`}
              />
            ))}
          </div>
          <button onClick={next} className="grn-btn grn-btn-primary tap px-6 py-3 text-sm">
            {last ? "LET'S GO — يلا" : "NEXT"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export interface CoachState {
  speedKmh: number;
  rivalDist: number;
  inBattle: boolean;
}

const COACH_KEY = "gulf-road-nights-coach";

/**
 * In-race coaching: three one-line prompts that appear only while the
 * thing they teach is still undone, then never again. This is the part
 * of onboarding that actually sticks, because it happens with hands on
 * the controls.
 */
export function CoachHint({ state }: { state: CoachState | null }) {
  const [step, setStep] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(COACH_KEY) ?? "0");
    } catch {
      return 3;
    }
  });

  useEffect(() => {
    if (!state || step >= 3) return;
    let done = false;
    if (step === 0 && state.speedKmh > 70) done = true;
    if (step === 1 && state.rivalDist > 0 && state.rivalDist < 70) done = true;
    if (step === 2 && state.inBattle) done = true;
    if (done) {
      const n = step + 1;
      setStep(n);
      try {
        localStorage.setItem(COACH_KEY, String(n));
      } catch {}
    }
  }, [state, step]);

  if (step >= 3 || !state) return null;
  const text = [
    "Hold GAS to accelerate — امسك البنزين",
    "Catch the rival ahead — الحقه",
    "Flash 3× to challenge — لوّح بالضو ٣ مرات",
  ][step];

  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-[3.2rem]">
      <div className="grn-info coach-ring reveal px-4 py-2">
        <span className="grn-display text-[0.875rem] tracking-[0.08em]">{text}</span>
      </div>
    </div>
  );
}
