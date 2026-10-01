# Testing the iOS app for real

Two kinds, both run by the dispatch-only jobs of
`.github/workflows/flutter-ci.yml` (Actions → «Flutter app (analyze, test, web
build)» → Run workflow, on `claude/wainkw-design-issues-2bggdi`; tick
**testflight** for the second):

| | needs | what it proves |
|---|---|---|
| **Simulator** — always | nothing | the app on the newest iOS, on a large and a small iPhone: home → /find → the consent sheet (declined, so no call), سالم's consent gate, search with real map tiles → a place → the iOS back swipe, explore's filter, five routes laid out without overflow, and the microphone permission compiled in. Screenshots of each screen in the `ios-sim-large` / `ios-sim-small` artifacts. |
| **TestFlight** — tick «testflight» | the setup below | a signed build on **your iPhone**, through Apple's TestFlight app |

The simulator never agrees to the AI consent and never places a call: either
would open a real, recorded ElevenLabs conversation from a CI runner. The call
is what your iPhone is for.

## One-time setup for TestFlight (about 15 minutes)

Everything here is on Apple's side and only the account holder can do it. Nothing
secret goes into a chat or a commit — only into GitHub's settings.

1. **Your Team ID.** developer.apple.com → Account → Membership details → Team ID
   (10 characters). In GitHub: Settings → Secrets and variables → Actions →
   **Variables** → `APPLE_TEAM_ID`. (`ios.yml` uses the same variable; if it is
   already set, leave it.)

2. **The app record.** appstoreconnect.apple.com → Apps → **+** → New App:
   platform iOS, bundle ID **`com.wainkw.app`**, primary language Arabic, SKU
   anything (e.g. `wain-ios`). The name must be unique on the whole App Store;
   if «وين» is taken, add a word to it — it can be changed later, the bundle ID
   cannot.

   If `com.wainkw.app` is not in the bundle ID list, register it first:
   developer.apple.com → Certificates, IDs & Profiles → Identifiers → **+** →
   App IDs → App, explicit, `com.wainkw.app`, no extra capabilities.

   This record fixes `com.wainkw.app` to whichever build uploads first — the
   Flutter app, from this workflow.

3. **An App Store Connect API key.** App Store Connect → Users and Access →
   Integrations → App Store Connect API → Team Keys → **+**. Name it e.g.
   `wain CI`, role **Admin**. Admin is needed because the workflow signs with
   Apple's cloud-managed certificates, so no `.p12` or profile has to be made
   by hand. Download the `.p8` — Apple lets you do that **once**. Note the
   **Key ID** beside it and the **Issuer ID** at the top of the page.

4. **Three secrets** (Settings → Secrets and variables → Actions → Secrets):

   | secret | value |
   |---|---|
   | `ASC_KEY_ID` | the Key ID |
   | `ASC_ISSUER_ID` | the Issuer ID |
   | `ASC_KEY_P8_BASE64` | on a Mac: `base64 -i AuthKey_XXXXXXXXXX.p8 \| pbcopy`, then paste |

   Then delete the downloaded `.p8` from Downloads, or keep it somewhere
   private: it can sign and upload builds for your whole team. Revoke it in the
   same screen if it ever leaks.

5. **Yourself as a tester.** App Store Connect → the app → TestFlight →
   Internal Testing → **+** → a group (e.g. «الفريق»), add your Apple ID, and
   switch on automatic distribution. On the iPhone, install **TestFlight** from
   the App Store and sign in with the same Apple ID.

## Each build

Run the workflow with **testflight** ticked. When the job is green its summary
reads «TestFlight: uploaded com.wainkw.app 0.1.0 (N)». Apple then processes the
build (usually 5–30 minutes) and the TestFlight app offers it. Builds are
internal-only (`testFlightInternalTestingOnly`), so there is no Beta Review;
each one lasts 90 days.

If the TestFlight job is skipped, its summary names what is not configured.

## What to check on the iPhone

The things no simulator and no session here can prove:

- **A شوق call**: the consent sheet once, then iOS's microphone prompt, then
  she answers and hears you. Loudness on the speaker and on the earpiece.
- **The microphone refused**: deny it in Settings → وين, call again — the sheet
  should say the microphone is blocked, not ring forever.
- **سالم's typed chat** after agreeing to the consent line.
- **The map** with real tiles, pinch and drag, and a pin opening its place.
- **Back**: swipe from the **right** edge (the app is right-to-left) out of a
  place, /find and سالم.
- **A forwarded invitation**: open a `wainkw.com/places/…?when=…` link from
  WhatsApp on the phone.
- **Text size**: Settings → Display → Text Size at its largest; cards should
  grow, not cut off.
- **A call through the lock screen**: start a call with شوق, lock the phone,
  keep talking; unlock — the call is still on, with the green bar if the sheet
  was put away.
- **Put the call away**: the arrow at the top of the call sheet; the green bar
  brings it back. Switch apps mid-call and come back.
- **A Bluetooth headset** (or AirPods) during a call.
- **Airplane mode**: the strip «ما فيه إنترنت» appears; places and search still
  work; a call says at once that it needs the internet.
- **«الطريق»** on a place opens Apple Maps with directions.

## When it fails

- **Archive fails on signing** («No profiles», «requires a development team»):
  `APPLE_TEAM_ID` is wrong, or the key is not Admin. Cloud signing also needs
  the account's agreements accepted in App Store Connect → Business.
- **Upload says the bundle ID has no app record**: step 2.
- **«The bundle version must be higher»**: a run that already uploaded was
  re-run. Dispatch a new run; the build number is the run number.
- **The build is «Invalid» by email after upload**: the email names the missing
  key; `test/ios_target_test.dart` holds the ones already known (microphone,
  camera, export compliance, an icon without alpha).
