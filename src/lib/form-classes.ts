/**
 * One definition of what a form control looks like.
 *
 * The public registration form and the admin editor had grown their own copies
 * of the same class string, and had already drifted: different vertical
 * padding, one with a shadow and one without, one a size smaller. Two forms in
 * the same product that quietly disagree.
 *
 * Plain strings, so there is no runtime cost — Tailwind still sees the literals
 * at build time because they are written out in full here.
 */

const FIELD_BASE =
  "w-full rounded-xl border border-line-control bg-white text-ink-800 shadow-sm outline-none " +
  "transition placeholder:text-ink-500/50 focus:border-sea-400 focus:ring-4 focus:ring-sea-100";

/** Public forms: roomy enough to fill in on a phone. */
export const fieldClass = `${FIELD_BASE} px-3 py-2.5`;

/**
 * Admin: the same control, a size down, for dense data entry — with a mouse.
 * Under a finger it is 16px like every other field: iPhone Safari zooms the
 * page into any field set smaller when it takes focus, and leaves it zoomed
 * (8 October; the 16px floor is the rule audit:mobile holds the public pages
 * to — the admin board renders only after sign-in, where no audit reaches).
 */
export const fieldDenseClass = `${FIELD_BASE} px-3 py-2 text-sm pointer-coarse:text-base`;

export const labelClass = "mb-1.5 block text-sm font-semibold text-ink-700";
export const hintClass = "mt-1 text-xs text-ink-500";
