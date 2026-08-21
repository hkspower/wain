"use client";

import {
  LOGO_COLORS,
  LOGO_SHAPES,
  LOGO_SYMBOLS,
  sanitizeTag,
  teamLogoDataUrl,
  type Crew,
} from "@/game/teams";

/**
 * The crew editor — one of them, used in two places.
 *
 * There were two reasons to make this a component rather than leave the
 * form where it was. The obvious one is that the garage now builds a
 * crew too, and a second hand-written copy of "shape, symbol, colours,
 * tag" is a second thing to keep in step. The other is that the two
 * copies were already drifting before the second one existed: the hub's
 * form offered six of the ten colours and only ever set the accent, so
 * half the palette and the whole background colour were unreachable from
 * the only screen that could make a crew.
 *
 * Fully controlled: the parent owns the crew and decides what saving
 * means — locally in the garage, over the socket in the lobby.
 */
export default function CrewBuilder({
  value,
  onChange,
  size = 128,
}: {
  value: Crew;
  onChange(next: Crew): void;
  size?: number;
}) {
  const set = (patch: Partial<Crew>) => onChange({ ...value, ...patch });
  const setLogo = (patch: Partial<Crew["logo"]>) =>
    onChange({ ...value, logo: { ...value.logo, ...patch } });

  const swatches = (
    key: "bg" | "fg",
    label: string
  ) => (
    <div>
      <label className="grn-label text-[0.55rem]">{label}</label>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {LOGO_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setLogo({ [key]: c })}
            aria-label={`${label} ${c}`}
            aria-pressed={value.logo[key] === c}
            className={`size-6 rounded-full border-2 transition ${
              value.logo[key] === c ? "scale-110 border-white" : "border-white/25"
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
      {/* The emblem exactly as the car will wear it — same routine, same
          description, a different number of pixels. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={teamLogoDataUrl(value.logo, size * 2, value.tag || "TAG")}
        alt="crew emblem preview"
        className="shrink-0"
        style={{ width: size, height: size }}
      />
      <div>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[12rem] flex-1">
            <label className="grn-label text-[0.58rem]">Crew name</label>
            <input
              value={value.name}
              onChange={(e) => set({ name: e.target.value })}
              maxLength={24}
              placeholder="Salmiya Street Kings"
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/45 px-3 py-2 text-sm font-semibold outline-none focus:border-gulf-400"
            />
          </div>
          <div className="w-24">
            <label className="grn-label text-[0.58rem]">Tag</label>
            <input
              value={value.tag}
              onChange={(e) => set({ tag: sanitizeTag(e.target.value) })}
              placeholder="SSK"
              className="grn-display mt-1 w-full rounded-lg border border-white/15 bg-black/45 px-3 py-2 text-center text-sm outline-none focus:border-gulf-400"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-start gap-x-5 gap-y-3">
          <div>
            <label className="grn-label text-[0.55rem]">Shape</label>
            <div className="mt-1 flex gap-1.5">
              {LOGO_SHAPES.map((sh) => (
                <button
                  key={sh}
                  type="button"
                  onClick={() => setLogo({ shape: sh })}
                  aria-pressed={value.logo.shape === sh}
                  className={`rounded-md border px-2.5 py-1 text-[0.7rem] capitalize transition ${
                    value.logo.shape === sh
                      ? "border-gulf-400 text-gulf-300"
                      : "border-white/15 text-white/60 hover:border-white/35"
                  }`}
                >
                  {sh}
                </button>
              ))}
            </div>
          </div>
          {swatches("bg", "Field")}
          {swatches("fg", "Accent")}
        </div>

        <div className="mt-3">
          <label className="grn-label text-[0.55rem]">Emblem</label>
          <div className="mt-1 flex flex-wrap gap-1">
            {LOGO_SYMBOLS.map((sym) => (
              <button
                key={sym}
                type="button"
                onClick={() => setLogo({ symbol: sym })}
                aria-pressed={value.logo.symbol === sym}
                className={`rounded-md border px-2 py-1 text-base transition ${
                  value.logo.symbol === sym
                    ? "border-gulf-400 bg-gulf-500/15"
                    : "border-white/10 hover:border-white/30"
                }`}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
