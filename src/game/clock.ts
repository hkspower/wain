// Kuwait's clock, in one place.
//
// The game has two clocks that both claim to be Kuwait's: the analogue
// dial in the corner of the HUD, and — since the world can be told to
// run on real time — the sun in the sky. Two implementations of "what
// time is it in Kuwait" is one too many, and the failure mode is the
// quiet one: the dial says a quarter past five while the sun is
// somewhere else, and neither is obviously wrong on its own.
//
// THE ZONE IS NAMED, NOT ASSUMED. A clock that reads "Kuwait" and
// renders whatever the machine's own timezone happens to be is right for
// one player in the world and wrong for everyone else, and it looks
// correct while doing it. Kuwait is UTC+3 all year and has never
// observed daylight saving, but that is a fact about today rather than a
// guarantee, so the offset is asked for by IANA zone rather than typed
// in as three hours. If the country ever changes its mind, both the dial
// and the sun follow without anybody editing a constant.

export const KUWAIT_ZONE = "Asia/Kuwait";

/** Milliseconds to add to UTC to get the wall-clock time in `zone`. */
export function zoneOffsetMs(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const f: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") f[p.type] = Number(p.value);
  // hour comes back as 24 at midnight under hour12:false in some
  // engines, which Date.UTC would roll into the next day correctly
  // anyway — but the modulo makes the intent explicit.
  const asUTC = Date.UTC(f.year, f.month - 1, f.day, f.hour % 24, f.minute, f.second);
  // The formatted parts carry no milliseconds, so compare against the
  // instant truncated to the second or the offset comes out with the
  // current millisecond baked into it.
  return asUTC - (at.getTime() - at.getMilliseconds());
}

/** The moment, in Kuwait. */
export function kuwaitTime(at: Date = new Date()): Date {
  return new Date(at.getTime() + zoneOffsetMs(KUWAIT_ZONE, at));
}

/**
 * The hour in Kuwait as a fraction, 0 at midnight through 23.999.
 *
 * This is the number the sky is a function of — see setTimeOfDay — so it
 * carries seconds and milliseconds rather than rounding to the minute:
 * an hour that steps once a minute makes the sun step with it, and a sky
 * that jumps sixty times an hour is worse than one a minute out.
 */
export function kuwaitHours(at: Date = new Date()): number {
  const k = kuwaitTime(at);
  return (
    k.getUTCHours() +
    k.getUTCMinutes() / 60 +
    k.getUTCSeconds() / 3600 +
    k.getUTCMilliseconds() / 3600000
  );
}
