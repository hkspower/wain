# Gulf Road Nights on iPhone & Android

The game ships to phones as a native app via [Capacitor](https://capacitorjs.com):
the Next.js static export is bundled inside a real iOS/Android app shell, so it
installs from the App Store / Play Store, runs fully offline, and reaches the
online hub over the network like any other multiplayer game.

Touch controls are already built in — the game detects a coarse pointer and shows
on-screen steering, gas/brake pedals, and Flash / NOS / Horn buttons.

## One-time setup

```bash
npm install
npx cap add ios       # macOS + Xcode only
npx cap add android   # any OS, needs Android Studio
```

`ios/` and `android/` are generated native projects and are git-ignored — treat
them as build output you can regenerate at any time.

## Build & run

```bash
npm run mobile:sync       # static export + copy into both native projects
npm run mobile:ios        # opens Xcode
npm run mobile:android    # opens Android Studio
```

Then press Run in Xcode (simulator or a connected iPhone) or Android Studio.

## Pointing at your hub server

Online play needs the hub reachable from the phone. Build with:

```bash
NEXT_PUBLIC_HUB_WS=wss://hub.yourdomain.com npm run mobile:sync
```

Use `wss://` (TLS) in production — iOS App Transport Security blocks plain
`ws://` by default, and Android blocks cleartext unless explicitly allowed.
Host `server/hub-server.mjs` behind a TLS terminator (Caddy, nginx, Fly.io,
Railway — anything that speaks WebSockets).

## Shipping to the App Store (Apple)

1. Enrol in the [Apple Developer Program](https://developer.apple.com/programs/)
   (US$99/year). You need a Mac with Xcode.
2. In Xcode: set the bundle id to `com.wain.gulfroadnights` (or your own),
   pick your team, and set the version/build numbers.
3. Add the app icon and launch screen in `ios/App/App/Assets.xcassets`.
4. Product → Archive → Distribute App → App Store Connect.
5. In App Store Connect fill in the listing: name, subtitle, screenshots
   (6.7" and 5.5" required), description, keywords, privacy policy URL,
   and the **age rating** questionnaire.
6. Answer the privacy questions honestly — this build collects no personal
   data; the hub stores a display name only, in memory.
7. Submit for review.

## Shipping to Google Play (Android)

1. Create a [Play Console](https://play.google.com/console) account (US$25 once).
2. In Android Studio: Build → Generate Signed Bundle / APK → **Android App
   Bundle**, creating an upload keystore (keep it safe — losing it means you
   can't update the app).
3. Set `versionCode`/`versionName` in `android/app/build.gradle`.
4. Play Console → Create app → upload the `.aab` to internal testing first.
5. Complete the Data Safety form, content rating, and target audience.
6. Roll out to production.

## Notes on performance

- The renderer's adaptive quality already drops bloom and shadows on weak
  hardware; phones typically land in the middle tier. Press **G** (or add a
  settings toggle) to force the lighter mode.
- Consider locking to landscape: set `UISupportedInterfaceOrientations` in
  `ios/App/App/Info.plist` and `android:screenOrientation="sensorLandscape"`
  on the activity in `AndroidManifest.xml`.
- Keep the screen awake during a race with
  [`@capacitor-community/keep-awake`](https://github.com/capacitor-community/keep-awake).

## What can't be automated here

Store submission requires Apple/Google developer accounts, code signing
certificates, and (for iOS) macOS — none of which exist in this repo. Everything
up to "press Run / Archive" is scripted above.
