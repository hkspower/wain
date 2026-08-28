"use client";

import { useEffect, useRef, useState } from "react";
import type { RaceResult } from "@/game/engine";
import { rankTitle } from "@/game/profile";
import { haptic, HAPTIC } from "@/game/settings";
import { playSfx } from "@/game/sfx";
import { ICONS, type IconName } from "./Icons";

/**
 * Post-race results sequence.
 *
 * Beats, in order, exactly as a console racer does it:
 *   position → XP → currency → rewards → statistics → next race
 *
 * Each beat lands on its own, so the payoff is paced instead of dumped.
 * Tapping anywhere fast-forwards to the end state, and reduced motion
 * starts there — nobody is ever held hostage by the animation.
 */

const BEATS = [0, 900, 2100, 3200, 4300, 5200] as const;
type Beat = 0 | 1 | 2 | 3 | 4 | 5;

/** Count a number up over `ms`, honouring reduced motion. */
function useCountUp(target: number, run: boolean, ms = 800): number {
  const [v, setV] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (!run) return;
    const reduced =
      typeof document !== "undefined" &&
      (document.documentElement.dataset.reducedMotion === "1" ||
        matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (reduced || ms <= 0) {
      setV(target);
      return;
    }
    const from = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      // easeOutCubic — fast start, soft landing on the final digit
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(from + (target - from) * e));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, run, ms]);
  return v;
}

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface Props {
  result: RaceResult;
  haptics: boolean;
  onNext(): void;
  onRetry(): void;
  onGarage(): void;
}

