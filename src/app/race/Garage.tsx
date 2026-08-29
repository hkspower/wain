"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CARS,
  CLASS_LABELS,
  CarClass,
  EXCLUSIVE_CATS,
  GarageState,
  buildOf,
  clampTint,
  PAINT_COLORS,
  PARTS,
  Part,
  computeEffects,
  getCar,
  lockedBy,
  rivalsBeaten,
  tradeInValue,
} from "@/game/mods";
import { getEngine, layoutTag } from "@/game/engines";
import {
  DEFAULT_LOGO,
  loadCrew,
  sanitizeTag,
  saveCrew,
  teamLogoDataUrl,
  type Crew,
} from "@/game/teams";
import CrewBuilder from "@/components/CrewBuilder";
import { haptic, HAPTIC, loadSettings } from "@/game/settings";
import { playSfx } from "@/game/sfx";
import { ICONS } from "./Icons";

/**
 * The garage, rebuilt as three rooms instead of one long corridor:
 *
 *   SHOWROOM     — buy machines, priced high to low
 *   PERFORMANCE  — everything that changes the handling model
 *   STYLE        — paint and underglow, zero-stat, pure identity
 *
 * A live spec panel pins the current build's four numbers to the top, so
 * every purchase visibly moves a bar the moment it is equipped — the
 * feedback loop that makes spending feel like progress.
 */

type Tab = "showroom" | "performance" | "style";

const PERFORMANCE_CATS: Array<{ cat: string; label: string }> = [
  { cat: "engine", label: "ENGINE — THE BLOCK ITSELF · المكينة" },
  { cat: "aspiration", label: "FORCED INDUCTION · التيربو" },
  { cat: "intake", label: "INTAKE · الفلتر" },
  { cat: "internals", label: "INTERNALS · القطع الداخلية" },
  { cat: "exhaust", label: "EXHAUST · الدبة" },
  { cat: "brakes", label: "BRAKES · البريكات" },
  { cat: "tires", label: "TIRES · التواير" },
  { cat: "gearbox", label: "GEARBOX · القير" },
  { cat: "chassis", label: "CHASSIS & DIFF · الهيكل" },
  { cat: "extras", label: "EXTRAS & NOS · الإضافات" },
];
const STYLE_CATS: Array<{ cat: string; label: string }> = [
  { cat: "paint", label: "PAINT · الصبغ" },
  { cat: "finish", label: "FINISH · اللمعة" },
  { cat: "carbon", label: "CARBON · الكاربون" },
  { cat: "cover", label: "ENGINE COVER · غطاء المكينة" },
  { cat: "lamps", label: "HEADLIGHTS · الشمعات" },
  { cat: "glow", label: "UNDERGLOW · الليتات" },
];

/** Spec bar ranges: min hides the floor, max is the best build in the
 *  game — measured, not guessed. The Zeta 300 GTR as it is delivered
 *  reads 3.15x on boost, 445 km/h, 46.4 braking and 23.9 grip, and a bar
 *  that pins at 100% two thirds of the way up the range stops being a
 *  comparison. */
const SPECS = [
  { key: "power", label: "POWER", min: 0.8, max: 3.2 },
  { key: "top", label: "TOP SPEED", min: 170, max: 460 },
  { key: "brakes", label: "BRAKES", min: 20, max: 50 },
  { key: "grip", label: "GRIP", min: 8, max: 24 },
] as const;

/**
 * What the build will actually reach. The governor is the answer now —
 * the engine solves its thrust curve so the car meets drag exactly at
 * that speed — but a build can still fall short of its own limiter if
 * it lacks the power, so this reports whichever comes first.
 */
