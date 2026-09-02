# Wain? — وين؟

**Wain** (وين, "where?" in Kuwaiti Arabic) answers the eternal group-chat question: **wain nrooh? — where shall we go?**

A modern place-discovery app for Kuwait: curated landmarks, food, beaches, shopping, culture, and family spots — each with highlights, the best time to visit, and a price level.

## 🏁 Gulf Road Nights — ليالي شارع الخليج

A built-in **Kuwait Xtreme Racer** game at [`/race`](http://localhost:3000/race): Tokyo-Xtreme-Racer-style midnight highway battles on a 7.3 km lap of the real **Gulf Road** — south along the corniche from the Kuwait Towers past Green Island, the Salmiya marina, and the Scientific Center to Ras Al-Ard, then back north through Hawally and the city skyline (Al Hamra, Liberation Tower, the striped water towers).

- **Drive**: `W/↑` accelerate, `S/↓` brake, `A`/`D` steer, `Space` drift, `N` NOS, `Esc` pause, `M` mute, `V` voices, `G` glow fx
- **Controller**: plug in any standard gamepad — left stick steers (with deadzone + response curve), `RT`/`LT` drive, `A` NOS, `B` drift, `X` flash, `LB` horn, `Start` pauses (or skips the intro film)
- **Drift**: hold `Space` while turning to kick the tail out — keep the throttle in to sustain the slide, counter-steer to catch it. Angle × speed pays style points, banked as bonus XP when you win the battle (a wall hit voids the run)
- **Voices**: rivals speak Kuwaiti dialect lines (battle intros, gloats, concessions) through the browser's Arabic speech voices — each character has their own pitch and pace, from Abu Shanab's cheerful jab to the ghost's slow rasp
- **Battle**: catch a rival and press `F` to flash your headlights — after the stake is agreed, a short slow-motion intro film pans the rival's machine before the green flag (tap to skip; reduced-motion players go straight to the flag). The trailing car bleeds SP (Spirit Points); empty the rival's bar to win
- **Roster**: eight street legends from Salmiya to Doha and Bayan, ending with the boss, *Shabah Al-Khaleej* (شبح الخليج)
- **Paintwork**: the player car's lacquer reflects the actual world around it — a live low-res cube probe rides with the car, so streetlights, towers and neon sweep across the clearcoat as you drive. Streetlights also drag wet-look reflections down the asphalt. The probe is on in High/Auto quality and off in Balanced/Battery (Settings ⚙), and `G` toggles the whole fx stack
- **Garage**: three rooms — Showroom, Performance, Style — with a live spec panel (power, real top speed, brakes, grip) that moves the moment a part bolts on
- **Machines**: three body silhouettes — the sedan, the **Zeta 300** long-nose fastback wedge (flush light bar, full-width tail band, hood slats — golden-era JDM), and the **Kaiju R** coupe (four round tail lights, boxed fender flares, hood bulge, factory wing). Supercars wear the wedge; two rivals and the boss bring their own
- Progress is saved locally; beat all eight to become **King of Gulf Road** 👑

### Online Hub — تجمع شارع الخليج

A shared multiplayer cruise at [`/hub`](http://localhost:3000/hub): pick a driver name and car colour, see who's online, chat in the diwaniya, and check the session's best-lap leaderboard — then **Enter the Cruise** to drive the same midnight Gulf Road with everyone else (other drivers appear live in-world with name tags).

The hub is backed by a tiny self-hostable WebSocket server:

```bash
npm run hub          # starts the hub server on ws://localhost:8787
```

Point clients elsewhere with `NEXT_PUBLIC_HUB_WS=wss://your-server:8787` at build time (and `HUB_PORT` for the server). State is in-memory — restarting clears the leaderboard. Battles stay single-player; the cruise, chat, and lap times are shared.

Want it as a desktop / Steam PC build? See [`desktop/README.md`](desktop/README.md) for the Electron + Steamworks packaging guide.

Prefer a **native engine build**? Two complete code-only ports live alongside the web game:

- [`unreal/`](unreal/README.md) — **Unreal Engine 5.4** C++ project: the same spline, handling constants and battle rules, with Lumen GI/reflections, virtual shadow maps, TSR, real per-lamp spot lights, and gamepad bindings. No binary assets — open the `.uproject` and press Play.
- [`unity/`](unity/README.md) — Unity 6 + URP port with the mobile tier.

### Background music (optional)

Generate the two soundtrack loops with the ElevenLabs Music API:

```bash
ELEVENLABS_API_KEY=sk_... node scripts/generate-music.mjs
```

They land in `public/music/` and the game crossfades between them —
a slow synthwave cruise theme, and a driving battle theme that takes over
the moment a fight starts. Without them the game plays a procedural synth
score instead, so it is never silent. `B` toggles music in-game.

### ElevenLabs sound effects (optional)

Generate the interface and reward sounds — UI taps, XP ticks, level-up,
unlock, victory and defeat stings — with the ElevenLabs Sound Effects API:

```bash
ELEVENLABS_API_KEY=sk_... node scripts/generate-sfx.mjs
```

They land in `public/sfx/` and the results screen, menus and settings pick
them up automatically. Without them the game uses its procedural synth
stings, so nothing is ever silent.

### ElevenLabs voices (optional)

Pre-render the rivals' Kuwaiti lines with a real ElevenLabs voice:

```bash
ELEVENLABS_API_KEY=sk_... node scripts/generate-voices.mjs
```

Clips land in `public/voices/` and the game plays them in preference to
the browser's speech synthesis (which remains the zero-setup fallback).
The Unity port (`unity/`) uses the same lines and caches them at runtime —
see `unity/README.md`.


### Data API (for engine ports and tools)

The game's definition is served as versioned JSON so other engines can
read it live instead of hard-coding it:

```bash
curl localhost:3000/api/grn/v1/manifest    # discovery
curl localhost:3000/api/grn/v1/gamedata    # track, rivals, cars, parts, handling
```

The Unreal build consumes it at boot and falls back to its compiled-in
tables when offline; `npm run check:unreal` proves the two agree. The
hub server exposes the write side (`/api/v1/lap`, `/api/v1/career/:name`,
`/api/v1/leaderboard`) for lap submission and cloud careers.

## Tech stack

- [Next.js 15](https://nextjs.org) (App Router, React 19, TypeScript)
- [Tailwind CSS v4](https://tailwindcss.com)
- Fully static — no database or API keys needed to run

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production build

```bash
npm run build
npm start
```

## Project structure

This block is checked. `npm run check:structure` fails if a top-level
directory exists that is not named here, or if something named here has
gone — a map nobody maintains is worse than no map, because it is
believed. It described only the place-directory site for a long time
while a whole racing game grew beside it, unmentioned.

```
src/
├── app/                      # Next.js App Router
│   ├── page.tsx              # Wain landing page
│   ├── explore/              # Search + category filters
│   ├── places/[slug]/        # Place detail pages (statically generated)
│   ├── about/                # About Wain
│   ├── race/                 # Gulf Road Nights — the game's UI shell
│   ├── hub/                  # The online meet: crews, referrals, ledger
│   ├── api/grn/              # Data API the engine ports read
│   ├── layout.tsx            # Root layout, fonts, metadata
│   └── globals.css           # Tailwind theme, and the game's own classes
├── components/               # Shared site components
├── game/                     # The game itself — engine, world, cars, audio
└── lib/places.ts             # Place data, categories, helpers

tests/         The suite. One concern per file, run by `npm run test:*`.
tools/         Instruments, not tests: they measure and report a number
               rather than passing or failing.
  shots/       Browser probes that pose the game and read pixels.
  parity/      The TypeScript import hooks the suite runs under.
  blender/     Mesh generation for the wheels and palms.
  elevenlabs/  Voice, music and sound-effect generation.
scripts/       Repo-level generators and checkers: check-*, export-*.
server/        The hub — crews, referrals, the live ledger. Deployable.
unity/         Code-only Unity port. GRNData.cs is GENERATED.
unreal/        Code-only UE5 port. GRNTypes.h is GENERATED.
public/        Served assets: fonts, models, car thumbnails.
press/         Renders and captures. Most of it is regenerated on demand
               and ignored; press/cars/ is committed, because the shop
               thumbnails are derived from it.
desktop/       Electron shell for the Steam build.
mobile/        Capacitor notes for the iOS and Android wrappers.
```

**Generated files carry a banner and must not be hand-edited.**
`unity/Assets/Scripts/GRNData.cs` and `unreal/.../GRNTypes.h` come from
`npm run sync:unity` and `npm run sync:unreal`, and `npm run check:unity`
/ `check:unreal` prove they still agree with the live API.

**Two kinds of runnable file, and the difference is deliberate.** Every
`tests/*.mjs` has an `npm run test:*` script, because the suite is meant
to be run by name and in bulk. Most of `tools/shots/*.mjs` does not:
those are diagnostic probes reached for during one investigation, each
documenting its own `node tools/shots/<name>.mjs` invocation in its
header. Giving all 54 an npm script would add noise to a list of 114
without making any of them easier to find.

**The npm scripts are grouped and each group is contiguous** — run it,
ship it, regenerate, check without a browser, check with one, the suite,
media. `check:structure` fails if a group gets split again, which is
what had happened: 114 scripts in 27 separate blocks, `test:` alone in
five of them.

## Adding a place

Add an entry to the `places` array in `src/lib/places.ts` — the explore page, category filters, and a statically generated detail page at `/places/<slug>` all pick it up automatically.

---

Made with ❤️ in Kuwait 🇰🇼
