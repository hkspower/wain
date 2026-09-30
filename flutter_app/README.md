# وين — Flutter (native)

The native app for Android, iOS and the web. A separate codebase from the
Next.js export — Dart cannot import TypeScript — built so that **what the two
disagree about is impossible by construction**: everything that is data is
generated from the site, and everything that is logic was ported and then
replayed against the site's own answers.

```
flutter pub get
flutter analyze
flutter test            # 340+ tests; the parity suites replay the web's answers
flutter run -d chrome   # fastest loop; no Android SDK or Xcode needed
flutter build web --release --no-web-resources-cdn   # no gstatic fetch
```

Needs the Flutter SDK (built and tested against stable 3.47.5). Nothing is
pre-installed on `PATH` in the cloud sandbox: `/opt/flutter/bin/flutter`.

## What is in it

| Route | Notes |
|---|---|
| `/` | skyline hero, the «إلى وين؟» dial, featured rail, how it works |
| `/find` | شوق's call on top, a typed conversation with her below |
| `/search` | the ranked engine, filters by kind, map, hangout panel, voice toggle |
| `/explore` | category chips + filter + grid |
| `/places/:slug` | hero, facts, invitation banner, «رسّلها للربع», map, similar places |
| `/salem` | the typed chat — real place cards in the transcript, no navigation |
| `/about` `/privacy` `/add` `/404` | copy written for the app (see below) |

شوق's **call** is the official `elevenlabs_agents` SDK (WebRTC/LiveKit) behind
an `AgentSession` interface; her **typed chat** is the wire protocol as a plain
WebSocket (`lib/ai/salem_chat.dart`), the same call the web made for the same
reason — the SDK's audio stack is 148KB you do not need to type a sentence.
The call lives **above the router** (`main.dart`), because `open_place` is a
route change and a call the page owned would be killed by its own tool.

## Generated, never hand-copied

| File(s) | Generator | Source |
|---|---|---|
| `lib/data/places.g.dart`, `categories.g.dart` | `npm run flutter:catalogue` | `src/lib/places.ts` (every field) |
| `lib/theme/tokens.g.dart` | `npm run flutter:tokens` | `src/app/theme.css` |
| `lib/data/search_data.g.dart`, `test/fixtures/search_parity.json` | `npm run flutter:search` | `src/lib/search.ts` |
| `test/fixtures/kit_parity.json` | `npm run flutter:fixtures` | `place-kit`, `voice-lines`, `hangout` |
| `assets/art/**`, `lib/theme/art_index.g.dart` | `npm run flutter:art` | the React drawings, rendered in Chromium |

`npm run audit:flutter` (part of `npm run scan`) re-renders each with `--check`
and fails if any differs — a place added on the web with no regeneration would
otherwise ship an app one place short, and nothing on either side would error.

**Do not run `dart format` over `*.g.dart`** — it reformats them and the audit
reads that as staleness. Format the rest: `find lib test -name '*.dart' !
-name '*.g.dart' | xargs dart format`.

## Ported by hand, and how each is proved

* **Search** (`lib/data/search.dart`) — BM25, the synonym expansion, the
  declitic handler, the fuzzy fallback, the «elsewhere in Kuwait» guard.
  `test/search_parity_test.dart` replays **197 queries** and demands the same
  documents, in the same order, with the same scores (1e-9) and the same
  matched terms. Two JavaScript behaviours had to be reproduced on purpose:
  `Array#sort` is stable and Dart's `List#sort` is not, and floating-point sums
  depend on Map iteration order, so nothing here uses a hash-ordered collection.
* **Hangout planner** (`lib/share/hangout.dart`), count agreement, distances,
  place variants, speech preparation — `test/kit_parity_test.dart` against 28
  instants × 7 places × 8 times. Kuwait is UTC+3 all year; the fixtures are
  generated under a different `TZ` and the suite passes regardless of the
  device's own zone.
* **The call** — `test/call_controller_test.dart`: the phase is what is TRUE
  (ringing until the session really opens), a late event from a hung-up session
  cannot resurrect it, every failure is a sentence, and the tool result strings
  the agent's prompt was tuned against are asserted verbatim.
* **The typed chat** — `test/salem_chat_test.dart` against a real WebSocket
  server on localhost that speaks the protocol.
* **Voice** — `test/voice_service_test.dart`: clips → bridge → device voice; a
  404/503/403 is remembered, a timeout/5xx/429 is not; an error page wearing a
  200 is rejected.

Each suite was confirmed able to go red by breaking the code it guards.

## Where it deliberately differs from the site

* **About.** The site's third card says «نرتّب الأماكن حسب قربها من موقعك» —
  not true of this app, which never reads your position. It says what the app
  does instead.
* **Privacy** is written for this app, not copied. The site's talks about
  cookies, a sandboxed map frame, browser speech recognition and Local Storage.
  This one describes tile requests, a WebRTC call, a share sheet and platform
  permissions. Overstating is the same defect as denying.
* **`/add`** says the back end is not connected instead of showing a form whose
  button does nothing. `supabaseEnabled` is false on the web too; order and
  queue panels render nothing (0 of 52 places satisfy either).
* **Typed chat** is سالم's: his name, photo and `tts.voice_id` override, as
  the web is since commit `ba0ae8ce` (see the root `CLAUDE.md`). The agent
  behind it is still شوق's, so she may introduce herself by her own name; that
  tension is accepted. His voice id is also used by the mid-call
  «🔊 بصوت سالم» swap.
* **Voice is off until switched on**, as on the web.
* **Location is never requested.** No permission in either manifest.

## What was verified here, and what was not

Verified in the authoring sandbox, for real: `flutter analyze` clean, the full
test suite, and `flutter build web` — served and driven with Chromium at 390px
(`/`, `/find`, `/explore`, a place, an invitation, `/search?q=قهوة`, `/privacy`).

**Not verified by anything here:**

* An Android or iOS **binary** — `dl.google.com` (the Android SDK) is refused
  at CONNECT by the sandbox, and there is no Xcode. `flutter-ci.yml` and
  `android-flutter.yml` are written from the docs, not from a passing run.
* A real **شوق call** (microphone + the ElevenLabs session): `api.elevenlabs.io`
  is refused. The controller is tested against a fake session, the chat against
  a local socket. A call on a real phone closes it.
* Real **map tiles**: `tile.openstreetmap.org` is refused, so the map was seen
  pins-only. The tile URL and attribution follow `map-tiles.ts`.
* Emoji in the web build (👍 on the invitation button): built with
  `--no-web-resources-cdn`, which has no emoji fallback font. Native platforms
  render it from the system.
* `ios/Runner/PrivacyInfo.xcprivacy` was added to the Xcode target by editing
  `project.pbxproj` with anchored inserts; Xcode has not opened it.

## Identity

`applicationId` / bundle id is **`com.wainkw.app`** — the Capacitor wrapper's
id, so a store listing is one app whichever build produced it. As the root
`CLAUDE.md` says of that id: App Store Connect fixes it at the first upload.
The Kotlin namespace stays `com.wainkw.wain` (it names a source directory, not
an identity).

## Getting the Android APK

Dispatch `.github/workflows/android-flutter.yml` on the branch and download
`wain-android-sideload` (a debug-signed release build, installable by sideloading)
or `wain-android-debug` from the run's Artifacts. It cannot be built in the
Claude sandbox: the Android SDK host is refused there. A Play Store build needs
the four `ANDROID_*` signing secrets that `build-release` checks for.
