/**
 * Numbers inside the game's English text.
 *
 * `n.toLocaleString()` with no locale does not mean "format this number".
 * It means "format this number however the browser is set", and the
 * browser this game was built for is a phone in Kuwait. On an `ar-KW`
 * device — measured, not assumed — it returns:
 *
 *   (1600).toLocaleString()   ->  ١٬٦٠٠
 *   (34000).toLocaleString()  ->  ٣٤٬٠٠٠
 *
 * which then lands inside an English sentence: "١٬٦٠٠ KD · need ٧٠٠
 * more". Worse, it lands there NEXT to a figure that stays Western,
 * because the one call in the garage that named its locale asked for
 * `en-US` and got `7,000 rpm`. Same card, two digit systems, and which
 * of them you see depends on a setting the game never reads.
 *
 * The Arabic half of the game has never had this problem, because it
 * converts on purpose: `arabicNumber()` in world.ts walks the digits and
 * writes ٠١٢٣٤٥٦٧٨٩ into the way-markers and the pump board. This is the
 * same decision made on the English side instead of left to chance.
 *
 * `en-US` rather than `en-GB` only because src/lib/gameSite.ts already
 * chose it, and its comment already argues the case for naming a locale
 * at all. The two spell every number in this game identically; what
 * matters is that there is one answer rather than two.
 */
const NUMBER_LOCALE = "en-US";

/** A number for an English run: Western digits, grouped, always. */
export const num = (n: number): string => n.toLocaleString(NUMBER_LOCALE);
