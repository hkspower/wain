/**
 * صوت وين's bridge — `/api/tts.php` — as this build was told it.
 *
 * Off by default since 15 October: the owner closed the bridge («close
 * bridge»), and `/api/tts.php` was moved off both stages into storage. Every
 * answer is read by the device's own voice. The live builds had already set
 * «none» since 7 October; the default now says the same, so a build that
 * forgets the variable does not ask a door that is gone.
 *
 * Here and not in voice.ts because voice.ts is a client module: the privacy
 * page, rendered at build, has to say whether sentences leave the device, and
 * it cannot read a value out of a client module.
 *
 * History, for whoever opens it again: on in every build from 3 October, each
 * sentence its own request (voice.ts, speakLive), fixed text the server cache
 * paid for once. To turn it back on, reinstall the endpoint first, then build
 * with NEXT_PUBLIC_WAIN_TTS_URL=/api/tts.php. `||` rather than `??`: an unset
 * GitHub Actions variable expands to `""` (wain-ai.ts has the full story).
 */
const configured = process.env.NEXT_PUBLIC_WAIN_TTS_URL || "none";

/** The bridge's URL, or "" when it is off. */
export const TTS_URL = configured.trim().toLowerCase() === "none" ? "" : configured;

/** Whether this build reads answers through the bridge at all. */
export const TTS_BRIDGE_ON = TTS_URL !== "";
