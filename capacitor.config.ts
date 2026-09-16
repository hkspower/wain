import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Wraps the static export (`out/`) as a native iOS shell. No `server.url` —
 * the WebView loads the bundled files, not the live site, so the app works
 * with no network for anything already in `out/`: every place page, /search,
 * /explore, the icons, the fonts.
 *
 * The one thing that changes shape here is صوت وين. `voice.ts` defaults
 * `TTS_URL` to the relative path `/api/tts.php`, correct on the web because
 * the page and the bridge share an origin. A bundled app has no origin to
 * share — the WebView's own scheme has nothing at that path, so a relative
 * fetch would 404. `voice.ts` already treats a 404 as "bridge not configured"
 * and falls back to the browser's own speech synthesis, so this would not
 * crash — it would just always take the fallback, in an app built specifically
 * to carry the feature. `.github/workflows/ios.yml` sets
 * NEXT_PUBLIC_WAIN_TTS_URL to the absolute wainkw.com URL for exactly this
 * build, which is the override voice.ts already reads first. Same mechanism
 * a staging build would use to point at a different bridge; nothing new.
 *
 * appId is a placeholder and load-bearing the moment it ships: App Store
 * Connect fixes the bundle id to whatever the first TestFlight build declares.
 * Change it here before that upload, never after.
 */
const config: CapacitorConfig = {
  appId: "com.wainkw.app",
  appName: "وين",
  webDir: "out",
  ios: {
    contentInset: "automatic",
  },
};

export default config;
