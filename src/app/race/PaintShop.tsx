"use client";

import { useMemo } from "react";
import {
  EXCLUSIVE_CATS,
  GarageState,
  PAINT_COLORS,
  PARTS,
  Part,
  buildOf,
  getCar,
} from "@/game/mods";
import { IconPaint } from "./Icons";
import { num } from "@/game/format";

/**
 * The painter's picker.
 *
 * A side panel, not the garage. Rendering keeps going under the pause,
 * so the car stays on screen in the bay and repaints in front of you as
 * you tap — which is the whole point of driving to a painter rather than
 * opening a menu. It sells nothing the garage does not: the same paint
 * and finish parts at the same prices, bought through the same callback,
 * so a colour bought here is owned there and nobody pays for one twice.
 *
 * Square, white and bold like every other read-this box in the game;
 * the Arabic inside the tracked header is wrapped so it is set as
 * Arabic, not prised apart.
 */
interface Props {
  garage: GarageState;
  onPick(p: Part): void;
  onClose(): void;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

export default function PaintShop({ garage, onPick, onClose }: Props) {
  const car = getCar(garage.car);
  const build = buildOf(garage, garage.car);
  const paints = useMemo(() => PARTS.filter((p) => p.cat === "paint"), []);
  const finishes = useMemo(() => PARTS.filter((p) => p.cat === "finish"), []);
  const equipped = (p: Part) =>
    EXCLUSIVE_CATS.has(p.cat) && build.equipped[p.cat as keyof typeof build.equipped] === p.id;
  const owned = (p: Part) => build.owned.includes(p.id);
  const can = (p: Part) => owned(p) || garage.kd >= p.price;
  const current = paints.find(equipped);

  return (
    <div className="grn-info absolute bottom-24 right-4 top-20 z-[24] flex w-[22rem] flex-col p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="grn-info-key flex items-center gap-2">
          <IconPaint size={16} /> PAINT SHOP · <span className="grn-ar" lang="ar">صبغ سيارات</span>
        </div>
        <div className="tnum text-sm">{num(garage.kd)} KD</div>
      </div>
      <div className="grn-info-rule my-3" />
      <div className="text-sm">
        {car.name} · <span lang="ar">{car.ar}</span>
      </div>

      <div className="grn-info-key mt-3">
        COLOUR · <span className="grn-ar" lang="ar">اللون</span>
      </div>
      <div className="mt-2 grid grid-cols-6 gap-2">
        {paints.map((p) => {
          // The factory chip is whatever this machine left the lot in.
          const color = p.id === "paint-white" ? car.color : PAINT_COLORS[p.id];
          const eq = equipped(p);
          const own = owned(p);
          return (
            <button
              key={p.id}
              data-paint={p.id}
              disabled={!can(p)}
              onClick={() => onPick(p)}
              className={`relative size-10 border-2 border-black ${
                eq ? "outline outline-[3px] outline-offset-2 outline-black" : ""
              } ${can(p) ? "" : "opacity-40"}`}
              style={{ backgroundColor: hex(color) }}
            >
              {!own && (
                <span className="absolute inset-x-0 bottom-0 bg-black/75 text-center text-[9px] leading-3 text-white">
                  {p.price}
                </span>
              )}
              {own && !eq && (
                <span className="absolute bottom-0 right-0 bg-black px-0.5 text-[9px] leading-3 text-white">✓</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-2 text-xs">
        {current ? (
          <>
            {current.name} · <span lang="ar">{current.ar}</span>
          </>
        ) : (
          <>
            Factory Finish · <span lang="ar">صبغة الوكالة</span>
          </>
        )}
      </div>

      <div className="grn-info-key mt-4">
        FINISH · <span className="grn-ar" lang="ar">اللمعة</span>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {finishes.map((p) => {
          const eq = equipped(p);
          return (
            <button
              key={p.id}
              data-finish={p.id}
              disabled={!can(p)}
              onClick={() => onPick(p)}
              className={`flex items-baseline justify-between border-2 border-black px-2.5 py-1.5 text-left text-xs font-bold ${
                eq ? "bg-black text-white" : can(p) ? "" : "opacity-40"
              }`}
            >
              <span>
                {p.name} · <span lang="ar">{p.ar}</span>
              </span>
              <span className="tnum">{owned(p) ? "✓" : `${num(p.price)} KD`}</span>
            </button>
          );
        })}
      </div>

      <button onClick={onClose} className="mt-auto border-2 border-black px-2.5 py-1.5 pt-1.5 text-xs font-bold">
        ESC · DRIVE OFF · <span lang="ar">خلاص</span>
      </button>
    </div>
  );
}
