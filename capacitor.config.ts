import type { CapacitorConfig } from "@capacitor/cli";

// Gulf Road Nights — native iOS/Android shell. The game is the exported
// static web build (`NEXT_OUTPUT=export npm run build` → `out/`), loaded
// from the app bundle, so it runs fully offline.
const config: CapacitorConfig = {
  appId: "com.wain.gulfroadnights",
  appName: "Gulf Road Nights",
  webDir: "out",
  // The online hub needs cleartext only if you point it at a plain ws://
  // host during development; ship wss:// in production.
  server: { androidScheme: "https" },
  android: {
    backgroundColor: "#05070f",
  },
  ios: {
    backgroundColor: "#05070f",
    contentInset: "never",
  },
};

export default config;
