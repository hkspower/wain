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
