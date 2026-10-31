import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Wraps the static export (`out/`) as a native iOS shell. No `server.url` —
 * the WebView loads the bundled files, not the live site, so the app works
 * with no network for anything already in `out/`: every place page, /search,
 * /explore, the icons, the fonts.
 *
 * A bundle has no origin, so every same-origin default is wrong here: a relative
 * `/api/...` would resolve against the WebView's own scheme and 404.
 * `.github/workflows/ios.yml` therefore builds with NEXT_PUBLIC_WAIN_BACKEND
 * set to the absolute https://www.wainkw.com/api/wain.php. The voice bridge is
 * off by default now (tts-bridge.ts, closed 15 October 2026), so the app reads
 * answers with the phone's own voice and needs no TTS URL. If the bridge is
 * ever reinstalled, this build must be given an absolute NEXT_PUBLIC_WAIN_TTS_URL,
 * because the relative path would 404 inside the WebView.
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