function topSpeedKmh(power: number, governorKmh: number): number {
  const limit = governorKmh / 3.6;
  const dragAtLimit = (0.0012 * limit * limit + 1.2) * 0.35;
  const headroom = 1 - dragAtLimit / (19 * power);
  const ceiling = Math.max(115, headroom > 0.08 ? limit / headroom : limit * 12);
  let lo = 0;
  let hi = ceiling;
  for (let i = 0; i < 40; i++) {
    const v = (lo + hi) / 2;
    const thrust = 19 * power * (1 - v / ceiling);
    const drag = (0.0012 * v * v + 1.2) * 0.35;
    if (thrust > drag) lo = v;
    else hi = v;
  }
  return Math.min(lo * 3.6, governorKmh);
}

function StatBar({
  label,
  value,
  display,
  min,
  max,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, (value - min) / (max - min))) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="grn-label text-[0.7rem]">{label}</span>
        <span className="grn-display tnum text-[0.8rem] text-white/85">{display}</span>
      </div>
      <div className="grn-meter mt-0.5 h-2">
        <div
          className="xp-fill h-full bg-gradient-to-r from-sodium-500 to-sodium-400"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface Props {
  garage: GarageState;
  onClose(): void;
  onBuyCar(id: string): void;
  /** Sell an owned car back to the dealer — see sellCar in mods.ts for
   *  the rules; the shop only draws them. */
  onSellCar(id: string): void;
  onBuyPart(p: Part, carId: string): void;
  /** Window tint for one car, 0-100. Free and instant: it is a slider,
   *  not a purchase, so it does not go through onBuyPart. */
  onTint(carId: string, pct: number): void;
}

