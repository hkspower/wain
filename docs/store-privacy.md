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
  messages* (the typed chat).
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

- **Audio Data** and **Other User Content**: collected, **not linked** to the user
  (no accounts, no identifiers), **not used for tracking**; purposes *App
  Functionality* and *Analytics*. `ios/Runner/PrivacyInfo.xcprivacy` declares the same.
- **Location:** not collected.

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