export default function Results({ result, haptics, onNext, onRetry, onGarage }: Props) {
  const [beat, setBeat] = useState<Beat>(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const won = result.outcome === "win";
  const levelUpAhead = result.levelAfter.level > result.levelBefore.level;

  useEffect(() => {
    const reduced =
      document.documentElement.dataset.reducedMotion === "1" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setBeat(5);
      return;
    }
    BEATS.forEach((at, i) => {
      if (i === 0) return;
      timers.current.push(setTimeout(() => setBeat(i as Beat), at));
    });
    // Sound and haptics land on the beats that actually pay out.
    playSfx(won ? "victory" : "defeat");
    timers.current.push(
      setTimeout(() => {
        haptic(HAPTIC.reward, haptics);
        playSfx("xp-tick", 0.7);
      }, BEATS[1])
    );
    if (levelUpAhead)
      timers.current.push(setTimeout(() => playSfx("level-up"), BEATS[1] + 700));
    if (result.rewards.length)
      timers.current.push(
        setTimeout(() => {
          haptic(HAPTIC.challenge, haptics);
          playSfx("unlock");
        }, BEATS[3])
      );
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [haptics, result.rewards.length, won, levelUpAhead]);

  const skip = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setBeat(5);
  };

  const xp = useCountUp(result.xpGain, beat >= 1, 850);
  const kd = useCountUp(Math.abs(result.kd), beat >= 2, 750);
  const balance = useCountUp(result.balance, beat >= 2, 900);

  const levelUp = levelUpAhead;
  // Before the XP lands the bar shows where the player started; after, it
  // shows where they finished (a level-up simply refills from empty).
  const barPct = beat >= 1 ? result.levelAfter.pct : result.levelBefore.pct;
  const shownLevel = beat >= 1 ? result.levelAfter.level : result.levelBefore.level;
  const rank = rankTitle(shownLevel);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/72 backdrop-blur-md"
      onClick={beat < 5 ? skip : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Race results"
    >
      <div
        className="grn-dialog screen-in safe-pad grn-scroll results-card max-h-full w-[min(640px,94vw)] overflow-y-auto p-5 sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
       <div className="results-grid">
        <div>
        {/* 1 — POSITION */}
        <div className="text-center">
          <div
            className={`stamp-in grn-display results-podium text-[clamp(2.6rem,11vw,4.2rem)] leading-none ${
              won ? "text-sodium-400" : "text-rose-300"
            }`}
            style={{
              textShadow: won
                ? "0 0 40px rgba(245,165,36,0.55), 0 4px 20px rgba(0,0,0,0.9)"
                : "0 0 40px rgba(244,63,94,0.4), 0 4px 20px rgba(0,0,0,0.9)",
            }}
          >
            {result.champion ? "CHAMPION" : won ? "1ST — VICTORY" : "2ND — DEFEAT"}
          </div>
          <p className="grn-label mt-1.5 text-[0.75rem]">
            {won ? "vs" : "beaten by"} {result.rival.name}{" "}
            <span className="grn-ar text-white/70" lang="ar">{result.rival.arabicName}</span> ·{" "}
            {result.rival.crew}
          </p>
        </div>

        {/* 2 — XP + LEVEL */}
        <div
          className={`mt-5 transition-opacity duration-300 ${beat >= 1 ? "opacity-100" : "opacity-0"}`}
        >
          <div className="flex items-end justify-between">
            <span className="grn-label text-[0.75rem]">
              Driver level {shownLevel} · {rank.en}{" "}
              <span className="grn-ar text-white/74" lang="ar">{rank.ar}</span>
            </span>
            <span className="grn-display tnum text-lg text-gulf-300">+{xp} XP</span>
          </div>
          <div className="grn-meter relative mt-1.5 h-3.5">
            <div
              className={`xp-fill h-full bg-gradient-to-r from-gulf-500 via-gulf-400 to-gulf-300 shadow-[0_0_18px_rgba(56,201,238,0.7)] ${
                beat >= 1 ? "bar-sheen" : ""
              }`}
              style={{ width: `${Math.round(barPct * 100)}%` }}
            />
            {levelUp && beat >= 1 && (
              <span className="level-flare pointer-events-none absolute inset-0 rounded bg-sodium-400/40" />
            )}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="grn-label text-[0.7rem] text-white/70">
              {result.levelAfter.into} / {result.levelAfter.need} to level {shownLevel + 1}
            </span>
            {levelUp && (
              <span className="grn-display text-[0.8rem] tracking-[0.18em] text-sodium-400">
                LEVEL UP
              </span>
            )}
          </div>

          {/* Itemised XP — teaches the scoring without a manual */}
          <ul className="mt-2.5 grid gap-1 sm:grid-cols-2">
            {result.xpBreakdown.map((b, i) => (
              <li
                key={b.label}
                className="reveal flex items-center justify-between rounded-md bg-white/[0.04] px-2.5 py-1 text-[0.8rem] text-white/75"
                style={{ ["--d" as string]: `${900 + i * 70}ms` }}
              >
                <span>{b.label}</span>
                <span className="tnum font-semibold text-gulf-300">+{b.value}</span>
              </li>
            ))}
          </ul>
        </div>

        </div>

        <div>
        {/* 3 — CURRENCY */}
        <div
          className={`mt-4 flex items-center justify-between rounded-xl border px-4 py-3 transition-opacity duration-300 ${
            beat >= 2 ? "opacity-100" : "opacity-0"
          } ${
            result.kd >= 0
              ? "border-sodium-500/40 bg-sodium-500/[0.08]"
              : "border-rose-500/40 bg-rose-500/[0.08]"
          }`}
        >
          <div>
            <div className="grn-label text-[0.7rem]">
              {result.kd >= 0 ? "Prize money" : "Purse lost"}
            </div>
            {result.purse > 0 && (
              <div className="mt-0.5 text-[0.75rem] text-white/55">
                {result.purse.toLocaleString()} KD staked each side
              </div>
            )}
          </div>
          <div className="text-right">
            <div
              className={`grn-display tnum text-2xl ${
                result.kd >= 0 ? "text-sodium-400" : "text-rose-300"
              }`}
            >
              {result.kd >= 0 ? "+" : "−"}
              {kd.toLocaleString()} KD
            </div>
            <div className="grn-label tnum text-[0.7rem] text-white/74">
              Balance {balance.toLocaleString()} KD
            </div>
          </div>
        </div>

        {/* 4 — REWARDS */}
        {result.rewards.length > 0 && (
          <div className={`mt-4 ${beat >= 3 ? "" : "invisible"}`}>
            <div className="grn-label mb-1.5 text-[0.7rem]">Unlocked</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {result.rewards.map((r, i) => (
                <div
                  key={r.title}
                  className="reward-pop grn-panel flex items-center gap-3 px-3 py-2"
                  style={{ ["--d" as string]: beat >= 3 ? `${i * 130}ms` : "0ms" }}
                >
                  <span className="leading-none text-sodium-400">
                    {(() => {
                      const Ico = ICONS[r.icon as IconName] ?? ICONS.star;
                      return <Ico size={22} />;
                    })()}
                  </span>
                  <span className="min-w-0">
                    <span className="grn-display block truncate text-sm text-white">{r.title}</span>
                    <span className="block truncate text-[0.75rem] text-white/55">{r.sub}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 5 — STATISTICS */}
        <div
          className={`mt-4 grid grid-cols-2 gap-2 transition-opacity duration-300 sm:grid-cols-4 ${
            beat >= 4 ? "opacity-100" : "opacity-0"
          }`}
        >
          {[
            { k: "Top speed", v: `${result.stats.topSpeedKmh}`, u: "km/h" },
            { k: "Race time", v: fmtTime(result.stats.durationMs), u: "" },
            { k: "Distance", v: `${(result.stats.distanceM / 1000).toFixed(2)}`, u: "km" },
            {
              k: "Contact",
              v: result.stats.clean ? "CLEAN" : `${result.stats.contacts}`,
              u: result.stats.clean ? "" : "hits",
            },
          ].map((s, i) => (
            <div
              key={s.k}
              className="reveal rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-center"
              style={{ ["--d" as string]: beat >= 4 ? `${i * 80}ms` : "0ms" }}
            >
              <div className="grn-display tnum text-lg leading-tight text-white">
                {s.v}
                {s.u && <span className="ml-0.5 text-[0.7rem] text-white/74">{s.u}</span>}
              </div>
              <div className="grn-label text-[0.7rem] text-white/70">{s.k}</div>
            </div>
          ))}
        </div>
        <div
          className={`mt-2 text-center text-[0.75rem] text-white/70 transition-opacity duration-300 ${
            beat >= 4 ? "opacity-100" : "opacity-0"
          }`}
        >
          Career {result.career.wins}W · {result.career.races - result.career.wins}L ·{" "}
          streak {result.career.streak} (best {result.career.bestStreak})
        </div>

        {/* 6 — NEXT RACE */}
        <div
          className={`mt-5 transition-opacity duration-300 ${beat >= 5 ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        >
          {result.nextRival && won && (
            <p className="mb-2.5 text-center text-[0.8rem] text-white/65">
              Next up:{" "}
              <span className="grn-display text-white">{result.nextRival.name}</span>{" "}
              <span className="grn-ar text-white/60" lang="ar">{result.nextRival.arabicName}</span> ·{" "}
              {result.nextRival.crew}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {!won && (
              <button
                onClick={onRetry}
                className="grn-btn grn-btn-primary tap min-w-[7.5rem] flex-1 px-4 py-3 text-sm"
              >
                REMATCH <span className="grn-ar" lang="ar">مرة ثانية</span>
              </button>
            )}
            <button
              onClick={onGarage}
              className="grn-btn grn-btn-ghost tap min-w-[6rem] flex-1 px-4 py-3 text-sm"
            >
              GARAGE
            </button>
            <button
              onClick={onNext}
              className={`grn-btn tap min-w-[7.5rem] flex-1 px-4 py-3 text-sm ${
                won ? "grn-btn-primary" : "grn-btn-ghost"
              }`}
            >
              {result.champion ? "CELEBRATE" : won ? "NEXT RACE →" : "KEEP CRUISING"}
            </button>
          </div>
        </div>

        </div>
       </div>

        {beat < 5 && (
          <p className="grn-label mt-4 text-center text-[0.7rem] text-white/62">
            tap to skip
          </p>
        )}
      </div>
    </div>
  );
}
