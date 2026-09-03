// The controller, named.
//
// Every binding the engine polls lives here, ONCE, with a label for each
// brand of pad. engine.ts reads its button indices from this table and
// the controls screen reads its glyphs from it, so the screen cannot
// disagree with the hands — which is the whole reason the table exists.
// Before this the indices sat inline in pollGamepad with the names in
// comments beside them, and the game's entire documentation of a
// controller was the words "gamepad supported".
//
// The W3C Standard Gamepad mapping is the same on both brands: index 0
// is the bottom face button whether it is printed A or Cross. So the
// bindings are brand-free and only the LABELS differ, which is why a
// layout is a lookup and not a second table.

export type PadBrand = "playstation" | "xbox" | "generic";

/**
 * Which pad this is, from the string the browser hands over.
 *
 * The USB vendor id is the reliable half — Sony is 054c, Microsoft is
 * 045e — and both Chromium ("Name (STANDARD GAMEPAD Vendor: 054c
 * Product: 0ce6)") and Firefox ("054c-0ce6-Name") carry it. The
 * marketing name is the other half and changes with firmware, so it is
 * the fallback rather than the rule. Anything else is generic: a pad the
 * game cannot name should get the neutral layout, not a guess printed in
 * the wrong brand's glyphs.
 */
export function padBrand(id: string | null | undefined): PadBrand {
  const s = (id ?? "").toLowerCase();
  if (/\b054c\b|vendor:\s*054c|dualsense|dualshock|playstation|\bps[345]\b/.test(s)) return "playstation";
  if (/\b045e\b|vendor:\s*045e|xbox|xinput/.test(s)) return "xbox";
  return "generic";
}

export interface PadAction {
  id: "steer" | "throttle" | "brake" | "nos" | "drift" | "flash" | "horn" | "pause";
  /** What it does, in the player's words. */
  does: string;
  kind: "axis" | "button";
  /** Standard Gamepad index. */
  index: number;
  /** The label on each brand's pad. */
  label: Record<PadBrand, string>;
}

/** Every binding the engine has. Order is the order the screen shows. */
export const PAD_ACTIONS: readonly PadAction[] = [
  { id: "steer",    does: "Steer",             kind: "axis",   index: 0, label: { playstation: "Left stick", xbox: "Left stick", generic: "Left stick" } },
  { id: "throttle", does: "Throttle",          kind: "button", index: 7, label: { playstation: "R2",  xbox: "RT",   generic: "Right trigger" } },
  { id: "brake",    does: "Brake",             kind: "button", index: 6, label: { playstation: "L2",  xbox: "LT",   generic: "Left trigger" } },
  { id: "nos",      does: "NOS",               kind: "button", index: 0, label: { playstation: "✕",   xbox: "A",    generic: "Button 1" } },
  { id: "drift",    does: "Drift / handbrake", kind: "button", index: 1, label: { playstation: "○",   xbox: "B",    generic: "Button 2" } },
  { id: "flash",    does: "Flash to challenge", kind: "button", index: 2, label: { playstation: "□",   xbox: "X",    generic: "Button 3" } },
  { id: "horn",     does: "Horn",              kind: "button", index: 4, label: { playstation: "L1",  xbox: "LB",   generic: "Left bumper" } },
  { id: "pause",    does: "Pause / skip",      kind: "button", index: 9, label: { playstation: "Options", xbox: "Menu", generic: "Start" } },
] as const;

/** The Standard Gamepad index for an action — what pollGamepad reads. */
export const PAD: Record<PadAction["id"], number> = Object.fromEntries(
  PAD_ACTIONS.map((a) => [a.id, a.index])
) as Record<PadAction["id"], number>;

export function padLabel(action: PadAction["id"], brand: PadBrand): string {
  const a = PAD_ACTIONS.find((x) => x.id === action);
  return a ? a.label[brand] : "";
}

/** One row per action, ready to draw. */
export function padLayout(brand: PadBrand): Array<{ action: string; label: string; glyph: string }> {
  return PAD_ACTIONS.map((a) => ({ action: a.does, label: a.label[brand], glyph: a.label[brand] }));
}
