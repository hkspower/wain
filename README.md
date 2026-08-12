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

```
src/
├── app/
│   ├── layout.tsx            # Root layout (navbar + footer)
│   ├── page.tsx              # Landing page
│   ├── explore/              # Search + category filters
│   ├── places/[slug]/        # Place detail pages (statically generated)
│   ├── about/                # About Wain
│   ├── not-found.tsx         # 404 page
│   └── globals.css           # Tailwind theme (brand & sand palettes)
├── components/
│   ├── Navbar.tsx
│   ├── Footer.tsx
│   └── PlaceCard.tsx
└── lib/
    └── places.ts             # Place data, categories, and helpers
```

## Adding a place

Add an entry to the `places` array in `src/lib/places.ts` — the explore page, category filters, and a statically generated detail page at `/places/<slug>` all pick it up automatically.

---

Made with ❤️ in Kuwait 🇰🇼
