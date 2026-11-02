# Store privacy answers — draft, for the owner to file

What the Flutter app (and the site) actually send, written so the Google Play
**Data safety** form and Apple's **App Privacy** labels can be filled from it
without guessing. Drafted 1 October from the code and from the live agent's
settings (`agents_get`, `platform_settings.privacy`), not from memory. If either
changes, this changes with it.

## What leaves the device

| What | Where to | When | Kept? |
|---|---|---|---|
| Microphone audio | ElevenLabs (the شوق agent) | only during a call the visitor starts, after the one-time consent and the OS mic prompt | **recorded** (`record_voice: true`), audio and transcript kept with **no expiry** (`retention_days: -1`, `delete_audio: false`, `delete_transcript_and_pii: false`) |
| Typed chat messages | ElevenLabs (same agent, text-only) | only after the one-time consent; opening the chat opens the session | kept the same way |
| A sentence to speak (no identity) | `wainkw.com/api/tts.php`, then ElevenLabs | only when the voice is on and the bridge is configured (its key is empty today, so nothing is sent) | rendered audio cached by sentence; a technical log line without the text or the IP |
| Map tile requests | the tile host (OpenStreetMap today) | when a map is on screen | the host's own logs (IP, tile coordinates) |

Not collected anywhere: location (no permission in either manifest), contacts,
identifiers, advertising ID, analytics SDKs, crash reporting.

On the device only (`shared_preferences` / `localStorage`): voice on/off, which
voice, and — app only — whether the visitor agreed to the conversation notice
(`wain-ai-consent-v1`).

ElevenLabs also runs **topic discovery and sentiment analysis** on conversations,
and the owner can read them in the dashboard; the privacy pages say so.

## Google Play — Data safety (draft)

- **Data collected:** Audio → *Voice or sound recordings*; Messages → *Other in-app
  messages* (the typed chat, and an order's note); Personal info → *Name* and *Phone
  number* (an order sends both, so the business's board can reach the customer).
  An order's name and phone reach the shop, which may count as sharing. Confirm
  against Play's definitions before filing.
- **Shared with third parties?** ElevenLabs processes it on wain's behalf (a service
  provider); Play does not count that as "sharing". Confirm against Play's current
  definitions before filing.
- **Purposes:** App functionality; Analytics (conversations are analysed and read to
  find where شوق goes wrong).
- **Optional?** Yes — every other feature works without a call or a chat.
- **Encrypted in transit:** Yes (wss / https).
- **Deletion request:** **open** — there is no contact address anywhere in the app or
  on the site today. Play asks for a way to request deletion; ElevenLabs can delete a
  conversation, but a visitor has no way to ask. The owner must provide one (an email
  or a form) before this answer can be "Yes".

## Apple — App Privacy (draft)

One store listing covers both iOS builds (`com.wainkw.app`: the Capacitor wrapper and
the Flutter app), so these answers have to match both manifests. The wrapper's
`ios-config/PrivacyInfo.xcprivacy` declares the list below. The Flutter app's
`flutter_app/ios/Runner/PrivacyInfo.xcprivacy` declares only the first two rows and
is behind on the name and phone (open, item 4).

- **Name** and **Phone Number**: collected and **linked** to the user (an order or a
  queue ticket is kept against them). Not used for tracking. Purpose: *App
  Functionality*. The Flutter app's order sends both.
- **Other User Content**: an order's note and the text of a registration. Linked, not
  for tracking, *App Functionality*.
- **Audio Data**: collected, **not linked** (no accounts, no identifiers), not for
  tracking, *App Functionality*.
- **Photos or Videos**: shop photos sent with a registration (wrapper only). Linked,
  *App Functionality*.
- **Precise Location**: a registration's coordinates, read from the device only when
  the owner taps «موقعي» (wrapper only). Declared linked, because the same submission
  carries a phone number. *App Functionality*.
- **Tracking:** none, for any of these.

*Analytics*: ElevenLabs runs topic and sentiment analysis on conversations (see
above). The Flutter manifest declares *Analytics* for audio and other user content,
and so does the Play section. The wrapper's manifest declares *App Functionality*
only. Whether the wrapper build runs the agent is for the owner to confirm (its
build settings are in `.github/workflows/ios.yml`). If it does, the wrapper's audio
and other-content entries need *Analytics* too, and the audit does not check that yet.

## Open, for the owner

1. **A contact for deletion requests and support** (store requirement, and the privacy
   pages should name it).
2. **The workspace's transcript webhook / cloud-storage export.** The agent's
   `workspace_overrides` lists `transcript` events for both; whether a destination is
   configured was not visible from here. If one is, it is another place conversations
   go, and the privacy pages must name it.
3. **A public privacy URL for the app** — the site's `/privacy/` describes the site;
   the app's screen is in the binary. Either publish the app's text or make the site's
   page cover both.
4. **The Flutter app's privacy manifest and the Play data-safety answers.** Both omit
   the name and phone an order sends (`flutter_app/lib/orders/order_api.dart`), and the
   Play section above lists only audio and messages. The wrapper's manifest was
   corrected on 2 November; the Flutter manifest and the Play answers need the same
   correction before the listing is filed. Not changed here: the Flutter app and Play
   were not in the scope of this fix.
