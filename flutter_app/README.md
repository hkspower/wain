# وين — Flutter (native)

A real native Flutter rewrite of the wain site — a separate codebase from
the Next.js export, on request (see the Capacitor iOS wrapper in `../ios/`
and `../capacitor.config.ts` for the *other*, no-rewrite approach this repo
also has).

**First slice, deliberately scoped**: home, category/area browse, search,
and a place detail page. No live map, no شوق call/chat, no hangout sharing,
no order/queue, no business registration, no backend — those are real
features still to build, not cut corners.

## The catalogue is generated, never hand-copied

`lib/data/places.g.dart` and `lib/data/categories.g.dart` are produced by
`../scripts/gen-flutter-catalogue.mjs`, which bundles the real
`src/lib/places.ts`/`place-kit.ts` with esbuild — the same trick
`scripts/audit-places.mjs` and the MCP server use — so this app's data can
never quietly drift from the web site's. Re-run after any catalogue edit:

```
npm run flutter:catalogue
```

Everything else under `lib/` — the models, the theme, the screens, the
Arabic count-agreement helper — is hand-written Dart with no code sharing
with the TypeScript site (Dart and TypeScript cannot share code directly),
kept faithful to the same rules by hand instead: `lib/data/text_kit.dart`'s
`countAr` is a line-for-line port of `countAr` in `place-kit.ts`, because
this exact class of bug (Arabic 1/2/3–10/11+ agreement written by hand and
gotten wrong) is recorded in the main `CLAUDE.md` as having happened three
times already on the web side.

## Running it

Needs the Flutter SDK (this was built and tested against stable 3.47.5).

```
flutter pub get
flutter analyze
flutter test
flutter run -d chrome   # fastest loop; no Android/iOS SDK needed
flutter run             # a connected device or simulator
```

`android/` and `ios/` are committed (small — a few hundred KB of project
config, not generated build output) so the app can be opened in Android
Studio or Xcode without re-scaffolding. `build/` and `.dart_tool/` are
gitignored, same as any Flutter project.

## What was actually verified, and what wasn't

This was built inside a sandboxed environment with no Android SDK and no
Xcode reachable (`dl.google.com`, where the Android SDK is fetched from, is
blocked the same way several other hosts are documented as blocked
elsewhere in this repo's `CLAUDE.md`). What *was* verified here, for real:

- `flutter analyze` — clean, 0 issues.
- `flutter test` — 8 assertions, including a real vertical-overflow bug in
  the home screen's category rail that `flutter test` caught and that was
  then fixed (not silenced) — see the `SizedBox`/`maxLines` fix in
  `lib/screens/home_screen.dart`.
- `flutter build web --release` — a real, complete compiled build, since
  web is the one target that needs no extra SDK. This is not the shipping
  target; it exists to prove the whole app graph actually compiles.

Android and iOS builds were **not** run here — say so plainly rather than
claim more than was checked, the same principle the iOS/Capacitor section
of the main `CLAUDE.md` already follows for its own unverified CI steps.

## Building an APK — `.github/workflows/android-flutter.yml`

`dl.google.com` (the Android SDK's only distribution host) is blocked from
this sandbox, so an APK cannot be built here. GitHub Actions' `ubuntu-latest`
runners ship the Android SDK preinstalled, so CI is the actual build path —
the same shape `ios.yml` already uses for Xcode.

Two jobs, dispatched by hand (`workflow_dispatch`):

- **`build-debug`** — always runs. Regenerates the catalogue and fails if it
  differs from what's committed (the same drift check `content:check` does
  for `docs/content.md`), then `flutter build apk --debug` — Gradle's
  auto-generated debug keystore signs it, so no secrets are needed. Produces
  an installable, unsigned-for-release `app-debug.apk` as a workflow
  artifact. This is the one to dispatch to prove the app still builds.

- **`build-release`** — only runs once four repository items are set
  (Settings → Secrets and variables → Actions), the same pattern
  `DEPLOY_SECRET`/the Apple secrets already use:

  - `ANDROID_KEYSTORE_BASE64` — a release keystore (`.jks`/`.keystore`),
    base64-encoded: `base64 -i release.keystore | pbcopy`.
  - `ANDROID_KEYSTORE_PASSWORD` — the keystore's own password.
  - `ANDROID_KEY_ALIAS` — a **variable**, not a secret; an alias name isn't
    sensitive on its own, the same reasoning `APPLE_TEAM_ID` already uses.
  - `ANDROID_KEY_PASSWORD` — the signing key's password (often the same as
    the keystore password, but not required to be).

  It writes `android/key.properties` from them at build time and deletes
  both the keystore and that file again before the job ends, whether the
  build succeeded or not. The matching Gradle change is in
  `android/app/build.gradle.kts`: a conditional `signingConfigs.release`
  that only exists when `key.properties` is present, falling back to the
  debug keystore otherwise — so `build-debug` (and any local
  `flutter build apk --debug`) is unaffected by this job existing at all.
  Produces both `app-release.apk` and `app-release.aab` (the format the Play
  Store actually wants) as artifacts.

Nobody has a release keystore for this app yet, so `build-release` has never
run — same honest state `ios.yml`'s `build-signed` was in before the Apple
secrets were added.