export default function Garage({ garage, onClose, onBuyCar, onSellCar, onBuyPart, onTint }: Props) {
  const [tab, setTab] = useState<Tab>("showroom");
  // Selling is the one destructive act in this shop, so it takes two
  // taps: the first arms the button and shows the money, the second is
  // the sale. Anything else — another card, another tab — disarms it.
  const [selling, setSelling] = useState<string | null>(null);
  useEffect(() => {
    if (!selling) return;
    // Eight seconds, because the armed label is a question — "SELL FOR
    // 14,880 KD — sure?" — and a player actually weighing it needs time
    // to read the number and think. Four was tested and it disarmed
    // under an honest hesitation.
    const t = setTimeout(() => setSelling(null), 8000);
    return () => clearTimeout(t);
  }, [selling]);
  // The machine on the ramp. Parts are bought FOR a car, so the shop has
  // to say which one — and let you build a car you are not driving,
  // which is the whole reason to own more than one.
  const [ramp, setRamp] = useState<string>(garage.car);
  useEffect(() => {
    if (!garage.cars.includes(ramp)) setRamp(garage.car);
  }, [garage.cars, garage.car, ramp]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The crew this save flies. Read after mount, not during render: it
  // lives in localStorage and the garage is server-rendered first.
  // Career progress, read after mount for the same reason the crew is.
  const [beaten, setBeaten] = useState(0);
  const [crew, setCrew] = useState<Crew | null>(null);
  const [draft, setDraft] = useState<Crew | null>(null);
  useEffect(() => {
    setCrew(loadCrew());
    setBeaten(rivalsBeaten());
  }, []);

  const fx = useMemo(() => computeEffects(garage, ramp), [garage, ramp]);
  const car = getCar(ramp);
  const build = buildOf(garage, ramp);
  const stockEngine = getEngine(car.engine);
  // Effective power counts the blower at full boost — what you feel
  const power = fx.accelMult * (1 + fx.boostMult);
  const top = topSpeedKmh(power, fx.topSpeedKmh);
  const specValues = {
    power,
    top,
    brakes: fx.brakeForce,
    grip: fx.gripAccel,
  };
  const specDisplay = {
    power: `${power.toFixed(2)}×`,
    top: `${Math.round(top)} km/h`,
    brakes: String(Math.round(fx.brakeForce)),
    grip: fx.gripAccel.toFixed(1),
  };

  const pick = (t: Tab) => {
    haptic(HAPTIC.tap, loadSettings().haptics);
    playSfx("ui-tap", 0.5);
    setSelling(null);
    setTab(t);
  };

  /**
   * Which machine the parts are going on.
   *
   * A build belongs to a car, so the shop cannot just quietly use
   * whichever one you last drove — it has to name it, and it has to let
   * you work on a car you are not sitting in. Cars you do not own yet
   * are not here; buy them in the showroom first.
   */
  const rampPicker = (
    <div className="grn-panel mb-4 p-3">
      <div className="grn-label text-[0.7rem]">
        Working on <span className="text-sodium-400">{car.name}</span> · parts are
        bought for this car
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CARS.filter((c) => garage.cars.includes(c.id)).map((c) => (
          <button
            key={c.id}
            onClick={() => {
              haptic(HAPTIC.tap, loadSettings().haptics);
              playSfx("ui-tap", 0.5);
              setRamp(c.id);
            }}
            className={`grn-btn tap px-2.5 py-1.5 text-[0.8rem] ${
              ramp === c.id
                ? "grn-btn-primary"
                : "border border-white/15 text-white/65 hover:bg-white/10"
            }`}
          >
            {c.name}
            {garage.car === c.id && <span className="ml-1 text-[0.7rem] opacity-70">· driving</span>}
          </button>
        ))}
      </div>
    </div>
  );

  const partCard = (p: Part) => {
    const owned = build.owned.includes(p.id);
    const equipped =
      EXCLUSIVE_CATS.has(p.cat) &&
      build.equipped[p.cat as keyof typeof build.equipped] === p.id;
    const affordable = garage.kd >= p.price;
    const swatch =
      p.cat === "paint"
        ? p.id === "paint-white"
          ? car.color // factory finish: whatever this machine left the lot in
          : PAINT_COLORS[p.id]
        : undefined;
    return (
      <button
        key={p.id}
        onClick={() => onBuyPart(p, ramp)}
        disabled={!owned && !affordable}
        className={`grn-panel tap p-3.5 text-left transition ${
          equipped
            ? "border-sodium-400/80 bg-sodium-500/10 shadow-[0_0_30px_-10px_rgba(245,165,36,0.7)]"
            : owned
              ? "border-emerald-400/45 hover:border-emerald-400/70"
              : affordable
                ? "hover:border-white/30 hover:bg-white/[0.09]"
                : "cursor-not-allowed opacity-45"
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="grn-display flex items-center gap-2 text-lg leading-tight">
            {swatch !== undefined && (
              <span
                className="inline-block size-4 shrink-0 rounded-full border border-white/40"
                style={{ backgroundColor: `#${swatch.toString(16).padStart(6, "0")}` }}
              />
            )}
            {p.name}
          </span>
          <span className="grn-ar text-[0.875rem] text-white/60" lang="ar">{p.ar}</span>
        </div>
        {p.desc && <div className="mt-1.5 text-[0.8rem] leading-5 text-white/55">{p.desc}</div>}
        <div className="grn-label mt-2.5 text-[0.7rem]">
          {equipped ? (
            <span className="text-sodium-400">Equipped ✓</span>
          ) : owned ? (
            <span className="text-emerald-300">
              {EXCLUSIVE_CATS.has(p.cat) ? "Owned — tap to equip" : "Installed ✓"}
            </span>
          ) : affordable ? (
            <span className="grn-display text-base tracking-normal text-gulf-300">
              {p.price.toLocaleString()} KD
            </span>
          ) : (
            <span className="text-white/70">
              {p.price.toLocaleString()} KD · need{" "}
              <span className="tnum">{(p.price - garage.kd).toLocaleString()}</span> more
            </span>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="screen-in absolute inset-0 z-20 flex flex-col menu-backdrop">
      {/* Sticky header: identity, money, exit — never scrolls away */}
      <div className="safe-pad shrink-0 border-b border-white/10 bg-night-950/80 !pb-2.5 !pt-[calc(var(--safe-t)+0.6rem)] backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="grn-label text-[0.7rem] tracking-[0.4em] text-gulf-400">
              The Garage
            </div>
            <h2 className="grn-display truncate text-2xl italic leading-tight">
              <span className="grn-ar" lang="ar">الكراج</span>{" "}
              <span className="text-sodium-400">TUNING</span>
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="text-right">
              <div className="grn-label text-[0.7rem]">Balance</div>
              <div className="grn-display tnum text-xl italic leading-tight text-sodium-400 [text-shadow:0_0_18px_rgba(245,165,36,0.5)]">
                {garage.kd.toLocaleString()} KD
              </div>
            </div>
            <button
              onClick={onClose}
              className="grn-btn grn-btn-primary tap px-5 py-2.5 text-sm"
            >
              DONE — <span className="grn-ar" lang="ar">يلا</span>
            </button>
          </div>
        </div>

        {/* Current build spec — every purchase moves a bar right here */}
        <div className="mx-auto mt-2.5 w-full max-w-4xl">
          <div className="grn-panel px-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="size-4 shrink-0 rounded-full border border-white/40"
                  style={{ backgroundColor: `#${fx.paint.toString(16).padStart(6, "0")}` }}
                />
                <span className="grn-display truncate text-base leading-tight">
                  {car.name} <span className="grn-ar text-white/55" lang="ar">{car.ar}</span>
                </span>
              </div>
              <span className="grn-label shrink-0 text-[0.7rem] text-white/70">
                {ramp === garage.car ? (
                  <>
                    {CLASS_LABELS[car.cls].en} ·{" "}
                    <span className="grn-ar" lang="ar">
                      {CLASS_LABELS[car.cls].ar}
                    </span>
                  </>
                ) : (
                  "ON THE RAMP"
                )}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
              {SPECS.map((sp) => (
                <StatBar
                  key={sp.key}
                  label={sp.label}
                  value={specValues[sp.key]}
                  display={specDisplay[sp.key]}
                  min={sp.min}
                  max={sp.max}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Rooms */}
        <div className="mx-auto mt-2.5 flex w-full max-w-4xl gap-1.5" role="tablist">
          {(
            [
              ["showroom", "SHOWROOM", "car"],
              ["performance", "PERFORMANCE", "wrench"],
              ["style", "STYLE", "paint"],
            ] as const
          ).map(([t, label, icon]) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => pick(t)}
              className={`grn-btn tap flex-1 px-2 py-2.5 text-[0.8rem] tracking-[0.08em] ${
                tab === t
                  ? "grn-btn-primary"
                  : "border border-white/15 text-white/65 hover:bg-white/10"
              }`}
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                {(() => {
                  const Ico = ICONS[icon];
                  return <Ico size={16} />;
                })()}
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Scrolling room content */}
      <div
        key={tab}
        className="grn-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--safe-b)+1.5rem)] pt-4 sm:px-6"
      >
        <div className="mx-auto w-full max-w-4xl">
          {tab === "showroom" && (
            <div key="showroom" className="reveal">
              <p className="max-w-2xl text-[0.875rem] leading-6 text-white/74">
                Priced high to low. Buying a machine puts you straight behind the
                wheel; tap an owned one to drive it — or trade it back in. The
                dealer pays 62% on the car and 40% on the parts, and the build
                goes with it.
              </p>
              {(["supercar", "sport", "normal"] as CarClass[]).map((cls) => (
                <div key={cls} className="mt-5">
                  <h3 className="grn-label border-b border-white/10 pb-2 text-[0.75rem]">
                    {CLASS_LABELS[cls].en} ·{" "}
                    <span className="grn-ar" lang="ar">
                      {CLASS_LABELS[cls].ar}
                    </span>
                  </h3>
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {CARS.filter((c) => c.cls === cls).map((c) => {
                      const owned = garage.cars.includes(c.id);
                      const driving = garage.car === c.id;
                      const affordable = garage.kd >= c.price;
                      // Legends still standing between the player and
                      // this machine. Shown rather than hidden: a car
                      // you cannot see is not rare, it is absent.
                      const toGo = owned ? 0 : lockedBy(c, beaten);
                      const quote = owned ? tradeInValue(garage, c.id) : 0;
                      const lastCar = garage.cars.length <= 1;
                      return (
                        <div key={c.id}>
                        <button
                          onClick={() => {
                            setSelling(null);
                            onBuyCar(c.id);
                          }}
                          disabled={!owned && (!affordable || toGo > 0)}
                          className={`grn-panel tap p-3.5 text-left transition ${
                            driving
                              ? "border-sodium-400/80 bg-sodium-500/10 shadow-[0_0_30px_-10px_rgba(245,165,36,0.7)]"
                              : owned
                                ? "border-emerald-400/45 hover:border-emerald-400/70"
                                : toGo > 0
                                  ? "cursor-not-allowed border-sodium-400/35 bg-sodium-500/[0.06] opacity-80"
                                  : affordable
                                    ? "hover:border-white/30 hover:bg-white/[0.09]"
                                    : "cursor-not-allowed opacity-45"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="grn-display text-lg leading-tight">{c.name}</div>
                              <div className="grn-ar text-[0.8rem] text-white/55" lang="ar">{c.ar}</div>
                            </div>
                            <span
                              className="mt-1 size-5 shrink-0 rounded-full border border-white/40"
                              style={{
                                backgroundColor: `#${c.color.toString(16).padStart(6, "0")}`,
                              }}
                            />
                          </div>
                          <div className="mt-2 text-[0.8rem] leading-5 text-white/55">
                            {c.desc}
                          </div>
                          <div className="mt-2.5 grid grid-cols-5 gap-1 border-t border-white/10 pt-2 text-center">
                            {(
                              [
                                // What is under the bonnet, on the card,
                                // next to the numbers it explains.
                                ["ENGINE", layoutTag(getEngine(c.engine))],
                                // How long the car actually is. It is a
                                // real measurement now rather than a
                                // scale factor nobody could read, and it
                                // is the fastest way to tell a pickup
                                // from a supermini on a card.
                                ["LENGTH", c.lengthM.toFixed(2) + " m"],
                                ["PWR", c.power.toFixed(2) + "×"],
                                ["GRIP", c.grip.toFixed(1)],
                                ["BRK", String(c.brake)],
                              ] as const
                            ).map(([k, v]) => (
                              <div key={k}>
                                <div className="grn-label text-[0.7rem]">{k}</div>
                                <div className="grn-display tnum text-sm text-white/85">{v}</div>
                              </div>
                            ))}
                          </div>
                          <div className="grn-label mt-2.5 text-[0.7rem]">
                            {driving ? (
                              <span className="text-sodium-400">Driving now ✓</span>
                            ) : owned ? (
                              <span className="text-emerald-300">Owned — tap to drive</span>
                            ) : toGo > 0 ? (
                              <span className="text-sodium-300">
                                Not for sale — beat{" "}
                                <span className="tnum">{toGo}</span> more{" "}
                                {toGo === 1 ? "legend" : "legends"}
                              </span>
                            ) : affordable ? (
                              <span className="grn-display text-base tracking-normal text-gulf-300">
                                {c.price.toLocaleString()} KD
                              </span>
                            ) : (
                              <span className="text-white/70">
                                {c.price.toLocaleString()} KD · need{" "}
                                <span className="tnum">
                                  {(c.price - garage.kd).toLocaleString()}
                                </span>{" "}
                                more
                              </span>
                            )}
                          </div>
                        </button>
                        {/* The other half of a dealership. A sibling of
                            the card rather than a child, because the
                            card is itself a button and a button inside
                            a button is not markup, it is a fight. */}
                        {owned && (
                          <div className="mt-1 flex items-center justify-between gap-2 px-1">
                            <span className="grn-label text-[0.7rem] text-white/70">
                              Trade-in{" "}
                              <span className="grn-display tnum text-[0.875rem] tracking-normal text-emerald-300">
                                {quote.toLocaleString()} KD
                              </span>
                            </span>
                            {lastCar ? (
                              <span className="grn-label text-[0.7rem] text-white/62">
                                your last car — not for sale
                              </span>
                            ) : (
                              <button
                                onClick={() => {
                                  haptic(HAPTIC.tap, loadSettings().haptics);
                                  if (selling === c.id) {
                                    setSelling(null);
                                    playSfx("ui-confirm", 0.6);
                                    onSellCar(c.id);
                                  } else {
                                    playSfx("ui-tap", 0.5);
                                    setSelling(c.id);
                                  }
                                }}
                                className={`grn-btn tap px-3 py-1 text-[0.75rem] ${
                                  selling === c.id
                                    ? "border-red-400/70 bg-red-500/20 text-red-200"
                                    : "border border-white/15 text-white/60 hover:bg-white/10"
                                }`}
                              >
                                {selling === c.id
                                  ? `SELL FOR ${quote.toLocaleString()} KD — sure?`
                                  : "SELL"}
                              </button>
                            )}
                          </div>
                        )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "performance" && (
            <div key="performance" className="reveal">
              {rampPicker}
              <p className="max-w-2xl text-[0.875rem] leading-6 text-white/74">
                Parts here change how the car drives — most move the spec bars
                above the moment they bolt on. Tap an equipped part to run stock
                in that slot.
              </p>
              {PERFORMANCE_CATS.map(({ cat, label }) => (
                <div key={cat} className="mt-5">
                  <h3 className="grn-label border-b border-white/10 pb-2 text-[0.75rem]">
                    {label}
                  </h3>
                  {cat === "engine" && (
                    // Every other slot is empty until you buy something.
                    // This one never is — the car arrived with an engine
                    // in it — so the shop has to say which, or a player
                    // cannot tell what they are being offered instead of.
                    <p className="mt-2 text-[0.8rem] leading-5 text-white/74">
                      {car.name} came with the{" "}
                      <span className="text-white/80">
                        {stockEngine.name} · {layoutTag(stockEngine)}
                      </span>{" "}
                      — {stockEngine.cylinders} cylinders,{" "}
                      {stockEngine.redlineRpm.toLocaleString("en-US")} rpm. Buy
                      nothing here and that is what you race. Every engine
                      makes the same power on average; where it makes it is
                      the whole decision.
                    </p>
                  )}
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {PARTS.filter((p) => p.cat === cat).map(partCard)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "style" && (
            <div key="style" className="reveal">
              {rampPicker}
              <p className="max-w-2xl text-[0.875rem] leading-6 text-white/74">
                Zero horsepower, maximum presence. Paint and glow apply the
                moment you equip them.
              </p>

              {/* CREW — the one thing here that is not bought.
                  It costs nothing and it is not per-car: found a crew and
                  every machine you own carries its colours on the roof. */}
              <div className="mt-5">
                <h3 className="grn-label border-b border-white/10 pb-2 text-[0.75rem]">
                  CREW · <span className="grn-ar" lang="ar">الفريق</span>
                </h3>
                {draft ? (
                  <div className="mt-3">
                    <CrewBuilder value={draft} onChange={setDraft} size={112} />
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => {
                          const next: Crew = {
                            name: draft.name.trim().slice(0, 24),
                            tag: sanitizeTag(draft.tag),
                            logo: draft.logo,
                          };
                          if (!next.name || !next.tag) return;
                          saveCrew(next);
                          setCrew(next);
                          setDraft(null);
                          haptic(HAPTIC.reward, loadSettings().haptics);
                          playSfx("ui-confirm");
                        }}
                        disabled={!draft.name.trim() || !sanitizeTag(draft.tag)}
                        className="grn-btn grn-btn-primary tap px-6 py-2.5 text-sm disabled:opacity-40"
                      >
                        {crew ? "SAVE COLOURS" : "FOUND THE CREW"} —{" "}
                        <span className="grn-ar" lang="ar">أسس فريقك</span>
                      </button>
                      <button
                        onClick={() => setDraft(null)}
                        className="grn-btn tap border border-white/15 px-5 py-2.5 text-sm text-white/65 hover:bg-white/10"
                      >
                        CANCEL
                      </button>
                    </div>
                    <p className="mt-2 max-w-2xl text-[0.8rem] leading-5 text-white/66">
                      The emblem goes on the roof of whatever you are driving,
                      with the crew&apos;s name under it. A crew car has no
                      sunroof — the panel is not big enough for both.
                    </p>
                  </div>
                ) : crew ? (
                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={teamLogoDataUrl(crew.logo, 160, crew.tag)}
                      alt={`${crew.name} emblem`}
                      className="size-20 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="grn-display truncate text-2xl italic leading-none">
                        {crew.name}
                      </div>
                      <div className="grn-label mt-1 text-[0.7rem] text-sodium-400">
                        [{crew.tag}] · on the roof of every car you own
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setDraft(crew)}
                        className="grn-btn tap border border-white/15 px-4 py-2 text-[0.8rem] text-white/75 hover:bg-white/10"
                      >
                        EDIT COLOURS
                      </button>
                      <button
                        onClick={() => {
                          saveCrew(null);
                          setCrew(null);
                          haptic(HAPTIC.tap, loadSettings().haptics);
                        }}
                        className="grn-btn tap border border-white/15 px-4 py-2 text-[0.8rem] text-white/55 hover:bg-white/10"
                      >
                        RACE SOLO
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <p className="max-w-md flex-1 text-[0.875rem] leading-6 text-white/74">
                      Racing for nobody. Found a crew and its emblem and name
                      go on the roof of every car in this garage — and the
                      same colours are what the lobby publishes when you take
                      it online.
                    </p>
                    <button
                      onClick={() =>
                        setDraft({ name: "", tag: "", logo: { ...DEFAULT_LOGO } })
                      }
                      className="grn-btn grn-btn-primary tap px-6 py-2.5 text-sm"
                    >
                      FOUND A CREW
                    </button>
                  </div>
                )}
              </div>

              {STYLE_CATS.map(({ cat, label }) => (
                <div key={cat} className="mt-5">
                  <h3 className="grn-label border-b border-white/10 pb-2 text-[0.75rem]">
                    {label}
                  </h3>
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {PARTS.filter((p) => p.cat === cat).map(partCard)}
                  </div>
                </div>
              ))}

              {/* Window tint — a slider, not a shelf.
                  Tint is a continuum and everybody has a number they
                  want; three purchasable steps would be a worse answer
                  to the same question. Free, instant, and saved with
                  the car, because tint is bodywork. */}
              <div className="mt-5">
                <h3 className="grn-label border-b border-white/10 pb-2 text-[0.75rem]">
                  WINDOW TINT · تظليل
                </h3>
                <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="grn-label text-[0.7rem] text-white/55">
                      Darkness
                    </span>
                    <span className="grn-display tnum text-xl text-sodium-400">
                      {clampTint(garage.builds[ramp]?.tint)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={clampTint(garage.builds[ramp]?.tint)}
                    onChange={(ev) => onTint(ramp, Number(ev.target.value))}
                    aria-label="Window tint percentage"
                    className="mt-3 w-full accent-sodium-400"
                  />
                  <div className="mt-2 flex justify-between text-[0.7rem] text-white/66">
                    <span>0% · factory glass</span>
                    <span>50% · street legal-ish</span>
                    <span>100% · limo</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
